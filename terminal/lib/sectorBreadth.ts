import { object, type Row, type SectorBreadthWindow } from "./sectorIntelligence";

export const BREADTH_COVERAGE = 0.9;
export type BreadthWindow = SectorBreadthWindow;

export interface BreadthSector {
  row: Row;
  adv: number | null;
  dec: number | null;
  flat: number | null;
  matched: number | null;
  eligible: number | null;
  pct: number | null;
  history: number[];
}

const count = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
const counts = (x: unknown): x is number[] => Array.isArray(x) && x.length === 6 && x.every(count);
function day(x: unknown): x is string {
  if (typeof x !== "string" || !/^\d{4}-\d\d-\d\d$/.test(x)) return false;
  const time = Date.parse(x + "T00:00:00Z");
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === x;
}

export function dailyBreadth(data: unknown, asOf: string | null, rows: readonly Row[]) {
  const owner = object(object(data).sector_breadth_close);
  const dates: unknown = owner.dates;
  if (owner.schema !== "sector_breadth_close.v1" || owner.basis !== "current_cohort_daily_closes"
      || !Array.isArray(dates) || dates.length !== 6 || !dates.every(day)
      || dates.some((d, i) => i > 0 && d <= dates[i - 1]) || dates[5] !== asOf) return null;
  const series = object(owner.sectors);
  const sectors = rows.map((row): BreadthSector => {
    const r = object(series[String(row.ticker)]);
    const empty = { row, adv: null, dec: null, flat: null, matched: null, eligible: null, pct: null, history: [] };
    const { matched, eligible, advancing, declining } = r;
    if (!count(matched) || !count(eligible) || matched > eligible || !counts(advancing) || !counts(declining)
        || advancing.some((n, i) => n + declining[i] > matched)) return empty;
    if (!matched || matched < eligible * BREADTH_COVERAGE) return { ...empty, matched, eligible };
    const history = advancing.map(n => 100 * n / matched);
    return { row, adv: advancing[5], dec: declining[5], flat: matched - advancing[5] - declining[5],
      matched, eligible, pct: history[5], history };
  });
  return { dates, sectors };
}

export function monthlyBreadth(rows: readonly Row[]): BreadthSector[] {
  return rows.map(row => {
    const { adv, dec } = object(row.heat);
    const valid = count(adv) && count(dec) && Number.isSafeInteger(adv + dec);
    const movers = valid ? adv + dec : 0;
    return { row, adv: valid ? adv : null, dec: valid ? dec : null, flat: null, matched: null,
      eligible: null, pct: movers ? 100 * (adv as number) / movers : null, history: [] };
  });
}

export function breadthMove(sector: BreadthSector, window: BreadthWindow) {
  return sector.history.length === 6 ? sector.history[5] - sector.history[5 - window] : null;
}

/** Descriptive participation vs change, never a proxy for flows or a forecast. */
export function breadthRegime(sector: BreadthSector, window: BreadthWindow) {
  const level = sector.pct, change = breadthMove(sector, window);
  if (level === null || change === null || !Number.isFinite(level) || !Number.isFinite(change)) return "unknown";
  if (level === 50) return "even";
  if (change === 0) return "flat";
  if (level > 50) return change > 0 ? "broad-up" : "broad-down";
  return change > 0 ? "narrow-up" : "narrow-down";
}

export function breadthRank(values: (number | null)[], value: number | null) {
  return value === null ? null : 1 + values.filter(v => v !== null && v > value + 1e-8).length;
}

/** An observed ordering reversal between sectors on a fixed six-close cohort. */
export function breadthOvertakes(selected: BreadthSector, sectors: readonly BreadthSector[]) {
  const ahead: Row[] = [], behind: Row[] = [];
  if (selected.history.length !== 6) return { ahead, behind };
  for (const peer of sectors) {
    if (peer.row.id === selected.row.id || peer.history.length !== 6) continue;
    const lead = (i: number) => selected.history[i] - peer.history[i];
    if (lead(0) < -1e-8 && lead(4) > 1e-8 && lead(5) > 1e-8) ahead.push(peer.row);
    if (lead(0) > 1e-8 && lead(4) < -1e-8 && lead(5) < -1e-8) behind.push(peer.row);
  }
  return { ahead, behind };
}
