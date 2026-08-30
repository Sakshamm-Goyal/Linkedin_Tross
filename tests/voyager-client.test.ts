import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { VoyagerClient } from "../src/linkedin/voyager-client.js";

const config = loadConfig({
  NODE_ENV: "test",
  LINKEDIN_LI_AT: "secret-li-at",
  LINKEDIN_JSESSION_ID: '"ajax:123"',
  LINKEDIN_PROFILE_QUERY_ID: "voyagerIdentityDashProfiles.testhash",
  LINKEDIN_MAX_RETRIES: "0",
});

describe("VoyagerClient", () => {
  it("checks the session then calls the configured profile operation", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response('{"included":[]}', { status: 200, headers: { "content-type": "application/json" } }));
    const client = new VoyagerClient(config, fetcher);

    await client.fetchProfile("jane-doe");

    expect(fetcher).toHaveBeenCalledTimes(2);
    const [profileUrl, init] = fetcher.mock.calls[1] as [string, RequestInit];
    expect(profileUrl).toContain("queryId=voyagerIdentityDashProfiles.testhash");
    expect(profileUrl).toContain("variables=%28vanityName%3Ajane-doe%29");
    expect(new Headers(init.headers).get("csrf-token")).toBe("ajax:123");
    expect(new Headers(init.headers).get("cookie")).toContain("li_at=secret-li-at");
  });

  it("classifies an authentication redirect without following it", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "/login" } }));
    const client = new VoyagerClient(config, fetcher);
    await expect(client.checkSession(true)).rejects.toMatchObject({ code: "SESSION_REAUTH_REQUIRED" });
  });
});
