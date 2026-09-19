/**
 * InspectorPane — full field breakdown of a selected flow event.
 * Observatory restyle: obs-card glass shell, lg RingGauge hero, kv-grid,
 * amber obs-note for direction caveat.
 *
 * HONESTY DOCTRINE (unchanged):
 *  - Direction shown as soft "lean" chip only
 *  - Tick-rule caveat in amber obs-note
 *  - No "validated" claims
 *
 * v7b LAYOUT: the identity hero (ticker · contract · premium · ring · tier chip)
 * is PINNED — it sits outside the scroller, so the answer to "what am I looking
 * at" is never scrolled away. Everything below rides a 2-column KV grid at
 * --fs-ui; long-valued fields (group, vol>OI, signing) span both columns rather
 * than truncate. No data field was dropped — only padding was cut.
 */
"use client";
import type React from "react";
import { pick, fmtDate } from "../../lib/finFormat";
import type { Lang } from "../../lib/i18n";
import { FD, getFlowStr, makeFlowT, scoreComponentLabel } from "../../lib/flowdeskStrings";
import { RingGauge } from "../ui/RingGauge";
import type { EnrichEvent, FlowScore } from "./FeedPane";

// ─── Types ────────────────────────────────────────────────────────────────

type Side = "~buy" | "~sell" | "mixed";

interface FlowEvent {
  id: string; ts: string; root: string; group: string; group_zh: string;
  right: "C" | "P"; exp: string; strike: number; dte: number;
  dte_bucket: string; mny_bucket: string; side: Side;
  n_prints: number; size: number; avg_price: number; premium: number;
  premium_z: number | null; baseline_source: string; vol_gt_oi: boolean | null;
  repeated: boolean; zerodte: boolean; signing_source: string; swept?: boolean;
  flowScore?: FlowScore;
}

interface TopContract {
  right: "C" | "P"; exp: string; strike: number; premium: number;
  vol: number; vol_gt_oi: boolean | null; close: number;
}

interface TickerPayload {
  root: string; group: string; group_zh: string;
  day: {
    gross: number; net_soft: number; call_share: number; n_events: number;
    prem_z: number | null; baseline_source: string | null;
  };
  minutes: { t: string; ncp: number; npp: number; vol: number }[];
  strikes: { strike: number; call_prem: number; put_prem: number; vol: number }[];
  expiries: { exp: string; call_prem: number; put_prem: number; vol: number }[];
  top_contracts: TopContract[];
}

