"use client";
/**
 * Treemap.tsx — squarified treemap in pure SVG/React (zero new npm deps).
 *
 * HONESTY DOCTRINE:
 *   - PRICE layer: color = %chg (1D real). Flat neutral dead-zone |chg| < 0.05.
 *   - FLOW layer: color = SIGNED net premium. Sign → hue (a SOFT tape signal),
 *     |$M| → brightness (reliable). Near-flat (|$M| < 0.3) → dim neutral slate;
 *     no-flow → dim graphite. No confident directional read from a dim tile.
 *   - Size = EQUAL / CAP (dollar-volume proxy, manifest has price×vol) / PREMIUM.
 *   - No directional buy/sell assertions anywhere in this component.
 *
 * DESIGN: flat Finviz/TradingView tiles, matching the Macro Dashboard heatmap.
 *   - Sector blocks with dark header bands, abbrev label + avg chg.
 *   - Tiles: ONE solid fill (no per-tile gradient, no gloss), ticker bold
 *     centered, %chg below; white ink + a dark text-shadow so labels stay legible
 *     on the brightest bins. Labels hidden below min size (~20×10).
 *   - Binned price color: edges 1/2/3% + a sub-1% half-step, each hue mixed toward
 *     a dark neutral slate (mirrors the Macro Dashboard bin palette).
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { makeHeatmapT, sectorChipLabel } from "@/lib/heatmapStrings";
import { deltaOiPutCallLabel } from "@/lib/plainLabels";
import type { HeatmapTile, Layer, SizingMode, SectorBlock, TreemapNode, LayoutRect } from "./types";
import { SECTOR_LABEL, SECTOR_ORDER } from "./sectorMap";
import type { GicsSector } from "./types";

// ─── Flat binned color scale (Finviz / TradingView style — matches the Macro
//     Dashboard S&P heatmap). Each tile is ONE solid color; brightness steps with
//     the move's bin. No per-tile top→bot gradient and no gloss overlay. ──

// Theme-aligned palette. Defaults match --up #26c281 / --down #f0566b, but the
// live values are read from CSS (--up-rgb / --down-rgb) so the East-Asian red-up
// theme flips tiles, legend, and table tints together instead of contradicting.
type Triplet = readonly [number, number, number];
const HM_UP_DEFAULT: Triplet = [38, 194, 129];
const HM_DN_DEFAULT: Triplet = [240, 86, 107];
const HM_SLATE: Triplet = [92, 108, 136];
// Flat ~0% tile: dark slate so the white label stays legible (macro-dashboard neutral).
const HM_NEUTRAL: Triplet = [41, 46, 57];
// No-flow padding tile — distinct dim graphite so "no data" ≠ "flat flow".
const HM_NODATA: Triplet = [24, 27, 34];

// 1D bin edges (%) — mirror the Macro Dashboard BASE_EDGES and the "bins ±1/2/3" legend.
const HM_EDGES: readonly [number, number, number] = [1, 2, 3];
// Fraction of the full up/down hue per bin level (the remainder is the neutral slate).
// lvl 0 = sub-1% half-step, 1 = ≥1%, 2 = ≥2%, 3 = ≥3%. Matches macro P[0.5/1/2/3].
const HM_BIN_FRAC = [0.26, 0.46, 0.82, 1] as const;
// Moves smaller than this read as flat neutral, never a faint tint.
const HM_FLAT_DZ = 0.05;
const HM_PREM_CAP = 250; // $M — log ceiling for flow premium intensity

function readTriplet(name: string, fallback: Triplet): Triplet {
  if (typeof window === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const parts = raw.split(",").map((s) => parseInt(s, 10));
  return parts.length === 3 && parts.every((n) => Number.isFinite(n)) ? (parts as unknown as Triplet) : fallback;
}
/** Current up/down RGB from the active theme (call once per render). */
export function heatPalette(): { up: Triplet; down: Triplet } {
  return { up: readTriplet("--up-rgb", HM_UP_DEFAULT), down: readTriplet("--down-rgb", HM_DN_DEFAULT) };
}
// Mutable module palette — refreshed at the top of each Treemap render so the
// module-level color helpers below flip with the theme without threading params.
let HM_UP: Triplet = HM_UP_DEFAULT;
let HM_DN: Triplet = HM_DN_DEFAULT;
const rgbStr = (t: Triplet) => t.join(",");            // bare "r,g,b" for rgba(...) interpolation
const rgbCss = (t: Triplet) => `rgb(${t.join(",")})`;  // full rgb(...) for solid fills

