import { describe, it, expect } from "vitest";
import * as eventImpact from "@/lib/eventImpact";
import {
  joinEventImpact,
  presentCarried,
  presentPosition,
  presentUnjoinable,
  type TouchedPosition,
} from "@/lib/eventImpact";
import fs from "fs";
import path from "path";

const pos = (over: Partial<TouchedPosition> = {}): TouchedPosition => ({
  id: "p1",
  ticker: "AAPL",
  shares: 120,
  status: "open",
  ...over,
});

const baseCtx = (tickers: Record<string, unknown>) => ({
  schema: "portfolio_ctx.v1",
  asof: "2026-09-05",
  tickers,
});

describe("eventImpact join", () => {
  it("1. carries verbatim", () => {
    const ctx = baseCtx({
      AAPL: {
        earnings: {
          next: "2026-10-30",
          days_to: 5,
          direction: "Bullish setup, per source.",
          direction_zh: "来源称看涨。",
          mechanism: "Reaction via options gamma.",
          timeframe: "Over the next 5 sessions.",
        },
      },
    });
    const read = joinEventImpact({ positions: [pos()], ctx });
    expect(read.state).toBe("ok");
    if (read.state !== "ok") throw new Error("unreachable");
    const e = read.events[0];
    expect(presentCarried(e.direction, "en")).toBe("Bullish setup, per source.");
    expect(presentCarried(e.direction, "zh")).toBe("来源称看涨。");
    expect(presentCarried(e.mechanism, "en")).toBe("Reaction via options gamma.");
    expect(presentCarried(e.timeframe, "en")).toBe("Over the next 5 sessions.");
  });

  it("2b. realistic production coverage (MAJOR: case 1 alone is fixture-only)", () => {
    // Measured on the macro producer's live artifact (portfolio_ctx.v2, 2026-09-06, 4,359
    // tickers): only 8 tickers carry an `earnings` block at all, and across the WHOLE artifact
    // zero tickers carry direction/mechanism/timeframe. A normal book therefore either resolves
    // to no_events (no held ticker in the 8) or to "ok" with all three slots not-stated (a held
    // ticker is one of the 8, matching case "2. prints missing" above) — it never exercises the
    // all-three-populated shape in case "1. carries verbatim", which is a mechanism unit test
    // only and does not reflect what the artifact actually emits.
    const ctx = baseCtx({
      AAPL: { earnings: { next: "2026-10-30", days_to: 5 } }, // one of the ~8 covered tickers
      // MSFT, GOOGL and every other held ticker below carry no earnings block at all — this is
      // the common case for the other 4,351 tickers in the artifact.
    });
    const positions = [
      pos({ id: "p1", ticker: "AAPL" }),
      pos({ id: "p2", ticker: "MSFT" }),
      pos({ id: "p3", ticker: "GOOGL" }),
    ];
    const read = joinEventImpact({ positions, ctx });
    expect(read.state).toBe("ok");
    if (read.state !== "ok") throw new Error("unreachable");
    expect(read.heldTickers).toBe(3);
    expect(read.events).toHaveLength(1);
    const e = read.events[0];
    expect(e.ticker).toBe("AAPL");
    expect(e.direction.state).toBe("not_stated");
    expect(e.mechanism.state).toBe("not_stated");
    expect(e.timeframe.state).toBe("not_stated");
  });

  it("2c. realistic production coverage, no held ticker covered (MAJOR)", () => {
    // The other side of the same measured shape: a book whose tickers are all outside the ~8
    // covered ones resolves to no_events, not to a false "ok" with empty events.
    const ctx = baseCtx({ AAPL: { earnings: { next: "2026-10-30", days_to: 5 } } });
    const positions = [pos({ id: "p1", ticker: "MSFT" }), pos({ id: "p2", ticker: "GOOGL" })];
    const read = joinEventImpact({ positions, ctx });
    expect(read.state).toBe("no_events");
    if (read.state !== "no_events") throw new Error("unreachable");
    expect(read.heldTickers).toBe(2);
  });

  it("2. prints missing (acceptance 2)", () => {
    const ctx = baseCtx({ AAPL: { earnings: { next: "2026-10-30", days_to: 5 } } });
    const read = joinEventImpact({ positions: [pos()], ctx });
    expect(read.state).toBe("ok");
    if (read.state !== "ok") throw new Error("unreachable");
    const e = read.events[0];
    expect(e.direction.state).toBe("not_stated");
    expect(e.mechanism.state).toBe("not_stated");
    expect(e.timeframe.state).toBe("not_stated");
    expect(presentCarried(e.direction, "en")).toBe("Not stated in the source");
    expect(presentCarried(e.direction, "zh")).toBe("来源未说明");
  });

  it("3. never guesses a date", () => {
    const cases = [
      { next: null, days_to: 5 },
      { next: "2026-10-30", days_to: null },
      { next: "", days_to: 5 },
      { next: "2026-10-30", days_to: "soon" },
    ];
    for (const earnings of cases) {
      const ctx = baseCtx({ AAPL: { earnings } });
      // A single open AAPL position is held in every case, so `no_holdings` is never reachable
      // here — the disjunction this used to assert only weakened the test (m5, review r2).
      const read = joinEventImpact({ positions: [pos()], ctx });
      expect(read.state).toBe("no_events");
    }
  });

  it("4. open positions only", () => {
    const ctx = baseCtx({ AAPL: { earnings: { next: "2026-10-30", days_to: 5 } } });
    const closedOnly = joinEventImpact({ positions: [pos({ status: "closed" })], ctx });
    expect(closedOnly.state).toBe("no_holdings");
    const reopened = joinEventImpact({
      positions: [pos({ status: "closed" }), pos({ id: "p2", status: "open" })],
      ctx,
    });
    expect(reopened.state).toBe("ok");
    if (reopened.state === "ok") expect(reopened.events.length).toBe(1);
  });

  it("5. unsized position still touched", () => {
    const ctx = baseCtx({ AAPL: { earnings: { next: "2026-10-30", days_to: 5 } } });
    const read = joinEventImpact({ positions: [pos({ shares: null })], ctx });
    expect(read.state).toBe("ok");
    if (read.state !== "ok") throw new Error("unreachable");
    const p = read.events[0].positions[0];
    expect(p.shares).toBeNull();
    expect(presentPosition(p, "en")).toBe("Size not recorded");
    expect(presentPosition(p, "zh")).toBe("未记录持仓数量");
  });

  it("6. ordering is date-then-ticker", () => {
    const ctx = baseCtx({
      ZZZZ: { earnings: { next: "2026-09-10", days_to: 1 } },
      AAPL: { earnings: { next: "2026-11-01", days_to: 50 } },
    });
    const read = joinEventImpact({
      positions: [
        pos({ id: "big", ticker: "AAPL", shares: 10000 }),
        pos({ id: "small", ticker: "ZZZZ", shares: 1 }),
      ],
      ctx,
    });
    expect(read.state).toBe("ok");
    if (read.state !== "ok") throw new Error("unreachable");
    expect(read.events.map((e) => e.ticker)).toEqual(["ZZZZ", "AAPL"]);
  });

  it("7. no scorer can be added silently", () => {
    const allowlist = [
      "joinEventImpact",
      "presentCarried",
      "presentDaysUntil",
      "presentEventSentence",
      "presentPosition",
      "presentUnjoinable",
      "NOT_STATED",
      "UNJOINABLE_SOURCES",
    ].sort();
    expect(Object.keys(eventImpact).sort()).toEqual(allowlist);
  });

  it("8. typed unreadable states", () => {
    expect(joinEventImpact({ positions: null, ctx: {} }).state).toBe("holdings_unreadable");
    expect(joinEventImpact({ positions: [pos()], ctx: null }).state).toBe("calendar_unreadable");
    expect(
      joinEventImpact({ positions: [pos()], ctx: { schema: "something_else.v1" } }).state
    ).toBe("calendar_unreadable");
  });

  it("8b. a locked upstream is 'upstream_locked', never 'no_events' (BLOCKER 1, review r2)", () => {
    // The registration wall answers with no ctx at all — `ctxLocked` is the only signal
    // distinguishing "we were denied" from "the artifact is malformed" (both leave `ctx: null`).
    const locked = joinEventImpact({ positions: [pos()], ctx: null, ctxError: "HTTP 401", ctxLocked: true });
    expect(locked.state).toBe("upstream_locked");
    expect(locked.state).not.toBe("no_events");
    expect(locked.state).not.toBe("calendar_unreadable");

    // Without ctxLocked, the exact same null ctx stays the generic "artifact is broken" state —
    // ctxLocked must be the ONLY thing that changes the outcome, not the presence of ctxError.
    const unlocked = joinEventImpact({ positions: [pos()], ctx: null, ctxError: "HTTP 500" });
    expect(unlocked.state).toBe("calendar_unreadable");

    // A locked upstream with no holdings read at all is still `holdings_unreadable` — that check
    // runs first and ctxLocked never overrides a real "no book" fact.
    const noBook = joinEventImpact({ positions: null, ctx: null, ctxLocked: true });
    expect(noBook.state).toBe("holdings_unreadable");
  });

  it("8c. heldPositions counts open positions, not distinct tickers (m1, review r2)", () => {
    const ctx = baseCtx({});
    const read = joinEventImpact({
      positions: [pos({ id: "p1" }), pos({ id: "p2" })], // two AAPL positions, one ticker
      ctx,
    });
    expect(read.state).toBe("no_events");
    if (read.state !== "no_events") throw new Error("unreachable");
    expect(read.heldTickers).toBe(1);
    expect(read.heldPositions).toBe(2);
  });

  it("9. empty vs unreadable are distinct", () => {
    const ctxNoEvents = baseCtx({});
    const zeroHeld = joinEventImpact({ positions: [], ctx: ctxNoEvents });
    expect(zeroHeld.state).toBe("no_holdings");
    const noNamed = joinEventImpact({ positions: [pos()], ctx: ctxNoEvents });
    expect(noNamed.state).toBe("no_events");
    if (noNamed.state === "no_events") expect(noNamed.heldTickers).toBe(1);
  });

  it("10. unjoinable disclosure", () => {
    const read = joinEventImpact({ positions: [pos()], ctx: baseCtx({}) });
    if (read.state !== "no_events") throw new Error("unreachable");
    const en = presentUnjoinable(read.unjoinable, "en");
    const zh = presentUnjoinable(read.unjoinable, "zh");
    expect(en).toContain("macro release calendar");
    expect(en).toContain("index-review calendar");
    expect(zh).toContain("宏观数据发布日历");
    expect(zh).toContain("指数检讨日历");
  });

  it("11. single source of the missing string", () => {
    const file = fs.readFileSync(
      path.join(process.cwd(), "components", "EventImpactPanel.tsx"),
      "utf8"
    );
    expect(file.includes("Not stated in the source")).toBe(false);
    expect(file.includes("来源未说明")).toBe(false);
    const copyMatch = file.match(/const COPY: Record<string, \[string, string\]> = \{([\s\S]*?)\n\};/);
    expect(copyMatch).not.toBeNull();
    const body = copyMatch![1];
    const entries = [...body.matchAll(/\[\s*"([^"]*)"\s*,\s*"([^"]*)"\s*\]/g)];
    expect(entries.length).toBeGreaterThan(0);
    for (const [, en, zh] of entries) {
      expect(en.length).toBeGreaterThan(0);
      expect(zh.length).toBeGreaterThan(0);
    }
  });

  it("12. presentPosition pluralizes EN shares, ZH is invariant (major m1, review r3)", () => {
    // RED before the fix: "You hold 1 shares" is what the un-pluralized template produced.
    expect(presentPosition({ ...pos(), shares: 1 }, "en")).toBe("You hold 1 share");
    expect(presentPosition({ ...pos(), shares: 1 }, "en")).not.toBe("You hold 1 shares");
    expect(presentPosition({ ...pos(), shares: 2 }, "en")).toBe("You hold 2 shares");
    expect(presentPosition({ ...pos(), shares: 1 }, "zh")).toBe("你持有 1 股");
    expect(presentPosition({ ...pos(), shares: 2 }, "zh")).toBe("你持有 2 股");
  });

  it("13. zero holdings outranks a locked/unreadable calendar (minor 3, review r3)", () => {
    // A user with no open positions must see the neutral "add a position" state regardless of
    // whether the calendar can be read — before the reorder, the ctx-schema/locked check ran
    // first and this rendered "upstream_locked" ("your positions are unaffected") to someone
    // with no positions to be unaffected in.
    const lockedNoBook = joinEventImpact({ positions: [], ctx: null, ctxError: "HTTP 401", ctxLocked: true });
    expect(lockedNoBook.state).toBe("no_holdings");

    const unreadableNoBook = joinEventImpact({ positions: [], ctx: null, ctxError: "HTTP 500" });
    expect(unreadableNoBook.state).toBe("no_holdings");

    // Same locked ctx, but WITH an open position: still upstream_locked (unchanged behavior).
    const lockedWithBook = joinEventImpact({
      positions: [pos()],
      ctx: null,
      ctxError: "HTTP 401",
      ctxLocked: true,
    });
    expect(lockedWithBook.state).toBe("upstream_locked");
  });

  it("14. ZH register: no panel copy string addresses the user as 您 (RULING r3, item 2)", () => {
    // eiUpstreamLocked's ZH half used the formal/distancing 您 while every other ZH string in
    // the panel uses the plain 你 — a register mismatch a user would notice line to line. RED
    // before the fix: this failed on "目前无法读取事件日历，您的持仓不受影响。".
    const file = fs.readFileSync(
      path.join(process.cwd(), "components", "EventImpactPanel.tsx"),
      "utf8"
    );
    const copyMatch = file.match(/const COPY: Record<string, \[string, string\]> = \{([\s\S]*?)\n\};/);
    expect(copyMatch).not.toBeNull();
    const body = copyMatch![1];
    // Entries wrap two ways — single-line (`key: ["a", "b"],`) and multi-line
    // (`key: [\n  "a",\n  "b",\n],`, with a trailing comma before the closing
    // bracket). An earlier version of this regex required `\s*\]` right after
    // the ZH string with no comma allowed, so it silently matched only the
    // single-line entries (6 of 18) and never inspected eiUpstreamLocked —
    // the exact multi-line entry the RULING named. The trailing `,?` here is
    // load-bearing: removing it reproduces that silent gap.
    const entries = [...body.matchAll(/\[\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,?\s*\]/g)];
    expect(entries.length).toBe(18);
    for (const [, , zh] of entries) {
      expect(zh.includes("您")).toBe(false);
    }
  });

  it("15. no unread/locked state's copy claims positions are fine/unaffected, except calendar_unreadable's own sentence (MAJOR COPY RULING, r4)", () => {
    // RED before the fix: eiUpstreamLocked read "We could not read the event calendar right
    // now. Your positions are unaffected." / "...你的持仓不受影响。" — the unchecked state
    // asserting a fact (positions are fine) it never checked. The r2-frozen string is WITHDRAWN
    // by r4: `upstream_locked` means the calendar could not be read at all, so nothing about the
    // user's positions can be said. `eiCalendarUnreadable` is the one legitimate exception,
    // because there the positions data WAS actually read — only the calendar is missing.
    const file = fs.readFileSync(
      path.join(process.cwd(), "components", "EventImpactPanel.tsx"),
      "utf8"
    );
    const copyMatch = file.match(/const COPY: Record<string, \[string, string\]> = \{([\s\S]*?)\n\};/);
    expect(copyMatch).not.toBeNull();
    const body = copyMatch![1];
    // Same wrap-tolerant tuple regex as test 14, but this one also captures the key name so each
    // string can be checked against the state it actually belongs to.
    const keyed = new Map<string, [string, string]>();
    for (const m of body.matchAll(/(\w+):\s*\[\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,?\s*\]/g)) {
      keyed.set(m[1], [m[2], m[3]]);
    }
    expect(keyed.size).toBe(18);

    const bannedEn = /\bunaffected\b|\bfine\b/i;
    // "没有问题" ("no problem") is the ZH twin of EN "fine" — it is the literal phrasing
    // `eiCalendarUnreadable`'s own retained-exception sentence uses (line 53 of the panel), so it
    // must be banned everywhere else exactly like "不受影响" is (minor 1, review r5): without it,
    // re-authoring the withdrawn r2 defect in ZH register ("...你的持仓没有问题。") on any other
    // state would pass this guard while its EN twin ("fine") would not.
    const bannedZh = /不受影响|没有问题/;

    const upstreamLocked = keyed.get("eiUpstreamLocked");
    expect(upstreamLocked).toBeDefined();
    expect(bannedEn.test(upstreamLocked![0])).toBe(false);
    expect(bannedZh.test(upstreamLocked![1])).toBe(false);

    // calendar_unreadable is the sole named exception — its own sentence may say the positions
    // are fine, because that state's positions read actually succeeded.
    expect(keyed.get("eiCalendarUnreadable")).toBeDefined();

    for (const [key, [en, zh]] of keyed) {
      if (key === "eiCalendarUnreadable") continue;
      expect(bannedEn.test(en)).toBe(false);
      expect(bannedZh.test(zh)).toBe(false);
    }
  });

  it("16. the three unreadable/locked states carry mutually distinct sentences in EN and ZH (MAJOR 1, review r5)", () => {
    // RULING's own reviewer criterion (Meta-CEO B r4): "the three unreadable/locked states each
    // carry a distinct, truthful sentence in EN and ZH and the tests pin them." Test 15 pins
    // truthfulness (no state claims positions are fine except the one that read them). This test
    // pins distinctness: nothing stops `eiHoldingsUnreadable`'s ZH half from being copy-pasted
    // onto `eiUpstreamLocked`, or two states being made identical, without this failing — case 11
    // only requires each tuple be non-empty, never that DIFFERENT states say DIFFERENT things.
    const file = fs.readFileSync(
      path.join(process.cwd(), "components", "EventImpactPanel.tsx"),
      "utf8"
    );
    const copyMatch = file.match(/const COPY: Record<string, \[string, string\]> = \{([\s\S]*?)\n\};/);
    expect(copyMatch).not.toBeNull();
    const body = copyMatch![1];
    const keyed = new Map<string, [string, string]>();
    for (const m of body.matchAll(/(\w+):\s*\[\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,?\s*\]/g)) {
      keyed.set(m[1], [m[2], m[3]]);
    }
    const states = ["eiHoldingsUnreadable", "eiCalendarUnreadable", "eiUpstreamLocked"] as const;
    for (const key of states) expect(keyed.get(key)).toBeDefined();
    const [holdings, calendar, upstream] = states.map((k) => keyed.get(k)!);

    // Pairwise distinct, EN half.
    expect(holdings[0]).not.toBe(calendar[0]);
    expect(holdings[0]).not.toBe(upstream[0]);
    expect(calendar[0]).not.toBe(upstream[0]);
    // Pairwise distinct, ZH half.
    expect(holdings[1]).not.toBe(calendar[1]);
    expect(holdings[1]).not.toBe(upstream[1]);
    expect(calendar[1]).not.toBe(upstream[1]);
  });
});
