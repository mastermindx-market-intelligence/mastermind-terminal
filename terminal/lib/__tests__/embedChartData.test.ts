import { describe, it, expect } from "vitest";
import {
  parseSymbol,
  parseTheme,
  parseLang,
  parseTransparent,
  parseRange,
  toBars,
  computeQuote,
  parseDailyHistory,
  sma,
  visibleRange,
  fmtChange,
  fmtPct,
  fmtVolume,
  fmtPrice,
  type RawBar,
} from "@/lib/embed/chartData";

describe("parseSymbol", () => {
  it("uppercases a valid ticker", () => {
    expect(parseSymbol("aapl")).toBe("AAPL");
    expect(parseSymbol("  msft ")).toBe("MSFT");
  });
  it("allows dots and hyphens after the leading letter (BRK.B, BTC-USD)", () => {
    expect(parseSymbol("brk.b")).toBe("BRK.B");
    expect(parseSymbol("btc-usd")).toBe("BTC-USD");
  });
  it("rejects missing / empty / too-long / non-letter-leading symbols", () => {
    expect(parseSymbol(null)).toBeNull();
    expect(parseSymbol(undefined)).toBeNull();
    expect(parseSymbol("")).toBeNull();
    expect(parseSymbol("1AAPL")).toBeNull(); // must start with a letter
    expect(parseSymbol("TOOLONGSYMBOL")).toBeNull(); // > 10 chars
    expect(parseSymbol("A B")).toBeNull(); // space
    expect(parseSymbol("A/B")).toBeNull(); // slash not allowed
  });
  it("accepts exactly 10 characters, rejects 11", () => {
    expect(parseSymbol("ABCDEFGHIJ")).toBe("ABCDEFGHIJ");
    expect(parseSymbol("ABCDEFGHIJK")).toBeNull();
  });
});

describe("param parsers default correctly", () => {
  it("theme defaults to dark, light only when explicit", () => {
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme(undefined)).toBe("dark");
    expect(parseTheme("purple")).toBe("dark");
  });
  it("lang defaults to en, zh only when explicit", () => {
    expect(parseLang("zh")).toBe("zh");
    expect(parseLang(undefined)).toBe("en");
    expect(parseLang("fr")).toBe("en");
  });
  it("transparent is true only for 1/true", () => {
    expect(parseTransparent("1")).toBe(true);
    expect(parseTransparent("true")).toBe(true);
    expect(parseTransparent("0")).toBe(false);
    expect(parseTransparent(undefined)).toBe(false);
  });
  it("range validates and uppercases, defaults 1Y", () => {
    expect(parseRange("1m")).toBe("1M");
    expect(parseRange("MAX")).toBe("MAX");
    expect(parseRange("5Y")).toBe("5Y");
    expect(parseRange(undefined)).toBe("1Y");
    expect(parseRange("10Y")).toBe("1Y"); // unknown → default
  });
});

const mk = (rows: RawBar[]) => ({ bars: rows });

describe("toBars", () => {
  it("normalises, sorts by date, and drops malformed rows", () => {
    const bars = toBars(
      mk([
        ["2021-01-04", 10, 11, 9, 10.5, 1000],
        ["2021-01-05", 10.5, 12, 10, 11.8, 2000],
      ] as RawBar[]),
    );
    expect(bars).toHaveLength(2);
    expect(bars[0].time).toBe("2021-01-04");
    expect(bars[1].close).toBe(11.8);
  });
  it("sorts out-of-order input", () => {
    const bars = toBars(
      mk([
        ["2021-03-01", 1, 2, 0.5, 1.5, 10],
        ["2021-01-01", 1, 2, 0.5, 1.2, 10],
        ["2021-02-01", 1, 2, 0.5, 1.3, 10],
      ] as RawBar[]),
    );
    expect(bars.map((b) => b.time)).toEqual(["2021-01-01", "2021-02-01", "2021-03-01"]);
  });
  it("drops rows with non-finite OHLC or missing fields; volume defaults to 0", () => {
    const bars = toBars(
      mk([
        ["2021-01-04", 10, 11, 9, 10.5], // too short → dropped
        ["2021-01-05", 10, 11, 9, NaN, 1000], // NaN close → dropped
        ["2021-01-06", 10, 11, 9, 10.5, "x"],
      ] as unknown as RawBar[]),
    );
    // The third row has a bad volume but valid OHLC → kept with volume 0.
    expect(bars).toHaveLength(1);
    expect(bars[0].time).toBe("2021-01-06");
    expect(bars[0].volume).toBe(0);
  });
  it("returns [] for null / missing bars", () => {
    expect(toBars(null)).toEqual([]);
    expect(toBars({})).toEqual([]);
    expect(toBars({ bars: "nope" } as never)).toEqual([]);
  });
});

