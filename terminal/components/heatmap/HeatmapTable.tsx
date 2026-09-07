"use client";
/**
 * HeatmapTable.tsx — sortable tabular equivalent to the treemap.
 *
 * HONESTY DOCTRINE:
 *   - Net premium is magnitude only — not labeled directional.
 *   - Call share shown as ΔOI-derived doiPc, labeled "(~soft)".
 *   - Divergence: shown only when both sides exceed dead-zones AND disagree.
 *   - No "validated", predictive, or buy/sell copy.
 *
 * COLUMNS (MomoEdge parity):
 *   PRICE mode: Ticker | Name | Industry | Cap(proxy) | Price | Chg% | RS | Vol
 *   FLOW mode:  Ticker | Name | Premium | Sent% | B/B | Score | Industry
 *
 * NOTE: Cap is dollar-volume proxy (price × vol) — honest label "DolVol~Cap".
 * RS = relative strength vs universe avg (not vs SPY — we lack an SPY tile).
 * Vol = current vol / prev vol ratio. prev_vol not in manifest v1; shown as "—".
 */

import React, { useMemo, useState } from "react";
import { makeHeatmapT } from "@/lib/heatmapStrings";
import { mappedOrNeutral } from "@/lib/plainLabels";
import { SECTOR_LABEL } from "./sectorMap";
import { heatPalette } from "./Treemap";
import type { HeatmapTile, Layer } from "./types";

type SortKey =
  | "ticker" | "chg1d" | "price" | "dolVol"  // price mode
  | "netPremiumMn" | "doiPc" | "tone" | "divergent";  // flow mode shared

type SortDir = "asc" | "desc";

interface HeatmapTableProps {
  tiles: HeatmapTile[];
  layer: Layer;
  selectedTicker: string | null;
  onSelect: (tile: HeatmapTile) => void;
  lang: "en" | "zh";
}

function isDivergent(tile: HeatmapTile): boolean {
  if (!tile.hasFlow || !tile.tone || tile.tone === "neutral") return false;
  return (tile.chg1d > 0.05 && tile.tone === "neg") || (tile.chg1d < -0.05 && tile.tone === "pos");
}

function fmtDolVol(tile: HeatmapTile): string {
  const dv = (tile.price ?? 0) * (tile.vol ?? 0);
  if (!dv || dv <= 0) return "—";
  if (dv >= 1e12) return `$${(dv / 1e12).toFixed(1)}T`;
  if (dv >= 1e9)  return `$${(dv / 1e9).toFixed(1)}B`;
  if (dv >= 1e6)  return `$${(dv / 1e6).toFixed(0)}M`;
  return `$${(dv / 1e3).toFixed(0)}K`;
}

