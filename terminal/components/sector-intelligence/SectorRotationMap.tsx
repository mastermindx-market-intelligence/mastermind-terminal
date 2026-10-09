"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useLang } from "@/lib/i18n";
import { formatValue, number, object, text, type FeedPayload, type FeedStatus, type Row, type SectorRotationHistory, type SectorRotationEpisodes, type SectorRotationMode } from "@/lib/sectorIntelligence";
import { qualifyRiskEnvelope, riskEnvelopeCopy } from "@/lib/marketRisk";

import styles from "./SectorRotationMap.module.css";

export type RotationQuadrant = "leading" | "improving" | "lagging" | "weakening";
export interface SectorRotationPoint {
  id: string;
  ticker: string;
  name: string;
  nameZh: string;
  accent: string | null;
  rs21: number | null;
  rs63: number | null;
  rank21: number | null;
  rank63: number | null;
  above200: boolean | null;
  heat1m: number | null;
  breadth: number | null;
  advancing: number | null;
  declining: number | null;
  sourceReadEn: string;
  sourceReadZh: string;
  quadrant: RotationQuadrant | null;
  sourceOrder: number;
}

export interface SectorRotationMapProps {
  rows: readonly Row[];
  status: FeedStatus;
  asOf: string | null;
  risk?: FeedPayload;
  selected: string;
  mode: SectorRotationMode;
  query: string;
  history?: SectorRotationHistory | null;
  historyStatus?: FeedStatus;
  /** Existing gateway content digest; invalidate date cursor on a corrected source version. */
  historyRevision?: string | null;
  episodes?: SectorRotationEpisodes | null;
  episodesStatus?: FeedStatus;
  onMode: (mode: SectorRotationMode) => void;
  onQuery: (query: string) => void;
  onSelect: (id: string) => void;
  onOpenResearch: (id: string) => void;
  onSources: () => void;
}

