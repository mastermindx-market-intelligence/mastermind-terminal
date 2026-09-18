/**
 * surfaceStrings.ts — bilingual EN/ZH strings for the Surface + Session panes.
 * Pattern matches gexStrings.ts (each key → [English, 中文]; makeSurfaceT(lang)).
 *
 * HONESTY DOCTRINE (display-tier wording only):
 *   - The surface is a PREMIUM-FLOW field materialized from OPRA per-strike flow.
 *     Cadence is measured from the plotted timestamps — a configured producer target is
 *     not presented as achieved when the actual snapshots are sparse.
 *   - Greek surfaces are modeled signed exposures from observed quote snapshots plus
 *     prior-day OI. Their positive/negative sign is NEVER labelled premium inflow/outflow;
 *     absent Greek grids remain disabled/accruing rather than substituted.
 *   - No "validated" / "predictive" / directional-signal language.
 *   - translated strings MUST NOT appear in HTML title= attributes (CI-guarded) — use
 *     aria-label / visible spans.
 */

import type { Lang } from "@/lib/i18n";

const SURFACE_LEX = {
  // ── Tab / pane header ───────────────────────────────────────────────────────
  surfaceTab: ["Surface", "曲面"],
  surfaceTitle: ["Intraday Flow Surface", "盘中资金流曲面"],
  surfaceSubtitle: ["One session · observed OPRA snapshots by strike", "单个交易日 · 按行权价显示 OPRA 实测快照"],

  // ── Metric tabs (Net Prem live; greeks accruing) ────────────────────────────
  metricNetPrem: ["Net Prem", "净权利金"],
  metricGamma: ["Gamma", "伽马"],
  metricVanna: ["Vanna", "Vanna"],
  metricCharm: ["Charm", "Charm"],
  metricAccruing: [
    "accruing — ships with the greeks snapshotter",
    "累积中 — 将随希腊值快照器上线",
  ],
  metricLensAria: ["Surface metric", "曲面指标"],

  // ── Candle interval (does not resample the surface field) ───────────────────
  aggAria: ["Candle interval", "K线周期"],
  candleInterval: ["Candles", "K线"],
  agg1m: ["1m", "1分"],
  agg5m: ["5m", "5分"],
  agg15m: ["15m", "15分"],
  agg30m: ["30m", "30分"],

  // ── Controls ────────────────────────────────────────────────────────────────
  opacity: ["Opacity", "不透明度"],
  range: ["Range", "范围"],
  rangeAll: ["All", "全部"],
  strikeRangeAria: ["Strike range", "行权价范围"],
  opacityAria: ["Field opacity", "曲面不透明度"],

  // ── Price-axis framing (the y window is price-anchored, not strike-anchored) ─
  // The field spans every strike the range slider keeps; price spans a few dollars of
  // it. Framing the axis on the STRIKES squeezed the candles into a hairline, so the
  // default now frames PRICE and lets the field overflow — with both fits one click away.
  yFitPrice: ["Fit price", "贴合价格"],
  yFitStrikes: ["Fit strikes", "贴合行权价"],
  yFitAria: ["Price axis fit", "价格轴范围"],
  yFitPriceNone: ["no candles loaded for this session", "该交易日暂无K线数据"],
  yFitStrikesNone: ["no field painted yet", "尚未绘制曲面"],
  yZoomHint: [
    "shift + wheel — or wheel over the price axis — zooms price",
    "Shift + 滚轮（或在价格轴上滚动）缩放价格轴",
  ],

  // ── Time framing (x axis) ──────────────────────────────────────────────────
  timeWindow: ["Time", "时间"],
  timeWindowAria: ["Chart time window", "图表时间范围"],
  timeWindowSurface: ["Surface window", "曲面窗口"],
  timeWindowSession: ["Full session", "完整交易日"],
  timeWindowSurfaceAria: [
    "Fit the chart to the time covered by observed surface frames",
    "将图表贴合到实测曲面帧覆盖的时间",
  ],
  timeWindowSessionAria: [
    "Show the full selected trading session",
    "显示所选交易日的完整时段",
  ],

  // ── Crosshair readout pill ──────────────────────────────────────────────────
  strike: ["Strike", "行权价"],

  // ── Legend / stamps ─────────────────────────────────────────────────────────
  legendPos: ["inflow", "流入"],
  legendNeg: ["outflow", "流出"],
  legendExposurePos: ["positive exposure", "正敞口"],
  legendExposureNeg: ["negative exposure", "负敞口"],
  asOf: ["as of", "更新于"],
  cadenceLabel: ["cadence", "频率"],
  snapshots: ["snapshots", "个快照"],
  observedCadence: ["observed", "实测间隔"],
  cadencePending: ["cadence pending", "频率待测"],
  sessionLabel: ["session", "交易日"],
  dataStripSession: ["Session", "交易日"],
  dataStripSurface: ["Surface", "曲面"],
  dataStripPrice: ["Price", "价格"],
  observedOnly: ["Observed only · no interpolation", "仅实测 · 不插值"],
  modeledExposure: ["Modeled exposure · observed snapshots", "模型敞口 · 基于实测快照"],
  observedFrames: ["observed frames", "个实测帧"],

  // ── Empty / loading ─────────────────────────────────────────────────────────
  surfaceEmpty: ["No surface data yet — accruing.", "暂无曲面数据 — 累积中。"],
  surfaceLoading: ["Loading surface…", "加载曲面中…"],
  noFrame: ["No frame for this time.", "该时间点暂无数据。"],

  // ── Replay bar ──────────────────────────────────────────────────────────────
  replayFirst: ["First frame", "首帧"],
  replayPrev: ["Previous frame", "上一帧"],
  replayPlay: ["Play", "播放"],
  replayPause: ["Pause", "暂停"],
  replayNext: ["Next frame", "下一帧"],
  replayLast: ["Latest frame", "最新帧"],
  replaySpeedAria: ["Playback speed", "播放速度"],
  replayScrubAria: ["Scrub to frame", "拖动到指定帧"],
  replayLive: ["LATEST STORED", "最新已存帧"],
  replayRefreshFailed: ["Refresh unavailable · retaining stored frames", "刷新暂不可用 · 保留已存帧"],
  replaySelectionUnavailable: ["Selected observation unavailable", "所选观测暂无数据"],
  replayFrameOf: ["frame", "帧"],
  replayNoFrames: ["No frames — accruing.", "暂无帧 — 累积中。"],
  frameRailAria: ["Observed surface frames", "实测曲面帧"],
  frameRailLabel: ["Observed frames", "实测帧"],
  frameGapIrregular: ["uneven gaps", "间隔不均"],
  frameGapRegular: ["median gap", "中位间隔"],

  // ── Multi-day replay: session picker + archived-session badge ───────────────
  sessionPickerAria: ["Replay session", "回放交易日"],
  sessionToday: ["Latest session", "最新交易日"],
  sessionArchived: ["archived session", "历史交易日"],
  sessionArchivedNote: [
    "Replaying a past session. Everything below the scrubber describes that day, not today.",
    "正在回放历史交易日。滚动条以下的内容描述的是该交易日，而非今日。",
  ],
  sessionEmptyArchive: [
    "No frames stored for this session.",
    "该交易日没有保存的帧。",
  ],

  // ── Scrubber annotations: session structure ─────────────────────────────────
  bandsAria: ["Session structure", "交易时段结构"],
  bandOpen: ["OPEN", "开盘"],
  bandPower: ["POWER HOUR", "尾盘时段"],
  bandClose: ["CLOSE", "收盘"],
  bandOpenAria: ["Regular-hours open, 9:30 ET", "常规时段开盘，美东9:30"],
  bandPowerAria: ["Power hour, 15:00–16:00 ET", "尾盘时段，美东15:00–16:00"],
  bandCloseAria: ["Regular-hours close, 16:00 ET", "常规时段收盘，美东16:00"],

  // ── Data honesty note ───────────────────────────────────────────────────────
  surfaceNote: [
    "One selected-session OPRA per-strike field at its observed snapshot cadence. Candle intervals change price bars only; past fields appear in the session picker when retained.",
    "按所选交易日显示 OPRA 逐行权价资金流，并采用实测快照频率。K线周期仅改变价格K线；已保留的历史场会显示在交易日选择器中。",
  ],

  // ── Session Flow pane ───────────────────────────────────────────────────────
  sessionTab: ["Session", "盘中"],
  sessionTitle: ["Session Flow", "盘中资金流"],
  sessionCP: ["C+P", "认购+认沽"],
  sessionCalls: ["Calls", "认购"],
  sessionPuts: ["Puts", "认沽"],
  sessionCumulative: ["cumulative", "累计"],
  sessionPerMin: ["per-min", "每分钟"],
  sessionOffOpen: ["off open", "自开盘"],
  sessionFill: ["Fill", "填充"],
  sessionAbsolute: ["absolute", "绝对值"],
  sessionModeAria: ["Series mode", "序列模式"],
  sessionSideAria: ["Side", "方向"],
  sessionCallsChip: ["CALLS", "认购"],
  sessionPutsChip: ["PUTS", "认沽"],
  sessionFootnote: ["RTH premium since 9:30 ET", "自美东9:30起的常规时段权利金"],
  sessionPts: ["pts", "点"],
  sessionEmpty: ["No session flow yet — accruing.", "暂无盘中资金流 — 累积中。"],
  sessionOffOpenNote: ["Δ since 9:30 ET open", "自美东9:30开盘以来的变化"],
  // Replay-aware session flow: truncated to the scrubbed stamp, or withdrawn on a past
  // session (the per-minute tide is stored for the live session only — see PR body).
  sessionReplayNote: ["truncated to the replay time", "已截断至回放时点"],
  sessionArchivedTitle: ["Session flow is live-session only", "盘中资金流仅覆盖当日"],
  sessionArchivedBody: [
    "The per-minute premium tide is stored for today's session only — it is not kept for past dates, so there is nothing honest to draw here.",
    "逐分钟权利金资金流仅保存当日数据，历史交易日未保留，因此此处没有可如实呈现的内容。",
  ],

  // ── EOD stores under a replayed workspace (they must not pretend to time-travel) ──
  eodNotReplayed: ["EOD structure — not replayed", "收盘结构 — 不参与回放"],
  eodNotReplayedNote: [
    "This is the end-of-day structural snapshot. It has no intraday history, so it stays on its own as-of while the scrubber moves.",
    "这是收盘时点的结构快照，没有盘中历史数据，因此在拖动回放时仍停留在自身的更新时点。",
  ],

  // ── Strike hover popover + Intraday-Evolution modal (Wave 2E, RECON §4.2) ────
  popFromSpot: ["from spot", "距现价"],
  popClickHint: ["Click for evolution", "点击查看盘中演变"],
  evoTitle: ["Intraday Evolution", "盘中演变"],
  evoStrike: ["strike", "行权价"],
  evoClose: ["Close", "关闭"],
  evoCloseAria: ["Close (Esc)", "关闭（Esc）"],
  evoEscHint: ["Press Esc to close", "按 Esc 关闭"],
  evoSnapshots: ["snapshots", "快照"],
  evoSpot: ["Spot", "现价"],
  evoNow: ["NOW", "当前"],
  evoExpiryBreakdown: ["Expiry breakdown at NOW", "当前各到期日拆解"],
  evoNoSeries: ["No evolution for this strike yet.", "该行权价暂无演变数据。"],
  evoMetricAt: ["at this strike", "在该行权价"],

  // ── B4: point-in-time honesty for the expiry breakdown ──────────────────────
  // The per-expiry matrix is a single head-of-day fetch, so it describes the PRESENT,
  // not the scrubbed moment. Replayed → say so instead of mislabelling it "at NOW".
  evoExpiryReplayTitle: ["Expiry breakdown", "各到期日拆解"],
  evoExpiryReplayNote: [
    "Only available live — the per-expiry split is not stored for past moments in this session.",
    "仅在实时状态下可用 — 本交易日的历史时点未保存各到期日拆解数据。",
  ],
  evoReplayBadge: ["replay", "回放"],
  evoLiveBadge: ["live", "实时"],

  // ── Send-to-chart: pin a strike as a price level ────────────────────────────
  pinToChart: ["Pin to chart", "钉在图上"],
  pinnedUnpin: ["Unpin", "取消固定"],
  pinnedLabel: ["Pinned", "已固定"],
  pinnedClearAll: ["Clear all", "全部清除"],
  pinnedAria: ["Pinned strike levels", "已固定的行权价水平"],
  pinnedRemoveAria: ["Remove pinned level", "移除已固定水平"],
  pinnedSessionNote: ["Pins last for this session only", "固定项仅在本次会话内保留"],

  // ── Quad view ───────────────────────────────────────────────────────────────
  viewSingle: ["Single", "单图"],
  viewQuad: ["Quad", "四宫格"],
  viewAria: ["Field layout", "视图布局"],
  quadAria: ["Four synchronised metric fields", "四个同步指标曲面"],
  quadAccruing: ["accruing", "累积中"],
  quadSharedReplay: ["All four share one replay stamp", "四格共用同一回放时点"],

  // ── Style (theme) popover ───────────────────────────────────────────────────
  styleBtn: ["Style", "配色"],
  styleAria: ["Field colours", "曲面配色"],
  styleTitle: ["Field colours", "曲面配色"],
  stylePresets: ["Preset", "预设"],
  stylePerMetric: ["Per metric", "按指标"],
  stylePos: ["Inflow", "流入"],
  styleNeg: ["Outflow", "流出"],
  styleExposurePos: ["Positive exposure", "正敞口"],
  styleExposureNeg: ["Negative exposure", "负敞口"],
  styleReset: ["Reset to theme", "恢复主题默认"],
  styleClose: ["Done", "完成"],
  presetDefault: ["Theme default", "主题默认"],
  presetColorblind: ["Colourblind-safe", "色盲友好"],
  presetMono: ["Monochrome heat", "单色热度"],
  presetClassic: ["Classic", "经典"],
  styleDefaultNote: [
    "Theme default follows the up/down colours, so it flips with the language convention.",
    "主题默认跟随涨跌色，因此会随语言习惯自动切换。",
  ],

  // ── Contrast (R1.4 percentile normalization — "kill the bland") ─────────────
  styleContrast: ["Contrast", "对比度"],
  styleContrastAria: ["Field colour intensity", "曲面颜色强度"],
  // F7: the code implements a 95th-percentile CEILING only (no low-end floor) — "(5–95)"
  // implied a two-sided band that was never built. "(p95)" names exactly what runs.
  styleContrastBalanced: ["Balanced (p95)", "均衡（p95）"],
  styleContrastRaw: ["Raw", "原始"],
  styleContrastNote: [
    "Balanced clamps colour intensity to the 95th percentile of this frame's cells, so one outlier strike-minute cannot wash out the rest of the field. Raw uses the literal max.",
    "均衡模式将颜色强度截取到本帧数据的第95百分位，避免单个异常行权价-分钟冲淡整个曲面色彩。原始模式使用实际最大值。",
  ],

  // ── Nightly overlays: level lines / regime chip / OI Δ (all EOD-derived, drawn
  //     under an intraday field — see the toggle-row provenance note) ──────────
  overlaysGroup: ["Overlays", "叠加层"],
  overlaysAria: ["Nightly structural overlays", "隔夜结构叠加层"],
  levelsToggle: ["Levels", "关键位"],
  levelsToggleAria: ["Options levels overlay — call wall, put wall, gamma flip, expected move", "期权关键位叠加 — 看涨墙、看跌墙、伽马翻转、预期波动"],
  levelCallWall: ["Call wall", "看涨墙"],
  levelPutWall: ["Put wall", "看跌墙"],
  levelFlip: ["Gamma flip", "伽马翻转"],
  levelAbsGamma: ["Abs γ", "绝对伽马"],
  levelEmHi: ["EM+", "EM+"],
  levelEmLo: ["EM−", "EM−"],
  oiDeltaToggle: ["OI Δ", "未平仓变动"],
  // F11: Σ|ΔOI| across the movers list conflates strikes being BUILT and strikes being
  // UNWOUND (a strike can rank #1 purely from a large unwind) — "largest change" alone
  // read as directional-flavoured; "(built or shed)" says plainly it is neither.
  oiDeltaToggleAria: [
    "Highlight the 5 strikes with the largest open-interest changes (built or shed)",
    "高亮未平仓量变动最大的5个行权价（新增或减仓）",
  ],
  oiDeltaMoversNote: [
    "largest open-interest changes (built or shed)",
    "未平仓量变动最大（新增或减仓）",
  ],
  regimeChipAria: ["Gamma regime", "伽马状态"],
  regimeToFlip: ["to flip", "距翻转"],
  regimeStability: ["stability", "稳定度"],
  // Shared nightly-provenance idiom (mirrors ChartPanel's Options Levels legend row) —
  // every overlay sourced from a nightly options_hub/gex_state payload under this
  // intraday field carries the SAME "as of {date}" language, never a LIVE badge.
  nightlyAsOf: ["EOD {date}", "收盘 {date}"],
  nightlySigned: ["signed estimate", "带符号估计"],
  nightlyStale: ["{n} sessions old", "已过 {n} 个交易日"],
  nightlyNoDate: ["undated snapshot", "无日期快照"],
  nightlyNoCov: ["no coverage for this root", "该标的暂无数据覆盖"],
  nightlyLoading: ["loading…", "加载中…"],
  // F5: split from nightlyNoCov — an empty-status derivation (genuinely no coverage) must
  // not read the same as a hard fetch failure/outage/entitlement gate. Mirrors ChartPanel's
  // olUnavail exactly (same English string, same idea) so "levels unavailable" means one
  // thing across the app.
  nightlyUnavail: ["levels unavailable", "关键位暂不可用"],

  // ── Archived-session overlay honesty (F1) ───────────────────────────────────
  // Levels stays live during replay (gex_at:{ROOT}:{DATE} has a dated twin); regime and
  // OI Δ do not and are withdrawn outright — see lib/surfaceContract archivedOverlayPolicy
  // and GexDeskView's isArchived branch / archivedPaneNote (post-#344), whose honest-
  // withdrawn idiom this mirrors for the Surface tab.
  archivedLevelsMissing: ["no dated snapshot for this session", "该交易日无历史快照"],
  archivedEmOmitted: [
    "EM band unavailable for archived sessions",
    "历史交易日不提供预期波动区间",
  ],
  archivedOverlaysWithdrawn: [
    "Regime state and OI Δ describe the current session only — hidden while replaying an archived field.",
    "伽马状态与未平仓变动仅描述当前交易日——回放已归档曲面时予以隐藏。",
  ],

  // ── Alert from the drill modal ──────────────────────────────────────────────
  alertAtStrike: ["Alert me at this strike", "在该行权价提醒我"],
  alertCreating: ["Creating…", "创建中…"],
  alertCreated: ["Alert created", "提醒已创建"],
  alertFailed: ["Could not create the alert", "无法创建提醒"],
  alertCrossesAbove: ["when price crosses above", "当价格上穿"],
  alertCrossesBelow: ["when price crosses below", "当价格下穿"],
  alertSignIn: ["Sign in to set alerts", "登录后可设置提醒"],
  alertSignInCta: ["Sign in", "登录"],
  alertManage: ["Manage alerts", "管理提醒"],

  // ── Root picker honesty ─────────────────────────────────────────────────────
  rootPickerAria: ["Surface root", "曲面标的"],
  rootAvailable: ["Available", "可用"],
  rootNoSurface: ["No surface for {sym} yet", "{sym} 暂无曲面数据"],
  rootNoSurfaceHint: [
    "The field is materialised for these roots only. Others are not built yet — nothing is hidden.",
    "目前仅为以下标的生成曲面数据，其余尚未构建 — 并非隐藏内容。",
  ],

  // ── Provenance row (institutional pass, 2026-07-28) ─────────────────────────
  // Every data surface names its source next to its as-of. These are the two stores
  // this family actually reads — nothing here claims a feed we don't have.
  sourceOpra: ["OPRA per-strike flow", "OPRA 逐行权价资金流"],
  sourceGreek: ["OPRA quotes + prior-day OI · modeled exposure", "OPRA 报价 + 前一交易日 OI · 模型敞口"],
  sourceTide: ["OPRA premium tide", "OPRA 权利金资金流"],

  // ── Honest empty / building states: name the reason, never a bare "no data" ──
  // The existing one-liners stay as the TITLE; each `…Why` adds the second line stating
  // WHICH of: still accruing / needs a session / not stored — from state the component
  // already has.
  surfaceEmptyWhy: [
    "Stamps are written as the session runs — until the materializer has painted one there is nothing to shade. Nothing is hidden.",
    "曲面时点在交易时段内逐帧写入 — 物化程序绘制之前没有可着色的数据，并非隐藏内容。",
  ],
  surfaceLoadingWhy: ["Fetching the frame for this stamp.", "正在获取该时点的数据帧。"],
  replayNoFramesWhy: [
    "The scrubber needs a session with stored stamps; this root has none for the selected day.",
    "回放滚动条需要有已保存时点的交易日；该标的在所选日期没有可用时点。",
  ],
  sessionEmptyWhy: [
    "The tide accrues from the 9:30 ET open and needs at least two minutes before a line can be drawn.",
    "资金流自美东9:30开盘起累积，至少需要两分钟才能绘制曲线。",
  ],
  evoNoSeriesWhy: [
    "This strike carries no value in any realized stamp of the loaded session.",
    "在本交易日已实现的时点中，该行权价没有任何数值。",
  ],
} as const;

type SurfaceKey = keyof typeof SURFACE_LEX;

export function getSurfaceStr(lang: Lang, key: SurfaceKey): string {
  const entry = SURFACE_LEX[key];
  if (!entry) return "";
  return lang === "zh" ? entry[1] : entry[0];
}

export function makeSurfaceT(lang: Lang): (key: SurfaceKey) => string {
  return (key: SurfaceKey) => getSurfaceStr(lang, key);
}

export type { SurfaceKey };
