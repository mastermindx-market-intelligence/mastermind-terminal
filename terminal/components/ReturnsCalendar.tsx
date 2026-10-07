"use client";

import { useEffect, useMemo, useState } from "react";
import type { Bar } from "@/lib/fund";
import {
  buildDailyReturnRecords,
  buildReturnsCalendarSessions,
  isCryptoLike,
  previousCalendarDate,
  rangePercent,
  returnHeatBand,
  RETURNS_CALENDAR_SESSION_TF,
  summarizeReturnMonth,
  type SessionRange,
} from "@/lib/returnsCalendar";

type Pick = (en?: string | null, cn?: string | null) => string;
type Bar6 = [number, number, number, number, number, number];
type CoverageStatus = "available" | "empty" | "not_configured" | "unavailable" | null;

type LoadResult = {
  ok: boolean;
  bars: Bar6[];
  raw: any;
};

type SessionLoad = {
  key: string;
  sessions: SessionRange[];
  currentOk: boolean;
  previousOk: boolean;
  overnightStatus: CoverageStatus;
  studyStatus: CoverageStatus;
  regularWindowAvailable: boolean;
};

const SESSION_SPECS = [
  { key: "overnight" as const, en: "Overnight", cn: "隔夜", hours: "20:00–04:00" },
  { key: "pre" as const, en: "Premarket", cn: "盘前", hours: "04:00–09:30" },
  { key: "regular" as const, en: "Regular", cn: "常规", hours: "09:30–16:00" },
  { key: "post" as const, en: "After close", cn: "收盘后", hours: "16:00–20:00" },
];

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function pct(value: number | null, digits = 2): string {
  if (value === null || !finite(value)) return "—";
  return (value > 0 ? "+" : "") + value.toFixed(digits) + "%";
}

function px(value: number | null): string {
  if (value === null || !finite(value)) return "—";
  return Math.abs(value) >= 1000
    ? value.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : value.toFixed(value >= 100 ? 2 : 3);
}

function monthKey(date: string): string {
  return date.slice(0, 7);
}

function shiftMonth(month: string, offset: number): string {
  const parts = month.split("-").map(Number);
  const d = new Date(Date.UTC(parts[0], parts[1] - 1 + offset, 1));
  return d.toISOString().slice(0, 7);
}

function isUsEquity(symbol: string): boolean {
  return /^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol) && !/\.(HK|SS|SZ|TO|V)$/i.test(symbol);
}

function validBar6(value: unknown): value is Bar6 {
  if (!Array.isArray(value) || value.length < 6) return false;
  const [t, o, h, l, c, v] = value;
  return [t, o, h, l, c, v].every(finite)
    && t > 0 && o > 0 && h > 0 && l > 0 && c > 0 && v >= 0
    && h >= Math.max(o, c) && l <= Math.min(o, c) && h >= l;
}

function coverage(value: unknown): CoverageStatus {
  return value === "available" || value === "empty" || value === "not_configured" || value === "unavailable"
    ? value
    : null;
}

