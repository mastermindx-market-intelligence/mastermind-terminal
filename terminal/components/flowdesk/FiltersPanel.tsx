"use client";
/**
 * FiltersPanel — controlled filter bar for the Flow Desk center feed.
 *
 * All state lives in the parent (FeedPane). Props-driven, no internal state.
 * Matches fin.css / globals.css design tokens — no hardcoded colors.
 *
 * HONESTY DOCTRINE: "lean" is a soft tick-rule derivation; we do NOT offer a
 * directional green/red filter gate labeled "buy" / "sell" — the lean filter
 * uses flowSideLabel ("Likely buying" / "偏买入"), never the raw ~buy token.
 */

import { pick } from "@/lib/finFormat";
import { FD } from "@/lib/flowdeskStrings";
import { flowSideLabel } from "@/lib/plainLabels";
import type { DteBucket, MnyBucket, Side } from "./FeedPane";

// ── Filter shape ─────────────────────────────────────────────────────────────

/** v1 legacy badge flags (client-derived) */
export type LegacyBadgeFlag =
  | "whale"
  | "cluster"
  | "sweep"
  | "unusual"
  | "block";

/** v2 detection badge flags (from enrich artifact) */
export type DetectionFlag =
  | "MULTI_LEG"
  | "LADDER"
  | "REPEAT_HITTER"
  | "SIZE_VS_OI"
  | "WHALE"
  | "FRESH"
  | "Z_OUTLIER";

export type BadgeFlag = LegacyBadgeFlag | DetectionFlag;

export interface FlowFilters {
  /** C / P / "all" */
  right: "C" | "P" | "all";
  /** soft lean filter — "all" passes everything */
  lean: Side | "all";
  /** minimum flow score (0 = no filter) */
  minScore: 0 | 50 | 60 | 70 | 80 | 90;
  /** minimum premium in USD (0 = no filter) */
  minPremium: number;
  /** DTE bucket whitelist — empty = all */
  dteBuckets: DteBucket[];
  /** moneyness bucket whitelist — empty = all */
  mnyBuckets: MnyBucket[];
  /** v1 badge presence flags — only show events that have ALL checked badges */
  badges: Set<BadgeFlag>;
  /** v2 detection badge filter — show only events with ANY of these detections */
  detections: Set<DetectionFlag>;
}

export const DEFAULT_FILTERS: FlowFilters = {
  right: "all",
  lean: "all",
  minScore: 0,
  minPremium: 0,
  dteBuckets: [],
  mnyBuckets: [],
  badges: new Set(),
  detections: new Set(),
};

// ── Props ────────────────────────────────────────────────────────────────────

