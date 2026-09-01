import { randomBytes } from "node:crypto";
import type { AppConfig } from "../config/env.js";
import { AppError } from "../domain/errors.js";
import { curlCffiFetch } from "./curl-cffi-fetch.js";
import { curlFetch } from "./curl-fetch.js";
import { LinkedInSessionStore } from "./session-store.js";

export interface LinkedInTransport {
  hasSession(): boolean;
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

const profileCardComponents = [
  "profileCardsAboveActivity",
  "profileCardsExperienceOnly",
  "profileCardsBelowActivityPart1",
  "profileCardsBelowActivityPart2",
] as const;
const componentActionUrl = "https://www.linkedin.com/flagship-web/rsc-action/actions/component";

export class LinkedInRscClient implements LinkedInTransport {
  private sessionHealthyUntil = 0;
  private sessionFailure: { until: number; error: AppError } | undefined;
  private extractionQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly config: AppConfig,
    private readonly session: LinkedInSessionStore,
    private readonly fetcher?: FetchLike,
  ) {}

  hasSession(): boolean {
    return this.session.hasSession();
  }

  async checkSession(force = false): Promise<void> {
    this.assertConfigured();
    if (!force && this.sessionFailure && this.sessionFailure.until > Date.now()) {
      throw this.sessionFailure.error;
    }
    if (!force && this.sessionHealthyUntil > Date.now()) return;

    try {
      const response = await this.request("https://www.linkedin.com/voyager/api/me", {
        method: "GET",
        headers: this.sessionHeaders(),
      });
      if (!response.ok) await this.throwUpstreamError(response, "session");

      const body = await response.text();
      if (this.looksLikeAuthentication(body)) {
        throw new AppError("SESSION_REAUTH_REQUIRED", "LinkedIn returned an authentication or authwall page.");
      }
      this.sessionFailure = undefined;
      this.sessionHealthyUntil = Date.now() + this.config.SESSION_HEALTH_TTL_SECONDS * 1_000;
    } catch (error) {
      if (error instanceof AppError && error.code === "SESSION_REAUTH_REQUIRED") {
        this.rememberSessionFailure(error);
      }
      throw error;
    }
  }

