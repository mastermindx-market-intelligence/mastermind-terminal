"use client";
import { useMemo } from "react";
import { returnSessions, type DailyMove } from "@/lib/returnsIntelligence";
import { dateLabel, pct, price, returnsT, tone } from "./returnsCopy";
import styles from "./ReturnsWorkspace.module.css";

export default function SessionCalendar({ moves, selected, onSelect, month, onMonth, zh, composite }: {
  moves: DailyMove[]; selected: string | null; onSelect: (day: string) => void; month: string; onMonth: (month: string) => void; zh: boolean; composite: boolean;
}) {
  const t = returnsT(zh), months = useMemo(() => [...new Set(moves.map(m => m.date.slice(0, 7)))], [moves]);
  const monthIndex = months.indexOf(month), first = `${month}-01`, start = new Date(first + "T12:00:00Z"), end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  const expected = new Set(returnSessions(first, `${month}-${String(end).padStart(2, "0")}`) ?? []), byDay = new Map(moves.map(m => [m.date, m]));
  const cells: (string | null)[] = [];
  const firstWeekday = start.getUTCDay();
  if (firstWeekday >= 1 && firstWeekday <= 5) for (let i = 1; i < firstWeekday; i++) cells.push(null);
  for (let day = 1; day <= end; day++) { const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), day)); if (d.getUTCDay() >= 1 && d.getUTCDay() <= 5) cells.push(`${month}-${String(day).padStart(2, "0")}`); }
  const detail = moves.find(m => m.date === selected), close = detail?.bar.close ?? null;
  const inMonth = moves.filter(m => m.date.startsWith(month) && m.returnPct !== null), ups = inMonth.filter(m => m.returnPct! > 0).length;
  return <section className={styles.calendarSection}>
    <div className={styles.calendarPanel}><div className={styles.panelHead}><div><h3>{t("calendar")}</h3><span>{t("calendarHint")}</span></div><div className={styles.monthNav}><button type="button" disabled={monthIndex <= 0} aria-label={t("previousMonth")} onClick={() => onMonth(months[monthIndex - 1])}>‹</button><strong>{dateLabel(first, zh, { month: "long", year: "numeric" })}</strong><button type="button" disabled={monthIndex < 0 || monthIndex >= months.length - 1} aria-label={t("nextMonth")} onClick={() => onMonth(months[monthIndex + 1])}>›</button></div></div>
      <div className={styles.calendarGrid} role="group" aria-label={t("calendar")}>{(zh ? ["一", "二", "三", "四", "五"] : ["Mon", "Tue", "Wed", "Thu", "Fri"]).map(day => <span className={styles.weekday} key={day}>{day}</span>)}
        {cells.map((day, i) => { if (!day) return <span key={`blank-${i}`} />; const move = byDay.get(day), value = move?.returnPct ?? null, closed = !expected.has(day); return <button type="button" key={day} className={styles.day} data-tone={tone(value)} data-intensity={value === null ? "none" : Math.abs(value) >= 3 ? "strong" : Math.abs(value) >= 1 ? "medium" : "soft"} data-selected={day === selected || undefined} disabled={!move} aria-pressed={day === selected} aria-label={`${day}: ${move ? pct(value) : closed ? t("closed") : t("missing")}`} onClick={() => onSelect(day)}><span>{Number(day.slice(-2))}</span><strong>{move ? pct(value) : closed ? "·" : "—"}</strong></button>; })}
      </div><div className={styles.calendarMeta}><span>{ups} / {inMonth.length} {t("up")}</span><span>{t("closeToClose")}</span></div>
    </div>
    <aside className={styles.dayInspector}><div className={styles.panelHead}><div><span>{t("selectedSession")}</span><h3>{selected ? dateLabel(selected, zh, { weekday: "short", month: "short", day: "numeric" }) : "—"}</h3></div><strong className={styles.dayReturn} data-tone={tone(detail?.returnPct)}>{pct(detail?.returnPct)}</strong></div>
      <div className={styles.ohlcGrid}>{([["open", detail?.bar.open], ["high", detail?.bar.high], ["low", detail?.bar.low], ["close", close]] as const).map(([key, value]) => <div key={key}><span>{t(key)}</span><b>{composite && key !== "close" ? "—" : price(value)}</b></div>)}</div>
      <div className={styles.sessionRows}><div><span>{t("openingGap")}</span><b data-tone={tone(detail?.openingGapPct)}>{pct(detail?.openingGapPct)}</b></div><div><span>{t("openToClose")}</span><b data-tone={tone(detail?.intradayPct)}>{pct(detail?.intradayPct)}</b></div><div><span>{t("closeToClose")}</span><b data-tone={tone(detail?.returnPct)}>{pct(detail?.returnPct)}</b></div></div>
      <details className={styles.smallDetails}><summary>{t("methodology")}</summary><p>{t("sessionHelp")}</p>{detail?.previousDate && <p>{t("previousClose")}: {detail.previousDate}</p>}</details>
    </aside>
  </section>;
}
