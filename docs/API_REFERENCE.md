# API reference

Base URL: `https://<deployment-host>`

Interactive OpenAPI documentation is served at `/docs`. Every `/v1/*` route requires the `X-API-Key` header when `API_KEY` is configured.

## `POST /v1/profiles/extract`

Extracts profile information visible to the configured backend LinkedIn account.

### Request

```http
POST /v1/profiles/extract HTTP/1.1
Content-Type: application/json
X-API-Key: <reviewer-key>

{
  "profile_url": "https://www.linkedin.com/in/example/",
  "refresh": false
}
```

`profile_url` must be an HTTPS `linkedin.com/in/{slug}` URL. Tracking parameters are discarded. `refresh` bypasses the local cache and should normally remain `false`.

### Success

```json
{
  "status": "success",
  "data": {
    "profile_url": "https://www.linkedin.com/in/example/",
    "public_identifier": "example",
    "linkedin_id": "urn:li:fsd_profile:...",
    "name": { "first": "Example", "last": "Person", "full": "Example Person" },
    "headline": "Software Engineer",
    "location": "Bengaluru, India",
    "about": null,
    "profile_images": { "avatar_url": null, "background_url": null },
    "experience": [],
    "education": [],
    "skills": [],
    "certifications": [],
    "languages": []
  },
  "meta": {
    "fetched_at": "2026-08-31T00:00:00.000Z",
    "cached": false,
    "completeness": "partial",
    "unavailable_sections": ["about", "skills"],
    "parser_version": "2026-08-31.1",
    "warnings": ["Only information visible to the configured LinkedIn account is returned."]
  }
}
```

An empty section is not claimed to be absent from the member's profile. It is listed in `meta.unavailable_sections` because the configured account, captured operation, or upstream response may not expose it.

### Errors

```json
{
  "status": "error",
  "error": {
    "code": "SESSION_REAUTH_REQUIRED",
    "message": "LinkedIn session is expired or redirected to authentication.",
    "retryable": false
  },
  "request_id": "req-1"
}
```

| HTTP | Code | Meaning |
|---:|---|---|
| 400 | `INVALID_PROFILE_URL` | Input is not an allowed `/in/` profile URL. |
| 401 | `UNAUTHORIZED` | API key is missing or invalid. |
| 429 | `API_RATE_LIMITED` | Public API request limit exceeded. |
| 403 | `PROFILE_NOT_VISIBLE` | The backend LinkedIn account cannot view the resource. |
| 404 | `PROFILE_NOT_FOUND` | Profile does not exist or is unavailable. |
| 502 | `UPSTREAM_SCHEMA_CHANGED` | Captured operation or response schema changed. |
| 502 | `UPSTREAM_UNAVAILABLE` | LinkedIn returned an unclassified upstream failure. |
| 503 | `SESSION_NOT_CONFIGURED` | Session cookies were not configured. |
| 503 | `SESSION_REAUTH_REQUIRED` | Session expired or entered an authentication flow. |
| 503 | `UPSTREAM_RATE_LIMITED` | LinkedIn restricted the session/request. |
| 504 | `UPSTREAM_TIMEOUT` | Upstream timeout. |
| 500 | `INTERNAL_ERROR` | Unclassified internal failure. |

## `GET /health`

Process liveness only. It never calls LinkedIn.

```json
{ "status": "ok" }
```

## `GET /ready`

Verifies that session secrets exist and checks the authenticated `/feed/` RSC session contract. Session health is cached to avoid an extra LinkedIn call before every extraction.
