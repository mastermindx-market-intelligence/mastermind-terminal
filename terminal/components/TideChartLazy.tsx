"use client";
/**
 * TideChart — intraday NCP/NPP area pair (+ optional SPY line overlay) on
 * lightweight-charts.
 *
 * Lives in its own module ON PURPOSE: it is the ONLY consumer of
 * `lightweight-charts` in the options hub, and the hub's default surface is the
 * Tape. Keeping it here lets OptionsHubView pull it through `next/dynamic`, so
 * the ~130 KB chart engine chunk never lands on the tape's critical path — it
 * downloads the first time someone opens the Tide tab, exactly like the six
 * desk sub-views.
 *
 * Moved out of components/OptionsHubView.tsx verbatim (v7b perf wave): the
 * chart body, the token reader and the ET-offset helper are unchanged.
 */
import { memo, useEffect, useRef } from "react";
import {
  createChart, LineSeries, AreaSeries,
  type IChartApi, type ISeriesApi,
} from "lightweight-charts";

export interface TideMinutePoint { t: string; ncp: number; npp: number; gross: number; vol: number }
export interface TideSpyPoint { t: string; px: number }

export interface TideChartProps {
  minutes: TideMinutePoint[];
  spy: TideSpyPoint[];
  height: number;
  sessionDate?: string;
}

/** Read a design token off the document root (dark-only terminal). */
function css(n: string): string {
  if (typeof document === "undefined") return "#888";
  return getComputedStyle(document.documentElement).getPropertyValue(n).trim();
}

/**
 * US-Eastern UTC offset (in hours, negative) for a given YYYY-MM-DD date.
 * DST-aware — computes the actual America/New_York offset via Intl instead of
 * hardcoding -04:00. Returns "-04:00" (EDT) or "-05:00" (EST) as a fixed-offset
 * suffix usable in an ISO timestamp string.
 */
function etOffsetSuffix(sessionDate: string): string {
  try {
    // Noon on the session date sidesteps DST-boundary edge cases at midnight.
    const noonUtc = new Date(`${sessionDate}T12:00:00Z`);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", hour12: false, timeZoneName: "shortOffset",
    }).formatToParts(noonUtc);
    const tzName = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
    // tzName looks like "GMT-4" / "GMT-5"; normalize to "-0H:00".
    const m = tzName.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
    if (m) {
      const sign = m[1];
      const hh = m[2].padStart(2, "0");
      const mm = m[3] ?? "00";
      return `${sign}${hh}:${mm}`;
    }
  } catch {}
  return "-04:00"; // EDT fallback
}

const easternTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
function tideTimeLabel(time: unknown): string {
  return typeof time === "number" ? easternTime.format(time * 1000) : "";
}

const TideChart = memo(function TideChart({ minutes, spy, height, sessionDate }: TideChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const ncpRef = useRef<ISeriesApi<"Area"> | null>(null);
  const nppRef = useRef<ISeriesApi<"Area"> | null>(null);
  const spyRef = useRef<ISeriesApi<"Line"> | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Unique x-axis: use integer index mapped to time string for intraday minute series
    // LWC v5 requires time in ascending order with no duplicates.
    const validMins = minutes.filter(
      (m, i, arr) => i === 0 || m.t !== arr[i - 1].t
    );
    if (validMins.length < 2) return;

    // Convert "HH:MM" to seconds-from-epoch for LWC. Anchor to the payload's
    // session_date with the DST-aware US-Eastern offset for that date.
    const date = sessionDate || new Date().toISOString().slice(0, 10);
    const etOff = etOffsetSuffix(date);
    const toTs = (hhmm: string) => {
      const [hh, mm] = hhmm.split(":").map(Number);
      return Math.floor(new Date(`${date}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00${etOff}`).getTime() / 1000);
    };

    const upColor = css("--up");
    const downColor = css("--down");
    const gridColor = css("--grid");
    const lineColor = css("--line");
    const textColor = css("--muted");
    const panel3 = css("--panel-3");
    const warnColor = css("--warn");

    if (chartRef.current) {
      try { chartRef.current.remove(); } catch {}
    }

    const chart = createChart(el, {
      width: el.clientWidth || 700,
      height: height,
      layout: {
        background: { color: "transparent" },
        textColor,
        fontSize: 10,
        attributionLogo: false,
      },
      grid: { vertLines: { color: gridColor }, horzLines: { color: gridColor } },
      crosshair: {
        vertLine: { color: "rgba(214,218,227,.3)", labelBackgroundColor: panel3 },
        horzLine: { color: "rgba(214,218,227,.3)", labelBackgroundColor: panel3 },
      },
      rightPriceScale: { borderColor: lineColor, scaleMargins: { top: 0.05, bottom: 0.05 } },
      localization: { timeFormatter: (time: unknown) => `${tideTimeLabel(time)} ET` },
      timeScale: { borderColor: lineColor, timeVisible: true, secondsVisible: false, tickMarkFormatter: tideTimeLabel },
    });
    chartRef.current = chart;

    const ncpData = validMins.map((m) => ({ time: toTs(m.t) as any, value: m.ncp / 1_000_000 }));
    const nppData = validMins.map((m) => ({ time: toTs(m.t) as any, value: m.npp / 1_000_000 }));

    const ncpS = chart.addSeries(AreaSeries, {
      lineColor: upColor,
      topColor: `${upColor}40`,
      bottomColor: `${upColor}05`,
      lineWidth: 1.5 as any,
      priceLineVisible: false,
      lastValueVisible: true,
      title: "NCP",
    });
    ncpS.setData(ncpData);
    ncpRef.current = ncpS;

    const nppS = chart.addSeries(AreaSeries, {
      lineColor: downColor,
      topColor: `${downColor}05`,
      bottomColor: `${downColor}30`,
      lineWidth: 1.5 as any,
      priceLineVisible: false,
      lastValueVisible: true,
      title: "NPP",
      invertFilledArea: true,
    });
    nppS.setData(nppData);
    nppRef.current = nppS;

    // SPY overlay on separate scale if provided
    if (spy.length > 0) {
      const spyData = spy
        .filter((s, i, arr) => i === 0 || s.t !== arr[i - 1].t)
        .map((s) => ({ time: toTs(s.t) as any, value: s.px }));
      const spyS = chart.addSeries(LineSeries, {
        color: warnColor,
        lineWidth: 1,
        priceScaleId: "spy",
        priceLineVisible: false,
        lastValueVisible: true,
        title: "SPY",
      });
      spyS.setData(spyData);
      chart.priceScale("spy").applyOptions({
        scaleMargins: { top: 0.7, bottom: 0.02 },
        borderColor: "transparent",
      });
      spyRef.current = spyS;
    }

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (el && chartRef.current) {
        chartRef.current.applyOptions({ width: el.clientWidth });
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      try { chart.remove(); } catch {}
      chartRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minutes, spy, height, sessionDate]);

  return <div ref={ref} style={{ width: "100%", height }} />;
});

export default TideChart;
