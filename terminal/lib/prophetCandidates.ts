/** Display-only projection of Macro's complete candidate pool. No ranking, plan
 * joins, entry permission, or fallback to the smaller published main list. */
import { SECTOR_MEMBERS_SYMBOL } from "./prophetSectorMembers";

export const PROPHET_CANDIDATES_MAX_BYTES = 8 * 1024 * 1024;
export const PROPHET_CANDIDATES_MAX_ROWS = 10_000;
export type ProphetCandidate = {
  ticker: string;
  name: string | null;
  sector: string | null;
  pool_rank: number | null;
  in_buy_lane: boolean;
  lane: string | null;
  headline_reason: string | null;
  lane_reasons: string[] | null;
  tier_cascade: string | null;
  admission_class: string | null;
  prophet_score_basis: "buy_lane_pool" | null;
  prophet: { score: number } | null;
};
export type ProphetCandidatePool = {
  schema: "mastermind.prophet_candidate_pool_read.v1";
  market: "US";
  source: { path: "site/factordata/us_standouts.json"; sha256: string; bytes: number };
  projection: {
    status: "ready" | "empty";
    reason: null;
    as_of: string;
    counts: { eligible: number; in_buy_lane: number; off_buy_lane: number; scored: number; unscored: number };
    rows: ProphetCandidate[];
    display_only: true;
    source_digest: string;
  };
};
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max = 512): value is string | null => value === null || (typeof value === "string" && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value));
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= PROPHET_CANDIDATES_MAX_ROWS;
function day(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Reconstruct an allowlist; never rehost arbitrary additions from the source.
 * Membership/count/score contradictions withdraw the whole snapshot. */
export function decodeProphetCandidates(raw: unknown): ProphetCandidatePool | null {
  if (!record(raw) || raw.schema !== "mastermind.prophet_candidate_pool_read.v1" || raw.market !== "US" || !record(raw.source) || !record(raw.projection)) return null;
  const source = raw.source, p = raw.projection;
  if (source.path !== "site/factordata/us_standouts.json" || typeof source.sha256 !== "string" || !/^sha256:[a-f0-9]{64}$/.test(source.sha256)
    || typeof source.bytes !== "number" || !Number.isSafeInteger(source.bytes) || source.bytes <= 0 || source.bytes > PROPHET_CANDIDATES_MAX_BYTES) return null;
  if ((p.status !== "ready" && p.status !== "empty") || p.reason !== null || !day(p.as_of) || p.display_only !== true
    || typeof p.source_digest !== "string" || !/^[a-f0-9]{64}$/.test(p.source_digest) || !record(p.counts)
    || !Array.isArray(p.rows) || p.rows.length > PROPHET_CANDIDATES_MAX_ROWS) return null;
  const c = p.counts;
  if (![c.eligible, c.in_buy_lane, c.off_buy_lane, c.scored, c.unscored].every(count) || c.eligible !== p.rows.length
    || (p.status === "empty") !== (p.rows.length === 0)) return null;
  const rows: ProphetCandidate[] = [], seen = new Set<string>();
  for (const r of p.rows) {
    if (!record(r) || typeof r.ticker !== "string" || !SECTOR_MEMBERS_SYMBOL.test(r.ticker.toUpperCase()) || seen.has(r.ticker.toUpperCase())
      || typeof r.in_buy_lane !== "boolean" || !text(r.name) || !text(r.sector)
      || ![r.lane, r.headline_reason, r.tier_cascade, r.admission_class].every(v => text(v, 160))
      || !(r.lane_reasons === null || (Array.isArray(r.lane_reasons) && r.lane_reasons.length <= 64 && r.lane_reasons.every(v => typeof v === "string" && text(v, 160))))) return null;
    // The producer accepts an integral numeric string for this source field.
    // Normalize only its representation; keep the published row order intact.
    const rank = r.pool_rank === null ? null : (typeof r.pool_rank === "number" || (typeof r.pool_rank === "string" && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(r.pool_rank.trim()))) ? Number(r.pool_rank) : NaN;
    if (rank !== null && (!Number.isSafeInteger(rank) || rank < 1)) return null;
    let prophet: ProphetCandidate["prophet"] = null;
    if (r.prophet !== null) {
      if (!record(r.prophet) || !r.in_buy_lane || r.prophet_score_basis !== "buy_lane_pool"
        || typeof r.prophet.score !== "number" || !Number.isFinite(r.prophet.score) || r.prophet.score < 0 || r.prophet.score > 100) return null;
      prophet = { score: r.prophet.score };
    } else if (r.prophet_score_basis !== null) return null;
    const ticker = r.ticker.toUpperCase();
    seen.add(ticker);
    rows.push({ ticker, name: r.name as string | null, sector: r.sector as string | null,
      pool_rank: rank, in_buy_lane: r.in_buy_lane, lane: r.lane as string | null,
      headline_reason: r.headline_reason as string | null, lane_reasons: r.lane_reasons === null ? null : [...r.lane_reasons as string[]],
      tier_cascade: r.tier_cascade as string | null, admission_class: r.admission_class as string | null,
      prophet_score_basis: prophet ? "buy_lane_pool" : null, prophet });
  }
  const inBuy = rows.filter(r => r.in_buy_lane).length, scored = rows.filter(r => r.prophet !== null).length;
  if (c.in_buy_lane !== inBuy || c.off_buy_lane !== rows.length - inBuy || c.scored !== scored || c.unscored !== rows.length - scored) return null;
  return { schema: raw.schema, market: "US", source: { path: source.path, sha256: source.sha256, bytes: source.bytes },
    projection: { status: p.status, reason: null, as_of: p.as_of,
      counts: { eligible: rows.length, in_buy_lane: inBuy, off_buy_lane: rows.length - inBuy, scored, unscored: rows.length - scored },
      rows, display_only: true, source_digest: p.source_digest } };
}

/** Search only narrows presentation. It never reorders or recalculates counts. */
export function filterProphetCandidates(rows: readonly ProphetCandidate[], query: string): ProphetCandidate[] {
  const words = query.toLocaleLowerCase("en-US").trim().split(/\s+/).filter(Boolean);
  return rows.filter(row => {
    const haystack = `${row.ticker} ${row.name ?? ""} ${row.sector ?? ""}`.toLocaleLowerCase("en-US");
    return words.every(word => haystack.includes(word));
  });
}
