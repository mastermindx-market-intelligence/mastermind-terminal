import type { EnginePrimitive, EngineProjection, PrimitiveAttachContext } from "./chart-engine/primitive";
import type { ExposureNode } from "./marketStructure";

export interface ExposureMapDrawing {
  nodes: readonly ExposureNode[];
  selected: number | null;
  mode: "net" | "gross";
  color: string;
  selectedColor: string;
}

/** Current-snapshot reference bands, drawn by the incumbent renderer's projection. */
export function createExposureMapPrimitive(initial: ExposureMapDrawing): EnginePrimitive & { set(next: ExposureMapDrawing): void } {
  let drawing = initial;
  let attached: PrimitiveAttachContext | null = null;
  let projection: EngineProjection | null = null;
  const value = (n: ExposureNode) => drawing.mode === "gross" ? n.grossMn : n.netMn;
  return {
    id: "options-exposure-snapshot", zOrder: "top",
    attached(ctx) { attached = ctx; ctx.requestUpdate(); },
    detached() { attached = null; projection = null; },
    update(p) { projection = p; },
    hitTest(x, y) {
      const p = projection;
      if (!attached || !p || x < p.widthPx - Math.min(150, p.widthPx * .28) - 8 || x > p.widthPx - 8 || y < 0 || y > p.heightPx) return null;
      let found: ExposureNode | null = null, distance = 22;
      for (const node of drawing.nodes) {
        if (value(node) == null || value(node) === 0) continue;
        const projected = p.yOfPrice(node.strike), delta = Math.abs(projected - y);
        if (Number.isFinite(projected) && projected >= 8 && projected <= p.heightPx - 8 && delta < distance) { found = node; distance = delta; }
      }
      return found ? { primitiveId: "options-exposure-snapshot", cursor: "pointer", data: { strike: found.strike } } : null;
    },
    set(next) { drawing = next; attached?.requestUpdate(); },
    paint(ctx: CanvasRenderingContext2D, p: EngineProjection) {
      projection = p;
      const maximum = Math.max(0, ...drawing.nodes.map((n) => Math.abs(value(n) ?? 0)));
      if (!maximum) return;
      const width = Math.min(150, p.widthPx * 0.28), right = p.widthPx - 8;
      const css = typeof document === "undefined" ? null : getComputedStyle(document.documentElement);
      const color = css?.getPropertyValue("--brand-2").trim() || drawing.color;
      const selectedColor = css?.getPropertyValue("--warn").trim() || drawing.selectedColor;
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, p.widthPx, p.heightPx); ctx.clip();
      for (const node of drawing.nodes) {
        const v = value(node), y = p.yOfPrice(node.strike);
        if (v == null || v === 0 || !Number.isFinite(y) || y < 8 || y > p.heightPx - 8) continue;
        const selected = node.strike === drawing.selected;
        ctx.fillStyle = selected ? selectedColor : color;
        ctx.globalAlpha = selected ? 0.85 : 0.42;
        const w = Math.max(2, Math.abs(v) / maximum * width);
        ctx.fillRect(right - w, y - 3, w, 6);
        if (selected) {
          ctx.globalAlpha = 1; ctx.font = "11px system-ui"; ctx.textAlign = "right";
          ctx.fillText(`${node.strike} · ${v > 0 ? "+" : "−"}`, right - w - 6, y + 4);
        }
      }
      ctx.restore();
    },
  };
}
