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

/* ────────────────────────────────────────────────────────────────────────────
 * Generation binding (Round 3 §2.3). A history cursor is only usable with the
 * generation that requested it: when the selected generation moves on (late or
 * cancelled history, or a same-session replacement), the old history must not
 * render under the new selection. Retiring the cursor is the caller's job; this
 * guard is the single place that decides whether a history object belongs to a
 * generation at all.
 * ─────────────────────────────────────────────────────────────────────────── */

/** The generation a Cycles selection is bound to. All fields are exact identity,
 * never a fallback: a null publicationId means the generation is ungated (legacy
 * feeds), not "any publication". */
export interface SectorCycleGeneration {
  /** Access epoch token from the owning route (actor-bound). */
  accessGeneration: string;
  region: "us";
  /** The selected generation's source day (YYYY-MM-DD). */
  asOf: string;
  /** Verified publication id when the deep evidence feed gates the generation. */
  publicationId: string | null;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (value: unknown): value is string => {
  if (typeof value !== "string" || !ISO_DAY.test(value)) return false;
  const parsed = new Date(value + "T00:00:00Z");
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
};

export function isSectorCycleGeneration(value: unknown): value is SectorCycleGeneration {
  const g = object(value);
  return (
    typeof g.accessGeneration === "string" &&
    g.accessGeneration.length > 0 &&
    g.region === "us" &&
    validDay(g.asOf) &&
    (g.publicationId === null ||
      (typeof g.publicationId === "string" && g.publicationId.length > 0))
  );
}

/** Stable identity of one selected subject inside one generation. When any
 * component changes, every cursor, comparison and detail bound to the previous
 * key is retired rather than re-pointed. */
export function cycleGenerationKey(
  generation: SectorCycleGeneration,
  subject: { family: string; id: string },
): string {
  return [
    generation.accessGeneration,
    generation.publicationId ?? "ungated",
    generation.region,
    generation.asOf,
    subject.family,
    subject.id,
  ].join("/");
}

/** Bind a parsed history to a generation. Wrong day (late, cancelled or
 * superseded history) never renders: it is withheld, not re-dated. */
export function cycleHistoryForGeneration(
  history: SectorRotationHistory | null,
  generation: SectorCycleGeneration | null,
): SectorRotationHistory | null {
  if (!history || !generation) return null;
  return history.asOf === generation.asOf ? history : null;
}
