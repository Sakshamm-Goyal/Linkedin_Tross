import { z } from "zod";

const optionalSecret = z.string().trim().optional().transform((value) => value || undefined);
const optionalEncryptionKey = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().min(32).optional(),
);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  API_KEY: optionalSecret,
  LINKEDIN_BROWSER_COOKIE_HEADER_BASE64: optionalSecret,
  LINKEDIN_COOKIE_HEADER_BASE64: optionalSecret,
  LINKEDIN_COOKIE_HEADER: optionalSecret,
  LINKEDIN_COOKIE_PATCH_HEADER: optionalSecret,
  LINKEDIN_LI_AT: optionalSecret,
  LINKEDIN_JSESSION_ID: optionalSecret,
  LINKEDIN_SESSION_FILE: optionalSecret,
  LINKEDIN_SESSION_KEY: optionalEncryptionKey,
  LINKEDIN_USER_AGENT: z.string().min(1).default("Mozilla/5.0"),
  LINKEDIN_HTTP_TRANSPORT: z.enum(["curl_cffi", "curl", "fetch"]).default("curl_cffi"),
  LINKEDIN_PROXY_URL: optionalSecret,
  LINKEDIN_TLS_IMPERSONATE: z.string().min(1).default("chrome"),
  LINKEDIN_PYTHON_BIN: z.string().min(1).default("python3"),
  LINKEDIN_APPLICATION_VERSION: z.string().min(1).default("0.2.7003"),
  LINKEDIN_ANCHOR_PAGE_KEY: z.string().min(1).default("d_flagship3_profile_view_base"),
  LINKEDIN_APPLICATION_INSTANCE: optionalSecret,
  LINKEDIN_PARENT_SPAN_ID: optionalSecret,
  LINKEDIN_PAGE_INSTANCE: optionalSecret,
  LINKEDIN_PAGE_TRACKING_ID: optionalSecret,
  LINKEDIN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(15_000),
  LINKEDIN_MAX_RETRIES: z.coerce.number().int().min(0).max(2).default(1),
  LINKEDIN_MIN_DELAY_MS: z.coerce.number().int().min(0).max(10_000).default(250),
  LINKEDIN_MAX_DELAY_MS: z.coerce.number().int().min(0).max(30_000).default(900),
  CACHE_TTL_SECONDS: z.coerce.number().int().min(1).default(86_400),
  SESSION_HEALTH_TTL_SECONDS: z.coerce.number().int().min(1).default(300),
  SESSION_FAILURE_TTL_SECONDS: z.coerce.number().int().min(1).max(3_600).default(60),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(20),
  RATE_LIMIT_WINDOW: z.string().default("1 minute"),
}).superRefine((value, context) => {
  if (Boolean(value.LINKEDIN_SESSION_FILE) !== Boolean(value.LINKEDIN_SESSION_KEY)) {
    context.addIssue({
      code: "custom",
      path: ["LINKEDIN_SESSION_FILE"],
      message: "LINKEDIN_SESSION_FILE and LINKEDIN_SESSION_KEY must be configured together",
    });
  }
  if (value.LINKEDIN_MAX_DELAY_MS < value.LINKEDIN_MIN_DELAY_MS) {
    context.addIssue({
      code: "custom",
      path: ["LINKEDIN_MAX_DELAY_MS"],
      message: "LINKEDIN_MAX_DELAY_MS must be greater than or equal to LINKEDIN_MIN_DELAY_MS",
    });
  }
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return parsed.data;
}

export function hasLinkedInSession(config: AppConfig): boolean {
  return Boolean(config.LINKEDIN_LI_AT && config.LINKEDIN_JSESSION_ID);
}
