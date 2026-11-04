import { isBlockedSignal, isBottomWatch, isRetroOverride, isStopSweepReclaim } from "./signalVerdict"

export type ActivityFilter = "all" | "entries" | "exits" | "watches" | "refused" | "receipts"

interface ActivitySignal {
  type: string
  ts: string
  known_ts?: string | null
  scored?: boolean | null
  quality?: string | null
  blocked?: boolean | null
  retro_override?: boolean | null
}
interface ActivityReceipt {
  surfaced_at?: string | null
  entry_date?: string | null
}

function category(signal: ActivitySignal): Exclude<ActivityFilter, "all" | "receipts"> | "other" {
  if (isBlockedSignal(signal) || isRetroOverride(signal)) return "refused"
  const type = signal.type.toUpperCase()
  if (isBottomWatch(signal) || isStopSweepReclaim(signal) || signal.scored === false) return "watches"
  if (type === "RECLAIM") return signal.scored === true ? "entries" : "watches"
  if (["BUY", "REBUY", "ADD"].includes(type)) return "entries"
  if (["SELL", "CUT", "TRIM"].includes(type)) return "exits"
  return "other"
}

function validDate(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value) || !Number.isFinite(Date.parse(value))) return null
  const day = value.slice(0, 10)
  return new Date(day).toISOString().slice(0, 10) === day ? value : null
}

/** Read one source slice. Keep the dated admission, chart coordinate and trade price distinct. */
export function workspaceActivity<S extends ActivitySignal, R extends ActivityReceipt>(
  signals: readonly S[], receipts: readonly R[], filter: ActivityFilter,
) {
  const oracle = signals.map((signal, index) => {
    const known = validDate(signal.known_ts)
    const chartDate = validDate(signal.ts)
    return { kind: "signal" as const, signal, key: `s-${index}`, category: category(signal),
      date: known ?? chartDate, clock: known ? "observed" : "bar", chartDate }
  })
  const candidates = receipts.map((receipt, index) => {
    const surfaced = validDate(receipt.surfaced_at)
    const date = surfaced ?? validDate(receipt.entry_date)
    return { kind: "receipt" as const, receipt, key: `r-${index}`, category: "receipts" as const,
      date, clock: surfaced ? "listed" : "entry", chartDate: date }
  })
  // Source signal order is oldest first. Keep the later producer row first on equal dates.
  return [...oracle.reverse(), ...candidates]
    .filter(event => filter === "all" || event.category === filter)
    .sort((a, b) => (b.date ? Date.parse(b.date) : -Infinity) - (a.date ? Date.parse(a.date) : -Infinity))
}
