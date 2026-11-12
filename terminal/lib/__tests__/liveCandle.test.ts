import { describe, expect, it } from "vitest";
import { liveDisplayEpoch, liveCandleRemaining, mutateLiveCandle, type LiveCandleBar } from "@/lib/liveCandle";

const etMs = (hour: number, minute: number, second: number) =>
  Date.UTC(2026, 7, 7, hour + 4, minute, second); // 2026-08-07 is EDT
const display = (hour: number, minute: number, second: number) =>
  Date.UTC(2026, 7, 7, hour, minute, second) / 1000;

function quote(second: number, close: number, patch: Record<string, unknown> = {}) {
  const start = etMs(9, 30, second);
  return {
    basis: "REALTIME",
    marketSession: "rth",
    last: close,
    ts: Math.floor((start + 999) / 1000),
    asOfMs: start + 999,
    tickOpen: close - 0.05,
    tickHigh: close + 0.1,
    tickLow: close - 0.1,
    tickClose: close,
    tickVol: 12,
    tickStartMs: start,
    tickEndMs: start + 999,
    ...patch,
  };
}

describe("liveDisplayEpoch", () => {
  it("places a true UTC print on the exchange-local chart clock", () => {
    expect(liveDisplayEpoch(etMs(9, 30, 7), "us")).toBe(display(9, 30, 7));
  });

  it("derives winter EST independently of the summer offset", () => {
    const winterUtc = Date.UTC(2026, 0, 15, 14, 30, 7); // 09:30:07 EST
    expect(liveDisplayEpoch(winterUtc, "us")).toBe(Date.UTC(2026, 0, 15, 9, 30, 7) / 1000);
  });
});

describe("mutateLiveCandle", () => {
  it("grows the body and both wicks inside the current 5-second candle", () => {
    const bars: LiveCandleBar[] = [{ time: display(9, 30, 5), o: 100, h: 100.2, l: 99.9, c: 100.1, v: 40 }];
    const before = structuredClone(bars);
    const result = mutateLiveCandle(bars, quote(7, 100.5, {
      tickOpen: 100.3,
      tickHigh: 100.8,
      tickLow: 99.7,
    }), "5s", "us", false);

    expect(result?.kind).toBe("tick");
    expect(result?.direction).toBe("up");
    expect(result?.bar).toEqual({ time: display(9, 30, 5), o: 100, h: 100.8, l: 99.7, c: 100.5, v: 40 });
    expect(bars).toEqual(before); // renderer caches depend on immutable array identity
  });

  it("appends the first candle of a new one-second bucket", () => {
    const bars: LiveCandleBar[] = [{ time: display(9, 30, 6), o: 100, h: 100.2, l: 99.9, c: 100.1, v: 8 }];
    const result = mutateLiveCandle(bars, quote(7, 99.8, {
      tickOpen: 100,
      tickHigh: 100.05,
      tickLow: 99.7,
      tickVol: 21,
    }), "1s", "us", false);

    expect(result?.kind).toBe("new-bar");
    expect(result?.direction).toBe("down");
    expect(result?.bars).toHaveLength(2);
    expect(result?.bar).toEqual({ time: display(9, 30, 7), o: 100, h: 100.05, l: 99.7, c: 99.8, v: 21 });
  });

  it("treats a same-close wick revision as a distinct candle mutation", () => {
    const bars: LiveCandleBar[] = [{ time: display(9, 30, 7), o: 100, h: 100.1, l: 99.9, c: 100, v: 12 }];
    const first = mutateLiveCandle(bars, quote(7, 100, {
      tickOpen: 100,
      tickHigh: 100.2,
      tickLow: 99.9,
      tickVol: 12,
    }), "1s", "us", false);
    const revised = mutateLiveCandle(bars, quote(7, 100, {
      tickOpen: 100,
      tickHigh: 100.6,
      tickLow: 99.9,
      tickVol: 20,
    }), "1s", "us", false);

    expect(first?.bar.h).toBe(100.2);
    expect(revised?.bar.h).toBe(100.6);
    expect(revised?.tickKey).not.toBe(first?.tickKey);
  });

  it("anchors an hourly live bucket to the 09:30 regular-session open", () => {
    const bars: LiveCandleBar[] = [{ time: display(9, 30, 0), o: 100, h: 101, l: 99, c: 100.2, v: 1000 }];
    const at1015 = Date.UTC(2026, 7, 7, 14, 15, 0); // 10:15 ET
    const result = mutateLiveCandle(bars, quote(0, 100.7, {
      tickStartMs: at1015,
      tickEndMs: at1015 + 999,
    }), "1h", "us", false);
    expect(result?.bar.time).toBe(display(9, 30, 0));
  });

  it("refuses delayed, older, and outside-session values", () => {
    const bars: LiveCandleBar[] = [{ time: display(9, 30, 5), o: 100, h: 100, l: 100, c: 100, v: 0 }];
    expect(mutateLiveCandle(bars, quote(7, 101, { basis: "DELAYED_15M" }), "1s", "us", false)).toBeNull();
    expect(mutateLiveCandle(bars, quote(4, 101), "1s", "us", false)).toBeNull();
    expect(mutateLiveCandle(bars, quote(7, 101, { marketSession: "post" }), "1s", "us", false)).toBeNull();
  });

  it("uses the explicit extended lane when extended hours are selected", () => {
    const pre = Date.UTC(2026, 7, 7, 12, 15, 2); // 08:15:02 ET
    const bars: LiveCandleBar[] = [{ time: display(8, 15, 1), o: 99, h: 99, l: 99, c: 99, v: 0 }];
    const result = mutateLiveCandle(bars, {
      basis: "REALTIME",
      marketSession: "pre",
      extPrice: 99.4,
      extTs: pre / 1000,
      extBasis: "LIVE",
    }, "1s", "us", true);
    expect(result?.kind).toBe("new-bar");
    expect(result?.bar).toEqual({ time: display(8, 15, 2), o: 99.4, h: 99.4, l: 99.4, c: 99.4, v: 0 });
  });
});


it("uses the same Hong Kong session anchor as historical bars",()=>{
  const time=Date.parse("2026-10-21T09:30:00Z")/1000;
  const result=mutateLiveCandle([{time,o:100,h:101,l:99,c:100,v:50}],
    {basis:"LIVE",last:102,asOfMs:Date.parse("2026-10-21T01:45:00Z")},"1h","hk",false);
  expect(result?.kind).toBe("tick");
  expect(result?.bar.time).toBe(time);
});
it("clips the regular four-hour countdown at the session close and floors elapsed candles",()=>{
  const open=Date.parse("2026-10-21T13:30:00Z")/1000;
  expect(liveCandleRemaining(open,"4h","us",false,Date.parse("2026-10-21T19:30:00Z"))).toBe(1800);
  expect(liveCandleRemaining(open,"4h","us",false,Date.parse("2026-10-21T20:30:00Z"))).toBe(0);
});
