/**
 * chartEngineBench.test.ts — unit tests for the P4 performance-budget harness.
 *
 * Covers the corpus generator (A1), receipt builder + schema validator (A2),
 * the committed-receipts directory gate (A3), and the pure helpers the mount
 * hook / Playwright protocol share (A4). The DOM page is exercised by the
 * Playwright spec, not here.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  BUDGETS,
  METRIC_NAMES,
  buildReceipt,
  computeViolations,
  loadReceiptSchema,
  schemaBudgetMaxima,
  validateReceipt,
  type ReceiptMetrics,
} from "../chart-engine/bench/receipt";
import {
  DAILY_40K,
  DEFAULT_CORPUS_SEED,
  IDLE_GAP_MS,
  buildDailyCorpus,
  digestCorpus,
  frameDeltas,
  isWeekdayUtc,
  median,
  nextBusinessDayUnix,
  numericTime,
  p95,
  planTick,
  utcWeekday,
} from "../chart-engine/bench/corpus";

const TERMINAL_ROOT = path.resolve(__dirname, "..", "..");
const REPO_ROOT = path.resolve(TERMINAL_ROOT, "..");
const RECEIPTS_DIR = path.join(REPO_ROOT, "docs", "chart-engine-completion", "receipts");
const SCHEMA_PATH = path.join(REPO_ROOT, "docs", "chart-engine-completion", "performance-receipt.schema.json");

/** FNV-1a of the default 40k corpus — fixture constant; a seed change reds this. */
const CORPUS_DIGEST_FIXTURE = "401f56d4";

const GREEN_METRICS: ReceiptMetrics = {
  first_paint_ms: 100,
  pan_frame_p95_ms: 16,
  zoom_frame_p95_ms: 16,
  live_commit_ms: 2,
  screenshot_ms: 20,
  heap_mb: 40,
};

function greenReceipt(overrides: Record<string, unknown> = {}) {
  return {
    commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    generated_at: "2026-10-13T00:00:00.000Z",
    host: { os: "linux test", cpu: "test cpu", dpr: 2 },
    corpus: { name: "daily-40k", bars: 40000 },
    metrics: { ...GREEN_METRICS },
    budget_ok: true,
    violations: [],
    ...overrides,
  };
}

describe("chart-engine bench corpus (A1)", () => {
  const corpus = buildDailyCorpus();

  it("exports DAILY_40K identity and returns exactly 40,000 candles", () => {
    expect(DAILY_40K).toEqual({ name: "daily-40k", bars: 40000 });
    expect(corpus.candles).toHaveLength(DAILY_40K.bars);
  });

  it("uses strictly increasing numeric weekday times with weekend gaps only", () => {
    const times = corpus.candles.map((c) => numericTime(c.time));
    for (let i = 0; i < times.length; i++) {
      expect(typeof corpus.candles[i].time, `candle[${i}] time is numeric unix seconds`).toBe("number");
      expect(isWeekdayUtc(times[i]), `candle[${i}] is a UTC weekday`).toBe(true);
      if (i === 0) continue;
      expect(times[i], `candle[${i}] time strictly increases`).toBeGreaterThan(times[i - 1]);
      const days = (times[i] - times[i - 1]) / 86400;
      const prevDow = utcWeekday(times[i - 1]);
      if (prevDow === 5) {
        expect(days, `Friday→Monday step at ${i}`).toBe(3);
      } else {
        expect(days, `weekday run step at ${i}`).toBe(1);
      }
    }
  });

  it("keeps OHLC well-formed and volume > 0 on every bar", () => {
    for (let i = 0; i < corpus.candles.length; i++) {
      const b = corpus.candles[i];
      expect(b.high, `high>=max(open,close) at ${i}`).toBeGreaterThanOrEqual(Math.max(b.open, b.close));
      expect(b.low, `low<=min(open,close) at ${i}`).toBeLessThanOrEqual(Math.min(b.open, b.close));
    }
    for (let i = 0; i < corpus.volume.length; i++) {
      expect(corpus.volume[i].value, `volume>0 at ${i}`).toBeGreaterThan(0);
    }
  });

  it("emits one overlay/oscillator/volume point per candle at the same times", () => {
    expect(corpus.ma20).toHaveLength(40000);
    expect(corpus.ma50).toHaveLength(40000);
    expect(corpus.volume).toHaveLength(40000);
    expect(corpus.oscillator).toHaveLength(40000);
    for (let i = 0; i < 40000; i++) {
      const t = corpus.candles[i].time;
      expect(corpus.ma20[i].time).toBe(t);
      expect(corpus.ma50[i].time).toBe(t);
      expect(corpus.volume[i].time).toBe(t);
      expect(corpus.oscillator[i].time).toBe(t);
    }
  });

  it("places at most 200 markers on the most recent 200 candle times", () => {
    expect(corpus.markers.length).toBeLessThanOrEqual(200);
    const last200 = new Set(corpus.candles.slice(-200).map((c) => c.time));
    for (const m of corpus.markers) {
      expect(last200.has(m.time), `marker time ${String(m.time)} is among the last 200 candles`).toBe(true);
    }
    expect(corpus.watermark.lines.length).toBeGreaterThan(0);
  });

  it("is byte-identical for the same seed and differs for another seed", () => {
    expect(digestCorpus(buildDailyCorpus())).toBe(CORPUS_DIGEST_FIXTURE);
    expect(digestCorpus(buildDailyCorpus(40000, DEFAULT_CORPUS_SEED))).toBe(CORPUS_DIGEST_FIXTURE);
    expect(digestCorpus(buildDailyCorpus(40000, DEFAULT_CORPUS_SEED + 1))).not.toBe(CORPUS_DIGEST_FIXTURE);
  });
});