const COPY = {
  title: ["Rotation", "轮动"],
  answerLabel: ["Market read", "市场解读"],
  map: ["Map", "图表"], list: ["List", "列表"],
  viewMode: ["Rotation display", "轮动显示"],
  filter: ["Filter sectors", "筛选板块"],
  query: ["Find a sector", "搜索板块"], clear: ["Clear search", "清除搜索"],
  sourceDate: ["Source date", "来源日期"], unknownDate: ["Date unavailable", "日期不可用"],
  unavailableObservationDate: ["Unavailable source observation date:", "不可用来源的观测日期："],
  sectors: ["sectors", "个板块"], shown: ["shown", "已显示"],
  coordinates: ["coordinates available", "个坐标可用"],
  currentOnly: ["Current map remains the dated Sector Central snapshot; history selection never changes the current source population or axis scale.", "当前图表仍为带日期的板块中心快照；历史选择不会改变当前来源样本或坐标尺度。"],
  displayOnly: ["Display filtering never changes the source population or axis scale.", "显示筛选不会改变来源样本或坐标尺度。"],
  faster: ["21-session RS vs SPY", "相对SPY的21个交易日强度"],
  quarter: ["63-session RS vs SPY", "相对SPY的63个交易日强度"],
  stronger: ["Stronger quarter trend →", "季度趋势更强 →"],
  weaker: ["← Weaker quarter trend", "← 季度趋势更弱"],
  fasterUp: ["Fast strength improving ↑", "快速强度改善 ↑"],
  fasterDown: ["Fast strength weakening ↓", "快速强度走弱 ↓"],
  leading: ["Leading", "领先"], improving: ["Improving", "改善"],
  lagging: ["Lagging", "落后"], weakening: ["Weakening", "走弱"],
  selected: ["Selected sector", "所选板块"],
  selectPrompt: ["Select a sector to inspect its current source record.", "选择板块以查看当前来源记录。"],
  openResearch: ["Open sector research", "打开板块研究"],
  tactical: ["Tactical state", "战术状态"],
  trend: ["200-day trend", "200日趋势"], above: ["Above", "上方"], below: ["Below", "下方"], unavailable: ["Unavailable", "不可用"],
  monthReturn: ["1M sector return", "板块1个月收益"],
  participation: ["Advancing participation", "上涨参与度"],
  ranks: ["Leadership ranks", "领涨排名"],
  rankCopy: ["21-session / 63-session", "21个交易日 / 63个交易日"],
  noTrail: ["Historical trail unavailable", "历史轨迹不可用"],
  noTrailCopy: ["The current snapshot remains usable; no prior coordinates are inferred while the history owner is unavailable.", "当前快照仍可使用；历史来源不可用时不推断任何过去坐标。"],
  historyTitle: ["Historical trail", "历史轨迹"],
  historySource: ["Sector RS history", "板块相对强度历史"],
  historyProvenance: ["Reconstructed from sector/SPY price history — not a record of what Mastermind observed then.", "由板块/SPY历史价格重建——并非Mastermind当时实时观察的记录。"],
  historyDate: ["Historical date", "历史日期"],
  historyPoint: ["Historical coordinate", "历史坐标"],
  historyLoading: ["Historical trail is loading; the current snapshot remains available.", "历史轨迹正在加载；当前快照仍可使用。"],
  historyThin: ["Insufficient sector price history (fewer than 210 sessions); the current map remains available.", "板块历史价格不足（少于210个交易日）；当前图表仍可使用。"],
  historyCount: ["daily reconstructed points", "个每日重建点"],
  historyTrail: ["Selected sector · trailing 21 sessions on the current map scale", "所选板块 · 当前图表刻度上的近21个交易日轨迹"],
  historyClipped: ["Historical positions outside the current map scale are clipped; exact values remain in the date readout.", "超出当前图表刻度的历史位置已裁切；日期读数保留精确数值。"],
  cycleTurnsTitle: ["Retrospective price-cycle turns", "回溯重建的价格周期转折"],
  cycleTurnsCaveat: ["Current owner reconstruction — not a migration episode or a live-time confirmation. Marker status may change in later revisions.", "当前来源的回溯重建结果——并非资金轮动交棒事件，也非历史当时确认的信号；后续修订可能改变标记状态。"],
  cycleTurnsEmpty: ["No native price-cycle turns dated through the selected observation.", "截至所选观察日期，无来源提供的价格周期转折。"],
  cyclePeak: ["Price peak", "价格高点"], cycleTrough: ["Price trough", "价格低点"],
  cycleProvisional: ["currently provisional", "当前仍属暂定"],
  cycleMajor: ["owner-marked major swing", "来源标记的大幅波动"],
  cycleMagnitude: ["price-leg move", "价格区间变动"],
  nativeEpisodeTitle: ["Native RC closed episodes", "轮动命令原生已结束交棒事件"],
  nativeEpisodeCaveat: ["Owner's bounded recent closure ledger, not an as-known historical signal. These are not price-cycle turns or active trading calls; missing rows are not an all-clear.", "来源提供的近期已结束事件台账；并非历史当时可知的信号。它们不是价格周期转折或当前交易指令，缺失记录不等于安全无事。"],
  nativeEpisodeAsOf: ["RC source as of", "轮动来源截至"],
  nativeEpisodeLag: ["This source is older than the current Sector Central snapshot; a missing recent episode is not proof of no change.", "该来源早于当前板块中心快照；缺少近期事件不代表没有变化。"],
  nativeEpisodeEmpty: ["No closed episodes for this sector in this bounded source window; not an all-clear.", "该来源限定窗口内没有此板块的已结束交棒事件；不代表风险解除。"],
  nativeEpisodeUnavailable: ["Native episode source unavailable; no episode state can be inferred.", "原生事件来源不可用；不得推断事件状态。"],
  nativeEpisodeFrom: ["From", "原方向"], nativeEpisodeTo: ["To", "目标方向"],
  nativeEpisodeClosed: ["Closed", "结束"], nativeEpisodeRecorded: ["Receipt", "记录时间"],
  nativeEpisodeReason: ["Owner reason", "来源原因"],
  nativeEpisodeUnmarked: ["Retained ledger, natural first-seen unverified", "保留台账，未核验自然首次记录"],
  nativeEpisodeReplay: ["Reconstructed replay", "回溯重放"],
  method: ["Method and source", "方法与来源"],
  methodCopy: ["Horizontal: 63-session change in the sector/SPY relative-strength ratio. Vertical: 21-session change in the same ratio. Quadrants are sign-based and descriptive, not entry permission.", "横轴：板块/SPY相对强度比率的63个交易日变化；纵轴：同一比率的21个交易日变化。象限按正负划分，仅作描述，不授予入场资格。"],
  sector: ["Sector", "板块"], quadrant: ["Quadrant", "象限"],
  loading: ["Loading the rotation snapshot…", "正在加载轮动快照…"],
  access: ["Rotation data requires access.", "轮动数据需要访问权限。"],
  invalid: ["The rotation snapshot could not be read safely.", "无法安全读取轮动快照。"],
  empty: ["No readable sector rotation rows are available.", "暂无可读取的板块轮动数据。"],
  noMatches: ["No sectors match this display filter.", "没有板块符合此显示筛选。"],
  sources: ["Review sources", "查看来源"],
  missingCoordinates: ["missing one or both relative-strength coordinates", "缺少一个或两个相对强度坐标"],
  sourceBoundary: ["This is a focus lens, not a forecast or ranking mandate.", "这是聚焦视角，不是预测或排名指令。"],
} as const;

