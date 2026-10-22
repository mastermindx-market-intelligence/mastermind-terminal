import type { EnginePrimitive, EngineProjection, PrimitiveAttachContext } from "./chart-engine/primitive";
import type { ExposureNode } from "./marketStructure";

export interface ExposureMapDrawing {
  nodes: readonly ExposureNode[];
  secondary?: readonly ExposureNode[];
  averages?: readonly { label: string; price: number }[];
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
      if (!attached || !p || x < p.widthPx - Math.min(190, p.widthPx * .32) - 8 || x > p.widthPx - 8 || y < 0 || y > p.heightPx) return null;
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
      const dual = !!drawing.secondary?.length;
      const width = Math.min(dual ? 120 : 190, p.widthPx * 0.32), right = p.widthPx - (dual ? 88 : 8);
      const css = typeof document === "undefined" ? null : getComputedStyle(document.documentElement);
      // Exposure sign uses the fixed exposure palette, never the price up/down pair: a locale or
      // east/west price preference must never invert the sign of a dealer book.
      const positive = css?.getPropertyValue("--exposure-positive").trim() || "#4cc6cc";
      const negative = css?.getPropertyValue("--exposure-negative").trim() || "#d896f0";
      const ink = css?.getPropertyValue("--text").trim() || drawing.color;
      const selectedColor = drawing.selectedColor || css?.getPropertyValue("--exposure-selected").trim() || "#d4a017";
      const ranked = drawing.nodes.filter(n => value(n) != null && value(n) !== 0)
        .slice().sort((a,b) => Math.abs(value(b)!) - Math.abs(value(a)!));
      const labelled = new Set(ranked.slice(0, 6).map(n => n.strike));
      if (drawing.selected != null) labelled.add(drawing.selected);
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, p.widthPx, p.heightPx); ctx.clip();
      const labelYs: number[] = [];
      // Selected node first: dense neighbors must never hide the inspected strike.
      ranked.sort((a,b) => Number(b.strike === drawing.selected) - Number(a.strike === drawing.selected));
      for (const node of ranked) {
        const v = value(node)!, y = p.yOfPrice(node.strike);
        if (!Number.isFinite(y) || y < 10 || y > p.heightPx - 10) continue;
        const selected = node.strike === drawing.selected;
        const color = selected ? selectedColor : v < 0 ? negative : positive;
        const w = Math.max(3, Math.abs(v) / maximum * width);
        ctx.fillStyle = color; ctx.globalAlpha = selected ? .75 : .3;
        ctx.fillRect(right - w, y - 4, w, 8);
        ctx.globalAlpha = .8;
        ctx.fillRect(right - 2, y - 4, 2, 8);
        if (selected) {
          ctx.strokeStyle = color; ctx.globalAlpha = .35; ctx.setLineDash([3, 5]);
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(right - w - 5, y); ctx.stroke(); ctx.setLineDash([]);
        }
        // The shared price host reserves its top row for the current bar readout.
        if (y >= 44 && labelled.has(node.strike) && !labelYs.some(previous => Math.abs(previous - y) < 16)) {
          labelYs.push(y); ctx.globalAlpha = 1; ctx.fillStyle = selected ? selectedColor : ink;
          ctx.font = `${selected ? "600 " : ""}10px system-ui`; ctx.textAlign = "right";
          const magnitude = Math.abs(v) >= 1000 ? `${(v/1000).toFixed(2)}B` : Math.abs(v) < .01 ? `${v.toExponential(1)}M` : `${v.toFixed(1)}M`;
          ctx.fillText(`${node.strike}  ${v > 0 ? "+" : ""}${magnitude}`, right - w - 7, y + 3);
        }
      }
      if (dual) {
        const maximumVanna = Math.max(0,...drawing.secondary!.map(n => Math.abs(n.netMn ?? 0)));
        if (maximumVanna) for (const node of drawing.secondary!) {
          const v = node.netMn, y = p.yOfPrice(node.strike);
          if (v == null || !v || !Number.isFinite(y) || y < 10 || y > p.heightPx-10) continue;
          ctx.strokeStyle = v < 0 ? negative : positive; ctx.globalAlpha = .8;
          const w = Math.max(2,Math.abs(v)/maximumVanna*70);
          ctx.strokeRect(p.widthPx-8-w,y-3,w,6);
        }
      }
      ctx.globalAlpha = .5; ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.font = "9px system-ui";
      ctx.textAlign = "left"; ctx.setLineDash([2,5]);
      for (const average of drawing.averages ?? []) {
        const y = p.yOfPrice(average.price);
        if (!Number.isFinite(y) || y < 10 || y > p.heightPx-10) continue;
        ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(Math.max(0,right-width-10),y);ctx.stroke();
        ctx.fillText(average.label,8,y-4);
      }
      ctx.restore();
    },
  };
}
