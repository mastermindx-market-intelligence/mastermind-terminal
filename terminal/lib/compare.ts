// Compare-overlay colour palette: distinct, legible line colours handed out in order as symbols
// are added. Consumed by TerminalShell, SearchModal, and ChartPanel.
// SYNC: these six values are mirrored as --cat-1..--cat-6 in app/globals.css :root — keep in sync.
export const CMP_PALETTE = ["#e8a33d", "#9d86ff", "#19c2c2", "#f06bd0", "#4d82ff", "#26c281"];

// Compare mode and configuration — per-symbol settings for price/percent mode, color, line style, width.
export type CmpMode = "percent" | "price";
export interface CmpCfg {
  color: string; lineStyle: number; lineWidth: number; mode: CmpMode;
  /** Pinned rebasing reference (YYYY-MM-DD). Absent = the legacy "auto" anchor: this leg's first
   *  session in common with the host, disclosed as such (lib/compareAnchor.ts). Additive and
   *  optional so every layout saved before E08 keeps its mode, style, and values. */
  anchor?: string;
  /** How `anchor` was chosen: an explicit date, or the visible window start captured ONCE when the
   *  user pinned it. The captured date is persisted — never the policy — so scrolling the chart
   *  later can never move a pinned study. */
  anchorSrc?: CmpAnchorSrc;
}
export type CmpAnchorSrc = "date" | "window";
export const CMP_LINE_STYLES: { v: number; label: string }[] = [ { v: 0, label: "Solid" }, { v: 2, label: "Dashed" }, { v: 1, label: "Dotted" } ];
export function defaultCmpCfg(idx: number, mode: CmpMode = "percent"): CmpCfg { return { color: CMP_PALETTE[idx % CMP_PALETTE.length], lineStyle: 0, lineWidth: 2, mode }; }
export const cmpKey = (sym: string) => "cmp:" + sym;
export const isCmpKey = (k: string) => k.startsWith("cmp:");
export const cmpSymOf = (k: string) => k.slice(4);
