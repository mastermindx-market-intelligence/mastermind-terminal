import { describe, expect, it } from "vitest";
import {
  MAX_SCOPE_ROWS, buildCsv, buildRows, csvText, diffRows, emptySelection, exchangeZone, exportFilename,
  formatBarTime, generationKey, indexRows, orderRows, parseJump, publishedColumns, reconcileSelection,
  resolveJump, selectRange, selectedRows, timeBasis, toggleKey,
  type ExportMeta, type InspectorBar, type InspectorColumn, type ValuesAt,
} from "../dataInspector";

// Intraday bars carry a DISPLAY epoch: the exchange wall clock read as UTC (lib/liveCandle.ts).
const et = (h: number, m: number, day = 3) => Date.UTC(2026, 9, day, h, m) / 1000;
const bar = (time: string | number, c: number, v = 1000): InspectorBar => ({ time, o: c - 1, h: c + 1, l: c - 2, c, v });

const fiveMinute = (n: number, day = 3): InspectorBar[] =>
  Array.from({ length: n }, (_, i) => bar(et(9, 30, day) + i * 300, 100 + i));

const sessions = (dates: string[]) => dates.map((d, i) => bar(d, 50 + i));

const meta = (over: Partial<ExportMeta> = {}): ExportMeta => ({
  symbol: "NVDA",
  timeframe: "5m",
  basis: { kind: "intraday", zone: "America/New_York", seconds: false },
  feedBasis: "Delayed 15 min",
  replay: false,
  scope: "all",
  plottedRows: 0,
  order: "desc",
  asOf: null,
  exportedAt: new Date("2026-10-11T12:00:00Z"),
  ...over,
});

/** Parse the export the way a reader would: drop the BOM and the "#" preamble. */
function parse(csv: string) {
  const lines = csv.replace(/^﻿/, "").split("\n");
  const preamble = lines.filter((l) => l.startsWith("#"));
  const [header, ...rows] = lines.filter((l) => !l.startsWith("#")).map((l) => l.split(","));
  return { preamble, header, rows };
}

describe("AC-E10-01 — same-date intraday bars stay individually addressable and distinct", () => {
  const bars = fiveMinute(3);
  const basis = timeBasis("NVDA", "5m", bars);

  it("labels each bar with its own exchange-clock minute, not the shared date", () => {
    expect(basis).toEqual({ kind: "intraday", zone: "America/New_York", seconds: false });
    const labels = bars.map((b) => formatBarTime(b.time, basis));
    expect(labels).toEqual(["2026-10-03 09:30", "2026-10-03 09:35", "2026-10-03 09:40"]);
    expect(new Set(labels).size).toBe(3);
  });

  it("gives every bar its own key — the canonical time, never the date", () => {
    const rows = buildRows(bars);
    expect(rows.map((r) => r.key)).toEqual(bars.map((b) => String(b.time)));
    expect(indexRows(rows).size).toBe(3);
    let sel = emptySelection(generationKey("NVDA", "5m"));
    sel = toggleKey(sel, rows[1].key);
    expect(selectedRows(rows, sel).map((r) => r.time)).toEqual([et(9, 35)]);
  });

  it("shows seconds only when the bars carry them", () => {
    const sec = [bar(et(9, 30) + 5, 1), bar(et(9, 30) + 10, 2)];
    const b = timeBasis("NVDA", "5s", sec);
    expect(b).toMatchObject({ seconds: true });
    expect(formatBarTime(sec[0].time, b)).toBe("2026-10-03 09:30:05");
  });

  it("keeps daily bars date-only and names the exchange clock per market", () => {
    const daily = sessions(["2026-10-01", "2026-10-02"]);
    const b = timeBasis("NVDA", "D", daily);
    expect(b).toEqual({ kind: "session" });
    expect(formatBarTime("2026-10-02", b)).toBe("2026-10-02");
    expect(exchangeZone("600519.SS")).toBe("Asia/Shanghai");
    expect(exchangeZone("0700.HK")).toBe("Asia/Hong_Kong");
    expect(exchangeZone("BTC-USD")).toBe("UTC");
  });
});

