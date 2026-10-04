# Public API v1 contract

Packet **T_F12_10 / B-F12-10**. Seat ruling 2026-09-13. This file is the F12 Public API v1 contract freeze for F00C row **MO-PAID-055**.

Acceptance: **an externally-keyed request returns a versioned authenticated response**.

Ceiling: `read_only_projection`. This API returns what you already see in the Terminal. It originates no signals, rankings or advice.

本接口只返回你在终端里已经能看到的内容。它不产生任何信号、排名或建议。

---

## R1 — Scope

v1 = personal, read-only keys. A key acts as the user who minted it and can read ONLY what that user already sees in the Terminal: theses (heads + versions), watchlists, alerts (definitions + recent fires), accuracy claims, briefs, portfolio positions.

No writes. No team/workspace keys. Printed null:

> Team keys aren't available yet — keys are personal for now.

> 团队密钥暂未开放，目前仅支持个人密钥。

No public-artifact proxying (the macro site already serves those publicly; do not re-serve them).

## R2 — Key lifecycle

Minted in the Terminal account settings **Developer access** section (settings rail, dark-only). Shown ONCE in full (`mmx_` + 40 url-safe random chars). Stored as SHA-256 hex + 8-char prefix + label + created_at + last_used_at + revoked_at. At most 5 active keys per user. Revoke is immediate. Rotation = mint new + revoke old (no in-place rotation).

The audit table shipped by B-F12-8 (`public.team_role_changes`) does not fit: it requires a `team_id` foreign key onto `public.teams` and records role changes. API keys are personal and have no team. Mint and revoke therefore write one row each to `public.api_key_events`, owned by the `api_keys` trigger — the closest existing audit owner, never a second audit plane.

## R3 — Authentication + RLS authority

`Authorization: Bearer mmx_…` on `https://<terminal-origin>/api/v1/...`.

The route hashes the key, resolves it via ONE SECURITY DEFINER function `api_key_authenticate(key_hash)` → `{user_id, key_id}` (constant-time compare on the hash; revoked/unknown → null), then reads the user's objects UNDER RLS by impersonation inside a SECURITY DEFINER read function `api_v1_read_as_user` that sets `request.jwt.claims` for the transaction:

```sql
select set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
```

before querying. RLS stays the only authority. NO direct service-role table reads with a user_id filter.

## R4 — Response contract (every endpoint)

Success JSON:

```json
{
  "schema": "mm.api.v1.<resource>",
  "version": "2026-09-13",
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
    "code": "unauthorized|forbidden|not_found|rate_limited|invalid_request",
    "message": "<plain EN sentence>",
    "message_zh": "<real ZH>"
  }
}
```

with the matching HTTP status. `ETag` + `If-None-Match` → 304. Cursor pagination (opaque cursor, limit ≤ 200, default 50). UTC RFC-3339 everywhere. Ids are the same UUIDs the Terminal UI uses. No field ever carries a model-originated score, probability or rank. The API never originates signals.

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

`api_keys(key_id uuid pk, user_id uuid not null, key_hash text unique not null, key_prefix text not null, label text not null, scopes text[] not null default '{read}', created_at, last_used_at, revoked_at)` + `api_key_usage` + `api_key_authenticate` + `api_v1_read_as_user`. RLS owner-only on `api_keys`. Users see their own key metadata; the hash is never returned to any client. Prefix **0024**. Shipped unapplied. The seat applies production DDL.

## R8 — Developer docs

`GET /api/v1/openapi.json` (OpenAPI 3.1). This contract lives at `terminal/docs/api/API_V1_CONTRACT.md`. The settings section shows the base URL and a link to this file.

### Curl example (placeholder key)

```bash
curl -sS \
  -H "Authorization: Bearer mmx_REPLACE_WITH_YOUR_KEY" \
  -H "Accept: application/json" \
  "https://terminal.mastermind-x.com/api/v1/me"
```

## R9 — Ceiling + truth

`read_only_projection`.

This API returns what you already see in the Terminal. It originates no signals, rankings or advice.

本接口只返回你在终端里已经能看到的内容。它不产生任何信号、排名或建议。
