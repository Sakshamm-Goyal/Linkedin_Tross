import { loadConfig } from "../src/config/env.js";
import { parseVoyagerProfile } from "../src/linkedin/parser.js";
import { canonicalizeProfileUrl } from "../src/security/profile-url.js";
import { VoyagerClient } from "../src/linkedin/voyager-client.js";

const input = process.argv[2];
if (!input) {
  console.error("Usage: npm run smoke -- https://www.linkedin.com/in/{slug}/");
  process.exit(2);
}

const canonical = canonicalizeProfileUrl(input);
const client = new VoyagerClient(loadConfig());
await client.checkSession(true);
const payload = await client.fetchProfile(canonical.publicIdentifier);
const parsed = parseVoyagerProfile(payload, canonical.publicIdentifier);
console.log(JSON.stringify({
  status: "success",
  data: parsed.profile,
  unavailable_sections: parsed.unavailableSections,
}, null, 2));
