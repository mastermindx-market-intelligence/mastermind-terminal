/** Presentation boundary for the incumbent, entitled Defense Economics owner.
 * The Macro owner validates its canonical artifact and interpretation. This
 * decoder adds bounded display, identity, source-reference and clock checks;
 * it is not a replacement source-admission or financial-calculation engine.
 */
import { AUTHORITY_KEYS } from "./catalystOpportunity";

export const DEFENSE_COHORT = ["LMT", "RTX", "NOC", "LHX"] as const;
export const DEFENSE_AXES = ["participation", "demand", "economics", "recognition"] as const;
export type DefenseTicker = typeof DEFENSE_COHORT[number];
export type DefenseAxisName = typeof DEFENSE_AXES[number];
const STATES = ["supported", "partial", "stale", "missing_owner", "unreviewed", "contradictory", "not_comparable", "unavailable"] as const;
export type DefenseState = typeof STATES[number];
export type DefenseFact = {
  fact_id: string; value: number | string; unit: string; period: string;
  accounting_basis: string; fact_class: string; owner_ref: string;
  source_span: { receipt_state: "byte_replayed"; text_sha256: string; document_id: string; source_url?: string; span_id?: string };
};
export type DefenseChain = {
  stage: "demand" | "capture" | "margin" | "common_cash";
  state: "unknown" | "reported" | "conditional"; summary_en: string; summary_zh: string;
  fact_refs: { fact_id: string; owner_ref: string }[]; owner_refs: string[];
};
export type DefenseScenario = {
  kind: "conditional_baseline" | "downside"; assumption_en: string; assumption_zh: string;
  implication_en: string; implication_zh: string; invalidation_en: string; invalidation_zh: string;
  fact_refs: { fact_id: string; owner_ref: string }[]; owner_refs: string[];
};
export type DefenseAxis = {
  state: DefenseState; summary_en: string; summary_zh: string; observed_at: string | null;
  owner_ref: string | null; evidence_refs: string[]; facts: DefenseFact[];
};
export type DefenseProfile = {
  ticker_display: DefenseTicker; name: string; issuer_id: string | null; security_id: string | null;
  identity_mode: "current" | null; identity_owner_ref: string | null;
  axes: Record<DefenseAxisName, DefenseAxis>;
  interpretation?: { schema: "defense_economic_interpretation.v1"; chain: DefenseChain[]; scenarios: DefenseScenario[]; unknowns: string[] } | null;
  contrary_case: string | null; contrary_case_zh: string | null;
  next_condition: string | null; next_condition_zh: string | null;
  invalidation: string | null; invalidation_zh: string | null;
};
export type DefenseContext = {
  contract: "defense_economics.v1"; schema_version: "1.0.0"; content_id: string; generated_at: string;
  source_bindings: Record<string, Record<string, unknown>>; profiles: DefenseProfile[];
};
export class DefenseDecodeError extends Error { constructor() { super("DEFENSE_CONTEXT_INVALID"); } }
const fail = (): never => { throw new DefenseDecodeError(); };
const obj = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : fail();
const text = (v: unknown, max = 2000): string => typeof v === "string" && v.length > 0 && v.length <= max && !/[\u0000-\u001f]/.test(v) ? v : fail();
const list = (v: unknown, max = 128): unknown[] => Array.isArray(v) && v.length <= max ? v : fail();
function choice(v: unknown, values: readonly string[]): string { const s = text(v, 100); return values.includes(s) ? s : fail(); }
function authority(v: unknown): void {
  const a = obj(v);
  if (Object.keys(a).length !== 6 || a.context_only !== true || AUTHORITY_KEYS.some(k => a[k] !== false)) fail();
}
function instant(v: unknown): number {
  const s = text(v, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(s)) return fail();
  const n = Date.parse(s), date = s.slice(0,10), midnight = Date.parse(date + "T00:00:00Z");
  if (!Number.isFinite(n) || !Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0,10) !== date) return fail();
  return n;
}
function sourceUrl(v: unknown): void {
  const url = new URL(text(v, 1500));
  const sec = ["www.sec.gov", "sec.gov"].includes(url.hostname) && url.pathname.startsWith("/Archives/edgar/data/");
  const issuer = url.hostname === "investors.l3harris.com" && url.pathname.startsWith("/news/news-details/");
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash || url.search || (!sec && !issuer)) fail();
}
function sameSubject(binding: Record<string, unknown>, profile: Record<string, unknown>): void {
  for (const k of ["issuer_id", "security_id"]) if (binding[k] !== profile[k]) fail();
}

