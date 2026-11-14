/** Read-only consumer of Macro's complete candidate display projection.
 * No ranking, selection, assessment, source fallback or history is computed here.
 */
import { SECTOR_MEMBERS_SYMBOL } from "./prophetSectorMembers";

export const PROPHET_CANDIDATE_URL = "/api/shared-shell/prophet-candidates";
export const PROPHET_CANDIDATE_SCHEMA = "mastermind.prophet_candidate_pool_read.v1";

export type ProphetCandidate = {
  ticker: string; name: string | null; sector: string | null;
  pool_rank: number | string | null; in_buy_lane: boolean;
  lane: string | null; headline_reason: string | null; lane_reasons: string[] | null;
  tier_cascade: string | null; admission_class: string | null;
  prophet_score_basis: "buy_lane_pool" | null; prophet: { score: number } | null;
};
const COUNT_KEYS = ["eligible", "in_buy_lane", "off_buy_lane", "scored", "unscored"] as const;
type Counts = Record<typeof COUNT_KEYS[number], number | null>;
export type ProphetCandidateRead = {
  schema: typeof PROPHET_CANDIDATE_SCHEMA; market: "US";
  source: { path: "site/factordata/us_standouts.json"; sha256: string; bytes: number };
  projection: {
    status: "ready" | "empty" | "unavailable"; reason: string | null; as_of: string | null;
    counts: Counts; rows: ProphetCandidate[]; display_only: true; source_digest: string | null;
  };
};
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const textOrNull = (value: unknown): value is string | null => value === null || typeof value === "string";
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
function day(value: unknown): value is string {
  if (typeof value !== "string" || value.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(value)
      || Number(value.slice(0, 4)) < 1) return false;
  const stamp = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(stamp.getTime()) && stamp.toISOString().slice(0, 10) === value;
}
function position(value: unknown): value is number | string | null {
  if (value === null) return true;
  // The owner validates but preserves integral numeric strings. Keep that
  // representation; never silently omit the row or turn this into final rank.
  if (typeof value !== "number" && typeof value !== "string") return false;
  if (typeof value === "string" && (value.length > 64 || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim()))) return false;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0;
}
function candidate(value: unknown): value is ProphetCandidate {
  if (!object(value) || typeof value.ticker !== "string"
      || value.ticker !== value.ticker.trim()
      || !SECTOR_MEMBERS_SYMBOL.test(value.ticker.toUpperCase())
      || !position(value.pool_rank) || typeof value.in_buy_lane !== "boolean") return false;
  for (const key of ["name", "sector", "lane", "headline_reason", "tier_cascade", "admission_class"]) {
    if (!textOrNull(value[key])) return false;
  }
  if (value.lane_reasons !== null && (!Array.isArray(value.lane_reasons)
      || !value.lane_reasons.every(reason => typeof reason === "string"))) return false;
  if (value.prophet === null) return value.prophet_score_basis === null;
  return value.in_buy_lane && value.prophet_score_basis === "buy_lane_pool" && object(value.prophet)
    && typeof value.prophet.score === "number" && Number.isFinite(value.prophet.score)
    && value.prophet.score >= 0 && value.prophet.score <= 100;
}

/** Reject a broken/incomplete envelope as a whole. Never drop rows to manufacture coverage. */
export function decodeProphetCandidatePool(value: unknown): ProphetCandidateRead | null {
  if (!object(value) || value.schema !== PROPHET_CANDIDATE_SCHEMA || value.market !== "US"
      || !object(value.source) || value.source.path !== "site/factordata/us_standouts.json"
      || typeof value.source.sha256 !== "string" || value.source.sha256.length !== 71 || !/^sha256:[0-9a-f]{64}$/.test(value.source.sha256)
      || !integer(value.source.bytes) || value.source.bytes < 1 || value.source.bytes > 8 * 1024 * 1024
      || !object(value.projection)) return null;
  const p = value.projection;
  if (p.display_only !== true || !object(p.counts) || !Array.isArray(p.rows)
      || !textOrNull(p.reason) || !(p.as_of === null || day(p.as_of))) return null;
  if (p.status === "unavailable") {
    return p.rows.length === 0 && COUNT_KEYS.every(key => p.counts && (p.counts as Counts)[key] === null)
      && typeof p.reason === "string" && p.source_digest === null ? value as ProphetCandidateRead : null;
  }
  if ((p.status !== "ready" && p.status !== "empty") || p.reason !== null || !day(p.as_of)
      || typeof p.source_digest !== "string" || p.source_digest.length !== 64 || !/^[0-9a-f]{64}$/.test(p.source_digest)
      || !COUNT_KEYS.every(key => integer((p.counts as Record<string, unknown>)[key]))
      || !p.rows.every(candidate)) return null;
  const rows = p.rows as ProphetCandidate[], counts = p.counts as Counts;
  if (new Set(rows.map(row => row.ticker.toUpperCase())).size !== rows.length
      || (p.status === "empty") !== (rows.length === 0)
      || counts.eligible !== rows.length
      || counts.in_buy_lane !== rows.filter(row => row.in_buy_lane).length
      || counts.off_buy_lane !== rows.filter(row => !row.in_buy_lane).length
      || counts.scored !== rows.filter(row => row.prophet !== null).length
      || counts.unscored !== rows.filter(row => row.prophet === null).length) return null;
  return value as ProphetCandidateRead;
}

/** Source number presentation only: retain precision and make a real zero visible. */
export function candidateScore(score: number): string {
  return Number.isInteger(score) ? score.toFixed(1) : String(score);
}
