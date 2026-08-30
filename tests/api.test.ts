import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/api/app.js";
import { TtlCache } from "../src/cache/ttl-cache.js";
import { loadConfig } from "../src/config/env.js";
import type { ExtractionResult } from "../src/domain/profile.js";
import { ExtractionService } from "../src/linkedin/extraction-service.js";
import type { LinkedInTransport } from "../src/linkedin/voyager-client.js";

const fixturePath = fileURLToPath(new URL("./fixtures/full-profile.json", import.meta.url));
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as unknown;
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function setup() {
  let profileCalls = 0;
  const transport: LinkedInTransport = {
    checkSession: async () => undefined,
    fetchProfile: async () => {
      profileCalls += 1;
      return fixture;
    },
  };
  const config = loadConfig({
    NODE_ENV: "test",
    API_KEY: "test-key",
    LINKEDIN_LI_AT: "configured",
    LINKEDIN_JSESSION_ID: "configured",
    RATE_LIMIT_MAX: "100",
  });
  const service = new ExtractionService(transport, new TtlCache<ExtractionResult>(60_000));
  const app = await buildApp({ config, extractionService: service, transport });
  apps.push(app);
  return { app, profileCalls: () => profileCalls };
}

describe("profile API", () => {
  it("requires an API key", async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: "POST",
      url: "/v1/profiles/extract",
      payload: { profile_url: "https://www.linkedin.com/in/jane-doe/" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHORIZED");
  });

  it("returns normalized data and caches repeat requests", async () => {
    const { app, profileCalls } = await setup();
    const request = {
      method: "POST" as const,
      url: "/v1/profiles/extract",
      headers: { "x-api-key": "test-key" },
      payload: { profile_url: "https://linkedin.com/in/jane-doe/?trk=test" },
    };
    const first = await app.inject(request);
    const second = await app.inject(request);

    expect(first.statusCode).toBe(200);
    expect(first.json().data.name.full).toBe("Jane Doe");
    expect(second.json().meta.cached).toBe(true);
    expect(profileCalls()).toBe(1);
  });

  it("rejects non-profile LinkedIn URLs", async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: "POST",
      url: "/v1/profiles/extract",
      headers: { "x-api-key": "test-key" },
      payload: { profile_url: "https://www.linkedin.com/company/example/" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_PROFILE_URL");
  });

  it("maps framework body validation to the public 400 contract", async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: "POST",
      url: "/v1/profiles/extract",
      headers: { "x-api-key": "test-key" },
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_PROFILE_URL");
  });
});
