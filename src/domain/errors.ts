export type ErrorCode =
  | "INVALID_PROFILE_URL"
  | "UNAUTHORIZED"
  | "API_RATE_LIMITED"
  | "SESSION_NOT_CONFIGURED"
  | "SESSION_REAUTH_REQUIRED"
  | "PROFILE_NOT_FOUND"
  | "PROFILE_NOT_VISIBLE"
  | "UPSTREAM_RATE_LIMITED"
  | "UPSTREAM_SCHEMA_CHANGED"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_UNAVAILABLE"
  | "INTERNAL_ERROR";

const statusByCode: Record<ErrorCode, number> = {
  INVALID_PROFILE_URL: 400,
  UNAUTHORIZED: 401,
  API_RATE_LIMITED: 429,
  SESSION_NOT_CONFIGURED: 503,
  SESSION_REAUTH_REQUIRED: 503,
  PROFILE_NOT_FOUND: 404,
  PROFILE_NOT_VISIBLE: 403,
  UPSTREAM_RATE_LIMITED: 503,
  UPSTREAM_SCHEMA_CHANGED: 502,
  UPSTREAM_TIMEOUT: 504,
  UPSTREAM_UNAVAILABLE: 502,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly statusCode: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly retryable = false,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusByCode[code];
  }
}
