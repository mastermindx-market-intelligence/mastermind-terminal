/**
 * Review-ready chart capture (E19) — the pure half.
 *
 * The chart's own snapshot compositor (ChartPanel, `mm:snapshot`) paints the image. For a
 * "review" capture it also hands back the SCENE it painted, read twice: in the same task as the
 * chart raster, and again once the composite has finished. This module turns those readings into
 * a compact manifest, refuses to describe an image whose scene moved while it was being painted,
 * and binds the manifest into the PNG itself so the two cannot drift apart.
 *
 * Three clocks are kept apart on purpose:
 *   - capturedAt         this device's clock when the chart was rasterised;
 *   - marketObservedAt   the newest market observation the image shows (the quote painted into the
 *                        last bar, or the last bar itself);
 *   - sourcePublishedAt  when the data source published that data. The bar documents do not carry
 *                        one, so it is reported as not provided — never filled from either other clock.
 *
 * Nothing here knows who the viewer is. The manifest is assembled from an explicit allow-list of
 * scene fields, so an account id, an email, an owner key or a drawing's text has no path into it.
 */

import { isIntradayTf } from "./intradayShared";

export const CHART_CAPTURE_SCHEMA = "mastermind.chart-capture/1" as const;
/** iTXt keyword the manifest travels under inside the PNG. */
export const CHART_CAPTURE_PNG_KEYWORD = "mastermind-capture";
/** The compositor's fixed output scale (ChartPanel TARGET_SCALE). */
export const CHART_CAPTURE_SCALE = 2;

export type CaptureRefresh = "pending" | "ok" | "failed" | "superseded";

/** Where the painted bars came from, as the chart's read reported it. */
export type CaptureDataCopy =
  | { kind: "current" }
  | { kind: "saved"; ageMs: number; servedAtMs: number; refresh: CaptureRefresh };

export type CaptureStudy = { key: string; label: string; hidden: boolean };

export type CaptureScene = {
  /** Identity of the data the chart actually accepted and painted; null when nothing is painted. */
  source: { symbol: string; timeframe: string } | null;
  /** What the pane is currently asked to show. */
  requested: { symbol: string; timeframe: string };
  /** The chart's data-load generation. */
  generation: number;
  /** `last` is the last bar's identity (its OPENING key); `lastSession` is the newest session it
   * covers — a daily multiple's `closeTime`, else its `time` (lib/sessionBars.ts). */
  bars: { count: number; first: string | null; last: string | null; lastSession: string | null; lastClose: number | null };
  visible: { from: string | null; to: string | null } | null;
  viewport: { width: number; height: number; maximizedPane: string | null };
  studies: CaptureStudy[];
  /** Drawings visible on the chart (count only — their content never leaves the chart). */
  annotations: number;
  /** The quote painted into the last bar, if any. */
  quote: { basis: string; stampMs: number | null } | null;
  replay: boolean;
  copy: CaptureDataCopy | null;
};

/** Which layers the compositor actually painted into this image. */
export type CapturePainted = {
  indicatorOverlay: boolean;
  signals: boolean;
  annotations: boolean;
  tables: number;
  studyLabels: number;
  maximizedCrop: boolean;
  /** On-screen chart elements the compositor does not paint. */
  notCaptured: string[];
};

export type ChartCaptureResponse =
  | {
      ok: true;
      blob: Blob;
      width: number;
      height: number;
      capturedAtMs: number;
      includeAnnotations: boolean;
      before: CaptureScene;
      after: CaptureScene;
      painted: CapturePainted;
    }
  | { ok: false; reason: "no_data" | "render_failed" };

/** `mm:snapshot` detail for a review capture. Only the active chart answers. */
export type ChartCaptureRequest = {
  action: "review";
  includeAnnotations: boolean;
  respond: (response: ChartCaptureResponse) => void;
};

export function isChartCaptureRequest(detail: unknown): detail is ChartCaptureRequest {
  return !!detail
    && typeof detail === "object"
    && (detail as { action?: unknown }).action === "review"
    && typeof (detail as { respond?: unknown }).respond === "function";
}

// ── scene assembly ────────────────────────────────────────────────────────────

/** A chart time (date string, unix seconds, or business day) as a stable string. */
export function captureTimeKey(value: unknown): string | null {
  if (typeof value === "string") return value || null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e11 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (value && typeof value === "object") {
    const day = value as { year?: unknown; month?: unknown; day?: unknown };
    if (typeof day.year === "number" && typeof day.month === "number" && typeof day.day === "number") {
      return `${day.year}-${String(day.month).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`;
    }
  }
  return null;
}