const integer = (value: unknown): number | null => {
  const parsed = number(value);
  return parsed !== null && parsed >= 0 && Number.isInteger(parsed) ? parsed : null;
};
const percentage = (value: unknown): number | null => {
  const parsed = number(value);
  return parsed !== null && parsed >= 0 && parsed <= 100 ? parsed : null;
};
const accent = (value: unknown): string | null => {
  const parsed = text(value);
  return /^#[0-9a-f]{6}$/i.test(parsed) ? parsed : null;
};

export function rotationQuadrant(rs63: number | null, rs21: number | null): RotationQuadrant | null {
  if (rs63 === null || rs21 === null) return null;
  if (rs63 >= 0 && rs21 >= 0) return "leading";
  if (rs63 < 0 && rs21 >= 0) return "improving";
  if (rs63 < 0 && rs21 < 0) return "lagging";
  return "weakening";
}

export function sectorRotationPoints(rows: readonly Row[]): SectorRotationPoint[] {
  return rows.map((row, sourceOrder) => {
    const momentum = object(row.momentum), heat = object(row.heat), rotation = object(row.rotation);
    const rs21 = number(momentum.rs_21d), rs63 = number(momentum.rs_63d);
    return {
      id: text(row.id), ticker: text(row.ticker), name: text(row.name), nameZh: text(row.name_zh), accent: accent(row.accent),
      rs21, rs63, rank21: integer(momentum.rs_21d_rank), rank63: integer(momentum.rs_rank),
      above200: typeof momentum.above_200d === "boolean" ? momentum.above_200d : null,
      heat1m: number(heat.heat_1M), breadth: percentage(heat.breadth_pct),
      advancing: integer(heat.adv), declining: integer(heat.dec),
      sourceReadEn: text(rotation.state_plain_en), sourceReadZh: text(rotation.state_plain_zh),
      quadrant: rotationQuadrant(rs63, rs21), sourceOrder,
    };
  });
}

export function rotationDomain(points: readonly SectorRotationPoint[]): number {
  const values = points.flatMap(point => [point.rs21, point.rs63]).filter((value): value is number => value !== null);
  const maximum = values.length ? Math.max(...values.map(Math.abs)) : 0;
  return Math.max(1, Math.ceil(maximum * 1.15 * 10) / 10);
}

/** Use the SAME snapshot-anchored axes for current dots and historical overlays. */
export function rotationPlotPercent(value: number, domain: number, invert = false): number {
  const normalized = Math.max(-domain, Math.min(domain, value));
  const percent = 7 + ((normalized + domain) / (domain * 2)) * 86;
  return invert ? 100 - percent : percent;
}

export function rotationHistoryTrail(
  points: readonly { date: string; rs21: number; rs63: number }[],
  selectedIndex: number,
  domain: number,
  maxSessions = 21,
): { points: { date: string; x: number; y: number }[]; clipped: boolean } {
  if (!Number.isFinite(domain) || domain <= 0 || selectedIndex < 0 || selectedIndex >= points.length) {
    return { points: [], clipped: false };
  }
  const selected = points.slice(Math.max(0, selectedIndex - maxSessions + 1), selectedIndex + 1);
  return {
    points: selected.map(point => ({
      date: point.date,
      x: Number(rotationPlotPercent(point.rs63, domain).toFixed(3)),
      y: Number(rotationPlotPercent(point.rs21, domain, true).toFixed(3)),
    })),
    clipped: selected.some(point => Math.abs(point.rs21) > domain || Math.abs(point.rs63) > domain),
  };
}

