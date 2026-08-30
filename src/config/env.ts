import { z } from "zod";

const optionalSecret = z.string().trim().optional().transform((value) => value || undefined);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  API_KEY: optionalSecret,
  LINKEDIN_LI_AT: optionalSecret,
  LINKEDIN_JSESSION_ID: optionalSecret,
  LINKEDIN_USER_AGENT: z.string().min(1).default("Mozilla/5.0"),
  LINKEDIN_PROFILE_QUERY_ID: z.string().min(1).default(
    "voyagerIdentityDashProfiles.b5c27c04968c409fc0ed3546575b9b7a",
  ),
  LINKEDIN_PROFILE_VARIABLE_NAME: z.enum(["vanityName", "publicIdentifier"]).default("vanityName"),
  LINKEDIN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(15_000),
  LINKEDIN_MAX_RETRIES: z.coerce.number().int().min(0).max(2).default(1),
  CACHE_TTL_SECONDS: z.coerce.number().int().min(1).default(86_400),
  SESSION_HEALTH_TTL_SECONDS: z.coerce.number().int().min(1).default(300),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(20),
  RATE_LIMIT_WINDOW: z.string().default("1 minute"),
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
