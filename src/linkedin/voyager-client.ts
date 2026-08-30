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

function normalizeJsession(value: string): string {
  return value.trim().replace(/^"|"$/g, "");
}

export class VoyagerClient implements LinkedInTransport {
  private sessionHealthyUntil = 0;

  constructor(
    private readonly config: AppConfig,
    private readonly fetcher: FetchLike = fetch,
  ) {}

  async checkSession(force = false): Promise<void> {
    this.assertConfigured();
    if (!force && this.sessionHealthyUntil > Date.now()) return;

    const response = await this.request("https://www.linkedin.com/voyager/api/me", {
      method: "GET",
      headers: this.headers("https://www.linkedin.com/feed/"),
    });

    if (response.status === 403) {
      this.sessionHealthyUntil = 0;
      throw new AppError("SESSION_REAUTH_REQUIRED", "LinkedIn rejected the configured session.");
    }
    if (!response.ok) await this.throwUpstreamError(response);
    this.sessionHealthyUntil = Date.now() + this.config.SESSION_HEALTH_TTL_SECONDS * 1_000;
  }

  async fetchProfile(publicIdentifier: string): Promise<unknown> {
    await this.checkSession();
    const variables = `(${this.config.LINKEDIN_PROFILE_VARIABLE_NAME}:${publicIdentifier})`;
    const query = new URLSearchParams({
      includeWebMetadata: "true",
      variables,
      queryId: this.config.LINKEDIN_PROFILE_QUERY_ID,
    });
    const profileUrl = `https://www.linkedin.com/in/${publicIdentifier}/`;
    const endpoint = `https://www.linkedin.com/voyager/api/graphql?${query.toString()}`;
    const response = await this.request(endpoint, {
      method: "GET",
      headers: this.headers(profileUrl),
    });

    if (!response.ok) await this.throwUpstreamError(response);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("json")) {
      throw new AppError(
        "UPSTREAM_SCHEMA_CHANGED",
        "LinkedIn returned a non-JSON profile response; the captured operation may have changed.",
      );
    }

    try {
      return await response.json();
    } catch {
      throw new AppError("UPSTREAM_SCHEMA_CHANGED", "LinkedIn returned malformed JSON.");
    }
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
      throw new AppError(
        "SESSION_NOT_CONFIGURED",
        "LinkedIn session secrets are not configured. Set LINKEDIN_LI_AT and LINKEDIN_JSESSION_ID.",
      );
    }
    const jsessionId = normalizeJsession(rawJsessionId);
    return {
      accept: "application/vnd.linkedin.normalized+json+2.1",
      "accept-language": "en-US,en;q=0.9",
      cookie: `li_at=${liAt}; JSESSIONID=\"${jsessionId}\"`,
      "csrf-token": jsessionId,
      referer,
      "user-agent": this.config.LINKEDIN_USER_AGENT,
      "x-restli-protocol-version": "2.0.0",
    };
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

  private async throwUpstreamError(response: Response): Promise<never> {
    if ([301, 302, 303, 307, 308, 401].includes(response.status)) {
      this.sessionHealthyUntil = 0;
      throw new AppError("SESSION_REAUTH_REQUIRED", "LinkedIn session is expired or redirected to authentication.");
    }
    if (response.status === 403) {
      this.sessionHealthyUntil = 0;
      throw new AppError("PROFILE_NOT_VISIBLE", "The configured account cannot access this LinkedIn resource.");
    }
    if (response.status === 404) {
      throw new AppError("PROFILE_NOT_FOUND", "LinkedIn profile was not found.");
    }
    if (response.status === 429 || response.status === 999) {
      throw new AppError("UPSTREAM_RATE_LIMITED", "LinkedIn is rate limiting or restricting the configured session.", true);
    }
    if (response.status === 400 || response.status === 410) {
      throw new AppError(
        "UPSTREAM_SCHEMA_CHANGED",
        "LinkedIn rejected the captured profile operation. Refresh the operation ID.",
      );
    }
    throw new AppError("UPSTREAM_UNAVAILABLE", `LinkedIn returned HTTP ${response.status}.`, response.status >= 500);
  }
}