type SceneBar = { time: unknown; closeTime?: unknown; c?: unknown };
type ScenePane = { entries: ReadonlyArray<{ key: string; label: string; hidden: boolean }> };
type SceneDrawing = { hidden?: boolean };

export type CaptureSceneInput = {
  source: { symbol: string; timeframe: string } | null;
  requested: { symbol: string; timeframe: string };
  generation: number;
  bars: ReadonlyArray<SceneBar>;
  visibleRange: { from: unknown; to: unknown } | null;
  viewport: { width: number; height: number; maximizedPane: string | null };
  panes: ReadonlyArray<ScenePane>;
  drawings: ReadonlyArray<SceneDrawing>;
  liveTick: { basis: string; stamp: number | null } | null;
  replay: boolean;
  copy: CaptureDataCopy | null;
};

/** Normalise the chart's live refs into a plain, comparable scene. */
export function composeCaptureScene(input: CaptureSceneInput): CaptureScene {
  const bars = input.bars;
  const last = bars.length ? bars[bars.length - 1] : null;
  const lastClose = last && typeof last.c === "number" && Number.isFinite(last.c) ? last.c : null;
  const studies: CaptureStudy[] = [];
  const seen = new Set<string>();
  for (const pane of input.panes) {
    for (const entry of pane.entries) {
      const label = (entry.label || "").trim();
      const id = `${entry.key}|${label}`;
      if (seen.has(id)) continue;
      seen.add(id);
      studies.push({ key: entry.key, label, hidden: !!entry.hidden });
    }
  }
  return {
    source: input.source ? { symbol: input.source.symbol, timeframe: input.source.timeframe } : null,
    requested: { symbol: input.requested.symbol, timeframe: input.requested.timeframe },
    generation: input.generation,
    bars: {
      count: bars.length,
      first: bars.length ? captureTimeKey(bars[0].time) : null,
      last: last ? captureTimeKey(last.time) : null,
      lastSession: last ? captureTimeKey(last.closeTime ?? last.time) : null,
      lastClose,
    },
    visible: input.visibleRange
      ? { from: captureTimeKey(input.visibleRange.from), to: captureTimeKey(input.visibleRange.to) }
      : null,
    viewport: {
      width: Math.round(input.viewport.width),
      height: Math.round(input.viewport.height),
      maximizedPane: input.viewport.maximizedPane ?? null,
    },
    studies,
    annotations: input.drawings.filter((drawing) => !drawing.hidden).length,
    quote: input.liveTick ? { basis: input.liveTick.basis, stampMs: input.liveTick.stamp } : null,
    replay: input.replay,
    copy: input.copy ? { ...input.copy } : null,
  };
}

/**
 * Fields of the scene that change what the image shows. The data copy's refresh outcome is
 * excluded: a background refresh settling does not repaint the chart. The drawing count only
 * matters when drawings are part of the image.
 */
function sceneFields(scene: CaptureScene, includeAnnotations: boolean): Record<string, unknown> {
  return {
    source: scene.source,
    requested: scene.requested,
    generation: scene.generation,
    bars: scene.bars,
    visible: scene.visible,
    viewport: scene.viewport,
    studies: scene.studies,
    annotations: includeAnnotations ? scene.annotations : null,
    quote: scene.quote,
    replay: scene.replay,
  };
}

/** Names of the scene fields that differ between the raster reading and the post-composite one. */
export function captureSceneChanges(before: CaptureScene, after: CaptureScene, includeAnnotations: boolean): string[] {
  const a = sceneFields(before, includeAnnotations);
  const b = sceneFields(after, includeAnnotations);
  return Object.keys(a).filter((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]));
}

// ── manifest ──────────────────────────────────────────────────────────────────

export type CaptureMarketObservation =
  | { kind: "quote"; at: string; basis: string }
  | { kind: "quote_unstamped"; basis: string }
  | { kind: "bar"; bar: string; timeframe: string; barTime: "session" | "bar_open" };

export type ChartCaptureManifest = {
  schema: typeof CHART_CAPTURE_SCHEMA;
  instrument: { symbol: string; timeframe: string };
  image: { width: number; height: number; scale: number };
  times: {
    capturedAt: string;
    capturedClock: "device";
    marketObservedAt: CaptureMarketObservation | null;
    sourcePublishedAt: null;
    sourcePublished: "not_provided_by_source";
  };
  data: {
    generation: number;
    bars: number;
    firstBar: string | null;
    lastBar: string | null;
    copy:
      | { kind: "current" }
      | { kind: "saved"; ageAtCaptureMs: number; refresh: CaptureRefresh }
      | { kind: "unreported" };
  };
  viewport: { from: string | null; to: string | null; cssWidth: number; cssHeight: number; maximizedPane: string | null };
  layers: { included: string[]; excluded: Array<{ layer: "annotations"; count: number }>; notCaptured: string[] };
  studies: { shown: Array<{ key: string; label: string }>; hidden: Array<{ key: string; label: string }> };
  replay: boolean;
};

