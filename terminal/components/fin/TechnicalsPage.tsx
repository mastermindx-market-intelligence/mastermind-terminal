"use client";
/**
 * TechnicalsPage — the TradingView "Technicals" dashboard (BUILD-SPEC §3.4 FE2c,
 * spec/tech-seasonals.md). Everything is computed CLIENT-SIDE from bars via
 * lib/techRating.ts `computeRatings` (R13). Layout:
 *   - Timeframe pill row: daily-derived TFs (D / W / 1M via a local resample of
 *     the daily `bars`) are ALWAYS available; intraday pills (15m / 1h / 4h …)
 *     are enabled per intradayCapable(market) and fetch /api/intraday directly
 *     (no cache).
 *   - Signal gauges: Oscillators / Moving Averages.
 *   - Oscillators + Moving Averages tables (name+params, value, action).
 *   - Pivots table across Classic / Fibonacci / Camarilla / Woodie / DM.
 *
 * intradayCapable + isIntradayTf are imported from ChartPanel / intradaySources
 * (the frozen helpers) — not reimplemented. Null-safe: bars=[] → gauges show the
 * "No signal" empty state and tables render em-dashes.
 */
import { memo, useEffect, useMemo, useState, type CSSProperties } from "react";
import type { Bar } from "../../lib/fund";
import { computeRatings, type Ratings, type Vote, type PivotLevels } from "../../lib/techRating";
import { fmtDate, fmtNum, fmtPct, pick } from "../../lib/finFormat";
import { ArcGauge } from "../ui/ArcGauge";
import { buildYears, monthlyStats, MONTHS_EN, MONTHS_ZH } from "../../lib/seasonal";
import { arcStateLabel } from "../../lib/plainLabels";
import { intradayCapable } from "../ChartPanel";
import { classify, isIntradayTf } from "../../lib/intradaySources";
import { Disclaimer, readingToArc } from "./ForecastPage";

interface TechnicalsPageProps {
  sym: string;
  bars?: Bar[];
  zh?: boolean;
}

/* Timeframe menu: intraday pills first (enabled per market), then daily-derived. */
const INTRADAY_PILLS: { tf: string; en: string; zh: string }[] = [
  { tf: "15m", en: "15 minutes", zh: "15分钟" },
  { tf: "1h", en: "1 hour", zh: "1小时" },
  { tf: "4h", en: "4 hours", zh: "4小时" },
];
const DAILY_PILLS: { tf: string; en: string; zh: string }[] = [
  { tf: "D", en: "1 day", zh: "1天" },
  { tf: "W", en: "1 week", zh: "1周" },
  { tf: "1M", en: "1 month", zh: "1月" },
];

/* ISO week key (Mon-anchored) — matches ChartPanel.resampleTf convention. */
function weekKey(dateStr: string): string {
  const dt = new Date(dateStr.slice(0, 10) + "T00:00:00Z");
  const day = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - day);
  return dt.toISOString().slice(0, 10);
}
function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7);
}