/** Preserve the native owner payload and content id; never re-sign a projection. */
export function decodeDefenseContext(value: unknown, now = Date.now()): DefenseContext {
  const r = obj(value);
  if (r.contract !== "defense_economics.v1" || r.schema_version !== "1.0.0"
    || !/^dfe1-[0-9a-f]{24}$/.test(text(r.content_id, 29))) fail();
  authority(r.authority);
  const generated = instant(r.generated_at);
  if (!Number.isFinite(now) || generated > now) fail();
  const bindings = obj(r.source_bindings);
  if (Object.keys(bindings).length > 256) fail();
  const bound = (ref: unknown) => {
    const key = text(ref, 512);
    if (!Object.hasOwn(bindings, key)) return fail();
    return obj(bindings[key]);
  };
  for (const [key, raw] of Object.entries(bindings)) {
    text(key, 512); const b = obj(raw);
    if (!/^[0-9a-f]{64}$/.test(text(b.sha256,64))) fail();
    for (const key of ["observed_at", "source_available_at"]) if (b[key] !== undefined && instant(b[key]) > generated) fail();
    if (b.periods !== undefined) list(b.periods, 64).forEach(p => text(p,128));
  }
  const profiles = list(r.profiles, 4);
  if (profiles.length !== 4) fail();
  profiles.forEach((raw, index) => {
    const p = obj(raw); authority(p.authority);
    if (p.ticker_display !== DEFENSE_COHORT[index]) fail();
    text(p.name, 240);
    const identified = p.identity_mode === "current";
    if (identified) {
      text(p.issuer_id,256); text(p.security_id,256); sameSubject(bound(p.identity_owner_ref), p);
    } else if ([p.identity_mode,p.issuer_id,p.security_id,p.identity_owner_ref].some(v => v !== null)) fail();
    if (p.program_workshare !== null || p.program_workshare_state !== "not_disclosed") fail();
    const capture = obj(p.shareholder_capture);
    if (capture.state !== "not_asserted" || list(capture.source_refs,0).length !== 0) fail();
    for (const k of ["contrary_case", "next_condition", "invalidation"]) {
      for (const field of [k, `${k}_zh`]) if (p[field] !== null && p[field] !== undefined) text(p[field]);
    }
    const axes = obj(p.axes), facts = new Map<string, Record<string, unknown>>();
    for (const name of DEFENSE_AXES) {
      const a = obj(axes[name]); choice(a.state, STATES); text(a.summary_en); text(a.summary_zh);
      const available = ["supported", "partial", "stale"].includes(a.state as string);
      if (available && !identified) fail();
      if (a.observed_at !== null && instant(a.observed_at) > generated) fail();
      if (available && a.observed_at === null) fail();
      if (a.owner_ref !== null) sameSubject(bound(a.owner_ref),p);
      list(a.evidence_refs,128).forEach(ref => sameSubject(bound(ref),p));
      const sourceFacts = list(a.facts,128);
      if (name === "economics" && available && sourceFacts.length === 0) fail();
      sourceFacts.forEach(rawFact => {
        const f = obj(rawFact), id = text(f.fact_id,256), b = bound(f.owner_ref);
        sameSubject(b,p);
        if (b.owner_family !== "company_intelligence" || !list(b.periods,64).includes(f.period)) fail();
        for (const k of ["unit", "period", "accounting_basis", "fact_class"]) text(f[k],256);
        if (typeof f.value === "number" ? !Number.isFinite(f.value) : typeof f.value !== "string") fail();
        if (typeof f.value === "string") text(f.value);
        const span = obj(f.source_span);
        if (span.receipt_state !== "byte_replayed" || !/^[0-9a-f]{64}$/.test(text(span.text_sha256,64))) fail();
        text(span.document_id,256);
        if (span.source_url !== undefined) sourceUrl(span.source_url);
        if (name === "economics") { if (facts.has(id)) fail(); facts.set(id,f); }
      });
    }
    if (obj(axes.recognition).expectations_kind !== "not_observed") fail();
    const complete = identified && DEFENSE_AXES.every(k => obj(axes[k]).state === "supported");
    if (p.research_state !== (complete ? "SOURCE_CONTEXT_COMPLETE" : "EVIDENCE_INSUFFICIENT")) fail();
    if (p.interpretation !== null && p.interpretation !== undefined) {
      if (!identified || !["supported","partial","stale"].includes(obj(axes.economics).state as string)) fail();
      const i = obj(p.interpretation);
      if (i.schema !== "defense_economic_interpretation.v1") fail();
      const references = (row: Record<string,unknown>) => {
        list(row.fact_refs,128).forEach(v => { const ref=obj(v), fact=facts.get(text(ref.fact_id,256)); if (!fact || ref.owner_ref !== fact.owner_ref) fail(); });
        list(row.owner_refs,128).forEach(v => { sameSubject(bound(v),p); });
      };
      const chain = list(i.chain,4), stages = ["demand","capture","margin","common_cash"];
      if (chain.length !== 4) fail();
      chain.forEach((v,n) => { const c=obj(v); if (c.stage !== stages[n]) fail(); choice(c.state,["unknown","reported","conditional"]); text(c.summary_en,5000); text(c.summary_zh,5000); references(c); });
      const scenarios = list(i.scenarios,2);
      if (scenarios.length !== 2) fail();
      scenarios.forEach((v,n) => {
        const s=obj(v); if (s.kind !== ["conditional_baseline","downside"][n]) fail();
        for (const k of ["assumption_en","assumption_zh","implication_en","implication_zh","invalidation_en","invalidation_zh"]) text(s[k],5000);
        references(s);
      });
      list(i.unknowns,64).forEach(v => text(v,256));
    }
  });
  return value as DefenseContext;
}

export function defenseCoreFacts(profile: DefenseProfile): DefenseFact[] {
  // Exact incumbent fact ids, not a search by numeric value or a new calculation.
  const rows = ["defense_segment_sales", "defense_segment_operating_profit", "defense_segment_margin"]
    .map(key => profile.axes.economics.facts.find(f => f.fact_id.endsWith(`:${key}`)));
  const classes = ["reported_segment_sales", "reported_segment_operating_profit", "reported_segment_margin"];
  if (rows.some((f,i) => !f || f.fact_class !== classes[i] || typeof f.value !== "number" || f.unit !== (i === 2 ? "percent" : "USD_million"))
    || new Set(rows.map(f=>f?.period)).size !== 1 || new Set(rows.map(f=>f?.accounting_basis)).size !== 1) return [];
  return rows as DefenseFact[];
}
