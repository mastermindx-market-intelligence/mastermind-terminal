"use client";
/**
 * SessionFlowPane — session premium-flow chart from the Tide payload's per-minute series.
 *
 * The Tide feed already carries per-minute CUMULATIVE net call / net put premium
 * (`minutes[].ncp` / `.npp`) that the Tide tab plots as two areas. This pane adds the
 * quanted "Premium Flow / Net Delta — Session" controls the tab lacks:
 *   - side:  C+P | Calls | Puts
 *   - mode:  cumulative | per-min
 *   - off open: rebase to the 9:30 open (Δ since open)
 *   - fill:  filled areas vs lines
 *   - absolute: magnitude comparison
 *
 * All series math is the pure composeSessionSeries (lib/surfaceContract), unit-tested.
 * Sign colors are var(--up)/var(--down) resolved at runtime (East-Asian flip aware) —
 * never a hardcoded hex. Rendered in two homes: the Tide tab's Session sub-view and under
 * the Surface tab's replay scrubber.
 *
 * REPLAY (T-B, whole-workspace time travel). The pane reads the replay position from the
 * workspace bus, so BOTH homes behave identically — including the Tide tab, which sits
 * outside the replay provider's subtree:
 *   - scrubbed back on the live session → the series is CUT at that minute, so the chart and
 *     its running totals show what had accrued by then and nothing after.
 *   - an ARCHIVED session is loaded → the pane withdraws. The per-minute premium tide is a
 *     live-session artifact (live_flow/tide_current.json); no dated copy of it exists, and the
 *     surface store's per-strike netprem carries only the call−put DIFFERENCE, so the two legs
 *     this pane plots cannot be reconstructed for a past day. Truncating TODAY's tide under a
 *     past date's label would be a straightforward lie, so it says what it hasn't got instead.
 *   - no replay mounted anywhere → untouched, exactly as before.
 */

import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  createChart, LineSeries, AreaSeries,
  type IChartApi, type ISeriesApi, type Time,
} from "lightweight-charts";
import { useLang } from "@/lib/i18n";
import {
  composeSessionSeries,
  truncateSessionAt,
  type SessionPoint,
  type SessionMode,
  type SessionSide,
} from "@/lib/surfaceContract";
import { sessionEpoch } from "@/lib/intradayShared";
import { makeSurfaceT } from "./surfaceStrings";
import { useWorkspaceReplay } from "./replayBus";

interface TideMinuteLite { t: string; ncp: number; npp: number }

