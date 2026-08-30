export const extractionBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["profile_url"],
  properties: {
    profile_url: { type: "string", format: "uri", examples: ["https://www.linkedin.com/in/example/"] },
    refresh: { type: "boolean", default: false },
  },
} as const;

export const errorSchema = {
  type: "object",
  required: ["status", "error", "request_id"],
  properties: {
    status: { type: "string", const: "error" },
    error: {
      type: "object",
      required: ["code", "message", "retryable"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        retryable: { type: "boolean" },
      },
    },
    request_id: { type: "string" },
  },
} as const;

const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] } as const;
const dateParts = {
  anyOf: [
    {
      type: "object",
      required: ["year", "month"],
      properties: { year: { anyOf: [{ type: "integer" }, { type: "null" }] }, month: { anyOf: [{ type: "integer" }, { type: "null" }] } },
    },
    { type: "null" },
  ],
} as const;
const dateRange = {
  anyOf: [
    { type: "object", required: ["start", "end", "current"], properties: { start: dateParts, end: dateParts, current: { type: "boolean" } } },
    { type: "null" },
  ],
} as const;

export const extractionResponseSchema = {
  type: "object",
  required: ["status", "data", "meta"],
  properties: {
    status: { type: "string", const: "success" },
    data: {
      type: "object",
      required: ["profile_url", "public_identifier", "linkedin_id", "name", "headline", "location", "about", "profile_images", "experience", "education", "skills", "certifications", "languages"],
      properties: {
        profile_url: { type: "string" }, public_identifier: { type: "string" }, linkedin_id: nullableString,
        name: { type: "object", required: ["first", "last", "full"], properties: { first: nullableString, last: nullableString, full: nullableString } },
        headline: nullableString, location: nullableString, about: nullableString,
        profile_images: { type: "object", required: ["avatar_url", "background_url"], properties: { avatar_url: nullableString, background_url: nullableString } },
        experience: { type: "array", items: { type: "object", required: ["title", "company", "location", "description", "employment_type", "date_range"], properties: { title: nullableString, company: nullableString, location: nullableString, description: nullableString, employment_type: nullableString, date_range: dateRange } } },
        education: { type: "array", items: { type: "object", required: ["school", "degree", "field_of_study", "description", "date_range"], properties: { school: nullableString, degree: nullableString, field_of_study: nullableString, description: nullableString, date_range: dateRange } } },
        skills: { type: "array", items: { type: "string" } },
        certifications: { type: "array", items: { type: "object", required: ["name", "authority", "license_number", "url", "date_range"], properties: { name: nullableString, authority: nullableString, license_number: nullableString, url: nullableString, date_range: dateRange } } },
        languages: { type: "array", items: { type: "object", required: ["name", "proficiency"], properties: { name: { type: "string" }, proficiency: nullableString } } },
      },
    },
    meta: {
      type: "object",
      required: ["fetched_at", "cached", "completeness", "unavailable_sections", "parser_version", "warnings"],
      properties: {
        fetched_at: { type: "string", format: "date-time" }, cached: { type: "boolean" }, completeness: { type: "string", enum: ["complete", "partial"] },
        unavailable_sections: { type: "array", items: { type: "string" } }, parser_version: { type: "string" }, warnings: { type: "array", items: { type: "string" } },
      },
    },
  },
} as const;