export function filterRotationPoints(points: readonly SectorRotationPoint[], query: string): SectorRotationPoint[] {
  const token = query.normalize("NFKC").trim().toLocaleLowerCase("en-US");
  if (!token) return [...points];
  return points.filter(point => [point.name, point.nameZh, point.ticker]
    .some(value => value.normalize("NFKC").toLocaleLowerCase("en-US").includes(token)));
}

export function rotationSynthesis(points: readonly SectorRotationPoint[], lang: "en" | "zh"): string | null {
  const complete = points.filter((point): point is SectorRotationPoint & { rs21: number; rs63: number } => point.rs21 !== null && point.rs63 !== null);
  if (!complete.length) return null;
  const localName = (point: SectorRotationPoint) => lang === "zh" ? point.nameZh || point.name : point.name;
  const positiveBoth = complete.filter(point => point.rs21 > 0 && point.rs63 > 0);
  const strongestQuarter = complete.reduce((best, point) => point.rs63 > best.rs63 ? point : best);
  const sentences: string[] = [];
  if (positiveBoth.length === 1) {
    sentences.push(lang === "zh"
      ? `${localName(positiveBoth[0])}是唯一在21日和63日相对强度均为正的板块。`
      : `${localName(positiveBoth[0])} is the only sector positive on both 21D and 63D relative strength.`);
  } else if (positiveBoth.length > 1) {
    sentences.push(lang === "zh"
      ? `${positiveBoth.length}个板块的21日和63日相对强度均为正。`
      : `${positiveBoth.length} sectors are positive on both 21D and 63D relative strength.`);
  } else {
    sentences.push(lang === "zh"
      ? "目前没有板块的21日和63日相对强度同时为正。"
      : "No sector is currently positive on both 21D and 63D relative strength.");
  }
  if (strongestQuarter.rs63 > 0 && (positiveBoth.length !== 1 || strongestQuarter.id !== positiveBoth[0].id)) {
    const fastState = strongestQuarter.rs21 < 0
      ? lang === "zh" ? "但其21日趋势为负。" : "but its 21D trend is negative."
      : strongestQuarter.rs21 > 0
        ? lang === "zh" ? "且其21日趋势仍为正。" : "and its 21D trend remains positive."
        : lang === "zh" ? "而其21日趋势持平。" : "while its 21D trend is flat.";
    sentences.push(lang === "zh"
      ? `${localName(strongestQuarter)}的63日相对强度最强，${fastState}`
      : `${localName(strongestQuarter)} has the strongest 63D relative strength, ${fastState}`);
  }
  return sentences.join(" ");
}

export function rotationReceipt(asOf: string | null, total: number, lang: "en" | "zh"): string {
  const match = asOf?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const count = lang === "zh" ? `${total}个板块` : `${total} sectors`;
  if (!match) return count;
  const month = Number(match[2]), day = Number(match[3]);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const date = lang === "zh" ? `${month}月${day}日` : `${months[month - 1]} ${day}`;
  return `${date} · ${count}`;
}

function rotationHistoryDate(day: string, lang: "en" | "zh"): string {
  const match = day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return day;
  const month = Number(match[2]), date = Number(match[3]);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return lang === "zh" ? `${month}月${date}日` : `${months[month - 1]} ${date}`;
}

function sign(value: number | null, digits = 1, suffix = "%"): string {
  return formatValue(value, digits, suffix, true);
}

