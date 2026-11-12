/**
 * RadarStrip — Smart Money Radar.
 * Observatory restyle: obs-card glass panel, obs-lbl micro-labels.
 */
"use client";
import { useMemo } from "react";
import { activityBarWidth, dailyActivityNote, signedActivityLabel } from "../../lib/flowActivity";
import type React from "react";
import { pick } from "../../lib/finFormat";
import type { Lang } from "../../lib/i18n";
import { FD } from "../../lib/flowdeskStrings";
import { Tip } from "../ui/Tip";

// ─── Types ────────────────────────────────────────────────────────────────

interface UnusualName {
  root: string;
  group: string;
  group_zh: string;
  gross_premium_today: number;
  prem_z: number | null;
  baseline_source: string;
  n_obs: number;
  call_prem_share: number;
  top_contracts: { right: "C" | "P"; exp: string; strike: number; premium: number }[];
}

interface FeedPayload {
  unusual_names: UnusualName[];
  baseline_note?: { en: string; zh: string };
}

export interface RadarStripProps {
  feed: FeedPayload;
  lang: Lang;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function fmtPrem(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

/** z-score → magnitude accent color (no buy/sell). */
function zAccent(z: number | null): string {
  if (z == null) return "var(--text-2)";
  if (z >= 3.5) return "var(--signal)";
  if (z >= 2.5) return "var(--text)";
  return "var(--text-2)";
}

/** Bar width capped at z=5 for visual scale. */
function zBarWidth(z: number | null): number {
  return activityBarWidth(z);
}

/** Turn the statistical score into a signed, glanceable activity label. */
function activityBand(z: number | null, zh: boolean): string {
  return signedActivityLabel(z, zh ? "zh" : "en");
}

/** Payloads still carry an engine name; the UI explains it as a familiar time span. */
function readableBaseline(note: string): string {
  return note
    .replace(/EOD[-\s]?252/gi, "1-year")
    .replace(/252[-\s]?(session|day|trading day)s?/gi, "1-year")
    .replace(/\beod252\b/gi, "1-year");
}

const MAX_ROWS = 8;

/** Hairline magnitude track under each ticker — neutral line token, never a
 *  direction color (the fill's accent is a magnitude hue from zAccent). */
const BAR_TRACK: React.CSSProperties = {
  height: 2,
  background: "var(--line)",
  borderRadius: "var(--r-pill)",
  marginTop: "var(--sp-1)",
  overflow: "hidden",
  width: "100%",
};

// ─── Component ────────────────────────────────────────────────────────────

export function RadarStrip({ feed, lang }: RadarStripProps) {
  const zh = lang === "zh";

  const rows = useMemo(() => {
    return [...feed.unusual_names]
      .sort((a, b) => {
        const az = a.prem_z ?? -Infinity;
        const bz = b.prem_z ?? -Infinity;
        return bz - az;
      })
      .slice(0, MAX_ROWS);
  }, [feed.unusual_names]);

  const rawNote = feed.baseline_note
    ? pick(zh, feed.baseline_note.en, feed.baseline_note.zh)
    : pick(zh, FD.radarBaseline.en, FD.radarBaseline.zh);
  const note = zh ? rawNote : readableBaseline(rawNote);

  return (
    <section
      className="obs-card obs-fd-radar obs-scroll"
      data-tut="flow-radar"
      style={{ borderRadius: 0, border: "none", borderBottom: "1px solid var(--line)" }}
    >
      {/* Header */}
      <div className="obs-card-hd">
        <span className="obs-lbl">{pick(zh, FD.smartMoneyRadar.en, FD.smartMoneyRadar.zh)}</span>
        <span className="obs-fd-radar-note">{note}</span>
      </div>

      {/* Column headers */}
      <div className="obs-fd-radar-col-head obs-lbl">
        <span>{pick(zh, "Ticker", "标的")}</span>
        <Tip label={dailyActivityNote(zh ? "zh" : "en")} side="top" size="card">
          <span style={{ textAlign: "right", cursor: "help" }}>{pick(zh, "Activity", "活跃度")}</span>
        </Tip>
        <Tip label={pick(zh, "Gross options premium traded today (calls + puts)", "今日期权总权利金（认购+认沽）")} side="top" size="card">
          <span style={{ textAlign: "right", cursor: "help" }}>{pick(zh, "Premium", "权利金")}</span>
        </Tip>
        <Tip label={pick(zh, "Call premium as a share of total (call + put) premium", "认购权利金占总权利金（认购+认沽）的比例")} side="top" size="card">
          <span style={{ textAlign: "right", cursor: "help" }}>{pick(zh, "Calls", "认购")}</span>
        </Tip>
      </div>

      {/* Rows — the empty state names the reason instead of a bare "no data" */}
      {rows.length === 0 && (
        <div className="fin-empty" style={{ margin: "var(--sp-3)", flexDirection: "column", gap: "var(--sp-1)" }}>
          <span className="fin-empty-title">{pick(zh, FD.radarEmpty.en, FD.radarEmpty.zh)}</span>
          <span className="fin-empty-why">{pick(zh, FD.radarEmptyWhy.en, FD.radarEmptyWhy.zh)}</span>
        </div>
      )}

      <div className="obs-fd-radar-rows obs-scroll">
        {rows.map((row) => <RadarRow key={row.root} row={row} zh={zh} />)}
      </div>
    </section>
  );
}

// ─── RadarRow ─────────────────────────────────────────────────────────────

function RadarRow({ row, zh }: { row: UnusualName; zh: boolean }) {
  const accent = zAccent(row.prem_z);
  const barW = zBarWidth(row.prem_z);
  const callPct = Math.round(row.call_prem_share * 100);
  const group = pick(zh, row.group, row.group_zh);

  return (
    <div className="obs-fd-radar-row">
      {/* Ticker + group */}
      <div className="obs-fd-radar-name">
        <div className="obs-fd-radar-ticker">{row.root}</div>
        <div className="obs-fd-radar-group">
          {group}
        </div>
        {/* Magnitude bar */}
        <div style={BAR_TRACK}>
          <div style={{ height: "100%", borderRadius: "var(--r-pill)", background: accent, width: `${barW}%` }} />
        </div>
      </div>

      {/* Human-readable unusualness band; exact z remains in the accessible label. */}
      <div className="obs-fd-radar-z" style={{ color: accent }}>
        <Tip
          label={row.prem_z != null && Number.isFinite(row.prem_z)
            ? pick(zh, `${row.prem_z.toFixed(1)} standard deviations from its full-day 252-session average; negative means below avg`, `相对全天252个交易日均值偏离 ${row.prem_z.toFixed(1)} 个标准差；负值为低于均值`)
            : pick(zh, "Activity unavailable: no session premium z yet", "暂无当日权利金活跃度数据")}
          side="top"
          size="card"
        >
          <span style={{ cursor: "help" }}>{activityBand(row.prem_z, zh)}</span>
        </Tip>
      </div>

      {/* Gross premium */}
      <div className="obs-fd-radar-prem">{fmtPrem(row.gross_premium_today)}</div>

      {/* Call share */}
      <div className="obs-fd-radar-call">
        {callPct}%
      </div>
    </div>
  );
}