describe("AC-E10-02 — sorting, virtualization and hydration never re-point a selection", () => {
  const gen = generationKey("NVDA", "5m");

  it("the same keys name the same bars in either presentation order", () => {
    const rows = buildRows(fiveMinute(20));
    const sel = toggleKey(toggleKey(emptySelection(gen), rows[3].key), rows[15].key);
    const asc = orderRows(rows, "asc");
    const desc = orderRows(rows, "desc");
    // the visible row NUMBER of a selected bar differs between the orders …
    expect(asc.findIndex((r) => r.key === rows[3].key)).not.toBe(desc.findIndex((r) => r.key === rows[3].key));
    // … the selected bars do not
    expect(selectedRows(rows, sel).map((r) => r.time)).toEqual([rows[3].time, rows[15].time]);
  });

  it("a hydration that prepends history keeps the selection on the same bars (the falsifier)", () => {
    const first = buildRows(fiveMinute(10));
    const picked = first[4];
    const sel = toggleKey(emptySelection(gen), picked.key);
    // a SWR refresh publishes 6 earlier bars: every row index shifts by 6
    const earlier = Array.from({ length: 6 }, (_, i) => bar(et(9, 30) - (6 - i) * 300, 90 + i));
    const second = buildRows([...earlier, ...fiveMinute(10)]);
    const index = indexRows(second);
    const carried = reconcileSelection(sel, gen, index);
    expect(carried).toBe(sel); // nothing retired → same object
    const now = selectedRows(second, carried);
    expect(now).toHaveLength(1);
    expect(now[0].time).toBe(picked.time);
    // the row that now sits at the old row number is a different bar
    expect(second[4].time).not.toBe(picked.time);
  });

  it("re-reads corrected prices from the current publication instead of keeping a snapshot", () => {
    const bars = fiveMinute(5);
    const sel = toggleKey(emptySelection(gen), String(bars[2].time));
    const corrected = bars.map((b, i) => (i === 2 ? { ...b, c: 999 } : b));
    const rows = buildRows(corrected);
    expect(selectedRows(rows, reconcileSelection(sel, gen, indexRows(rows)))[0].bar.c).toBe(999);
  });

  it("drops retired bars rather than moving to a neighbour, and a new generation starts empty", () => {
    const rows = buildRows(fiveMinute(10));
    const sel = toggleKey(toggleKey(emptySelection(gen), rows[8].key), rows[2].key);
    const cut = buildRows(fiveMinute(6)); // a replay step back retires bars 6..9
    const after = reconcileSelection(sel, gen, indexRows(cut));
    expect([...after.keys]).toEqual([rows[2].key]);
    expect(after.anchor).toBe(rows[2].key);
    expect(reconcileSelection(sel, generationKey("NVDA", "15m"), indexRows(rows)).keys.size).toBe(0);
  });

  it("selects ranges chronologically whatever the click order, and refuses over the cap", () => {
    const rows = buildRows(fiveMinute(30));
    const index = indexRows(rows);
    let sel = toggleKey(emptySelection(gen), rows[20].key);
    const r = selectRange(sel, index, rows, rows[5].key);
    expect(r.ok).toBe(true);
    if (r.ok) sel = r.selection;
    expect(selectedRows(rows, sel).map((x) => x.seq)).toEqual(Array.from({ length: 16 }, (_, i) => 5 + i));
    // the anchor stays on the first bar picked (rows[20]); 20 → 0 is 21 bars, over a cap of 10
    expect(sel.anchor).toBe(rows[20].key);
    const refused = selectRange(sel, index, rows, rows[0].key, 10);
    expect(refused).toEqual({ ok: false, count: 21 });
  });
});

