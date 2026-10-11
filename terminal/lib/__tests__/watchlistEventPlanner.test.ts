// Watchlist event planner (E14) — the pure model: date precision, dual time, identity,
// coverage and the bounded reader. Every acceptance rule here has a negative case.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CacheOutcome, GetOpts } from "@/lib/dataCache";
import {
  EVENT_READ_CONCURRENCY,
  buildAgenda,
  companyEventUrl,
  dualTime,
  eventIdentity,
  formatDayHeading,
  formatShortDay,
  interpretFundPayload,
  isCurrentAnswer,
  outcomeToRead,
  parseNextDate,
  profileSymbol,
  runEventReads,
  settleRead,
  summarizeCoverage,
  uniqueListSymbols,
  unknownCount,
  type EventReadJob,
  type SeenDay,
  type SymbolRead,
} from "@/lib/watchlistEventPlanner";

const NOW = Date.UTC(2026, 9, 11, 14, 0, 0); // 2026-10-11T14:00Z
const US = { company: true, exchangeTz: "America/New_York" } as const;
const CLOCK_RE = /\d{1,2}:\d{2}/;

const fund = (next_date: unknown, next_period: unknown = "Q4 2026", asof = "2026-10-01") =>
  ({ asof, earnings: { next_date, next_period } });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("symbols", () => {
  it("reads companies only; indexes, futures, crypto and baskets are never fetched", () => {
    expect(profileSymbol("AAPL")).toEqual({ company: true, exchangeTz: "America/New_York" });
    expect(profileSymbol("600519.SS")).toEqual({ company: true, exchangeTz: "Asia/Shanghai" });
    expect(profileSymbol("0700.HK")).toEqual({ company: true, exchangeTz: "Asia/Hong_Kong" });
    expect(profileSymbol("SHOP.TO")).toEqual({ company: true, exchangeTz: "America/Toronto" });
    expect(profileSymbol("VOD.L")).toEqual({ company: true, exchangeTz: null });
    expect(profileSymbol("^GSPC").company).toBe(false);
    expect(profileSymbol("ES=F").company).toBe(false);
    expect(profileSymbol("BTC-USD").company).toBe(false);
    expect(profileSymbol("COIN", { sec: "Crypto" }).company).toBe(false);
    expect(profileSymbol("").company).toBe(false);
  });

  it("dedupes list entries in list order and encodes the fund-file path", () => {
    expect(uniqueListSymbols([{ symbol: "aapl" }, { symbol: "MSFT" }, { symbol: "AAPL" }, { symbol: 7 }, {}])).toEqual(["AAPL", "MSFT"]);
    expect(companyEventUrl("AAPL")).toBe("/data/AAPL.fund.json");
    expect(companyEventUrl("BRK.B")).toBe("/data/BRK.B.fund.json");
    expect(companyEventUrl("bad symbol")).toBeNull();
  });
});

describe("AC-E14-01 · a date-only record never gains a clock time", () => {
  it("keeps YYYY-MM-DD as a calendar day", () => {
    expect(parseNextDate("2026-10-29", "America/New_York")).toEqual({ kind: "when", when: { precision: "date", day: "2026-10-29" } });
  });

  it("formats a date-only day identically in every viewer zone, with no clock", () => {
    const original = process.env.TZ;
    const headings: string[] = [];
    for (const tz of ["UTC", "America/Los_Angeles", "Pacific/Kiritimati", "Asia/Shanghai"]) {
      process.env.TZ = tz;
      headings.push(formatDayHeading("2026-10-29", "en"), formatShortDay("2026-10-29", "zh"));
    }
    process.env.TZ = original;
    for (const text of headings) expect(text).not.toMatch(CLOCK_RE);
    expect(new Set(headings.filter((_, i) => i % 2 === 0))).toEqual(new Set(["Thu, Oct 29, 2026"]));
  });

  it("a date-time WITHOUT an offset is unreadable, never guessed into a zone", () => {
    expect(parseNextDate("2026-10-29T16:30", "America/New_York")).toEqual({ kind: "unreadable" });
    expect(parseNextDate("2026-10-29 16:30:00", "America/New_York")).toEqual({ kind: "unreadable" });
  });

  it("refuses impossible and past days, and non-string values", () => {
    expect(parseNextDate("2026-02-30", null)).toEqual({ kind: "unreadable" });
    expect(parseNextDate("2026-10-10", null)).toEqual({ kind: "past" });
    expect(parseNextDate("2026-10-11", null)).toEqual({ kind: "when", when: { precision: "date", day: "2026-10-11" } });
    expect(parseNextDate(null, null)).toEqual({ kind: "none" });
    expect(parseNextDate(20261029, null)).toEqual({ kind: "unreadable" });
    expect(parseNextDate("soon", null)).toEqual({ kind: "unreadable" });
  });
});

