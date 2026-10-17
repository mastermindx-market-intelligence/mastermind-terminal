/** Closed presentation decoder. No scoring, entitlement or financial computation. */
export const CATALYST_SCHEMA = "catalyst_opportunity.v1" as const;
export const AUTHORITY_KEYS = ["can_rank", "can_size", "can_gate", "can_originate_signal", "can_escalate"] as const;
export type ResearchAuthority = Record<typeof AUTHORITY_KEYS[number], false>;
export type CatalystStatus = "ready" | "empty" | "partial" | "stale" | "unavailable";
export type ThemeLabel = "emerging" | "dominant" | "fading" | "deteriorating" | "neutral";
export type ThemeHeat = "heating" | "hot" | "cooling" | "broken" | "neutral" | "idle" | null;
export type Freshness = "stale" | "current_daily";
export type MissingAssessment = { status: "unavailable"; reason: string; summary: string; summary_zh: string };
export type CatalystCase = {
  id: string; theme_id: string; name: string; name_zh: string; category: string;
  sector: "defense" | "energy" | "other"; origin: "market";
  discovery_state: "provisional_watch"; watch_kind: "emerging_watch" | "leadership_watch";
  source_label: ThemeLabel; source_heat: ThemeHeat; observation_status: Freshness;
  observed_on: string; precision: "date"; title: string; summary: string; summary_zh: string;
  metrics: Record<MetricKey, number | null>;
  event: MissingAssessment; economics: MissingAssessment; entry: MissingAssessment;
  cautions: { code: string; text: string; text_zh: string }[];
  links: { label: string; label_zh: string; href: string }[];
  source_refs: { owner: "sector_pulse"; theme_id: string; as_of: string }[];
  authority: ResearchAuthority;
};
export type InventoryTheme = { theme_id: string; name: string; name_zh: string; source_label: ThemeLabel; source_heat: ThemeHeat; watch: boolean };
export type CatalystView = {
  schema: typeof CATALYST_SCHEMA; policy_version: "sector_pulse_attention/1";
  generation: string; assessed_at: string; as_of: string | null; status: CatalystStatus;
  reason_codes: string[];
  source: { owner: "sector_pulse"; reference: string; as_of: string; precision: "date";
    received_at: string; age_calendar_days: number; freshness: Freshness;
    freshness_policy: string; historical_availability_proven: false; content_sha256?: string } | null;
  coverage: { scope: "us_curated_themes"; declared: number | null; observed: number; valid: number;
    refused: number; watch_count: number; complete: boolean; not_all_securities: true };
  cases: CatalystCase[]; inventory: InventoryTheme[]; authority: ResearchAuthority;
  disclaimer: string; disclaimer_zh: string;
};
const METRICS = ["rel_5d", "pct50", "rank", "rank_delta_1d", "rank_delta_5d", "rank_delta_20d", "score_delta_5d", "score_delta_20d", "momentum_score"] as const;
export type MetricKey = typeof METRICS[number];
const LABELS = ["emerging", "dominant", "fading", "deteriorating", "neutral"] as const;
const HEATS = ["heating", "hot", "cooling", "broken", "neutral", "idle"] as const;
const LINKS = new Set(["https://www.mastermind-x.com/baskets.html", "https://www.mastermind-x.com/government_revenue.html"]);
const ID = /^[a-z][a-z0-9_]{0,95}$/;
export class CatalystDecodeError extends Error {
  constructor() { super("CATALYST_INVALID_RESPONSE"); }
}
function fail(): never { throw new CatalystDecodeError(); }
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : fail();
}
function text(value: unknown, max = 500): string {
  return typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f]/.test(value) ? value : fail();
}
function item<T extends string>(value: unknown, choices: readonly T[]): T {
  return typeof value === "string" && choices.includes(value as T) ? value as T : fail();
}
function boolean(value: unknown): boolean { return typeof value === "boolean" ? value : fail(); }
function integer(value: unknown, max = 1024): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max ? value : fail();
}
function array(value: unknown, max = 1024): unknown[] { return Array.isArray(value) && value.length <= max ? value : fail(); }
function identifier(value: unknown): string { const s = text(value, 96); return ID.test(s) ? s : fail(); }
function date(value: unknown): string {
  const s = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return fail();
  const time = Date.parse(s + "T00:00:00Z");
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === s ? s : fail();
}
function utc(value: unknown): string {
  const s = text(value, 30);
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s.replace("Z", ".000Z") ? s : fail();
}
function authority(value: unknown): ResearchAuthority {
  const obj = object(value);
  if (Object.keys(obj).length !== AUTHORITY_KEYS.length || AUTHORITY_KEYS.some(k => obj[k] !== false)) return fail();
  return Object.fromEntries(AUTHORITY_KEYS.map(k => [k, false])) as ResearchAuthority;
}
function heat(value: unknown): ThemeHeat { return value === null ? null : item(value, HEATS); }
function missing(value: unknown): MissingAssessment {
  const obj = object(value);
  return { status: item(obj.status, ["unavailable"]), reason: text(obj.reason, 80), summary: text(obj.summary), summary_zh: text(obj.summary_zh) };
}
function metrics(value: unknown): CatalystCase["metrics"] {
  const obj = object(value), result = {} as CatalystCase["metrics"];
  for (const key of METRICS) {
    const v = obj[key];
    if (v !== null && (typeof v !== "number" || !Number.isFinite(v))) return fail();
    if (typeof v === "number") {
      if (key === "pct50" && (v < 0 || v > 1)) return fail();
      if (key === "momentum_score" && (v < -1 || v > 1)) return fail();
      if ((key === "rank" || key.startsWith("rank_delta")) && !Number.isSafeInteger(v)) return fail();
      if (key === "rank" && v < 1) return fail();
    }
    result[key] = v as number | null;
  }
  return result;
}
function decodeCase(value: unknown, asOf: string, freshness: Freshness): CatalystCase {
  const r = object(value), theme = identifier(r.theme_id), id = text(r.id, 120);
  if (id !== `co:market:${theme}` || date(r.observed_on) !== asOf || r.observation_status !== freshness) return fail();
  return {
    id, theme_id: theme, name: text(r.name, 240), name_zh: text(r.name_zh, 240), category: text(r.category, 240),
    sector: item(r.sector, ["defense", "energy", "other"]), origin: item(r.origin, ["market"]),
    discovery_state: item(r.discovery_state, ["provisional_watch"]), watch_kind: item(r.watch_kind, ["emerging_watch", "leadership_watch"]),
    source_label: item(r.source_label, LABELS), source_heat: heat(r.source_heat), observation_status: freshness,
    observed_on: asOf, precision: item(r.precision, ["date"]), title: text(r.title, 240), summary: text(r.summary), summary_zh: text(r.summary_zh),
    metrics: metrics(r.metrics), event: missing(r.event), economics: missing(r.economics), entry: missing(r.entry),
    cautions: array(r.cautions, 10).map(v => { const c = object(v); return {code:text(c.code, 80), text:text(c.text), text_zh:text(c.text_zh)}; }),
    links: array(r.links, 3).map(v => { const l = object(v), href = text(l.href, 160); if (!LINKS.has(href)) return fail(); return {label:text(l.label,80), label_zh:text(l.label_zh,80), href}; }),
    source_refs: array(r.source_refs, 2).map(v => { const s = object(v); if (s.theme_id !== theme || date(s.as_of) !== asOf) return fail(); return {owner:item(s.owner,["sector_pulse"]), theme_id:theme, as_of:asOf}; }),
    authority: authority(r.authority),
  };
}

