/** Four-universe Entry evidence — pure model (no React).
 *
 * Incumbent Macro confluence semantics, reproduced exactly from the LIVE
 * owner payloads (site/marketdata/subsector_confluence{,_nasdaq,_russell}.json,
 * basket_confluence.json) and engine/subsector_confluence.py: four INDEPENDENT
 * universes (S&P 500 subsectors · Nasdaq-100 groups · Russell-2000 groups ·
 * thematic baskets), each with its own engine. Universes are NEVER merged and
 * there is no client fallback across them — every value rendered comes only
 * from the universe's own payload.
 *
 * Real payload contract per universe:
 *   UniverseData { ok, universe, weighting, benchmark?, region?, as_of
 *   (NULLABLE — nasdaq carries null), coverage, entry_now/forming/headwind
 *   (group-KEY arrays), subsectors[] (SP/Russell) OR baskets[] (baskets) —
 *   scored/gateable rows ONLY; thin/below-min groups are COUNTED in coverage,
 *   never table rows, double_gated?, notes?, generated_utc? }.
 *   The table array is exposed through groupsOf(); league keys resolve to
 *   groups ONLY from the same universe's array (key arrays, not objects).
 *
 * The engine's table list is "scored rows only": groups absent from the
 * scored array are neither fabricated nor inferred from the league key lists.
 */

export type UniverseId = "subsectors" | "nasdaq" | "russell" | "baskets";

/** Real engine class values (entry.class). */
export type UniverseClass =
  | "entry_now"
  | "forming"
  | "tailwind"
  | "neutral"
  | "late"
  | "headwind";

export type ReliabilityTier = "high" | "med" | "low";

export interface UniverseMember {
  ticker: string;
  name_zh?: string | null;
  price: number;
  ret_20d: number;
  vs_basket: number;
  stock_tier?: string | null;
  stock_weight: number;
  stock_ticks?: number | null;
  stock_bars_to_cross?: number | null;
  stock_buyable: boolean;
  stock_state: string;
  /** Independent-emergence marker (v1.1, R6-09 "Company strength is early"):
   * true ONLY when the owner engine flags this member — strength that stands
   * apart from the universe's own timing read; components never derive it
   * from return/RS/tier, and it never changes timing classification or
   * gateable counts. Absent/null = not flagged. */
  emerging?: boolean | null;
  /** Company-evidence destination for an emerging member, used EXACTLY as
   * carried; absent/null on every other member and whenever the owner
   * publishes no distinct route. */
  emergence_href?: string | null;
}

export interface UniverseEntry {
  tier: string;
  weight: number;
  tier_sub?: string | null;
  /** Non-null once the tier has fired; 0 = just fired. */
  ticks: number | null;
  bars_to_cross?: number | null;
  fresh_bars?: number | null;
  eligible: boolean;
  buyable: boolean;
  above200: boolean;
  reason?: string | null;
}

export interface UniverseRegime {
  state: string;
  /** "buy" | "sell" | …; colours (if any) key off this, never language. */
  side: string;
  label: string;
  label_zh?: string | null;
  action?: string | null;
  action_zh?: string | null;
  /** 60-session relative strength vs the universe benchmark (incumbent RS60
   * column); null when the payload does not carry it. */
  rs_60d?: number | null;
}

