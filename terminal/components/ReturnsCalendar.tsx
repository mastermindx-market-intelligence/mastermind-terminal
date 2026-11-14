"use client";

import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import type { Bar } from "@/lib/fund";
import { isMacroSymbol, isDailyOnlySymbol } from "@/lib/macroSymbols";
import {
  buildDailyReturnRecords,
  finiteReturnPercent,
  returnDirection,
  buildReturnCalendarSlots,
  returnCalendarFocusTarget,
  returnCalendarMonthFocus,
  serializeReturnsMonth,
  isCryptoLike,
  rangePercent,
  returnHeatBand,
  RETURNS_CALENDAR_SESSION_TF,
  summarizeReturnMonth,
} from "@/lib/returnsCalendar";
import { parseReturnsStudy, unavailableReturnsStudy, type ReturnsStudy } from "@/lib/returnsCalendarStudy";
import { returnsClassNames } from "./returnsStyles";

type Pick = (en?: string | null, cn?: string | null) => string;
type SessionLoad = ReturnsStudy & { key: string };

const SESSION_SPECS = [
  { key: "overnight" as const, en: "Overnight", cn: "隔夜" },
  { key: "pre" as const, en: "Premarket", cn: "盘前" },
  { key: "regular" as const, en: "Regular", cn: "常规" },
  { key: "post" as const, en: "After close", cn: "收盘后" },
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
  return /^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol) && !/\.(HK|SS|SZ|TO|V)$/i.test(symbol)
    && !isMacroSymbol(symbol) && !isDailyOnlySymbol(symbol);
}