describe("computeQuote", () => {
  it("computes change vs the previous close", () => {
    const bars = toBars(
      mk([
        ["2021-01-04", 10, 11, 9, 100, 1000],
        ["2021-01-05", 100, 120, 95, 110, 2000],
      ] as RawBar[]),
    );
    const q = computeQuote(bars)!;
    expect(q.last).toBe(110);
    expect(q.prev).toBe(100);
    expect(q.change).toBe(10);
    expect(q.changePct).toBeCloseTo(10, 6);
    expect(q.dir).toBe("up");
    expect(q.asOf).toBe("2021-01-05");
  });
  it("marks down and flat correctly", () => {
    const down = computeQuote(
      toBars(mk([["2021-01-04", 10, 11, 9, 100, 1], ["2021-01-05", 100, 101, 90, 95, 1]] as RawBar[])),
    )!;
    expect(down.dir).toBe("down");
    expect(down.change).toBe(-5);
    const flat = computeQuote(
      toBars(mk([["2021-01-04", 10, 11, 9, 100, 1], ["2021-01-05", 100, 101, 90, 100, 1]] as RawBar[])),
    )!;
    expect(flat.dir).toBe("flat");
  });
  it("single bar → no previous close, null change", () => {
    const q = computeQuote(toBars(mk([["2021-01-04", 10, 11, 9, 100, 1]] as RawBar[])))!;
    expect(q.prev).toBeNull();
    expect(q.change).toBeNull();
    expect(q.changePct).toBeNull();
    expect(q.dir).toBe("flat");
  });
  it("returns null for zero bars", () => {
    expect(computeQuote([])).toBeNull();
  });
});

describe("sma", () => {
  it("computes the simple moving average aligned to bar times", () => {
    const bars = toBars(
      mk([
        ["2021-01-01", 0, 0, 0, 2, 0],
        ["2021-01-02", 0, 0, 0, 4, 0],
        ["2021-01-03", 0, 0, 0, 6, 0],
        ["2021-01-04", 0, 0, 0, 8, 0],
      ] as RawBar[]),
    );
    const out = sma(bars, 2);
    // First point at index 1 (window full): (2+4)/2=3, then (4+6)/2=5, then (6+8)/2=7.
    expect(out.map((p) => p.value)).toEqual([3, 5, 7]);
    expect(out[0].time).toBe("2021-01-02");
  });
  it("returns [] when history is shorter than the window", () => {
    const bars = toBars(mk([["2021-01-01", 0, 0, 0, 2, 0]] as RawBar[]));
    expect(sma(bars, 50)).toEqual([]);
  });
});

describe("visibleRange", () => {
  const many = (n: number): RawBar[] =>
    Array.from({ length: n }, (_, i) => {
      const d = new Date(Date.UTC(2020, 0, 1 + i));
      const iso = d.toISOString().slice(0, 10);
      return [iso, 1, 1, 1, 1, 1] as RawBar;
    });

  it("returns the full span for MAX and for windows longer than history", () => {
    const bars = toBars(mk(many(30)));
    const max = visibleRange(bars, "MAX")!;
    expect(max.from).toBe(bars[0].time);
    expect(max.to).toBe(bars[bars.length - 1].time);
    // 1Y window (252) > 30 bars → full span.
    const oneY = visibleRange(bars, "1Y")!;
    expect(oneY.from).toBe(bars[0].time);
  });
  it("trims to the last ~N bars for a bounded window", () => {
    const bars = toBars(mk(many(400)));
    const oneM = visibleRange(bars, "1M")!; // ~22 bars
    const fromIdx = bars.findIndex((b) => b.time === oneM.from);
    expect(bars.length - fromIdx).toBe(22);
    expect(oneM.to).toBe(bars[bars.length - 1].time);
  });
  it("returns null for zero bars", () => {
    expect(visibleRange([], "1Y")).toBeNull();
  });
});

