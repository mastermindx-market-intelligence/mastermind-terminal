// API v1 event-impact source contract (MO-DELTA-039 scoped slice). Binds the personal API key
// read path to the SAME join the session route uses (lib/eventImpact.ts, reused unchanged) —
// no second join, no second truth.
//
// What this module adds over the session route is the API contract discipline:
//   - the book arrives from api_v1_read_as_user (auth-scoped RPC) via readAsUser, never a direct
//     service.from read — the only user id in play is auth.userId, bound inside readAsUser;
//   - rows are validated STRICTLY (fail closed): the RPC answers up to limit+1, so a page larger
//     than the limit is a broken caller contract, and a malformed row fails the whole read — a
//     partial book rendered as an event-impact answer would be the API inventing a holding;
//   - the macro artifact is read from the canonical LOCAL bake (MACRO_DATA_DIR, default
//     /opt/macro/site/data) with fs + JSON.parse only: no cache (a keyed API response must never
//     serve a stale countdown), no HTTP fallback (the regwalled fetch is a session-route concern;
//     a key holder gets calendar_unreadable, not a second network path).
// Pure data in, joined read out. Nothing here feeds a signal, score or ranker (two-organisms law).

import { promises as fs } from "fs";
import path from "path";
import {
  joinEventImpact,
  type EventImpactRead,
  type TouchedPosition,
} from "@/lib/eventImpact";
import { API_V1_MAX_LIMIT } from "@/lib/apiV1";
import { normalizeTicker } from "@/lib/portfolio";

/** Envelope schema for this resource. It has no entry in the v1 metadata shape table, so
 *  inference_metadata deliberately classifies the whole payload as unclassified — unknown
 *  metadata stays opaque, no truth promotion. */
export const EVENT_IMPACT_SCHEMA = "mm.api.v1.event_impact";

export const MACRO_DATA_DIR_DEFAULT = "/opt/macro/site/data";
export const PORTFOLIO_CTX_FILENAME = "portfolio_ctx.json";

/** Env-overridable so a test can point the canonical read at a temp dir (checked per call,
 *  never cached at import time). */
function macroDataDir(): string {
  return process.env.MACRO_DATA_DIR || MACRO_DATA_DIR_DEFAULT;
}

export function portfolioCtxPath(): string {
  return path.join(macroDataDir(), PORTFOLIO_CTX_FILENAME);
}

export type EventImpactContextRead =
  | { ok: true; ctx: unknown }
  | { ok: false; reason: "missing" | "corrupt" | "unreadable" };

export type EventImpactContextReader = () => Promise<EventImpactContextRead>;

/**
 * Production context loader: one fs read + JSON.parse per call, nothing cached, no HTTP
 * fallback. Every failure is a fixed reason token — never a raw path or OS error — because the
 * token can reach joinEventImpact's `detail` and must be safe to disclose internally; the API
 * layer drops it entirely either way.
 */
export const readPortfolioCtx: EventImpactContextReader = async () => {
  let raw: string;
  try {
    raw = await fs.readFile(portfolioCtxPath(), "utf8");
  } catch (cause) {
    const code = (cause as { code?: unknown } | null)?.code;
    return { ok: false, reason: code === "ENOENT" ? "missing" : "unreadable" };
  }
  try {
    return { ok: true, ctx: JSON.parse(raw) };
  } catch {
    return { ok: false, reason: "corrupt" };
  }
};

export type PositionsPhase =
  | { ok: true; positions: TouchedPosition[] }
  | { ok: false; reason: "over_limit" | "malformed" };

/**
 * Validate the positions page STRICTLY. joinEventImpact drops nothing and neither do we: the
 * session route can afford per-row leniency because the human is looking at their own rows, but
 * a keyed API response asserting "your earnings exposure is..." must be computed over the whole
 * book it was told about — one malformed row fails the entire read (never a partial success),
 * and a page bigger than the requested limit means the caller contract itself broke.
 *
 * `shares` is null (the legal unsized state) or a finite number — the numeric-string tolerance
 * in rowToPosition is a table-driver concern this RPC contract does not carry.
 */
export function validatePositionRows(
  rows: readonly unknown[],
  limit: number = API_V1_MAX_LIMIT,
): PositionsPhase {
  if (rows.length > limit) return { ok: false, reason: "over_limit" };
  const positions: TouchedPosition[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return { ok: false, reason: "malformed" };
    }
    const rec = row as Record<string, unknown>;
    const id = typeof rec.id === "string" ? rec.id.trim() : "";
    const ticker = typeof rec.ticker === "string" ? rec.ticker.trim() : "";
    if (!id || normalizeTicker(ticker) === null) return { ok: false, reason: "malformed" };
    if (rec.status !== "open" && rec.status !== "closed") return { ok: false, reason: "malformed" };
    if (rec.shares !== null && (typeof rec.shares !== "number" || !Number.isFinite(rec.shares))) {
      return { ok: false, reason: "malformed" };
    }
    positions.push({ id, ticker, shares: rec.shares, status: rec.status });
  }
  return { ok: true, positions };
}

/**
 * Join a validated book against the macro artifact. The calendar is touched ONLY when there is
 * an open position to join against it — joinEventImpact answers no_holdings before it ever
 * looks at the calendar, so reading it for an empty/closed-only book would spend a file read on
 * an answer that cannot change (and keeps the API's "no calendar access on a failed book"
 * promise mechanically checkable in tests). A local-file outcome is never `ctxLocked`: the
 * registration wall is an HTTP fact and this loader has no HTTP fallback, so
 * missing/corrupt/unreadable all land in calendar_unreadable.
 */
export async function joinEventImpactForBook(input: {
  positions: readonly TouchedPosition[];
  readContext: EventImpactContextReader;
}): Promise<EventImpactRead> {
  const hasOpen = input.positions.some((p) => p.status === "open");
  if (!hasOpen) return { state: "no_holdings" };
  const ctx = await input.readContext();
  if (!ctx.ok) {
    return joinEventImpact({ positions: input.positions, ctx: null, ctxError: ctx.reason });
  }
  return joinEventImpact({ positions: input.positions, ctx: ctx.ctx });
}
