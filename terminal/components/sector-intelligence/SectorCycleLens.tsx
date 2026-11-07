"use client";
import { useState } from "react";
import { useLang } from "@/lib/i18n";
import {
  formatValue,
  type SectorRotationHistoryPoint,
} from "@/lib/sectorIntelligence";
import { CYCLE_PHASES, type CycleReading } from "@/lib/sectorCycleSnapshot";
import s from "./SectorCycleLens.module.css";
import SectorBasketCompare from "./SectorBasketCompare";
import type { CycleBasket } from "@/lib/sectorCycleBaskets";

const LEX = {
  title: ["Sector cycles", "板块周期"],
  all: ["Sectors by phase", "各板块周期阶段"],
  phase: ["Cycle phase", "周期阶段"],
  position: ["Cycle position", "周期位置"],
  above: ["Above 200-day average", "高于200日均线"],
  below: ["Below 200-day average", "低于200日均线"],
  basis: ["Price basis", "价格口径"],
  tr: ["Total-return fallback", "总回报替代口径"],
  missing: ["Not available", "暂无数据"],
  stale: ["Dated snapshot", "历史快照"],
  history: ["Strength vs SPY", "相对 SPY 强弱"],
  short: ["21 sessions", "21个交易日"],
  long: ["63 sessions", "63个交易日"],
  chart: ["Chart", "图表"],
  table: ["Data table", "数据表"],
  date: ["Observation date", "观测日期"],
  range: ["Chart range", "图表范围"],
  one: ["1 month", "1个月"],
  three: ["3 months", "3个月"],
  year: ["1 year", "1年"],
  turns: ["Price turns", "价格转折"],
  peak: ["Peak", "高点"],
  trough: ["Trough", "低点"],
  prov: ["Provisional", "暂定"],
  noTurns: ["No turns in this range", "所选范围无转折"],
  noHistory: ["No comparable closes", "无可比收盘数据"],
  details: ["How to read this", "读数说明"],
  method: [
    "The lines show the fund’s rolling 21- and 63-session total returns relative to SPY. Zero means it matched SPY. The cycle phase is the model’s reading at the snapshot date; past turns are reconstructed, not signals known at the time.",
    "曲线为基金相对 SPY 的滚动21和63个交易日总回报。零表示与 SPY 持平。周期阶段取自快照当日的模型；历史转折为事后重建，并非当时可用的信号。",
  ],
  Trough: ["Bottoming", "筑底"],
  Recovery: ["Recovering", "回升"],
  Expansion: ["Expanding", "扩张"],
  Peak: ["Topping", "见顶"],
  Downturn: ["Downturn", "回落"],
} as const;
const stamp = (d: string) => Date.parse(d + "T00:00:00Z");
const fmt = (v: number) => formatValue(v, 1, "%", true);
const ranges = [
  ["one", 21],
  ["three", 63],
  ["year", 252],
] as const;
function Plot({
  points,
  index,
}: {
  points: SectorRotationHistoryPoint[];
  index: number;
}) {
  const w = 600,
    h = 132,
    pad = 4,
    zero = h / 2,
    first = stamp(points[0].date),
    span = stamp(points[points.length - 1].date) - first;
  const max = Math.max(
    1,
    ...points.flatMap((p) => [Math.abs(p.rs21), Math.abs(p.rs63)]),
  );
  const x = (i: number) =>
    span
      ? pad + ((stamp(points[i].date) - first) / span) * (w - 2 * pad)
      : w / 2;
  const y = (v: number) => zero - (v / max) * (zero - pad);
  const p = points[index];
  const path = (key: "rs21" | "rs63") =>
    points
      .map(
        (a, i) =>
          `${i === 0 || stamp(a.date) - stamp(points[i - 1].date) > 4 * 86400000 ? "M" : "L"}${x(i).toFixed(2)},${y(a[key]).toFixed(2)}`,
      )
      .join(" ");
  return (
    <div className={s.graph} aria-hidden="true">
      <div className={s.axis}>
        <span>+{max.toFixed(1)}%</span>
        <span>0%</span>
        <span>−{max.toFixed(1)}%</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <path
          d={`M0 ${pad}H${w} M0 ${zero}H${w} M0 ${h - pad}H${w}`}
          className={s.grid}
        />
        <path d={path("rs21")} className={s.short} />
        <path d={path("rs63")} className={s.long} />
        <path d={`M${x(index)} 0V${h}`} className={s.cursor} />
        <circle cx={x(index)} cy={y(p.rs21)} r="3" className={s.dot} />
      </svg>
    </div>
  );
}
export default function SectorCycleLens({
  current,
  rows,
  baskets,
  stale,
  onSelect,
}: {
  current: CycleReading;
  rows: CycleReading[];
  baskets: CycleBasket[] | null;
  stale: boolean;
  onSelect: (id: string) => void;
}) {
  const zh = useLang().lang === "zh",
    t = (key: keyof typeof LEX) => LEX[key][zh ? 1 : 0];
  const [limit, setLimit] = useState<number>(63),
    [table, setTable] = useState(false),
    [selected, setSelected] = useState<string | null>(null);
  const pts = current.series.points.slice(-limit);
  const found = selected ? pts.findIndex((p) => p.date === selected) : -1;
  const i = found < 0 ? pts.length - 1 : found,
    point = pts[i];
  const turns = point
    ? current.series.cycleTurns
        .filter((v) => v.date >= pts[0].date && v.date <= point.date)
        .slice(-3)
        .reverse()
    : [];
  const groups = [...CYCLE_PHASES, null]
    .map((phase) => ({ phase, items: rows.filter((r) => r.phase === phase) }))
    .filter((g) => g.items.length);
  return (
    <section
      className={s.lens}
      data-testid="sector-cycle-lens"
      aria-label={t("title")}
    >
      <div className={s.hero}>
        <div className={s.top}>
          <span>
            {current.ticker} · {t("title")}
          </span>
          <time dateTime={current.asOf}>
            {stale && t("stale") + " · "}
            {current.asOf}
          </time>
        </div>
        <h2>
          {zh ? current.nameZh || current.name : current.name} <span> / </span>
          {current.phase ? t(current.phase) : t("missing")}
        </h2>
        <div className={s.meta}>
          <span>
            {t("position")}{" "}
            <b>
              {current.position === null ? "—" : current.position.toFixed(1)} /
              100
            </b>
          </span>
          <span>
            {current.above200 === null
              ? "—"
              : t(current.above200 ? "above" : "below")}
          </span>
          <span>
            {current.basis
              ? t(current.basis === "price" ? "basis" : "tr")
              : t("missing")}
          </span>
        </div>
      </div>
      <div className={s.layout}>
        <section className={s.plotCard}>
          <div className={s.tools}>
            <h3>{t("history")}</h3>
            <div className={s.toggle}>
              <button
                type="button"
                aria-pressed={!table}
                onClick={() => setTable(false)}
              >
                {t("chart")}
              </button>
              <button
                type="button"
                aria-pressed={table}
                onClick={() => setTable(true)}
              >
                {t("table")}
              </button>
            </div>
          </div>
          <div className={s.controls}>
            <label>
              {t("range")}{" "}
              <select
                value={limit}
                onChange={(e) => {
                  setLimit(Number(e.target.value));
                  setSelected(null);
                }}
              >
                {ranges.map(([k, n]) => (
                  <option key={k} value={n}>
                    {t(k)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {!point ? (
            <p role="status">{t("noHistory")}</p>
          ) : (
            <>
              <div className={s.metrics} data-testid="cycle-observation">
                <div>
                  <span>{t("short")}</span>
                  <strong>{fmt(point.rs21)}</strong>
                </div>
                <div>
                  <span>{t("long")}</span>
                  <strong>{fmt(point.rs63)}</strong>
                </div>
                <time dateTime={point.date}>{point.date}</time>
              </div>
              {table ? (
                <div className={s.scrollTable}>
                  <table>
                    <caption>{t("history")}</caption>
                    <thead>
                      <tr>
                        <th>{t("date")}</th>
                        <th>{t("short")}</th>
                        <th>{t("long")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...pts].reverse().map((p) => (
                        <tr key={p.date}>
                          <th scope="row">{p.date}</th>
                          <td>{fmt(p.rs21)}</td>
                          <td>{fmt(p.rs63)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <>
                  <Plot points={pts} index={i} />
                  <input
                    aria-label={t("date")}
                    aria-valuetext={point.date}
                    type="range"
                    min={0}
                    max={pts.length - 1}
                    step={1}
                    disabled={pts.length < 2}
                    value={i}
                    onChange={(e) =>
                      setSelected(pts[Number(e.target.value)].date)
                    }
                  />
                  <div className={s.dates}>
                    <span>{pts[0].date}</span>
                    <span>{pts[pts.length - 1].date}</span>
                  </div>
                </>
              )}
              <div className={s.turns}>
                <h4>{t("turns")}</h4>
                {turns.length ? (
                  turns.map((v) => (
                    <div key={v.date}>
                      <time>{v.date}</time>{" "}
                      <b>{t(v.kind === "peak" ? "peak" : "trough")}</b>{" "}
                      {v.provisional && <em>{t("prov")}</em>}
                    </div>
                  ))
                ) : (
                  <span>{t("noTurns")}</span>
                )}
              </div>
            </>
          )}
          <details>
            <summary>{t("details")}</summary>
            <p>{t("method")}</p>
          </details>
        </section>
        <aside className={s.rail}>
          <h3>{t("all")}</h3>
          {groups.map((g) => (
            <div key={g.phase || "unknown"}>
              <h4>
                {g.phase ? t(g.phase) : t("missing")}{" "}
                <span>{g.items.length}</span>
              </h4>
              {g.items.map((r) => (
                <button
                  key={r.id}
                  aria-pressed={current.id === r.id}
                  onClick={() => onSelect(r.id)}
                >
                  <span>{zh ? r.nameZh || r.name : r.name}</span>
                  <b>{r.ticker}</b>
                </button>
              ))}
            </div>
          ))}
        </aside>
      </div>
      {baskets && baskets.length > 0 && (
        <SectorBasketCompare
          key={current.asOf}
          rows={baskets}
          asOf={current.asOf}
        />
      )}
    </section>
  );
}
