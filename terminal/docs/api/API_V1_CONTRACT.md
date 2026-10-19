# Public API v1 contract

Packet **T_F12_10 / B-F12-10**. Seat ruling 2026-09-13. This file is the F12 Public API v1 contract freeze for F00C row **MO-PAID-055**.

Acceptance: **an externally-keyed request returns a versioned authenticated response**.

Read ceiling: existing Terminal data. The one opt-in write adds a symbol to an owned watchlist. API reads return what you already see in the Terminal. Opt-in keys may add tickers to your watchlists. It originates no signals, rankings or advice.

接口读取你在终端里已有的内容。主动开启写入权限的密钥可向你的自选列表添加代码。它不产生信号、排名或建议。

---

## R1 — Scope

v1 = personal keys, read-only by default. A key acts as the user who minted it and can read ONLY what that user already sees in the Terminal: theses (heads + versions), watchlists, alerts (definitions + recent fires), accuracy claims, briefs, portfolio positions.

A new key can explicitly opt into `watchlists:write`, which permits only adding a symbol to an existing owned watchlist. Existing keys are not upgraded; no remove, list creation, team, claim, portfolio or trading write is exposed. No team/workspace keys. Printed null:

> Team keys aren't available yet — keys are personal for now.

> 团队密钥暂未开放，目前仅支持个人密钥。

No public-artifact proxying (the macro site already serves those publicly; do not re-serve them).

## R2 — Key lifecycle

Minted in the Terminal account settings **Developer access** section (settings rail, dark-only). Shown ONCE in full (`mmx_` + 40 url-safe random chars). Stored as a salted scrypt digest + random 16-byte salt + 8-char prefix + label + created_at + last_used_at + revoked_at. At most 5 active keys per user. Revoke is immediate. Rotation = mint new + revoke old (no in-place rotation).

The audit table shipped by B-F12-8 (`public.team_role_changes`) does not fit: it requires a `team_id` foreign key onto `public.teams` and records role changes. API keys are personal and have no team. Mint and revoke therefore write one row each to `public.api_key_events`, owned by the `api_keys` trigger — the closest existing audit owner, never a second audit plane.

## R3 — Authentication + RLS authority

`Authorization: Bearer mmx_…` on `https://<terminal-origin>/api/v1/...`.

The route resolves the salt through `api_key_salt_for_prefix`, derives the salted scrypt digest and authenticates through `api_key_authenticate(prefix, digest)`. Unknown or revoked keys fail closed; actual stored scopes and database-backed quota counts are returned. Read access uses `api_v1_read_as_user` with explicit owner predicates inside the service-only function. A service-role connection is not RLS impersonation: the explicit predicates are the ownership boundary.

The write function independently revalidates the key, scope and owned list in its transaction, including on replay. Public, anonymous and ordinary authenticated roles cannot execute that function or access its operation receipts. Caller-supplied user IDs never determine the write owner.

## R4 — Read response contract (write responses are specified in R10)

Success JSON:

```json
{
  "schema": "mm.api.v1.<resource>",
  "version": "2026-09-13",
  "schema_version": "1.1",
  "inference_metadata": {
    "mode": "projection_only",
    "generated_by_api": false,
    "source_schema": "mm.api.v1.<resource>",
    "evidence_scope": "application_record_state",
    "model_provenance": "unavailable",
    "evidence_fields": [],
    "assertion_fields": [],
    "unclassified_fields": ["/data"]
  },
  "asof": "<RFC-3339 server time>",
  "data": [],
  "page": { "next_cursor": null, "limit": 50 },
  "coverage": { "rows": 0, "nulls": [] }
}
```

Error JSON:

```json
{
  "error": {
    "code": "unauthorized|forbidden|not_found|rate_limited|invalid_request|idempotency_conflict|server_error|unavailable",
    "message": "<plain EN sentence>",
    "message_zh": "<real ZH>"
  }
}
```