/** The incumbent RS60 column value; null stays null (missing ≠ 0). */
export function rs60Of(group: UniverseGroup): number | null {
  const v = group.regime?.rs_60d;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export interface UniverseGroup {
  key: string;
  kind?: string;
  label: string;
  /** NULLABLE — EN fallback when absent. */
  label_zh?: string | null;
  sector: string;
  sector_zh?: string | null;
  n_members: number;
  n_priced: number;
  /** Per-group source of truth; never recomputed from thresholds. */
  reliability: ReliabilityTier;
  coverage_pct?: number | null;
  n_live?: number | null;
  start?: string | null;
  as_of?: string | null;
  price_level?: string | null;
  class: UniverseClass;
  entry: UniverseEntry;
  regime: UniverseRegime;
  members: UniverseMember[];
  basket_id?: string | null;
  chart_key?: string | null;
  has_signals?: boolean;
}

export interface UniverseCoverage {
  n_subsectors?: number;
  n_baskets?: number;
  n_listed?: number;
  n_gateable: number;
  n_thin: number;
  n_below_min_members: number;
  n_unscored: number;
  n_sectors?: number;
  /** Universe-level reliability counts (n_low_conf, not n_low). */
  n_high?: number;
  n_med?: number;
  n_low_conf?: number;
  thin_share?: number | null;
}

export interface UniverseData {
  ok: boolean;
  universe: string;
  weighting: string;
  benchmark?: string | null;
  region?: string | null;
  /** NULLABLE — nasdaq carries null; render without a date. */
  as_of: string | null;
  coverage: UniverseCoverage;
  /** Group-KEY arrays (leagues), not group objects. */
  entry_now?: string[];
  forming?: string[];
  headwind?: string[];
  /** SP/Russell carry `subsectors`; the baskets universe carries `baskets`. */
  subsectors?: UniverseGroup[];
  baskets?: UniverseGroup[];
  double_gated?: string[];
  notes?: string[];
  generated_utc?: string | null;
}

/** Fixed tab order. */
export const UNIVERSE_ORDER: readonly UniverseId[] = [
  "subsectors",
  "nasdaq",
  "russell",
  "baskets",
];

/** b) Engine _CLASS_ORDER exactly; unknown/missing class sorts last at 9. */
export const CLASS_ORDER: readonly UniverseClass[] = [
  "entry_now",
  "forming",
  "tailwind",
  "neutral",
  "late",
  "headwind",
];

/** Sort position the engine gives a class with no known order. */
export const UNKNOWN_CLASS_RANK = 9;

/** A group below this member count is "below the minimum" in coverage. */
export const MIN_MEMBERS = 3;

/** Fallback thresholds ONLY for a payload missing per-group reliability
 * (marked as a fallback; the payload field is the source of truth). */
export const RELIABLE_MIN = 12;
export const RELIABLE_MED = 6;

/** Lexicon keys for the six class labels (missing class renders "—"). */
export const CLASS_LABEL_KEYS: Record<UniverseClass, string> = {
  entry_now: "siUniverseClassEntry",
  forming: "siUniverseClassForming",
  tailwind: "siUniverseClassTailwind",
  neutral: "siUniverseClassNeutral",
  late: "siUniverseClassLate",
  headwind: "siUniverseClassHeadwind",
};

export const RELIABILITY_LABEL_KEYS: Record<ReliabilityTier, string> = {
  high: "siUniverseReliabilityHigh",
  med: "siUniverseReliabilityMed",
  low: "siUniverseReliabilityLow",
};

/** Coverage ribbon order (B01): the five READING classes, entry first. The
 * forming tier is a setup state, not a reading class, so it is not ribboned. */
export const RIBBON_ORDER: readonly UniverseClass[] = [
  "entry_now",
  "tailwind",
  "neutral",
  "late",
  "headwind",
];

/** Count scored groups per known class. Every RIBBON_ORDER class reports a
 * count (0 included) so the ribbon never hides a measured zero; an unknown
 * class word is not ribboned — it stays visible on its own row/badge. */
export function classCounts(
  groups: readonly UniverseGroup[],
): Record<UniverseClass, number> {
  const out: Record<UniverseClass, number> = {
    entry_now: 0,
    forming: 0,
    tailwind: 0,
    neutral: 0,
    late: 0,
    headwind: 0,
  };
  for (const g of groups) {
    if (Object.prototype.hasOwnProperty.call(out, g.class)) {
      out[g.class as UniverseClass] += 1;
    }
  }
  return out;
}

/** Baskets carry no equity benchmark; the source-identity line names the
 * equal-weight basket complex instead, through the lexicon key
 * siUniverseBasketBenchmark (review S5 — never a raw English literal in the
 * ZH surface). */

export interface UniverseMeta {
  id: UniverseId;
  /** Tab label key. */
  tabKey: string;
  /** Population noun key ("subsectors" / "baskets"). */
  nounKey: string;
  /** Filter placeholder key. */
  filterPlaceholderKey: string;
  /** Label-column header key. */
  labelColKey: string;
  /** Lane-column header key (Sector / Category). */
  laneColKey: string;
  /** Benchmark label key; null for baskets (no equity benchmark). */
  benchmarkKey: string | null;
  /** Which array the universe's scored groups live in. */
  groupsKey: "subsectors" | "baskets";
}

export const UNIVERSES: Record<UniverseId, UniverseMeta> = {
  subsectors: {
    id: "subsectors",
    tabKey: "siUniverseSp500",
    nounKey: "siUniverseSubsectors",
    filterPlaceholderKey: "siUniverseFilterPlaceholderSp",
    labelColKey: "siUniverseColLabel",
    laneColKey: "siUniverseColSector",
    benchmarkKey: "siUniverseBenchmarkSp500",
    groupsKey: "subsectors",
  },
  nasdaq: {
    id: "nasdaq",
    tabKey: "siUniverseNasdaq",
    nounKey: "siUniverseSubsectors",
    filterPlaceholderKey: "siUniverseFilterPlaceholderSp",
    labelColKey: "siUniverseColLabel",
    laneColKey: "siUniverseColSector",
    benchmarkKey: "siUniverseBenchmarkNasdaq",
    groupsKey: "subsectors",
  },
  russell: {
    id: "russell",
    tabKey: "siUniverseRussell",
    nounKey: "siUniverseSubsectors",
    filterPlaceholderKey: "siUniverseFilterPlaceholderSp",
    labelColKey: "siUniverseColLabel",
    laneColKey: "siUniverseColSector",
    benchmarkKey: "siUniverseBenchmarkRussell",
    groupsKey: "subsectors",
  },
  baskets: {
    id: "baskets",
    tabKey: "siUniverseBaskets",
    nounKey: "siUniverseBasketsNoun",
    filterPlaceholderKey: "siUniverseFilterPlaceholderBk",
    labelColKey: "siUniverseColLabelBasket",
    laneColKey: "siUniverseColCategory",
    benchmarkKey: null,
    groupsKey: "baskets",
  },
};

/** The owner vocabulary word each tab's payload must carry (review R2-S1).
 * The tab and the word are 1:1 — a payload whose `universe` string names
 * another universe is NOT this tab's data (a mis-keyed mount), and both the
 * tabling and the presence classification refuse it: the panel shows its
 * honest unavailable state instead of the other universe's rows. */
const UNIVERSE_OWNER_WORD: Record<UniverseId, string> = {
  subsectors: "sp500_subsectors",
  nasdaq: "nasdaq_subsectors",
  russell: "russell_subsectors",
  baskets: "curated_baskets",
};

/** True when the payload's own `universe` owner word is the one this tab's
 * contract carries (review R2-S1). An unknown word is a mismatch: only the
 * four words above exist on the wire. */
export function universeWordMatches(
  id: UniverseId,
  data: UniverseData | null | undefined,
): boolean {
  return !!data && data.universe === UNIVERSE_OWNER_WORD[id];
}

/** The universe's scored/gateable rows — the ONLY rows ever tabled.
 *
 * The array is chosen from the TAB id the parent passes (the UniverseId this
 * panel was mounted for), NEVER from the payload's own `data.universe` string:
 * the real owner files carry `sp500_subsectors` / `nasdaq_subsectors` /
 * `russell_subsectors` / `curated_baskets` — owner vocabulary that is not the
 * tab id set, so keying on it silently fell back to `subsectors` and rendered
 * the 49-group baskets file as "no groups" (review S1). The payload string is
 * informational for CHOOSING the array, but binding for IDENTITY (R2-S1): a
 * payload whose word disagrees with the tab is refused — zero rows tabled. */
export function groupsOf(
  id: UniverseId,
  data: UniverseData | null | undefined,
): UniverseGroup[] {
  if (!data) return [];
  if (data.universe !== UNIVERSE_OWNER_WORD[id]) return [];
  const key = UNIVERSES[id]?.groupsKey ?? "subsectors";
  const groups = (data as Partial<Record<"subsectors" | "baskets", UniverseGroup[]>>)[key];
  return Array.isArray(groups) ? groups : [];
}

/** League membership is resolved ONLY within the same universe's group array
 * (the payload's key arrays reference their own universe's keys). */
function keySet(keys: string[] | null | undefined): Set<string> {
  return new Set(Array.isArray(keys) ? keys : []);
}

/** League keys, absent universes excluded. */
export function leagueKeys(data: UniverseData): {
  entry_now: Set<string>;
  forming: Set<string>;
  headwind: Set<string>;
} {
  return {
    entry_now: keySet(data.entry_now),
    forming: keySet(data.forming),
    headwind: keySet(data.headwind),
  };
}

/** b) Engine default order: _CLASS_ORDER rank, unknown class → 9, stable.
 * The declared payload type is UniverseClass; a stray producer value (class
 * reclassified between sessions) still sorts last at 9. */
export function classRank(cls: string | null | undefined): number {
  if (cls == null) return UNKNOWN_CLASS_RANK;
  const idx = (CLASS_ORDER as readonly string[]).indexOf(cls);
  return idx === -1 ? UNKNOWN_CLASS_RANK : idx;
}

/** Decorated stable sort: ties keep source (owner) order; never mutates. */
function stableSorted(
  groups: readonly UniverseGroup[],
  compare: (a: UniverseGroup, b: UniverseGroup) => number,
): UniverseGroup[] {
  const list = Array.isArray(groups) ? groups : [];
  return list
    .map((group, index) => ({ group, index }))
    .sort((a, b) => compare(a.group, b.group) || a.index - b.index)
    .map((entry) => entry.group);
}

/** b) Default view order: entry tier ascending, unknown last, source order
 * kept within a tier. Returns a copy; the source array is untouched. */
export function defaultSort(groups: readonly UniverseGroup[]): UniverseGroup[] {
  return stableSorted(groups, (a, b) => classRank(a.class) - classRank(b.class));
}

/** b) Local column sort: label, case-insensitive alphabetical. Copy. */
export function sortByLabel(groups: readonly UniverseGroup[]): UniverseGroup[] {
  return stableSorted(groups, (a, b) => {
    const an = a.label.toLowerCase();
    const bn = b.label.toLowerCase();
    return an < bn ? -1 : an > bn ? 1 : 0;
  });
}

/** b) Local column sort: RS60 (regime-strength, descending), nulls last. Copy. */
export function sortByRs60Desc(
  groups: readonly UniverseGroup[],
): UniverseGroup[] {
  return stableSorted(groups, (a, b) => {
    const av = rs60Of(a);
    const bv = rs60Of(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return bv - av;
  });
}

/** b) Local column sort: priced-name count descending. Copy. */
export function sortByMembersDesc(
  groups: readonly UniverseGroup[],
): UniverseGroup[] {
  return stableSorted(groups, (a, b) => b.n_priced - a.n_priced);
}

export type UniverseSortKey = "tier" | "label" | "rs60" | "n_members";

export function sortGroups(
  groups: readonly UniverseGroup[],
  key: UniverseSortKey,
): UniverseGroup[] {
  switch (key) {
    case "label":
      return sortByLabel(groups);
    case "rs60":
      return sortByRs60Desc(groups);
    case "n_members":
      return sortByMembersDesc(groups);
    case "tier":
    default:
      return defaultSort(groups);
  }
}

/** c) Coverage read: total = n_subsectors ?? n_baskets ?? n_listed, plus the
 * gateable / thin (counted, not timed) / below-minimum (min 3) / unscored
 * figures, the priced count and the universe reliability counts.
 *
 * ABSENT-IS-NOT-ZERO (review N1): an absent count stays null — "not stated" —
 * and never renders as 0. A carried 0 is a measured zero and renders as 0;
 * the two are kept structurally distinct exactly like a null flow reading. */
export interface CoverageModel {
  total: number | null;
  basis: "n_subsectors" | "n_baskets" | "n_listed" | null;
  gateable: number | null;
  thin: number | null;
  belowMin: number | null;
  unscored: number | null;
  /** Alias of gateable (same field, same null law). */
  scored: number | null;
  minMembers: number;
  high: number | null;
  med: number | null;
  lowConf: number | null;
}

function countOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function coverageModel(
  coverage: Partial<UniverseCoverage> | null | undefined,
): CoverageModel {
  const c: Partial<UniverseCoverage> = coverage ?? {};
  // N1: the denominator obeys the same law as every other count — absent OR
  // non-numeric means not stated (null), never a coerced or invented number.
  const total = countOrNull(c.n_subsectors ?? c.n_baskets ?? c.n_listed ?? null);
  const basis =
    c.n_subsectors != null
      ? "n_subsectors"
      : c.n_baskets != null
        ? "n_baskets"
        : c.n_listed != null
          ? "n_listed"
          : null;
  const gateable = countOrNull(c.n_gateable);
  return {
    total,
    basis,
    gateable,
    thin: countOrNull(c.n_thin),
    belowMin: countOrNull(c.n_below_min_members),
    unscored: countOrNull(c.n_unscored),
    scored: gateable,
    minMembers: MIN_MEMBERS,
    high: countOrNull(c.n_high),
    med: countOrNull(c.n_med),
    lowConf: countOrNull(c.n_low_conf),
  };
}

/** d) Per-group reliability: the payload field is the source of truth. The
 * threshold recompute is a FALLBACK for a payload missing (or carrying an
 * unrecognized) reliability value. */
export function groupReliability(
  group: { reliability?: ReliabilityTier | string | null; n_priced?: number | null },
): { tier: ReliabilityTier; fallback: boolean } {
  const r = group.reliability;
  if (r === "high" || r === "med" || r === "low") {
    return { tier: r, fallback: false };
  }
  const n = group.n_priced ?? 0;
  return {
    tier: n >= RELIABLE_MIN ? "high" : n >= RELIABLE_MED ? "med" : "low",
    fallback: true,
  };
}

export function reliability(nPriced: number | null | undefined): ReliabilityTier {
  const n = nPriced ?? 0;
  if (n >= RELIABLE_MIN) return "high";
  if (n >= RELIABLE_MED) return "med";
  return "low";
}

/** e) Case-insensitive substring filter over EN+ZH label and sector. Empty
 * text → all. */
export interface FilterResult {
  matches: UniverseGroup[];
  count: number;
  total: number;
}

export function filterGroups(
  groups: readonly UniverseGroup[] | null | undefined,
  text: string | null | undefined,
): FilterResult {
  const all = Array.isArray(groups) ? groups : [];
  const q = (text ?? "").trim().toLowerCase();
  if (!q) return { matches: all.slice(), count: all.length, total: all.length };
  const matches = all.filter((g) => {
    const label = (g.label || "").toLowerCase();
    const labelZh = (g.label_zh || "").toLowerCase();
    const sector = (g.sector || "").toLowerCase();
    return label.includes(q) || labelZh.includes(q) || sector.includes(q);
  });
  return { matches, count: matches.length, total: all.length };
}

/** 3) Template freshness logic exactly: tier T3/T4 → about-to-fire; else
 * ticks != null → 0 = just fired, n = fired n bars ago; else none. */
export type FreshnessKind = "about_to_fire" | "just_fired" | "fired_ago" | "none";

export interface FreshnessRead {
  kind: FreshnessKind;
  /** Copy key + params for the renderer. */
  key: string;
  params?: Record<string, string | number>;
}

export function freshnessOf(group: UniverseGroup): FreshnessRead {
  const e = group.entry;
  if (e && (e.tier === "T3" || e.tier === "T4")) {
    return { kind: "about_to_fire", key: "siUniverseFreshAboutTo" };
  }
  if (e && e.ticks != null) {
    return e.ticks === 0
      ? { kind: "just_fired", key: "siUniverseFreshJustFired" }
      : { kind: "fired_ago", key: "siUniverseFreshFiredAgo", params: { n: e.ticks } };
  }
  return { kind: "none", key: "siUniverseFreshNone" };
}

/** Legacy alias kept for callers that read freshness off a group. */
export function freshnessLabel(group: UniverseGroup): FreshnessRead {
  return freshnessOf(group);
}

/** g) Members preview: first MEMBERS_PREVIEW, expandable to all. Payload
 * order IS the owner order — preserved exactly, never re-sorted here. */
export const MEMBERS_PREVIEW = 5;

export interface MembersPreview {
  shown: UniverseMember[];
  hidden: number;
}

export function membersPreview(
  members: readonly UniverseMember[] | null | undefined,
  expanded: boolean,
): MembersPreview {
  const all = Array.isArray(members) ? members : [];
  const shown =
    expanded || all.length <= MEMBERS_PREVIEW ? all.slice() : all.slice(0, MEMBERS_PREVIEW);
  const hidden = expanded ? 0 : Math.max(0, all.length - MEMBERS_PREVIEW);
  return { shown, hidden };
}

/** h) The buy-timing view: entry_now + forming groups. */
export function buyableNow(groups: readonly UniverseGroup[]): UniverseGroup[] {
  const all = Array.isArray(groups) ? groups : [];
  return all.filter((g) => g.class === "entry_now" || g.class === "forming");
}

/** h) The full classified table: every scored group, source order preserved. */
export function rotationRead(groups: readonly UniverseGroup[]): UniverseGroup[] {
  const all = Array.isArray(groups) ? groups : [];
  return all.slice();
}

/** Per-universe presence classification. The three "nothing to show" states
 * are distinct: a universe can be absent from the payload (not carried),
 * present but access-gated (source requires access the reading lacks), or
 * live with zero scored groups tonight. A payload whose owner word names a
 * DIFFERENT universe (R2-S1, mis-keyed mount) classifies as absent — the
 * honest unavailable state, never the other universe's rows. */
export type UniversePresence = "absent" | "no_access" | "zero_groups" | "live";

export function universePresence(
  id: UniverseId,
  data: UniverseData | null | undefined,
): UniversePresence {
  if (!data) return "absent";
  if (data.universe !== UNIVERSE_OWNER_WORD[id]) return "absent";
  if (data.ok === false) return "no_access";
  const groups = groupsOf(id, data);
  if (groups.length === 0) return "zero_groups";
  return "live";
}

/** i) Per-universe UI state isolation: each tab keeps its own selected view,
 * filter text, table sort and expanded-group set, so switching tabs never
 * leaks state between universes. */
export type UniverseView = "buyable" | "rotation";

export interface UniverseUiState {
  view: UniverseView;
  filter: string;
  sort: UniverseSortKey;
  expanded: Record<string, boolean>;
}

export type UniverseUiStates = Record<UniverseId, UniverseUiState>;

export function initialUiStates(): UniverseUiStates {
  const states = {} as UniverseUiStates;
  for (const id of UNIVERSE_ORDER) {
    states[id] = { view: "rotation", filter: "", sort: "tier", expanded: {} };
  }
  return states;
}

export function patchUiState(
  states: UniverseUiStates,
  id: UniverseId,
  patch: Partial<Pick<UniverseUiState, "view" | "filter" | "sort">>,
): UniverseUiStates {
  return { ...states, [id]: { ...states[id], ...patch } };
}

export function toggleExpanded(
  states: UniverseUiStates,
  id: UniverseId,
  groupKey: string,
): UniverseUiStates {
  const current = states[id].expanded ?? {};
  return {
    ...states,
    [id]: { ...states[id], expanded: { ...current, [groupKey]: !current[groupKey] } },
  };
}
