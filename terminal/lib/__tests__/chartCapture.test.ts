import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  CHART_CAPTURE_PNG_KEYWORD, CHART_CAPTURE_SCHEMA, captureFileStem, captureFooterLines, captureSceneChanges,
  captureTimeKey, composeCaptureScene, crc32, dataCopyText, embedPngText, formatDeviceClock, isChartCaptureRequest,
  marketObservedText, readPngText, resolveCapture,
  type CapturePainted, type CaptureScene, type CaptureSceneInput, type ChartCaptureResponse,
} from "@/lib/chartCapture";
import { CHART_CAPTURE_LEX } from "@/lib/chartCaptureLex";

const en = (key: string) => CHART_CAPTURE_LEX[key]?.[0] ?? `?${key}`;
const zh = (key: string) => CHART_CAPTURE_LEX[key]?.[1] ?? `?${key}`;

const CAPTURED_AT = Date.UTC(2026, 9, 9, 14, 30, 5);

function sceneInput(over: Partial<CaptureSceneInput> = {}): CaptureSceneInput {
  return {
    source: { symbol: "NVDA", timeframe: "D" },
    requested: { symbol: "NVDA", timeframe: "D" },
    generation: 4,
    bars: [{ time: "2026-10-07", c: 180 }, { time: "2026-10-08", c: 182 }, { time: "2026-10-09", c: 184.5 }],
    visibleRange: { from: "2026-10-07", to: "2026-10-09" },
    viewport: { width: 980.4, height: 540.6, maximizedPane: null },
    panes: [
      { entries: [{ key: "ma", label: "MA 20", hidden: false }, { key: "vol", label: "Volume", hidden: false }] },
      { entries: [{ key: "rsi", label: "RSI 14", hidden: true }, { key: "ma", label: "MA 20", hidden: false }] },
    ],
    drawings: [{}, { hidden: true }, { hidden: false }],
    liveTick: null,
    replay: false,
    copy: { kind: "current" },
    ...over,
  };
}

const painted = (over: Partial<CapturePainted> = {}): CapturePainted => ({
  indicatorOverlay: true, signals: false, annotations: false, tables: 0, studyLabels: 2, maximizedCrop: false, notCaptured: [], ...over,
});

function response(before: CaptureScene, after: CaptureScene = before, over: Partial<Extract<ChartCaptureResponse, { ok: true }>> = {}): ChartCaptureResponse {
  return {
    ok: true, blob: new Blob([]), width: 1960, height: 1080, capturedAtMs: CAPTURED_AT,
    includeAnnotations: false, before, after, painted: painted(), ...over,
  };
}

function ready(r: ChartCaptureResponse) {
  const outcome = resolveCapture(r);
  if (outcome.status !== "ready") throw new Error(`expected ready, got ${outcome.status}`);
  return outcome.manifest;
}

/** A real 1×1 PNG: signature, IHDR, IDAT, IEND, each with a valid CRC. */
function tinyPng(): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, 1); ihdrView.setUint32(4, 1);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const idat = new Uint8Array(deflateSync(Buffer.from([0, 16, 18, 23, 255])));
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

describe("E19 capture scene", () => {
  it("normalises chart times, dedupes studies, and counts only visible drawings", () => {
    const scene = composeCaptureScene(sceneInput());
    expect(scene.bars).toEqual({ count: 3, first: "2026-10-07", last: "2026-10-09", lastSession: "2026-10-09", lastClose: 184.5 });
    expect(scene.viewport).toEqual({ width: 980, height: 541, maximizedPane: null });
    expect(scene.studies.map((study) => study.key)).toEqual(["ma", "vol", "rsi"]);
    expect(scene.annotations).toBe(2);
    expect(captureTimeKey(1_760_000_000)).toBe(new Date(1_760_000_000_000).toISOString());
    expect(captureTimeKey({ year: 2026, month: 3, day: 7 })).toBe("2026-03-07");
    expect(captureTimeKey(undefined)).toBeNull();
  });

  it("only treats a well-formed review request as one", () => {
    expect(isChartCaptureRequest({ action: "review", includeAnnotations: false, respond: () => {} })).toBe(true);
    expect(isChartCaptureRequest({ action: "download" })).toBe(false);
    expect(isChartCaptureRequest({ action: "review" })).toBe(false);
    expect(isChartCaptureRequest(null)).toBe(false);
  });
});

