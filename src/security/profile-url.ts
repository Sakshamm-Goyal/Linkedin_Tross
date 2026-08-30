import { AppError } from "../domain/errors.js";

export interface CanonicalProfileUrl {
  url: string;
  publicIdentifier: string;
}

const allowedHosts = new Set(["linkedin.com", "www.linkedin.com"]);
const validSlug = /^[a-zA-Z0-9][a-zA-Z0-9-]{1,99}$/;

export function canonicalizeProfileUrl(input: string): CanonicalProfileUrl {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new AppError("INVALID_PROFILE_URL", "profile_url must be a valid absolute URL.");
  }

  if (parsed.protocol !== "https:" || !allowedHosts.has(parsed.hostname.toLowerCase())) {
    throw new AppError("INVALID_PROFILE_URL", "Only HTTPS linkedin.com profile URLs are accepted.");
  }

  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== "in" || !parts[1] || !validSlug.test(parts[1])) {
    throw new AppError("INVALID_PROFILE_URL", "Expected a URL in the form https://www.linkedin.com/in/{slug}/.");
  }

  const publicIdentifier = parts[1].toLowerCase();
  return {
    publicIdentifier,
    url: `https://www.linkedin.com/in/${publicIdentifier}/`,
  };
}