export type CaptureOutcome =
  | { status: "ready"; manifest: ChartCaptureManifest }
  | { status: "scene_changed"; changes: string[] }
  | { status: "no_data" }
  | { status: "unavailable" };

/** Daily-or-longer timeframes stamp a session date; intraday bars stamp their opening instant. */
function isSessionTimeframe(timeframe: string): boolean {
  return !isIntradayTf(timeframe.trim());
}

function marketObservation(scene: CaptureScene, timeframe: string): CaptureMarketObservation | null {
  if (scene.quote && !scene.replay) {
    if (scene.quote.stampMs != null && Number.isFinite(scene.quote.stampMs)) {
      return { kind: "quote", at: new Date(scene.quote.stampMs).toISOString(), basis: scene.quote.basis };
    }
    return { kind: "quote_unstamped", basis: scene.quote.basis };
  }
  if (!scene.bars.last) return null;
  // A 3D/W/M bar is keyed by its OPENING session; the newest market data it shows is its close.
  if (isSessionTimeframe(timeframe)) {
    return { kind: "bar", bar: scene.bars.lastSession ?? scene.bars.last, timeframe, barTime: "session" };
  }
  return { kind: "bar", bar: scene.bars.last, timeframe, barTime: "bar_open" };
}

/**
 * Decide what a capture response may claim. A response whose scene moved between the raster and
 * the end of the composite is withheld; otherwise the manifest describes the RASTER-TIME scene,
 * never a later reading.
 */
export function resolveCapture(response: ChartCaptureResponse | null): CaptureOutcome {
  if (!response) return { status: "unavailable" };
  if (!response.ok) return response.reason === "no_data" ? { status: "no_data" } : { status: "unavailable" };
  const { before, after, painted, includeAnnotations } = response;
  if (!before.source || before.bars.count === 0) return { status: "no_data" };
  const changes = captureSceneChanges(before, after, includeAnnotations);
  // The painted identity must be the one the pane is asked for; a half-switched ticker is not a
  // coherent scene even when nothing moved during the composite.
  if (before.source.symbol !== before.requested.symbol || before.source.timeframe !== before.requested.timeframe) {
    changes.unshift("source");
  }
  if (changes.length) return { status: "scene_changed", changes: Array.from(new Set(changes)) };

  const timeframe = before.source.timeframe;
  const included = ["price_chart"];
  if (painted.indicatorOverlay) included.push("indicator_overlay");
  if (painted.signals) included.push("signals");
  if (painted.studyLabels > 0) included.push("study_labels");
  if (painted.tables > 0) included.push("indicator_tables");
  if (painted.annotations) included.push("annotations");
  const excluded: Array<{ layer: "annotations"; count: number }> = [];
  if (!painted.annotations && before.annotations > 0) excluded.push({ layer: "annotations", count: before.annotations });

  const copy = before.copy;
  return {
    status: "ready",
    manifest: {
      schema: CHART_CAPTURE_SCHEMA,
      instrument: { symbol: before.source.symbol, timeframe },
      image: { width: response.width, height: response.height, scale: CHART_CAPTURE_SCALE },
      times: {
        capturedAt: new Date(response.capturedAtMs).toISOString(),
        capturedClock: "device",
        marketObservedAt: marketObservation(before, timeframe),
        sourcePublishedAt: null,
        sourcePublished: "not_provided_by_source",
      },
      data: {
        generation: before.generation,
        bars: before.bars.count,
        firstBar: before.bars.first,
        lastBar: before.bars.last,
        copy: !copy
          ? { kind: "unreported" }
          : copy.kind === "current"
            ? { kind: "current" }
            : { kind: "saved", ageAtCaptureMs: Math.max(0, copy.ageMs + (response.capturedAtMs - copy.servedAtMs)), refresh: copy.refresh },
      },
      viewport: {
        from: before.visible?.from ?? null,
        to: before.visible?.to ?? null,
        cssWidth: before.viewport.width,
        cssHeight: before.viewport.height,
        maximizedPane: before.viewport.maximizedPane,
      },
      layers: { included, excluded, notCaptured: [...painted.notCaptured] },
      studies: {
        shown: before.studies.filter((study) => !study.hidden).map(({ key, label }) => ({ key, label })),
        hidden: before.studies.filter((study) => study.hidden).map(({ key, label }) => ({ key, label })),
      },
      replay: before.replay,
    },
  };
}