describe("E19 one scene per capture (falsifier: metadata from a later scene)", () => {
  it("withholds a capture whose visible range moved while it was painted", () => {
    const before = composeCaptureScene(sceneInput());
    const after = composeCaptureScene(sceneInput({ visibleRange: { from: "2026-10-08", to: "2026-10-09" } }));
    expect(resolveCapture(response(before, after))).toEqual({ status: "scene_changed", changes: ["visible"] });
  });

  it("withholds a capture across a symbol, timeframe, data generation, bar or replay change", () => {
    const before = composeCaptureScene(sceneInput());
    const later = [
      sceneInput({ source: { symbol: "AAPL", timeframe: "D" }, requested: { symbol: "AAPL", timeframe: "D" } }),
      sceneInput({ generation: 5 }),
      sceneInput({ bars: [...sceneInput().bars, { time: "2026-10-10", c: 186 }] }),
      sceneInput({ liveTick: { basis: "LIVE", stamp: CAPTURED_AT + 500 } }),
      sceneInput({ replay: true }),
      sceneInput({ viewport: { width: 980, height: 541, maximizedPane: "rsi" } }),
    ];
    for (const input of later) {
      expect(resolveCapture(response(before, composeCaptureScene(input))).status).toBe("scene_changed");
    }
  });

  it("withholds a half-switched chart whose painted data is not the requested ticker", () => {
    const scene = composeCaptureScene(sceneInput({ requested: { symbol: "AAPL", timeframe: "D" } }));
    expect(resolveCapture(response(scene))).toEqual({ status: "scene_changed", changes: ["source"] });
  });

  it("describes the raster-time scene, never the post-composite reading", () => {
    const before = composeCaptureScene(sceneInput({ copy: { kind: "saved", ageMs: 30_000, servedAtMs: CAPTURED_AT - 10_000, refresh: "pending" } }));
    // A background refresh that settles during the composite does not repaint the chart, so it is
    // not a scene change — and the manifest still reports what the image was painted from.
    const after = { ...before, copy: { kind: "saved" as const, ageMs: 30_000, servedAtMs: CAPTURED_AT - 10_000, refresh: "ok" as const } };
    const manifest = ready(response(before, after));
    expect(manifest.data.copy).toEqual({ kind: "saved", ageAtCaptureMs: 40_000, refresh: "pending" });
  });

  it("ignores drawing edits while drawings are left out, but not once they are included", () => {
    const before = composeCaptureScene(sceneInput());
    const after = composeCaptureScene(sceneInput({ drawings: [{}] }));
    expect(captureSceneChanges(before, after, false)).toEqual([]);
    expect(captureSceneChanges(before, after, true)).toEqual(["annotations"]);
  });

  it("reports no data and an unavailable chart truthfully", () => {
    expect(resolveCapture(null)).toEqual({ status: "unavailable" });
    expect(resolveCapture({ ok: false, reason: "render_failed" })).toEqual({ status: "unavailable" });
    expect(resolveCapture({ ok: false, reason: "no_data" })).toEqual({ status: "no_data" });
    expect(resolveCapture(response(composeCaptureScene(sceneInput({ bars: [] })))).status).toBe("no_data");
    expect(resolveCapture(response(composeCaptureScene(sceneInput({ source: null })))).status).toBe("no_data");
  });
});

