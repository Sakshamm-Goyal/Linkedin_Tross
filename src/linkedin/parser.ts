import type {
  Certification,
  DateParts,
  DateRange,
  Education,
  Experience,
  Language,
  LinkedInProfile,
} from "../domain/profile.js";
import { AppError } from "../domain/errors.js";

export const PARSER_VERSION = "2026-09-01.3";

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeHtml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function parseJson(value: string): unknown | undefined {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function parseAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of tag.matchAll(pattern)) {
    const name = match[1]?.toLowerCase();
    const value = match[2] ?? match[3];
    if (name && value !== undefined) attributes[name] = decodeHtml(value);
  }
  return attributes;
}

function documentsFromText(text: string): unknown[] {
  const output: unknown[] = [];
  const trimmed = text.trim();
  const direct = parseJson(trimmed);
  if (direct !== undefined) output.push(direct);

  // LinkedIn component actions return the RSC wire format directly. Each line
  // has an opaque record id followed by a JSON payload, optionally prefixed by
  // a React record marker such as `I`.
  for (const line of text.split("\n")) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const candidate = line.slice(separator + 1).trim().replace(/^[A-Z]+(?=[{[\"])/, "");
    if (!candidate.startsWith("{") && !candidate.startsWith("[") && !candidate.startsWith("\"")) continue;
    const parsed = parseJson(candidate);
    if (parsed !== undefined) output.push(parsed);
  }

  for (const match of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const content = decodeHtml(match[1] ?? "").trim();
    const parsed = parseJson(content);
    if (parsed !== undefined) output.push(parsed);

    for (const push of content.matchAll(/(?:self\.)?__next_f\.push\((\[[\s\S]*?\])\)\s*;?/g)) {
      const flight = parseJson(push[1] ?? "");
      if (flight === undefined) continue;
      output.push(flight);
      if (Array.isArray(flight) && typeof flight[1] === "string") {
        for (const line of flight[1].split("\n")) {
          const separator = line.indexOf(":");
          const candidate = separator >= 0 ? line.slice(separator + 1).trim() : line.trim();
          if (!candidate.startsWith("{") && !candidate.startsWith("[")) continue;
          const decoded = parseJson(candidate);
          if (decoded !== undefined) output.push(decoded);
        }
      }
    }
  }

  const metadata: JsonObject = { $type: "linkedin.rsc.profileMetadata" };
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text)?.[1];
  if (title) metadata.fullName = decodeHtml(title).replace(/\s*\|\s*LinkedIn\s*$/i, "").trim();
  for (const tag of text.match(/<meta\b[^>]*>/gi) ?? []) {
    const attributes = parseAttributes(tag);
    const key = (attributes.property ?? attributes.name)?.toLowerCase();
    const content = attributes.content;
    if (!key || !content) continue;
    if (key === "og:title") metadata.fullName = content.replace(/\s*\|\s*LinkedIn\s*$/i, "").trim();
    if (key === "og:description" || key === "description") metadata.summary = content;
    if (key === "og:image") metadata.profilePictureUrl = content;
  }
  if (typeof metadata.fullName === "string") {
    const marker = `>${metadata.fullName}</p>`;
    const nameIndex = text.indexOf(marker);
    if (nameIndex >= 0) {
      const topCard = text.slice(nameIndex + marker.length, nameIndex + marker.length + 4_000);
      const headline = /<p\b[^>]*>\s*<span>([^<]+)<\/span>\s*<\/p>/i.exec(topCard)?.[1];
      if (headline) metadata.headline = decodeHtml(headline).trim();
    }
  }
  if (Object.keys(metadata).length > 1) output.push(metadata);
  return output;
}

function decodeRscEnvelope(payload: unknown): unknown[] {
  if (typeof payload === "string") return documentsFromText(payload);
  if (!isObject(payload)) return [payload];
  const documents = Array.isArray(payload.documents) ? payload.documents : [];
  if (documents.length === 0) return [payload];
  const decoded: unknown[] = [payload];
  for (const document of documents) {
    if (!isObject(document) || typeof document.body !== "string") continue;
    decoded.push(...documentsFromText(document.body));
  }
  return decoded;
}

function collectObjects(value: unknown, output: JsonObject[] = [], seen = new Set<object>()): JsonObject[] {
  if (Array.isArray(value)) {
    for (const item of value) collectObjects(item, output, seen);
    return output;
  }
  if (!isObject(value) || seen.has(value)) return output;
  seen.add(value);
  output.push(value);
  for (const nested of Object.values(value)) collectObjects(nested, output, seen);
  return output;
}

function collectStrings(value: unknown, output: string[] = [], seen = new Set<object>()): string[] {
  if (typeof value === "string") {
    output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output, seen);
    return output;
  }
  if (!isObject(value) || seen.has(value)) return output;
  seen.add(value);
  for (const nested of Object.values(value)) collectStrings(nested, output, seen);
  return output;
}

function stateString(strings: string[], stateId: string): string | null {
  for (let index = 0; index < strings.length - 4; index += 1) {
    if (strings[index] !== stateId) continue;
    const typeIndex = strings.indexOf("stringValue", index + 1);
    if (typeIndex < 0 || typeIndex > index + 5) continue;
    const value = strings[typeIndex + 1]?.trim();
    if (value) return value;
  }
  return null;
}

function stateImage(strings: string[]): string | null {
  const stateIndex = strings.indexOf("profile_photo_loading_state");
  if (stateIndex < 0) return null;
  const renderPayload = strings.indexOf("renderPayload", stateIndex);
  const root = renderPayload >= 0 ? strings[renderPayload + 1] : null;
  if (!root?.startsWith("http")) return null;
  const candidates = strings.slice(renderPayload + 2, renderPayload + 16)
    .filter((value) => value.startsWith("scale_"));
  return candidates.length > 0 ? `${root}${candidates.at(-1)}` : root;
}

function fallbackProfileFromRscState(decoded: unknown[], publicIdentifier: string): LinkedInProfile | null {
  const strings = decoded.flatMap((document) => collectStrings(document));
  const normalizedIdentifier = publicIdentifier.toLowerCase();
  const belongsToTarget = strings.some((value) => {
    const normalized = value.toLowerCase();
    return normalized === normalizedIdentifier
      || normalized.includes(`/in/${normalizedIdentifier}`)
      || normalized.includes(`${normalizedIdentifier}profile`);
  });
  if (!belongsToTarget) return null;
  const full = stateString(strings, "profile_name_loading_state");
  if (!full) return null;
  const nameParts = full.split(/\s+/);
  const first = nameParts[0] ?? null;
  const last = nameParts.length > 1 ? nameParts.at(-1) ?? null : null;
  return {
    profile_url: `https://www.linkedin.com/in/${publicIdentifier}/`,
    public_identifier: publicIdentifier,
    linkedin_id: null,
    name: { first, last, full },
    headline: stateString(strings, "profile_headline_loading_state"),
    location: null,
    about: null,
    profile_images: { avatar_url: stateImage(strings), background_url: null },
    experience: [],
    education: [],
    skills: [],
    certifications: [],
    languages: [],
  };
}

function directString(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (!isObject(value)) return null;
  for (const key of ["text", "value", "displayName", "localizedName", "name"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  const localized = value.localized;
  if (isObject(localized)) {
    const candidate = Object.values(localized).find((entry) => typeof entry === "string" && entry.trim());
    if (typeof candidate === "string") return candidate.trim();
  }
  return null;
}

function field(object: JsonObject | undefined, ...keys: string[]): string | null {
  if (!object) return null;
  for (const key of keys) {
    const value = directString(object[key]);
    if (value) return value;
  }
  return null;
}

function typeName(object: JsonObject): string {
  return String(object.$type ?? object["@type"] ?? object.entityType ?? object.type ?? "").toLowerCase();
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function dateParts(value: unknown): DateParts | null {
  if (!isObject(value)) return null;
  const year = numberOrNull(value.year);
  const month = numberOrNull(value.month);
  if (year === null && month === null) return null;
  return { year, month };
}

function dateRange(object: JsonObject): DateRange | null {
  const period = isObject(object.timePeriod)
    ? object.timePeriod
    : isObject(object.dateRange)
      ? object.dateRange
      : undefined;
  if (!period) return null;
  const start = dateParts(period.startDate ?? period.start);
  const end = dateParts(period.endDate ?? period.end);
  return { start, end, current: end === null };
}

function imageUrl(value: unknown): string | null {
  const objects = collectObjects(value);
  for (const object of objects) {
    const rootUrl = field(object, "rootUrl", "rootUrlSegment");
    const artifacts = Array.isArray(object.artifacts) ? object.artifacts.filter(isObject) : [];
    if (rootUrl && artifacts.length > 0) {
      const largest = [...artifacts].sort(
        (a, b) => (numberOrNull(b.width) ?? 0) * (numberOrNull(b.height) ?? 0) - (numberOrNull(a.width) ?? 0) * (numberOrNull(a.height) ?? 0),
      )[0];
      const segment = field(largest, "fileIdentifyingUrlPathSegment");
      if (segment) return `${rootUrl}${segment}`;
    }
    for (const key of ["url", "downloadUrl", "profilePictureUrl"]) {
      const url = directString(object[key]);
      if (url?.startsWith("http")) return url;
    }
  }
  return null;
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const id = key(item);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function findProfile(objects: JsonObject[], publicIdentifier: string): JsonObject | undefined {
  const exactProfile = objects.find((object) => {
    const type = typeName(object);
    const identifier = field(object, "publicIdentifier", "vanityName");
    return (type.endsWith("profile") || type.includes("profilemetadata") || type.endsWith("person"))
      && identifier?.toLowerCase() === publicIdentifier.toLowerCase();
  });
  if (exactProfile) return exactProfile;

  // This synthetic object is created only from the requested profile document's
  // own <title>/meta tags. Never fall back to arbitrary Person/Profile objects:
  // RSC payloads also contain recommendations and navigation identities.
  return objects.find((object) => typeName(object).includes("linkedin.rsc.profilemetadata"));
}

function parseExperience(objects: JsonObject[]): Experience[] {
  const candidates = objects.filter((object) => {
    const type = typeName(object);
    return (type.includes("position") || type.includes("experience")) && !type.includes("positiongroup");
  });
  return uniqueBy(candidates.map((object) => ({
    title: field(object, "title", "role"),
    company: field(object, "companyName", "organizationName", "company"),
    location: field(object, "locationName", "location"),
    description: field(object, "description", "summary"),
    employment_type: field(object, "employmentType"),
    date_range: dateRange(object),
  })).filter((item) => item.title || item.company), (item) => JSON.stringify(item));
}

function parseMonthYear(value: string): DateParts | null {
  const match = /^(?:[A-Z][a-z]{2}\s+)?(\d{4})$/.exec(value.trim());
  if (!match?.[1]) return null;
  const monthName = /^([A-Z][a-z]{2})\s+/.exec(value)?.[1];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return { year: Number(match[1]), month: monthName ? months.indexOf(monthName) + 1 : null };
}

function leafTexts(text: string): string[] {
  const values: string[] = [];
  for (const match of text.matchAll(/"children":\[(?:null,)?\s*"((?:\\.|[^"\\])*)"\]/g)) {
    try {
      const value = JSON.parse(`"${match[1] ?? ""}"`) as string;
      if (value.trim()) values.push(value.trim());
    } catch {
      // Ignore an isolated malformed React Flight string.
    }
  }
  return values;
}

function documentLeafTexts(payload: unknown, section: string): string[] {
  if (!isObject(payload) || !Array.isArray(payload.documents)) return [];
  const document = payload.documents.find(
    (item) => isObject(item) && item.section === section && typeof item.body === "string",
  );
  return isObject(document) && typeof document.body === "string" ? leafTexts(document.body) : [];
}

function parseSduiExperience(payload: unknown): Experience[] {
  const values = documentLeafTexts(payload, "profileCardsExperienceOnly");
  const employment = /^(.*?) · (Full-time|Part-time|Internship|Contract|Freelance|Temporary|Apprenticeship|Self-employed)$/i;
  const date = /^([A-Z][a-z]{2}\s+\d{4}) - (Present|[A-Z][a-z]{2}\s+\d{4})(?: · .*)?$/;
  const output: Experience[] = [];
  for (let index = 1; index < values.length; index += 1) {
    const company = employment.exec(values[index] ?? "");
    if (!company) continue;
    const dateValue = values.slice(index + 1, index + 4).find((value) => date.test(value));
    const dateMatch = dateValue ? date.exec(dateValue) : null;
    const location = values.slice(index + 1, index + 5).find(
      (value) => value.includes(" · ") && !employment.test(value) && !date.test(value),
    );
    output.push({
      title: values[index - 1] ?? null,
      company: company[1]?.trim() || null,
      location: location?.replace(/\s*·\s*(?:On-site|Remote|Hybrid)$/i, "").trim() || null,
      description: null,
      employment_type: company[2] ?? null,
      date_range: dateMatch
        ? {
            start: parseMonthYear(dateMatch[1] ?? ""),
            end: dateMatch[2] === "Present" ? null : parseMonthYear(dateMatch[2] ?? ""),
            current: dateMatch[2] === "Present",
          }
        : null,
    });
  }
  return uniqueBy(output, (item) => JSON.stringify(item));
}

function parseSduiEducation(payload: unknown): Education[] {
  const values = documentLeafTexts(payload, "profileCardsBelowActivityPart1");
  const degreePattern = /^(Bachelor|Master|B\.?Tech|M\.?Tech|BSc|MSc|MBA|PhD|Diploma|12th|High School)\b/i;
  const schoolPattern = /\b(University|Institute|College|School|Academy|Technology)\b/i;
  const datePattern = /^((?:[A-Z][a-z]{2}\s+)?\d{4})\s+[–-]\s+((?:[A-Z][a-z]{2}\s+)?\d{4}|Present)$/;
  const output: Education[] = [];

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] ?? "";
    if (!degreePattern.test(value)) continue;
    const school = values.slice(0, index).reverse().find((candidate) => schoolPattern.test(candidate));
    if (!school) continue;
    const dateValue = values.slice(index + 1, index + 4).find((candidate) => datePattern.test(candidate));
    const dateMatch = dateValue ? datePattern.exec(dateValue) : null;
    const [degree, ...fieldParts] = value.split(",").map((part) => part.trim());
    const grade = values.slice(index + 1, index + 4).find((candidate) => /^Grade:/i.test(candidate));
    output.push({
      school: school.replace(/\s*·\s*(?:On-site|Remote|Hybrid)$/i, "").trim(),
      degree: degree || null,
      field_of_study: fieldParts.join(", ") || null,
      description: grade ?? null,
      date_range: dateMatch
        ? {
            start: parseMonthYear(dateMatch[1] ?? ""),
            end: dateMatch[2] === "Present" ? null : parseMonthYear(dateMatch[2] ?? ""),
            current: dateMatch[2] === "Present",
          }
        : null,
    });
  }
  return uniqueBy(output, (item) => JSON.stringify(item));
}

function parseSduiCertifications(payload: unknown): Certification[] {
  const values = documentLeafTexts(payload, "profileCardsBelowActivityPart1");
  const issuedPattern = /^Issued\s+([A-Z][a-z]{2}\s+\d{4})/;
  const output: Certification[] = [];
  for (let index = 2; index < values.length; index += 1) {
    const issued = issuedPattern.exec(values[index] ?? "");
    if (!issued) continue;
    output.push({
      name: values[index - 2] ?? null,
      authority: values[index - 1] ?? null,
      license_number: null,
      url: null,
      date_range: {
        start: parseMonthYear(issued[1] ?? ""),
        end: null,
        current: false,
      },
    });
  }
  return uniqueBy(output, (item) => JSON.stringify(item));
}

function parseEducation(objects: JsonObject[]): Education[] {
  return uniqueBy(objects.filter((object) => typeName(object).includes("education")).map((object) => ({
    school: field(object, "schoolName", "organizationName", "school"),
    degree: field(object, "degreeName", "degree"),
    field_of_study: field(object, "fieldOfStudy", "fieldOfStudyName"),
    description: field(object, "description", "activities"),
    date_range: dateRange(object),
  })).filter((item) => item.school || item.degree), (item) => JSON.stringify(item));
}

function parseCertifications(objects: JsonObject[]): Certification[] {
  return uniqueBy(objects.filter((object) => {
    const type = typeName(object);
    return type.includes("certification") || type.includes("license");
  }).map((object) => ({
    name: field(object, "name", "title"),
    authority: field(object, "authority", "issuingOrganization", "companyName"),
    license_number: field(object, "licenseNumber", "credentialId"),
    url: field(object, "url", "credentialUrl"),
    date_range: dateRange(object),
  })).filter((item) => item.name), (item) => JSON.stringify(item));
}

function parseSkills(objects: JsonObject[]): string[] {
  return [...new Set(objects.filter((object) => {
    const type = typeName(object);
    return type.includes("skill") && !type.includes("skillinsight");
  }).map((object) => field(object, "name", "skillName")).filter((value): value is string => Boolean(value)))];
}

function parseLanguages(objects: JsonObject[]): Language[] {
  return uniqueBy(objects.filter((object) => typeName(object).includes("language")).map((object) => ({
    name: field(object, "name", "languageName") ?? "",
    proficiency: field(object, "proficiency", "proficiencyName"),
  })).filter((item) => item.name), (item) => `${item.name}|${item.proficiency ?? ""}`);
}

export interface ParsedProfile {
  profile: LinkedInProfile;
  unavailableSections: string[];
}

export function parseRscProfile(payload: unknown, publicIdentifier: string): ParsedProfile {
  const decoded = decodeRscEnvelope(payload);
  const objects = decoded.flatMap((document) => collectObjects(document));
  const profileEntity = findProfile(objects, publicIdentifier);
  if (!profileEntity) {
    const stateProfile = fallbackProfileFromRscState(decoded, publicIdentifier);
    if (stateProfile) {
      const unavailableSections = ["about", "experience", "education", "skills", "certifications", "languages", "profile_images"]
        .filter((section) => section !== "profile_images" || !stateProfile.profile_images.avatar_url);
      return { profile: stateProfile, unavailableSections };
    }
    const experience = parseSduiExperience(payload);
    if (experience.length > 0) {
      const education = parseSduiEducation(payload);
      const certifications = parseSduiCertifications(payload);
      return {
        profile: {
          profile_url: `https://www.linkedin.com/in/${publicIdentifier}/`,
          public_identifier: publicIdentifier,
          linkedin_id: null,
          name: { first: null, last: null, full: null },
          headline: null,
          location: null,
          about: null,
          profile_images: { avatar_url: null, background_url: null },
          experience,
          education,
          skills: [],
          certifications,
          languages: [],
        },
        unavailableSections: [
          "name",
          "headline",
          "location",
          "about",
          ...(education.length === 0 ? ["education"] : []),
          "skills",
          ...(certifications.length === 0 ? ["certifications"] : []),
          "languages",
          "profile_images",
        ],
      };
    }
    throw new AppError(
      "UPSTREAM_SCHEMA_CHANGED",
      "The LinkedIn response did not contain a recognizable profile entity.",
      false,
      { parserVersion: PARSER_VERSION },
    );
  }

  const first = field(profileEntity, "firstName", "givenName");
  const last = field(profileEntity, "lastName", "familyName");
  const composedName = [first, last].filter(Boolean).join(" ") || null;
  const full = field(profileEntity, "fullName", "name") ?? composedName;
  const experience = parseExperience(objects);
  if (experience.length === 0) experience.push(...parseSduiExperience(payload));
  const education = parseEducation(objects);
  if (education.length === 0) education.push(...parseSduiEducation(payload));
  const skills = parseSkills(objects);
  const certifications = parseCertifications(objects);
  if (certifications.length === 0) certifications.push(...parseSduiCertifications(payload));
  const languages = parseLanguages(objects);
  const avatar = imageUrl(profileEntity.profilePicture ?? profileEntity.displayPhoto ?? profileEntity.picture);
  const background = imageUrl(profileEntity.backgroundPicture ?? profileEntity.backgroundImage);

  const profile: LinkedInProfile = {
    profile_url: `https://www.linkedin.com/in/${publicIdentifier}/`,
    public_identifier: field(profileEntity, "publicIdentifier", "vanityName") ?? publicIdentifier,
    linkedin_id: field(profileEntity, "entityUrn", "profileId", "memberId", "id"),
    name: { first, last, full },
    headline: field(profileEntity, "headline", "occupation", "jobTitle"),
    location: field(profileEntity, "geoLocationName", "locationName", "location", "address"),
    about: field(profileEntity, "summary", "about", "description"),
    profile_images: { avatar_url: avatar, background_url: background },
    experience,
    education,
    skills,
    certifications,
    languages,
  };

  const unavailableSections = [
    ["about", profile.about],
    ["experience", profile.experience.length],
    ["education", profile.education.length],
    ["skills", profile.skills.length],
    ["certifications", profile.certifications.length],
    ["languages", profile.languages.length],
    ["profile_images", profile.profile_images.avatar_url || profile.profile_images.background_url],
  ].filter(([, value]) => !value).map(([name]) => String(name));

  return { profile, unavailableSections };
}