export interface InspectorPaneProps {
  event: FlowEvent | null;
  tickerCtx: TickerPayload | null;
  enrichEv: EnrichEvent | null;
  lang: Lang;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function fmtPrem(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function fmtTs(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString("en-US", {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      timeZone: "America/New_York", hour12: false,
    }) + " ET";
  } catch {
    return ts;
  }
}

function fmtExp(exp: string): string {
  return fmtDate(exp, { short: true });
}

function bool3(v: boolean | null | undefined, zh: boolean): string {
  if (v == null) return "—";
  return v ? pick(zh, "Yes", "是") : pick(zh, "No", "否");
}

function sideLean(side: Side, zh: boolean): string {
  if (side === "mixed") return pick(zh, "Mixed", "混合");
  if (side === "~buy")  return pick(zh, "~Buy lean", "~偏多");
  return pick(zh, "~Sell lean", "~偏空");
}

function activityBand(z: number, zh: boolean): string {
  const az = Math.abs(z);
  if (az < 0.75) return pick(zh, "Typical", "正常");
  if (az < 1.5) return pick(zh, "Elevated", "偏高");
  if (az < 2.5) return pick(zh, "Very high", "很高");
  return pick(zh, "Extreme", "极高");
}

function plainBaseline(source: string): string {
  return source
    .replace(/EOD[-\s]?252/gi, "past trading year")
    .replace(/252[-\s]?(session|day|trading day)s?/gi, "past trading year");
}

// ─── Component ────────────────────────────────────────────────────────────

export function InspectorPane({ event, tickerCtx, enrichEv, lang }: InspectorPaneProps) {
  const zh = lang === "zh";

  if (!event) {
    // Blank-until-selection is a real state, so it says what a selection buys you
    // rather than sitting mute.
    return (
      <div className="obs-card obs-fd-inspector" data-tut="flow-inspector" aria-live="polite">
        <div className="obs-insp-empty">
          <span className="obs-lbl obs-insp-empty-title">
            {pick(zh, FD.inspectorEmpty.en, FD.inspectorEmpty.zh)}
          </span>
          <span className="obs-insp-empty-why">
            {pick(zh, FD.inspectorEmptyWhy.en, FD.inspectorEmptyWhy.zh)}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="obs-card obs-fd-inspector has-event" data-tut="flow-inspector">
      {/* Hero is OUTSIDE the scroller — identity stays on screen while the field
          breakdown below scrolls. */}
      <InspectorHero event={event} lang={lang} zh={zh} />
      {/* obs-insp-body is a capped internal scroller so the inspector never
          starves Chain Heat above it in the right rail */}
      <div className="obs-insp-body obs-scroll">
        <EventDetail event={event} zh={zh} lang={lang} tickerCtx={tickerCtx} enrichEv={enrichEv} />
      </div>
    </div>
  );
}

// ─── Hero (pinned) ────────────────────────────────────────────────────────
// Ticker · contract · premium · ring, with the magnitude tier chip at top-right.

function InspectorHero({ event, lang, zh }: { event: FlowEvent; lang: Lang; zh: boolean }) {
  const t = makeFlowT(lang);
  const fs = event.flowScore;
  const score = fs && !isNaN(fs.score) ? fs.score : 0;
  const tier = fs?.tier ?? "LOW";

  return (
    <div className="obs-insp-hero">
      <div className="obs-insp-hero-top">
        <span className="obs-insp-hero-ticker">{event.root}</span>
        <span className="obs-insp-hero-ct num">
          {event.strike}{event.right} · {fmtExp(event.exp)}
        </span>
        {/* Tier chip rides the universal tint formula (--c → text/bg/ring).
            Tones are MAGNITUDE hues, never up/down — a tier is not a direction. */}
        <span
          className="obs-insp-tier obs-tag"
          style={{ "--c": tierTone(tier) } as React.CSSProperties}
        >
          {tierLabel(tier, t)}
        </span>
      </div>
      <div className="obs-insp-hero-main">
        <RingGauge value={score} size="md" tone="auto" />
        <div className="obs-insp-hero-nums">
          <span className="obs-insp-hero-prem num">{fmtPrem(event.premium)}</span>
          <span className="obs-insp-hero-sub num">
            {event.size.toLocaleString()}{pick(zh, " ct", " 张")} · {event.dte}d · {sideLean(event.side, zh)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── EventDetail ──────────────────────────────────────────────────────────

function EventDetail({ event, zh, lang, tickerCtx, enrichEv }: { event: FlowEvent; zh: boolean; lang: Lang; tickerCtx: TickerPayload | null; enrichEv: EnrichEvent | null }) {
  // Score is precomputed server-side and attached to the event (event.flowScore).
  const fs = event.flowScore;
  const components = fs?.components ?? [];
  const t = makeFlowT(lang);

  return (
    <>
      {/* ── Score components — full-width bars, labels wrap instead of truncating ── */}
      <div className="obs-insp-section">
        <div className="obs-insp-section-label obs-lbl">{t("inspectorComponents")}</div>
        <div className="obs-insp-comp-bars">
          {components.map((c) => (
            <ComponentBar key={c.key} component={c} lang={lang} t={t} />
          ))}
        </div>
      </div>

      {/* ── Session context (ticker day roll-up) — shown when tickerCtx available ── */}
      {tickerCtx && (
        <div className="obs-insp-section">
          <div className="obs-insp-section-label obs-lbl">{t("inspectorSessionCtx")}</div>
          <div className="obs-insp-kv2">
            <KV k={pick(zh, "Gross", "总权利金")} v={fmtPrem(tickerCtx.day.gross)} num />
            <KV k={pick(zh, "Call%", "认购%")} v={`${Math.round(tickerCtx.day.call_share * 100)}%`} num />
            <KV k={pick(zh, "Events", "事件数")} v={String(tickerCtx.day.n_events)} num />
            {tickerCtx.day.prem_z != null && (
              <KV k={pick(zh, "Day activity", "当日活跃度")} v={activityBand(tickerCtx.day.prem_z, zh)} />
            )}
          </div>
        </div>
      )}

      {/* ── Direction lean + amber honesty note ── */}
      <div className="obs-insp-dir-block">
        <span className="obs-lbl">{pick(zh, "Direction lean", "方向倾向")}</span>
        <span className="obs-insp-dir-chip">{sideLean(event.side, zh)}</span>
        {enrichEv?.direction_discounted && (
          <span className="obs-insp-dir-caveat">
            {zh ? "（价差 — 方向不可靠）" : "(spread — direction unreliable)"}
          </span>
        )}
      </div>
      <div className="obs-note">{pick(zh, FD.leanHeuristic.en, FD.leanHeuristic.zh)}</div>

      {/* ── Detections section (v2 enrich badges with why strings) ── */}
      {enrichEv && enrichEv.badges.length > 0 && (
        <div className="obs-insp-section">
          <div className="obs-insp-section-label obs-lbl">
            {pick(zh, "Detections", "检测信号")}
          </div>
          {/* Chips wrap in one row instead of one bordered row each — same badges,
              a fraction of the vertical budget. */}
          <div className="obs-insp-det-chips">
            {enrichEv.badges.map((badge) => (
              <span
                key={badge}
                className="obs-tag obs-insp-det-chip"
                style={{ "--c": "var(--brand-2)" } as React.CSSProperties}
              >
                {badge.replace(/_/g, "-")}
              </span>
            ))}
          </div>
          {/* why is a pipe-separated summary string — show once below badge list */}
          {(() => {
            const whyStr = zh ? (enrichEv.why_zh ?? enrichEv.why) : enrichEv.why;
            return whyStr ? (
              <div className="obs-insp-det-why">{whyStr}</div>
            ) : null;
          })()}
        </div>
      )}

      {/* ── Event field breakdown — 2-column KV grid; fields whose VALUE runs long
             (group, vol>OI, signing) span both columns so nothing truncates. ── */}
      <div className="obs-insp-section">
        <div className="obs-insp-section-label obs-lbl">{pick(zh, "Event Fields", "事件字段")}</div>

        <div className="obs-insp-kv2">
          {/* value already carries " ET" — no need to repeat it in the key */}
          <KV k={pick(zh, "Time", "时间")} v={fmtTs(event.ts)} num />
          <KV k={pick(zh, "Ticker", "标的")} v={event.root} />
          <KV k={pick(zh, "Group", "板块")} v={pick(zh, event.group, event.group_zh)} wide />
          <KV k={pick(zh, "Type", "期权类型")} v={event.right === "C" ? pick(zh, "Call", "认购") : pick(zh, "Put", "认沽")} />
          <KV k={pick(zh, "Strike", "行权价")} v={`$${event.strike}`} num />
          <KV k={pick(zh, "Expiry", "到期日")} v={fmtExp(event.exp)} num />
          <KV k={pick(zh, "DTE", "剩余天数")} v={String(event.dte)} num />
          <KV k={pick(zh, "DTE Bucket", "到期分组")} v={event.dte_bucket} />
          <KV k={pick(zh, "Moneyness", "价值类型")} v={event.mny_bucket} />
          <KV k={pick(zh, "Size (ct)", "合约数量")} v={event.size.toLocaleString()} num />
          <KV k={pick(zh, "Avg Price", "均价")} v={`$${event.avg_price.toFixed(2)}`} num />
          <KV k={pick(zh, "Premium", "权利金")} v={fmtPrem(event.premium)} num />
          <KV k={pick(zh, "N Prints", "打印次数")} v={String(event.n_prints)} num />
          <KV k={pick(zh, "Repeated", "重复")} v={bool3(event.repeated, zh)} />
          <KV k={pick(zh, "Zero DTE", "零日到期")} v={bool3(event.zerodte, zh)} />
          {event.swept != null && (
            <KV k={pick(zh, "Swept", "扫货")} v={bool3(event.swept, zh)} />
          )}
          <KV
            k={pick(zh, "Premium activity", "权利金活跃度")}
            v={event.premium_z != null ? activityBand(event.premium_z, zh) : "—"}
            note={plainBaseline(event.baseline_source)}
            wide
          />
          <KV
            k={pick(zh, "Vol > OI", "成交量>持仓")}
            v={event.vol_gt_oi == null
              ? "—"
              : event.vol_gt_oi
                ? getFlowStr(zh ? "zh" : "en", "inspectorVolGtOiYes")
                : getFlowStr(zh ? "zh" : "en", "inspectorVolGtOiNo")}
            wide
          />
          <KV k={pick(zh, "Signing", "签名来源")} v={event.signing_source} wide />
        </div>
      </div>

      {/* ── Ticker context (top contracts) ── */}
      {tickerCtx && tickerCtx.top_contracts.length > 0 && (
        <div className="obs-insp-section">
          <div className="obs-insp-section-label obs-lbl">
            {pick(zh, `${tickerCtx.root} — Top Contracts`, `${tickerCtx.root} — 主要合约`)}
          </div>
          {tickerCtx.top_contracts.slice(0, 5).map((c, i) => (
            <div key={i} className="obs-insp-contract-row">
              <span className="obs-insp-field-key">
                {`${c.right} ${c.strike} ${fmtExp(c.exp)}`}
              </span>
              <span className="obs-insp-field-val num">{fmtPrem(c.premium)}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ─── ComponentBar ─────────────────────────────────────────────────────────

interface ScoreComponent {
  key: string;
  label?: string;
  label_zh?: string;
  value: number;
}

function ComponentBar({ component, lang, t }: {
  component: ScoreComponent;
  lang: Lang;
  t: (k: "cardPenalty") => string;
}) {
  const id = component.key ?? "";
  // The wire payload carries an EN `label` only (lib/flowScore.ts) — re-localise by
  // key so the 中文 view stops leaking English. label_zh is honoured if it ever ships.
  const label = (lang === "zh" && component.label_zh)
    ? component.label_zh
    : scoreComponentLabel(lang, id, component.label);

  const bad = isNaN(component.value);
  // direction-reliability is a NEGATIVE penalty component; a negative CSS width is
  // invalid and silently rendered as a FULL bar before this clamp.
  const neg = !bad && component.value < 0;
  const pct = bad ? 0 : Math.max(0, Math.min(100, component.value));

  return (
    <div className={`obs-insp-crow${neg ? " neg" : ""}`}>
      <span className="obs-insp-crow-label">{label}</span>
      <div className="obs-insp-track">
        <i className="obs-insp-track-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="obs-insp-crow-val num" aria-label={neg ? t("cardPenalty") : undefined}>
        {bad ? "—" : component.value.toFixed(0)}
      </span>
    </div>
  );
}

// ─── KV cell ──────────────────────────────────────────────────────────────
// One key→value pair inside .obs-insp-kv2. `wide` spans both grid columns for
// fields whose value would otherwise be squeezed; `num` opts the value into
// tabular figures.

function KV({ k, v, note, wide, num }: {
  k: string; v: string; note?: string; wide?: boolean; num?: boolean;
}) {
  return (
    <div className={`obs-insp-kv${wide ? " wide" : ""}`}>
      <span className="obs-insp-kv-k">{k}</span>
      <span className={`obs-insp-kv-v${num ? " num" : ""}`}>
        {v}
        {note && <span className="obs-insp-kv-note"> ({note})</span>}
      </span>
    </div>
  );
}

// ─── Tier tone helper ──────────────────────────────────────────────────────
// Magnitude hues only — the tier says how big the event is, never which way it
// points, so --up/--down never appear here. The chip derives text, fill and ring
// from this one token via the .obs-tag tint formula.

function tierTone(tier: string): string {
  if (tier === "ELITE")  return "var(--code-fn)";  // violet accent
  if (tier === "STRONG") return "var(--warn)";
  if (tier === "HIGH")   return "var(--brand-2)";
  if (tier === "MEDIUM") return "var(--text-2)";
  return "var(--muted)";
}

// The tier chip used to print the raw wire token ("ELITE"), which leaked English
// into the 中文 view. Route it through the FLOW_LEX tier entries instead.
function tierLabel(tier: string, t: (k: "tierElite" | "tierStrong" | "tierHigh" | "tierMedium" | "tierLow") => string): string {
  if (tier === "ELITE")  return t("tierElite");
  if (tier === "STRONG") return t("tierStrong");
  if (tier === "HIGH")   return t("tierHigh");
  if (tier === "MEDIUM") return t("tierMedium");
  return t("tierLow");
}