/** Resample daily bars into W or 1M buckets (D passes through). */
function resampleDaily(daily: Bar[], tf: string): Bar[] {
  if (tf === "D") return daily;
  const keyOf = tf === "W" ? weekKey : monthKey;
  const out: Bar[] = [];
  let cur: Bar | null = null;
  let curKey = "";
  for (const b of daily) {
    const k = keyOf(String(b.time));
    if (k !== curKey) {
      if (cur) out.push(cur);
      cur = { time: b.time, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v };
      curKey = k;
    } else if (cur) {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.v += b.v;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Map an intraday /api/intraday payload (array-of-6) to Bar[]. */
function toBars(rows: any[]): Bar[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((b) =>
    Array.isArray(b) ? { time: b[0], o: b[1], h: b[2], l: b[3], c: b[4], v: b[5] } : b,
  );
}

const voteClass = (v: Vote) => (v === "Buy" ? "up" : v === "Sell" ? "down" : "mut");

function voteWord(vote: Vote | undefined, zh: boolean): string {
  if (!vote) return pick(zh, "Unavailable", "不可用");
  if (vote === "Buy") return pick(zh, "Buy-side technical read", "偏强技术读数");
  if (vote === "Sell") return pick(zh, "Sell-side technical read", "偏弱技术读数");
  return pick(zh, "Neutral technical read", "中性技术读数");
}

function distancePct(price: number | null, reference: number | null): number | null {
  return price != null && reference != null && reference !== 0
    ? (price / reference - 1) * 100
    : null;
}

function levelDistancePct(price: number | null, level: number | null): number | null {
  return price != null && level != null && price !== 0
    ? (level / price - 1) * 100
    : null;
}

/* Every section on this page rides the analytical (brand) rail. */
const RAIL: CSSProperties = { "--rail": "var(--brand)" } as CSSProperties;

export default memo(TechnicalsPage);   // pure prop-driven page — skip re-render on the 6s live-quote poll
function TechnicalsPage({ sym, bars = [], zh = false }: TechnicalsPageProps) {
  const market = classify(sym);
  const canIntraday = intradayCapable(market);
  const [tf, setTf] = useState("D");
  const [intraBars, setIntraBars] = useState<Bar[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch intraday bars directly (no cache) when an intraday TF is selected.
  useEffect(() => {
    if (!isIntradayTf(tf)) {
      setIntraBars([]);
      return;
    }
    let alive = true;
    setLoading(true);
    fetch(`/api/intraday?sym=${encodeURIComponent(sym)}&tf=${encodeURIComponent(tf)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive) setIntraBars(toBars(d?.bars ?? []));
      })
      .catch(() => {
        if (alive) setIntraBars([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [sym, tf]);

  const active = useMemo<Bar[]>(() => {
    if (isIntradayTf(tf)) return intraBars;
    return resampleDaily(bars, tf);
  }, [tf, bars, intraBars]);

  const ratings = useMemo<Ratings | null>(() => {
    if (active.length < 30) return null;
    try {
      return computeRatings(active, tf);
    } catch {
      return null;
    }
  }, [active, tf]);


  const close = active.length ? active[active.length - 1].c : null;
  const oscRow = (name: string) => ratings?.oscillators.find((row) => row.name === name);
  const maRow = (name: string) => ratings?.mas.find((row) => row.name === name);
  const rsiRow = oscRow("RSI (14)");
  const macdRow = oscRow("MACD (12, 26, 9)");
  const sma20 = maRow("SMA (20)");
  const sma50 = maRow("SMA (50)");
  const sma200 = maRow("SMA (200)");
  const technicalGlance = [
    {
      id: "rsi",
      label: "RSI (14)",
      value: rsiRow?.value == null ? "—" : fmtNum(rsiRow.value, { decimals: 1 }),
      detail: voteWord(rsiRow?.vote, zh),
    },
    {
      id: "macd",
      label: "MACD (12, 26, 9)",
      value: macdRow?.value == null ? "—" : fmtNum(macdRow.value, { decimals: 2 }),
      detail: voteWord(macdRow?.vote, zh),
    },
    ...([
      [20, sma20],
      [50, sma50],
      [200, sma200],
    ] as const).map(([length, row]) => {
      const distance = distancePct(close, row?.value ?? null);
      return {
        id: `sma-${length}`,
        label: pick(zh, `vs SMA ${length}`, `较 SMA ${length}`),
        value: distance == null ? "—" : fmtPct(distance, { alreadyPct: true, sign: true, decimals: 2 }),
        detail: row?.value == null
          ? pick(zh, "Average unavailable", "均线不可用")
          : pick(zh, `SMA ${length} · ${fmtNum(row.value, { decimals: 2 })}`, `SMA ${length} · ${fmtNum(row.value, { decimals: 2 })}`),
      };
    }),
  ];

  const classic = ratings?.pivots.classic;
  const pivotLevels = [
    { key: "r2", label: "R2", value: classic?.r2 ?? null },
    { key: "r1", label: "R1", value: classic?.r1 ?? null },
    { key: "p", label: pick(zh, "Pivot", "枢轴"), value: classic?.p ?? null },
    { key: "s1", label: "S1", value: classic?.s1 ?? null },
    { key: "s2", label: "S2", value: classic?.s2 ?? null },
  ];
  const finiteLevels = pivotLevels.filter((level): level is typeof pivotLevels[number] & { value: number } => level.value != null && isFinite(level.value));
  const support = close == null
    ? null
    : finiteLevels.filter((level) => level.value <= close).sort((a, b) => b.value - a.value)[0] ?? null;
  const resistance = close == null
    ? null
    : finiteLevels.filter((level) => level.value >= close).sort((a, b) => a.value - b.value)[0] ?? null;

  const seasonalYears = useMemo(() => buildYears(bars), [bars]);
  const completedSeasonYears = useMemo(
    () => seasonalYears
      .filter((year) => !year.isCurrent && year.monthlyRet.every((value) => value != null && isFinite(value)))
      .slice(-5),
    [seasonalYears],
  );
  const seasonalMonths = useMemo(
    () => monthlyStats(completedSeasonYears, () => true),
    [completedSeasonYears],
  );
  const seasonMonthNames = zh ? MONTHS_ZH : MONTHS_EN;

  // provenance for the .fin-asof row: which bar basis fed the ratings, and how fresh it is.
  const tfMeta = [...INTRADAY_PILLS, ...DAILY_PILLS].find((p) => p.tf === tf);
  const tfLabel = tfMeta ? pick(zh, tfMeta.en, tfMeta.zh) : tf;
  const lastBar = active.length ? fmtDate(active[active.length - 1].time) : null;

  return (
    <div className="fin-tech fin-market-vnext" data-market-vnext="">
      <section className="fin-market-state" data-market-vnext-state="">
        <header>
          <div>
            <span>{pick(zh, "MARKET TECHNICALS", "市场技术面")}</span>
            <h2>{pick(zh, "Deterministic indicator state", "确定性指标状态")}</h2>
            <p>
              {lastBar
                ? pick(zh, `${tfLabel} bars · through ${lastBar} · ${active.length} observations`, `${tfLabel} K线 · 截至 ${lastBar} · ${active.length} 个观测`)
                : pick(zh, `${tfLabel} bars · no data loaded`, `${tfLabel} K线 · 暂无数据`)}
            </p>
          </div>
          <div className="fin-tf-row">
            {canIntraday &&
              INTRADAY_PILLS.map((p) => (
                <button key={p.tf} className={"fin-tf-pill" + (tf === p.tf ? " on" : "")} onClick={() => setTf(p.tf)}>
                  {pick(zh, p.en, p.zh)}
                </button>
              ))}
            {DAILY_PILLS.map((p) => (
              <button key={p.tf} className={"fin-tf-pill" + (tf === p.tf ? " on" : "")} onClick={() => setTf(p.tf)}>
                {pick(zh, p.en, p.zh)}
              </button>
            ))}
          </div>
        </header>

        {loading && (
          <div className="fin-skel fin-tech-loading">
            <span className="fin-skel-sr" role="status">{pick(zh, "Loading intraday…", "加载盘中数据…")}</span>
          </div>
        )}

        <div className="fin-market-glance">
          {technicalGlance.map((item) => (
            <article key={item.id} data-metric={item.id}>
              <span>{item.label}</span>
              <strong className="num">{item.value}</strong>
              <small>{item.detail}</small>
            </article>
          ))}
        </div>
      </section>

      <div className="fin-market-primary-grid">
        <section className="fin-market-rating-card" data-market-vnext-rating="">
          <header>
            <div>
              <span>{pick(zh, "TECHNICAL RATING", "技术评级")}</span>
              <strong>{pick(zh, "Oscillators and moving averages", "震荡指标与移动平均")}</strong>
            </div>
            <small>{pick(zh, "Descriptive · not a trade signal", "描述性指标 · 并非交易信号")}</small>
          </header>
          <div className="fin-tech-summary">
            <Gauge title={pick(zh, "Oscillators", "震荡指标")} group={ratings?.summary[0]} zh={zh} />
            <Gauge title={pick(zh, "Moving Averages", "移动平均")} group={ratings?.summary[1]} zh={zh} />
          </div>
        </section>

      <section className="fin-market-seasonality" data-market-vnext-seasonality="">
        <header>
          <div>
            <span>{pick(zh, "SEASONALITY SNAPSHOT", "季节性快照")}</span>
            <strong>{pick(zh, "Average monthly return + positive-month frequency", "月均收益 + 正收益月份频率")}</strong>
          </div>
          <small>
            {pick(
              zh,
              `${completedSeasonYears.length} completed yearly observation${completedSeasonYears.length === 1 ? "" : "s"}`,
              `${completedSeasonYears.length} 个完整年度观测`,
            )}
          </small>
        </header>
        {completedSeasonYears.length > 0 ? (
          <div className="fin-market-season-months">
            {seasonalMonths.map((month) => (
              <article key={month.month}>
                <span>{seasonMonthNames[month.month]}</span>
                <strong className={month.mean == null ? "" : month.mean >= 0 ? "up" : "down"}>
                  {month.mean == null ? "—" : fmtPct(month.mean, { alreadyPct: true, sign: true, decimals: 1 })}
                </strong>
                <small>{month.wr == null ? "—" : pick(zh, `${Math.round(month.wr * 100)}% positive`, `${Math.round(month.wr * 100)}% 正收益`)}</small>
              </article>
            ))}
          </div>
        ) : (
          <div className="fin-empty fin-empty-lg" role="status">
            <div className="fin-empty-title">{pick(zh, "No complete seasonal sample", "暂无完整季节性样本")}</div>
            <div className="fin-empty-why">{pick(zh, "At least one fully observed prior calendar year is required for this snapshot.", "此快照至少需要一个完整观测的过往自然年。")}</div>
          </div>
        )}
        <footer>
          <span>{pick(zh, "Historical recurrence only; a small sample does not forecast the next move.", "仅描述历史重复性；小样本不能预测下一步走势。")}</span>
        </footer>
      </section>

        <section className="fin-market-pivot-card" data-market-vnext-pivots="">
          <header>
            <div>
              <span>{pick(zh, "PIVOT MAP", "枢轴图")}</span>
              <strong>{pick(zh, "Classic pivots from the prior completed bar", "基于上一根已完成K线的经典枢轴")}</strong>
            </div>
            <small>{close == null ? "—" : pick(zh, `Close ${fmtNum(close, { decimals: 2 })}`, `收盘 ${fmtNum(close, { decimals: 2 })}`)}</small>
          </header>
          <div className="fin-market-pivot-levels">
            {pivotLevels.map((level) => (
              <div key={level.key} data-level={level.key}>
                <span>{level.label}</span>
                <i />
                <strong className="num">{level.value == null ? "—" : fmtNum(level.value, { decimals: 2 })}</strong>
              </div>
            ))}
          </div>
          <div className="fin-market-pivot-reads">
            <div>
              <span>{pick(zh, "Nearest support", "最近支撑")}</span>
              <strong>{support ? `${support.label} · ${fmtNum(support.value, { decimals: 2 })}` : "—"}</strong>
              <small>{support ? fmtPct(levelDistancePct(close, support.value) ?? 0, { alreadyPct: true, sign: true, decimals: 2 }) : "—"}</small>
            </div>
            <div>
              <span>{pick(zh, "Classic pivot", "经典枢轴")}</span>
              <strong>{classic?.p == null ? "—" : fmtNum(classic.p, { decimals: 2 })}</strong>
              <small>{classic?.p == null ? "—" : fmtPct(levelDistancePct(close, classic.p) ?? 0, { alreadyPct: true, sign: true, decimals: 2 })}</small>
            </div>
            <div>
              <span>{pick(zh, "Nearest resistance", "最近阻力")}</span>
              <strong>{resistance ? `${resistance.label} · ${fmtNum(resistance.value, { decimals: 2 })}` : "—"}</strong>
              <small>{resistance ? fmtPct(levelDistancePct(close, resistance.value) ?? 0, { alreadyPct: true, sign: true, decimals: 2 }) : "—"}</small>
            </div>
          </div>
          <p>{pick(zh, "Pivots are deterministic price references, not forecasts.", "枢轴点是确定性的价格参考，而非预测。")}</p>
        </section>
      </div>

      {/* Oscillators + Moving Averages tables */}
      <div className="fin-grid2">
        <RatingTable title={pick(zh, "Oscillators", "震荡指标")} rows={ratings?.oscillators} valueFmt={(v) => fmtNum(v, { decimals: 2 })} zh={zh} />
        <RatingTable title={pick(zh, "Moving Averages", "移动平均")} rows={ratings?.mas} valueFmt={(v) => fmtNum(v, { decimals: 2 })} zh={zh} />
      </div>

      {/* Pivots */}
      <PivotsTable pivots={ratings?.pivots} zh={zh} />



      <Disclaimer zh={zh} />
    </div>
  );
}

function Gauge({
  title,
  group,
  zh,
}: {
  title: string;
  group: Ratings["summary"][number] | undefined;
  zh: boolean;
}) {
  const arc = readingToArc(group ? group.score : null);
  return (
    <div className="fin-tech-gauge">
      <div className="fin-tech-gauge-t">{title}</div>
      <div className="fin-arc-wrap">
        {group ? (() => {
          const arcState = arc.state;
          return (
          <>
            <ArcGauge
              value={arc.value}
              state={arcState}
              size={88}
              sublabel={verdictWord(group.verdict, zh)}
              stateTitle={arcStateLabel(arcState, zh ? "zh" : "en")}
            />
            {/* vote tally demoted beneath the arc (was the old gauge's counts row) */}
            <div className="fin-gauge-counts">
              <span className="down">{pick(zh, "Sell", "卖")} {group.sell}</span>
              <span className="mut">{pick(zh, "Neutral", "中性")} {group.neutral}</span>
              <span className="up">{pick(zh, "Buy", "买")} {group.buy}</span>
            </div>
          </>
          );
        })() : (
          // No bars yet → grey mid arc, numeral suppressed so an empty gauge can't
          // read as a real "50" score.
          <ArcGauge value={50} state="neutral" size={88} showValue={false} sublabel={pick(zh, "No signal", "无信号")} />
        )}
      </div>
    </div>
  );
}

function verdictWord(v: string, zh: boolean): string {
  if (!zh) return v;
  const map: Record<string, string> = {
    "Strong sell": "强烈卖出",
    Sell: "卖出",
    Neutral: "中性",
    Buy: "买入",
    "Strong buy": "强烈买入",
  };
  return map[v] ?? v;
}

function RatingTable({
  title,
  rows,
  valueFmt,
  zh,
}: {
  title: string;
  rows: { name: string; value: number | null; vote: Vote }[] | undefined;
  valueFmt: (v: number) => string;
  zh: boolean;
}) {
  const voteLabel = (v: Vote) => pick(zh, v, v === "Buy" ? "买入" : v === "Sell" ? "卖出" : "中性");
  return (
    <div className="fin-card fin-tech-tbl">
      <div className="fin-sec-h fin-rail fin-rule" style={RAIL}>
        {title}
      </div>
      <table className="fin-table fin-tech-table">
        <thead>
          <tr>
            <th className="fin-cell">{pick(zh, "Name", "名称")}</th>
            <th className="fin-cell fin-cell-num">{pick(zh, "Value", "数值")}</th>
            <th className="fin-cell fin-cell-num">{pick(zh, "Action", "信号")}</th>
          </tr>
        </thead>
        <tbody>
          {(rows ?? []).length === 0 ? (
            <tr>
              <td className="fin-cell" colSpan={3}>
                <span className="fin-empty-inline">{pick(zh, "No data", "暂无数据")}</span>
              </td>
            </tr>
          ) : (
            rows!.map((r) => (
              <tr className="fin-row" key={r.name}>
                <th className="fin-cell" scope="row">{r.name}</th>
                <td className="fin-cell fin-cell-num">{r.value != null ? valueFmt(r.value) : "—"}</td>
                <td className={"fin-cell fin-cell-num fin-tech-act " + voteClass(r.vote)}>{voteLabel(r.vote)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

const PIVOT_ROWS: (keyof Pick<PivotLevels, "r3" | "r2" | "r1" | "p" | "s1" | "s2" | "s3">)[] = [
  "r3",
  "r2",
  "r1",
  "p",
  "s1",
  "s2",
  "s3",
];
const PIVOT_LABEL: Record<string, string> = { r3: "R3", r2: "R2", r1: "R1", p: "P", s1: "S1", s2: "S2", s3: "S3" };

function PivotsTable({ pivots, zh }: { pivots: Ratings["pivots"] | undefined; zh: boolean }) {
  const methods: { key: keyof Ratings["pivots"]; label: string }[] = [
    { key: "classic", label: "Classic" },
    { key: "fibonacci", label: "Fibonacci" },
    { key: "camarilla", label: "Camarilla" },
    { key: "woodie", label: "Woodie" },
    { key: "demark", label: "DM" },
  ];
  return (
    <div className="fin-sec">
      <div className="fin-sec-h fin-rail fin-rule" style={RAIL}>
        {pick(zh, "Pivots", "枢轴点")}
      </div>
      <div className="fin-table-scroll">
        <table className="fin-table fin-tech-table fin-pivots">
          <thead>
            <tr>
              <th className="fin-cell">{pick(zh, "Pivot", "枢轴")}</th>
              {methods.map((m) => (
                <th key={m.key} className="fin-cell fin-cell-num">{m.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PIVOT_ROWS.map((lvl) => (
              <tr className="fin-row" key={lvl}>
                <th className="fin-cell" scope="row">{PIVOT_LABEL[lvl]}</th>
                {methods.map((m) => {
                  const v = pivots ? pivots[m.key][lvl] : null;
                  return (
                    <td key={m.key} className="fin-cell fin-cell-num">
                      {v != null ? fmtNum(v, { decimals: 2 }) : "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
