import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseRscProfile } from "../src/linkedin/parser.js";

const fixturePath = fileURLToPath(new URL("./fixtures/full-profile.json", import.meta.url));
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as unknown;

describe("parseRscProfile", () => {
  it("normalizes all requested profile sections", () => {
    const result = parseRscProfile(fixture, "jane-doe");
    expect(result.profile.name.full).toBe("Jane Doe");
    expect(result.profile.headline).toBe("Staff Software Engineer");
    expect(result.profile.profile_images.avatar_url).toMatch(/large$/);
    expect(result.profile.experience).toHaveLength(1);
    expect(result.profile.experience[0]?.date_range?.current).toBe(true);
    expect(result.profile.education[0]?.field_of_study).toBe("Computer Science");
    expect(result.profile.skills).toEqual(["TypeScript", "Distributed Systems"]);
    expect(result.profile.certifications[0]?.license_number).toBe("CERT-1");
    expect(result.profile.languages[0]?.name).toBe("English");
  });

  it("fails loudly when the upstream shape no longer contains a profile", () => {
    expect(() => parseRscProfile({ data: {}, included: [] }, "missing")).toThrow(
      "recognizable profile entity",
    );
  });

  it("decodes structured data embedded in an RSC-backed HTML document", () => {
    const html = `<html><head><meta property="og:title" content="Jane Doe | LinkedIn">
      <script type="application/ld+json">{"@type":"Person","givenName":"Jane","familyName":"Doe","jobTitle":"Engineer","publicIdentifier":"jane-doe"}</script>
      </head></html>`;
    const result = parseRscProfile({ transport: "linkedin-rsc", documents: [{ section: "profile", body: html }] }, "jane-doe");
    expect(result.profile.name.full).toBe("Jane Doe");
    expect(result.profile.headline).toBe("Engineer");
  });
});
