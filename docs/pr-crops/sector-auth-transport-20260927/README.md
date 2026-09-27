# Sector Central R12 — shared-cookie owner transport repair

`BUILT_NOT_PROVEN / DRAFT / UNMERGED / NOT DEPLOYED`

## Defect

The Sector Intelligence route admitted the local Terminal user, then fetched Macro's four protected static JSON owners with an `Authorization: Bearer <Supabase access token>` header.

Macro's static assets are guarded by Caddy `@reg_asset` → `/api/regwall/check` → `/api/paywall/check`. Those gates extract the Supabase access token from the shared `sb-<project-ref>-auth-token` cookie, including chunked `.0`, `.1`, … cookies. They do not use the bearer header as the credential for these files.

The former positive browser/unit proof therefore showed envelope handling against interception, not a credential shape that could satisfy the real static gate.

## Repair

`terminal/app/api/sector-intelligence/route.ts` remains the only gateway. No new endpoint, proxy, auth cache, service credential or publisher was created.

The route now:

1. filters the incoming cookie header to the exact session-name shape `sb-<project-ref>-auth-token` plus numeric `.0`, `.1`, … chunks; PKCE/code-verifier and malformed lookalikes are excluded;
2. rejects the positive path with `401 / access` before any owner request when no filtered credential exists;
3. preserves the existing `getUser()` and same-user `getSession()` admission;
4. treats the access token only as local session-consistency evidence;
5. forwards only the filtered Supabase cookie chunks to the fixed HTTPS `mastermind-x.com` owner origin;
6. forwards no unrelated Terminal cookie and no Authorization header;
7. keeps `redirect: manual`, so the caller cookie cannot follow a redirect;
8. preserves fixed source keys, timeout, maximum body size, JSON content type, exact owner-envelope validation, source date, content digest and private/no-store responses.

## Discriminating unit proof

`terminal/lib/__tests__/sectorOwnerGateway.test.ts` proves:

- chunked Supabase cookies are preserved in order;
- unrelated cookies are removed;
- no auth cookie performs no upstream request;
- no validated user, missing local access token or user/session mismatch performs no upstream request;
- the positive request carries the exact filtered `Cookie`, `Accept: application/json`, no Authorization header and `redirect: manual`;
- unknown source keys are rejected before fetch;
- 401/403, 404, redirects, HTML login bodies, invalid owner envelopes, malformed JSON and declared oversized bodies remain closed;
- valid owner data preserves its source clock, exact content hash and private/no-store boundary.

Result: **15/15 route tests pass**. The complete Sector unit surface is **205/205**, TypeScript and scoped ESLint pass, and the complete Terminal unit suite is **401 files / 6,476 passed / 4 todo**.

## Acceptance boundary

This proves the route now presents the credential shape the exact Macro static gate consumes. It is not production proof. Acceptance still requires one entitled signed-in production session to load `sector`, `confluence`, `themes` and `heatmap` through the deployed Terminal route, with no local interception, while also proving truthful locked/unavailable/invalid states.