export default function SectorRotationMap(props: SectorRotationMapProps) {
  const { lang } = useLang();
  const [qualificationTime, setQualificationTime] = useState(Date.now);
  useEffect(() => {
    const recheck = () => setQualificationTime(Date.now());
    const timer = window.setInterval(recheck, 60_000);
    window.addEventListener("focus", recheck);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", recheck); };
  }, []);
  const t = (key: keyof typeof COPY) => COPY[key][lang === "zh" ? 1 : 0];
  const points = useMemo(() => props.status === "ready" ? sectorRotationPoints(props.rows) : [], [props.rows, props.status]);
  const filtered = useMemo(() => filterRotationPoints(points, props.query), [points, props.query]);
  const plotted = filtered.filter(point => point.rs21 !== null && point.rs63 !== null);
  const allPlotted = points.filter(point => point.rs21 !== null && point.rs63 !== null);
  const domain = rotationDomain(points);
  const selected = points.find(point => point.id === props.selected) || null;
  const language = lang === "zh" ? "zh" : "en";
  const synthesis = useMemo(() => rotationSynthesis(points, language), [points, language]);
  const receipt = rotationReceipt(props.asOf, points.length, language);
  const riskRead = props.risk?.receipt.status === "ready" && !props.risk.receipt.stale
    ? qualifyRiskEnvelope(props.risk.data, undefined, qualificationTime) : null;
  const riskCopy = riskEnvelopeCopy(riskRead?.envelope ?? null, lang === "zh");
  const historyKey = `${props.selected}|${props.history?.asOf || ""}|${props.historyRevision || ""}`;
  const [historySelection, setHistorySelection] = useState<{ key: string; index: number | null }>({ key: "", index: null });
  const historyCursor = historySelection.key === historyKey ? historySelection.index : null;
  const historySeries = props.history?.series[props.selected] || null;
  const historyPoints = historySeries?.points || [];
  const historyIndex = historyPoints.length ? Math.min(historyCursor ?? historyPoints.length - 1, historyPoints.length - 1) : -1;
  const historical = historyIndex >= 0 ? historyPoints[historyIndex] : null;
  const historyConnected = props.historyStatus === "ready" && props.history !== null && !!historical;
  const historyTrail = historyConnected ? rotationHistoryTrail(historyPoints, historyIndex, domain) : null;
  const recentCycleTurns = historyConnected && historical && historySeries
    ? historySeries.cycleTurns.filter(turn => turn.date <= historical.date).slice(-3)
    : [];
  const nativeEpisodes = props.episodesStatus === "ready" ? props.episodes : null;
  const recentClosures = nativeEpisodes?.closedRecent.filter(event => event.sector === props.selected).slice(-3) || [];

  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const name = (point: SectorRotationPoint) => lang === "zh" ? point.nameZh || point.name : point.name;
  const quadrantName = (point: SectorRotationPoint) => point.quadrant ? t(point.quadrant) : t("unavailable");
  const position = (value: number, invert = false) => `${rotationPlotPercent(value, domain, invert)}%`;
  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>, id: string) => {
    const keys = plotted.map(point => point.id), index = keys.indexOf(id);
    const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    const target = event.key === "Home" ? 0 : event.key === "End" ? keys.length - 1 : delta && index >= 0 ? (index + delta + keys.length) % keys.length : -1;
    if (target < 0) return;
    event.preventDefault();
    const next = keys[target]; props.onSelect(next); refs.current[next]?.focus({ preventScroll: true });
  };
  const emptyCopy = props.status === "loading" ? t("loading") : props.status === "access" ? t("access")
    : props.status === "invalid" || props.status === "error" ? t("invalid") : t("empty");

  if (props.status !== "ready" || !points.length) return <section className={styles.root} data-testid="sector-rotation">
    <div className={styles.header}><h2>{t("title")}</h2></div>
    <div className={styles.empty} role="status"><p>{emptyCopy}</p><button type="button" onClick={props.onSources}>{t("sources")} →</button></div>
  </section>;

  return <section className={styles.root} data-testid="sector-rotation">
    <header className={styles.header}>
      <h2>{t("title")}</h2>
      <p className={styles.receipt} data-testid="rotation-receipt">{receipt}</p>
    </header>
    {synthesis && <div className={styles.answer} data-testid="rotation-answer">
      <span>{t("answerLabel")}</span><p>{synthesis}</p>
      <p className={styles.context} data-testid="rotation-risk-context">{riskCopy.caption}</p>
    </div>}
    <div className={styles.controls}>
      <div className={styles.mode} role="group" aria-label={t("viewMode")}>
        {(["map", "list"] as const).map(mode => <button type="button" key={mode} aria-pressed={props.mode === mode} onClick={() => props.onMode(mode)}>{t(mode)}</button>)}
      </div>
      <details className={styles.filter} data-rotation-filter open={props.query ? true : undefined}>
        <summary>{t("filter")}{props.query ? ` · ${filtered.length}/${points.length}` : ""}</summary>
        <div className={styles.filterBody}>
          <label>{t("query")}<input type="search" aria-label={t("query")} value={props.query} maxLength={60} autoComplete="off" onChange={event => props.onQuery(event.target.value)} /></label>
          <span aria-live="polite">{filtered.length} / {points.length} {t("shown")}</span>
          {props.query && <button type="button" className={styles.clear} onClick={() => props.onQuery("")}>{t("clear")}</button>}
        </div>
      </details>
    </div>

    {filtered.length === 0 ? <div className={styles.empty} role="status"><p>{t("noMatches")}</p><button type="button" onClick={() => props.onQuery("")}>{t("clear")}</button></div>
      : props.mode === "map" ? <div className={styles.mapLayout}>
        <div className={styles.plotWrap}>
          <div className={styles.plot} data-testid="rotation-plot" style={{ "--rotation-zero": "50%" } as CSSProperties}>
            <div className={`${styles.quadrant} ${styles.improving}`}><span>{t("improving")}</span></div>
            <div className={`${styles.quadrant} ${styles.leading}`}><span>{t("leading")}</span></div>
            <div className={`${styles.quadrant} ${styles.lagging}`}><span>{t("lagging")}</span></div>
            <div className={`${styles.quadrant} ${styles.weakening}`}><span>{t("weakening")}</span></div>
            <span className={styles.axisX} aria-hidden="true" /><span className={styles.axisY} aria-hidden="true" />
            <span className={styles.axisTop}>{t("fasterUp")}</span><span className={styles.axisBottom}>{t("fasterDown")}</span>
            <span className={styles.axisLeft}>{t("weaker")}</span><span className={styles.axisRight}>{t("stronger")}</span>
            {historyTrail && historyTrail.points.length > 0 && <svg className={styles.historyTrail} data-testid="rotation-history-trail"
              data-selected-date={historical?.date} data-clipped={historyTrail.clipped ? "true" : "false"}
              viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <polyline className={styles.historyTrailLine} points={historyTrail.points.map(point => `${point.x},${point.y}`).join(" ")} />
              <circle className={styles.historyTrailPoint} cx={historyTrail.points[historyTrail.points.length - 1].x}
                cy={historyTrail.points[historyTrail.points.length - 1].y} r="1.2" />
            </svg>}
            {plotted.map((point, index) => <button type="button" key={point.id} ref={node => { refs.current[point.id] = node; }}
              className={styles.point} data-sector-choice={point.id} data-sector-rotation-point={point.id} data-quadrant={point.quadrant || undefined}
              data-label-side={(["top", "right", "bottom", "left"] as const)[index % 4]} aria-pressed={props.selected === point.id}
              aria-label={`${name(point)} (${point.ticker}), ${quadrantName(point)}, ${t("faster")}: ${sign(point.rs21)}, ${t("quarter")}: ${sign(point.rs63)}`}
              style={{ left: position(point.rs63!), top: position(point.rs21!, true), "--rotation-accent": point.accent || "var(--brand)" } as CSSProperties}
              onClick={() => props.onSelect(point.id)} onKeyDown={event => moveFocus(event, point.id)}>
              <span className={styles.dot} aria-hidden="true" /><span className={styles.pointLabel}>{point.ticker}</span>
            </button>)}
          </div>
          <div className={styles.scale}><span>{sign(-domain)}</span><span>0</span><span>{sign(domain)}</span></div>
        </div>
        <RotationInspector point={selected} name={name} quadrantName={quadrantName} t={t} lang={lang} onOpen={props.onOpenResearch} />
      </div> : <div className={styles.listLayout}>
        <div className={styles.tableWrap}><table><thead><tr><th>{t("sector")}</th><th>{t("faster")}</th><th>{t("quarter")}</th><th>{t("quadrant")}</th><th>{t("participation")}</th></tr></thead>
          <tbody>{filtered.map(point => <tr key={point.id} aria-selected={props.selected === point.id}>
            <th><button type="button" data-sector-rotation-row={point.id} aria-pressed={props.selected === point.id} onClick={() => props.onSelect(point.id)}><span>{name(point)}</span><small>{point.ticker}</small></button></th>
            <td data-label={t("faster")} data-sign={point.rs21 === null || point.rs21 === 0 ? undefined : point.rs21 > 0 ? "up" : "down"}>{sign(point.rs21)}</td>
            <td data-label={t("quarter")} data-sign={point.rs63 === null || point.rs63 === 0 ? undefined : point.rs63 > 0 ? "up" : "down"}>{sign(point.rs63)}</td>
            <td data-label={t("quadrant")}>{quadrantName(point)}</td>
            <td data-label={t("participation")}>{formatValue(point.breadth, 0, "%")}</td>
          </tr>)}</tbody></table></div>
        <RotationInspector point={selected} name={name} quadrantName={quadrantName} t={t} lang={lang} onOpen={props.onOpenResearch} />
      </div>}

    <section className={styles.history} data-testid="rotation-history" aria-label={t("historyTitle")}>
      <header><div><span>{t("historySource")}</span><h3>{t("historyTitle")}</h3></div>
        <small>{props.history?.asOf ? rotationHistoryDate(props.history.asOf, language) : t("unknownDate")}</small></header>
      {historyConnected && historical ? <>
        <p className={styles.historyProvenance}>{t("historyProvenance")}</p>
        <label className={styles.historyControl}>{t("historyDate")}
          <input type="range" min={0} max={Math.max(0, historyPoints.length - 1)} step={1} value={historyIndex}
            aria-label={t("historyDate")} onInput={event => setHistorySelection({ key: historyKey, index: Number(event.currentTarget.value) })} />
        </label>
        <div className={styles.historyRead} aria-live="polite">
          <time dateTime={historical.date}>{rotationHistoryDate(historical.date, language)}</time>
          <dl><div><dt>{t("faster")}</dt><dd>{sign(historical.rs21)}</dd></div>
            <div><dt>{t("quarter")}</dt><dd>{sign(historical.rs63)}</dd></div>
            <div><dt>{t("quadrant")}</dt><dd>{t(rotationQuadrant(historical.rs63, historical.rs21) || "unavailable")}</dd></div></dl>
        </div>
        <p className={styles.historyFoot}>{historyPoints.length} {t("historyCount")} · {t("historyTrail")}</p>
        {historyTrail?.clipped && <p className={styles.historyFoot}>{t("historyClipped")}</p>}
        <aside className={styles.cycleEvidence} role="note" data-testid="rotation-cycle-evidence">
          <h4>{t("cycleTurnsTitle")}</h4>
          <p>{t("cycleTurnsCaveat")}</p>
          {recentCycleTurns.length ? <ol>{recentCycleTurns.map(turn =>
            <li key={`${turn.date}:${turn.kind}`}>
              <time dateTime={turn.date}>{rotationHistoryDate(turn.date, language)}</time>
              <span>{t(turn.kind === "peak" ? "cyclePeak" : "cycleTrough")}</span>
              {turn.magnitudePct !== null && <small>{t("cycleMagnitude")}: {formatValue(turn.magnitudePct, 1, "%")}</small>}
              {turn.major && <small>{t("cycleMajor")}</small>}
              {turn.provisional && <small>{t("cycleProvisional")}</small>}
            </li>)}</ol> : <p>{t("cycleTurnsEmpty")}</p>}
        </aside>
      </> : <p className={styles.historyUnavailable}>{props.historyStatus === "loading" ? t("historyLoading") : props.historyStatus === "ready" && historySeries && !historyPoints.length ? t("historyThin") : `${t("noTrail")} · ${t("noTrailCopy")}`}</p>}
    </section>


    <section className={styles.nativeEpisodes} data-testid="rotation-native-episodes" aria-label={t("nativeEpisodeTitle")}>
      <h3>{t("nativeEpisodeTitle")}</h3>
      {nativeEpisodes ? <>
        <p>{t("nativeEpisodeCaveat")}</p>
        <p className={styles.nativeSourceClock}>{t("nativeEpisodeAsOf")}: <time dateTime={nativeEpisodes.sourceAsOf}>{rotationHistoryDate(nativeEpisodes.sourceAsOf, language)}</time></p>
        {props.asOf && nativeEpisodes.sourceAsOf < props.asOf && <p>{t("nativeEpisodeLag")}</p>}
        {recentClosures.length ? <ol>{recentClosures.map(event =>
          <li key={event.pairId + ":" + event.started + ":" + event.recordedAt}>
            <div className={styles.nativeEpisodePair}>
              <strong>{lang === "zh" ? event.fromNameZh : event.fromNameEn}</strong>
              <span aria-hidden="true">→</span>
              <strong>{lang === "zh" ? event.toNameZh : event.toNameEn}</strong>
            </div>
            <dl>
              <div><dt>{t("nativeEpisodeClosed")}</dt><dd><time dateTime={event.closedAsOf}>{rotationHistoryDate(event.closedAsOf, language)}</time></dd></div>
              <div><dt>{t("nativeEpisodeRecorded")}</dt><dd>{event.recordedAt}</dd></div>
              <div><dt>{t("nativeEpisodeReason")}</dt><dd>{event.reason.replaceAll("_", " ")}</dd></div>
            </dl>
            <small>{event.provenance === "RECONSTRUCTED_REPLAY" ? t("nativeEpisodeReplay") : t("nativeEpisodeUnmarked")}</small>
          </li>)}</ol> : <p>{t("nativeEpisodeEmpty")}</p>}
      </> : <p>{t("nativeEpisodeUnavailable")}</p>}
    </section>

    <div className={styles.disclosures}>
      <details data-rotation-method><summary>{t("method")}</summary><div className={styles.methodBody}>
        <p>{t("methodCopy")}</p>
        <div data-testid="rotation-risk-detail">
          {riskCopy.details.map(detail => <p key={detail}>{detail}</p>)}
          {(!riskRead?.qualified || props.risk?.receipt.stale) && props.risk?.receipt.asOf && <p>
            {t("unavailableObservationDate")} {props.risk.receipt.asOf}
          </p>}
        </div><p>{t("sourceBoundary")}</p><p>{t("currentOnly")} {t("displayOnly")}</p>
        <p><strong>{historyConnected ? t("historyTitle") : t("noTrail")}</strong> · {historyConnected ? t("historyProvenance") : t("noTrailCopy")}</p>

        <p>{allPlotted.length} / {points.length} {t("coordinates")}{points.some(point => point.quadrant === null)
          ? ` · ${points.filter(point => point.quadrant === null).length} ${t("missingCoordinates")}` : ""}.</p>
      </div></details>
      <button type="button" onClick={props.onSources}>{t("sources")} →</button>
    </div>
  </section>;
}