describe("E19 manifest", () => {
  it("keeps the three clocks distinct and never invents a publication time", () => {
    const manifest = ready(response(composeCaptureScene(sceneInput({ liveTick: { basis: "DELAYED_15M", stamp: Date.UTC(2026, 9, 9, 14, 12, 0) } }))));
    expect(manifest.schema).toBe(CHART_CAPTURE_SCHEMA);
    expect(manifest.times.capturedAt).toBe("2026-10-09T14:30:05.000Z");
    expect(manifest.times.capturedClock).toBe("device");
    expect(manifest.times.marketObservedAt).toEqual({ kind: "quote", at: "2026-10-09T14:12:00.000Z", basis: "DELAYED_15M" });
    expect(manifest.times.sourcePublishedAt).toBeNull();
    expect(manifest.times.sourcePublished).toBe("not_provided_by_source");
    expect(marketObservedText(manifest, en, 0)).toBe("2026-10-09 14:12:00 UTC+0 · 15-minute delayed quote");
  });

  it("falls back to the last bar, labelled by what a bar time means", () => {
    const daily = ready(response(composeCaptureScene(sceneInput())));
    expect(daily.times.marketObservedAt).toEqual({ kind: "bar", bar: "2026-10-09", timeframe: "D", barTime: "session" });
    expect(marketObservedText(daily, en)).toBe("2026-10-09 · trading day");
    // A 3D bar is keyed by its opening session; the newest data it shows is its close session.
    const threeDay = ready(response(composeCaptureScene(sceneInput({
      source: { symbol: "NVDA", timeframe: "3D" }, requested: { symbol: "NVDA", timeframe: "3D" },
      bars: [{ time: "2026-10-07", closeTime: "2026-10-09", c: 1 }],
    }))));
    expect(threeDay.data.lastBar).toBe("2026-10-07");
    expect(threeDay.times.marketObservedAt).toEqual({ kind: "bar", bar: "2026-10-09", timeframe: "3D", barTime: "session" });
    expect(marketObservedText(threeDay, zh)).toBe("2026-10-09 · 交易日");
    const intraday = ready(response(composeCaptureScene(sceneInput({
      source: { symbol: "NVDA", timeframe: "5m" }, requested: { symbol: "NVDA", timeframe: "5m" },
      bars: [{ time: 1_760_020_200, c: 1 }],
    }))));
    expect(intraday.times.marketObservedAt).toMatchObject({ kind: "bar", barTime: "bar_open" });
    expect(marketObservedText(intraday, zh)).toContain("K线开盘时间");
  });

  it("does not use a quote under Bar Replay and an unstamped quote says so", () => {
    const replay = ready(response(composeCaptureScene(sceneInput({ replay: true, liveTick: { basis: "LIVE", stamp: CAPTURED_AT } }))));
    expect(replay.times.marketObservedAt?.kind).toBe("bar");
    expect(replay.replay).toBe(true);
    const unstamped = ready(response(composeCaptureScene(sceneInput({ liveTick: { basis: "LIVE", stamp: null } }))));
    expect(marketObservedText(unstamped, en)).toBe("live quote · time not reported");
  });

  it("names hidden studies and excluded drawings instead of claiming them present", () => {
    const manifest = ready(response(composeCaptureScene(sceneInput()), undefined, { painted: painted({ notCaptured: ["price_tag", "countdown"] }) }));
    expect(manifest.studies.shown.map((study) => study.label)).toEqual(["MA 20", "Volume"]);
    expect(manifest.studies.hidden).toEqual([{ key: "rsi", label: "RSI 14" }]);
    expect(manifest.layers.included).toEqual(["price_chart", "indicator_overlay", "study_labels"]);
    expect(manifest.layers.excluded).toEqual([{ layer: "annotations", count: 2 }]);
    expect(manifest.layers.notCaptured).toEqual(["price_tag", "countdown"]);
  });

  it("lists drawings as included only when they were painted", () => {
    const manifest = ready(response(composeCaptureScene(sceneInput()), undefined, { includeAnnotations: true, painted: painted({ annotations: true }) }));
    expect(manifest.layers.included).toContain("annotations");
    expect(manifest.layers.excluded).toEqual([]);
  });

  it("discloses a saved copy and an unreported one", () => {
    const saved = ready(response(composeCaptureScene(sceneInput({ copy: { kind: "saved", ageMs: 7 * 60_000, servedAtMs: CAPTURED_AT, refresh: "failed" } }))));
    expect(dataCopyText(saved, en)).toBe("Saved copy · 7 min · refresh failed");
    expect(dataCopyText(saved, zh)).toBe("已保存副本 · 7 分钟 · 刷新失败");
    const unreported = ready(response(composeCaptureScene(sceneInput({ copy: null }))));
    expect(unreported.data.copy).toEqual({ kind: "unreported" });
    expect(dataCopyText(unreported, en)).toBe("Freshness not reported for this chart");
  });

  it("carries no account, owner or drawing content", () => {
    const input = sceneInput({ drawings: [{ hidden: false, text: "my secret plan", owner: "user-uuid", email: "a@b.c" } as never] });
    const json = JSON.stringify(ready(response(composeCaptureScene(input))));
    for (const forbidden of ["secret", "user-uuid", "a@b.c", "email", "owner", "userId", "account", "token"]) {
      expect(json).not.toContain(forbidden);
    }
  });

  it("paints footer lines that name each clock, in both languages", () => {
    const manifest = ready(response(composeCaptureScene(sceneInput())));
    const lines = captureFooterLines(manifest, en, 120);
    expect(lines).toEqual([
      "NVDA · D · Captured 2026-10-09 16:30:05 UTC+2",
      "Market data: 2026-10-09 · trading day · Source publish time: not provided",
      "Data: Current read · Drawings not included · Hidden studies: 1",
    ]);
    const zhLines = captureFooterLines(manifest, zh, 480);
    expect(zhLines[0]).toBe("NVDA · D · 截取 2026-10-09 22:30:05 UTC+8");
    expect(zhLines[1]).toBe("行情：2026-10-09 · 交易日 · 数据源发布时间：未提供");
    expect(zhLines.join("\n")).not.toMatch(/\?cc/);
  });
});

