// Personal API-key GET /api/v1/event-impact (MO-DELTA-039 scoped slice). Same join, same
// artifact, same honesty rules as the session route — reached with an API key instead of a
// cookie, and shaped with the frozen v1 envelope.
//
// Deliberately NOT handleV1Get: that helper paginates list resources and would silently accept
// query parameters. This endpoint has no query contract at all (the join runs over the caller's
// whole open book, bounded by the RPC's own limit), so ANY query string — including a spoofed
// user_id/account/tenant selector, which could only ever be ignored — is a 400 before anything
// is read. The only user id in play is auth.userId, bound inside readAsUser.
//
// Fail-closed mapping (every status carries the v1 rate headers plus private, no-store and
// Vary: Authorization):
//   holdings unreadable (RPC failure, >limit page, malformed row) -> 503 holdings_unreadable,
//     and the calendar is never touched;
//   artifact missing/corrupt/unreadable -> 503 calendar_unreadable (join's `detail` is dropped —
//     no raw path or OS error ever reaches the client);
//   genuine empty / closed-only book -> 200 no_holdings;
//   joined result -> 200 ok, with the SOURCE asof carried verbatim in data while the envelope's
//     own asof is this response's observation time.
import { NextResponse } from "next/server";
import {
  API_V1_MAX_LIMIT,
  API_V1_RATE_LIMIT_MINUTE,
  coverageOf,
  envelope,
  errorBody,
  errorStatus,
  type ApiV1ErrorCode,
  type ApiV1Page,
} from "@/lib/apiV1";
import {
  assertNoForbiddenFields,
  authenticateApiKey,
  readAsUser,
  type ApiV1Deps,
} from "@/lib/apiV1Server";
import {
  EVENT_IMPACT_SCHEMA,
  joinEventImpactForBook,
  readPortfolioCtx,
  validatePositionRows,
  type EventImpactContextReader,
} from "@/lib/apiV1EventImpact";
import type { EventImpactRead, TouchedPosition } from "@/lib/eventImpact";


/** Handler deps: the v1 RPC client plus an optional context reader (tests inject a local one;
 *  production falls back to the canonical disk read). */
export type EventImpactDeps = ApiV1Deps & {
  readContext?: EventImpactContextReader;
};

const PAGE: ApiV1Page = { next_cursor: null, limit: API_V1_MAX_LIMIT };

function okHeaders(auth: { limit: number; remaining: number }): Record<string, string> {
  return {
    "Cache-Control": "private, no-store",
    Vary: "Authorization",
    "X-RateLimit-Limit": String(auth.limit),
    "X-RateLimit-Remaining": String(Math.max(0, auth.remaining)),
  };
}

function eventImpactError(code: ApiV1ErrorCode, auth: { limit: number; remaining: number }): NextResponse {
  return NextResponse.json(errorBody(code), { status: errorStatus(code), headers: okHeaders(auth) });
}

/** authenticateApiKey's own responses already carry the X-RateLimit headers; this adds the
 *  cache/vary contract so EVERY answer from this route, including 401/429, carries them. */
function withEventImpactHeaders(res: NextResponse): NextResponse {
  res.headers.set("Cache-Control", "private, no-store");
  const vary = res.headers.get("vary");
  if (!vary || !vary.includes("Authorization")) {
    res.headers.set("Vary", vary ? `${vary}, Authorization` : "Authorization");
  }
  return res;
}

export async function handleEventImpactGet(
  request: Request,
  deps?: EventImpactDeps,
): Promise<NextResponse> {
  const authResult = await authenticateApiKey(request, deps, false, "read");
  if (!authResult.ok) return withEventImpactHeaders(authResult.response);
  const { auth } = authResult;

  // Scope check before any read: a key without `read` learns nothing, not even whether it holds
  // positions. authenticateApiKey has already answered 429 for an exhausted key, so a rate
  // limited key never reaches a positions read or the calendar either.
  if (!auth.scopes.includes("read")) return eventImpactError("forbidden", auth);

  // No endpoint query contract: reject every parameter rather than ignore it, so a client that
  // sends user_id/account/tenant selectors gets a loud 400 instead of a silently-ignored hint.
  if (new URL(request.url).search !== "") return eventImpactError("invalid_request", auth);

  const read = await readAsUser(auth, "positions", { limit: API_V1_MAX_LIMIT }, deps, true);
  let positions: readonly TouchedPosition[] | null = null;
  let coverageRows: Record<string, unknown>[] = [];
  if (read.ok) {
    const phase = validatePositionRows(read.rows, API_V1_MAX_LIMIT);
    if (phase.ok) {
      positions = phase.positions;
      coverageRows = phase.positions as unknown as Record<string, unknown>[];
    }
  }

  // A failed/over-limit/malformed holdings read is `holdings_unreadable` and the calendar is
  // never touched — an event-impact answer must never be computed over a book we could not
  // fully read (joinEventImpactForBook applies the same gate to the genuinely-empty book).
  const body: EventImpactRead =
    positions === null
      ? { state: "holdings_unreadable" }
      : await joinEventImpactForBook({
          positions,
          readContext: deps?.readContext ?? readPortfolioCtx,
        });

  switch (body.state) {
    case "ok":
    case "no_events":
    case "no_holdings": {
      // Forbidden-field guard on the final data shape (defense in depth; the join carries no
      // score/rank/confidence fields today).
      assertNoForbiddenFields(body);
      const data = envelope(EVENT_IMPACT_SCHEMA, body, PAGE, coverageOf(coverageRows, ["shares"]));
      return NextResponse.json({ ...data, snapshot: { countdown_basis: "source_snapshot", freshness: "not_evaluated" } }, { status: 200, headers: okHeaders(auth) });
    }
    case "holdings_unreadable":
    case "calendar_unreadable":
    case "upstream_locked": {
      // 503 in the v1 `unavailable` vocabulary. The state names WHICH side could not be read;
      // the join's `detail` (and anything path- or OS-shaped) is dropped here on purpose.
      return NextResponse.json(
        { ...envelope(EVENT_IMPACT_SCHEMA, { state: body.state, ...(body.state === "calendar_unreadable" ? { detail: "unavailable" } : {}) }, PAGE, coverageOf([], ["shares"])),
          snapshot: { countdown_basis: "source_snapshot", freshness: "not_evaluated" } },
        { status: errorStatus("unavailable"), headers: okHeaders(auth) },
      );
    }
    case "unauthenticated": {
      // Not reachable past authenticateApiKey; kept exhaustive so a state can never silently
      // demote to 200.
      return NextResponse.json(
        { ...errorBody("unauthorized"), state: body.state },
        { status: errorStatus("unauthorized"), headers: okHeaders(auth) },
      );
    }
  }
}

export async function handleV1EventImpact(request: Request): Promise<Response> {
  try {
    return await handleEventImpactGet(request);
  } catch {
    return withEventImpactHeaders(
      NextResponse.json(errorBody("server_error"), {
        status: errorStatus("server_error"),
        headers: {
          "Cache-Control": "private, no-store",
          Vary: "Authorization",
          "X-RateLimit-Limit": String(API_V1_RATE_LIMIT_MINUTE),
          "X-RateLimit-Remaining": "0",
        },
      }),
    );
  }
}
