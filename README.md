# LinkedIn Profile API

A hosted, browserless API that accepts a LinkedIn `/in/` profile URL and returns the information visible to a configured LinkedIn account as structured JSON.

The service reverse-engineers and directly calls LinkedIn's web endpoints. It does **not** use a browser at runtime, the official partner API, PhantomBuster, an enrichment provider, or another scraping API.

## Architecture

```text
Client -> Fastify API -> strict URL validation -> API key/rate limit -> TTL cache
       -> single-flight, one-at-a-time upstream gate -> direct Voyager HTTP client
       -> normalized entity parser -> versioned JSON response
```

Repeated requests are served from cache. Concurrent misses are serialized globally, while identical requests share one in-flight extraction. Authentication redirects, rate restrictions, and schema drift produce typed errors instead of retry storms or empty success responses.

## Quick start

Requirements: Node.js 22+.

```bash
npm ci
cp .env.example .env
```

Add session secrets to `.env`, then:

```bash
npm run validate
npm run smoke -- https://www.linkedin.com/in/example/
npm run dev
```

Open `http://localhost:3000/docs` for interactive OpenAPI documentation.

## LinkedIn session setup

Use an account you own. Manually obtain the `li_at` and `JSESSIONID` cookie values from the signed-in LinkedIn site using your browser's developer tools. Put only their values in local/deployment secrets:

```env
LINKEDIN_LI_AT=<secret>
LINKEDIN_JSESSION_ID=<secret, quoted or unquoted>
LINKEDIN_USER_AGENT=<the stable user agent used for the session>
```

Email and password are neither needed nor accepted. The application never automates login, MFA, CAPTCHA, checkpoints, or cookie extraction. Never paste cookies into source code, issue trackers, copied cURL commands, screenshots, or public logs.

## API usage

```bash
curl --request POST 'http://localhost:3000/v1/profiles/extract' \
  --header 'Content-Type: application/json' \
  --header 'X-API-Key: your-reviewer-key' \
  --data '{"profile_url":"https://www.linkedin.com/in/example/"}'
```

See [docs/API_REFERENCE.md](docs/API_REFERENCE.md) for the complete contract and errors.

## Configuration

| Variable | Required | Default | Purpose |
|---|---:|---|---|
| `API_KEY` | Production | — | Protects `/v1/*`. |
| `LINKEDIN_LI_AT` | Extraction | — | Authenticated session cookie. |
| `LINKEDIN_JSESSION_ID` | Extraction | — | Session/CSRF cookie. |
| `LINKEDIN_USER_AGENT` | Yes | `Mozilla/5.0` | Stable request identity. |
| `LINKEDIN_PROFILE_QUERY_ID` | Yes | Captured operation | Versioned profile GraphQL operation. |
| `LINKEDIN_PROFILE_VARIABLE_NAME` | Yes | `vanityName` | Captured operation variable name. |
| `LINKEDIN_TIMEOUT_MS` | No | `15000` | Upstream timeout. |
| `LINKEDIN_MAX_RETRIES` | No | `1` | Network-error retries only; never retries HTTP restrictions. |
| `CACHE_TTL_SECONDS` | No | `86400` | Cache lifetime. |
| `SESSION_HEALTH_TTL_SECONDS` | No | `300` | `/voyager/api/me` health-check cache. |
| `RATE_LIMIT_MAX` | No | `20` | Requests per key/IP/window. |

## Deployment

Build and run the supplied non-root multi-stage Docker image:

```bash
docker build -t linkedin-profile-api .
docker run --rm -p 3000:3000 \
  -e API_KEY \
  -e LINKEDIN_LI_AT \
  -e LINKEDIN_JSESSION_ID \
  -e LINKEDIN_USER_AGENT \
  linkedin-profile-api
```

Deploy the image on any HTTPS container host. `render.yaml` is included as an optional one-click blueprint; all secrets are marked `sync: false`. Keep one replica so the global upstream concurrency limit remains authoritative. For multi-replica production, replace the in-memory cache/gate with a shared Redis implementation.

## Verification

```bash
npm run validate
npm audit --audit-level=moderate
```

Tests cover URL/SSRF boundaries, normalized response parsing, request authentication contract, redirect/session-expiry classification, API-key enforcement, output contract, and cache behavior. A real upstream smoke test is intentionally separate because it requires private session secrets.

## Known limitations

- LinkedIn does not provide this arbitrary-profile/full-profile capability through its public developer API.
- Output is limited to what the configured account can view; privacy and relationship settings matter.
- LinkedIn can expire or restrict the account/session at any time.
- Private operation IDs and response structures can change. The service reports drift explicitly; see [docs/REVERSE_ENGINEERING.md](docs/REVERSE_ENGINEERING.md).
- Some accounts currently receive a newer SDUI/RSC web rollout. The captured Voyager endpoint may remain callable, but this must be proven with the configured session's smoke test.
- Cache and concurrency state are process-local in this submission build.
- Automated access may violate LinkedIn's terms and may cause account restriction. There is no guaranteed safe request volume.

## Security choices

- Exact-host `/in/{slug}` validation blocks arbitrary SSRF targets.
- Redirects are not followed, preventing silent login-page parsing.
- Request bodies are capped at 16 KiB.
- Cookies, CSRF and API-key headers are redacted from logs.
- API key and per-IP limits protect the shared backend LinkedIn session.
- Upstream concurrency is one and repeated URLs are cached/deduplicated.
- Runtime image is non-root and contains production dependencies only.
- Secrets never appear in the repository or image build context.

## Responsible use

Use only where you have a lawful basis and authorization to process the returned profile data. Respect member privacy, retention requirements, and applicable platform terms. Do not use this project to bypass access controls, checkpoints, rate restrictions, or account protections.
