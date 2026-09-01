import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { LinkedInRscClient } from "../src/linkedin/rsc-client.js";
import { LinkedInSessionStore } from "../src/linkedin/session-store.js";

const config = loadConfig({
  NODE_ENV: "test",
  LINKEDIN_LI_AT: "secret-li-at",
  LINKEDIN_JSESSION_ID: '"ajax:123"',
  LINKEDIN_MAX_RETRIES: "0",
});

describe("LinkedInRscClient", () => {
  it("fetches the captured profile RSC component set", async () => {
    const fetcher = vi.fn().mockImplementation(
      () => new Response('0:["$","div",null,{"children":"profile"}]', { status: 200 }),
    );
    const client = new LinkedInRscClient(config, await LinkedInSessionStore.create(config), fetcher);

    const result = await client.fetchProfile("jane-doe");

    expect(result.transport).toBe("linkedin-rsc");
    expect(result.documents).toHaveLength(5);
    expect(fetcher).toHaveBeenCalledTimes(5);
    const requestedUrls = fetcher.mock.calls.map(([url]) => String(url));
    expect(requestedUrls.slice(1).every((url) => url.includes("/flagship-web/rsc-action/actions/component"))).toBe(true);
    expect(requestedUrls.every((url) => url.startsWith("https://www.linkedin.com/"))).toBe(true);
    const init = fetcher.mock.calls[1]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("csrf-token")).toBe("ajax:123");
    expect(new Headers(init.headers).get("cookie")).toContain("li_at=secret-li-at");
    expect(JSON.parse(String(init.body))).toMatchObject({
      clientArguments: { payload: { vanityName: "jane-doe", isSelfView: false } },
    });
  });

  it("classifies an authentication redirect without following it", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "/login" } }));
    const client = new LinkedInRscClient(config, await LinkedInSessionStore.create(config), fetcher);
    await expect(client.checkSession(true)).rejects.toMatchObject({ code: "SESSION_REAUTH_REQUIRED" });
  });

  it("detects a 200 authwall body", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("<title>Sign in | LinkedIn</title>", { status: 200 }));
    const client = new LinkedInRscClient(config, await LinkedInSessionStore.create(config), fetcher);
    await expect(client.checkSession(true)).rejects.toMatchObject({ code: "SESSION_REAUTH_REQUIRED" });
  });

  it("encrypts refreshed cookies and restores them after restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "linkedin-session-"));
    const sessionFile = join(directory, "session.enc");
    try {
      const persistentConfig = loadConfig({
        NODE_ENV: "test",
        LINKEDIN_LI_AT: "secret-li-at",
        LINKEDIN_JSESSION_ID: '"ajax:123"',
        LINKEDIN_SESSION_FILE: sessionFile,
        LINKEDIN_SESSION_KEY: "a-long-secret-kept-in-the-deployment-secret-manager",
        LINKEDIN_MAX_RETRIES: "0",
      });
      const responseHeaders = new Headers({ "content-type": "application/json" });
      responseHeaders.append("set-cookie", 'JSESSIONID="ajax:456"; Path=/; HttpOnly; Secure');
      const fetcher = vi.fn().mockImplementation(
        () => new Response('{"included":[]}', { status: 200, headers: responseHeaders }),
      );
      const client = new LinkedInRscClient(
        persistentConfig,
        await LinkedInSessionStore.create(persistentConfig),
        fetcher,
      );

      await client.fetchProfile("jane-doe");
      const encrypted = await readFile(sessionFile, "utf8");
      expect(encrypted).not.toContain("secret-li-at");
      expect(encrypted).not.toContain("ajax:456");

      const restoredConfig = loadConfig({
        NODE_ENV: "test",
        LINKEDIN_SESSION_FILE: sessionFile,
        LINKEDIN_SESSION_KEY: "a-long-secret-kept-in-the-deployment-secret-manager",
      });
      const restored = await LinkedInSessionStore.create(restoredConfig);
      expect(restored.hasSession()).toBe(true);
      expect(restored.csrfToken()).toBe("ajax:456");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
