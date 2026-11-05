import type { LargeTradesPlot } from "./visibility";

/** Borrowed identities are compared synchronously and never retained by an exported frame. */
export type LargeTradesFrameOwner = {
  chart: unknown; series: unknown; bars: unknown; symbol: string; timeframe: string; replay: string;
};
export function sameLargeTradesFrameOwner(a: LargeTradesFrameOwner | null, b: LargeTradesFrameOwner): boolean {
  return !!a && !!b.chart && !!b.series && a.chart === b.chart && a.series === b.series
    && a.bars === b.bars && a.symbol === b.symbol && a.timeframe === b.timeframe && a.replay === b.replay;
}

export type SnapshotRect = { x: number; y: number; width: number; height: number };
export type FrozenTradeMarker = {
  id: string; quantity: number; reports: number; side: string;
  x: number; y: number; width: number; height: number;
  fill: string; border: string; borderWidth: number; opacity: number;
  ringColor: string; ringWidth: number;
  label: null | { text: string; rect: SnapshotRect; fill: string; color: string; font: string; radius: number };
};
export type LargeTradesExportFrame = {
  symbol: string; timeframe: string; replay: string; sourceSha256: string | null;
  capturedAtMs: number; cssWidth: number; cssHeight: number;
  plot: LargeTradesPlot; markers: readonly FrozenTradeMarker[]; footer: readonly string[];
};

/** Viewport geometry is normalized to the exact chart root used by native capture. */
export function snapshotRelativeRect(rect: SnapshotRect, root: SnapshotRect, cssWidth: number, cssHeight: number): SnapshotRect | null {
  if (![rect.x, rect.y, rect.width, rect.height, root.x, root.y, root.width, root.height, cssWidth, cssHeight]
    .every(Number.isFinite) || rect.width <= 0 || rect.height <= 0 || root.width <= 0 || root.height <= 0
    || cssWidth <= 0 || cssHeight <= 0) return null;
  return { x: (rect.x - root.x) * cssWidth / root.width, y: (rect.y - root.y) * cssHeight / root.height,
    width: rect.width * cssWidth / root.width, height: rect.height * cssHeight / root.height };
}

/** Copies only primitive paint values; no DOM, mutable cluster or CSS declaration crosses an await. */
export function freezeLargeTradesExportFrame(frame: LargeTradesExportFrame): LargeTradesExportFrame {
  const markers = frame.markers.filter((m) => Number.isSafeInteger(m.quantity) && m.quantity > 0
    && [m.x, m.y, m.width, m.height, m.borderWidth, m.opacity, m.ringWidth].every(Number.isFinite)
    && m.width > 0 && m.height > 0 && m.x >= frame.plot.x && m.x <= frame.plot.x + frame.plot.width
    && m.y >= frame.plot.y && m.y <= frame.plot.y + frame.plot.height).map((marker) => Object.freeze({
      ...marker, label: marker.label ? Object.freeze({ ...marker.label, rect: Object.freeze({ ...marker.label.rect }) }) : null,
    }));
  return Object.freeze({ ...frame, plot: Object.freeze({ ...frame.plot }),
    markers: Object.freeze(markers), footer: Object.freeze([...frame.footer]) });
}

export function snapshotScale(frame: Pick<LargeTradesExportFrame, "cssWidth" | "cssHeight">, destination: SnapshotRect) {
  if (![frame.cssWidth, frame.cssHeight, destination.x, destination.y, destination.width, destination.height].every(Number.isFinite)
    || frame.cssWidth <= 0 || frame.cssHeight <= 0 || destination.width <= 0 || destination.height <= 0) return null;
  return { x: destination.width / frame.cssWidth, y: destination.height / frame.cssHeight };
}

