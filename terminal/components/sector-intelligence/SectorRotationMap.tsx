"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useLang } from "@/lib/i18n";
import { formatValue, number, object, text, type FeedPayload, type FeedStatus, type MeasuredRead, type Row, type SectorRotationHistory, type SectorRotationEpisodes, type SectorRotationMethod, type SectorRotationMode } from "@/lib/sectorIntelligence";
import { qualifyRiskEnvelope, riskEnvelopeCopy } from "@/lib/marketRisk";
import { placeRotation, placeRotationCohort, rotationContextLabel, rotationPlacementLabel, rotationShownReceipt, ROTATION_METHOD_INCUMBENT, ROTATION_METHOD_RELATIVE_TREND, type RotationPlacement, type RotationQuadrant } from "@/lib/rotationEligibility";
import { relativeTrendLatest, relativeTrendPlacement, relativeTrendTrail, RELATIVE_TREND_BOUNDARY_TOLERANCE, RELATIVE_TREND_CENTER, RELATIVE_TREND_TRAIL_WEEKS, type RelativeTrendObservation, type RelativeTrendStatus, type SectorRotationRelativeTrend } from "@/lib/rotationRelativeTrend";

import styles from "./SectorRotationMap.module.css";

export type { RotationQuadrant } from "@/lib/rotationEligibility";
/** The incumbent coordinates are the sector/SPY relative-strength ratio changes (see COPY.methodCopy). */
export const ROTATION_BENCHMARK = "SPY";
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
  /** Sign-based quadrant only when both coordinates are finite and off-axis; never defaulted. */
  quadrant: RotationQuadrant | null;
  /** Explicit placement: placed, on a boundary (exact zero on an axis) or unavailable with its reason. */
  placement: RotationPlacement;
  sourceOrder: number;
}

export interface SectorRotationMapProps {
  rows: readonly Row[];
  status: FeedStatus;
  asOf: string | null;
  /** Macro's measured_group_read coverage receipt; absence renders nothing. */
  measured?: MeasuredRead | null;
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
  /** Options R1 W2A: the explicit rotation method; the incumbent relative return is the default. */
  method?: SectorRotationMethod;
  /** The owner's weekly relative trend feed, centred on 100; absent while loading or unavailable. */
  relativeTrend?: SectorRotationRelativeTrend | null;
  relativeTrendStatus?: FeedStatus;
  /** The method switch renders only when the host can carry the choice in its address. */
  onMethod?: (method: SectorRotationMethod) => void;
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
  nativeEpisodeCutoff: ["Historical view filters closure and source receipt dates through", "历史视图按事件结束日期和来源记录日期筛选截至"],
  nativeEpisodeEmpty: ["No closed episodes for this sector in this bounded source window; not an all-clear.", "该来源限定窗口内没有此板块的已结束交棒事件；不代表风险解除。"],
  nativeEpisodeUnavailable: ["Native episode source unavailable; no episode state can be inferred.", "原生事件来源不可用；不得推断事件状态。"],
  nativeEpisodeExcluded: ["Closure records in this source not shown here (cross-sector pairs or records that failed source checks):", "此来源中未在此显示的已结束记录（跨板块交棒或未通过来源检查的记录）："],
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
  onBoundary: ["on an axis boundary", "处于坐标轴边界"],
  shelfTitle: ["Not placed in a quadrant", "未归入象限"],
  shelfBoundary: ["Exactly zero on an axis; drawn on the line, nearest", "坐标轴上恰为零；画在轴线上，最接近"],
  shelfUnavailable: ["Kept in the universe; not drawn and never counted as zero.", "仍计入全集；不绘制，也不以零代替。"],
  placedCount: ["placed", "已定位"], boundaryCount: ["on a boundary", "处于边界"], unavailableCount: ["not placed", "未定位"],
  sourceBoundary: ["This is a focus lens, not a forecast or ranking mandate.", "这是聚焦视角，不是预测或排名指令。"],
  methodGroup: ["Rotation method", "轮动方法"],
  methodIncumbent: ["Relative return · 63/21", "相对收益 · 63/21"],
  methodTrend: ["Relative trend · weekly EMA", "相对趋势 · 周EMA"],
  trendX: ["Relative trend", "相对趋势"],
  trendY: ["Trend momentum", "趋势动量"],
  trendStronger: ["Stronger relative trend →", "相对趋势更强 →"],
  trendWeaker: ["← Weaker relative trend", "← 相对趋势更弱"],
  trendUp: ["Momentum rising ↑", "动量上升 ↑"],
  trendDown: ["Momentum falling ↓", "动量下降 ↓"],
  trendWeekEnd: ["Week ending", "周截至"],
  trendStatus: ["Measurement", "测量状态"],
  trendObserved: ["Measured", "已测量"],
  trendBoundary: ["On the boundary band", "处于边界带"],
  trendWarming: ["Warming up", "预热中"],
  trendMissingEndpoint: ["Week end missing", "缺少周末数据"],
  trendInvalid: ["Unreadable input", "输入无法读取"],
  trendNoSeries: ["Not in the feed", "不在数据源中"],
  trendThin: ["Not enough history", "历史不足"],
  trendNoObservation: ["No completed week yet", "尚无已完成周"],
  trendWarmingWhy: ["fewer than 120 completed weeks since 2016-01-01; nothing is plotted until the warm-up ends", "自2016-01-01起不足120个已完成周；预热结束前不绘制"],
  trendMissingEndpointWhy: ["the week's last session was not available, so this week is not measured", "该周最后一个交易日数据缺失，因此本周未测量"],
  trendInvalidWhy: ["the owner's input for this week could not be read, so this week is not measured", "本周来源输入无法读取，因此本周未测量"],
  trendNoSeriesWhy: ["this sector is not in the relative trend feed", "该板块不在相对趋势数据源中"],
  trendThinWhy: ["not enough weekly history yet; nothing is plotted", "周度历史不足；不绘制"],
  trendNoObservationWhy: ["no completed week at or before the feed date", "数据源日期或之前没有已完成周"],
  trendShelfBoundary: ["Within the boundary band around 100; drawn on the line, nearest", "处于100附近的边界带内；画在轴线上，最接近"],
  trendShelfUnavailable: ["Not drawn and never read as 100:", "不绘制，也不以100代替："],
  trendMethodShort: ["relative trend · weekly EMA", "相对趋势 · 周EMA"],
  trendEndpointPolicy: ["completed weeks only, no back-shift", "仅完成周，不回移"],
  trendTrail: ["Selected sector · trailing 12 completed weeks on the current map scale; the trail breaks at any week that could not be measured.", "所选板块 · 当前图表刻度上的近12个已完成周轨迹；无法测量的周会使轨迹断开。"],
  trendTrailClipped: ["Trail positions outside the current map scale are clipped; exact values remain in the selected sector panel.", "超出当前图表刻度的轨迹位置已裁切；精确数值保留在所选板块面板。"],
  trendCoordinates: ["measured this week", "本周已测量"],
  trendMissingCoordinates: ["not measured this week", "本周未测量"],
  trendOnBoundary: ["on the boundary band", "处于边界带"],
  trendMethodCopy: ["Horizontal: the sector/SPY total-return ratio's 10-week EMA over its 40-week EMA, times 100. Vertical: a 3-week EMA of that value's 3-week change, times 100. Both read against 100; quadrants are descriptive, not entry permission.", "横轴：板块/SPY总回报比率的10周EMA除以40周EMA，再乘以100。纵轴：该值3周变化的3周EMA，再乘以100。两者均以100为基准；象限仅作描述，不授予入场资格。"],
  trendIndicatorCaveat: ["A reading of 105 is an indicator value, not a five-percent forecast.", "读数105是指标数值，不是5%的预测。"],
  trendMembershipCaveat: ["Sector membership is present-day; this is not a survivorship-free backtest claim.", "板块成分为当前成分；这不是无幸存者偏差的回测结论。"],
  trendEndpointCopy: ["Only completed weeks are plotted; the current week never appears until its last session has closed, and nothing is back-shifted.", "仅绘制已完成周；当前周在其最后一个交易日收盘前不会出现，且不作回移。"],
  trendOwnerFormula: ["Owner formula", "来源公式"], trendVintage: ["Feed vintage", "数据源版本"],
  trendUnavailable: ["The relative trend feed is unavailable; the relative return method remains available.", "相对趋势数据源不可用；相对收益方法仍可使用。"],
  trendFeedInvalid: ["The relative trend feed could not be read safely; the relative return method remains available.", "无法安全读取相对趋势数据源；相对收益方法仍可使用。"],
  trendLoading: ["The relative trend feed is loading; the relative return method remains available.", "相对趋势数据源正在加载；相对收益方法仍可使用。"],
  trendAccess: ["The relative trend feed requires access; the relative return method remains available.", "相对趋势数据源需要访问权限；相对收益方法仍可使用。"],
  showIncumbent: ["Show relative return", "显示相对收益"],
} as const;

