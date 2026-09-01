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

  it("decodes profile header state from a direct component RSC stream", () => {
    const stream = [
      '1:["$","div",null,["id","profile_name_loading_state","LoadingNamespace","stringValue","Jane Doe"]]',
      '2:["id","profile_headline_loading_state","LoadingNamespace","stringValue","Engineer"]',
      '3:["id","profile_photo_loading_state","LoadingNamespace","imageAssetValue","ClientImageAsset","renderPayload","https://images.example/","scale_400_400/avatar"]',
    ].join("\n");
    const result = parseRscProfile({ transport: "linkedin-rsc", documents: [{ section: "profile", body: stream }] }, "jane-doe");
    expect(result.profile.name.full).toBe("Jane Doe");
    expect(result.profile.headline).toBe("Engineer");
    expect(result.profile.profile_images.avatar_url).toBe("https://images.example/scale_400_400/avatar");
  });

  it("decodes server-rendered title, headline, and generic SDUI experience cards", () => {
    const html = `<html><head><title>Rohit Sharma | LinkedIn</title></head><body>
      <p>Rohit Sharma</p><div><p><span>SDE 1 @Amazon</span></p></div>
    </body></html>`;
    const experience = [
      '1:["$","p",null,{"children":["Software Engineer"]}]',
      '2:["$","p",null,{"children":["Amazon · Full-time"]}]',
      '3:["$","p",null,{"children":["Aug 2026 - Present · 2 mos"]}]',
      '4:["$","p",null,{"children":["Bengaluru, Karnataka, India · On-site"]}]',
    ].join("\n");
    const belowActivity = [
      '1:["$","p",null,{"children":["Example Institute of Technology"]}]',
      '2:["$","p",null,{"children":["Bachelor of Technology - BTech, Information Technology"]}]',
      '3:["$","p",null,{"children":["Oct 2022 – May 2026"]}]',
      '4:["$","p",null,{"children":["Grade: 9.07"]}]',
      '5:["$","p",null,{"children":["Cloud Certification"]}]',
      '6:["$","p",null,{"children":["Example Authority"]}]',
      '7:["$","p",null,{"children":["Issued Mar 2024"]}]',
    ].join("\n");
    const result = parseRscProfile({
      transport: "linkedin-rsc",
      documents: [
        { section: "profile", body: html },
        { section: "profileCardsExperienceOnly", body: experience },
        { section: "profileCardsBelowActivityPart1", body: belowActivity },
      ],
    }, "rohit-sharma");

    expect(result.profile.name.full).toBe("Rohit Sharma");
    expect(result.profile.headline).toBe("SDE 1 @Amazon");
    expect(result.profile.experience[0]).toMatchObject({
      title: "Software Engineer",
      company: "Amazon",
      employment_type: "Full-time",
      location: "Bengaluru, Karnataka, India",
      date_range: { current: true, start: { year: 2026, month: 8 } },
    });
    expect(result.profile.education[0]).toMatchObject({
      school: "Example Institute of Technology",
      degree: "Bachelor of Technology - BTech",
      field_of_study: "Information Technology",
      description: "Grade: 9.07",
    });
    expect(result.profile.certifications[0]).toMatchObject({
      name: "Cloud Certification",
      authority: "Example Authority",
      date_range: { start: { year: 2024, month: 3 } },
    });
  });
});
