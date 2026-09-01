# LinkedIn Profile API

A hosted, browserless API that accepts a LinkedIn `/in/` profile URL and returns the information visible to a configured LinkedIn account as structured JSON.

The service reverse-engineers and directly calls LinkedIn's web endpoints. It does **not** use a browser at runtime, the official partner API, PhantomBuster, an enrichment provider, or another scraping API.

## Architecture

```text
Client -> Fastify API -> strict URL validation -> API key/rate limit -> TTL cache
       -> single-flight, one-at-a-time upstream gate -> captured LinkedIn RSC components
       -> SDUI/React payload decoder -> normalized entity parser -> versioned JSON response
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

Open `http://localhost:3000/` for the built-in Profile Signal test console, or `http://localhost:3000/docs` for interactive OpenAPI documentation. The console sends requests only to this API and never exposes configured LinkedIn session secrets.

## LinkedIn session setup

Use an account you own. Manually obtain the `li_at` and `JSESSIONID` cookie values from the signed-in LinkedIn site using your browser's developer tools. Put only their values in local/deployment secrets:

```env
LINKEDIN_LI_AT=<secret>
LINKEDIN_JSESSION_ID=<secret, quoted or unquoted>
# Optional, preferred when LinkedIn requires the complete same-session cookie header.
LINKEDIN_COOKIE_HEADER=<complete Cookie header secret>
# Quote-safe alternative for long Cookie headers:
LINKEDIN_COOKIE_HEADER_BASE64=<base64-encoded complete Cookie header>
LINKEDIN_USER_AGENT=<the stable user agent used for the session>
# Recommended: encrypted cookie persistence across restarts.
LINKEDIN_SESSION_FILE=.data/linkedin-session.enc
LINKEDIN_SESSION_KEY=<output of: openssl rand -base64 32>
```

On first start, the environment cookies seed an encrypted cookie jar. Each LinkedIn response is then inspected for refreshed cookies, which are merged and atomically persisted with owner-only file permissions. Later starts can load the encrypted file even after the seed cookie environment variables are removed.

This keeps a recognized session alive; it cannot silently defeat a true logout, MFA, CAPTCHA, or checkpoint. When LinkedIn requires interaction, `/ready` returns `SESSION_REAUTH_REQUIRED`: sign in manually, replace the seed cookies, and restart once. Email, password, and TOTP secrets are deliberately neither needed nor accepted. Never paste cookies into source code, issue trackers, copied cURL commands, screenshots, or public logs.

### Internal operation

1. Keep one backend instance, one LinkedIn account, one sticky residential/ISP proxy, and the same user agent used when the cookies were captured.
2. Monitor `/ready`; alert on `SESSION_REAUTH_REQUIRED` instead of retrying profile requests. The server also caches authentication failure briefly to suppress retry storms.
3. Replace the full cookie header after a genuine logout, then restart the process. The new values overwrite the encrypted jar and subsequent response-cookie updates persist automatically.
4. Treat HTTP `429`/`999` as a stop signal. Do not increase retries or concurrency; cached successful responses remain the preferred path.

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
| `LINKEDIN_COOKIE_HEADER` | No | — | Complete same-session Cookie header when needed by the captured component action. |
| `LINKEDIN_COOKIE_PATCH_HEADER` | No | — | Same-session cookie overlay applied after the seed; useful for rotating routing/device cookies. |
| `LINKEDIN_COOKIE_HEADER_BASE64` | No | — | Preferred quote-safe form of the complete Cookie header; takes precedence over the plain value. |
| `LINKEDIN_BROWSER_COOKIE_HEADER_BASE64` | No | — | Latest browser-visible cookie snapshot; highest-precedence session seed. |
| `LINKEDIN_LI_AT` | Extraction | — | Authenticated session cookie. |
| `LINKEDIN_JSESSION_ID` | Extraction | — | Session/CSRF cookie. |
| `LINKEDIN_SESSION_FILE` | No | — | Durable encrypted cookie-jar path; configure together with `LINKEDIN_SESSION_KEY`. |
| `LINKEDIN_SESSION_KEY` | No | — | Secret used to encrypt the durable cookie jar. |
| `LINKEDIN_USER_AGENT` | Yes | `Mozilla/5.0` | Stable request identity. |
| `LINKEDIN_HTTP_TRANSPORT` | No | `curl_cffi` | Recommended Chrome TLS/HTTP2 impersonation; `curl` and `fetch` are diagnostic fallbacks. |
| `LINKEDIN_PROXY_URL` | Production | — | Sticky residential/ISP proxy URL dedicated to this session. |
| `LINKEDIN_TLS_IMPERSONATE` | No | `chrome` | Browser fingerprint used by `curl_cffi`. |
| `LINKEDIN_PYTHON_BIN` | No | `python3` | Python executable containing `curl_cffi`; Docker configures this automatically. |
| `LINKEDIN_ANCHOR_PAGE_KEY` | No | `d_flagship3_profile_view_base` | Current profile page key captured with the RSC contract. |
| `LINKEDIN_APPLICATION_VERSION` | No | `0.2.7003` | Captured mobile-web application version sent to RSC. |
| `LINKEDIN_TIMEOUT_MS` | No | `15000` | Upstream timeout. |
| `LINKEDIN_MAX_RETRIES` | No | `1` | Network-error retries only; never retries HTTP restrictions. |
| `LINKEDIN_MIN_DELAY_MS` | No | `250` | Minimum randomized pause between LinkedIn component requests. |
| `LINKEDIN_MAX_DELAY_MS` | No | `900` | Maximum randomized pause between LinkedIn component requests. |
| `CACHE_TTL_SECONDS` | No | `86400` | Cache lifetime. |
| `SESSION_HEALTH_TTL_SECONDS` | No | `300` | Authenticated session health-check cache. |
| `SESSION_FAILURE_TTL_SECONDS` | No | `60` | Cooldown after authentication rejection to prevent retry storms. |
| `RATE_LIMIT_MAX` | No | `20` | Requests per key/IP/window. |

## Deployment

Build and run the supplied non-root multi-stage Docker image:

```bash
docker build -t linkedin-profile-api .
docker run --rm -p 3000:3000 \
  -e API_KEY \
  -e LINKEDIN_LI_AT \
  -e LINKEDIN_JSESSION_ID \
  -e LINKEDIN_SESSION_FILE=/var/data/linkedin-session.enc \
  -e LINKEDIN_SESSION_KEY \
  -e LINKEDIN_USER_AGENT \
  -e LINKEDIN_PROXY_URL \
  -v linkedin-session:/var/data \
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
- Private RSC component and response structures can change. The service reports drift explicitly; see [docs/REVERSE_ENGINEERING.md](docs/REVERSE_ENGINEERING.md).
- The client requests the current mobile-web profile component set observed from LinkedIn's own page.
- The captured profile-card component currently provides reliable top-card fields. Other sections remain explicitly unavailable until their state-dependent lazy component chain is captured and versioned.
- Cache and concurrency state are process-local in this submission build.
- Cookie refresh persists only when `LINKEDIN_SESSION_FILE` points to durable storage.
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