/** Options R1 W2A: the plain word and reason for each relative trend measurement status; owner codes never render. */
type RelativeTrendPointStatus = RelativeTrendStatus | "no_series" | "thin_history" | "no_observation";
const TREND_STATUS_COPY: Record<RelativeTrendPointStatus, { label: keyof typeof COPY; why: keyof typeof COPY | null }> = {
  observed: { label: "trendObserved", why: null },
  boundary: { label: "trendBoundary", why: null },
  warming_up: { label: "trendWarming", why: "trendWarmingWhy" },
  missing_endpoint: { label: "trendMissingEndpoint", why: "trendMissingEndpointWhy" },
  invalid_input: { label: "trendInvalid", why: "trendInvalidWhy" },
  no_series: { label: "trendNoSeries", why: "trendNoSeriesWhy" },
  thin_history: { label: "trendThin", why: "trendThinWhy" },
  no_observation: { label: "trendNoObservation", why: "trendNoObservationWhy" },
};

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

/** Quadrant of a placed coordinate pair; an exact zero on either axis is a boundary, not "leading". */
export function rotationQuadrant(rs63: number | null, rs21: number | null): RotationQuadrant | null {
  const placement = placeRotation(rs63, rs21);
  return placement.state === "placed" ? placement.quadrant : null;
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
      quadrant: rotationQuadrant(rs63, rs21), placement: placeRotation(rs63, rs21), sourceOrder,
    };
  });
}