function RotationInspector({ point, name, quadrantName, t, lang, onOpen }: {
  point: SectorRotationPoint | null;
  name: (point: SectorRotationPoint) => string;
  quadrantName: (point: SectorRotationPoint) => string;
  t: (key: keyof typeof COPY) => string;
  lang: string;
  onOpen: (id: string) => void;
}) {
  if (!point) return <aside className={styles.inspector} data-testid="rotation-inspector"><span>{t("selected")}</span><p>{t("selectPrompt")}</p></aside>;
  const read = lang === "zh" ? point.sourceReadZh || point.sourceReadEn : point.sourceReadEn;
  const counts = point.advancing !== null && point.declining !== null ? `${point.advancing} / ${point.declining}` : "—";
  return <aside className={styles.inspector} data-testid="rotation-inspector">
    <span>{t("selected")}</span><div className={styles.inspectorTitle}><div><h3>{name(point)}</h3><p>{point.ticker} · {quadrantName(point)}</p></div><i style={{ "--rotation-accent": point.accent || "var(--brand)" } as CSSProperties} aria-hidden="true" /></div>
    {read && <p className={styles.sourceRead}><strong>{t("tactical")}</strong><span>{read}</span></p>}
    <dl>
      <div><dt>{t("faster")}</dt><dd>{sign(point.rs21)}</dd></div>
      <div><dt>{t("quarter")}</dt><dd>{sign(point.rs63)}</dd></div>
      <div><dt>{t("ranks")}</dt><dd>{point.rank21 ? `#${point.rank21}` : "—"} / {point.rank63 ? `#${point.rank63}` : "—"}<small>{t("rankCopy")}</small></dd></div>
      <div><dt>{t("trend")}</dt><dd>{point.above200 === null ? t("unavailable") : point.above200 ? t("above") : t("below")}</dd></div>
      <div><dt>{t("monthReturn")}</dt><dd>{sign(point.heat1m, 2)}</dd></div>
      <div><dt>{t("participation")}</dt><dd>{formatValue(point.breadth, 0, "%")}<small>{counts}</small></dd></div>
    </dl>
    <button type="button" data-sector-return-focus={`rotation-open-${point.id}`} onClick={event => { event.currentTarget.focus({ preventScroll: true }); onOpen(point.id); }}>{t("openResearch")} →</button>
  </aside>;
}