describe("AC-E14-02 · local and exchange times are the same instant", () => {
  const instant = (raw: string, tz: string | null = "America/New_York") => {
    const parsed = parseNextDate(raw, tz);
    if (parsed.kind !== "when" || parsed.when.precision !== "instant") throw new Error(`not an instant: ${raw}`);
    return parsed.when;
  };

  it("renders both clocks from one epoch value (daylight time)", () => {
    const when = instant("2026-10-29T16:30:00-04:00");
    const dual = dualTime(when, "en", "Europe/London");
    expect(dual.exchange?.epochMs).toBe(when.epochMs);
    expect(dual.local.epochMs).toBe(when.epochMs);
    expect(dual.exchange?.time).toBe("4:30 PM EDT");
    expect(dual.local.time).toMatch(/^8:30 PM GMT/);
  });

  it("follows the daylight-saving change (EST after 2026-11-01)", () => {
    const when = instant("2026-11-02T16:30:00-05:00");
    const dual = dualTime(when, "en", "America/New_York");
    expect(dual.exchange?.time).toBe("4:30 PM EST");
    expect(dual.local.time).toBe(dual.exchange?.time);
  });

  it("an after-hours report crosses midnight for an Asia viewer but stays on the exchange day", () => {
    const when = instant("2026-10-29T20:05:00Z");
    expect(when.day).toBe("2026-10-29");
    const dual = dualTime(when, "en", "Asia/Shanghai");
    expect(dual.exchange?.day).toBe("2026-10-29");
    expect(dual.local.day).toBe("2026-10-30");
    expect(new Date(when.epochMs).toISOString()).toBe("2026-10-29T20:05:00.000Z");
  });

  it("an unknown exchange zone shows only the viewer clock and groups on UTC", () => {
    const when = instant("2026-10-29T23:30:00Z", null);
    expect(when.day).toBe("2026-10-29");
    expect(dualTime(when, "en", "UTC").exchange).toBeNull();
  });

  it("an instant that already passed is past", () => {
    expect(parseNextDate("2026-10-11T13:00:00Z", null)).toEqual({ kind: "past" });
  });
});

describe("AC-E14-03 · reschedules and corrections update by identity", () => {
  it("one identity per company period; a moved day replaces and is noted", () => {
    const seen = new Map<string, SeenDay>();
    const first = interpretFundPayload("AAPL", fund("2026-10-29"), US, { seen });
    const moved = interpretFundPayload("AAPL", fund("2026-10-30"), US, { seen });
    const again = interpretFundPayload("AAPL", fund("2026-10-30"), US, { seen });
    if (first.state !== "event" || moved.state !== "event" || again.state !== "event") throw new Error("expected events");
    expect(first.event.id).toBe(eventIdentity("AAPL", "Q4 2026"));
    expect(moved.event.id).toBe(first.event.id);
    expect(first.event.previousDay).toBeNull();
    expect(moved.event.previousDay).toBe("2026-10-29");
    expect(again.event.previousDay).toBe("2026-10-29"); // the note survives a re-read of the new day

    // The planner keys reads by symbol, so the later read REPLACES the earlier one.
    let reads: Record<string, SymbolRead> = { AAPL: first };
    reads = { ...reads, AAPL: moved };
    const rows = buildAgenda(reads).flatMap((d) => d.groups.flatMap((g) => g.events));
    expect(rows).toHaveLength(1);
    expect(rows[0].when.day).toBe("2026-10-30");
    // Defence in depth: the agenda itself never shows one identity twice.
    expect(buildAgenda({ AAPL: moved, AAPL_COPY: moved }).flatMap((d) => d.groups.flatMap((g) => g.events))).toHaveLength(1);
  });

  it("an unchanged day is never reported as moved", () => {
    const seen = new Map<string, SeenDay>();
    interpretFundPayload("MSFT", fund("2026-10-28"), US, { seen });
    const same = interpretFundPayload("MSFT", fund("2026-10-28"), US, { seen });
    expect(same.state === "event" && same.event.previousDay).toBeNull();
  });

  it("groups by day, then type; instants first in time order, date-only after", () => {
    const seen = new Map<string, SeenDay>();
    const reads: Record<string, SymbolRead> = {
      NVDA: interpretFundPayload("NVDA", fund("2026-10-29"), US, { seen }),
      AAPL: interpretFundPayload("AAPL", fund("2026-10-29T20:30:00Z"), US, { seen }),
      AMZN: interpretFundPayload("AMZN", fund("2026-10-29T12:00:00Z"), US, { seen }),
      MSFT: interpretFundPayload("MSFT", fund("2026-10-28"), US, { seen }),
    };
    const agenda = buildAgenda(reads);
    expect(agenda.map((d) => d.day)).toEqual(["2026-10-28", "2026-10-29"]);
    expect(agenda[1].groups).toHaveLength(1);
    expect(agenda[1].groups[0].events.map((e) => e.symbol)).toEqual(["AMZN", "AAPL", "NVDA"]);
  });
});