// ── human-readable lines (footer + dialog) ────────────────────────────────────

export type CaptureTranslate = (key: string) => string;

const pad2 = (n: number) => String(n).padStart(2, "0");

/** This device's wall clock with its UTC offset — the same form the image header stamps. */
export function formatDeviceClock(ms: number, offsetMinutes: number = -new Date(ms).getTimezoneOffset()): string {
  const local = new Date(ms + offsetMinutes * 60_000);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const offset = abs % 60 ? `${Math.floor(abs / 60)}:${pad2(abs % 60)}` : String(abs / 60);
  return `${local.getUTCFullYear()}-${pad2(local.getUTCMonth() + 1)}-${pad2(local.getUTCDate())} `
    + `${pad2(local.getUTCHours())}:${pad2(local.getUTCMinutes())}:${pad2(local.getUTCSeconds())} UTC${sign}${offset}`;
}

/** A compact age ("45 s", "12 min", "3 h", "2 d") with localised units. */
export function formatCaptureAge(ms: number, t: CaptureTranslate): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} ${t("ccUnitSec")}`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} ${t("ccUnitMin")}`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} ${t("ccUnitHour")}`;
  return `${Math.round(h / 24)} ${t("ccUnitDay")}`;
}

function basisLabel(basis: string, t: CaptureTranslate): string {
  if (basis === "LIVE") return t("ccQuoteLive");
  if (basis === "DELAYED_15M") return t("ccQuoteDelayed");
  return t("ccQuoteOther");
}

function refreshLabel(refresh: CaptureRefresh, t: CaptureTranslate): string {
  if (refresh === "ok") return t("ccRefreshOk");
  if (refresh === "failed") return t("ccRefreshFailed");
  if (refresh === "superseded") return t("ccRefreshSuperseded");
  return t("ccRefreshPending");
}

export function marketObservedText(manifest: ChartCaptureManifest, t: CaptureTranslate, offsetMinutes?: number): string {
  const observed = manifest.times.marketObservedAt;
  if (!observed) return t("ccNotAvailable");
  if (observed.kind === "quote") {
    return `${formatDeviceClock(Date.parse(observed.at), offsetMinutes)} · ${basisLabel(observed.basis, t)}`;
  }
  if (observed.kind === "quote_unstamped") return `${basisLabel(observed.basis, t)} · ${t("ccQuoteNoTime")}`;
  return `${observed.bar} · ${observed.barTime === "session" ? t("ccBarSession") : t("ccBarOpen")}`;
}

export function dataCopyText(manifest: ChartCaptureManifest, t: CaptureTranslate): string {
  const copy = manifest.data.copy;
  if (copy.kind === "current") return t("ccCopyCurrent");
  if (copy.kind === "unreported") return t("ccCopyUnreported");
  return `${t("ccCopySaved")} · ${formatCaptureAge(copy.ageAtCaptureMs, t)} · ${refreshLabel(copy.refresh, t)}`;
}

export function layersText(manifest: ChartCaptureManifest, t: CaptureTranslate): string {
  const names: Record<string, string> = {
    price_chart: t("ccLayerPrice"),
    indicator_overlay: t("ccLayerIndicators"),
    signals: t("ccLayerSignals"),
    study_labels: t("ccLayerLabels"),
    indicator_tables: t("ccLayerTables"),
    annotations: t("ccLayerAnnotations"),
  };
  return manifest.layers.included.map((layer) => names[layer] ?? t("ccLayerOther")).join(" · ");
}

export function notCapturedText(manifest: ChartCaptureManifest, t: CaptureTranslate): string {
  const names: Record<string, string> = {
    price_tag: t("ccMissingPriceTag"),
    extended_tag: t("ccMissingExtendedTag"),
    countdown: t("ccMissingCountdown"),
  };
  return manifest.layers.notCaptured.map((layer) => names[layer] ?? t("ccLayerOther")).join(" · ");
}

/** "Label: value" — a full-width colon (ZH) already separates, so no space follows it. */
function labelled(label: string, value: string): string {
  return label.endsWith("：") ? `${label}${value}` : `${label} ${value}`;
}

/** The provenance lines painted under the image. Every line names which clock it is. */
export function captureFooterLines(manifest: ChartCaptureManifest, t: CaptureTranslate, offsetMinutes?: number): string[] {
  const lines = [
    `${manifest.instrument.symbol} · ${manifest.instrument.timeframe} · ${t("ccFooterCaptured")} ${formatDeviceClock(Date.parse(manifest.times.capturedAt), offsetMinutes)}`,
    `${labelled(t("ccFooterMarket"), marketObservedText(manifest, t, offsetMinutes))} · ${t("ccFooterPublishedNone")}`,
  ];
  const third: string[] = [labelled(t("ccFooterData"), dataCopyText(manifest, t))];
  const excludedAnnotations = manifest.layers.excluded.find((entry) => entry.layer === "annotations");
  if (excludedAnnotations) third.push(t("ccFooterAnnotationsExcluded"));
  else if (manifest.layers.included.includes("annotations")) third.push(t("ccFooterAnnotationsIncluded"));
  if (manifest.studies.hidden.length) third.push(`${t("ccFooterHidden")} ${manifest.studies.hidden.length}`);
  if (manifest.replay) third.push(t("ccFooterReplay"));
  lines.push(third.join(" · "));
  return lines;
}

// ── PNG text chunk (iTXt) ─────────────────────────────────────────────────────

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

let crcTable: Uint32Array | null = null;
export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function isPng(bytes: Uint8Array): boolean {
  return bytes.length > 8 && PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

type PngChunk = { type: string; offset: number; length: number };

function pngChunks(bytes: Uint8Array): PngChunk[] | null {
  if (!isPng(bytes)) return null;
  const chunks: PngChunk[] = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    if (offset + 12 + length > bytes.length) return null;
    chunks.push({ type, offset, length });
    offset += 12 + length;
    if (type === "IEND") return chunks;
  }
  return null;
}

/** Insert an uncompressed iTXt chunk before IEND. Returns null for anything that is not a PNG. */
export function embedPngText(png: Uint8Array, keyword: string, text: string): Uint8Array | null {
  const chunks = pngChunks(png);
  const iend = chunks?.find((chunk) => chunk.type === "IEND");
  if (!chunks || !iend || !/^[\x20-\x7e]{1,79}$/.test(keyword)) return null;
  const encoder = new TextEncoder();
  const body = new Uint8Array([
    ...encoder.encode(keyword), 0,
    0, 0, // compression flag, compression method
    0, // empty language tag
    0, // empty translated keyword
    ...encoder.encode(text),
  ]);
  const chunk = new Uint8Array(12 + body.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, body.length);
  chunk.set(encoder.encode("iTXt"), 4);
  chunk.set(body, 8);
  view.setUint32(8 + body.length, crc32(chunk.subarray(4, 8 + body.length)));
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, iend.offset), 0);
  out.set(chunk, iend.offset);
  out.set(png.subarray(iend.offset), iend.offset + chunk.length);
  return out;
}

/** Read back an uncompressed iTXt chunk written by `embedPngText`; null when absent or corrupt. */
export function readPngText(png: Uint8Array, keyword: string): string | null {
  const chunks = pngChunks(png);
  if (!chunks) return null;
  const decoder = new TextDecoder();
  for (const chunk of chunks) {
    if (chunk.type !== "iTXt") continue;
    const start = chunk.offset + 8;
    const body = png.subarray(start, start + chunk.length);
    const stored = readUint32(png, start + chunk.length);
    if (crc32(png.subarray(chunk.offset + 4, start + chunk.length)) !== stored) continue;
    const keywordEnd = body.indexOf(0);
    if (keywordEnd < 0 || decoder.decode(body.subarray(0, keywordEnd)) !== keyword) continue;
    if (body[keywordEnd + 1] !== 0) continue; // compressed text is not ours
    const languageEnd = body.indexOf(0, keywordEnd + 3);
    if (languageEnd < 0) continue;
    const translatedEnd = body.indexOf(0, languageEnd + 1);
    if (translatedEnd < 0) continue;
    return decoder.decode(body.subarray(translatedEnd + 1));
  }
  return null;
}

/** A filesystem-safe file stem: `<SYMBOL>_<TF>_<yyyymmdd-hhmmss>` on this device's clock. */
export function captureFileStem(manifest: ChartCaptureManifest, offsetMinutes?: number): string {
  const ms = Date.parse(manifest.times.capturedAt);
  const offset = offsetMinutes ?? -new Date(ms).getTimezoneOffset();
  const local = new Date(ms + offset * 60_000);
  const stamp = `${local.getUTCFullYear()}${pad2(local.getUTCMonth() + 1)}${pad2(local.getUTCDate())}-${pad2(local.getUTCHours())}${pad2(local.getUTCMinutes())}${pad2(local.getUTCSeconds())}`;
  const safe = (value: string) => value.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 40) || "chart";
  return `${safe(manifest.instrument.symbol)}_${safe(manifest.instrument.timeframe)}_${stamp}`;
}