// Blend `target` over `base` by fraction f (f=1 → full target, f=0 → base).
function mixTriplet(target: Triplet, base: Triplet, f: number): Triplet {
  return [
    Math.round(target[0] * f + base[0] * (1 - f)),
    Math.round(target[1] * f + base[1] * (1 - f)),
    Math.round(target[2] * f + base[2] * (1 - f)),
  ] as unknown as Triplet;
}

/**
 * Flat price tile color. up/dn hues already carry the active theme — the
 * East-Asian red-up mode flips --up-rgb/--down-rgb, so HM_UP is red there and no
 * manual hue swap is needed. Sub-dead-zone moves read as the flat neutral slate.
 */
function priceColor(chg: number): string {
  if (chg == null || Number.isNaN(chg)) return rgbCss(HM_NEUTRAL);
  const a = Math.abs(chg);
  if (a < HM_FLAT_DZ) return rgbCss(HM_NEUTRAL);
  const lvl = a >= HM_EDGES[2] ? 3 : a >= HM_EDGES[1] ? 2 : a >= HM_EDGES[0] ? 1 : 0;
  return rgbCss(mixTriplet(chg > 0 ? HM_UP : HM_DN, HM_NEUTRAL, HM_BIN_FRAC[lvl]));
}

/**
 * Flat flow tile color by SIGNED net premium (the number shown on the tile).
 *   sign  → hue: + = net-call/bullish (up color), − = net-put/bearish (down color)
 *   |$M|  → intensity via log10 so the median ~$0.4M name is a visible dim tone.
 * HONESTY: net-premium SIGN is a soft tape signal (see the direction-is-soft
 * caption); MAGNITUDE is reliable and always drives brightness.
 */
function flowColor(tile: HeatmapTile): string {
  if (!tile.hasFlow) return rgbCss(HM_NODATA);
  const v = tile.netPremiumMn ?? 0;
  const mag = Math.abs(v);
  if (mag < 0.3) return rgbCss(mixTriplet(HM_SLATE, HM_NEUTRAL, 0.4)); // ~flat → dim slate
  const t = Math.max(0.3, Math.min(Math.log10(1 + mag) / Math.log10(1 + HM_PREM_CAP), 1));
  return rgbCss(mixTriplet(v > 0 ? HM_UP : HM_DN, HM_NEUTRAL, t));
}

/**
 * Legend colors for the live theme.
 *   swatches: discrete PRICE bins in ascending intensity (½/1/2/3) for each side,
 *             so every price tile color — including the sub-1% half-step — is keyed.
 *   flowGrad: endpoint hues for a CONTINUOUS flow-layer bar (flow tiles use a
 *             continuous log-magnitude ramp, not bins).
 */
export function heatSwatches(): { down: string[]; neutral: string; up: string[]; flowDown: string; flowUp: string } {
  const p = heatPalette();
  const mk = (target: Triplet, f: number) => rgbCss(mixTriplet(target, HM_NEUTRAL, f));
  return {
    down: HM_BIN_FRAC.map((f) => mk(p.down, f)),   // ½,1,2,3
    neutral: rgbCss(HM_NEUTRAL),
    up: HM_BIN_FRAC.map((f) => mk(p.up, f)),        // ½,1,2,3
    flowDown: rgbCss(p.down),
    flowUp: rgbCss(p.up),
  };
}

// ─── Squarified treemap algorithm ─────────────────────────────────────────────