describe("AC-E14-04 · coverage loss is visible and never reads as no events", () => {
  it("each failure maps to its own unknown state", () => {
    expect(outcomeToRead("X", { status: "absent", httpStatus: 404 }, US)).toEqual({ state: "absent" });
    expect(outcomeToRead("X", { status: "unavailable", reason: "server", httpStatus: 503 }, US)).toEqual({ state: "unavailable" });
    expect(outcomeToRead("X", { status: "data", data: { earnings: {} } }, US)).toEqual({ state: "unreadable" });
    expect(outcomeToRead("X", { status: "data", data: { asof: "2026-10-01" } }, US)).toEqual({ state: "unreadable" });
    expect(outcomeToRead("X", { status: "data", data: null }, US)).toEqual({ state: "unreadable" });
    expect(outcomeToRead("X", { status: "data", data: fund(null) }, US)).toEqual({ state: "no-date", reason: "none", stale: false, refreshFailed: false });
  });

  it("only a fully and currently read list is complete", () => {
    const symbols = ["AAPL", "MSFT", "NVDA", "XYZ", "BAD", "LATER", "BTC-USD", "WAIT"];
    const seen = new Map<string, SeenDay>();
    const reads: Record<string, SymbolRead> = {
      AAPL: interpretFundPayload("AAPL", fund("2026-10-29"), US, { seen }),
      MSFT: { state: "no-date", reason: "none", stale: false, refreshFailed: false },
      NVDA: { state: "unavailable" },
      XYZ: { state: "absent" },
      BAD: { state: "unreadable" },
      LATER: { state: "not-read" },
      "BTC-USD": { state: "not-company" },
      // WAIT has no entry at all: a missing read is pending, never "no events".
    };
    const c = summarizeCoverage(symbols, reads);
    expect(c).toMatchObject({
      symbols: 8, companies: 7, read: 2, current: 2, withEvent: 1, noDate: 1, pending: 1,
      unavailable: 1, absent: 1, unreadable: 1, notRead: 1, notCompany: 1, complete: false,
    });
    expect(unknownCount(c)).toBe(5);
  });

  it("a stale copy whose refresh failed keeps coverage incomplete", () => {
    const reads: Record<string, SymbolRead> = { MSFT: { state: "no-date", reason: "none", stale: false, refreshFailed: true } };
    const c = summarizeCoverage(["MSFT"], reads);
    expect(c.complete).toBe(false);
    expect(unknownCount(c)).toBe(1);
    expect(summarizeCoverage(["MSFT"], { MSFT: { state: "no-date", reason: "none", stale: false, refreshFailed: false } }).complete).toBe(true);
  });

  it("a copy served stale is marked stale and is not a current answer", () => {
    const stale = { ageMs: 9e6, source: "disk" as const, revalidation: Promise.resolve("superseded" as const) };
    const read = outcomeToRead("AAPL", { status: "data", data: fund("2026-10-29"), stale }, US, { seen: new Map() });
    expect(read.state === "event" && [read.stale, read.refreshFailed]).toEqual([true, false]);
    expect(isCurrentAnswer(read)).toBe(false);
    const fresh = outcomeToRead("AAPL", { status: "data", data: fund("2026-10-29") }, US, { seen: new Map() });
    expect(fresh.state === "event" && fresh.stale).toBe(false);
    expect(isCurrentAnswer(fresh)).toBe(true);
  });

  it("only a fresh event or a fresh 'no date' is a current answer", () => {
    expect(isCurrentAnswer({ state: "no-date", reason: "none", stale: false, refreshFailed: false })).toBe(true);
    expect(isCurrentAnswer({ state: "no-date", reason: "past", stale: false, refreshFailed: false })).toBe(false);
    expect(isCurrentAnswer({ state: "no-date", reason: "none", stale: true, refreshFailed: false })).toBe(false);
    expect(isCurrentAnswer({ state: "no-date", reason: "none", stale: false, refreshFailed: true })).toBe(false);
    for (const state of ["pending", "unavailable", "absent", "unreadable", "not-read", "not-company"] as const) {
      expect(isCurrentAnswer({ state } as SymbolRead)).toBe(false);
    }
  });

  it("a failed re-read keeps the answer already held, marked as an earlier copy", () => {
    const held = interpretFundPayload("AAPL", fund("2026-10-29"), US, { seen: new Map() });
    const kept = settleRead(held, { state: "unavailable" });
    expect(kept.state).toBe("event");
    expect(kept.state === "event" && [kept.event.when.day, kept.refreshFailed]).toEqual(["2026-10-29", true]);
    const noDate: SymbolRead = { state: "no-date", reason: "none", stale: false, refreshFailed: false };
    expect(settleRead(noDate, { state: "unavailable" })).toEqual({ ...noDate, refreshFailed: true });
    // Nothing held, or the source answered: the new read replaces.
    expect(settleRead(undefined, { state: "unavailable" })).toEqual({ state: "unavailable" });
    expect(settleRead({ state: "pending" }, { state: "unavailable" })).toEqual({ state: "unavailable" });
    expect(settleRead(held, { state: "absent" })).toEqual({ state: "absent" });
    expect(settleRead(held, { state: "unreadable" })).toEqual({ state: "unreadable" });
    expect(settleRead(kept, noDate)).toEqual(noDate);
  });

  it("a stale copy or a date that has passed keeps coverage incomplete and is counted once", () => {
    const reads: Record<string, SymbolRead> = {
      AAPL: { state: "no-date", reason: "none", stale: true, refreshFailed: false },
      MSFT: { state: "no-date", reason: "past", stale: false, refreshFailed: false },
      NVDA: { state: "no-date", reason: "past", stale: false, refreshFailed: true },
      AMD: { state: "no-date", reason: "none", stale: false, refreshFailed: false },
    };
    const c = summarizeCoverage(["AAPL", "MSFT", "NVDA", "AMD"], reads);
    expect(c).toMatchObject({ companies: 4, read: 4, current: 1, stale: 1, outdated: 2, refreshFailed: 1, complete: false });
    expect(unknownCount(c)).toBe(3);
    expect(summarizeCoverage(["AMD"], { AMD: reads.AMD }).complete).toBe(true);
    expect(summarizeCoverage(["MSFT"], { MSFT: reads.MSFT }).complete).toBe(false);
    expect(summarizeCoverage(["AAPL"], { AAPL: reads.AAPL }).complete).toBe(false);
  });

  it("a list of non-companies is never complete (nothing was read)", () => {
    expect(summarizeCoverage(["^GSPC"], { "^GSPC": { state: "not-company" } }).complete).toBe(false);
    expect(summarizeCoverage([], {}).complete).toBe(false);
  });
});