/** Fixed calculation universe: counts come from every source row, never from the display filter. */
export function rotationUniverse(points: readonly SectorRotationPoint[]) {
  return placeRotationCohort(points.map(point => ({ id: point.id, rs63: point.rs63, rs21: point.rs21 })));
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

export function filterRotationPoints<T extends { name: string; nameZh: string; ticker: string }>(points: readonly T[], query: string): T[] {
  const token = query.normalize("NFKC").trim().toLocaleLowerCase("en-US");
  if (!token) return [...points];
  return points.filter(point => [point.name, point.nameZh, point.ticker]
    .some(value => value.normalize("NFKC").toLocaleLowerCase("en-US").includes(token)));
}

/** Options R1 W2A: one record per source sector under the relative trend method, read at the feed's single as-of clock. */
export interface RelativeTrendPoint {
  id: string;
  ticker: string;
  name: string;
  nameZh: string;
  accent: string | null;
  sourceOrder: number;
  x: number | null;
  y: number | null;
  weekEnd: string | null;
  status: RelativeTrendPointStatus;
  placement: RotationPlacement;
  quadrant: RotationQuadrant | null;
  /** Runs of consecutive measured weeks inside the trailing window, oldest first; a gap breaks the run. */
  trail: RelativeTrendObservation[][];
}

const measuresTrend = (status: RelativeTrendPointStatus) => status === "observed" || status === "boundary";

export function relativeTrendPoints(points: readonly SectorRotationPoint[], trend: SectorRotationRelativeTrend): RelativeTrendPoint[] {
  const byTicker = new Map(Object.values(trend.series).map(series => [series.ticker, series] as const));
  return points.map(point => {
    const base = { id: point.id, ticker: point.ticker, name: point.name, nameZh: point.nameZh, accent: point.accent, sourceOrder: point.sourceOrder };
    const unplaced = (status: RelativeTrendPointStatus, weekEnd: string | null): RelativeTrendPoint => ({
      ...base, x: null, y: null, weekEnd, status, quadrant: null, trail: [],
      placement: placeRotation(null, null, { measured: false, reasonCode: status }),
    });
    const series = Object.hasOwn(trend.series, point.id) ? trend.series[point.id] : byTicker.get(point.ticker) ?? null;
    if (!series) return unplaced("no_series", null);
    // Weeks after the feed date never reach the map: the feed's as-of day is the one clock for chart, list and receipt.
    const windowed = { ...series, observations: series.observations.filter(observation => observation.weekEnd <= trend.asOf) };
    const latest = relativeTrendLatest(windowed);
    if (!latest) return unplaced(series.reason === "thin_history" ? "thin_history" : "no_observation", null);
    if (!measuresTrend(latest.status) || latest.x === null || latest.y === null) return unplaced(latest.status, latest.weekEnd);
    const placement = relativeTrendPlacement(latest);
    return {
      ...base, x: latest.x, y: latest.y, weekEnd: latest.weekEnd, status: latest.status, placement,
      quadrant: placement.state === "placed" ? placement.quadrant : null,
      trail: relativeTrendTrail(windowed, RELATIVE_TREND_TRAIL_WEEKS),
    };
  });
}

/** Fixed calculation universe under the relative trend method: every source row, centred on 100 with the frozen band. */
export function relativeTrendUniverse(points: readonly RelativeTrendPoint[]) {
  return placeRotationCohort(
    points.map(point => ({ id: point.id, rs63: point.x, rs21: point.y, measured: measuresTrend(point.status), reasonCode: point.status })),
    { center: RELATIVE_TREND_CENTER, boundaryTolerance: RELATIVE_TREND_BOUNDARY_TOLERANCE },
  );
}

export function relativeTrendDomain(points: readonly RelativeTrendPoint[]): number {
  const values = points.flatMap(point => [point.x, point.y]).filter((value): value is number => value !== null);
  const maximum = values.length ? Math.max(...values.map(value => Math.abs(value - RELATIVE_TREND_CENTER))) : 0;
  return Math.max(1, Math.ceil(maximum * 1.15 * 10) / 10);
}

/** The selected sector's trailing runs on the current map scale; one polyline per run, never bridged across a gap. */
export function relativeTrendTrailPath(
  runs: readonly (readonly RelativeTrendObservation[])[],
  domain: number,
): { runs: { weekEnd: string; x: number; y: number }[][]; weeks: number; clipped: boolean } {
  if (!Number.isFinite(domain) || domain <= 0) return { runs: [], weeks: 0, clipped: false };
  const measured = runs
    .map(run => run.filter((observation): observation is RelativeTrendObservation & { x: number; y: number } => observation.x !== null && observation.y !== null))
    .filter(run => run.length > 0);
  return {
    runs: measured.map(run => run.map(observation => ({
      weekEnd: observation.weekEnd,
      x: Number(rotationPlotPercent(observation.x - RELATIVE_TREND_CENTER, domain).toFixed(3)),
      y: Number(rotationPlotPercent(observation.y - RELATIVE_TREND_CENTER, domain, true).toFixed(3)),
    }))),
    weeks: measured.reduce((total, run) => total + run.length, 0),
    clipped: measured.some(run => run.some(observation =>
      Math.abs(observation.x - RELATIVE_TREND_CENTER) > domain || Math.abs(observation.y - RELATIVE_TREND_CENTER) > domain)),
  };
}

export function relativeTrendSynthesis(points: readonly RelativeTrendPoint[], lang: "en" | "zh"): string | null {
  const zh = lang === "zh";
  const measured = points.filter((point): point is RelativeTrendPoint & { x: number; y: number } => point.x !== null && point.y !== null);
  const warming = points.filter(point => point.status === "warming_up").length;
  if (!measured.length && !warming) return null;
  const localName = (point: RelativeTrendPoint) => zh ? point.nameZh || point.name : point.name;
  const above = RELATIVE_TREND_CENTER + RELATIVE_TREND_BOUNDARY_TOLERANCE, below = RELATIVE_TREND_CENTER - RELATIVE_TREND_BOUNDARY_TOLERANCE;
  const sentences: string[] = [];
  if (measured.length) {
    const aboveBoth = measured.filter(point => point.placement.state === "placed" && point.placement.quadrant === "leading");
    const strongest = measured.reduce((best, point) => point.x > best.x ? point : best);
    if (aboveBoth.length === 1) {
      sentences.push(zh
        ? `${localName(aboveBoth[0])}是唯一相对趋势和趋势动量均高于100的板块。`
        : `${localName(aboveBoth[0])} is the only sector above 100 on both relative trend and trend momentum.`);
    } else if (aboveBoth.length > 1) {
      sentences.push(zh
        ? `${aboveBoth.length}个板块的相对趋势和趋势动量均高于100。`
        : `${aboveBoth.length} sectors are above 100 on both relative trend and trend momentum.`);
    } else {
      sentences.push(zh
        ? "目前没有板块的相对趋势和趋势动量同时高于100。"
        : "No sector is currently above 100 on both relative trend and trend momentum.");
    }
    if (strongest.x > above && (aboveBoth.length !== 1 || strongest.id !== aboveBoth[0].id)) {
      const momentum = strongest.y > above
        ? zh ? "且其动量高于100。" : "and its momentum is above 100."
        : strongest.y < below
          ? zh ? "但其动量低于100。" : "but its momentum is below 100."
          : zh ? "而其动量持平于100。" : "while its momentum sits at 100.";
      sentences.push(zh
        ? `${localName(strongest)}的相对趋势最强，${momentum}`
        : `${localName(strongest)} has the strongest relative trend, ${momentum}`);
    }
  }
  if (warming) {
    sentences.push(zh ? `${warming}个板块仍在预热。` : warming === 1 ? "1 sector is still warming up." : `${warming} sectors are still warming up.`);
  }
  return sentences.join(" ");
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
  const count = lang === "zh" ? `${total}个板块` : `${total} ${total === 1 ? "sector" : "sectors"}`;
  if (!match) return count;
  const month = Number(match[2]), day = Number(match[3]);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const date = lang === "zh" ? `${month}月${day}日` : `${months[month - 1]} ${day}`;
  return `${date} · ${count}`;
}

/** Owner reason codes stay owner-side; the view renders a plain word, never the raw code. */
const MEASURED_REASON: Record<string, readonly [string, string]> = {
  missing_input: ["no price data for this sector today", "今日缺少该板块价格数据"],
  thin_history: ["not enough price history yet", "价格历史不足"],
  non_finite_input: ["the price data could not be read", "价格数据无法读取"],
};

/** One coverage receipt line for Macro's measured read, or null when nothing may be claimed. */
export function measuredCoverageReceipt(read: MeasuredRead | null | undefined, pageAsOf: string | null, lang: "en" | "zh"): string | null {
  if (!read || read.state === "absent") return null;
  const zh = lang === "zh";
  if (read.state === "outage") return zh ? "今日未能生成实测读数。" : "Measured read could not be produced today.";
  if (read.state === "invalid") return zh ? "实测读数无法校验，因此不显示。" : "Measured read could not be checked, so it is not shown.";
  const parts: string[] = [];
  if (typeof read.measuredN === "number" && typeof read.expectedN === "number") {
    parts.push(zh ? `已测 ${read.measuredN} / ${read.expectedN} 个板块` : `Measured ${read.measuredN} of ${read.expectedN} sectors`);
  } else {
    parts.push(zh ? "未报告实测覆盖" : "Measured coverage not reported");
  }
  if (read.unmeasured.length) {
    const items = read.unmeasured.map(group => {
      const known = group.reasonCode !== null && Object.hasOwn(MEASURED_REASON, group.reasonCode)
        ? MEASURED_REASON[group.reasonCode] : null;
      const reason = known ? known[zh ? 1 : 0] : zh ? "今日无法测量" : "could not be measured today";
      return zh ? `${group.nameZh || group.nameEn}（${reason}）` : `${group.nameEn} (${reason})`;
    });
    parts.push(zh ? ` · 未测：${items.join("、")}` : ` · not measured: ${items.join(", ")}`);
  }
  if (read.sessionEnd && pageAsOf && read.sessionEnd < pageAsOf) {
    parts.push(zh ? ` · 实测于 ${read.sessionEnd}，早于本页` : ` · measured ${read.sessionEnd}, older than this page`);
  }
  return parts.join("");
}

function rotationHistoryDate(day: string, lang: "en" | "zh"): string {
  const match = day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return day;
  const month = Number(match[2]), date = Number(match[3]);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return lang === "zh" ? `${match[1]}年${month}月${date}日` : `${months[month - 1]} ${date}, ${match[1]}`;
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
  // Options R1 W2A: the method is explicit; the incumbent relative return stays the default and is never relabelled.
  const trendMethod = props.method === "relative_trend_ema";
  const trend = trendMethod && props.relativeTrendStatus === "ready" ? props.relativeTrend ?? null : null;
  const points = useMemo(() => props.status === "ready" ? sectorRotationPoints(props.rows) : [], [props.rows, props.status]);
  const trendPoints = useMemo(() => trend ? relativeTrendPoints(points, trend) : [], [points, trend]);
  const filtered = useMemo(() => filterRotationPoints(points, props.query), [points, props.query]);
  const filteredIds = new Set(filtered.map(point => point.id));
  const trendFiltered = trendPoints.filter(point => filteredIds.has(point.id));
  const plotted = filtered.filter(point => point.rs21 !== null && point.rs63 !== null);
  const trendPlotted = trendFiltered.filter((point): point is RelativeTrendPoint & { x: number; y: number } => point.x !== null && point.y !== null);
  const allPlotted = points.filter(point => point.rs21 !== null && point.rs63 !== null);
  const trendMeasured = trendPoints.filter(point => point.x !== null && point.y !== null);
  const domain = trend ? relativeTrendDomain(trendPoints) : rotationDomain(points);
  const selected = points.find(point => point.id === props.selected) || null;
  const trendSelected = trendPoints.find(point => point.id === props.selected) || null;
  const language = lang === "zh" ? "zh" : "en";
  const synthesis = useMemo(() => trend ? relativeTrendSynthesis(trendPoints, language) : rotationSynthesis(points, language), [trend, trendPoints, points, language]);
  const receipt = rotationReceipt(trend ? trend.asOf : props.asOf, points.length, language);
  const measuredLine = measuredCoverageReceipt(props.measured, props.asOf, language);
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
  // The daily history trail belongs to the incumbent method; the trend method carries its own weekly trail.
  const historyConnected = !trendMethod && props.historyStatus === "ready" && props.history !== null && !!historical;
  const historyTrail = historyConnected ? rotationHistoryTrail(historyPoints, historyIndex, domain) : null;
  const recentCycleTurns = historyConnected && historical && historySeries
    ? historySeries.cycleTurns.filter(turn => turn.date <= historical.date).slice(-3)
    : [];
  const nativeEpisodes = props.episodesStatus === "ready" ? props.episodes : null;
  // A historical selection cannot display closures observed or recorded after that date.
  // These owner clocks are descriptive only, not verified natural first-seen evidence.
  const episodeCutoff = historyConnected && historical ? historical.date : null;
  const recentClosures = nativeEpisodes?.closedRecent.filter(event =>
    event.sector === props.selected
    && (!episodeCutoff || (event.closedAsOf <= episodeCutoff && event.recordedAt.slice(0, 10) <= episodeCutoff))
  ).slice(-3) || [];

  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const { plotRef, box: plotBox } = usePlotBox();
  const universe = useMemo(() => trend ? relativeTrendUniverse(trendPoints) : rotationUniverse(points), [trend, trendPoints, points]);
  const unplaced = filtered.filter(point => point.placement.state !== "placed");
  const trendUnplaced = trendFiltered.filter(point => point.placement.state !== "placed");
  const context = trend
    ? rotationContextLabel({ basis: "benchmark_relative_trend", benchmark: trend.method.benchmark, asOf: trend.asOf, method: ROTATION_METHOD_RELATIVE_TREND, vintage: trend.vintage }, language)
    : rotationContextLabel({ basis: "benchmark_relative", benchmark: ROTATION_BENCHMARK, asOf: props.asOf, method: ROTATION_METHOD_INCUMBENT }, language);
  const shown = rotationShownReceipt(filtered.length, points.length, language,
    trend ? { label: t("trendMethodShort"), vintage: trend.vintage, endpointPolicy: t("trendEndpointPolicy") } : undefined);
  const trendTrail = trend && trendSelected ? relativeTrendTrailPath(trendSelected.trail, domain) : null;
  // One formatter and one date for chart, list, inspector and receipt under the trend method.
  const trendValue = (value: number | null) => formatValue(value, 2);
  const trendDate = (weekEnd: string | null) => weekEnd ? rotationHistoryDate(weekEnd, language) : t("unknownDate");
  const trendStatusLabel = (status: RelativeTrendPointStatus) => t(TREND_STATUS_COPY[status].label);
  const trendStatusWhy = (status: RelativeTrendPointStatus) => { const key = TREND_STATUS_COPY[status].why; return key ? t(key) : ""; };
  const trendSign = (value: number | null) => value === null ? undefined
    : value > RELATIVE_TREND_CENTER + RELATIVE_TREND_BOUNDARY_TOLERANCE ? "up" : value < RELATIVE_TREND_CENTER - RELATIVE_TREND_BOUNDARY_TOLERANCE ? "down" : undefined;
  const name = (point: { name: string; nameZh: string }) => lang === "zh" ? point.nameZh || point.name : point.name;
  const quadrantName = (point: { placement: RotationPlacement }) => rotationPlacementLabel(point.placement, language);
  const position = (value: number, invert = false) => `${rotationPlotPercent(value, domain, invert)}%`;
  const trendPosition = (value: number, invert = false) => position(value - RELATIVE_TREND_CENTER, invert);
  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>, id: string) => {
    const keys = (trend ? trendPlotted : plotted).map(point => point.id), index = keys.indexOf(id);
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

  const methodSwitch = props.onMethod ? <div className={styles.mode} role="group" aria-label={t("methodGroup")}>
    <button type="button" aria-pressed={!trendMethod} onClick={() => props.onMethod?.("incumbent")}>{t("methodIncumbent")}</button>
    <button type="button" aria-pressed={trendMethod} onClick={() => props.onMethod?.("relative_trend_ema")}>{t("methodTrend")}</button>
  </div> : null;

  // The trend feed is missing: the switch stays usable and the way back is named; nothing is plotted as 100.
  if (trendMethod && !trend) return <section className={styles.root} data-testid="sector-rotation">
    <header className={styles.header}><h2>{t("title")}</h2></header>
    {methodSwitch && <div className={styles.controls}>{methodSwitch}</div>}
    <div className={styles.empty} role="status" data-testid="rotation-method-unavailable">
      <p>{props.relativeTrendStatus === "loading" ? t("trendLoading") : props.relativeTrendStatus === "access" ? t("trendAccess")
        : props.relativeTrendStatus === "ready" || props.relativeTrendStatus === "invalid" ? t("trendFeedInvalid") : t("trendUnavailable")}</p>
      {props.onMethod && <button type="button" onClick={() => props.onMethod?.("incumbent")}>{t("showIncumbent")}</button>}
      <button type="button" onClick={props.onSources}>{t("sources")} →</button>
    </div>
  </section>;

  return <section className={styles.root} data-testid="sector-rotation">
    <header className={styles.header}>
      <h2>{t("title")}</h2>
      <p className={styles.receipt} data-testid="rotation-receipt">{receipt}</p>
      <p className={styles.receipt} data-testid="rotation-context">{context} · {universe.counts.placed} {t("placedCount")}{universe.counts.boundary ? ` · ${universe.counts.boundary} ${t("boundaryCount")}` : ""}{universe.counts.unavailable ? ` · ${universe.counts.unavailable} ${t("unavailableCount")}` : ""}</p>
      {!trend && measuredLine && <p className={styles.receipt} data-testid="rotation-measured-coverage">{measuredLine}</p>}
    </header>
    {synthesis && <div className={styles.answer} data-testid="rotation-answer">
      <span>{t("answerLabel")}</span><p>{synthesis}</p>
      <p className={styles.context} data-testid="rotation-risk-context">{riskCopy.caption}</p>
    </div>}
    <div className={styles.controls}>
      {methodSwitch}
      <div className={styles.mode} role="group" aria-label={t("viewMode")}>
        {(["map", "list"] as const).map(mode => <button type="button" key={mode} aria-pressed={props.mode === mode} onClick={() => props.onMode(mode)}>{t(mode)}</button>)}
      </div>
      <details className={styles.filter} data-rotation-filter open={props.query ? true : undefined}>
        <summary>{t("filter")}{props.query ? ` · ${filtered.length}/${points.length}` : ""}</summary>
        <div className={styles.filterBody}>
          <label>{t("query")}<input type="search" aria-label={t("query")} value={props.query} maxLength={60} autoComplete="off" onChange={event => props.onQuery(event.target.value)} /></label>
          <span aria-live="polite" data-testid="rotation-shown">{shown}</span>
          {props.query && <button type="button" className={styles.clear} onClick={() => props.onQuery("")}>{t("clear")}</button>}
        </div>
      </details>
    </div>

    {filtered.length === 0 ? <div className={styles.empty} role="status"><p>{t("noMatches")}</p><button type="button" onClick={() => props.onQuery("")}>{t("clear")}</button></div>
      : props.mode === "map" ? <div className={styles.mapLayout}>
        <div className={styles.plotWrap}>
          <div className={styles.plot} data-testid="rotation-plot" ref={plotRef} style={{ "--rotation-zero": "50%" } as CSSProperties}>
            <div className={`${styles.quadrant} ${styles.improving}`}><span>{t("improving")}</span></div>
            <div className={`${styles.quadrant} ${styles.leading}`}><span>{t("leading")}</span></div>
            <div className={`${styles.quadrant} ${styles.lagging}`}><span>{t("lagging")}</span></div>
            <div className={`${styles.quadrant} ${styles.weakening}`}><span>{t("weakening")}</span></div>
            <span className={styles.axisX} aria-hidden="true" /><span className={styles.axisY} aria-hidden="true" />
            <span className={styles.axisTop}>{t(trend ? "trendUp" : "fasterUp")}</span><span className={styles.axisBottom}>{t(trend ? "trendDown" : "fasterDown")}</span>
            <span className={styles.axisLeft}>{t(trend ? "trendWeaker" : "weaker")}</span><span className={styles.axisRight}>{t(trend ? "trendStronger" : "stronger")}</span>
            {historyTrail && historyTrail.points.length > 0 && <svg className={styles.historyTrail} data-testid="rotation-history-trail"
              data-selected-date={historical?.date} data-clipped={historyTrail.clipped ? "true" : "false"}
              viewBox={`0 0 ${plotBox.width} ${plotBox.height}`} width={plotBox.width} height={plotBox.height} aria-hidden="true">
              <polyline className={styles.historyTrailLine} points={historyTrail.points.map(point => `${px(point.x, plotBox.width)},${px(point.y, plotBox.height)}`).join(" ")} />
              <circle className={styles.historyTrailPoint} cx={px(historyTrail.points[historyTrail.points.length - 1].x, plotBox.width)}
                cy={px(historyTrail.points[historyTrail.points.length - 1].y, plotBox.height)} r="4" />
            </svg>}
            {trendTrail && trendTrail.runs.length > 0 && <svg className={styles.historyTrail} data-testid="rotation-trend-trail"
              data-runs={trendTrail.runs.length} data-weeks={trendTrail.weeks} data-clipped={trendTrail.clipped ? "true" : "false"}
              viewBox={`0 0 ${plotBox.width} ${plotBox.height}`} width={plotBox.width} height={plotBox.height} aria-hidden="true">
              {trendTrail.runs.map(run => <polyline key={run[0].weekEnd} className={styles.historyTrailLine}
                points={run.map(point => `${px(point.x, plotBox.width)},${px(point.y, plotBox.height)}`).join(" ")} />)}
              <circle className={styles.historyTrailPoint} cx={px(trendTrail.runs[trendTrail.runs.length - 1].at(-1)!.x, plotBox.width)}
                cy={px(trendTrail.runs[trendTrail.runs.length - 1].at(-1)!.y, plotBox.height)} r="4" />
            </svg>}
            {trend ? trendPlotted.map((point, index) => <button type="button" key={point.id} ref={node => { refs.current[point.id] = node; }}
              className={styles.point} data-sector-choice={point.id} data-sector-rotation-point={point.id} data-quadrant={point.quadrant || undefined}
              data-placement={point.placement.state} // plain-language-ok: data attribute for CSS/tests, never rendered; the visible label is rotationPlacementLabel()
              data-label-side={(["top", "right", "bottom", "left"] as const)[index % 4]} aria-pressed={props.selected === point.id}
              aria-label={`${name(point)} (${point.ticker}), ${quadrantName(point)}, ${t("trendY")}: ${trendValue(point.y)}, ${t("trendX")}: ${trendValue(point.x)}, ${t("trendWeekEnd")} ${trendDate(point.weekEnd)}`}
              style={{ left: trendPosition(point.x), top: trendPosition(point.y, true), "--rotation-accent": point.accent || "var(--brand)" } as CSSProperties}
              onClick={() => props.onSelect(point.id)} onKeyDown={event => moveFocus(event, point.id)}>
              <span className={styles.dot} aria-hidden="true" /><span className={styles.pointLabel}>{point.ticker}</span>
            </button>) : plotted.map((point, index) => <button type="button" key={point.id} ref={node => { refs.current[point.id] = node; }}
              className={styles.point} data-sector-choice={point.id} data-sector-rotation-point={point.id} data-quadrant={point.quadrant || undefined}
              data-placement={point.placement.state} // plain-language-ok: data attribute for CSS/tests, never rendered; the visible label is rotationPlacementLabel()
              data-label-side={(["top", "right", "bottom", "left"] as const)[index % 4]} aria-pressed={props.selected === point.id}
              aria-label={`${name(point)} (${point.ticker}), ${quadrantName(point)}, ${t("faster")}: ${sign(point.rs21)}, ${t("quarter")}: ${sign(point.rs63)}`}
              style={{ left: position(point.rs63!), top: position(point.rs21!, true), "--rotation-accent": point.accent || "var(--brand)" } as CSSProperties}
              onClick={() => props.onSelect(point.id)} onKeyDown={event => moveFocus(event, point.id)}>
              <span className={styles.dot} aria-hidden="true" /><span className={styles.pointLabel}>{point.ticker}</span>
            </button>)}
          </div>
          <div className={styles.scale} data-testid="rotation-scale">{trend
            ? <><span>{formatValue(RELATIVE_TREND_CENTER - domain, 1)}</span><span>100</span><span>{formatValue(RELATIVE_TREND_CENTER + domain, 1)}</span></>
            : <><span>{sign(-domain)}</span><span>0</span><span>{sign(domain)}</span></>}</div>
          {trendTrail && trendTrail.runs.length > 0 && <p className={styles.trailNote} data-testid="rotation-trend-trail-note">
            {t("trendTrail")}{trendTrail.clipped ? ` ${t("trendTrailClipped")}` : ""}</p>}
          {trend ? <UnplacedShelf title={t("shelfTitle")} items={trendUnplaced.map(point => ({
            id: point.id, ticker: point.ticker, name: name(point), placement: point.placement.state,
            label: point.placement.state === "boundary" ? rotationPlacementLabel(point.placement, language) : trendStatusLabel(point.status),
            detail: point.placement.state === "boundary"
              ? `${t("trendShelfBoundary")} ${point.placement.nearest.map(quadrant => t(quadrant)).join(" / ")}.`
              : `${t("trendShelfUnavailable")} ${trendStatusWhy(point.status)}.`,
          }))} /> : <UnplacedShelf title={t("shelfTitle")} items={unplaced.map(point => ({
            id: point.id, ticker: point.ticker, name: name(point), placement: point.placement.state,
            label: rotationPlacementLabel(point.placement, language),
            detail: point.placement.state === "boundary"
              ? `${t("shelfBoundary")} ${point.placement.nearest.map(quadrant => t(quadrant)).join(" / ")}.`
              : t("shelfUnavailable"),
          }))} />}
        </div>
        {trend ? <TrendInspector point={trendSelected} name={name} quadrantName={quadrantName} t={t} value={trendValue} date={trendDate}
          statusLabel={trendStatusLabel} statusWhy={trendStatusWhy} onOpen={props.onOpenResearch} />
          : <RotationInspector point={selected} name={name} quadrantName={quadrantName} t={t} lang={lang} onOpen={props.onOpenResearch} />}
      </div> : trend ? <div className={styles.listLayout}>
        <div className={styles.tableWrap}><table><thead><tr><th>{t("sector")}</th><th>{t("trendY")}</th><th>{t("trendX")}</th><th>{t("quadrant")}</th><th>{t("trendWeekEnd")}</th></tr></thead>
          <tbody>{trendFiltered.map(point => <tr key={point.id} aria-selected={props.selected === point.id}>
            <th><button type="button" data-sector-rotation-row={point.id} aria-pressed={props.selected === point.id} onClick={() => props.onSelect(point.id)}><span>{name(point)}</span><small>{point.ticker}</small></button></th>
            <td data-label={t("trendY")} data-sign={trendSign(point.y)}>{trendValue(point.y)}</td>
            <td data-label={t("trendX")} data-sign={trendSign(point.x)}>{trendValue(point.x)}</td>
            <td data-label={t("quadrant")}>{quadrantName(point)}</td>
            <td data-label={t("trendWeekEnd")}>{trendDate(point.weekEnd)}</td>
          </tr>)}</tbody></table></div>
        <TrendInspector point={trendSelected} name={name} quadrantName={quadrantName} t={t} value={trendValue} date={trendDate}
          statusLabel={trendStatusLabel} statusWhy={trendStatusWhy} onOpen={props.onOpenResearch} />
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

    {!trendMethod && <section className={styles.history} data-testid="rotation-history" aria-label={t("historyTitle")}>
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
            <div><dt>{t("quadrant")}</dt><dd>{rotationPlacementLabel(placeRotation(historical.rs63, historical.rs21), language)}</dd></div></dl>
        </div>
        <p className={styles.historyFoot}>{historyPoints.length} {t("historyCount")} · {t("historyTrail")}</p>
        {historyTrail?.clipped && <p className={styles.historyFoot}>{t("historyClipped")}</p>}
        <aside className={styles.cycleEvidence} role="note" data-testid="rotation-cycle-evidence">
          <h4>{t("cycleTurnsTitle")}</h4>
          <p>{t("cycleTurnsCaveat")}</p>
          {recentCycleTurns.length ? <ol>{recentCycleTurns.map(turn =>
            <li key={turn.date}>
              <time dateTime={turn.date}>{rotationHistoryDate(turn.date, language)}</time>
              <span>{t(turn.kind === "peak" ? "cyclePeak" : "cycleTrough")}</span>
              {turn.magnitudePct !== null && <small>{t("cycleMagnitude")}: {formatValue(turn.magnitudePct, 1, "%")}</small>}
              {turn.major && <small>{t("cycleMajor")}</small>}
              {turn.provisional && <small>{t("cycleProvisional")}</small>}
            </li>)}</ol> : <p>{t("cycleTurnsEmpty")}</p>}
        </aside>
      </> : <p className={styles.historyUnavailable}>{props.historyStatus === "loading" ? t("historyLoading") : props.historyStatus === "ready" && historySeries && !historyPoints.length ? t("historyThin") : `${t("noTrail")} · ${t("noTrailCopy")}`}</p>}
    </section>}


    <section className={styles.nativeEpisodes} data-testid="rotation-native-episodes" aria-label={t("nativeEpisodeTitle")}>
      <h3>{t("nativeEpisodeTitle")}</h3>
      {nativeEpisodes ? <>
        <p>{t("nativeEpisodeCaveat")}</p>
        <p className={styles.nativeSourceClock}>{t("nativeEpisodeAsOf")}: <time dateTime={nativeEpisodes.sourceAsOf}>{rotationHistoryDate(nativeEpisodes.sourceAsOf, language)}</time></p>
        {episodeCutoff && episodeCutoff < nativeEpisodes.sourceAsOf && <p className={styles.nativeSourceClock}>
          {t("nativeEpisodeCutoff")} <time dateTime={episodeCutoff}>{rotationHistoryDate(episodeCutoff, language)}</time>.
        </p>}
        {props.asOf && nativeEpisodes.sourceAsOf < props.asOf && <p>{t("nativeEpisodeLag")}</p>}
        {nativeEpisodes.closedRecentExcluded.crossPair + nativeEpisodes.closedRecentExcluded.invalid > 0
          && <p className={styles.nativeSourceClock} data-testid="rotation-native-episodes-excluded"
            data-excluded-cross-pair={nativeEpisodes.closedRecentExcluded.crossPair}
            data-excluded-invalid={nativeEpisodes.closedRecentExcluded.invalid}>
            {t("nativeEpisodeExcluded")} {nativeEpisodes.closedRecentExcluded.crossPair + nativeEpisodes.closedRecentExcluded.invalid}
          </p>}
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
        {trend ? <>
          <p>{t("trendMethodCopy")}</p>
          <p>{t("trendIndicatorCaveat")} {t("trendMembershipCaveat")}</p>
          <p>{t("trendEndpointCopy")}</p>
          <p><strong>{t("trendOwnerFormula")}</strong> · <code>{trend.method.formula}</code> · {t("trendVintage")} <code>{trend.vintage}</code></p>
        </> : <p>{t("methodCopy")}</p>}
        <div data-testid="rotation-risk-detail">
          {riskCopy.details.map(detail => <p key={detail}>{detail}</p>)}
          {(!riskRead?.qualified || props.risk?.receipt.stale) && props.risk?.receipt.asOf && <p>
            {t("unavailableObservationDate")} {props.risk.receipt.asOf}
          </p>}
        </div><p>{t("sourceBoundary")}</p>{trend ? <p>{t("displayOnly")}</p> : <p>{t("currentOnly")} {t("displayOnly")}</p>}
        {!trendMethod && <p><strong>{historyConnected ? t("historyTitle") : t("noTrail")}</strong> · {historyConnected ? t("historyProvenance") : t("noTrailCopy")}</p>}

        {trend ? <p>{trendMeasured.length} / {points.length} {t("trendCoordinates")}{universe.counts.unavailable
          ? ` · ${universe.counts.unavailable} ${t("trendMissingCoordinates")}` : ""}{universe.counts.boundary
          ? ` · ${universe.counts.boundary} ${t("trendOnBoundary")}` : ""}.</p>
          : <p>{allPlotted.length} / {points.length} {t("coordinates")}{universe.counts.unavailable
          ? ` · ${universe.counts.unavailable} ${t("missingCoordinates")}` : ""}{universe.counts.boundary
          ? ` · ${universe.counts.boundary} ${t("onBoundary")}` : ""}.</p>}
      </div></details>
      <button type="button" onClick={props.onSources}>{t("sources")} →</button>
    </div>
  </section>;
}

/** Percent-of-plot coordinate to a CSS pixel so one SVG user unit is one pixel (svgChart R1/R2). */
function px(percent: number, size: number): number {
  return Number(((percent / 100) * size).toFixed(1));
}

const PLOT_FALLBACK = { width: 600, height: 560 };
/** Measure the plot box so the history trail is drawn in pixel units instead of a stretched 100×100 box.
 * The plot mounts after the loading and empty states, so the element arrives through a callback ref and the
 * measurement re-runs for every element that mounts; a ref object read once on mount would keep the fallback box. */
function usePlotBox(): { plotRef: (element: HTMLDivElement | null) => void; box: { width: number; height: number } } {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [box, setBox] = useState(PLOT_FALLBACK);
  useEffect(() => {
    if (!element) return;
    const read = () => {
      const width = element.clientWidth, height = element.clientHeight;
      if (width > 0 && height > 0) setBox(prev => Math.abs(prev.width - width) >= 1 || Math.abs(prev.height - height) >= 1 ? { width, height } : prev);
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return { plotRef: setElement, box };
}

interface ShelfItem {
  id: string;
  ticker: string;
  name: string;
  /** Plain placement or measurement word; owner codes never render. */
  label: string;
  detail: string;
  placement: RotationPlacement["state"];
}

function UnplacedShelf({ items, title }: { items: readonly ShelfItem[]; title: string }) {
  if (!items.length) return null;
  return <div className={styles.shelf} data-testid="rotation-unplaced" role="note" aria-label={title}>
    <span className={styles.shelfTitle}>{title}</span>
    <ul>{items.map(item => <li key={item.id} data-rotation-unplaced={item.id}
      data-placement={item.placement} // plain-language-ok: data attribute for CSS/tests, never rendered; the visible label is item.label below
    >
      <span className={styles.shelfTicker}>{item.ticker}</span>
      <span className={styles.shelfName}>{item.name}</span>
      <strong>{item.label}</strong>
      <small>{item.detail}</small>
    </li>)}</ul>
  </div>;
}

/** Options R1 W2A: the selected sector under the trend method reads the same value, date and status as the chart and list. */
function TrendInspector({ point, name, quadrantName, t, value, date, statusLabel, statusWhy, onOpen }: {
  point: RelativeTrendPoint | null;
  name: (point: RelativeTrendPoint) => string;
  quadrantName: (point: RelativeTrendPoint) => string;
  t: (key: keyof typeof COPY) => string;
  value: (value: number | null) => string;
  date: (weekEnd: string | null) => string;
  statusLabel: (status: RelativeTrendPointStatus) => string;
  statusWhy: (status: RelativeTrendPointStatus) => string;
  onOpen: (id: string) => void;
}) {
  if (!point) return <aside className={styles.inspector} data-testid="rotation-inspector"><span>{t("selected")}</span><p>{t("selectPrompt")}</p></aside>;
  const why = statusWhy(point.status);
  return <aside className={styles.inspector} data-testid="rotation-inspector">
    <span>{t("selected")}</span><div className={styles.inspectorTitle}><div><h3>{name(point)}</h3><p>{point.ticker} · {quadrantName(point)}</p></div><i style={{ "--rotation-accent": point.accent || "var(--brand)" } as CSSProperties} aria-hidden="true" /></div>
    <dl>
      <div><dt>{t("trendY")}</dt><dd>{value(point.y)}</dd></div>
      <div><dt>{t("trendX")}</dt><dd>{value(point.x)}</dd></div>
      <div><dt>{t("trendWeekEnd")}</dt><dd>{point.weekEnd ? <time dateTime={point.weekEnd}>{date(point.weekEnd)}</time> : date(null)}</dd></div>
      <div><dt>{t("trendStatus")}</dt><dd>{statusLabel(point.status)}{why && <small>{why}</small>}</dd></div>
    </dl>
    <button type="button" data-sector-return-focus={`rotation-open-${point.id}`} onClick={event => { event.currentTarget.focus({ preventScroll: true }); onOpen(point.id); }}>{t("openResearch")} →</button>
  </aside>;
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