/** Strip unknown fields and refuse unsupported/widened semantics. */
export function decodeCatalystView(value: unknown): CatalystView {
  const r = object(value), c = object(r.coverage);
  const status = item(r.status, ["ready", "empty", "partial", "stale", "unavailable"]);
  const asOf = r.as_of === null ? null : date(r.as_of);
  const assessed = utc(r.assessed_at), generation = text(r.generation, 67);
  if (!/^co:[0-9a-f]{64}$/.test(generation)) return fail();
  let source: CatalystView["source"] = null;
  if (r.source !== null) {
    const s = object(r.source);
    if (date(s.as_of) !== asOf || s.historical_availability_proven !== false) return fail();
    const receipt = utc(s.received_at);
    if (Date.parse(receipt) > Date.parse(assessed)) return fail();
    source = {owner:item(s.owner,["sector_pulse"]), reference:text(s.reference,240), as_of:asOf!, precision:item(s.precision,["date"]),
      received_at:receipt, age_calendar_days:integer(s.age_calendar_days, 100000), freshness:item(s.freshness,["stale","current_daily"]),
      freshness_policy:text(s.freshness_policy,240), historical_availability_proven:false};
    if (s.content_sha256 !== undefined) { const hash = text(s.content_sha256,64); if (!/^[0-9a-f]{64}$/.test(hash)) return fail(); source.content_sha256 = hash; }
  }
  const coverage: CatalystView["coverage"] = {scope:item(c.scope,["us_curated_themes"]), declared:c.declared === null ? null : integer(c.declared),
    observed:integer(c.observed), valid:integer(c.valid), refused:integer(c.refused), watch_count:integer(c.watch_count), complete:boolean(c.complete), not_all_securities:true};
  if (c.not_all_securities !== true || coverage.valid + coverage.refused !== coverage.observed) return fail();
  const inventory = array(r.inventory).map(v => {const t = object(v); return {theme_id:identifier(t.theme_id),name:text(t.name,240),name_zh:text(t.name_zh,240),source_label:item(t.source_label,LABELS),source_heat:heat(t.source_heat),watch:boolean(t.watch)};});
  const rawCases = array(r.cases);
  if ((rawCases.length > 0 && (!source || !asOf)) || (source === null) !== (asOf === null)) return fail();
  const cases = rawCases.map(v => decodeCase(v, asOf!, source!.freshness));
  const ids = new Set(inventory.map(t=>t.theme_id)), caseIds = new Set(cases.map(t=>t.theme_id));
  if (ids.size !== inventory.length || caseIds.size !== cases.length || inventory.length !== coverage.valid || cases.length !== coverage.watch_count) return fail();
  for (const t of inventory) if (t.watch !== caseIds.has(t.theme_id)) return fail();
  for (const candidate of cases) {
    const t = inventory.find(t=>t.theme_id === candidate.theme_id);
    if (!t || t.source_label !== candidate.source_label || t.source_heat !== candidate.source_heat) return fail();
  }
  if (coverage.complete && (coverage.declared !== coverage.valid || coverage.refused !== 0)) return fail();
  if (status === "unavailable" && (source !== null || inventory.length !== 0 || cases.length !== 0 || coverage.complete)) return fail();
  if (status !== "unavailable" && source === null) return fail();
  if (status === "stale" && source?.freshness !== "stale") return fail();
  if (status !== "stale" && source?.freshness === "stale") return fail();
  if (status === "empty" && cases.length > 0) return fail();
  if (status === "ready" && (cases.length === 0 || !coverage.complete)) return fail();
  return {schema:item(r.schema,[CATALYST_SCHEMA]),policy_version:item(r.policy_version,["sector_pulse_attention/1"]),generation,
    assessed_at:assessed,as_of:asOf,status,reason_codes:array(r.reason_codes,10).map(v=>text(v,80)),source,coverage,cases,inventory,
    authority:authority(r.authority),disclaimer:text(r.disclaimer),disclaimer_zh:text(r.disclaimer_zh)};
}