async function loadStudy(url: string, signal: AbortSignal): Promise<LoadResult> {
  try {
    const response = await fetch(url, { signal, cache: "no-store" });
    if (!response.ok) return { ok: false, bars: [], raw: null };
    const raw = await response.json();
    const bars = Array.isArray(raw?.bars) ? raw.bars.filter(validBar6) : [];
    return { ok: true, bars, raw };
  } catch {
    return { ok: false, bars: [], raw: null };
  }
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

export default function ReturnsCalendar({
  symbol,
  bars,
  pick,
}: {
  symbol: string;
  bars: Bar[];
  pick: Pick;
}) {
  const records = useMemo(() => buildDailyReturnRecords(bars), [bars]);
  const latestDate = records.length ? records[records.length - 1].date : null;
  const minMonth = records.length ? monthKey(records[0].date) : null;
  const maxMonth = latestDate ? monthKey(latestDate) : null;
  const [requestedMonth, setRequestedMonth] = useState(maxMonth || new Date().toISOString().slice(0, 7));
  const [requestedDate, setRequestedDate] = useState<string | null>(latestDate);
  const [sessionLoad, setSessionLoad] = useState<SessionLoad | null>(null);

  const byDate = useMemo(() => new Map(records.map((record) => [record.date, record])), [records]);
  const month = minMonth && maxMonth && (requestedMonth < minMonth || requestedMonth > maxMonth)
    ? maxMonth
    : requestedMonth;
  const monthRecords = useMemo(() => records.filter((record) => monthKey(record.date) === month), [records, month]);
  const summary = useMemo(() => summarizeReturnMonth(records, month), [records, month]);

  const selectedDate = requestedDate && monthKey(requestedDate) === month && byDate.has(requestedDate)
    ? requestedDate
    : monthRecords.length ? monthRecords[monthRecords.length - 1].date : null;
  const selected = selectedDate ? byDate.get(selectedDate) ?? null : null;
  const usEquity = isUsEquity(symbol);
  const requestKey = selectedDate && usEquity ? symbol + ":" + selectedDate : null;

  useEffect(() => {
    if (!requestKey || !selectedDate) {
      setSessionLoad(null);
      return;
    }

    const controller = new AbortController();
    const prior = previousCalendarDate(selectedDate);
    const url = (date: string, overnightOnly = false) =>
      "/api/intraday?sym=" + encodeURIComponent(symbol)
      + "&tf=" + RETURNS_CALENDAR_SESSION_TF
      + "&ext=1&overnight=" + (overnightOnly ? "only" : "1")
      + "&date=" + date;

    void (async () => {
      const [current, previous] = await Promise.all([
        loadStudy(url(selectedDate), controller.signal),
        loadStudy(url(prior, true), controller.signal),
      ]);
      if (controller.signal.aborted) return;

      const windowRaw = current.raw?.regular_session_window;
      const regularWindow: readonly [number, number] | null =
        windowRaw
        && Number.isInteger(windowRaw.start_minute)
        && Number.isInteger(windowRaw.end_minute)
        && windowRaw.start_minute >= 0
        && windowRaw.end_minute > windowRaw.start_minute
        && windowRaw.end_minute <= 1440
          ? [windowRaw.start_minute, windowRaw.end_minute]
          : null;

      const statuses = [
        coverage(previous.raw?.overnight_evidence?.status),
        coverage(current.raw?.overnight_evidence?.status),
      ].filter((value): value is Exclude<CoverageStatus, null> => value !== null);
      const overnightStatus: CoverageStatus = statuses.includes("available")
        ? "available"
        : statuses.includes("not_configured")
          ? "not_configured"
          : statuses.includes("unavailable")
            ? "unavailable"
            : statuses.includes("empty")
              ? "empty"
              : null;

      setSessionLoad({
        key: requestKey,
        sessions: buildReturnsCalendarSessions(
          current.ok ? current.bars : [],
          previous.ok ? previous.bars : [],
          regularWindow,
        ),
        currentOk: current.ok,
        previousOk: previous.ok,
        overnightStatus,
        studyStatus: coverage(current.raw?.session_study_evidence?.status),
        regularWindowAvailable: regularWindow !== null,
      });
    })();

    return () => controller.abort();
  }, [requestKey, selectedDate, symbol]);

  if (records.length < 2) return null;

  const crypto = isCryptoLike(symbol);
  const weekdays = crypto
    ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    : ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const parts = month.split("-").map(Number);
  const monthStart = new Date(Date.UTC(parts[0], parts[1] - 1, 1));
  const monthEnd = new Date(Date.UTC(parts[0], parts[1], 0));
  const slots: ({ date: string; record: (typeof records)[number] | null } | null)[] = [];

  for (let day = 1; day <= monthEnd.getUTCDate(); day++) {
    const date = new Date(Date.UTC(parts[0], parts[1] - 1, day));
    const dow = date.getUTCDay();
    if (!crypto && (dow === 0 || dow === 6)) continue;
    const key = date.toISOString().slice(0, 10);
    slots.push({ date: key, record: byDate.get(key) ?? null });
  }

  const firstDow = monthStart.getUTCDay();
  const lead = crypto ? firstDow : firstDow === 0 || firstDow === 6 ? 0 : Math.max(0, firstDow - 1);
  for (let i = 0; i < lead; i++) slots.unshift(null);

  const monthLabel = pick(
    new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(monthStart),
    new Intl.DateTimeFormat("zh-CN", { month: "long", year: "numeric", timeZone: "UTC" }).format(monthStart),
  );
  const canPrev = !!minMonth && shiftMonth(month, -1) >= minMonth;
  const canNext = !!maxMonth && shiftMonth(month, 1) <= maxMonth;
  const openingGap = selected?.previousClose ? (selected.bar.o / selected.previousClose - 1) * 100 : null;
  const openToClose = selected ? (selected.bar.c / selected.bar.o - 1) * 100 : null;
  const openPos = selected ? rangePercent(selected.bar.o, selected.bar.l, selected.bar.h) : null;
  const closePos = selected ? rangePercent(selected.bar.c, selected.bar.l, selected.bar.h) : null;

  const sessions = sessionLoad?.key === requestKey ? sessionLoad.sessions : [];
  const loadingSessions = !!requestKey && sessionLoad?.key !== requestKey;
  const overnightPartial = !!requestKey && sessionLoad?.key === requestKey && (!sessionLoad.currentOk || !sessionLoad.previousOk);

  const detailNote = !usEquity
    ? pick("Daily price history is available; U.S. extended-session decomposition is not applied to this symbol.", "提供每日价格历史；此标的不使用美股扩展时段拆分。")
    : loadingSessions
      ? pick("Loading selected-day session evidence…", "正在加载所选日期的分时证据…")
      : sessionLoad?.key === requestKey && !sessionLoad.currentOk
        ? pick("Daytime session history is unavailable. Daily OHLC remains independent and no intraday range is estimated.", "日间分时历史不可用。每日 OHLC 保持独立，不估算分时区间。")
        : sessionLoad?.key === requestKey && !sessionLoad.regularWindowAvailable
          ? pick("Exchange-hours metadata is unavailable for this date, so premarket, regular and after-close ranges are withheld.", "该日期交易时段元数据不可用，因此盘前、常规和收盘后区间保持为空。")
          : overnightPartial
            ? pick("Only part of the overnight wall-date pair was available. Observed extrema are shown, but the full overnight return is withheld.", "隔夜跨日数据仅部分可用。显示已观察极值，但不显示完整隔夜收益。")
            : sessionLoad?.overnightStatus === "not_configured"
              ? pick("Overnight history is not configured on this server. Other U.S. sessions use precise 30-minute aggregate OHLC.", "此服务器未配置隔夜历史。其他美股时段使用精确的 30 分钟聚合 OHLC。")
              : pick("Session ranges are eligible 30-minute aggregate-bar OHLC, not every printed-trade extreme. Missing values are never estimated.", "分时区间为合资格的 30 分钟聚合 K 线 OHLC，并非所有逐笔成交的绝对极值。缺失值不会被估算。");

  const exportMonth = () => {
    const rows = [
      ["date", "open", "high", "low", "close", "previous_date", "previous_close", "close_to_close_return_pct", "observed_gap_calendar_days"],
      ...monthRecords.map((record) => [
        record.date,
        record.bar.o,
        record.bar.h,
        record.bar.l,
        record.bar.c,
        record.previousDate,
        record.previousClose,
        record.returnPct,
        record.gapCalendarDays,
      ]),
    ];
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = symbol.replace(/[^A-Za-z0-9._-]/g, "_") + "-returns-" + month + ".csv";
    a.click();
    URL.revokeObjectURL(href);
  };

  return (
    <section className="returns-study" aria-label={pick("Returns study", "收益研究")}>
      <header className="returns-study-hero">
        <div>
          <span className="returns-kicker">{pick("Price history", "价格历史")}</span>
          <h2>{pick("Returns", "收益")}</h2>
          <p>{pick("Every observed day, its start/end prices, full daily range and selected-session evidence.", "逐日查看起止价格、完整日内区间及所选日期的分时证据。")}</p>
        </div>
        <div className="returns-study-actions">
          {maxMonth && month !== maxMonth && <button type="button" onClick={() => setRequestedMonth(maxMonth)}>{pick("Latest", "最新")}</button>}
          <button type="button" onClick={exportMonth}>{pick("Export CSV", "导出 CSV")}</button>
        </div>
      </header>

      <div className="returns-month-summary">
        <div className="primary">
          <span>{monthLabel}</span>
          <strong className={(summary.returnPct ?? 0) >= 0 ? "up" : "down"}>{pct(summary.returnPct)}</strong>
          <small>{summary.referenceDate && summary.endDate
            ? pick("Price return", "价格收益") + " · " + summary.referenceDate + " → " + summary.endDate
            : pick("Prior observed close unavailable; monthly return withheld.", "缺少此前观察收盘价；月度收益保持为空。")}</small>
        </div>
        <div className="stats">
          <span><b>{summary.observedDays}</b>{pick("Observed days", "观察日")}</span>
          <span><b>{summary.upDays}</b>{pick("Up", "上涨")}</span>
          <span><b>{summary.downDays}</b>{pick("Down", "下跌")}</span>
          <span><b>{summary.best ? pct(summary.best.returnPct) : "—"}</b>{pick("Best", "最佳")}</span>
          <span><b>{summary.worst ? pct(summary.worst.returnPct) : "—"}</b>{pick("Worst", "最差")}</span>
        </div>
      </div>

      <div className="returns-study-layout">
        <div className="returns-calendar-panel">
          <div className="returns-calendar-nav">
            <button type="button" disabled={!canPrev} onClick={() => canPrev && setRequestedMonth(shiftMonth(month, -1))} aria-label={pick("Previous month", "上月")}>‹</button>
            <strong>{monthLabel}</strong>
            <button type="button" disabled={!canNext} onClick={() => canNext && setRequestedMonth(shiftMonth(month, 1))} aria-label={pick("Next month", "下月")}>›</button>
          </div>

          <div className={"returns-weekdays cols-" + weekdays.length} aria-hidden>
            {weekdays.map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className={"returns-calendar-grid cols-" + weekdays.length}>
            {slots.map((slot, index) => {
              if (!slot) return <div key={"blank-" + index} className="returns-day blank" />;
              const record = slot.record;
              if (!record) return <div key={slot.date} className="returns-day empty"><span className="date">{Number(slot.date.slice(8))}</span></div>;
              const direction = (record.returnPct ?? 0) >= 0 ? "up" : "down";
              const heat = returnHeatBand(record.returnPct);
              const active = record.date === selectedDate;
              return (
                <button
                  key={record.date}
                  id={"returns-day-" + record.date}
                  type="button"
                  className={"returns-day " + direction + " heat-" + heat + (active ? " selected" : "")}
                  aria-pressed={active}
                  aria-label={record.date + " " + pct(record.returnPct)}
                  onClick={() => setRequestedDate(record.date)}
                >
                  <span className="date">{record.date.slice(8)}</span>
                  <strong>{pct(record.returnPct)}</strong>
                  <span className="oc">O {px(record.bar.o)} · C {px(record.bar.c)}</span>
                  <span className="hl">L {px(record.bar.l)} · H {px(record.bar.h)}</span>
                </button>
              );
            })}
          </div>
        </div>

        {selected && (
          <aside className="returns-inspector" aria-live="polite">
            <div className="returns-inspector-head">
              <div>
                <span>{selected.date}</span>
                <strong className={(selected.returnPct ?? 0) >= 0 ? "up" : "down"}>{pct(selected.returnPct)}</strong>
              </div>
              <small>{pick("Close to previous observed close", "相对前一观察日收盘")}</small>
            </div>

            <div className="returns-ohlc">
              <span><small>{pick("Previous", "前收")}</small><b>{px(selected.previousClose)}</b></span>
              <span><small>{pick("Open", "开盘")}</small><b>{px(selected.bar.o)}</b></span>
              <span><small>{pick("High", "最高")}</small><b>{px(selected.bar.h)}</b></span>
              <span><small>{pick("Low", "最低")}</small><b>{px(selected.bar.l)}</b></span>
              <span><small>{pick("Close", "收盘")}</small><b>{px(selected.bar.c)}</b></span>
            </div>

            <div className="returns-range">
              <div className="returns-range-labels"><span>L {px(selected.bar.l)}</span><span>H {px(selected.bar.h)}</span></div>
              <div className="returns-range-track">
                {openPos !== null && <span className="marker open" style={{ left: openPos + "%" }}><i>O</i></span>}
                {closePos !== null && <span className="marker close" style={{ left: closePos + "%" }}><i>C</i></span>}
              </div>
              <div className="returns-range-factors">
                <span>{pick("Opening gap", "开盘缺口")} <b className={(openingGap ?? 0) >= 0 ? "up" : "down"}>{pct(openingGap)}</b></span>
                <span>{pick("Open → close", "开盘 → 收盘")} <b className={(openToClose ?? 0) >= 0 ? "up" : "down"}>{pct(openToClose)}</b></span>
              </div>
            </div>

            {selected.gapCalendarDays > 3 && (
              <div className="returns-quality-note">
                {pick("There is a multi-day observation gap before this row; the return is between observed closes, not certified as a single trading session.", "此行之前存在多日观察缺口；收益表示两个观察收盘价之间的变化，并非认证的单一交易时段收益。")}
              </div>
            )}

            <div className="returns-session-title">
              <div><strong>{pick("Selected-day sessions", "所选日期时段")}</strong><span>{RETURNS_CALENDAR_SESSION_TF}</span></div>
              <small>{detailNote}</small>
            </div>

            <div className="returns-session-grid">
              {SESSION_SPECS.map((spec) => {
                const session = sessions.find((item) => item.key === spec.key) ?? null;
                const suppressReturn = spec.key === "overnight" && overnightPartial;
                const sessionReturn = suppressReturn ? null : session?.ret ?? null;
                return (
                  <div key={spec.key} className="returns-session">
                    <div><b>{pick(spec.en, spec.cn)}</b><span>{session?.hours || spec.hours} ET</span></div>
                    <strong className={sessionReturn !== null ? (sessionReturn >= 0 ? "up" : "down") : ""}>{pct(sessionReturn)}</strong>
                    <span>O {px(session?.open ?? null)} · C {px(session?.close ?? null)}</span>
                    <span>L {px(session?.low ?? null)} · H {px(session?.high ?? null)}</span>
                    <small>{session?.barCount ?? 0} {pick("bars observed", "根K线")}</small>
                  </div>
                );
              })}
            </div>
          </aside>
        )}
      </div>
    </section>
  );
}
