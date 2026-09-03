import { describe, it, expect } from "vitest";
import { spliceDaily, canSpliceRegularBar } from "@/components/ChartPanel";
import { parseTencentFields } from "@/lib/intradaySources";
import { withRegularSessionDisplay } from "@/lib/quoteDisplay";

// Regression: at the China market open, Tencent's premarket call-auction snapshot reports
// open/high/low = 0 (the session hasn't resolved yet). The live-bar splice used to accept the 0
// as the bar's open and draw a synthetic candle from $0 up to the last close — a giant spike on
// every China chart. Guard: a non-positive open/high/low is MISSING, not a real price.

// Build a Tencent "~"-delimited field record with the offsets the parser reads
// (3=last 4=prevClose 5=open 6=vol 30=ts 32=chg% 33=high 34=low 37=amount).
function tencentRecord(o: Partial<Record<number, string>>): string[] {
  const f = new Array(41).fill("0");
  f[0] = "1"; f[1] = "TestCo"; f[2] = "000729";
  for (const k of Object.keys(o)) f[+k] = o[+k as unknown as number]!;
  return f;
}

describe("parseTencentFields — premarket zero open/high/low", () => {
  it("nulls out 0 open/high/low but keeps the real last", () => {
    const rec = tencentRecord({ 3: "11.74", 4: "11.74", 5: "0.00", 33: "0.00", 34: "0.00", 30: "20260721091500", 32: "0.00" });
    const q = parseTencentFields("000729.SZ", "cn", rec)!;
    expect(q).not.toBeNull();
    expect(q.last).toBe(11.74);
    expect(q.open).toBeNull();
    expect(q.high).toBeNull();
    expect(q.low).toBeNull();
    expect(q.marketSession).toBe("pre");
    expect(q.auctionPrice).toBe(11.74);
    expect(q.auctionChg).toBe(0);
  });

  it("prefers the resolved opening-auction print once Tencent publishes it", () => {
    const rec = tencentRecord({ 3: "11.95", 4: "11.74", 5: "11.90", 30: "20260721092600", 32: "1.79" });
    const q = parseTencentFields("000729.SZ", "cn", rec)!;
    expect(q.marketSession).toBe("pre");
    expect(q.auctionPrice).toBe(11.90);
    expect(q.auctionChg).toBeCloseTo(((11.90 - 11.74) / 11.74) * 100);
  });

  it("passes real open/high/low through untouched once the session prints", () => {
    const rec = tencentRecord({ 3: "12.20", 4: "11.74", 5: "11.90", 33: "12.35", 34: "11.85", 30: "20260721100000", 32: "3.92" });
    const q = parseTencentFields("000729.SZ", "cn", rec)!;
    expect(q.open).toBe(11.90);
    expect(q.high).toBe(12.35);
    expect(q.low).toBe(11.85);
    expect(q.marketSession).toBeUndefined();
    expect(q.auctionPrice).toBeUndefined();
  });

  it("carries Tencent's explicit suspension status without inferring it from price", () => {
    const suspended = parseTencentFields("002155.SZ", "cn", tencentRecord({
      3: "24.56", 4: "24.56", 5: "0.00", 6: "0", 30: "20260826110000",
      32: "0.00", 33: "0.00", 34: "0.00", 37: "0", 40: "S",
    }))!;
    const traded = parseTencentFields("000729.SZ", "cn", tencentRecord({
      3: "12.20", 4: "11.74", 5: "11.90", 6: "500", 30: "20260826110000",
      32: "3.92", 33: "12.35", 34: "11.85", 37: "6000000", 40: "",
    }))!;

    expect(suspended.suspended).toBe(true);
    expect(withRegularSessionDisplay(suspended).suspended).toBe(true);
    expect(traded.suspended).toBeUndefined();
  });
});

