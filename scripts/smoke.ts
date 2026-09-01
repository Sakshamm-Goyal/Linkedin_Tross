import { loadConfig } from "../src/config/env.js";
import { parseRscProfile } from "../src/linkedin/parser.js";
import { canonicalizeProfileUrl } from "../src/security/profile-url.js";
import { LinkedInRscClient } from "../src/linkedin/rsc-client.js";
import { LinkedInSessionStore } from "../src/linkedin/session-store.js";

const input = process.argv[2];
if (!input) {
  console.error("Usage: npm run smoke -- https://www.linkedin.com/in/{slug}/");
  process.exit(2);
}

const canonical = canonicalizeProfileUrl(input);
const config = loadConfig();
const client = new LinkedInRscClient(config, await LinkedInSessionStore.create(config));
await client.checkSession(true);
const payload = await client.fetchProfile(canonical.publicIdentifier);
const parsed = parseRscProfile(payload, canonical.publicIdentifier);
console.log(JSON.stringify({
  status: "success",
  data: parsed.profile,
  unavailable_sections: parsed.unavailableSections,
}, null, 2));
