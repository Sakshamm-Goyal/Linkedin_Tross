import { describe, expect, it } from "vitest";
import { canonicalizeProfileUrl } from "../src/security/profile-url.js";

describe("canonicalizeProfileUrl", () => {
  it("normalizes an allowed LinkedIn profile URL", () => {
    expect(canonicalizeProfileUrl("https://linkedin.com/in/Jane-Doe/?trk=public")).toEqual({
      publicIdentifier: "jane-doe",
      url: "https://www.linkedin.com/in/jane-doe/",
    });
  });

  it.each([
    "http://www.linkedin.com/in/jane-doe/",
    "https://evil.example/in/jane-doe/",
    "https://www.linkedin.com/company/example/",
    "https://www.linkedin.com/in/a/",
    "not-a-url",
  ])("rejects unsafe input %s", (input) => {
    expect(() => canonicalizeProfileUrl(input)).toThrow();
  });
});
