import type { ResearchCondition } from "./discoverResearch";
import { researchText as text } from "./discoverResearchLex";
import { classifyTechnical, matchTechnicalPredicate, technicalCellOf, type TechnicalFieldId, type TechnicalScanSource, type TechnicalScreen } from "./technicalScan";
import { technicalReasonLabel, technicalSignalLabel } from "./technicalScanLex";
import { evaluateFundamentalScreen, formatFundamentalValue, fundamentalReferenceDate, type FundamentalPredicate, type FundamentalScanSource } from "./fundamentalScan";
import { reasonText, statusText, type FundT } from "./fundamentalScanLex";

type T = (key: string, vars?: Record<string, string | number>) => string;
const technicalKeys: Record<TechnicalFieldId, string> = {
  "tech.position": "tsPosition", "tech.lastSignal": "tsLastSignal", "tech.lastScoredSignal": "tsLastSignal",
  "tech.barsSinceSignal": "tsBarsSince", "tech.strongBull": "tsStrongBull", "tech.overbought": "tsNotOverbought",
  "tech.weeklyBull": "tsWeeklyBull", "tech.above200": "tsAbove200", "tech.barClosed": "tsBarClosed",
};
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Presentation consumes the same typed cells and predicates as membership. A row-level
 * evaluated status does not make a missing field known, and inclusion is not evidence quality. */
export function researchTechnicalConditions(source: TechnicalScanSource | null, sym: string, screen: TechnicalScreen, now: number, lang: string, t: T): ResearchCondition[] {
  const c = source ? classifyTechnical(source, sym, screen.tf, now) : null;
  const valueLabel = (field: TechnicalFieldId, value: string | number | boolean): string => {
    if (typeof value === "boolean") return text(value ? "yes" : "no", lang);
    if (field === "tech.position") return t(value === "long" ? "tsLong" : "tsFlat");
    if (field === "tech.lastSignal" || field === "tech.lastScoredSignal") return technicalSignalLabel(String(value), lang);
    return String(value);
  };
  return screen.predicates.map(predicate => {
    const title = predicate.field === "tech.overbought" ? text("overbought", lang) : predicate.field === "tech.lastScoredSignal" ? text("scoredSignal", lang) : t(technicalKeys[predicate.field]);
    const condition = predicate.op === "in" ? predicate.values.map(v => valueLabel(predicate.field, v)).join(" / ")
      : predicate.op === "is" ? valueLabel(predicate.field, predicate.value)
      : predicate.op === "range" ? [predicate.gte === undefined ? "" : `≥ ${predicate.gte}`, predicate.lte === undefined ? "" : `≤ ${predicate.lte}`].filter(Boolean).join(" · ")
      : text("unknown", lang);
    const label = `${title} · ${condition} · ${screen.tf}`;
    if (!c || !source) return { label, value: text("loading", lang), match: "unknown" };
    const cell = technicalCellOf(c, predicate.field), match = matchTechnicalPredicate(c, predicate);
    const admittedUnknown = !cell.known && match === "pass";
    const value = cell.known ? valueLabel(predicate.field, cell.value) : technicalReasonLabel(cell.reason, lang);
    const date = c.observation?.cutoff.bar_open;
    const stamp = date ? text("asOf", lang, { date }) : source.kind === "ready" ? text("scanGenerated", lang, { date: day(source.scan.generatedAtMs) }) : "";
    return { label, value: [value, admittedUnknown ? text("admittedUnknown", lang) : "", stamp].filter(Boolean).join(" · "), match, admittedUnknown };
  });
}

export function researchFundamentalConditions(source: FundamentalScanSource | null, sym: string, predicates: readonly FundamentalPredicate[], now: number, lang: string, t: FundT, label: (predicate: FundamentalPredicate) => string): ResearchCondition[] {
  return predicates.map(predicate => {
    if (!source) return { label: label(predicate), value: text("loading", lang), match: "unknown" };
    const result = evaluateFundamentalScreen(source, sym, [predicate], now), cell = result.cells[predicate.field];
    const known = cell?.coverage.status === "evaluated" && cell.value !== null;
    const admittedUnknown = !known && result.match === "pass";
    const date = cell ? fundamentalReferenceDate(predicate.field, cell) : null;
    const value = cell?.value != null ? `${cell.coverage.status === "stale" ? `${text("historicalValue", lang)}: ` : ""}${formatFundamentalValue(predicate.field, cell.value)}` : text("unavailable", lang);
    const status = cell && !known ? `${statusText(t, cell.coverage.status)} · ${reasonText(t, cell.coverage.reason)}` : "";
    const stamp = date ? text(predicate.field === "fund.pe_ttm" ? "asOf" : "fiscalEnd", lang, { date }) : source.kind === "ready" ? text("scanGenerated", lang, { date: day(source.scan.generatedAtMs) }) : "";
    return { label: label(predicate), value: [value, status, admittedUnknown ? text("admittedUnknown", lang) : "", stamp].filter(Boolean).join(" · "), match: result.match, admittedUnknown };
  });
}
