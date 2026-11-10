import { object } from "./sectorIntelligence";
import { strictDay } from "./sectorCycleRhythm";

/* ────────────────────────────────────────────────────────────────────────────
 * Turn knowledge dates (Sector Intelligence v1.1, SP11): a pivot is dated by
 * its EVENT; it became knowable only at confirmation. The history feed may
 * carry each turn's `known_since` — the first date the turn was knowable
 * (lane 8's transition-time head is scored on `confirmed_at`, never the
 * pivot date). This reader extracts exactly that map from the RAW feed and
 * never invents a value: an absent, malformed, pre-dated or future date is
 * dropped, and a value that conflicts across rows drops the claim (an
 * ambiguous date is unavailable, never a guess).
 *
 * The event date and the first-known date are two different facts and are
 * never conflated — the reader keys by event date and returns the distinct
 * first-known date, or nothing.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Event date (YYYY-MM-DD) → first-known date (YYYY-MM-DD). */
export type TurnFirstKnown = Record<string, string>;

export function turnFirstKnown(historyData: unknown): TurnFirstKnown {
  const root = object(historyData);
  const asOf = strictDay(object(root.meta).asOf);
  const out: TurnFirstKnown = {};
  const poisoned = new Set<string>();
  const rows = Array.isArray(root.sectors) ? root.sectors : [];
  for (const value of rows) {
    const row = object(value);
    const turns = Array.isArray(row.turns) ? row.turns : [];
    for (const turnValue of turns) {
      const turn = object(turnValue);
      const eventDate = strictDay(turn.date);
      const known = strictDay(turn.known_since);
      if (eventDate === null || known === null) continue;
      // The first-known date is strictly AFTER the pivot (a turn is knowable
      // only once later price action confirms it) and never past the feed date.
      if (known <= eventDate || (asOf !== null && known > asOf)) continue;
      if (poisoned.has(eventDate)) continue;
      if (Object.hasOwn(out, eventDate)) {
        if (out[eventDate] !== known) {
          // Conflicting claims: the date is unavailable, never a guess.
          delete out[eventDate];
          poisoned.add(eventDate);
        }
        continue;
      }
      out[eventDate] = known;
    }
  }
  return out;
}