function worstAspect(s: number, mx: number, mn: number, short: number): number {
  const s2 = s * s;
  const short2 = short * short;
  return Math.max((short2 * mx) / s2, s2 / (short2 * mn));
}

function squarifyRecurse(
  items: { value: number; tile: HeatmapTile }[],
  x: number, y: number, w: number, h: number,
  totalValue: number,
  result: TreemapNode[]
): void {
  if (items.length === 0 || w <= 0.5 || h <= 0.5 || totalValue <= 0) return;
  if (items.length === 1) {
    result.push({ x, y, w, h, tile: items[0].tile });
    return;
  }

  const scale = (w * h) / totalValue;
  const areas = items.map(i => Math.max(i.value * scale, 1e-9));
  const short = Math.min(w, h);

  let count = 1;
  let sum = areas[0];
  let mx = areas[0];
  let mn = areas[0];
  let worst = worstAspect(sum, mx, mn, short);
  for (let i = 1; i < areas.length; i++) {
    const nSum = sum + areas[i];
    const nMx = Math.max(mx, areas[i]);
    const nMn = Math.min(mn, areas[i]);
    const nWorst = worstAspect(nSum, nMx, nMn, short);
    if (nWorst <= worst) {
      count = i + 1; sum = nSum; mx = nMx; mn = nMn; worst = nWorst;
    } else {
      break;
    }
  }

  const thick = sum / short;
  const isWide = w >= h;
  let pos = isWide ? y : x;
  for (let i = 0; i < count; i++) {
    const len = areas[i] / thick;
    if (isWide) {
      result.push({ x, y: pos, w: thick, h: len, tile: items[i].tile });
    } else {
      result.push({ x: pos, y, w: len, h: thick, tile: items[i].tile });
    }
    pos += len;
  }

  const rest = items.slice(count);
  const restTotal = rest.reduce((s, i) => s + i.value, 0);
  if (isWide) {
    squarifyRecurse(rest, x + thick, y, w - thick, h, restTotal, result);
  } else {
    squarifyRecurse(rest, x, y + thick, w, h - thick, restTotal, result);
  }
}

function squarify(
  items: { value: number; tile: HeatmapTile }[],
  x: number, y: number, w: number, h: number
): TreemapNode[] {
  if (items.length === 0 || w <= 0 || h <= 0) return [];
  const totalValue = items.reduce((s, i) => s + i.value, 0);
  if (totalValue <= 0) {
    return squarify(items.map(i => ({ ...i, value: 1 })), x, y, w, h);
  }
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const result: TreemapNode[] = [];
  squarifyRecurse(sorted, x, y, w, h, totalValue, result);
  return result;
}

// ─── Tile value function ──────────────────────────────────────────────────────

/**
 * Tile sizing:
 *   - "cap" → dollar-volume proxy (price × vol), falls back to equal if missing.
 *     min floor = 1 so no tile vanishes.
 *   - "premium" (flow layer) → abs(netPremiumMn), min 0.01.
 *   - "equal" → 1.
 *
 * NOTE: manifest lacks market_cap; dollar-volume (price×vol) is the documented
 * proxy and correlates well with cap rank for large/mid caps.
 * This will be superseded when nightly manifest injects mcap.
 */
function tileValue(tile: HeatmapTile, sizing: SizingMode, layer: Layer): number {
  if (sizing === "premium" && layer === "flow" && tile.hasFlow) {
    return Math.max(Math.abs(tile.netPremiumMn ?? 0), 0.01);
  }
  if (sizing === "cap") {
    // Dollar-volume proxy: price * vol. Floor at 1 so tiles with zero vol still render.
    const dv = (tile.price ?? 0) * (tile.vol ?? 0);
    return Math.max(dv, 1);
  }
  return 1;
}

// ─── Sector block layout ──────────────────────────────────────────────────────

const HEADER_H_BIG = 24;  // sector label band height when sector block is tall
const HEADER_H_MED = 14;  // compact header for medium blocks
const HEADER_H_SML = 8;   // minimal header for small blocks

