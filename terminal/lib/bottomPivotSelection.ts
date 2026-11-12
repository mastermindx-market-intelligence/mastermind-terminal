/**
 * Read-only Bottom Pivot evidence selection for Terminal.
 *
 * Macro owns bottom_sensors.json and the daily single-stock evidence composer.
 * This module selects one security without copying the producer's ranking, bottom
 * ruler, execution policy, or scoring. Unavailable never becomes an affirmative
 * signal. It is shared by the server proxy and the client renderer.
 */
export const SELECTION_SCHEMA = "bottom_pivot_selection.v1" as const;
export const CONTEXT_SCHEMA = "bottom_pivot_context.v1" as const;

const FIELDS = new Set([
  "trigger_tier", "trigger_age_ticks", "coiled", "star", "coiled_fire",
  "above200", "hold_state", "hold_days_basing", "hold_ret_since_anchor_pct",
  "knife_score", "dist_21d_low_pct", "dist_126d_high_pct",
  "sponsorship_state",
]);
const STATES = new Set([
  "observed", "missing", "stale", "future", "conflict", "invalid", "not_known",
]);
const QUALITY = new Set(["available", "partial", "unavailable"]);

export type PivotEvidence = {
  field: string;
  state: string;
  value: string | number | boolean | null;
  source: string | null;
  as_of: string | null;
  available_at: string | null;
};

export type BottomPivotContext = {
  schema: typeof CONTEXT_SCHEMA;
  symbol: string;
  scope: "single_security";
  cadence: "daily";
  quality: "available" | "partial" | "unavailable";
  decision_at: string | null;
  evidence_mode: "current_snapshot" | "as_issued";
  explanation: { en: string; zh: string };
  evidence: PivotEvidence[];
  limitations: string[];
  is_display_only: true;
  probability: null;
  action_authority: "none";
};

export type BottomPivotSelection = {
  schema: typeof SELECTION_SCHEMA;
  symbol: string;
  as_of: string | null;
  context: BottomPivotContext | null;
  reason: "symbol_absent" | "context_unavailable" | null;
};

function record(x: unknown): Record<string, unknown> | null {
  return x !== null && typeof x === "object" && !Array.isArray(x)
    ? x as Record<string, unknown> : null;
}

export function canonicalBottomSymbol(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const symbol = value.trim().toUpperCase();
  return /^[A-Z][A-Z0-9.-]{0,15}$/.test(symbol) ? symbol : null;
}

function shortString(x: unknown, limit = 160): string | null {
  return typeof x === "string" && x.length > 0 && x.length <= limit ? x : null;
}

function textPair(x: unknown): { en: string; zh: string } | null {
  const pair = record(x);
  const en = shortString(pair?.en, 3000);
  const zh = shortString(pair?.zh, 3000);
  return en && zh ? { en, zh } : null;
}

function evidenceRows(raw: unknown): PivotEvidence[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 50).flatMap((value: unknown) => {
    const item = record(value);
    const field = item?.field;
    const state = item?.state;
    if (typeof field !== "string" || !FIELDS.has(field) ||
        typeof state !== "string" || !STATES.has(state)) return [];
    const v = item?.value;
    const usableValue =
      v === null || typeof v === "boolean" ||
      (typeof v === "string" && v.length <= 160) ||
      (typeof v === "number" && Number.isFinite(v));
    return [{
      field, state, value: usableValue ? v as string | number | boolean | null : null,
      source: shortString(item?.source),
      as_of: shortString(item?.as_of, 35),
      available_at: shortString(item?.available_at, 50),
    }];
  });
}

function parseContext(raw: unknown, symbol: string): BottomPivotContext | null {
  const obj = record(raw);
  if (!obj || obj.schema !== CONTEXT_SCHEMA ||
      canonicalBottomSymbol(obj.symbol) !== symbol ||
      obj.scope !== "single_security" || obj.cadence !== "daily" ||
      obj.is_display_only !== true || obj.action_authority !== "none" ||
      obj.probability !== null ||
      typeof obj.quality !== "string" || !QUALITY.has(obj.quality) ||
      (obj.evidence_mode !== "current_snapshot" && obj.evidence_mode !== "as_issued")) {
    return null;
  }
  const explanation = textPair(obj.explanation);
  if (!explanation) return null;
  return {
    schema: CONTEXT_SCHEMA,
    symbol,
    scope: "single_security",
    cadence: "daily",
    quality: obj.quality as BottomPivotContext["quality"],
    decision_at: shortString(obj.decision_at, 60),
    evidence_mode: obj.evidence_mode as BottomPivotContext["evidence_mode"],
    explanation,
    evidence: evidenceRows(obj.evidence),
    limitations: Array.isArray(obj.limitations) ?
      obj.limitations.filter((x): x is string =>
        typeof x === "string" && x.length > 0 && x.length <= 100).slice(0, 20) : [],
    is_display_only: true,
    probability: null,
    action_authority: "none",
  };
}

/** Server selection: fail closed for invalid feed identity, never send other rows. */
export function selectBottomPivotFeed(raw: unknown, requestSymbol: string): BottomPivotSelection | null {
  const payload = record(raw);
  const symbol = canonicalBottomSymbol(requestSymbol);
  if (!symbol || !payload || payload.is_display_only !== true ||
      !Array.isArray(payload.rows)) return null;
  const row = payload.rows.find((candidate: unknown) => {
    const r = record(candidate);
    return r && canonicalBottomSymbol(r.symbol) === symbol;
  });
  const selected = row ? record(row) : null;
  const context = parseContext(selected?.pivot_context, symbol);
  return {
    schema: SELECTION_SCHEMA,
    symbol,
    as_of: shortString(payload.as_of, 35),
    context,
    reason: context ? null : selected ? "context_unavailable" : "symbol_absent",
  };
}

/** Client: never accept a mismatched, speculative or decision-capable envelope. */
export function parseBottomPivotSelection(raw: unknown, expectedSymbol: string): BottomPivotSelection | null {
  const obj = record(raw);
  const symbol = canonicalBottomSymbol(expectedSymbol);
  if (!obj || !symbol || obj.schema !== SELECTION_SCHEMA || obj.symbol !== symbol ||
      (obj.reason !== null && obj.reason !== "symbol_absent" &&
       obj.reason !== "context_unavailable")) return null;
  const context = parseContext(obj.context, symbol);
  if (obj.context !== null && !context) return null;
  if (context && obj.reason !== null) return null;
  return {
    schema: SELECTION_SCHEMA,
    symbol,
    as_of: shortString(obj.as_of, 35),
    context,
    reason: context ? null : obj.reason as BottomPivotSelection["reason"],
  };
}