describe("AC-E10-03 — a jump lands exactly or explains the miss", () => {
  const rows = buildRows([...fiveMinute(4), bar(et(10, 30), 200)]);
  const basis = timeBasis("NVDA", "5m", rows.map((r) => r.bar));

  it("parses the table's own basis and rejects incomplete or impossible input", () => {
    expect(parseJump("2026-10-03 09:35", basis)).toBe(et(9, 35));
    expect(parseJump("2026-10-03T09:35", basis)).toBe(et(9, 35));
    expect(parseJump("2026-10-03", basis)).toBeNull();
    expect(parseJump("2026-02-30 09:35", basis)).toBeNull();
    expect(parseJump("2026-10-03 24:00", basis)).toBeNull();
    expect(parseJump("2026-10-03", { kind: "session" })).toBe("2026-10-03");
    expect(parseJump("2026-13-01", { kind: "session" })).toBeNull();
  });

  it("an exact time resolves to that bar", () => {
    expect(resolveJump(rows, et(9, 40))).toEqual({ kind: "exact", key: String(et(9, 40)) });
  });

  it("a gap reports the neighbours and never substitutes one", () => {
    expect(resolveJump(rows, et(10, 0))).toEqual({ kind: "missing", before: String(et(9, 45)), after: String(et(10, 30)) });
    expect(resolveJump(rows, et(9, 0))).toEqual({ kind: "missing", before: null, after: String(et(9, 30)) });
    expect(resolveJump(rows, et(16, 0))).toEqual({ kind: "missing", before: String(et(10, 30)), after: null });
    const daily = buildRows(sessions(["2026-10-01", "2026-10-02", "2026-10-05"]));
    expect(resolveJump(daily, "2026-10-03")).toEqual({ kind: "missing", before: "2026-10-02", after: "2026-10-05" });
  });
});

describe("AC-E10-04 — differences use the shown values, keep nulls and units", () => {
  const rows = buildRows(fiveMinute(6));
  const columns: InspectorColumn[] = [
    { key: "ema", label: "EMA 20", tag: "EMA 20" },
    { key: "ema#2", label: "EMA 50", tag: "EMA 50" },
    { key: "rsi", label: "RSI 14", tag: "RSI 14" },
  ];
  const values: Record<string, Record<string, number | null>> = {
    [rows[1].key]: { ema: 101.5, "ema#2": 99.25, rsi: 40 },
    [rows[4].key]: { ema: 103, "ema#2": 100, rsi: null },
  };
  const valuesAt: ValuesAt = (t) => values[String(t)];

  it("is always later minus earlier, whatever the pick order", () => {
    const a = diffRows(rows[4], rows[1], columns, valuesAt);
    const b = diffRows(rows[1], rows[4], columns, valuesAt);
    expect(a).toEqual(b);
    expect(a.earlier.key).toBe(rows[1].key);
    expect(a.barsApart).toBe(3);
    const close = a.fields.find((f) => f.id === "close")!;
    expect(close).toMatchObject({ unit: "price", earlier: 101, later: 104, delta: 3 });
    expect(close.pct).toBeCloseTo((3 / 101) * 100, 10);
  });

  it("keeps each indicator instance separate, studies in their own units, nulls as null", () => {
    const d = diffRows(rows[1], rows[4], columns, valuesAt);
    expect(d.fields.find((f) => f.id === "ema")).toMatchObject({ unit: "study", delta: 1.5, pct: null });
    expect(d.fields.find((f) => f.id === "ema#2")).toMatchObject({ unit: "study", delta: 0.75, pct: null });
    expect(d.fields.find((f) => f.id === "rsi")).toMatchObject({ earlier: 40, later: null, delta: null, pct: null });
    expect(d.fields.find((f) => f.id === "volume")).toMatchObject({ unit: "volume", delta: 0, pct: 0 });
  });

  it("reports which columns the chart actually publishes", () => {
    expect([...publishedColumns(rows, [...columns, { key: "macd", label: "MACD", tag: "MACD" }], valuesAt)].sort())
      .toEqual(["ema", "ema#2", "rsi"]);
    expect(publishedColumns(rows, columns, undefined).size).toBe(0);
  });
});