function getHeaderH(blockH: number): number {
  if (blockH > 55) return HEADER_H_BIG;
  if (blockH > 35) return HEADER_H_MED;
  if (blockH > 20) return HEADER_H_SML;
  return 0;
}

function layoutSectors(
  tiles: HeatmapTile[],
  sizing: SizingMode,
  layer: Layer,
  canvasW: number,
  canvasH: number,
  gap: number = 1
): SectorBlock[] {
  const bySector: Partial<Record<GicsSector, HeatmapTile[]>> = {};
  for (const tile of tiles) {
    const s = tile.sector;
    if (!bySector[s]) bySector[s] = [];
    bySector[s]!.push(tile);
  }

  const sectorItems: { sector: GicsSector; tiles: HeatmapTile[]; value: number }[] = [];
  for (const sector of SECTOR_ORDER) {
    const ts = bySector[sector];
    if (!ts || ts.length === 0) continue;
    const value = ts.reduce((s, t) => s + tileValue(t, sizing, layer), 0);
    sectorItems.push({ sector, tiles: ts, value });
  }

  if (sectorItems.length === 0) return [];

  const totalValue = sectorItems.reduce((s, i) => s + i.value, 0);

  const sectorTmpItems = sectorItems.map(s => ({
    value: s.value,
    tile: { ticker: s.sector, name: s.sector, sector: s.sector, price: 0, chg1d: 0, hasFlow: false } as HeatmapTile,
  }));

  const sectorRects: LayoutRect[] = [];
  squarifyRecurse(sectorTmpItems, 0, 0, canvasW, canvasH, totalValue, sectorRects as unknown as TreemapNode[]);

  const blocks: SectorBlock[] = [];
  for (let i = 0; i < sectorItems.length; i++) {
    const rect = sectorRects[i];
    if (!rect) continue;
    const { sector, tiles: sectorTiles } = sectorItems[i];

    const hH = getHeaderH(rect.h);
    const innerX = rect.x + gap;
    const innerY = rect.y + hH + gap;
    const innerW = rect.w - gap * 2;
    const innerH = rect.h - hH - gap * 2;

    if (innerW < 4 || innerH < 4) {
      blocks.push({ x: rect.x, y: rect.y, w: rect.w, h: rect.h, sector, nodes: [] });
      continue;
    }

    const tileItems = sectorTiles.map(t => ({ value: tileValue(t, sizing, layer), tile: t }));
    // Sort descending so largest tiles anchor top-left (best readability).
    tileItems.sort((a, b) => b.value - a.value);
    const nodes = squarify(tileItems, innerX, innerY, innerW, innerH);

    blocks.push({ x: rect.x, y: rect.y, w: rect.w, h: rect.h, sector, nodes });
  }

  return blocks;
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────

interface TooltipState {
  tile: HeatmapTile;
  cx: number;
  cy: number;
}

// ─── Sector avg-change for header color ──────────────────────────────────────

function sectorAvgChg(block: SectorBlock, layer: Layer): number {
  if (block.nodes.length === 0) return 0;
  if (layer === "price") {
    return block.nodes.reduce((s, n) => s + n.tile.chg1d, 0) / block.nodes.length;
  }
  // flow: average tone mapped to -1/0/+1
  const flowNodes = block.nodes.filter(n => n.tile.hasFlow);
  if (flowNodes.length === 0) return 0;
  return flowNodes.reduce((s, n) => {
    const v = n.tile.tone === "pos" ? 1 : n.tile.tone === "neg" ? -1 : 0;
    return s + v;
  }, 0) / flowNodes.length;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface TreemapProps {
  tiles: HeatmapTile[];
  layer: Layer;
  sizing: SizingMode;
  selectedTicker: string | null;
  onSelect: (tile: HeatmapTile) => void;
  lang: "en" | "zh";
}

// ─── Component ────────────────────────────────────────────────────────────────

const MIN_TILE_AREA = 64;  // px² — below this tiles are not rendered (MomoEdge: ~20x8 ≈ 160; we use 64 to show more names)

export function Treemap({ tiles, layer, sizing, selectedTicker, onSelect, lang }: TreemapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState<{ w: number; h: number }>({ w: 900, h: 500 });
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  // Refresh the module palette from the active theme before any tile color is
  // computed this render (flowColor/priceColor/sector stroke read these).
  { const p = heatPalette(); HM_UP = p.up; HM_DN = p.down; }

  useEffect(() => {
    if (!containerRef.current) return;
    let timer: ReturnType<typeof setTimeout>;
    const ro = new ResizeObserver((entries) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const e = entries[0];
        if (e) setDims({ w: e.contentRect.width, h: e.contentRect.height });
      }, 120);
    });
    ro.observe(containerRef.current);
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width > 0) setDims({ w: rect.width, h: rect.height });
    return () => { ro.disconnect(); clearTimeout(timer); };
  }, []);

  const blocks = layoutSectors(tiles, sizing, layer, dims.w, dims.h, 1);

  const handleMouseLeave = useCallback(() => setTooltip(null), []);

  const handleTileMouseEnter = useCallback((tile: HeatmapTile, cx: number, cy: number) => {
    setTooltip({ tile, cx, cy });
  }, []);

  const handleTileClick = useCallback((tile: HeatmapTile) => {
    setTooltip(null);
    onSelect(tile);
  }, [onSelect]);

  const zh = lang === "zh";

  return (
    <div ref={containerRef} style={TREEMAP_CONTAINER} onMouseLeave={handleMouseLeave}>
      <svg width={dims.w} height={dims.h} style={{ display: "block" }}>
        <style>{`
          .hm-tile { transition: filter .12s ease; }
          .hm-tile:hover { filter: brightness(1.1); }
        `}</style>

        {blocks.map(block => (
          <SectorBlockGroup
            key={block.sector}
            block={block}
            layer={layer}
            selectedTicker={selectedTicker}
            onTileMouseEnter={handleTileMouseEnter}
            onTileClick={handleTileClick}
            zh={zh}
          />
        ))}
      </svg>

      {tooltip && (
        <HoverTooltip tooltip={tooltip} layer={layer} canvasW={dims.w} canvasH={dims.h} zh={zh} />
      )}
    </div>
  );
}