async function loadStudy(url: string, signal: AbortSignal, symbol: string, date: string): Promise<ReturnsStudy> {
  try {
    const response = await fetch(url, { signal, cache: "no-store" });
    return response.ok ? parseReturnsStudy(await response.json(), symbol, date) : unavailableReturnsStudy();
  } catch {
    return unavailableReturnsStudy();
  }
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
  const crypto = isCryptoLike(symbol);
  const latestDate = records.length ? records[records.length - 1].date : null;
  const minMonth = records.length ? monthKey(records[0].date) : null;
  const maxMonth = latestDate ? monthKey(latestDate) : null;
  const [requestedMonth, setRequestedMonth] = useState(maxMonth || new Date().toISOString().slice(0, 7));
  const [requestedDate, setRequestedDate] = useState<string | null>(latestDate);
  const [sessionLoad, setSessionLoad] = useState<SessionLoad | null>(null);
  const [requestedFocus, setRequestedFocus] = useState<string | null>(latestDate);
  const dayRefs = useRef(new Map<string, HTMLButtonElement>());
  const gridRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef(false);

  const byDate = useMemo(() => new Map(records.map((record) => [record.date, record])), [records]);
  const month = minMonth && maxMonth && (requestedMonth < minMonth || requestedMonth > maxMonth)
    ? maxMonth
    : requestedMonth;
  const summary = useMemo(() => summarizeReturnMonth(records, month), [records, month]);

  const selectedDate = requestedDate && byDate.has(requestedDate)
    ? requestedDate
    : latestDate;
  const selected = selectedDate ? byDate.get(selectedDate) ?? null : null;
  const usEquity = isUsEquity(symbol) && !isCryptoLike(symbol);
  const requestKey = records.length >= 2 && selectedDate && usEquity ? symbol + ":" + selectedDate : null;
  const slots = useMemo(() => buildReturnCalendarSlots(records, month, crypto), [records, month, crypto]);
  const focusedDate = requestedFocus && slots.some(slot => slot?.date === requestedFocus && slot.record)
    ? requestedFocus : returnCalendarMonthFocus(records, month, selectedDate, crypto);

  useEffect(() => {
    if (!pendingFocus.current) return;
    pendingFocus.current = false;
    if (focusedDate) dayRefs.current.get(focusedDate)?.focus();
    else gridRef.current?.focus();
  }, [month, focusedDate]);

  useEffect(() => {
    if (!requestKey || !selectedDate) return;

    const controller = new AbortController();
    // The existing 24H owner already includes the preceding evening for this trading date.
    const url = "/api/intraday?sym=" + encodeURIComponent(symbol)
      + "&tf=" + RETURNS_CALENDAR_SESSION_TF + "&ext=1&session=24h&study=returns&date=" + selectedDate;
    void loadStudy(url, controller.signal, symbol, selectedDate).then(study => {
      if (!controller.signal.aborted) setSessionLoad({ ...study, key: requestKey });
    });

    return () => controller.abort();
  }, [requestKey, selectedDate, symbol]);

  if (records.length < 2) return null;

  const weekdays = crypto
    ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    : ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const parts = month.split("-").map(Number);
  const monthStart = new Date(Date.UTC(parts[0], parts[1] - 1, 1));
  const monthLabel = pick(
    new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(monthStart),
    new Intl.DateTimeFormat("zh-CN", { month: "long", year: "numeric", timeZone: "UTC" }).format(monthStart),
  );
  const canPrev = !!minMonth && shiftMonth(month, -1) >= minMonth;
  const canNext = !!maxMonth && shiftMonth(month, 1) <= maxMonth;
  const focusDay = (date: string) => {
    setRequestedFocus(date);
    dayRefs.current.get(date)?.focus();
  };
  const moveMonth = (next: string, restoreFocus = false) => {
    if (!minMonth || !maxMonth || next < minMonth || next > maxMonth || next === month) return;
    pendingFocus.current = restoreFocus;
    setRequestedFocus(returnCalendarMonthFocus(records, next, focusedDate ?? selectedDate, crypto));
    setRequestedMonth(next);
  };
  const handleDayKey = (event: KeyboardEvent<HTMLElement>, date: string | null) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229
        || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      moveMonth(shiftMonth(month, event.key === "PageUp" ? -1 : 1), true);
      return;
    }
    if (!date) return;
    const next = returnCalendarFocusTarget(slots, date, event.key, crypto ? 7 : 5);
    if (next) { event.preventDefault(); focusDay(next); }
    // Native click/Enter/Space activation alone changes selectedDate and the study request.
  };
  const openingGap = selected ? finiteReturnPercent(selected.bar.o, selected.previousClose) : null;
  const openToClose = selected ? finiteReturnPercent(selected.bar.c, selected.bar.o) : null;
  const openPos = selected ? rangePercent(selected.bar.o, selected.bar.l, selected.bar.h) : null;
  const closePos = selected ? rangePercent(selected.bar.c, selected.bar.l, selected.bar.h) : null;

  const sessions = sessionLoad?.key === requestKey ? sessionLoad.sessions : [];
  const loadingSessions = !!requestKey && sessionLoad?.key !== requestKey;
  const loaded = sessionLoad?.key === requestKey ? sessionLoad : null;
  const notes: string[] = [];
  if (!usEquity) notes.push(pick("Daily price history is available; U.S. extended-session decomposition is not applied to this symbol.", "提供每日价格历史；此标的不使用美股扩展时段拆分。"));
  else if (loadingSessions) notes.push(pick("Loading selected-day session evidence…", "正在加载所选日期的分时证据…"));
  else if (loaded) {
    if (loaded.daytimeStatus === "closed") notes.push(pick("The exchange calendar marks this date closed. No session values are inferred.", "交易所日历标记此日休市。不推算分时数值。"));
    else {
      if (!loaded.regularWindowAvailable) notes.push(pick("Exchange hours are unavailable for this date; daytime ranges are withheld.", "该日期交易时段不可用；日间区间保持为空。"));
      else if (loaded.daytimeStatus === "pending") notes.push(pick("Selected-day history is still being acquired. Retained observations are shown without a new session return.", "所选日期历史仍在获取中。显示保留的观察值，不给出新的时段收益。"));
      else if (loaded.daytimeStatus === "partial" || loaded.daytimeStatus === "unavailable") notes.push(pick("Daytime session history is incomplete or unavailable. Observed extrema and the independent daily layer are retained.", "日间分时历史不完整或不可用。保留已观察极值及独立的每日数据。"));
      else if (loaded.daytimeStatus === "empty") notes.push(pick("No eligible daytime observations were returned for this date.", "未返回该日期的合资格日间观察值。"));
      if (loaded.overnightStatus === "partial") notes.push(pick("Overnight observations have partial coverage and an unverified price basis. Observed OHLC is shown; the full overnight return is withheld.", "隔夜观察值覆盖不完整，价格基准未核实。显示已观察 OHLC，不显示完整隔夜收益。"));
      else if (loaded.overnightStatus === "not_configured") notes.push(pick("Overnight history is not configured on this server.", "此服务器未配置隔夜历史。"));
      else if (loaded.overnightStatus === "empty") notes.push(pick("No captured overnight observations were returned; this does not certify an empty full session.", "未返回已采集的隔夜观察值；这不代表已确认整个时段没有成交。"));
      else if (loaded.overnightStatus === "unavailable") notes.push(pick("Overnight history is unavailable. Valid daytime and daily values remain independent.", "隔夜历史不可用。有效的日间及每日数值保持独立。"));
      notes.push(pick("Session OHLC uses observed eligible 30-minute aggregates. Displayed changes run from the first to last observed bar; missing values and every-print extrema are not estimated.", "分时 OHLC 使用已观察的合资格 30 分钟聚合数据。显示的变化从首根至末根已观察 K 线计算；不估算缺失值或逐笔成交极值。"));
    }
  }
  const detailNote = notes.join(" ");

  const exportMonth = () => {
    const csv = serializeReturnsMonth(records, month);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = symbol.replace(/[^A-Za-z0-9._-]/g, "_") + "-returns-" + month + ".csv";
    a.click();
    URL.revokeObjectURL(href);
  };

  return (
    <section className={returnsClassNames("returns-study")} aria-label={pick("Returns study", "收益研究")}>
      <header className={returnsClassNames("returns-study-hero")}>
        <div>
          <span className={returnsClassNames("returns-kicker")}>{pick("Price history", "价格历史")}</span>
          <h2>{pick("Returns", "收益")}</h2>
          <p>{pick("Every observed day, its start/end prices, full daily range and selected-session evidence.", "逐日查看起止价格、完整日内区间及所选日期的分时证据。")}</p>
        </div>
        <div className={returnsClassNames("returns-study-actions")}>
          {maxMonth && month !== maxMonth && <button type="button" onClick={() => moveMonth(maxMonth, true)}>{pick("Latest", "最新")}</button>}
          <button type="button" onClick={exportMonth}>{pick("Export CSV", "导出 CSV")}</button>
        </div>
      </header>

      <div className={returnsClassNames("returns-month-summary")}>
        <div className={returnsClassNames("primary")}>
          <span>{monthLabel}</span>
          <strong className={returnsClassNames(returnDirection(summary.returnPct))}>{pct(summary.returnPct)}</strong>
          <small>{summary.referenceDate && summary.endDate
            ? (finite(summary.returnPct) ? pick("Price return", "价格收益")
              : pick("Monthly return calculation unavailable", "月度收益计算不可用"))
              + " · " + summary.referenceDate + " → " + summary.endDate
            : pick("Prior observed close unavailable; monthly return withheld.", "缺少此前观察收盘价；月度收益保持为空。")}</small>
        </div>
        <div className={returnsClassNames("stats")}>
          <span><b>{summary.observedDays}</b>{pick("Observed days", "观察日")}</span>
          <span><b>{summary.upDays}</b>{pick("Up", "上涨")}</span>
          <span><b>{summary.downDays}</b>{pick("Down", "下跌")}</span>
          <span><b>{summary.best ? pct(summary.best.returnPct) : "—"}</b>{pick("Best", "最佳")}</span>
          <span><b>{summary.worst ? pct(summary.worst.returnPct) : "—"}</b>{pick("Worst", "最差")}</span>
        </div>
      </div>

      <div className={returnsClassNames("returns-study-layout")}>
        <div className={returnsClassNames("returns-calendar-panel")}>
          <div className={returnsClassNames("returns-calendar-nav")}>
            <button type="button" disabled={!canPrev} onClick={() => canPrev && moveMonth(shiftMonth(month, -1))} aria-label={pick("Previous month", "上月")}>‹</button>
            <strong>{monthLabel}</strong>
            <button type="button" disabled={!canNext} onClick={() => canNext && moveMonth(shiftMonth(month, 1))} aria-label={pick("Next month", "下月")}>›</button>
          </div>

          <div className={returnsClassNames("returns-weekdays cols-" + weekdays.length)} aria-hidden>
            {weekdays.map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className={returnsClassNames("returns-calendar-grid cols-" + weekdays.length)} ref={gridRef}
            role="group" aria-label={monthLabel + " " + pick("returns calendar", "收益日历")}
            tabIndex={focusedDate ? -1 : 0}
            onKeyDown={(event) => { if (event.target === event.currentTarget) handleDayKey(event, null); }}>
            {!focusedDate && <span className={returnsClassNames("returns-empty-month")}>{pick("No observed days in this month. Use Page Up or Page Down to navigate.", "本月没有观察日。可用 Page Up 或 Page Down 切换月份。")}</span>}
            {slots.map((slot, index) => {
              if (!slot) return <div key={"blank-" + index} className={returnsClassNames("returns-day blank")} />;
              const record = slot.record;
              if (!record) return <div key={slot.date} className={returnsClassNames("returns-day empty")}><span className={returnsClassNames("date")}>{Number(slot.date.slice(8))}</span></div>;
              const direction = returnDirection(record.returnPct);
              const heat = returnHeatBand(record.returnPct);
              const active = record.date === selectedDate;
              return (
                <button
                  key={record.date}
                  id={"returns-day-" + record.date}
                  ref={(node) => { if (node) dayRefs.current.set(record.date, node); else dayRefs.current.delete(record.date); }}
                  tabIndex={record.date === focusedDate ? 0 : -1}
                  onFocus={() => setRequestedFocus(record.date)}
                  type="button"
                  className={returnsClassNames("returns-day " + direction + " heat-" + heat + (active ? " selected" : ""))}
                  aria-pressed={active}
                  aria-label={record.date + " " + pct(record.returnPct) + (!finite(record.returnPct) ? " " + (record.previousClose === null
                    ? pick("Previous observed close unavailable", "此前观察收盘价不可用")
                    : pick("Return calculation unavailable", "收益计算不可用")) : "")}
                  onClick={() => setRequestedDate(record.date)}
                  onKeyDown={(event) => handleDayKey(event, record.date)}
                >
                  <span className={returnsClassNames("date")}>{record.date.slice(8)}</span>
                  <strong>{pct(record.returnPct)}</strong>
                  <span className={returnsClassNames("oc")}>O {px(record.bar.o)} · C {px(record.bar.c)}</span>
                  <span className={returnsClassNames("hl")}>L {px(record.bar.l)} · H {px(record.bar.h)}</span>
                </button>
              );
            })}
          </div>
        </div>

        {selected && (
          <aside className={returnsClassNames("returns-inspector")}>
            <span className={returnsClassNames("returns-announcement")} role="status" aria-live="polite">
              {pick("Selected day", "所选日期") + " " + selected.date + " " + pct(selected.returnPct)}
            </span>
            <div className={returnsClassNames("returns-inspector-head")}>
              <div>
                <span>{selected.date}</span>
                <strong className={returnsClassNames(returnDirection(selected.returnPct))}>{pct(selected.returnPct)}</strong>
              </div>
              <small>{finite(selected.returnPct)
                ? pick("Close to previous observed close", "相对前一观察日收盘")
                : selected.previousClose === null
                  ? pick("Previous observed close unavailable", "此前观察收盘价不可用")
                  : pick("Return calculation unavailable", "收益计算不可用")}</small>
            </div>

            <div className={returnsClassNames("returns-ohlc")}>
              <span><small>{pick("Previous", "前收")}</small><b>{px(selected.previousClose)}</b></span>
              <span><small>{pick("Open", "开盘")}</small><b>{px(selected.bar.o)}</b></span>
              <span><small>{pick("High", "最高")}</small><b>{px(selected.bar.h)}</b></span>
              <span><small>{pick("Low", "最低")}</small><b>{px(selected.bar.l)}</b></span>
              <span><small>{pick("Close", "收盘")}</small><b>{px(selected.bar.c)}</b></span>
            </div>

            <div className={returnsClassNames("returns-range")}>
              <div className={returnsClassNames("returns-range-labels")}><span>L {px(selected.bar.l)}</span><span>H {px(selected.bar.h)}</span></div>
              <div className={returnsClassNames("returns-range-track")}>
                {openPos !== null && <span className={returnsClassNames("marker open")} style={{ left: openPos + "%" }}><i>O</i></span>}
                {closePos !== null && <span className={returnsClassNames("marker close")} style={{ left: closePos + "%" }}><i>C</i></span>}
              </div>
              <div className={returnsClassNames("returns-range-factors")}>
                <span>{pick("Opening gap", "开盘缺口")} <b className={returnsClassNames(returnDirection(openingGap))}>{pct(openingGap)}</b></span>
                <span>{pick("Open → close", "开盘 → 收盘")} <b className={returnsClassNames(returnDirection(openToClose))}>{pct(openToClose)}</b></span>
              </div>
            </div>

            {selected.gapCalendarDays > 3 && (
              <div className={returnsClassNames("returns-quality-note")}>
                {pick("There is a multi-day observation gap before this row; the return is between observed closes, not certified as a single trading session.", "此行之前存在多日观察缺口；收益表示两个观察收盘价之间的变化，并非认证的单一交易时段收益。")}
              </div>
            )}

            <div className={returnsClassNames("returns-session-title")}>
              <div><strong>{pick("Selected-day sessions", "所选日期时段")}</strong><span>{RETURNS_CALENDAR_SESSION_TF}</span></div>
              <small>{detailNote}</small>
            </div>

            <div className={returnsClassNames("returns-session-grid")}>
              {SESSION_SPECS.map((spec) => {
                const session = sessions.find((item) => item.key === spec.key) ?? null;
                const sessionReturn = session?.ret ?? null;
                return (
                  <div key={spec.key} className={returnsClassNames("returns-session")}>
                    <div><b>{pick(spec.en, spec.cn)}</b><span>{session?.hours || "—"} ET</span></div>
                    <strong className={returnsClassNames(returnDirection(sessionReturn))}>{pct(sessionReturn)}</strong>
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