describe("E19 file binding", () => {
  it("round-trips the manifest through a PNG iTXt chunk with a valid CRC", () => {
    const png = tinyPng();
    const text = JSON.stringify({ schema: CHART_CAPTURE_SCHEMA, note: "价格 · ok" });
    const bound = embedPngText(png, CHART_CAPTURE_PNG_KEYWORD, text);
    expect(bound).not.toBeNull();
    expect(readPngText(bound!, CHART_CAPTURE_PNG_KEYWORD)).toBe(text);
    expect(readPngText(bound!, "other-keyword")).toBeNull();
    expect(readPngText(png, CHART_CAPTURE_PNG_KEYWORD)).toBeNull();
    // The chunk sits before IEND, so the file still ends with a valid IEND chunk.
    expect(Array.from(bound!.subarray(bound!.length - 8, bound!.length - 4)).map((c) => String.fromCharCode(c)).join("")).toBe("IEND");
  });

  it("rejects a corrupted chunk and a non-PNG input", () => {
    const bound = embedPngText(tinyPng(), CHART_CAPTURE_PNG_KEYWORD, "{\"a\":1}")!;
    const corrupt = bound.slice();
    corrupt[corrupt.length - 20] ^= 0xff;
    expect(readPngText(corrupt, CHART_CAPTURE_PNG_KEYWORD)).toBeNull();
    expect(embedPngText(new TextEncoder().encode("not a png at all"), CHART_CAPTURE_PNG_KEYWORD, "x")).toBeNull();
  });

  it("names files from the instrument and this device's clock, filesystem-safe", () => {
    const manifest = ready(response(composeCaptureScene(sceneInput({
      source: { symbol: "BRK/B:US", timeframe: "1h" }, requested: { symbol: "BRK/B:US", timeframe: "1h" },
    }))));
    expect(captureFileStem(manifest, 0)).toBe("BRK_B_US_1h_20261009-143005");
    expect(captureFileStem(manifest, -300)).toBe("BRK_B_US_1h_20261009-093005");
  });

  it("formats the device clock with its offset", () => {
    expect(formatDeviceClock(CAPTURED_AT, 0)).toBe("2026-10-09 14:30:05 UTC+0");
    expect(formatDeviceClock(CAPTURED_AT, 330)).toBe("2026-10-09 20:00:05 UTC+5:30");
    expect(formatDeviceClock(CAPTURED_AT, -240)).toBe("2026-10-09 10:30:05 UTC-4");
  });

  it("has EN and ZH copy for every key", () => {
    for (const [key, [english, chinese]] of Object.entries(CHART_CAPTURE_LEX)) {
      expect(english, key).toBeTruthy();
      expect(chinese, key).toBeTruthy();
      expect(chinese, key).not.toBe(english);
    }
  });
});
