import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { LinkedInRscClient } from "../src/linkedin/rsc-client.js";

const config = loadConfig({
  NODE_ENV: "test",
  LINKEDIN_LI_AT: "secret-li-at",
  LINKEDIN_JSESSION_ID: '"ajax:123"',
  LINKEDIN_MAX_RETRIES: "0",
});

describe("LinkedInRscClient", () => {
  it("checks the session then directly fetches profile and detail routes", async () => {
    const fetcher = vi.fn().mockImplementation((url: string) => new Response(
      url.includes("/feed/") ? "<html>signed-in feed</html>" : `<html><meta property="og:title" content="Jane Doe | LinkedIn"><div>${url}</div></html>`,
      { status: 200, headers: { "content-type": "text/html" } },
    ));
    const client = new LinkedInRscClient(config, fetcher);

    const result = await client.fetchProfile("jane-doe");

    expect(result.transport).toBe("linkedin-rsc");
    expect(result.documents).toHaveLength(6);
    expect(fetcher).toHaveBeenCalledTimes(7);
    const requestedUrls = fetcher.mock.calls.map(([url]) => String(url));
    expect(requestedUrls).toContain("https://www.linkedin.com/in/jane-doe/");
    expect(requestedUrls).toContain("https://www.linkedin.com/in/jane-doe/details/experience/");
    expect(requestedUrls.every((url) => url.startsWith("https://www.linkedin.com/"))).toBe(true);
    const init = fetcher.mock.calls[1]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("csrf-token")).toBe("ajax:123");
    expect(new Headers(init.headers).get("cookie")).toContain("li_at=secret-li-at");
  });

  it("classifies an authentication redirect without following it", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "/login" } }));
    const client = new LinkedInRscClient(config, fetcher);
    await expect(client.checkSession(true)).rejects.toMatchObject({ code: "SESSION_REAUTH_REQUIRED" });
  });

  it("detects a 200 authwall body", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("<title>Sign in | LinkedIn</title>", { status: 200 }));
    const client = new LinkedInRscClient(config, fetcher);
    await expect(client.checkSession(true)).rejects.toMatchObject({ code: "SESSION_REAUTH_REQUIRED" });
  });
});
