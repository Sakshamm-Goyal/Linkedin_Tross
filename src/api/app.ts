import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { AppConfig } from "../config/env.js";
import { hasLinkedInSession } from "../config/env.js";
import { AppError } from "../domain/errors.js";
import type { ExtractionService } from "../linkedin/extraction-service.js";
import type { LinkedInTransport } from "../linkedin/rsc-client.js";
import { errorSchema, extractionBodySchema, extractionResponseSchema } from "./schemas.js";

interface ExtractionBody {
  profile_url: string;
  refresh?: boolean;
}

export interface AppDependencies {
  config: AppConfig;
  extractionService: ExtractionService;
  transport: LinkedInTransport;
}

export async function buildApp(dependencies: AppDependencies): Promise<FastifyInstance> {
  const { config, extractionService, transport } = dependencies;
  const app = Fastify({
    logger: {
      level: config.NODE_ENV === "production" ? "info" : "debug",
      redact: {
        paths: [
          "req.headers.cookie",
          "req.headers.authorization",
          "req.headers.x-api-key",
          "headers.cookie",
          "headers.csrf-token",
          "LINKEDIN_LI_AT",
          "LINKEDIN_JSESSION_ID",
        ],
        censor: "[REDACTED]",
      },
    },
    bodyLimit: 16 * 1024,
    trustProxy: true,
    requestTimeout: config.LINKEDIN_TIMEOUT_MS + 5_000,
  });

  await app.register(cors, { origin: false });
  await app.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW,
    keyGenerator: (request) => `${request.ip}:${request.headers["x-api-key"] ?? "anonymous"}`,
  });
  await app.register(swagger, {
    openapi: {
      info: {
        title: "LinkedIn Profile API",
        version: "1.0.0",
        description: "Browserless direct-HTTP extraction of profile fields visible to a configured LinkedIn account.",
      },
      components: {
        securitySchemes: { ApiKeyAuth: { type: "apiKey", in: "header", name: "X-API-Key" } },
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  app.addHook("onRequest", async (request) => {
    if (!request.url.startsWith("/v1/")) return;
    if (!config.API_KEY) {
      if (config.NODE_ENV === "production") throw new AppError("UNAUTHORIZED", "API key is not configured on the server.");
      return;
    }
    if (request.headers["x-api-key"] !== config.API_KEY) {
      throw new AppError("UNAUTHORIZED", "A valid X-API-Key header is required.");
    }
  });

  app.get("/", async (_request, reply) => reply.type("text/html; charset=utf-8").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LinkedIn Profile API</title><style>body{font:16px/1.55 system-ui;max-width:760px;margin:10vh auto;padding:24px;color:#182230}code{background:#eef2f6;padding:.15rem .4rem;border-radius:4px}a{color:#0a66c2}</style></head>
<body><h1>LinkedIn Profile API</h1><p>Browserless direct-HTTP profile extraction service.</p><p><a href="/docs">Interactive API documentation</a> · <a href="/health">Health</a></p><p>Send <code>POST /v1/profiles/extract</code> with a LinkedIn <code>/in/</code> URL.</p></body></html>`));

  app.get("/health", async () => ({ status: "ok" }));
  app.get("/ready", async (_request, reply) => {
    if (!hasLinkedInSession(config)) return reply.code(503).send({ status: "not_ready", reason: "session_not_configured" });
    try {
      await transport.checkSession();
      return { status: "ready" };
    } catch (error) {
      const code = error instanceof AppError ? error.code : "UPSTREAM_UNAVAILABLE";
      return reply.code(503).send({ status: "not_ready", reason: code });
    }
  });

  app.post<{ Body: ExtractionBody }>("/v1/profiles/extract", {
    schema: {
      tags: ["profiles"],
      summary: "Extract a LinkedIn profile",
      security: [{ ApiKeyAuth: [] }],
      body: extractionBodySchema,
      response: { 200: extractionResponseSchema, 400: errorSchema, 401: errorSchema, 403: errorSchema, 404: errorSchema, 429: errorSchema, 500: errorSchema, 502: errorSchema, 503: errorSchema, 504: errorSchema },
    },
  }, async (request) => extractionService.extract(request.body.profile_url, request.body.refresh ?? false));

  app.setErrorHandler((error, request, reply) => {
    const errorMessage = error instanceof Error ? error.message : "Unknown request failure.";
    const frameworkError = error as { statusCode?: number; validation?: unknown };
    const appError = error instanceof AppError
      ? error
      : frameworkError.validation
        ? new AppError("INVALID_PROFILE_URL", "Request body failed validation.")
        : frameworkError.statusCode === 429
          ? new AppError("API_RATE_LIMITED", "API request limit exceeded.", true)
          : new AppError("INTERNAL_ERROR", config.NODE_ENV === "production" ? "Request failed." : errorMessage);
    request.log.warn({ err: appError, code: appError.code }, "request failed");
    void reply.code(appError.statusCode).send({
      status: "error",
      error: { code: appError.code, message: appError.message, retryable: appError.retryable },
      request_id: request.id,
    });
  });

  return app;
}
