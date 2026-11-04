import { isBlockedSignal, isBottomWatch, isRetroOverride, isStopSweepReclaim, isStructureStop, sliceSignalBasis } from "./signalVerdict"

export type ActivityFilter = "all" | "entries" | "exits" | "watches" | "refused" | "receipts"

interface ActivitySignal {
  type: string
  ts: string
  known_ts?: string | null
  scored?: boolean | null
  quality?: string | null
  blocked?: boolean | null
  retro_override?: boolean | null
  basis?: string | null
  subtype?: string | null
  price?: number | null
  quality_reason?: string | null
}
interface ActivityReceipt {
  surfaced_at?: string | null
  entry_date?: string | null
  system?: string | null
  definition?: string | null
  entry_price?: number | null
  rank?: number | null
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


export type WorkspaceActivityEvent = ReturnType<typeof workspaceActivity>[number]
export type ActivityOrder = "newest" | "oldest"
export type ActivityTone = "positive" | "negative" | "watch" | "muted" | "info"

/** Shared display vocabulary only. Classification and entry authority stay with the source. */
export function activityEventPresentation(event: WorkspaceActivityEvent, zh = false): {
  label: string; detail: string; source: string; price: number | null; tone: ActivityTone
} {
  const word = (en: string, cn: string) => zh ? cn : en
  const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null
  if (event.kind === "receipt") {
    const system = (event.receipt.system ?? "").toLowerCase()
    const label = system.includes("reversal") ? word("REVERSAL", "反转观察")
      : system.includes("prophet") ? "PROPHET" : word("CANDIDATE", "候选")
    return { label, detail: word("candidate · not plan", "候选 · 非计划"),
      source: word("Candidate", "候选记录"), price: finite(event.receipt.entry_price), tone: "info" }
  }
  const signal = event.signal
  const blocked = isBlockedSignal(signal), retro = isRetroOverride(signal)
  const entry = event.category === "entries" && signal.type !== "RECLAIM"
  const reclaim = signal.type === "RECLAIM", bottom = isBottomWatch(signal), sweep = isStopSweepReclaim(signal)
  const starter = entry && (signal.quality === "block" || signal.quality === "pending")
  const stop = isStructureStop({ type: signal.type, basis: sliceSignalBasis(signal) })
  const label = retro ? signal.type : blocked ? word("BLOCKED", "已拦截")
    : stop ? word("STOP", "止损") : bottom ? word("EARLY", "底部观察")
    : sweep ? word("RECLAIM", "流动性收复") : reclaim
      ? event.category === "entries" ? word("RE-ENTRY", "再入场") : word("RECLAIM", "收复观察")
      : starter ? word("STARTER", "试仓") : signal.type
  const qualityKey = signal.quality?.toLowerCase()
  const quality = qualityKey === "take" ? word("Take", "采纳")
    : qualityKey === "override_take" ? word("Washout override", "深度洗盘例外")
    : qualityKey === "reclaim_override_take" ? word("Reclaim waived", "免收复200日线") : ""
  const detail = retro ? word("(retro)", "（事后重标）") : blocked ? word("not an entry", "非入场信号")
    : stop ? word("swing-low break", "跌破前低") : bottom ? word("risk-defined · not confirmed", "风险限定 · 尚未确认")
    : sweep ? word("failed breakdown reclaimed", "假突破后收复") : starter
      ? signal.quality === "block" ? word("confirmation failed", "确认未通过") : word("awaiting hold", "等待企稳")
      : entry ? quality : ""
  const tone: ActivityTone = retro || starter || bottom ? "watch" : blocked ? "muted"
    : event.category === "exits" ? "negative" : event.category === "entries" ? "positive" : "info"
  return { label, detail, source: "Oracle", price: finite(signal.price), tone }
}

const categoryTerms: Record<WorkspaceActivityEvent["category"], string> = {
  entries: "entries entry 入场", exits: "exits exit 离场", watches: "watches watch 观察",
  refused: "refused retro not entered 未入场 拦截 事后", receipts: "candidates receipts 候选 记录", other: "other 其他",
}
// Reuse locale formatters: constructing them per row made a 400-event search noticeably slow.
const searchDateFormatters = ["en-US", "zh-CN"].map(locale => new Intl.DateTimeFormat(locale, {
  year: "numeric", month: "short", day: "numeric", timeZone: "UTC",
}))
function normalizedQuery(value: string): string {
  return value.normalize("NFKC").slice(0, 160).toLocaleLowerCase("en-US").trim().replace(/\s+/g, " ")
}
function searchText(event: WorkspaceActivityEvent): string {
  const en = activityEventPresentation(event), zh = activityEventPresentation(event, true)
  const source = event.kind === "signal"
    ? [event.signal.type, event.signal.quality, event.signal.quality_reason]
    : [event.receipt.system, event.receipt.definition, event.receipt.entry_date, event.receipt.rank]
  const displayDates = [...new Set([event.date, event.chartDate])].flatMap(value => {
    if (!value || !Number.isFinite(Date.parse(value))) return []
    const date = new Date(value)
    return searchDateFormatters.map(formatter => formatter.format(date))
  })
  return [en.label, en.detail, en.source, zh.label, zh.detail, zh.source,
    categoryTerms[event.category], event.date, event.chartDate, ...displayDates, en.price, ...source]
    .filter(value => value !== null && value !== undefined).join(" ").normalize("NFKC").toLocaleLowerCase("en-US")
}

/** A deterministic view of existing events; never recalculates signals or mutates a source. */
export function exploreWorkspaceActivity<T extends WorkspaceActivityEvent>(events: readonly T[], options: {
  query?: string; filter?: ActivityFilter; order?: ActivityOrder
} = {}) {
  const query = normalizedQuery(options.query ?? "")
  const terms = query ? query.split(" ") : []
  const matched = terms.length ? events.filter(event => {
    const text = searchText(event)
    return terms.every(term => text.includes(term))
  }) : [...events]
  const counts: Record<ActivityFilter, number> = { all: matched.length, entries: 0, exits: 0, watches: 0, refused: 0, receipts: 0 }
  for (const event of matched) if (event.category !== "other") counts[event.category]++
  const filtered = matched.filter(event => !options.filter || options.filter === "all" || event.category === options.filter)
  const time = (date: string | null) => date && Number.isFinite(Date.parse(date)) ? Date.parse(date) : null
  const ordered = filtered.map((event, index) => ({ event, index, time: time(event.date) }))
    .sort((a, b) => a.time === null ? b.time === null ? a.index - b.index : 1
      : b.time === null ? -1 : (options.order === "oldest" ? a.time - b.time : b.time - a.time) || a.index - b.index)
    .map(({ event }) => event)
  return { events: ordered, counts, total: events.length, matched: matched.length, query }
}
