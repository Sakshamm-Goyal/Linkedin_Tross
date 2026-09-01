import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { AppConfig } from "../config/env.js";
import { AppError } from "../domain/errors.js";
import type { ExtractionService } from "../linkedin/extraction-service.js";
import type { LinkedInTransport } from "../linkedin/rsc-client.js";
import { errorSchema, extractionBodySchema, extractionResponseSchema } from "./schemas.js";
import { testConsoleHtml } from "../ui/test-console.js";

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

  app.get("/", async (_request, reply) => reply.type("text/html; charset=utf-8").send(testConsoleHtml));

  app.get("/health", async () => ({ status: "ok" }));
  app.get("/ready", async (_request, reply) => {
    if (!transport.hasSession()) return reply.code(503).send({ status: "not_ready", reason: "session_not_configured" });
    return { status: "ready", mode: "session_configured" };
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