describe("chart-engine bench receipt (A2)", () => {
  it("BUDGETS matches the schema allOf maxima (derived, not hardcoded twice)", () => {
    expect(existsSync(SCHEMA_PATH)).toBe(true);
    const maxima = schemaBudgetMaxima();
    for (const name of METRIC_NAMES) {
      expect(BUDGETS[name], `BUDGETS.${name} vs schema allOf maximum`).toBe(maxima[name]);
    }
    const schema = loadReceiptSchema();
    const allOf = schema.allOf as Array<{ then?: { properties?: { metrics?: { properties?: Record<string, { maximum: number }> } } } }>;
    const props = allOf[0]?.then?.properties?.metrics?.properties;
    expect(props).toBeTruthy();
    expect(props!.first_paint_ms.maximum).toBe(150);
    expect(props!.pan_frame_p95_ms.maximum).toBe(18);
    expect(props!.zoom_frame_p95_ms.maximum).toBe(18);
    expect(props!.live_commit_ms.maximum).toBe(4);
    expect(props!.screenshot_ms.maximum).toBe(50);
    expect(props!.heap_mb.maximum).toBe(60);
  });

  it("computeViolations reports the over-budget metric and [] when all under", () => {
    expect(computeViolations(GREEN_METRICS)).toEqual([]);
    const over: ReceiptMetrics = { ...GREEN_METRICS, pan_frame_p95_ms: 21.4 };
    expect(computeViolations(over)).toEqual([{ metric: "pan_frame_p95_ms", value: 21.4, budget: 18 }]);
  });

  it("buildReceipt sets budget_ok consistently with violations", () => {
    const green = buildReceipt({
      commit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      generated_at: "2026-10-13T12:00:00.000Z",
      host: { os: "linux", cpu: "cpu", dpr: 2 },
      metrics: GREEN_METRICS,
    });
    expect(green.budget_ok).toBe(true);
    expect(green.violations).toEqual([]);
    expect(green.corpus).toEqual({ name: "daily-40k", bars: 40000 });
    const red = buildReceipt({
      commit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      host: { os: "linux", cpu: "cpu", dpr: 2 },
      metrics: { ...GREEN_METRICS, pan_frame_p95_ms: 21.4 },
    });
    expect(red.budget_ok).toBe(false);
    expect(red.violations).toEqual([{ metric: "pan_frame_p95_ms", value: 21.4, budget: 18 }]);
  });

  it("validateReceipt accepts a green fixture", () => {
    const result = validateReceipt(greenReceipt());
    expect(result).toEqual({ ok: true });
  });

  it("validateReceipt rejects budget_ok:true with an over-budget metric", () => {
    const bad = greenReceipt({
      metrics: { ...GREEN_METRICS, first_paint_ms: 200 },
      budget_ok: true,
      violations: [],
    });
    const result = validateReceipt(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toMatch(/first_paint_ms|maximum/i);
  });

  it("validateReceipt rejects a 39-hex commit", () => {
    const result = validateReceipt(greenReceipt({ commit: "a".repeat(39) }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toMatch(/commit|pattern/i);
  });

  it("validateReceipt rejects an extra top-level property", () => {
    const result = validateReceipt(greenReceipt({ notes: "not allowed" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toMatch(/additional|must NOT/i);
  });

  it("validateReceipt rejects a metric of 0", () => {
    const result = validateReceipt(greenReceipt({
      metrics: { ...GREEN_METRICS, live_commit_ms: 0 },
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toMatch(/live_commit_ms|exclusiveMinimum|> 0/i);
  });

  it("validateReceipt rejects budget_ok:false with empty violations", () => {
    const result = validateReceipt(greenReceipt({ budget_ok: false, violations: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toMatch(/violations|minItems|must NOT/i);
  });

  it("validateReceipt rejects generated_at that is not date-time", () => {
    const result = validateReceipt(greenReceipt({ generated_at: "yesterday" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toMatch(/date-time|format/i);
  });
});

describe("chart-engine committed receipts gate (A3)", () => {
  it("validates every committed receipt json and reports a red mm receipt by name", () => {
    expect(existsSync(RECEIPTS_DIR), "docs/chart-engine-completion/receipts/ must exist").toBe(true);
    const files = readdirSync(RECEIPTS_DIR).filter((f) => f.endsWith(".json")).sort();
    const invalid: string[] = [];
    const redMm: string[] = [];
    for (const file of files) {
      const raw = JSON.parse(readFileSync(path.join(RECEIPTS_DIR, file), "utf8")) as unknown;
      const result = validateReceipt(raw);
      if (!result.ok) invalid.push(`${file}: ${result.errors.join("; ")}`);
      if (
        file.startsWith("receipt-mm-") &&
        typeof raw === "object" &&
        raw !== null &&
        (raw as { budget_ok?: unknown }).budget_ok === false
      ) {
        redMm.push(file);
      }
    }
    expect(invalid, `invalid committed receipts:\n${invalid.join("\n")}`).toEqual([]);
    expect(redMm, `committed mm receipts with budget_ok:false: ${redMm.join(", ")}`).toEqual([]);
  });
});

describe("chart-engine bench pure helpers (A4)", () => {
  it("planTick rolls a new business-day bar every 50th tick", () => {
    const last = { time: Date.UTC(2024, 0, 5) / 1000, open: 10, high: 11, low: 9, close: 10.5 };
    // 2024-01-05 is Friday; the 50th tick (index 49) must land on Monday.
    const update = planTick(last, 0, 0.75);
    expect(update.kind).toBe("update");
    expect(update.bar.time).toBe(last.time);
    expect(update.bar.high).toBeGreaterThanOrEqual(Math.max(update.bar.open, update.bar.close));
    expect(update.bar.low).toBeLessThanOrEqual(Math.min(update.bar.open, update.bar.close));

    const roll = planTick(last, 49, 0.75);
    expect(roll.kind).toBe("roll");
    expect(roll.bar.time).toBe(nextBusinessDayUnix(numericTime(last.time)));
    expect(isWeekdayUtc(numericTime(roll.bar.time))).toBe(true);
    expect((numericTime(roll.bar.time) - numericTime(last.time)) / 86400).toBe(3);
  });

  it("p95 is the nearest-rank 95th percentile", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(p95(values)).toBe(95);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("frameDeltas uses consecutive working-frame timestamps and drops idle gaps", () => {
    const records = [
      { frameTs: 1000, start: 1000, end: 1001 },
      { frameTs: 1016, start: 1016, end: 1018 },
      { frameTs: 1016, start: 1017, end: 1019 },
      { frameTs: 1032, start: 1032, end: 1033 },
      { frameTs: 1032 + IDLE_GAP_MS + 20, start: 1200, end: 1201 },
    ];
    expect(frameDeltas(records)).toEqual([16, 16]);
    expect(frameDeltas(records, 1000)).toEqual([16, 16, IDLE_GAP_MS + 20]);
  });
});
