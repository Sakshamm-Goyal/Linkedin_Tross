import { buildApp } from "./api/app.js";
import { TtlCache } from "./cache/ttl-cache.js";
import { loadConfig } from "./config/env.js";
import type { ExtractionResult } from "./domain/profile.js";
import { ExtractionService } from "./linkedin/extraction-service.js";
import { LinkedInRscClient } from "./linkedin/rsc-client.js";
import { LinkedInSessionStore } from "./linkedin/session-store.js";

const config = loadConfig();
const session = await LinkedInSessionStore.create(config);
const transport = new LinkedInRscClient(config, session);
const cache = new TtlCache<ExtractionResult>(config.CACHE_TTL_SECONDS * 1_000);
const extractionService = new ExtractionService(transport, cache);
const app = await buildApp({ config, extractionService, transport });

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