function css(n: string): string {
  if (typeof document === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(n).trim();
}


function fmtPrem(n: number): string {
  const a = Math.abs(n);
  const amount = a >= 1e9 ? `${(a / 1e9).toFixed(1)}B`
    : a >= 1e6 ? `${(a / 1e6).toFixed(1)}M`
    : a >= 1e3 ? `${(a / 1e3).toFixed(0)}K` : a.toFixed(0);
  // Preserve signed premium, while values that round to zero remain plain $0.
  return `${n < 0 && amount !== "0" ? "−" : ""}$${amount}`;
}

export const SessionFlowPane = memo(function SessionFlowPane({
  minutes, sessionDate, height = 260,
}: {
  minutes: TideMinuteLite[];
  sessionDate?: string;
  height?: number;
}) {
  const { lang } = useLang();
  const t = makeSurfaceT(lang);
  const replay = useWorkspaceReplay();
  // Cut only while the workspace is genuinely scrubbed back on the LIVE session. At the head
  // (or with no replay mounted) the stamp is the newest minute and cutting is a no-op anyway,
  // but keeping the condition explicit means a head-pinned pane never re-derives its series.
  const replayStamp = replay.active && !replay.live && !replay.archived ? replay.asOfStamp : null;

  const [side, setSide] = useState<SessionSide>("cp");
  const [mode, setMode] = useState<SessionMode>("cumulative");
  const [offOpen, setOffOpen] = useState(false);
  const [fill, setFill] = useState(true);
  const [absolute, setAbsolute] = useState(false);

  const wrapRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const callRef = useRef<ISeriesApi<"Line" | "Area"> | null>(null);
  const putRef = useRef<ISeriesApi<"Line" | "Area"> | null>(null);

  // Raw cumulative series from the tide minutes, cut at the replay stamp when scrubbed back.
  // Cutting HERE (before compose + before the totals chips) is what makes the whole pane
  // time-travel: off-open rebasing, per-minute differencing and the running totals all then
  // describe the replayed moment rather than the live one.
  const cumulative: SessionPoint[] = useMemo(
    () => truncateSessionAt(minutes.map((m) => ({ t: m.t, call: m.ncp, put: m.npp })), replayStamp),
    [minutes, replayStamp],
  );

  const series = useMemo(
    () => composeSessionSeries(cumulative, { mode, offOpen, absolute }),
    [cumulative, mode, offOpen, absolute],
  );

  // Chip totals: last cumulative point (raw, not rebased) for an honest running total.
  const totals = useMemo(() => {
    const last = cumulative[cumulative.length - 1];
    return { call: last?.call ?? 0, put: last?.put ?? 0 };
  }, [cumulative]);

  // Rebuild the chart on any data/toggle change (matches TideChart's teardown idiom).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const valid = series.filter((p, i, a) => i === 0 || p.t !== a[i - 1].t);
    if (valid.length < 2) {
      if (chartRef.current) { try { chartRef.current.remove(); } catch {} chartRef.current = null; }
      return;
    }

    const date = sessionDate || new Date().toISOString().slice(0, 10);
    // Display-epoch convention, shared with the surface field and the candle feed (B11) —
    // see lib/intradayShared sessionEpoch. Anchoring to the true UTC instant instead made
    // this pane's axis read 14:00–19:45 for a 09:30–15:45 ET session.
    const toTs = (hhmm: string): Time => sessionEpoch(date, hhmm) as unknown as Time;

    // Directional tokens (East-Asian flip aware) — never a hardcoded direction hex.
    // The area fills need ALPHA, and appending "44"/"05" to the resolved hex only works
    // while --up/--down happen to be 6-digit hex. The RGB triplet tokens are the supported
    // channel for canvas alpha math, so the fills are built from those instead.
    const up = css("--up");
    const down = css("--down");
    const upRgb = css("--up-rgb");
    const downRgb = css("--down-rgb");
    const tint = (rgb: string, a: number) => `rgba(${rgb},${a})`;

    if (chartRef.current) { try { chartRef.current.remove(); } catch {} }
    const chart = createChart(el, {
      width: el.clientWidth || 700,
      height,
      layout: { background: { color: "transparent" }, textColor: css("--muted") || "#868d9c", fontSize: 10, attributionLogo: false },
      grid: {
        vertLines: { color: css("--grid") || "rgba(255,255,255,0.04)" },
        horzLines: { color: css("--grid") || "rgba(255,255,255,0.04)" },
      },
      crosshair: {
        vertLine: { color: "rgba(214,218,227,.3)", labelBackgroundColor: css("--panel-3") || "#1a1d24" },
        horzLine: { color: "rgba(214,218,227,.3)", labelBackgroundColor: css("--panel-3") || "#1a1d24" },
      },
      rightPriceScale: {
        borderColor: css("--line") || "#242832",
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: { borderColor: css("--line") || "#242832", timeVisible: true, secondsVisible: false },
      localization: { priceFormatter: (v: number) => fmtPrem(v) },
    });
    chartRef.current = chart;

    const showCall = side === "cp" || side === "calls";
    const showPut = side === "cp" || side === "puts";

    if (showCall) {
      if (fill) {
        const s = chart.addSeries(AreaSeries, {
          lineColor: up, topColor: tint(upRgb, 0.27), bottomColor: tint(upRgb, 0.02),
          lineWidth: 2 as never, priceLineVisible: false, lastValueVisible: true, title: t("sessionCalls"),
        });
        s.setData(valid.map((p) => ({ time: toTs(p.t), value: p.call })));
        callRef.current = s;
      } else {
        const s = chart.addSeries(LineSeries, {
          color: up, lineWidth: 2 as never, priceLineVisible: false, lastValueVisible: true, title: t("sessionCalls"),
        });
        s.setData(valid.map((p) => ({ time: toTs(p.t), value: p.call })));
        callRef.current = s;
      }
    }
    if (showPut) {
      if (fill) {
        const s = chart.addSeries(AreaSeries, {
          lineColor: down, topColor: tint(downRgb, 0.02), bottomColor: tint(downRgb, 0.27),
          lineWidth: 2 as never, priceLineVisible: false, lastValueVisible: true, title: t("sessionPuts"),
          invertFilledArea: !absolute, // puts are ≤0 (fill downward) unless in absolute mode
        });
        s.setData(valid.map((p) => ({ time: toTs(p.t), value: p.put })));
        putRef.current = s;
      } else {
        const s = chart.addSeries(LineSeries, {
          color: down, lineWidth: 2 as never, priceLineVisible: false, lastValueVisible: true, title: t("sessionPuts"),
        });
        s.setData(valid.map((p) => ({ time: toTs(p.t), value: p.put })));
        putRef.current = s;
      }
    }

    chart.timeScale().fitContent();
    const ro = new ResizeObserver(() => {
      if (el && chartRef.current) chartRef.current.applyOptions({ width: el.clientWidth });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      try { chart.remove(); } catch {}
      chartRef.current = null;
      callRef.current = null;
      putRef.current = null;
    };
    // Archive withdrawal removes the host even when the minute array is unchanged;
    // returning to live must create a chart for the newly mounted host.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, side, fill, absolute, sessionDate, height, lang, replay.archived]);

  const pts = series.length;
  const hasData = pts >= 2;

  // Archived session: withdraw rather than relabel today's tide as another day's.
  // Same idiom as the evolution modal's expiry panel (B4) — name the thing, say why it
  // isn't there, don't leave an empty rectangle.
  if (replay.active && replay.archived) {
    return (
      <div style={PANE}>
        <div style={WITHDRAWN}>
          <div style={WITHDRAWN_HD}>
            {t("sessionArchivedTitle")}
            {replay.sessionDate && (
              <span style={WITHDRAWN_DATE} className="num">{replay.sessionDate}</span>
            )}
          </div>
          <div style={WITHDRAWN_BODY}>{t("sessionArchivedBody")}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={PANE}>
      {/* Controls */}
      <div style={CONTROLS}>
        <div style={GROUP} role="group" aria-label={t("sessionSideAria")}>
          {(["cp", "calls", "puts"] as SessionSide[]).map((s) => (
            <button key={s} className={`obs-chip${side === s ? " on" : ""}`} style={CHIP}
              aria-pressed={side === s} onClick={() => setSide(s)}>
              {s === "cp" ? t("sessionCP") : s === "calls" ? t("sessionCalls") : t("sessionPuts")}
            </button>
          ))}
        </div>
        <div style={GROUP} role="group" aria-label={t("sessionModeAria")}>
          {(["cumulative", "permin"] as SessionMode[]).map((m) => (
            <button key={m} className={`obs-chip${mode === m ? " on" : ""}`} style={CHIP}
              aria-pressed={mode === m} onClick={() => setMode(m)}>
              {m === "cumulative" ? t("sessionCumulative") : t("sessionPerMin")}
            </button>
          ))}
        </div>
        <button className={`obs-chip${offOpen ? " on" : ""}`} style={CHIP}
          aria-pressed={offOpen} onClick={() => setOffOpen((v) => !v)}>
          {t("sessionOffOpen")}
        </button>
        <button className={`obs-chip${fill ? " on" : ""}`} style={CHIP}
          aria-pressed={fill} onClick={() => setFill((v) => !v)}>
          {t("sessionFill")}
        </button>
        <button className={`obs-chip${absolute ? " on" : ""}`} style={CHIP}
          aria-pressed={absolute} onClick={() => setAbsolute((v) => !v)}>
          {t("sessionAbsolute")}
        </button>

        {/* Running totals — the tint formula on one variable, label as a micro-label and
            the figure tabular. Direction rides --up/--down, so east-mode flips both. */}
        <div style={TOTALS}>
          <span className="obs-tag" style={{ "--c": "var(--up)" } as React.CSSProperties}>
            <span className="obs-lbl" style={TOTAL_LBL}>{t("sessionCallsChip")}</span>
            <b className="num" style={TOTAL_VAL}>{fmtPrem(totals.call)}</b>
          </span>
          <span className="obs-tag" style={{ "--c": "var(--down)" } as React.CSSProperties}>
            <span className="obs-lbl" style={TOTAL_LBL}>{t("sessionPutsChip")}</span>
            <b className="num" style={TOTAL_VAL}>{fmtPrem(totals.put)}</b>
          </span>
        </div>
      </div>

      {/* Chart */}
      <div style={{ position: "relative", flex: 1, minHeight: height }}>
        <div ref={wrapRef} style={{ width: "100%", height }} />
        {/* Honest empty: the tide is accruing, and the reason it can't draw yet is stated. */}
        {!hasData && (
          <div style={EMPTY}>
            <span style={EMPTY_TITLE}>{t("sessionEmpty")}</span>
            <span style={EMPTY_WHY}>{t("sessionEmptyWhy")}</span>
          </div>
        )}
      </div>

      {/* Provenance row: source · window · replay basis · sample count */}
      <div className="obs-asof" style={FOOTNOTE}>
        {/* The dot claims "live" only when the pane is genuinely on the present: the bus's
            idle snapshot is live:true, a scrubbed-back or archived position is not. */}
        {replay.live && <span className="dot" aria-hidden />}
        <span>{t("sourceTide")}</span>
        <span style={{ color: "var(--muted)" }}>· {t("sessionFootnote")}</span>
        {offOpen && <span style={{ color: "var(--muted)" }}>· {t("sessionOffOpenNote")}</span>}
        {replayStamp && (
          <span style={{ color: "var(--signal)" }}>
            · {t("sessionReplayNote")} {replayStamp.slice(0, 2)}:{replayStamp.slice(2, 4)}
          </span>
        )}
        <span style={{ color: "var(--muted)" }}>· <span className="num">{pts}</span> {t("sessionPts")}</span>
      </div>
    </div>
  );
});

// ─── Styles ───────────────────────────────────────────────────────────────────

const PANE: React.CSSProperties = { display: "flex", flexDirection: "column", gap: "var(--sp-2)" };

const CONTROLS: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: "var(--sp-2)", flexWrap: "wrap",
};

const GROUP: React.CSSProperties = { display: "flex", gap: "var(--sp-1)" };

const CHIP: React.CSSProperties = {
  height: 28, fontSize: "var(--fs-label)", fontWeight: 600, padding: "0 var(--sp-3)",
};

const TOTALS: React.CSSProperties = {
  marginLeft: "auto", display: "flex", alignItems: "center", gap: "var(--sp-2)",
};

const TOTAL_LBL: React.CSSProperties = { color: "inherit", opacity: 0.75 };

const TOTAL_VAL: React.CSSProperties = {
  fontFamily: "var(--font-num)", fontVariantNumeric: "tabular-nums",
  fontSize: "var(--fs-label)", fontWeight: 700,
};

const EMPTY: React.CSSProperties = {
  position: "absolute", inset: 0,
  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
  gap: "var(--sp-1)", padding: "0 var(--sp-5)", textAlign: "center", pointerEvents: "none",
};

const EMPTY_TITLE: React.CSSProperties = {
  fontSize: "var(--fs-body)", fontWeight: 600, color: "var(--text-2)",
};

const EMPTY_WHY: React.CSSProperties = {
  fontSize: "var(--fs-label)", lineHeight: 1.5, color: "var(--muted)", maxWidth: 400,
};

/** Provenance row — .obs-asof owns the type; margin is zeroed because the pane already
 *  has its own vertical rhythm. The font shorthand in .obs-asof resets numeric variants,
 *  so tabular-nums is re-declared here (doctrine law 1). */
const FOOTNOTE: React.CSSProperties = {
  marginTop: 0, flexWrap: "wrap", gap: "var(--sp-1)",
  fontVariantNumeric: "tabular-nums",
};

const WITHDRAWN: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: "var(--sp-2)",
  padding: "var(--sp-4)",
  border: "1px dashed var(--line)", borderRadius: "var(--r-tile)",
  background: "var(--inset)",
};

const WITHDRAWN_HD: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: "var(--sp-2)", flexWrap: "wrap",
  fontSize: "var(--fs-body)", fontWeight: 700, color: "var(--text)",
};

const WITHDRAWN_DATE: React.CSSProperties = {
  fontSize: "var(--fs-micro)", fontWeight: 700, color: "var(--muted)",
  padding: "2px 6px", border: "1px solid var(--line)", borderRadius: 5,
  fontFamily: "var(--font-num)", fontVariantNumeric: "tabular-nums",
};

const WITHDRAWN_BODY: React.CSSProperties = {
  fontSize: "var(--fs-label)", lineHeight: 1.55, color: "var(--text-2)", maxWidth: 620,
};
