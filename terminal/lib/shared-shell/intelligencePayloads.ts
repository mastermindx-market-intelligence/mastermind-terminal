/** Bounded display projections of incumbent producer contracts. No scoring or signal authority. */
import { readingDate } from "./readingFreshness";
const obj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const text = (x: unknown, max = 160): string | null => typeof x === "string" && x.trim().length > 0 && x.length <= max ? x : null;
const count = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= 0 && x <= 100_000;
const symbol = (x: unknown): x is string => typeof x === "string" && /^[A-Z0-9][A-Z0-9.:-]{0,31}$/.test(x);
const date = (x: unknown): string | null => readingDate(x);
const nullableDate = (x: unknown) => x === null || (typeof x === "string" && date(x) === x);
const phases = new Set(["Trough", "Recovery", "Expansion", "Peak", "Downturn"]);
export type ProphetIntelligence = {
  schema: "mmx.intelligence.prophet.v1"; publishedAt: string | null; sourceAsOf: string | null;
  sourceUnknown: boolean; sourceDelayed: boolean; mixedVintage: boolean; stale: boolean;
  openCount: number; previewLimit: 3;
  plans: { id: string; symbol: string; phase: string | null; priceAsOf: string | null; planAsOf: string | null }[];
};
export type CycleIntelligence = {
  schema: "mmx.intelligence.cycles.v1"; sourceAsOf: string | null; stale: boolean; benchmark: string | null;
  coverage: number; rows: { id: string; ticker: string; name: string; nameZh: string | null;
    phase: string | null; position: number | null; model: "published" }[];
};
export function projectProphetIntelligence(value: unknown): ProphetIntelligence | null {
  if (!obj(value) || value.schema !== "prophet.index/v1" || !Array.isArray(value.plans)
      || value.plans.length > 10_000 || !count(value.open_count) || value.open_count > value.plans.length) return null;
  if (!value.plans.every(p => obj(p) && typeof p.closed === "boolean")) return null;
  const unclosed = value.plans.filter(p => (p as Record<string, unknown>).closed === false);
  if (unclosed.length !== value.open_count) return null;
  const selected = unclosed.slice(0, 3);
  if (value.open_count > 0 && selected.length === 0) return null;
  const plans: ProphetIntelligence["plans"] = [];
  for (const raw of selected) {
    if (!obj(raw) || !text(raw.id) || !symbol(raw.asset)) return null;
    plans.push({ id: raw.id as string, symbol: raw.asset, phase: text(raw.phase, 64),
      priceAsOf: date(raw.price_basis_date), planAsOf: date(raw.plan_asof) });
  }
  return { schema: "mmx.intelligence.prophet.v1", publishedAt: date(value.asof),
    sourceAsOf: value.source_unknown === true ? null : date(value.source_asof),
    sourceUnknown: value.source_unknown === true || date(value.source_asof) === null,
    sourceDelayed: value.source_delayed === true, mixedVintage: value.source_mixed_vintage === true,
    stale: value.stale === true, openCount: value.open_count, previewLimit: 3, plans };
}
export function projectCycleIntelligence(value: unknown): CycleIntelligence | null {
  if (!obj(value) || !obj(value.receipt) || !obj(value.data) || !obj(value.data.meta)) return null;
  const { receipt, data } = value, meta = data.meta as Record<string, unknown>;
  if (receipt.source !== "history" || receipt.path !== "/sectordata/sector_cycles.json"
      || !["ready", "stale"].includes(String(receipt.status)) || !Array.isArray(data.sectors)
      || !count(meta.n_sectors) || meta.n_sectors > 100 || data.sectors.length !== meta.n_sectors
      || date(receipt.asOf) !== date(meta.asOf)) return null;
  const rows: CycleIntelligence["rows"] = [], seen = new Set<string>();
  for (const raw of data.sectors) {
    if (!obj(raw) || !text(raw.id, 64) || !symbol(raw.ticker) || !text(raw.name) || !obj(raw.now) || seen.has(raw.ticker)) return null;
    seen.add(raw.ticker);
    // Match the incumbent sector_cycles.js phase/position display. Do not promote
    // a separate v2 diagnostic merely because the producer also publishes it.
    const phase = raw.now.phase;
    const position = raw.now.pos;
    rows.push({ id: raw.id as string, ticker: raw.ticker, name: raw.name as string, nameZh: text(raw.name_zh),
      phase: typeof phase === "string" && phases.has(phase) ? phase : null,
      position: typeof position === "number" && Number.isFinite(position) && position >= 0 && position <= 100 ? position : null,
      model: "published" });
  }
  return { schema: "mmx.intelligence.cycles.v1", sourceAsOf: date(meta.asOf),
    stale: receipt.stale === true || receipt.status === "stale", benchmark: symbol(meta.benchmark) ? meta.benchmark : null,
    coverage: meta.n_sectors, rows };
}
export function decodeProphetIntelligence(v: unknown): ProphetIntelligence | null {
  if (!obj(v) || v.schema !== "mmx.intelligence.prophet.v1" || !nullableDate(v.publishedAt) || !nullableDate(v.sourceAsOf)
    || ![v.sourceUnknown, v.sourceDelayed, v.mixedVintage, v.stale].every(x => typeof x === "boolean")
    || !count(v.openCount) || v.previewLimit !== 3 || !Array.isArray(v.plans) || v.plans.length > 3
    || (v.openCount > 0 && v.plans.length === 0)
    || !v.plans.every(p => obj(p) && !!text(p.id) && symbol(p.symbol) && (p.phase === null || !!text(p.phase, 64))
      && nullableDate(p.priceAsOf) && nullableDate(p.planAsOf))) return null;
  return v as ProphetIntelligence;
}
export function decodeCycleIntelligence(v: unknown): CycleIntelligence | null {
  if (!obj(v) || v.schema !== "mmx.intelligence.cycles.v1" || !nullableDate(v.sourceAsOf) || typeof v.stale !== "boolean"
    || !(v.benchmark === null || symbol(v.benchmark)) || !count(v.coverage) || v.coverage > 100
    || !Array.isArray(v.rows) || v.rows.length !== v.coverage
    || !v.rows.every(r => obj(r) && !!text(r.id, 64) && symbol(r.ticker) && !!text(r.name)
      && (r.nameZh === null || !!text(r.nameZh)) && (r.phase === null || phases.has(String(r.phase)))
      && (r.position === null || (typeof r.position === "number" && Number.isFinite(r.position) && r.position >= 0 && r.position <= 100))
      && r.model === "published")) return null;
  if (new Set(v.rows.map(r => (r as { ticker: string }).ticker)).size !== v.rows.length) return null;
  return v as CycleIntelligence;
}