with the matching HTTP status. Read responses support `ETag` + `If-None-Match` → 304. The ETag includes the entire envelope except its volatile response `asof`, including metadata and `schema_version`; legacy cached responses therefore invalidate. Cursor pagination (opaque cursor, limit ≤ 200, default 50). UTC RFC-3339 everywhere. Ids are the same UUIDs the Terminal UI uses. The existing forbidden-field guard rejects model-score/probability/rank fields; a person's `stated_probability` remains their own assertion. The API never originates signals.

### MO-DELTA-037 — record evidence and assertions

`schema_version: "1.1"` versions the read envelope separately from the retained API seat `version`. Both additions are additive: existing `data`, pagination and coverage consumers keep their fields. Successful GET read envelopes, including the index, carry metadata. Errors and the native OpenAPI document do not. R10 POST responses and their stored idempotency receipts are unchanged.

`inference_metadata` describes this API projection only. `generated_by_api: false` means this endpoint generated no inference; it does **not** mean that stored text has no model-assisted authorship. Upstream model provenance is `unavailable`. Metadata never copies source values or guesses authorship, confidence, truth or provenance from prose.

- `evidence_fields` identifies stored identity, lifecycle, timestamps, membership or application configuration. `evidence_scope: "application_record_state"` is evidence of the application's state, **not independently verified market facts**.
- `assertion_fields` identifies explicit thesis titles/statements/catalysts/falsifiers/risks/horizons and user claim text, resolution deadline and stated probability. These remain assertions even when a model helped write them.
- `unclassified_fields` identifies opaque payloads, labels, notes, claim evidence/resolution/conditions, unexpected types and unknown fields. User-provided position amounts are not promoted to verified holdings. Unknown schemas classify all `/data` as unclassified.

Lists contain RFC 6901 JSON Pointers rooted at `/data` (e.g. `/data/current/content/statement` or `/data/0/id`). Escape `~` as `~0` and `/` as `~1`. Every pointer addresses a present response value. Empty arrays/objects and null containers remain unclassified at their actual path; nullable scalar fields keep their category but a null never asserts an observed value. Missing/undefined fields generate no pointer. Opaque parents cover their subtree without classifying its children; evidence pointers never cover an assertion subtree. The schema mapping is structural and deterministic, with no model or text classification.

Example consumer: render assertions separately and label record evidence by scope; never interpret missing provenance as human-only authorship.

```js
const body = await response.json();
if (body.schema_version !== "1.1") throw new Error("Unsupported read envelope");
const at = (pointer) => pointer.slice(1).split("/").reduce(
  (value, key) => value[key.replace(/~1/g, "/").replace(/~0/g, "~")], body);
const assertions = body.inference_metadata.assertion_fields.map(at);
const recordState = body.inference_metadata.evidence_fields.map(at);
// Preserve nulls. Opaque values and unavailable provenance remain unclassified.
```

## R5 — Endpoints v1 (read-only GET)

| Path | Resource |
|---|---|
| `GET /api/v1` | Index: resources + schema versions + rate-limit policy |
| `GET /api/v1/me` | User id, key prefix, scopes |
| `GET /api/v1/theses` | Thesis heads (`ThesisSummary` in `terminal/lib/theses.ts`) |
| `GET /api/v1/theses/{id}` | One thesis (`ThesisDetail`) |
| `GET /api/v1/theses/{id}/versions` | Version history (`ThesisVersion[]`) |
| `GET /api/v1/watchlists` | Lists (`ServerWatchlist[]` in `terminal/lib/watchlists.ts`) |
| `GET /api/v1/watchlists/{id}` | One list |
| `GET /api/v1/alerts` | Alert definitions (same rows `/api/alerts` returns) |
| `GET /api/v1/alerts/{id}/fires` | Recent fires from `alert_outbox` |
| `GET /api/v1/claims` | Accuracy claims (`UserClaim` in `terminal/lib/personalAccuracy.ts`) |
| `GET /api/v1/briefs` | **Omitted.** No briefs table exists on master at build time. The index prints this null. |
| `GET /api/v1/positions` | Portfolio positions (`Position` in `terminal/lib/portfolio.ts`) |
| `GET /api/v1/openapi.json` | OpenAPI 3.1 generated from these route contracts |

Field lists mirror the existing UI read models. Nothing new is computed.

## R6 — Rate limits