  async fetchProfile(publicIdentifier: string): Promise<RscProfilePayload> {
    this.assertConfigured();
    if (this.sessionFailure && this.sessionFailure.until > Date.now()) throw this.sessionFailure.error;
    const previous = this.extractionQueue;
    let release = (): void => undefined;
    this.extractionQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await this.fetchRscProfile(publicIdentifier);
    } finally {
      release();
    }
  }

  private async fetchRscProfile(publicIdentifier: string): Promise<RscProfilePayload> {
    const referer = `https://www.linkedin.com/in/${publicIdentifier}/`;
    const documents: RscDocument[] = [];
    const pageResponse = await this.request(referer, {
      method: "GET",
      headers: this.headers("https://www.linkedin.com/feed/"),
    });
    if (pageResponse.ok) {
      const body = await pageResponse.text();
      if (body.length > 0 && !this.looksLikeAuthentication(body)) {
        await this.session.absorb(pageResponse);
        documents.push({
          section: "profile",
          url: referer,
          contentType: pageResponse.headers.get("content-type") ?? "",
          body,
        });
      }
    } else if (pageResponse.status === 429 || pageResponse.status === 999) {
      await this.throwUpstreamError(pageResponse, "profile");
    }

    for (const name of profileCardComponents) {
      if (!this.fetcher) await this.waitBeforeUpstreamRequest();
      const component = `com.linkedin.sdui.generated.profile.dsl.impl.${name}`;
      const url = new URL(componentActionUrl);
      url.searchParams.set("componentId", component);
      url.searchParams.set("sduiid", component);
      url.searchParams.set("parentSpanId", this.config.LINKEDIN_PARENT_SPAN_ID ?? randomBytes(8).toString("base64"));

      const response = await this.request(url.toString(), {
        method: "POST",
        headers: this.componentHeaders(referer),
        body: JSON.stringify({
          clientArguments: {
            payload: { isSelfView: false, vanityName: publicIdentifier },
            states: [],
            requestMetadata: { $type: "proto.sdui.common.RequestMetadata" },
            screenId: "com.linkedin.sdui.flagshipnav.home.Home",
            knownTemplateIds: [],
          },
        }),
      });
      if (!response.ok) await this.throwUpstreamError(response, "profile");
      const body = await response.text();
      if (body.length === 0 || this.looksLikeAuthentication(body)) {
        const error = new AppError("SESSION_REAUTH_REQUIRED", "LinkedIn redirected profile extraction to authentication.");
        this.rememberSessionFailure(error);
        throw error;
      }
      await this.session.absorb(response);
      documents.push({
        section: name,
        url: url.toString(),
        contentType: response.headers.get("content-type") ?? "",
        body,
      });
    }
    this.sessionFailure = undefined;
    this.sessionHealthyUntil = Date.now() + this.config.SESSION_HEALTH_TTL_SECONDS * 1_000;
    return { transport: "linkedin-rsc", documents };
  }

  private assertConfigured(): void {
    if (!this.session.hasSession()) {
      throw new AppError(
        "SESSION_NOT_CONFIGURED",
        "LinkedIn session is not configured. Seed li_at and JSESSIONID through environment secrets.",
      );
    }
  }

  private headers(referer: string): HeadersInit {
    if (!this.session.hasSession()) {
      throw new AppError("SESSION_NOT_CONFIGURED", "LinkedIn session secrets are not configured.");
    }
    return {
      accept: "text/html,application/xhtml+xml,application/sdui+json;q=0.9,text/x-component;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      cookie: this.session.cookieHeader(),
      "csrf-token": this.session.csrfToken(),
      referer,
      "user-agent": this.config.LINKEDIN_USER_AGENT,
      "x-li-initial-url": referer,
      "x-li-rsc-stream": "true",
    };
  }

  private sessionHeaders(): HeadersInit {
    const headers = new Headers(this.headers("https://www.linkedin.com/feed/"));
    headers.set("accept", "application/vnd.linkedin.normalized+json+2.1");
    headers.set("x-restli-protocol-version", "2.0.0");
    headers.delete("referer");
    headers.delete("x-li-initial-url");
    headers.delete("x-li-rsc-stream");
    return headers;
  }

  private componentHeaders(referer: string): HeadersInit {
    const headers = new Headers(this.headers(referer));
    const pageTrackingId = this.config.LINKEDIN_PAGE_TRACKING_ID ?? randomBytes(16).toString("base64");
    headers.set("accept", "*/*");
    headers.set("accept-language", "en-US,en-IN;q=0.9,en;q=0.8");
    headers.set("content-type", "application/json");
    headers.set("dnt", "1");
    headers.set("origin", "https://www.linkedin.com");
    headers.set("priority", "u=1, i");
    if (!this.config.LINKEDIN_USER_AGENT.includes("Firefox/")) {
      headers.set("sec-ch-ua", "\"Chromium\";v=\"152\", \"Not?A_Brand\";v=\"24\", \"Google Chrome\";v=\"152\"");
      headers.set("sec-ch-ua-mobile", "?0");
      headers.set("sec-ch-ua-platform", "\"macOS\"");
    }
    headers.set("sec-fetch-dest", "empty");
    headers.set("sec-fetch-mode", "cors");
    headers.set("sec-fetch-site", "same-origin");
    headers.delete("x-li-initial-url");
    headers.set("x-li-anchor-page-key", this.config.LINKEDIN_ANCHOR_PAGE_KEY);
    if (this.config.LINKEDIN_APPLICATION_INSTANCE) {
      headers.set("x-li-application-instance", this.config.LINKEDIN_APPLICATION_INSTANCE);
    }
    headers.set("x-li-application-version", this.config.LINKEDIN_APPLICATION_VERSION);
    headers.set(
      "x-li-page-instance",
      this.config.LINKEDIN_PAGE_INSTANCE ?? `urn:li:page:${this.config.LINKEDIN_ANCHOR_PAGE_KEY};${pageTrackingId}`,
    );
    headers.set("x-li-page-instance-tracking-id", pageTrackingId);
    headers.set("x-li-rsc-stream", "true");
    headers.set("x-li-track", JSON.stringify({
      clientVersion: this.config.LINKEDIN_APPLICATION_VERSION,
      mpVersion: this.config.LINKEDIN_APPLICATION_VERSION,
      osName: "web",
      timezoneOffset: 5.5,
      timezone: "Asia/Kolkata",
      deviceFormFactor: "DESKTOP",
      mpName: "web",
      displayDensity: 2,
      displayWidth: 2940,
      displayHeight: 1912,
    }));
    return headers;
  }

  private looksLikeAuthentication(body: string): boolean {
    const prefix = body.slice(0, 100_000).toLowerCase();
    return prefix.includes("/uas/login")
      || prefix.includes("authwall")
      || prefix.includes("sign in | linkedin")
      || prefix.includes("checkpoint/challenge");
  }

  private rememberSessionFailure(error: AppError): void {
    this.sessionHealthyUntil = 0;
    this.sessionFailure = {
      error,
      until: Date.now() + this.config.SESSION_FAILURE_TTL_SECONDS * 1_000,
    };
  }

  private async waitBeforeUpstreamRequest(): Promise<void> {
    const minimum = this.config.LINKEDIN_MIN_DELAY_MS;
    const range = this.config.LINKEDIN_MAX_DELAY_MS - minimum;
    const delay = minimum + Math.floor(Math.random() * (range + 1));
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.config.LINKEDIN_MAX_RETRIES; attempt += 1) {
      try {
        const requestInit = {
          ...init,
          redirect: "manual" as const,
          signal: AbortSignal.timeout(this.config.LINKEDIN_TIMEOUT_MS),
        };
        let response: Response;
        if (this.fetcher) {
          response = await this.fetcher(url, requestInit);
        } else if (this.config.LINKEDIN_HTTP_TRANSPORT === "curl_cffi") {
          response = await curlCffiFetch(url, requestInit, this.config.LINKEDIN_TIMEOUT_MS, {
            pythonBin: this.config.LINKEDIN_PYTHON_BIN,
            proxyUrl: this.config.LINKEDIN_PROXY_URL,
            impersonate: this.config.LINKEDIN_TLS_IMPERSONATE,
          });
        } else if (this.config.LINKEDIN_HTTP_TRANSPORT === "curl") {
          response = await curlFetch(
            url,
            requestInit,
            this.config.LINKEDIN_TIMEOUT_MS,
            this.config.LINKEDIN_PROXY_URL,
          );
        } else {
          response = await fetch(url, requestInit);
        }
        return response;
      } catch (error) {
        lastError = error;
        if (attempt >= this.config.LINKEDIN_MAX_RETRIES) break;
      }
    }
    if (lastError instanceof DOMException && lastError.name === "TimeoutError") {
      throw new AppError("UPSTREAM_TIMEOUT", "LinkedIn did not respond before the timeout.", true);
    }
    const reason = lastError instanceof Error ? lastError.message : String(lastError);
    const redactedReason = this.config.LINKEDIN_PROXY_URL
      ? reason.replaceAll(this.config.LINKEDIN_PROXY_URL, "[redacted proxy]")
      : reason;
    throw new AppError("UPSTREAM_UNAVAILABLE", "Could not reach LinkedIn.", true, {
      transport: this.config.LINKEDIN_HTTP_TRANSPORT,
      reason: redactedReason.slice(0, 1_000),
    });
  }

  private async throwUpstreamError(response: Response, context: "session" | "profile" | "section"): Promise<never> {
    if ([301, 302, 303, 307, 308, 401].includes(response.status)) {
      const error = new AppError(
        "SESSION_REAUTH_REQUIRED",
        "LinkedIn session is expired or redirected to authentication.",
        false,
        { upstreamStatus: response.status, context },
      );
      this.rememberSessionFailure(error);
      throw error;
    }
    if (response.status === 403) {
      if (context === "session") {
        const error = new AppError(
          "SESSION_REAUTH_REQUIRED",
          "LinkedIn rejected the configured session.",
          false,
          { upstreamStatus: response.status, context },
        );
        this.rememberSessionFailure(error);
        throw error;
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