// ─── SectorBlockGroup ─────────────────────────────────────────────────────────

interface SectorBlockGroupProps {
  block: SectorBlock;
  layer: Layer;
  selectedTicker: string | null;
  onTileMouseEnter: (tile: HeatmapTile, cx: number, cy: number) => void;
  onTileClick: (tile: HeatmapTile) => void;
  zh: boolean;
}

function SectorBlockGroup({
  block, layer, selectedTicker, onTileMouseEnter, onTileClick, zh,
}: SectorBlockGroupProps) {
  // The sector band is chrome, not data: in the ZH frame it reads 科技 / 通信,
  // never the English GICS token. SECTOR_LABEL stays the EN text and the fallback.
  const abbrev = sectorChipLabel(zh ? "zh" : "en", block.sector, SECTOR_LABEL[block.sector] ?? block.sector);
  const hH = getHeaderH(block.h);
  const avg = sectorAvgChg(block, layer);
  const avgColor = avg > 0 ? "var(--up)" : avg < 0 ? "var(--down)" : "rgba(148,163,184,0.6)";
  const big = block.h > 55 && block.w > 75;
  const med = !big && block.h > 30 && block.w > 40;

  return (
    <g>
      {/* Sector background */}
      <rect
        x={block.x}
        y={block.y}
        width={block.w}
        height={block.h}
        fill="rgba(255,255,255,0.003)"
        stroke={`rgba(${avg > 0 ? rgbStr(HM_UP) : avg < 0 ? rgbStr(HM_DN) : "148,163,184"},0.22)`}
        strokeWidth={1.2}
        rx={4}
      />

      {/* Sector header band */}
      {big && hH >= HEADER_H_BIG && (
        <>
          <rect
            x={block.x}
            y={block.y}
            width={block.w}
            height={hH}
            fill="rgba(0,0,0,0.45)"
            rx={3}
          />
          <line
            x1={block.x + 1}
            y1={block.y + hH}
            x2={block.x + block.w - 1}
            y2={block.y + hH}
            stroke={`rgba(148,163,184,0.15)`}
            strokeWidth={0.5}
          />
          <text
            x={block.x + 8}
            y={block.y + 10}
            fontSize={9}
            fontWeight={700}
            fill="#94a3b8"
            style={{ userSelect: "none", fontFamily: "var(--font-num)", fontVariantNumeric: "tabular-nums", letterSpacing: "0.06em" }}
          >
            {abbrev}
          </text>
          {block.nodes.length > 0 && (
            <text
              x={block.x + block.w - 6}
              y={block.y + 10}
              fontSize={9}
              fontWeight={700}
              fill={avgColor}
              textAnchor="end"
              style={{ userSelect: "none", fontFamily: "var(--font-num)", fontVariantNumeric: "tabular-nums" }}
            >
              {layer === "price"
                ? `${avg >= 0 ? "+" : ""}${avg.toFixed(1)}%`
                : `${avg >= 0 ? "+" : ""}${(avg * 100).toFixed(0)}%`
              }
            </text>
          )}
          {/* Breadth / leader sub-line */}
          <text
            x={block.x + 8}
            y={block.y + 19}
            fontSize={6}
            fill="rgba(255,255,255,0.18)"
            style={{ userSelect: "none", fontFamily: "var(--font-num)", fontVariantNumeric: "tabular-nums" }}
          >
            {block.nodes.length > 0 ? block.nodes[0].tile.ticker : ""}
          </text>
        </>
      )}

      {med && hH >= HEADER_H_MED && (
        <>
          <rect
            x={block.x}
            y={block.y}
            width={block.w}
            height={hH}
            fill="rgba(0,0,0,0.35)"
            rx={2}
          />
          <text
            x={block.x + 4}
            y={block.y + 9}
            fontSize={7}
            fontWeight={700}
            fill="#8b95a5"
            style={{ userSelect: "none", fontFamily: "var(--font-num)", fontVariantNumeric: "tabular-nums", letterSpacing: "0.04em" }}
          >
            {abbrev}
          </text>
          {block.nodes.length > 0 && (
            <text
              x={block.x + block.w - 4}
              y={block.y + 9}
              fontSize={7}
              fontWeight={600}
              fill={avgColor.replace("0.6)", "0.5)")}
              textAnchor="end"
              style={{ userSelect: "none", fontFamily: "var(--font-num)", fontVariantNumeric: "tabular-nums" }}
            >
              {layer === "price"
                ? `${avg >= 0 ? "+" : ""}${avg.toFixed(1)}%`
                : `${avg >= 0 ? "+" : ""}${(avg * 100).toFixed(0)}%`
              }
            </text>
          )}
        </>
      )}

      {/* Tiles */}
      {block.nodes.map(node => {
        const area = node.w * node.h;
        if (area < MIN_TILE_AREA) return null;
        const fill = layer === "price" ? priceColor(node.tile.chg1d) : flowColor(node.tile);
        return (
          <TileRect
            key={node.tile.ticker}
            node={node}
            layer={layer}
            isSelected={selectedTicker === node.tile.ticker}
            fill={fill}
            onMouseEnter={onTileMouseEnter}
            onClick={onTileClick}
          />
        );
      })}
    </g>
  );
}

