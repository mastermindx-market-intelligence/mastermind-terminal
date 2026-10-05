"use client";

import { useEffect, useMemo, useState } from "react";
import type { Bar } from "@/lib/fund";
import { buildReturnsCalendarSessions, previousCalendarDate, returnsCalendarDayKey, type SessionRange } from "@/lib/returnsCalendar";

type Pick = (en?: string | null, cn?: string | null) => string;
type Bar6 = [number, number, number, number, number, number];

type DayDatum = {
  date: string;
  day: number;
  bar: Bar;
  ret: number | null;
};

const SESSION_SPECS = [
  { key: "overnight" as const, en: "Overnight", cn: "隔夜", hours: "20:00–04:00" },
  { key: "pre" as const, en: "Premarket", cn: "盘前", hours: "04:00–09:30" },
  { key: "regular" as const, en: "Regular", cn: "常规", hours: "09:30–16:00" },
  { key: "post" as const, en: "After hours", cn: "盘后", hours: "16:00–20:00" },
];

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function pct(n: number | null, d = 2): string {
  return n == null || !finite(n) ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(d)}%`;
}

function px(n: number | null): string {
  if (n == null || !finite(n)) return "—";
  if (Math.abs(n) >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return n.toFixed(n >= 100 ? 2 : 3);
}

function monthKey(date: string): string {
  return date.slice(0, 7);
}

function shiftMonth(month: string, offset: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  return d.toISOString().slice(0, 7);
}

function isUsEquity(symbol: string): boolean {
  return /^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol) && !/\.(HK|SS|SZ|TO|V)$/i.test(symbol);
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
  const days = useMemo<DayDatum[]>(() => {
    const ordered = bars
      .map((bar) => ({ bar, date: returnsCalendarDayKey(bar.time) }))
      .filter((x): x is { bar: Bar; date: string } => !!x.date && finite(x.bar.c))
      .sort((a, b) => a.date.localeCompare(b.date));
    return ordered.map((x, i) => {
      const prev = i > 0 ? ordered[i - 1].bar.c : null;
      return {
        date: x.date,
        day: Number(x.date.slice(8, 10)),
        bar: x.bar,
        ret: prev != null && prev !== 0 ? ((x.bar.c - prev) / prev) * 100 : null,
      };
    });
  }, [bars]);

  const latestDate = days.length ? days[days.length - 1].date : null;
  const minMonth = days.length ? monthKey(days[0].date) : null;
  const maxMonth = latestDate ? monthKey(latestDate) : null;
  const initialMonth = maxMonth || new Date().toISOString().slice(0, 7);
  const [requestedMonth, setRequestedMonth] = useState<string>(initialMonth);
  const [requestedDate, setRequestedDate] = useState<string | null>(latestDate);
  const [sessionLoad, setSessionLoad] = useState<{
    key: string;
    sessions: SessionRange[] | null;
    error: boolean;
  } | null>(null);

  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const month =
    minMonth && maxMonth && (requestedMonth < minMonth || requestedMonth > maxMonth)
      ? maxMonth
      : requestedMonth;
  const monthDays = useMemo(() => days.filter((d) => monthKey(d.date) === month), [days, month]);
  const selectedDate =
    requestedDate && monthKey(requestedDate) === month && byDate.has(requestedDate)
      ? requestedDate
      : monthDays.length
        ? monthDays[monthDays.length - 1].date
        : null;
  const requestKey = selectedDate && symbol && isUsEquity(symbol) ? `${symbol}:${selectedDate}` : null;

  useEffect(() => {
    let cancelled = false;
    if (!requestKey || !selectedDate) return;
    const prior = previousCalendarDate(selectedDate);
    const url = (date: string) => `/api/intraday?sym=${encodeURIComponent(symbol)}&tf=1h&ext=1&overnight=1&date=${date}`;
    void (async () => {
      try {
        const [cur, prev] = await Promise.all([fetch(url(selectedDate)), fetch(url(prior))]);
        if (!cur.ok || !prev.ok) throw new Error("session history unavailable");
        const [cj, pj] = await Promise.all([cur.json(), prev.json()]);
        const current = Array.isArray(cj?.bars) ? cj.bars as Bar6[] : [];
        const previous = Array.isArray(pj?.bars) ? pj.bars as Bar6[] : [];
        if (!cancelled) {
          setSessionLoad({ key: requestKey, sessions: buildReturnsCalendarSessions(current, previous), error: false });
        }
      } catch {
        if (!cancelled) setSessionLoad({ key: requestKey, sessions: null, error: true });
      }
    })();
    return () => { cancelled = true; };
  }, [requestKey, selectedDate, symbol]);

  const sessions = sessionLoad?.key === requestKey ? sessionLoad.sessions : null;
  const detailState: "idle" | "loading" | "ready" | "error" =
    !requestKey ? "idle" : sessionLoad?.key !== requestKey ? "loading" : sessionLoad.error ? "error" : "ready";

  if (days.length < 2) return null;

  const [year, mon] = month.split("-").map(Number);
  const monthStart = new Date(Date.UTC(year, mon - 1, 1));
  const monthEnd = new Date(Date.UTC(year, mon, 0));
  const slots: ({ date: string; datum: DayDatum | null } | null)[] = [];
  for (let d = 1; d <= monthEnd.getUTCDate(); d++) {
    const dt = new Date(Date.UTC(year, mon - 1, d));
    const dow = dt.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    slots.push({ date: dt.toISOString().slice(0, 10), datum: byDate.get(dt.toISOString().slice(0, 10)) || null });
  }
  const firstDow = monthStart.getUTCDay();
  const lead = firstDow === 0 ? 0 : firstDow === 6 ? 0 : Math.max(0, firstDow - 1);
  for (let i = 0; i < lead; i++) slots.unshift(null);

  const selected = selectedDate ? byDate.get(selectedDate) || null : null;
  const canPrev = !!minMonth && shiftMonth(month, -1) >= minMonth;
  const canNext = !!maxMonth && shiftMonth(month, 1) <= maxMonth;
  const monthLabel = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(monthStart);

  return (
    <section className="sa-returns" aria-label={pick("Daily returns calendar", "每日收益日历")}>
      <div className="sa-returns-head">
        <div>
          <div className="sa-returns-title">{pick("Daily returns", "每日收益")}</div>
          <div className="sa-returns-sub">{pick("Close-to-close return · daily OHLC range", "收盘至收盘收益 · 每日 OHLC 区间")}</div>
        </div>
        <div className="sa-returns-nav">
          <button type="button" disabled={!canPrev} onClick={() => canPrev && setRequestedMonth(shiftMonth(month, -1))} aria-label={pick("Previous month", "上月")}>‹</button>
          <span>{monthLabel}</span>
          <button type="button" disabled={!canNext} onClick={() => canNext && setRequestedMonth(shiftMonth(month, 1))} aria-label={pick("Next month", "下月")}>›</button>
        </div>
      </div>

      <div className="sa-returns-weekdays" aria-hidden>
        {["Mon", "Tue", "Wed", "Thu", "Fri"].map((d) => <span key={d}>{d}</span>)}
      </div>
      <div className="sa-returns-grid">
        {slots.map((slot, i) => {
          if (!slot) return <div key={`blank-${i}`} className="sa-return-cell blank" />;
          const d = slot.datum;
          const selectedCell = selectedDate === slot.date;
          if (!d) return <div key={slot.date} className="sa-return-cell empty"><span className="date">{Number(slot.date.slice(8))}</span></div>;
          const up = (d.ret ?? 0) >= 0;
          return (
            <button key={d.date} type="button" className={`sa-return-cell ${up ? "up" : "down"} ${selectedCell ? "selected" : ""}`} onClick={() => setRequestedDate(d.date)}>
              <span className="date">{d.day}</span>
              <strong className="ret num">{pct(d.ret)}</strong>
              <span className="range num"><i>H {px(d.bar.h)}</i><i>L {px(d.bar.l)}</i></span>
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="sa-return-detail">
          <div className="sa-return-detail-head">
            <div>
              <b>{selected.date}</b>
              <span className={(selected.ret ?? 0) >= 0 ? "up" : "down"}>{pct(selected.ret)}</span>
            </div>
            <span className="num">O {px(selected.bar.o)} · H {px(selected.bar.h)} · L {px(selected.bar.l)} · C {px(selected.bar.c)}</span>
          </div>

          <div className="sa-session-grid">
            {SESSION_SPECS.map((spec) => {
              const s = sessions?.find((x) => x.key === spec.key) || null;
              return (
                <div key={spec.key} className="sa-session">
                  <div className="sa-session-name"><b>{pick(spec.en, spec.cn)}</b><span>{spec.hours} ET</span></div>
                  <strong className={s?.ret != null ? (s.ret >= 0 ? "up" : "down") : ""}>{s?.ret != null ? pct(s.ret) : "—"}</strong>
                  <span className="num">H {px(s?.high ?? null)} · L {px(s?.low ?? null)}</span>
                </div>
              );
            })}
          </div>

          <div className="sa-return-note">
            {detailState === "loading"
              ? pick("Loading session ranges…", "正在加载分时区间…")
              : !isUsEquity(symbol)
                ? pick("Extended-session breakdown is currently defined for U.S. equities.", "扩展时段拆分目前适用于美股。")
                : pick("Session ranges use eligible aggregate-bar OHLC. A dash means that session is not present in the historical feed; it is not estimated.", "分时区间采用合资格聚合 K 线 OHLC。破折号表示历史数据源中没有该时段数据，不进行估算。")}
          </div>
        </div>
      )}
    </section>
  );
}