describe("bounded reader (AC-E14-05/06 support)", () => {
  const jobs = (symbols: string[]): EventReadJob[] => symbols.map((symbol) => ({ symbol, profile: US }));

  it("never exceeds the concurrency bound, reads each company once, and uses no timer", async () => {
    const timeout = vi.spyOn(globalThis, "setTimeout");
    const interval = vi.spyOn(globalThis, "setInterval");
    const urls: string[] = [];
    let inFlight = 0;
    let peak = 0;
    const read = async (url: string): Promise<CacheOutcome> => {
      urls.push(url);
      inFlight += 1; peak = Math.max(peak, inFlight);
      for (let i = 0; i < 3; i += 1) await Promise.resolve();
      inFlight -= 1;
      return { status: "data", data: fund(null) };
    };
    const results: string[] = [];
    const symbols = Array.from({ length: 11 }, (_, i) => `S${i}`);
    await runEventReads(jobs(symbols), { read, isCurrent: () => true, onResult: (s) => results.push(s), seen: new Map() });
    expect(peak).toBe(EVENT_READ_CONCURRENCY);
    expect(urls).toEqual(symbols.map((s) => `/data/${s}.fund.json`));
    expect(results.sort()).toEqual([...symbols].sort());
    expect(timeout).not.toHaveBeenCalled();
    expect(interval).not.toHaveBeenCalled();
  });

  it("a forced re-read bypasses cached copies; a normal read subscribes to the one-shot revalidation", async () => {
    const seenOpts: (GetOpts | undefined)[] = [];
    const read = async (_url: string, opts?: GetOpts): Promise<CacheOutcome> => { seenOpts.push(opts); return { status: "data", data: fund(null) }; };
    await runEventReads(jobs(["A"]), { read, force: true, isCurrent: () => true, onResult: () => {} });
    await runEventReads(jobs(["B"]), { read, isCurrent: () => true, onResult: () => {} });
    expect(seenOpts[0]).toEqual({ ttl: 0, swr: false });
    expect(typeof seenOpts[1]?.onRevalidate).toBe("function");
  });

  it("drops every answer once the view is no longer current", async () => {
    let current = true;
    const results: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const read = async (): Promise<CacheOutcome> => { await gate; return { status: "data", data: fund("2026-10-29") }; };
    const done = runEventReads(jobs(["A", "B", "C", "D", "E", "F"]), { read, isCurrent: () => current, onResult: (s) => results.push(s), seen: new Map() });
    current = false;
    release();
    await done;
    expect(results).toEqual([]);
  });

  it("a rejected read is unavailable, never empty", async () => {
    const out: SymbolRead[] = [];
    await runEventReads(jobs(["A"]), { read: () => Promise.reject(new Error("offline")), isCurrent: () => true, onResult: (_s, r) => out.push(r) });
    expect(out).toEqual([{ state: "unavailable" }]);
  });

  it("a stale copy is corrected in place by its revalidation, or flagged when the refresh fails", async () => {
    const seen = new Map<string, SeenDay>();
    const out: Array<[string, SymbolRead]> = [];
    const failed: string[] = [];
    let revalidate: ((data: unknown) => void) | undefined;
    let settleB!: (r: "ok" | "failed" | "superseded") => void;
    const read = async (url: string, opts?: GetOpts): Promise<CacheOutcome> => {
      if (url.includes("/A.")) {
        revalidate = opts?.onRevalidate;
        return { status: "data", data: fund("2026-10-29"), stale: { ageMs: 9e6, source: "disk", revalidation: Promise.resolve("ok") } };
      }
      return { status: "data", data: fund(null), stale: { ageMs: 9e6, source: "disk", revalidation: new Promise((r) => { settleB = r; }) } };
    };
    await runEventReads(jobs(["A", "B"]), { read, isCurrent: () => true, onResult: (s, r) => out.push([s, r]), onRefreshFailed: (s) => failed.push(s), seen });
    revalidate?.(fund("2026-11-05"));
    settleB("failed");
    await Promise.resolve(); await Promise.resolve();
    const aReads = out.filter(([s]) => s === "A").map(([, r]) => r);
    expect(aReads).toHaveLength(2);
    expect(aReads[0].state === "event" && aReads[0].stale).toBe(true);
    const last = aReads[1];
    expect(last.state === "event" && [last.event.when.day, last.event.previousDay, last.stale]).toEqual(["2026-11-05", "2026-10-29", false]);
    expect(isCurrentAnswer(last)).toBe(true);
    expect(failed).toEqual(["B"]);
  });

  it("a refresh the cache superseded leaves the copy marked stale", async () => {
    const out: SymbolRead[] = [];
    const failed: string[] = [];
    const read = async (): Promise<CacheOutcome> =>
      ({ status: "data", data: fund("2026-10-29"), stale: { ageMs: 9e6, source: "disk", revalidation: Promise.resolve("superseded") } });
    await runEventReads(jobs(["A"]), { read, isCurrent: () => true, onResult: (_s, r) => out.push(r), onRefreshFailed: (s) => failed.push(s), seen: new Map() });
    await Promise.resolve(); await Promise.resolve();
    expect(out).toHaveLength(1);
    expect(out[0].state === "event" && out[0].stale).toBe(true);
    expect(failed).toEqual([]);
    expect(summarizeCoverage(["A"], { A: out[0] })).toMatchObject({ stale: 1, current: 0, complete: false });
  });

  it("a correction after a batch change still lands while the list is current", async () => {
    let batchCurrent = true;
    const out: string[] = [];
    let revalidate: ((data: unknown) => void) | undefined;
    const read = async (_url: string, opts?: GetOpts): Promise<CacheOutcome> => {
      revalidate = opts?.onRevalidate;
      return { status: "data", data: fund("2026-10-29"), stale: { ageMs: 9e6, source: "memory", revalidation: Promise.resolve("ok") } };
    };
    await runEventReads(jobs(["A"]), { read, isCurrent: () => batchCurrent, isListCurrent: () => true, onResult: (s) => out.push(s), seen: new Map() });
    batchCurrent = false;
    revalidate?.(fund("2026-10-30"));
    expect(out).toEqual(["A", "A"]);
  });
});