export function HeatmapTable({ tiles, layer, selectedTicker, onSelect, lang }: HeatmapTableProps) {
  const t = makeHeatmapT(lang);
  const zh = lang === "zh";

  const [sortKey, setSortKey] = useState<SortKey>(
    layer === "flow" ? "netPremiumMn" : "chg1d"
  );
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Compute universe avg change for RS column
  const universeAvgChg = useMemo(() => {
    if (tiles.length === 0) return 0;
    return tiles.reduce((s, t) => s + t.chg1d, 0) / tiles.length;
  }, [tiles]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sorted = useMemo(() => {
    return [...tiles].sort((a, b) => {
      let av: number | string = 0;
      let bv: number | string = 0;
      switch (sortKey) {
        case "ticker": av = a.ticker; bv = b.ticker; break;
        case "chg1d": av = a.chg1d; bv = b.chg1d; break;
        case "price": av = a.price; bv = b.price; break;
        case "dolVol":
          av = (a.price ?? 0) * (a.vol ?? 0);
          bv = (b.price ?? 0) * (b.vol ?? 0);
          break;
        case "netPremiumMn": av = a.netPremiumMn ?? -Infinity; bv = b.netPremiumMn ?? -Infinity; break;
        case "doiPc": av = a.doiPc ?? -Infinity; bv = b.doiPc ?? -Infinity; break;
        case "tone": {
          const toneOrder = { pos: 2, neutral: 1, neg: 0 } as Record<string, number>;
          av = toneOrder[a.tone ?? "neutral"] ?? 1;
          bv = toneOrder[b.tone ?? "neutral"] ?? 1;
          break;
        }
        case "divergent": {
          av = isDivergent(a) ? 1 : 0;
          bv = isDivergent(b) ? 1 : 0;
          break;
        }
      }
      if (typeof av === "string" && typeof bv === "string") {
        const cmp = av.localeCompare(bv);
        return sortDir === "asc" ? cmp : -cmp;
      }
      const cmp = (av as number) - (bv as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [tiles, sortKey, sortDir]);

  function Th({ colKey, label, right }: { colKey: SortKey; label: string; right?: boolean }) {
    const active = sortKey === colKey;
    return (
      <th
        onClick={() => handleSort(colKey)}
        style={{
          ...TH_STYLE,
          textAlign: right ? "right" : "left",
          color: active ? "var(--text)" : "var(--muted)",
          cursor: "pointer",
        }}
      >
        {label}
        {active && <span style={{ marginLeft: 3 }}>{sortDir === "asc" ? "▲" : "▼"}</span>}
      </th>
    );
  }

  const priceHeaders = (
    <tr>
      <Th colKey="ticker" label={t("colTicker")} />
      <th style={TH_STYLE}>{zh ? "名称" : "Name"}</th>
      <th style={{ ...TH_STYLE, color: "var(--muted)" }}>{zh ? "板块" : "Sector"}</th>
      <Th colKey="dolVol" label={zh ? "成交额~市值" : "DolVol~Cap"} right />
      <Th colKey="price" label={t("colPrice")} right />
      <Th colKey="chg1d" label={t("colChg")} right />
      <th style={{ ...TH_STYLE, textAlign: "right", color: "var(--muted)", cursor: "default" }}>
        {zh ? "超额" : "RS"}
      </th>
      <th style={{ ...TH_STYLE, textAlign: "right", color: "var(--muted)", cursor: "default" }}>
        {zh ? "成交量" : "Vol"}
      </th>
    </tr>
  );

  const flowHeaders = (
    <tr>
      <Th colKey="ticker" label={t("colTicker")} />
      <th style={TH_STYLE}>{zh ? "名称" : "Name"}</th>
      <Th colKey="netPremiumMn" label={t("colPremium")} right />
      <Th colKey="tone" label={zh ? "倾向(软)" : "Sent.(~soft)"} right />
      <Th colKey="doiPc" label={`${t("colDoi")} (~soft)`} right />
      <th style={{ ...TH_STYLE, textAlign: "right", color: "var(--muted)" }}>{zh ? "板块" : "Sector"}</th>
      <Th colKey="divergent" label={t("colDivergence")} />
    </tr>
  );

  return (
    <div style={TABLE_WRAP}>
      {/* Data note */}
      <div style={DATA_NOTE_BAR}>
        <span>{t("dataNote")}</span>
        {layer === "flow" && (
          <span style={{ marginLeft: 10 }}>{t("flowDirSoft")}</span>
        )}
        {layer === "price" && (
          <span style={{ marginLeft: 10, fontStyle: "italic" }}>
            {zh ? "成交额~市值 = 价格 × 成交量（代理指标）" : "DolVol~Cap = price × vol (proxy, no mcap in manifest yet)"}
          </span>
        )}
      </div>

      <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: "calc(100vh - 320px)" }}>
        <table style={TABLE_STYLE}>
          <thead style={{ position: "sticky", top: 0, background: "#0f1520", zIndex: 10 }}>
            {layer === "flow" ? flowHeaders : priceHeaders}
          </thead>
          <tbody>
            {sorted.map(tile => (
              <TableRow
                key={tile.ticker}
                tile={tile}
                layer={layer}
                isSelected={selectedTicker === tile.ticker}
                onClick={onSelect}
                zh={zh}
                universeAvgChg={universeAvgChg}
              />
            ))}
          </tbody>
        </table>
      </div>

      {sorted.length === 0 && (
        <div style={{ padding: "24px", textAlign: "center", color: "var(--muted)", fontSize: 12 }}>
          {t("noData")}
        </div>
      )}

      <div style={TABLE_FOOTER}>
        {t("displayOnly")}
      </div>
    </div>
  );
}

// ─── TableRow ─────────────────────────────────────────────────────────────────

interface TableRowProps {
  tile: HeatmapTile;
  layer: Layer;
  isSelected: boolean;
  onClick: (tile: HeatmapTile) => void;
  zh: boolean;
  universeAvgChg: number;
}

function TableRow({ tile, layer, isSelected, onClick, zh, universeAvgChg }: TableRowProps) {
  const chgColor = tile.chg1d >= 0 ? "var(--up)" : "var(--down)";
  const chgStr = `${tile.chg1d >= 0 ? "+" : ""}${tile.chg1d.toFixed(2)}%`;
  const sectorLabel = mappedOrNeutral(SECTOR_LABEL[tile.sector], zh ? "zh" : "en");
  const div = layer === "flow" ? isDivergent(tile) : false;

  const toneLabel = tile.tone === "pos" ? (zh ? "+倾向" : "+pos")
    : tile.tone === "neg" ? (zh ? "−倾向" : "−neg")
    : (zh ? "中性" : "neutral");
  const toneColor = tile.tone === "pos" ? "var(--up)"
    : tile.tone === "neg" ? "var(--down)"
    : "var(--muted)";

  // RS: chg vs universe avg
  const rs = tile.chg1d - universeAvgChg;
  const rsStr = `${rs >= 0 ? "+" : ""}${rs.toFixed(2)}`;

  // Sentiment % for flow (tone mapped to score ×100) — drives the tone column.
  const toneScore = tile.tone === "pos" ? 100 : tile.tone === "neg" ? -100 : 0;

  // Row tint: FLOW → signed net premium (log magnitude, matches the treemap);
  // PRICE → 1D %chg. Theme palette from --up-rgb/--down-rgb (flips under red-up)
  // + higher ceiling so rows are visible instead of a near-transparent wall.
  const pal = heatPalette();
  const flowMag = Math.abs(tile.netPremiumMn ?? 0);
  const flowUp = (tile.netPremiumMn ?? 0) >= 0;
  const ci = layer === "flow"
    ? (tile.hasFlow ? Math.min(Math.log10(1 + flowMag) / Math.log10(1 + 250), 1) : 0)
    : Math.min(Math.abs(tile.chg1d) / 6, 1);
  const bgAlpha = (ci * 0.24).toFixed(3);
  const upRgb = pal.up.join(","), dnRgb = pal.down.join(",");
  const bgColor = layer === "flow"
    ? (!tile.hasFlow || flowMag < 0.3 ? "transparent" : (flowUp ? `rgba(${upRgb},${bgAlpha})` : `rgba(${dnRgb},${bgAlpha})`))
    : (tile.chg1d >= 0 ? `rgba(${upRgb},${bgAlpha})` : `rgba(${dnRgb},${bgAlpha})`);

  return (
    <tr
      onClick={() => onClick(tile)}
      style={{
        ...ROW_STYLE,
        background: isSelected ? "var(--panel-2)" : bgColor,
        borderLeft: div ? "2px solid #f59e0b" : "2px solid transparent",
        cursor: "pointer",
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLTableRowElement).style.background = "var(--panel-2)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.background = isSelected ? "var(--panel-2)" : bgColor; }}
    >
      {layer === "flow" ? (
        <>
          <td style={{ ...TD_STYLE, fontWeight: 700 }}>{tile.ticker}</td>
          <td style={{ ...TD_STYLE, color: "var(--text-2)", maxWidth: 90, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {tile.name}
          </td>
          <td style={{ ...TD_STYLE, textAlign: "right", fontWeight: 600, color: "var(--text)" }}>
            {tile.hasFlow && tile.netPremiumMn != null ? `$${tile.netPremiumMn.toFixed(1)}M` : "—"}
          </td>
          <td style={{ ...TD_STYLE, textAlign: "right", fontWeight: 600, color: toneColor }}>
            {tile.hasFlow ? `${toneScore >= 0 ? "+" : ""}${toneScore}%` : "—"}
          </td>
          <td style={{ ...TD_STYLE, textAlign: "right", color: tile.hasFlow && tile.doiPc != null && tile.doiPc > 1 ? "#fbbf24" : "var(--text-2)" }}>
            {tile.hasFlow && tile.doiPc != null ? tile.doiPc.toFixed(2) : "—"}
          </td>
          <td style={{ ...TD_STYLE, color: "var(--muted)", fontSize: 10 }}>{sectorLabel}</td>
          <td style={TD_STYLE}>
            {div ? <span style={DIV_BADGE}>DIV</span> : <span style={{ color: "var(--muted)" }}>—</span>}
          </td>
        </>
      ) : (
        <>
          <td style={{ ...TD_STYLE, fontWeight: 700 }}>{tile.ticker}</td>
          <td style={{ ...TD_STYLE, color: "var(--text-2)", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {tile.name}
          </td>
          <td style={{ ...TD_STYLE, color: "var(--muted)", fontSize: 10 }}>{sectorLabel}</td>
          <td style={{ ...TD_STYLE, textAlign: "right", color: "var(--text-2)", fontVariantNumeric: "tabular-nums" }}>
            {fmtDolVol(tile)}
          </td>
          <td style={{ ...TD_STYLE, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
            ${tile.price.toFixed(2)}
          </td>
          <td style={{ ...TD_STYLE, textAlign: "right", color: chgColor, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
            {chgStr}
          </td>
          <td style={{ ...TD_STYLE, textAlign: "right", fontWeight: 600, color: rs >= 0 ? "var(--up)" : "var(--down)", fontVariantNumeric: "tabular-nums" }}>
            {rsStr}
          </td>
          <td style={{ ...TD_STYLE, textAlign: "right", color: "var(--muted)" }}>
            {tile.vol != null && tile.vol > 0 ? `${(tile.vol / 1e6).toFixed(1)}M` : "—"}
          </td>
        </>
      )}
    </tr>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const TABLE_WRAP: React.CSSProperties = {
  width: "100%",
  height: "100%",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  background: "#0c1018",
};

const DATA_NOTE_BAR: React.CSSProperties = {
  padding: "5px 12px",
  fontSize: 10,
  color: "var(--muted)",
  fontStyle: "italic",
  borderBottom: "1px solid var(--line-2)",
  display: "flex",
  flexWrap: "wrap",
  gap: 4,
  flexShrink: 0,
};

const TABLE_STYLE: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 12,
  fontFamily: "var(--font-ui)",
};

const TH_STYLE: React.CSSProperties = {
  padding: "5px 8px",
  textAlign: "left",
  fontSize: 10,
  fontWeight: 600,
  color: "var(--muted)",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
  whiteSpace: "nowrap",
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};

const ROW_STYLE: React.CSSProperties = {
  borderBottom: "1px solid rgba(255,255,255,0.012)",
  transition: "background 80ms",
};

const TD_STYLE: React.CSSProperties = {
  padding: "4px 8px",
  fontSize: 12,
  color: "var(--text)",
};

const DIV_BADGE: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  background: "rgba(232,179,57,0.15)",
  color: "var(--warn)",
  borderRadius: 3,
  padding: "1px 4px",
};

const TABLE_FOOTER: React.CSSProperties = {
  padding: "5px 12px",
  fontSize: 9,
  color: "var(--muted)",
  fontStyle: "italic",
  textAlign: "center",
  borderTop: "1px solid var(--line-2)",
  flexShrink: 0,
};
