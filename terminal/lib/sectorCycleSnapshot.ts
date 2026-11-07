import {
  object,
  sectorRotationHistory,
  type SectorRotationHistory,
} from "./sectorIntelligence";

export const CYCLE_PHASES = [
  "Trough",
  "Recovery",
  "Expansion",
  "Peak",
  "Downturn",
] as const;
export type CyclePhase = (typeof CYCLE_PHASES)[number];
const isPhase = (v: unknown): v is CyclePhase =>
  CYCLE_PHASES.some((p) => p === v);

/** A view of one existing, authenticated Macro publication, not a new model or feed. */
export function cycleUniverse(
  data: unknown,
  receiptDay: string | null,
  history: SectorRotationHistory | null,
) {
  const body = object(data),
    meta = object(body.meta),
    contract = object(meta.rs_history);
  if (
    !history ||
    !receiptDay ||
    history.asOf !== receiptDay ||
    (contract.as_of !== undefined && contract.as_of !== receiptDay) ||
    !Array.isArray(body.sectors)
  )
    return [];
  const seen = new Set<string>();
  const rows = body.sectors.map((value) => {
    const r = object(value),
      now = object(r.now),
      series = history.series[String(r.id)];
    if (!series || series.ticker !== r.ticker || seen.has(series.ticker))
      return null;
    seen.add(series.ticker);
    const basis =
      (r.basis === "price" || r.basis === "tr_fallback") &&
      (!("basis" in now) || now.basis === r.basis)
        ? r.basis
        : null;
    return {
      id: series.id,
      ticker: series.ticker,
      asOf: receiptDay,
      series,
      basis,
      phase: basis && isPhase(now.phase) ? now.phase : null,
      position:
        basis &&
        typeof now.pos === "number" &&
        Number.isFinite(now.pos) &&
        now.pos >= 0 &&
        now.pos <= 100
          ? now.pos
          : null,
      above200:
        basis && typeof now.above200d === "boolean" ? now.above200d : null,
      name: typeof r.name === "string" ? r.name : series.ticker,
      nameZh: typeof r.name_zh === "string" ? r.name_zh : null,
    };
  });
  return rows.some((r) => r === null) ? [] : rows.filter((r) => r !== null);
}
export function cycleSnapshot(
  data: unknown,
  day: string | null,
  id: string,
  ticker: string,
) {
  return (
    cycleUniverse(data, day, sectorRotationHistory(data)).find(
      (r) => r.id === id && r.ticker === ticker,
    ) ?? null
  );
}
export type CycleReading = ReturnType<typeof cycleUniverse>[number];