describe("formatters", () => {
  it("fmtPrice adds separators + 2 decimals", () => {
    expect(fmtPrice(1283.784)).toBe("1,283.78");
    expect(fmtPrice(9.5)).toBe("9.50");
  });
  it("fmtChange signs with a real minus glyph", () => {
    expect(fmtChange(9.57)).toBe("+9.57");
    expect(fmtChange(-2.1)).toBe("−2.10");
    expect(fmtChange(0)).toBe("0.00");
  });
  it("fmtPct signs and appends %", () => {
    expect(fmtPct(3.49)).toBe("+3.49%");
    expect(fmtPct(-0.74)).toBe("−0.74%");
  });
  it("fmtVolume is compact", () => {
    expect(fmtVolume(261774853)).toBe("261.77M");
    expect(fmtVolume(4210000000)).toBe("4.21B");
    expect(fmtVolume(950000)).toBe("950.0K");
    expect(fmtVolume(0)).toBe("—");
  });
});

describe("daily history source outcomes", () => {
  const bar: RawBar = ["2024-03-04", 10, 12, 9, 11, 100];

  it.each([null, undefined, {}, [], { bars: null }, { bars: "nope" }, { error: "unavailable" }].map((file) => ({ file })))(
    "does not equate a malformed envelope with no history: $file",
    ({ file }) => expect(parseDailyHistory(file)).toEqual({ kind: "unavailable" }),
  );

  it("recognises only an explicit empty bars array as an empty successful response", () => {
    expect(parseDailyHistory({ bars: [] })).toEqual({ kind: "empty" });
  });

  it.each(["2024-02-30", "2023-02-29", "1900-02-29", "2024-13-01", "2024-2-09", "2024-03-04T00:00:00Z", " 2024-03-04", "not-a-date"])(
    "cannot render or label a noncanonical calendar day: %s",
    (date) => {
      const file = { bars: [[date, ...bar.slice(1)]] } as { bars: RawBar[] };
      expect(toBars(file)).toEqual([]);
      expect(parseDailyHistory(file)).toEqual({ kind: "unavailable" });
    },
  );

  it("keeps real leap days and sorts calendar dates without converting them for display", () => {
    const result = parseDailyHistory({ bars: [
      ["2024-02-29", 10, 12, 9, 11, 100],
      ["2000-02-29", 10, 12, 9, 10, 100],
    ] });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("Expected usable daily history");
    expect(result.bars.map((row) => row.time)).toEqual(["2000-02-29", "2024-02-29"]);
    expect(result.quote.asOf).toBe("2024-02-29");
  });

  it.each([{ duplicate: bar }, { duplicate: ["2024-03-04", 20, 22, 19, 21, 200] as RawBar }])(
    "rejects duplicate usable days without selecting a winner: $duplicate",
    ({ duplicate }) => expect(parseDailyHistory({ bars: [bar, ["2024-03-03", 10, 12, 9, 10, 100], duplicate] }))
      .toEqual({ kind: "unavailable" }),
  );

  it("reports nonempty history with no finite OHLC as unavailable", () => {
    expect(parseDailyHistory({ bars: [["2024-03-04", 1, 2, 0, NaN, 100]] })).toEqual({ kind: "unavailable" });
  });

  it("retains usable rows and the existing invalid-volume fallback", () => {
    const result = parseDailyHistory({ bars: [
      ["2024-03-05", 1, 2, 0, null, 100],
      ["2024-02-30", 1, 2, 0, 1, 100],
      ["2024-03-04", 10, 12, 9, 11, "unknown"],
      ["2024-03-01", 10, 12, 9, 10, 100],
    ] });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("Expected usable daily history");
    expect(result.bars).toHaveLength(2);
    expect(result.bars[1].volume).toBe(0);
    expect(result.quote).toMatchObject({ asOf: "2024-03-04", last: 11, prev: 10, change: 1, changePct: 10 });
  });

  it("keeps a single bar without fabricating a previous close", () => {
    const result = parseDailyHistory({ bars: [bar] });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("Expected usable daily history");
    expect(result.quote).toMatchObject({ asOf: "2024-03-04", prev: null, change: null, changePct: null });
  });
});
