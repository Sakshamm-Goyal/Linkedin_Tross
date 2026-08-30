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

export const PARSER_VERSION = "2026-08-31.1";

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
  for (const tag of text.match(/<meta\b[^>]*>/gi) ?? []) {
    const attributes = parseAttributes(tag);
    const key = (attributes.property ?? attributes.name)?.toLowerCase();
    const content = attributes.content;
    if (!key || !content) continue;
    if (key === "og:title") metadata.fullName = content.replace(/\s*\|\s*LinkedIn\s*$/i, "").trim();
    if (key === "og:description" || key === "description") metadata.summary = content;
    if (key === "og:image") metadata.profilePictureUrl = content;
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
  return objects.find((object) => {
    const type = typeName(object);
    const identifier = field(object, "publicIdentifier", "vanityName");
    return (type.endsWith("profile") || type.includes("profilemetadata") || type.endsWith("person"))
      && identifier?.toLowerCase() === publicIdentifier.toLowerCase();
  }) ?? objects.find((object) => {
    const type = typeName(object);
    return (type.endsWith("profile") || type.includes("profilemetadata") || type.endsWith("person"))
      && Boolean(field(object, "firstName", "givenName", "fullName", "name") || field(object, "headline", "jobTitle"));
  }) ?? objects.find((object) => Boolean(field(object, "firstName", "givenName") && field(object, "headline", "jobTitle")));
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
  const objects = decodeRscEnvelope(payload).flatMap((document) => collectObjects(document));
  const profileEntity = findProfile(objects, publicIdentifier);
  if (!profileEntity) {
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
  const education = parseEducation(objects);
  const skills = parseSkills(objects);
  const certifications = parseCertifications(objects);
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