/** Call after native/SVG/table paint. Plot clipping excludes axes, neighboring panes and controls. */
export function paintLargeTradesSnapshot(ctx: CanvasRenderingContext2D, frame: LargeTradesExportFrame, destination: SnapshotRect): void {
  const scale = snapshotScale(frame, destination); if (!scale) return;
  ctx.save();
  ctx.setTransform(scale.x, 0, 0, scale.y, destination.x, destination.y);
  ctx.beginPath(); ctx.rect(frame.plot.x, frame.plot.y, frame.plot.width, frame.plot.height); ctx.clip();
  for (const mark of frame.markers) {
    ctx.globalAlpha = Math.max(0, Math.min(1, mark.opacity));
    if (mark.ringWidth > 0 && mark.ringColor) {
      ctx.fillStyle = mark.ringColor;
      ctx.beginPath(); ctx.ellipse(mark.x, mark.y, mark.width / 2 + mark.ringWidth, mark.height / 2 + mark.ringWidth, 0, 0, Math.PI * 2);
      ctx.ellipse(mark.x, mark.y, mark.width / 2, mark.height / 2, 0, 0, Math.PI * 2); ctx.fill("evenodd");
    }
    ctx.fillStyle = mark.fill;
    ctx.beginPath(); ctx.ellipse(mark.x, mark.y, mark.width / 2, mark.height / 2, 0, 0, Math.PI * 2); ctx.fill();
    if (mark.borderWidth > 0) {
      ctx.strokeStyle = mark.border; ctx.lineWidth = mark.borderWidth;
      ctx.beginPath(); ctx.ellipse(mark.x, mark.y, Math.max(0, (mark.width - mark.borderWidth) / 2),
        Math.max(0, (mark.height - mark.borderWidth) / 2), 0, 0, Math.PI * 2); ctx.stroke();
    }
    if (mark.label) {
      const label = mark.label;
      ctx.fillStyle = label.fill;
      ctx.beginPath(); ctx.roundRect(label.rect.x, label.rect.y, label.rect.width, label.rect.height, label.radius); ctx.fill();
      ctx.font = label.font; ctx.fillStyle = label.color; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(label.text, label.rect.x + label.rect.width / 2, label.rect.y + label.rect.height / 2);
    }
  }
  ctx.restore();
}

/** Complete text wraps, including long terms URLs and scripts without spaces; nothing is ellipsized. */
export function wrapSnapshotText(text: string, maxWidth: number, measure: (text: string) => number): string[] {
  if (!text.trim()) return [];
  if (!Number.isFinite(maxWidth) || maxWidth <= 0) throw new Error("invalid snapshot text width");
  const lines: string[] = []; let line = "";
  for (const word of text.trim().split(/\s+/u)) {
    const candidate = line ? line + " " + word : word;
    if (measure(candidate) <= maxWidth) { line = candidate; continue; }
    if (line) { lines.push(line); line = ""; }
    for (const char of Array.from(word)) {
      if (line && measure(line + char) > maxWidth) { lines.push(line); line = ""; }
      line += char;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export type SnapshotFooter = { lines: readonly string[]; cssHeight: number; font: string; lineHeight: number; padding: number };
export function layoutLargeTradesFooter(ctx: CanvasRenderingContext2D, text: readonly string[], cssWidth: number, fontFamily: string): SnapshotFooter {
  const padding = 12, lineHeight = 14, font = "400 10px " + fontFamily;
  ctx.save(); ctx.font = font;
  const lines = text.flatMap((item) => wrapSnapshotText(item, Math.max(1, cssWidth - padding * 2), (value) => ctx.measureText(value).width));
  ctx.restore();
  return Object.freeze({ lines: Object.freeze(lines), cssHeight: lines.length ? padding * 2 + lines.length * lineHeight : 0,
    font, lineHeight, padding });
}
export function paintLargeTradesFooter(ctx: CanvasRenderingContext2D, footer: SnapshotFooter, destination: SnapshotRect,
  cssWidth: number, palette: { background: string; text: string; line: string }): void {
  if (!footer.cssHeight || !destination.height) return;
  ctx.save();
  ctx.setTransform(destination.width / cssWidth, 0, 0, destination.height / footer.cssHeight, destination.x, destination.y);
  ctx.fillStyle = palette.background; ctx.fillRect(0, 0, cssWidth, footer.cssHeight);
  ctx.strokeStyle = palette.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, 0.5); ctx.lineTo(cssWidth, 0.5); ctx.stroke();
  ctx.font = footer.font; ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillStyle = palette.text;
  footer.lines.forEach((line, i) => ctx.fillText(line, footer.padding, footer.padding + i * footer.lineHeight));
  ctx.restore();
}