// ─── TileRect ─────────────────────────────────────────────────────────────────

interface TileRectProps {
  node: TreemapNode;
  layer: Layer;
  isSelected: boolean;
  fill: string;
  onMouseEnter: (tile: HeatmapTile, cx: number, cy: number) => void;
  onClick: (tile: HeatmapTile) => void;
}

function TileRect({ node, layer, isSelected, fill, onMouseEnter, onClick }: TileRectProps) {
  const { x, y, w, h, tile } = node;

  // Font sizing — mirrors MomoEdge: tFs = min(w/4.5, h/2.2, 16), cFs = min(w/6, h/3.5, 12)
  const tFs = Math.min(w / 4.5, h / 2.2, 16);
  const cFs = Math.min(w / 6, h / 3.5, 12);

  // Show ticker if scaled width > 20 and height > 10 (MomoEdge threshold)
  const showTicker = (w * 1) > 20 && (h * 1) > 10;
  // Show value if enough room for two lines
  const showValue = (w * 1) > 26 && (h * 1) > 22;

  const chg1d = tile.chg1d ?? 0;
  const valueLabel = layer === "price"
    ? `${chg1d >= 0 ? "+" : ""}${chg1d.toFixed(1)}%`
    : tile.hasFlow && tile.netPremiumMn != null
      ? `$${tile.netPremiumMn.toFixed(1)}M`
      : "";

  const rx = w > 26 && h > 20 ? 3 : 2;

  return (
    <g
      className="hm-tile"
      onClick={() => onClick(tile)}
      onMouseEnter={(e) => {
        const svgEl = (e.target as SVGElement).closest("svg");
        if (!svgEl) return;
        const svgRect = svgEl.getBoundingClientRect();
        onMouseEnter(tile, e.clientX - svgRect.left, e.clientY - svgRect.top);
      }}
      style={{ cursor: "pointer" }}
    >
      <rect
        x={x + 0.9}
        y={y + 0.9}
        width={Math.max(0, w - 1.8)}
        height={Math.max(0, h - 1.8)}
        fill={fill}
        stroke={isSelected ? "var(--brand, #00e5ff)" : "rgba(255,255,255,0.05)"}
        strokeWidth={isSelected ? 2 : 0.4}
        rx={rx}
      />

      {showTicker && (
        <text
          x={x + w / 2}
          y={y + h / 2 - (showValue ? cFs * 0.55 + 1 : 0)}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={tFs}
          fontWeight={700}
          fill="#f8fafc"
          style={{ userSelect: "none", fontFamily: "var(--font-ui, sans-serif)", letterSpacing: "0.01em", pointerEvents: "none", textShadow: "0 1px 2px rgba(0,0,0,0.55)" }}
        >
          {tile.ticker}
        </text>
      )}

      {showValue && (
        <text
          x={x + w / 2}
          y={y + h / 2 + tFs * 0.55 + 1}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={cFs}
          fontWeight={600}
          fill="rgba(255,255,255,0.92)"
          style={{
            userSelect: "none",
            fontFamily: "var(--font-num)",
            fontVariantNumeric: "tabular-nums",
            pointerEvents: "none",
            textShadow: "0 1px 2px rgba(0,0,0,0.55)",
          }}
        >
          {valueLabel}
        </text>
      )}

      {/* price-only badge on flow layer when no flow data */}
      {layer === "flow" && !tile.hasFlow && w > 36 && h > 16 && (
        <text
          x={x + w / 2}
          y={y + h - 5}
          textAnchor="middle"
          fontSize={7}
          fill="rgba(255,255,255,0.3)"
          style={{ userSelect: "none", fontFamily: "var(--font-ui)", pointerEvents: "none" }}
        >
          price
        </text>
      )}
    </g>
  );
}