describe("spliceDaily — no $0 spike from a zero-open premarket quote", () => {
  const daily = [
    { time: "2026-07-17", o: 11.5, h: 12.0, l: 11.3, c: 11.74, v: 1000 },
    { time: "2026-07-18", o: 11.74, h: 12.1, l: 11.6, c: 11.9, v: 1200 },
  ];

  it("APPEND (new session): a 0 open falls back to last, never anchors the bar at $0", () => {
    const out = spliceDaily(daily, { last: 11.74, open: 0, high: 0, low: 0, vol: 0 }, "2026-07-21");
    expect(out.length).toBe(3);
    const bar = out[out.length - 1];
    expect(bar.time).toBe("2026-07-21");
    expect(bar.o).toBe(11.74);   // NOT 0
    expect(bar.l).toBe(11.74);   // NOT 0
    expect(bar.l).toBeGreaterThan(0);
    expect(bar.c).toBe(11.74);
  });

  it("PATCH (same session): a 0 low does not drag the bar's low to $0", () => {
    const out = spliceDaily(daily, { last: 11.95, open: 0, high: 0, low: 0 }, "2026-07-18");
    expect(out.length).toBe(2);
    const bar = out[out.length - 1];
    expect(bar.l).toBe(11.6);    // original low preserved, NOT 0
    expect(bar.c).toBe(11.95);
    expect(bar.h).toBe(12.1);
  });

  it("a 0 (or missing) last is not spliceable at all", () => {
    expect(spliceDaily(daily, { last: 0, open: 11.9 }, "2026-07-21")).toBe(daily);
  });

  it("the real Tencent no-trade shape for 002155.SZ cannot synthesize a flat candle", () => {
    const raw = parseTencentFields("002155.SZ", "cn", tencentRecord({
      3: "24.56", 4: "24.56", 5: "0.00", 6: "0", 30: "20260824110000",
      32: "0.00", 33: "0.00", 34: "0.00", 37: "0", 40: "S",
    }))!;
    expect(raw).toMatchObject({
      last: 24.56,
      prevClose: 24.56,
      chg: 0,
      open: null,
      high: null,
      low: null,
      vol: 0,
      amount: 0,
      live: true,
      source: "tencent",
      market: "cn",
      basis: "LIVE",
      suspended: true,
    });

    const exposed = withRegularSessionDisplay(raw);
    expect(exposed.last).toBeNull();
    expect(exposed.regularChg).toBeNull();
    const spliceQuote = {
      last: exposed.last ?? undefined,
      open: exposed.open ?? undefined,
      high: exposed.high ?? undefined,
      low: exposed.low ?? undefined,
      vol: exposed.vol ?? undefined,
    };
    expect(spliceDaily(daily, spliceQuote, "2026-08-24")).toBe(daily);
  });

  it("valid quotes still splice exactly as before", () => {
    const out = spliceDaily(daily, { last: 12.2, open: 11.9, high: 12.35, low: 11.85, vol: 500 }, "2026-07-21");
    const bar = out[out.length - 1];
    expect(bar).toEqual({ time: "2026-07-21", o: 11.9, h: 12.35, l: 11.85, c: 12.2, v: 500 });
  });
});

// ── canSpliceRegularBar — the post-close chart gap ───────────────────────────
//
// REGRESSION (operator-reported 2026-08-07): the daily OHLC file does not roll until the
// ~23:00 ET EOD writer, so between 16:00 and 23:00 the only source of today's completed bar
// is the live quote. The guard was `marketSession === "rth"`, which blocked exactly that
// window — the header showed SKY's 94.66 close while the candles still ended at yesterday's
// 91.52. Extended prints must still never become a daily candle.
describe("canSpliceRegularBar — today's completed session belongs on the chart", () => {
  const TODAY = "2026-08-07";
  const YESTERDAY = "2026-08-06";

  it("RTH: splices the forming bar", () => {
    expect(canSpliceRegularBar("SKY", { marketSession: "rth", regularSessionDate: TODAY }, TODAY)).toBe(true);
  });

  it("post-close: splices today's COMPLETED bar (the reported gap)", () => {
    expect(canSpliceRegularBar("SKY", { marketSession: "post", regularSessionDate: TODAY }, TODAY)).toBe(true);
  });

  it("overnight after the bell, before the daily file rolls: still splices today", () => {
    expect(canSpliceRegularBar("SKY", { marketSession: "overnight", regularSessionDate: TODAY }, TODAY)).toBe(true);
  });

  it("pre-market: does NOT draw a bar for a session that has not traded", () => {
    expect(canSpliceRegularBar("SKY", { marketSession: "pre", regularSessionDate: YESTERDAY }, TODAY)).toBe(false);
  });

  it("post-close with no print from today at all (placeholder): draws nothing", () => {
    expect(canSpliceRegularBar("SKY", { marketSession: "post", regularSessionDate: undefined }, TODAY)).toBe(false);
  });

  it("never splices a quote whose regular session is a DIFFERENT day", () => {
    expect(canSpliceRegularBar("SKY", { marketSession: "post", regularSessionDate: YESTERDAY }, TODAY)).toBe(false);
  });

  it("non-US markets are unaffected — they have no separate extended lane here", () => {
    expect(canSpliceRegularBar("0700.HK", { marketSession: undefined }, TODAY)).toBe(true);
    expect(canSpliceRegularBar("600000.SS", { marketSession: undefined }, TODAY)).toBe(true);
    expect(canSpliceRegularBar("BTC-USD", { marketSession: undefined }, TODAY)).toBe(true);
  });

  it("A-share pre-open auction prices update the quote lane without drawing a candle", () => {
    expect(canSpliceRegularBar("600000.SS", { marketSession: "pre" }, TODAY)).toBe(false);
  });

  it("returns false with no quote or no session date", () => {
    expect(canSpliceRegularBar("SKY", null, TODAY)).toBe(false);
    expect(canSpliceRegularBar("SKY", { marketSession: "rth" }, null)).toBe(false);
  });
});
