import type { AppConfig } from "../config/env.js";
import { hasLinkedInSession } from "../config/env.js";
import { AppError } from "../domain/errors.js";

export interface LinkedInTransport {
  checkSession(force?: boolean): Promise<void>;
  fetchProfile(publicIdentifier: string): Promise<unknown>;
}

interface FetchLike {
  (input: string | URL | Request, init?: RequestInit): Promise<Response>;
}

export interface RscDocument {
  section: string;
  url: string;
  contentType: string;
  body: string;
}

export interface RscProfilePayload {
  transport: "linkedin-rsc";
  documents: RscDocument[];
}

const detailSections = ["experience", "education", "skills", "certifications", "languages"] as const;

function normalizeJsession(value: string): string {
  return value.trim().replace(/^"|"$/g, "");
}

export class LinkedInRscClient implements LinkedInTransport {
  private sessionHealthyUntil = 0;

  constructor(
    private readonly config: AppConfig,
    private readonly fetcher: FetchLike = fetch,
  ) {}

  async checkSession(force = false): Promise<void> {
    this.assertConfigured();
    if (!force && this.sessionHealthyUntil > Date.now()) return;

    const response = await this.request("https://www.linkedin.com/feed/", {
      method: "GET",
      headers: this.headers("https://www.linkedin.com/"),
    });
    if (!response.ok) await this.throwUpstreamError(response, "session");

    const body = await response.text();
    if (this.looksLikeAuthentication(body)) {
      this.sessionHealthyUntil = 0;
      throw new AppError("SESSION_REAUTH_REQUIRED", "LinkedIn returned an authentication or authwall page.");
    }
    this.sessionHealthyUntil = Date.now() + this.config.SESSION_HEALTH_TTL_SECONDS * 1_000;
  }

  async fetchProfile(publicIdentifier: string): Promise<RscProfilePayload> {
    await this.checkSession();
    const baseUrl = `https://www.linkedin.com/in/${publicIdentifier}/`;
    const routes = [
      { section: "profile", url: baseUrl },
      ...detailSections.map((section) => ({ section, url: `${baseUrl}details/${section}/` })),
    ];
    const documents: RscDocument[] = [];

    // Deliberately sequential: one account, one low-burst upstream stream.
    for (const route of routes) {
      const response = await this.request(route.url, {
        method: "GET",
        headers: this.headers(baseUrl),
      });
      if (!response.ok) {
        if (route.section !== "profile" && response.status === 404) continue;
        await this.throwUpstreamError(response, route.section === "profile" ? "profile" : "section");
      }
      const body = await response.text();
      if (this.looksLikeAuthentication(body)) {
        this.sessionHealthyUntil = 0;
        throw new AppError("SESSION_REAUTH_REQUIRED", "LinkedIn redirected profile extraction to authentication.");
      }
      documents.push({
        section: route.section,
        url: route.url,
        contentType: response.headers.get("content-type") ?? "",
        body,
      });
    }

    if (documents.length === 0 || documents[0]?.body.length === 0) {
      throw new AppError("UPSTREAM_SCHEMA_CHANGED", "LinkedIn returned no RSC profile documents.");
    }
    return { transport: "linkedin-rsc", documents };
  }

  private assertConfigured(): void {
    if (!hasLinkedInSession(this.config)) {
      throw new AppError(
        "SESSION_NOT_CONFIGURED",
        "LinkedIn session secrets are not configured. Set LINKEDIN_LI_AT and LINKEDIN_JSESSION_ID.",
      );
    }
  }

  private headers(referer: string): HeadersInit {
    const liAt = this.config.LINKEDIN_LI_AT;
    const rawJsessionId = this.config.LINKEDIN_JSESSION_ID;
    if (!liAt || !rawJsessionId) {
      throw new AppError("SESSION_NOT_CONFIGURED", "LinkedIn session secrets are not configured.");
    }
    const jsessionId = normalizeJsession(rawJsessionId);
    return {
      accept: "text/html,application/xhtml+xml,application/sdui+json;q=0.9,text/x-component;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      cookie: `li_at=${liAt}; JSESSIONID=\"${jsessionId}\"`,
      "csrf-token": jsessionId,
      referer,
      "user-agent": this.config.LINKEDIN_USER_AGENT,
      "x-li-initial-url": referer,
      "x-li-rsc-stream": "true",
    };
  }

  private looksLikeAuthentication(body: string): boolean {
    const prefix = body.slice(0, 100_000).toLowerCase();
    return prefix.includes("/uas/login")
      || prefix.includes("authwall")
      || prefix.includes("sign in | linkedin")
      || prefix.includes("checkpoint/challenge");
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.config.LINKEDIN_MAX_RETRIES; attempt += 1) {
      try {
        return await this.fetcher(url, {
          ...init,
          redirect: "manual",
          signal: AbortSignal.timeout(this.config.LINKEDIN_TIMEOUT_MS),
        });
      } catch (error) {
        lastError = error;
        if (attempt >= this.config.LINKEDIN_MAX_RETRIES) break;
      }
    }
    if (lastError instanceof DOMException && lastError.name === "TimeoutError") {
      throw new AppError("UPSTREAM_TIMEOUT", "LinkedIn did not respond before the timeout.", true);
    }
    throw new AppError("UPSTREAM_UNAVAILABLE", "Could not reach LinkedIn.", true);
  }

  private async throwUpstreamError(response: Response, context: "session" | "profile" | "section"): Promise<never> {
    if ([301, 302, 303, 307, 308, 401].includes(response.status)) {
      this.sessionHealthyUntil = 0;
      throw new AppError("SESSION_REAUTH_REQUIRED", "LinkedIn session is expired or redirected to authentication.");
    }
    if (response.status === 403) {
      if (context === "session") {
        this.sessionHealthyUntil = 0;
        throw new AppError("SESSION_REAUTH_REQUIRED", "LinkedIn rejected the configured session.");
      }
      throw new AppError("PROFILE_NOT_VISIBLE", "The configured account cannot access this LinkedIn profile.");
    }
    if (response.status === 404) throw new AppError("PROFILE_NOT_FOUND", "LinkedIn profile was not found.");
    if (response.status === 429 || response.status === 999) {
      throw new AppError("UPSTREAM_RATE_LIMITED", "LinkedIn is rate limiting or restricting the configured session.", true);
    }
    if (response.status === 400 || response.status === 410 || response.status === 422) {
      throw new AppError("UPSTREAM_SCHEMA_CHANGED", "LinkedIn rejected the captured RSC route contract.");
    }
    throw new AppError("UPSTREAM_UNAVAILABLE", `LinkedIn returned HTTP ${response.status}.`, response.status >= 500);
  }
}