// ─── HoverTooltip ─────────────────────────────────────────────────────────────

interface HoverTooltipProps {
  tooltip: TooltipState;
  layer: Layer;
  canvasW: number;
  canvasH: number;
  zh: boolean;
}

function HoverTooltip({ tooltip, layer, canvasW, canvasH, zh }: HoverTooltipProps) {
  const t = makeHeatmapT(zh ? "zh" : "en");
  const { tile, cx, cy } = tooltip;
  const TIP_W = 180;
  const TIP_H = layer === "flow" ? 230 : 170;

  const left = Math.min(Math.max(4, cx + 12), canvasW - TIP_W - 4);
  const top  = cy + TIP_H > canvasH ? cy - TIP_H - 8 : cy + 16;

  const tipChg = tile.chg1d ?? 0;
  const chgColor = tipChg >= 0 ? "var(--up)" : "var(--down)";
  const chgStr = `${tipChg >= 0 ? "+" : ""}${tipChg.toFixed(2)}%`;

  const priceUp = tile.chg1d >= 0.05;
  const priceDn = tile.chg1d <= -0.05;
  const tonePos = tile.tone === "pos";
  const toneNeg = tile.tone === "neg";
  const isDivergent = tile.hasFlow && ((priceUp && toneNeg) || (priceDn && tonePos));

  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        width: TIP_W,
        background: "rgba(10,14,20,0.96)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 6,
        padding: "8px 10px",
        pointerEvents: "none",
        zIndex: 100,
        boxShadow: "0 6px 20px rgba(0,0,0,0.6)",
        fontSize: 11,
        fontFamily: "var(--font-ui)",
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>{tile.ticker}</span>
        {isDivergent && (
          <span style={{ fontSize: 9, color: "var(--warn)", fontWeight: 600 }}>DIV</span>
        )}
        {layer === "flow" && tile.hasFlow && (
          <span style={{
            fontSize: 8, fontWeight: 600, padding: "1px 4px", borderRadius: 2,
            background: tile.tone === "pos" ? "rgba(0,191,165,0.1)" : tile.tone === "neg" ? "rgba(255,107,107,0.1)" : "rgba(148,163,184,0.1)",
            color: tile.tone === "pos" ? "var(--up)" : tile.tone === "neg" ? "var(--down)" : "var(--muted)",
          }}>
            {tile.tone ?? "—"}
          </span>
        )}
        {layer === "price" && (
          <span style={{ fontSize: 8, fontWeight: 600, padding: "1px 4px", borderRadius: 2,
            background: `rgba(${tipChg >= 0 ? rgbStr(HM_UP) : rgbStr(HM_DN)},0.10)`,
            color: chgColor }}>
            {chgStr}
          </span>
        )}
      </div>
      <div style={{ color: "rgba(148,163,184,0.7)", marginBottom: 5, fontSize: 10 }}>{tile.name}</div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px 10px", fontSize: 10 }}>
        <span style={{ color: "#475569" }}>{zh ? "价格" : "Price"}</span>
        <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>${(tile.price ?? 0).toFixed(2)}</span>

        <span style={{ color: "#475569" }}>{zh ? "涨跌 1D" : "Chg 1D"}</span>
        <span style={{ textAlign: "right", color: chgColor, fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{chgStr}</span>

        {layer === "flow" && tile.hasFlow && (
          <>
            <span style={{ color: "#475569" }}>{zh ? "权利金" : "Premium"}</span>
            <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
              {tile.netPremiumMn != null ? `$${tile.netPremiumMn.toFixed(1)}M` : "—"}
            </span>

            {tile.doiPc != null && (
              <>
                <span style={{ color: "#475569" }}>{deltaOiPutCallLabel(zh ? "zh" : "en")}</span>
                <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{tile.doiPc.toFixed(2)}</span>
              </>
            )}

            {isDivergent && (
              <div style={{ gridColumn: "1 / -1", marginTop: 4, padding: "3px 5px", background: "rgba(232,179,57,0.12)", borderRadius: 3, fontSize: 9, color: "var(--warn)", lineHeight: 1.4 }}>
                {t("detailDivChip")}
              </div>
            )}
            <div style={{ gridColumn: "1 / -1", marginTop: 3, fontSize: 9, color: "var(--muted)", fontStyle: "italic" }}>
              {t("directionIsSoft")}
            </div>
          </>
        )}

        {layer === "flow" && !tile.hasFlow && (
          <div style={{ gridColumn: "1 / -1", color: "var(--muted)", fontSize: 9, fontStyle: "italic", marginTop: 4 }}>
            {t("tileNoFlow")}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const TREEMAP_CONTAINER: React.CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  overflow: "hidden",
  background: "#0c1018",
};
