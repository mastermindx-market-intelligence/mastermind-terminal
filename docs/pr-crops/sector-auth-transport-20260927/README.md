# Sector Central R12 — shared-cookie owner transport repair

`BUILT_NOT_PROVEN / DRAFT / UNMERGED / NOT DEPLOYED`

Operation: `sector-intelligence-terminal-20260926-sol-001`

Parent: `macro#7646 / sector-central-redesign-20260921-sol-001`

## Defects

The Sector Intelligence route admitted the local Terminal user, then fetched Macro's four protected static JSON owners with `Authorization: Bearer <Supabase access token>`.

Macro's static assets are guarded by Caddy `@reg_asset` → `/api/regwall/check` → `/api/paywall/check`. Those gates extract the access token from the shared `sb-<project-ref>-auth-token` cookie, including numeric `.0`, `.1`, … chunks. They do not use the bearer header as the credential for these files. The former positive interception proof therefore exercised envelope handling, not a credential shape that could satisfy the real static gate.

A second failure remained after the first cookie-forwarding repair. `/api/*` bypasses Terminal's page middleware, while `@supabase/ssr` lazily initializes and may refresh a session during `getUser()` / `getSession()`. Capturing the raw request cookie before those calls could validate a refreshed local session and still forward Macro the stale pre-refresh cookie.

## Repair

`terminal/app/api/sector-intelligence/route.ts` remains the only gateway. No new endpoint, proxy, auth cache, service credential or publisher was created.

The route now:

1. performs an initial fail-closed check that the request carries an exact `sb-<project-ref>-auth-token` cookie or numeric chunk;
2. preserves the existing `getUser()` admission and same-user `getSession()` check;
3. after lazy session initialization, re-reads the current request-scoped server cookie store;
4. filters that current store to exact Supabase auth-cookie chunks only, excluding unrelated cookies, PKCE/code-verifier cookies and malformed lookalikes;
5. returns `401 / access` without an owner fetch if either the incoming credential is absent or the current post-initialization store has no forwardable session cookie;
6. sends only the current filtered `Cookie` header to the fixed HTTPS `mastermind-x.com` owner origin;
7. sends no `Authorization` header and keeps `redirect: manual`, so credentials cannot follow a `3xx`;
8. preserves fixed source keys, timeout, maximum body size, JSON content type, exact owner-envelope validation, source date, content digest and private/no-store responses.

The access token remains local same-user session-consistency evidence. It is never represented as the Macro static credential.

## Discriminating proof

The route test first failed red when a stale incoming cookie was replaced during `getUser()`: the owner fetch still received the stale value. The repaired route forwards only the refreshed current cookie.

`terminal/lib/__tests__/sectorOwnerGateway.test.ts` now proves:

- numeric Supabase cookie chunks are preserved in order;
- unrelated cookies and malformed lookalikes are removed;
- no incoming auth cookie performs no upstream request;
- a validated session whose current cookie store loses the auth chunks performs no upstream request;
- a stale incoming cookie replaced during session initialization forwards only the refreshed chunks;
- no validated user, missing local access token or user/session mismatch performs no upstream request;
- the positive request carries exact current filtered `Cookie`, `Accept: application/json`, no Authorization header and `redirect: manual`;
- unknown source keys, 401/403, 404, redirects, HTML login bodies, invalid owner envelopes, malformed JSON and declared oversized bodies remain closed;
- valid owner data preserves its source clock, exact content hash and private/no-store boundary.

Validation on the repaired bytes:

- route suite: **17/17 passed**;
- complete Sector unit surface: **11 files / 208 passed**;
- complete Terminal unit suite: **401 files / 6,479 passed / 4 todo**;
- route type generation, TypeScript, scoped TypeScript/TSX ESLint and diff hygiene: **PASS**.

## Acceptance boundary

This proves that the gateway presents the current credential shape the exact Macro static gate consumes and does not leak stale or unrelated cookies. It is not production proof. Acceptance still requires one entitled signed-in production session to load `sector`, `confluence`, `themes` and `heatmap` through the deployed Terminal route, without interception, while also proving truthful locked, unavailable and invalid states.
