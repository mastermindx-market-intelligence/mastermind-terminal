import { object } from "./sectorIntelligence";
import { strictDay } from "./sectorCycleRhythm";

/* ────────────────────────────────────────────────────────────────────────────
 * Turn knowledge dates (Sector Intelligence v1.1, SP11): a pivot is dated by
 * its EVENT date; it became knowable only at confirmation. The history feed
 * may carry each turn's `confirmed_at` — the producer's own name for the
 * first-known date (macro engine/sector_heads.py: the transition-time head
 * scores "the next turn becomes first-known (confirmed_at, not pivot date)").

 * Confirmation is a PER-SERIES fact — each series' own price action confirms
 * its own turn — so dates are keyed by (series id, event date, turn kind) and
 * only the selected series' map is ever handed to a chart. One sector's
 * confirmation date can never attach to another sector's turn, and a turn on
 * the same date in another series never poisons it.

 * This reader never invents a value: an absent, malformed, pre-dated or
 * future date is dropped, a conflicting duplicate drops the claim (an
 * ambiguous date is unavailable, never a guess), and a PROVISIONAL turn is
 * skipped entirely — an unconfirmed turn has no first-known date. The event
 * date and the confirmed date are two different facts, never conflated.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Inner key `${eventDate}#${turnKind}` → confirmed date (YYYY-MM-DD). */
export type SeriesFirstKnown = Record<string, string>;
/** Series id → that series' own first-known dates. */
export type TurnFirstKnownIndex = Record<string, SeriesFirstKnown>;

export function turnFirstKnownIndex(historyData: unknown): TurnFirstKnownIndex {
  const root = object(historyData);
  const asOf = strictDay(object(root.meta).asOf);
  const out: TurnFirstKnownIndex = {};
  const poisoned = new Set<string>();
  const rows = Array.isArray(root.sectors) ? root.sectors : [];
  for (const value of rows) {
    const row = object(value);
    const seriesId = typeof row.id === "string" ? row.id : "";
    if (seriesId === "") continue;
    const turns = Array.isArray(row.turns) ? row.turns : [];
    for (const turnValue of turns) {
      const turn = object(turnValue);
      // A provisional turn is not yet confirmed: no first-known date exists.
      if (turn.provisional === true) continue;
      const eventDate = strictDay(turn.date);
      const kind = typeof turn.k === "string" && turn.k !== "" ? turn.k : "";
      const confirmed = strictDay(turn.confirmed_at);
      if (eventDate === null || kind === "" || confirmed === null) continue;
      // The confirmed date is strictly AFTER the pivot (a turn is knowable
      // only once later price action confirms it) and never past the feed date.
      if (confirmed <= eventDate || (asOf !== null && confirmed > asOf)) continue;
      if (!Object.hasOwn(out, seriesId)) out[seriesId] = {};
      const series = out[seriesId];
      const key = eventDate + "#" + kind;
      const poisonKey = seriesId + "/" + key;
      if (poisoned.has(poisonKey)) continue;
      if (Object.hasOwn(series, key)) {
        if (series[key] !== confirmed) {
          // Conflicting claims within one series: unavailable, never a guess.
          delete series[key];
          poisoned.add(poisonKey);
        }
        continue;
      }
      series[key] = confirmed;
    }
  }
  return out;
}

/** One series' own map — another series' dates are never visible in it. */
export function seriesFirstKnown(
  index: TurnFirstKnownIndex | null | undefined,
  seriesId: string,
): SeriesFirstKnown {
  if (!index || !Object.hasOwn(index, seriesId)) return {};
  const map = index[seriesId];
  return map !== null && typeof map === "object" ? map : {};
}

/** Own-property lookup — inherited keys never answer. */
export function firstKnownAt(
  map: SeriesFirstKnown | null | undefined,
  eventDate: string,
  turnKind: string,
): string | null {
  if (!map) return null;
  const key = eventDate + "#" + turnKind;
  if (!Object.hasOwn(map, key)) return null;
  const v = map[key];
  return typeof v === "string" ? v : null;
}