interface FiltersPanelProps {
  filters: FlowFilters;
  onFiltersChange: (next: FlowFilters) => void;
  lang: "en" | "zh";
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const DTE_OPTIONS: { key: DteBucket; label: string; zh: string }[] = [
  { key: "0d",     label: "0DTE",   zh: "当日到期" },
  { key: "1_7d",   label: "1–7d",   zh: "1–7天" },
  { key: "8_30d",  label: "8–30d",  zh: "8–30天" },
  { key: "31_90d", label: "31–90d", zh: "31–90天" },
  { key: "90p",    label: "90d+",   zh: "90天以上" },
];

const MNY_OPTIONS: { key: MnyBucket; label: string; zh: string }[] = [
  { key: "itm",      label: "ITM",      zh: "实值" },
  { key: "atm",      label: "ATM",      zh: "平值" },
  { key: "near_otm", label: "Near OTM", zh: "近虚值" },
  { key: "far_otm",  label: "Far OTM",  zh: "深虚值" },
];

const SCORE_OPTIONS: { v: FlowFilters["minScore"]; label: string; zh: string }[] = [
  { v: 0,  label: "Any",       zh: "不限" },
  { v: 50, label: "50+",       zh: "50+" },
  { v: 60, label: "60+",       zh: "60+" },
  { v: 70, label: "70+",       zh: "70+" },
  { v: 80, label: "80+",       zh: "80+" },
  { v: 90, label: "90+ Elite", zh: "90+ 顶级" },
];

const PREMIUM_OPTIONS: { v: number; label: string; zh: string }[] = [
  { v: 0,       label: "Any",  zh: "不限" },
  { v: 100_000, label: "$100K+", zh: "$10万+" },
  { v: 250_000, label: "$250K+", zh: "$25万+" },
  { v: 500_000, label: "$500K+", zh: "$50万+" },
  { v: 1_000_000, label: "$1M+", zh: "$100万+" },
];

/** Bilingual tip pair — EN text unchanged from v1; zh added so the accessible
 *  label never leaks English into the 中文 view. */
type TipPair = { en: string; zh: string };

const BADGE_OPTIONS: { key: BadgeFlag; label: string; zh: string; tip: TipPair }[] = [
  {
    key: "whale",
    label: "Whale",
    zh: "巨单",
    tip: FD.filterTipWhale,
  },
  {
    key: "cluster",
    label: "Cluster",
    zh: "集群",
    tip: FD.filterTipCluster,
  },
  {
    key: "sweep",
    label: "Sweep",
    zh: "扫单",
    tip: FD.filterTipSweep,
  },
  {
    key: "unusual",
    label: "Unusual",
    zh: "异常",
    tip: FD.filterTipUnusual,
  },
  {
    key: "block",
    label: "Block",
    zh: "大宗",
    tip: FD.filterTipBlock,
  },
];

/** v2 detection badge filter options (from enrich artifact) */
const DETECTION_OPTIONS: { key: DetectionFlag; label: string; zh: string; tip: TipPair }[] = [
  {
    key: "WHALE",
    label: "Whale",
    zh: "巨单",
    tip: FD.detTipWhale,
  },
  {
    key: "MULTI_LEG",
    label: "Multi-leg",
    zh: "多腿策略",
    tip: FD.detTipMultiLeg,
  },
  {
    key: "LADDER",
    label: "Ladder",
    zh: "梯形布局",
    tip: FD.detTipLadder,
  },
  {
    key: "REPEAT_HITTER",
    label: "Repeat",
    zh: "反复加仓",
    tip: FD.detTipRepeat,
  },
  {
    key: "SIZE_VS_OI",
    label: "Size>OI",
    zh: "量超持仓",
    tip: FD.detTipSizeVsOi,
  },
  {
    key: "FRESH",
    label: "Fresh",
    zh: "新建仓",
    tip: FD.detTipFresh,
  },
  {
    key: "Z_OUTLIER",
    label: "Activity spike",
    zh: "活跃度飙升",
    tip: FD.detTipZOutlier,
  },
];

// ── Component ────────────────────────────────────────────────────────────────

export function FiltersPanel({ filters, onFiltersChange, lang }: FiltersPanelProps) {
  const zh = lang === "zh";

  function patch(partial: Partial<FlowFilters>) {
    onFiltersChange({ ...filters, ...partial });
  }

  function toggleDte(key: DteBucket) {
    const s = new Set(filters.dteBuckets);
    s.has(key) ? s.delete(key) : s.add(key);
    patch({ dteBuckets: [...s] });
  }

  function toggleMny(key: MnyBucket) {
    const s = new Set(filters.mnyBuckets);
    s.has(key) ? s.delete(key) : s.add(key);
    patch({ mnyBuckets: [...s] });
  }

  function toggleBadge(key: BadgeFlag) {
    const s = new Set(filters.badges);
    s.has(key) ? s.delete(key) : s.add(key);
    patch({ badges: s });
  }

  function toggleDetection(key: DetectionFlag) {
    const s = new Set(filters.detections);
    s.has(key) ? s.delete(key) : s.add(key);
    patch({ detections: s });
  }

  const isDirty =
    filters.right !== "all" ||
    filters.lean !== "all" ||
    filters.minScore !== 0 ||
    filters.minPremium !== 0 ||
    filters.dteBuckets.length > 0 ||
    filters.mnyBuckets.length > 0 ||
    filters.badges.size > 0 ||
    filters.detections.size > 0;

  return (
    <div style={PANEL_STYLE} data-tut="flow-filter-panel">
      {/* ── Type ── */}
      <FilterRow label={zh ? "类型" : "Type"}>
        <div className="fin-toggle">
          {(["all", "C", "P"] as const).map((v) => (
            <button
              key={v}
              className={filters.right === v ? "on" : ""}
              onClick={() => patch({ right: v })}
            >
              {v === "all" ? (zh ? "全部" : "All") : v === "C" ? (zh ? "认购" : "Call") : (zh ? "认沽" : "Put")}
            </button>
          ))}
        </div>
      </FilterRow>

      {/* ── Lean (soft direction) ── */}
      <FilterRow label={zh ? "倾向" : "Lean"}>
        <div className="fin-toggle">
          {([
            { v: "all" as const },
            { v: "~buy" as const },
            { v: "~sell" as const },
            { v: "mixed" as const },
          ]).map(({ v }) => (
            <button
              key={v}
              className={filters.lean === v ? "on" : ""}
              onClick={() => patch({ lean: v as Side | "all" })}
            >
              {v === "all" ? (zh ? "全部" : "All") : flowSideLabel(v, lang)}
            </button>
          ))}
        </div>
        {/* Honesty note: lean is tick-rule derived, not NBBO-verified */}
        <div style={CAVEAT_STYLE}>
          {pick(zh, FD.leanHeuristic.en, FD.leanHeuristic.zh)}
        </div>
      </FilterRow>

      {/* ── Min Score ── */}
      <FilterRow label={zh ? "最低评分" : "Min score"}>
        <div className="fin-toggle">
          {SCORE_OPTIONS.map(({ v, label, zh: zl }) => (
            <button
              key={v}
              className={filters.minScore === v ? "on" : ""}
              onClick={() => patch({ minScore: v })}
            >
              {pick(zh, label, zl)}
            </button>
          ))}
        </div>
      </FilterRow>

      {/* ── Min Premium ── */}
      <FilterRow label={zh ? "最低权利金" : "Min premium"}>
        <div className="fin-toggle">
          {PREMIUM_OPTIONS.map(({ v, label, zh: zl }) => (
            <button
              key={v}
              className={filters.minPremium === v ? "on" : ""}
              onClick={() => patch({ minPremium: v })}
            >
              {zh ? zl : label}
            </button>
          ))}
        </div>
      </FilterRow>

      {/* ── DTE Buckets ── */}
      <FilterRow label={zh ? "到期天数" : "DTE"}>
        <div style={CHIP_ROW_STYLE}>
          {DTE_OPTIONS.map(({ key, label, zh: zl }) => {
            const on = filters.dteBuckets.includes(key);
            return (
              <button
                key={key}
                onClick={() => toggleDte(key)}
                className={`obs-chip${on ? " on" : ""}`}
                aria-pressed={on}
              >
                {pick(zh, label, zl)}
              </button>
            );
          })}
        </div>
        {filters.dteBuckets.length === 0 && (
          <div style={CAVEAT_STYLE}>{pick(zh, FD.allExpirations.en, FD.allExpirations.zh)}</div>
        )}
      </FilterRow>

      {/* ── Moneyness ── */}
      <FilterRow label={zh ? "价性" : "Moneyness"}>
        <div style={CHIP_ROW_STYLE}>
          {MNY_OPTIONS.map(({ key, label, zh: zl }) => {
            const on = filters.mnyBuckets.includes(key);
            return (
              <button
                key={key}
                onClick={() => toggleMny(key)}
                className={`obs-chip${on ? " on" : ""}`}
                aria-pressed={on}
              >
                {zh ? zl : label}
              </button>
            );
          })}
        </div>
      </FilterRow>

      {/* ── Badge Flags ── */}
      <FilterRow label={zh ? "标记" : "Badges"}>
        <div style={CHIP_ROW_STYLE}>
          {BADGE_OPTIONS.map(({ key, label, zh: zl, tip }) => {
            const on = filters.badges.has(key);
            const tipStr = pick(zh, tip.en, tip.zh);
            return (
              <button
                key={key}
                onClick={() => toggleBadge(key)}
                className={`obs-chip${on ? " on" : ""}`}
                aria-pressed={on}
                aria-label={tipStr}
                data-tip={tipStr}
              >
                {zh ? zl : label}
              </button>
            );
          })}
        </div>
        <div style={CAVEAT_STYLE}>
          {pick(zh, FD.sweepHeuristic.en, FD.sweepHeuristic.zh)}
        </div>
      </FilterRow>

      {/* ── Detections filter lens (v2 enrich badges) ── */}
      <FilterRow label={zh ? "检测信号" : "Detections"}>
        <div style={CHIP_ROW_STYLE}>
          {DETECTION_OPTIONS.map(({ key, label, zh: zl, tip }) => {
            const on = filters.detections.has(key);
            const tipStr = pick(zh, tip.en, tip.zh);
            return (
              <button
                key={key}
                onClick={() => toggleDetection(key)}
                className={`obs-chip${on ? " on" : ""}`}
                aria-pressed={on}
                aria-label={tipStr}
                data-tip={tipStr}
              >
                {zh ? zl : label}
              </button>
            );
          })}
        </div>
        <div style={CAVEAT_STYLE}>
          {pick(zh, FD.detectionsCaveat.en, FD.detectionsCaveat.zh)}
        </div>
      </FilterRow>

      {/* ── Reset ── */}
      {isDirty && (
        <div style={{ marginTop: "var(--sp-2)" }}>
          <button
            className="fin-pill"
            onClick={() => onFiltersChange({ ...DEFAULT_FILTERS, badges: new Set(), detections: new Set() })}
            style={{ fontSize: "var(--fs-label)" }}
          >
            {pick(zh, FD.resetFilters.en, FD.resetFilters.zh)}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Sub-layout ────────────────────────────────────────────────────────────────

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={ROW_STYLE}>
      <div className="obs-lbl">{label}</div>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

// ── Styles (inline — chips/labels ride the .obs-* primitives) ────────────────

const PANEL_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--sp-3)",
  padding: "var(--sp-3)",
  background: "var(--panel)",
  borderBottom: "1px solid var(--line)",
};

const ROW_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--sp-2)",
};

const CAVEAT_STYLE: React.CSSProperties = {
  font: "500 var(--fs-micro)/1.35 var(--font-ui)",
  color: "var(--text-dim)",
  marginTop: "var(--sp-1)",
};

const CHIP_ROW_STYLE: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--sp-1)",
};