Per key: 60 requests/minute and 5,000/day, enforced in Postgres (`api_key_usage(key_id, window_start, window_seconds, count)` upsert inside `api_key_authenticate`). No in-memory counters. 429 carries `Retry-After` and the plain-word message. Headers `X-RateLimit-Limit` and `X-RateLimit-Remaining` on every response.

## R7 — DDL

`0027_api_keys.sql` owns personal salted key credentials, metadata RLS, audit events, quotas and read functions. `0034_api_watchlist_write.sql` permits the explicit new mint scope and adds a service-only transactional write function plus private idempotency receipts. The existing `watchlists` and `watchlist_symbols` tables remain the product store; the existing unique membership index prevents duplicate symbols. Migration application is a separate guarded release step, never implied by source publication.

## R8 — Developer docs

`GET /api/v1/openapi.json` (OpenAPI 3.1). This contract lives at `terminal/docs/api/API_V1_CONTRACT.md`. The settings section shows the base URL and a link to this file.

### Curl example (placeholder key)

```bash
curl -sS \
  -H "Authorization: Bearer mmx_REPLACE_WITH_YOUR_KEY" \
  -H "Accept: application/json" \
  "https://app.mastermind-x.com/api/v1/me"
```

## R9 — Ceiling + truth

Reads project existing Terminal data. The sole opt-in write adds watchlist membership; it does not originate recommendations or trade instructions.

API reads return what you already see in the Terminal. Opt-in keys may add tickers to your watchlists. It originates no signals, rankings or advice.

接口读取你在终端里已有的内容。主动开启写入权限的密钥可向你的自选列表添加代码。它不产生信号、排名或建议。

## R10 — One retry-safe write and its consumer

`POST /api/v1/watchlists/{id}/symbols` accepts JSON `{"symbol":"AAPL","section":"Watchlist"}`. `section` is optional. The symbol is normalized by the existing ticker rules. The UUID must name a list owned by the key's user; shared access is insufficient. An already-present symbol is preserved, including its section and position.

Success is201 for a new membership and200 if it already existed. The versioned write body is `{"schema":"mm.api.v1.watchlist_symbol","version":"2026-10-15","asof":"<UTC timestamp>","data":{"watchlist_id":"<uuid>","symbol":"AAPL","section":"Watchlist","position":0,"added":true}}`. It has no read pagination fields. Responses are `Cache-Control: no-store`.

Mint a new personal key with **Allow adding watchlist symbols** enabled in Developer access. The default remains `read`; the opt-in key adds `watchlists:write`. `/api/v1/me` and the key list show its actual permissions. Keep the secret in an environment variable or secret manager, never in a committed script or request URL.

Every write requires an `Idempotency-Key` of 16–128 letters, digits, underscores, hyphens, dots or colons. Keep that key and the same normalized body for every retry of the same operation. A successful response is retained atomically with the addition, scoped to the API key. Replay returns the original body/status and `Idempotency-Replayed: true`. Reusing the key with a different list, symbol or section returns `409 idempotency_conflict`. A replay does not re-add a subsequently removed symbol. A revoked key cannot replay; a deleted or no-longer-owned list is inaccessible. Receipts remain for the key's lifetime.

The CLI in `terminal/scripts/watchlist_import.py` is the first consumer. It sends one symbol to one existing list and keeps its request identity stable across bounded retries. Set `MMX_API_KEY` securely, then run:

```bash
python3 terminal/scripts/watchlist_import.py \
  --endpoint https://app.mastermind-x.com \
  --list-id YOUR_OWN_WATCHLIST_UUID \
  --symbol AAPL \
  --request-id import-20261015-aapl-001
```

Retry only transport failures, `429`, `502`, `503`, and `504`, using the same operation identity. Honor `Retry-After`; if its delay exceeds the remaining deadline, stop and resume later with the same key instead of retrying early. Other `4xx` responses require correcting the request or permissions. The importer refuses credential-bearing redirects and non-HTTPS origins except local loopback tests.

The minute/day quotas apply to every attempt, including replay. `503` with `Retry-After` represents transient write contention/unavailability; it never indicates a committed write is safe to duplicate under a fresh request ID.
