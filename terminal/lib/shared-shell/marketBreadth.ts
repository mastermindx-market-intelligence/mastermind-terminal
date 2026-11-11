/**
 * marketBreadth.ts — the Today strip's breadth cell contract.
 *
 * The source is Macro's live.breadth.v1 file (scripts/live_breadth_poller.py → engine/live_breadth.py),
 * read through app/api/market-breadth. engine/live_breadth.py decides `usable` and `unusable_reason`
 * when it writes the file; this module only projects the few fields the cell shows and refuses
 * anything that does not validate. Unavailable is never turned into zero.
 *
 * The file is a snapshot. The poller stops between sessions, so a file written on Friday evening
 * still says `usable: true` on Sunday. Macro's own reader (templates/live.js, applyBreadth) refuses
 * a file whose build or source clock is more than SBX_MAX_SOURCE_AGE_MIN (25) minutes old; this
 * module applies the same rule against the reader's clock, so an old verdict is shown as
 * "source behind" with no numbers, never as a live reading.
 */

export type BreadthSession = "pre" | "rth" | "post" | "closed";
export type BreadthShare = { n: number; adv_pct: number | null; pa200: number | null };
export type MarketBreadth = {
  schema: "mmx.market_breadth.v1";
  asof: string;
  built_at: string;
  source_age_min: number | null;
  session: BreadthSession;
  delay_min: number | null;
  usable: boolean;
  unusable_reason: string | null;
  coverage_pct: number | null;
  large: BreadthShare | null;
  comp: BreadthShare | null;
};

/** Mirrors templates/live.js SBX_MAX_SOURCE_AGE_MIN. */
export const MAX_SOURCE_AGE_MIN = 25;
/** How far a clock may run ahead of the reader before the reading is not trusted as live. */
const MAX_SKEW_MIN = 5;
/** The one origin allowed to serve the file. It is public and static, so it does not follow
 *  BRAIN_GATEWAY_URL (which can point at a loopback brain). The bare host answers 301 to www;
 *  pinning www here lets redirects stay refused. */
export const BREADTH_UPSTREAM = new URL("/live/breadth.json", "https://www.mastermind-x.com");
const UPSTREAM_SCHEMA = "live.breadth.v1";

type Rec = Record<string, unknown>;
const SESSIONS = new Set<string>(["pre", "rth", "post", "closed"]);
const record = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const pct = (v: unknown) => (num(v) && v >= 0 && v <= 100 ? v : null);
const stamp = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));

function share(v: unknown): BreadthShare | null {
  if (!record(v) || !num(v.n) || v.n <= 0) return null;
  return { n: v.n, adv_pct: pct(v.adv_pct), pa200: pct(v.pa200) };
}

/** True when the build clock or the source clock is older than the live window, or unknown.
 *  A clock slightly ahead (negative age) is allowed, as upstream allows it; one more than
 *  MAX_SKEW_MIN ahead would never age out, so it is not trusted either. */
export function breadthTooOld(builtAt: string, sourceAgeMin: number | null, now: Date): boolean {
  if (sourceAgeMin === null || sourceAgeMin > MAX_SOURCE_AGE_MIN || sourceAgeMin < -MAX_SKEW_MIN) return true;
  const buildAgeMin = (now.getTime() - Date.parse(builtAt)) / 60_000;
  return !Number.isFinite(buildAgeMin) || buildAgeMin > MAX_SOURCE_AGE_MIN || buildAgeMin < -MAX_SKEW_MIN;
}

/** When a live reading leaves the live window on the build clock (epoch ms), or null when it
 *  is not live. The page re-checks the reading at that moment. */
export function breadthExpiresAt(reading: MarketBreadth): number | null {
  const built = Date.parse(reading.built_at);
  return reading.usable && Number.isFinite(built) ? built + MAX_SOURCE_AGE_MIN * 60_000 : null;
}

/** The upstream file as the cell's projection, or null when it is not a live.breadth.v1 reading. */
export function projectBreadth(raw: unknown, now: Date): MarketBreadth | null {
  if (!record(raw) || raw.schema !== UPSTREAM_SCHEMA || !stamp(raw.asof)) return null;
  if (typeof raw.session !== "string" || !SESSIONS.has(raw.session) || typeof raw.usable !== "boolean") return null;
  const builtAt = raw.built_at === undefined || raw.built_at === null ? raw.asof : raw.built_at;
  if (!stamp(builtAt)) return null;
  const tiers = Array.isArray(raw.tiers) ? raw.tiers : [];
  const large = share(tiers.find(t => record(t) && t.key === "large"));
  // A usable verdict must carry the number it vouches for; otherwise the cell would show a
  // blank as if it were a reading.
  if (raw.usable && (!large || large.adv_pct === null)) return null;
  const sourceAge = num(raw.source_age_min) ? raw.source_age_min : null;
  const stale = raw.usable && breadthTooOld(builtAt, sourceAge, now);
  const usable = raw.usable && !stale;
  const reason = typeof raw.unusable_reason === "string" && /^[a-z0-9_]{1,64}$/.test(raw.unusable_reason)
    ? raw.unusable_reason : "unknown";
  return {
    schema: "mmx.market_breadth.v1",
    asof: raw.asof,
    built_at: builtAt,
    source_age_min: sourceAge,
    session: raw.session as BreadthSession,
    delay_min: num(raw.delay_min) && raw.delay_min >= 0 ? raw.delay_min : null,
    usable,
    unusable_reason: usable ? null : stale ? "source_stale" : reason,
    coverage_pct: record(raw.coverage) ? pct(raw.coverage.pct) : null,
    // Numbers leave the proxy only with a verdict that vouches for them.
    large: usable ? large : null,
    comp: usable ? share(raw.comp) : null,
  };
}

/** The proxy's own answer, re-checked on the client: the page can render long after the proxy
 *  answered, so the live window is applied again against the reader's clock. */
export function marketBreadthPayload(value: unknown, now: Date): MarketBreadth | null {
  if (!record(value) || value.schema !== "mmx.market_breadth.v1") return null;
  const tiers = record(value.large) ? [{ ...value.large, key: "large" }] : [];
  return projectBreadth({ ...value, schema: UPSTREAM_SCHEMA, tiers, coverage: { pct: value.coverage_pct } }, now);
}