describe("AC-E10-05 — the CSV is exactly the chosen scope plus metadata", () => {
  const bars = fiveMinute(8);
  const rows = buildRows(bars);
  const columns: InspectorColumn[] = [
    { key: "rsi", label: "RSI", tag: "RSI 14" },
    { key: "x", label: "=HYPERLINK(\"http://evil\")", tag: "=HYPERLINK(\"http://evil\")" },
  ];
  const valuesAt: ValuesAt = (t) => ({ rsi: Number(t) % 600 === 0 ? 55.5 : null });

  it("writes only the selected rows, in display order, with the metadata preamble", () => {
    const sel = [rows[6], rows[2], rows[4]];
    const result = buildCsv(sel, columns, valuesAt, meta({ scope: "selected", plottedRows: rows.length, asOf: bars.at(-1)!.time }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.csv.startsWith("﻿# export:")).toBe(true);
    expect(result.filename).toBe("NVDA_5m_selection.csv");
    const { preamble, header, rows: out } = parse(result.csv);
    expect(preamble.map((l) => l.split(":")[0])).toEqual([
      "# export", "# symbol", "# timeframe", "# time_basis", "# source", "# feed_basis",
      "# as_of", "# replay", "# scope", "# order", "# missing_value", "# exported_at",
    ]);
    expect(preamble).toContain("# scope: selected rows (3 of 8)");
    expect(preamble).toContain("# as_of: 2026-10-03 10:05");
    expect(preamble).toContain("# feed_basis: Delayed 15 min");
    expect(preamble.find((l) => l.startsWith("# time_basis"))).toContain("America/New_York");
    expect(header.slice(0, 9)).toEqual(["time", "time_label", "open", "high", "low", "close", "change", "change_pct", "volume"]);
    expect(out.map((r) => r[0])).toEqual(sel.map((r) => String(r.time)));
    expect(out.map((r) => r[1])).toEqual(["2026-10-03 10:00", "2026-10-03 09:40", "2026-10-03 09:50"]);
  });

  it("leaves a missing value empty and neutralises a formula-shaped label", () => {
    const result = buildCsv(rows.slice(0, 2), columns, valuesAt, meta({ plottedRows: 2 }));
    if (!result.ok) throw new Error("export refused");
    const lines = result.csv.replace(/^﻿/, "").split("\n").filter((l) => !l.startsWith("#"));
    expect(lines[0].endsWith(`,RSI 14,"'=HYPERLINK(""http://evil"")"`)).toBe(true);
    // first bar has no prior close → change empty, not 0
    const first = lines[1].split(",");
    expect(first[6]).toBe("");
    expect(first[9]).toBe("55.5");
    expect(lines[2].split(",")[9]).toBe("");
    expect(csvText("-1+2")).toBe("'-1+2");
    expect(csvText("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvText("a,b")).toBe('"a,b"');
  });

  it("keeps hostile metadata on one preamble line", () => {
    const result = buildCsv(rows.slice(0, 1), [], valuesAt, meta({ symbol: "A,B\n=C", feedBasis: "x\"y" }));
    if (!result.ok) throw new Error("export refused");
    const pre = parse(result.csv).preamble;
    expect(pre).toContain("# symbol: A;B =C");
    expect(pre).toContain("# feed_basis: x;y");
    expect(exportFilename("A,B\n=C", "5m", "all")).toBe("A_B_C_5m.csv");
  });

  it("under replay the published bars already end at the cursor; nothing later can be exported", () => {
    // ChartPanel slices to the cursor before publishing; the inspector exports what it was given.
    const cursor = 5;
    const published = buildRows(bars.slice(0, cursor + 1));
    const result = buildCsv(orderRows(published, "desc"), [], undefined, meta({ replay: true, plottedRows: published.length, asOf: bars[cursor].time }));
    if (!result.ok) throw new Error("export refused");
    const { preamble, rows: out } = parse(result.csv);
    expect(preamble).toContain("# replay: on; rows end at the replay cursor");
    expect(out.map((r) => Number(r[0])).every((t) => t <= Number(bars[cursor].time))).toBe(true);
    expect(out).toHaveLength(cursor + 1);
  });

  it("refuses an empty or oversized scope instead of truncating", () => {
    expect(buildCsv([], [], undefined, meta())).toEqual({ ok: false, reason: "empty", count: 0 });
    expect(buildCsv(rows, [], undefined, meta(), 5)).toEqual({ ok: false, reason: "too-many", count: 8 });
    expect(MAX_SCOPE_ROWS).toBe(50_000);
  });

  it("daily exports keep session dates as the time key", () => {
    const daily = buildRows(sessions(["2026-10-01", "2026-10-02"]));
    const result = buildCsv(daily, [], undefined, meta({ timeframe: "D", basis: { kind: "session" } }));
    if (!result.ok) throw new Error("export refused");
    const { preamble, rows: out } = parse(result.csv);
    expect(preamble).toContain("# time_basis: trading session date; no time of day");
    expect(out.map((r) => [r[0], r[1]])).toEqual([["2026-10-01", "2026-10-01"], ["2026-10-02", "2026-10-02"]]);
  });
});
