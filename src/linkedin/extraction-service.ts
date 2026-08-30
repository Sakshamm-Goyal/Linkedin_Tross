import type { ExtractionResult } from "../domain/profile.js";
import type { LinkedInTransport } from "./rsc-client.js";
import { TtlCache } from "../cache/ttl-cache.js";
import { canonicalizeProfileUrl } from "../security/profile-url.js";
import { parseRscProfile, PARSER_VERSION } from "./parser.js";
import { SingleFlight } from "./single-flight.js";

export class ExtractionService {
  private readonly gate = new SingleFlight();

  constructor(
    private readonly transport: LinkedInTransport,
    private readonly cache: TtlCache<ExtractionResult>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async extract(inputUrl: string, refresh = false): Promise<ExtractionResult> {
    const canonical = canonicalizeProfileUrl(inputUrl);
    if (!refresh) {
      const cached = this.cache.get(canonical.url);
      if (cached) return { ...cached, meta: { ...cached.meta, cached: true } };
    }

    return this.gate.run(canonical.url, async () => {
      if (!refresh) {
        const cached = this.cache.get(canonical.url);
        if (cached) return { ...cached, meta: { ...cached.meta, cached: true } };
      }
      const payload = await this.transport.fetchProfile(canonical.publicIdentifier);
      const parsed = parseRscProfile(payload, canonical.publicIdentifier);
      const result: ExtractionResult = {
        status: "success",
        data: parsed.profile,
        meta: {
          fetched_at: this.now().toISOString(),
          cached: false,
          completeness: parsed.unavailableSections.length === 0 ? "complete" : "partial",
          unavailable_sections: parsed.unavailableSections,
          parser_version: PARSER_VERSION,
          warnings: ["Only information visible to the configured LinkedIn account is returned."],
        },
      };
      this.cache.set(canonical.url, result);
      return result;
    });
  }
}
