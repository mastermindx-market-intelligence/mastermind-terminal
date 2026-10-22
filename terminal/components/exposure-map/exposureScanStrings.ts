/** R2-PR5 scan-table copy — EN/ZH tuples, one key per visible string. Same
 * shape as exposureMapStrings.ts: `exposureScanT(lang)(key)`. Reason enums are
 * never rendered raw; each maps to a sentence through `reasonCopy`. */
const COPY = {
  gamma: ["Gamma", "伽马"],
  allExpiries: ["All expiries", "全部到期日"],
  admittedOnly: ["Admitted identity only", "仅已接纳身份"],
  sortScore: ["Sort: score", "排序：评分"],
  sortDistance: ["Sort: distance", "排序：距离"],
  sortShare: ["Sort: share", "排序：占比"],
  sortPreset: ["Sort: preset", "排序：预设"],
  refresh: ["Refresh", "刷新"],
  counts: ["{presets} presets · {scored} scored · {unscored} unscored", "{presets} 个预设 · {scored} 个已评分 · {unscored} 个未评分"],
  scannerTag: ["Scanner e7-reconstruction/v1 · rev {rev}", "扫描器 e7-reconstruction/v1 · 第 {rev} 版"],
  originalLine: ["Original {t} ET · latest rev {rev} {t2} ET", "原始 {t} ET · 最新第 {rev} 版 {t2} ET"],
  preset: ["PRESET", "预设"], metricScope: ["METRIC · SCOPE", "指标 · 范围"],
  dominant: ["DOMINANT", "主导"], share: ["SHARE", "占比"], contested: ["CONTESTED", "争夺"],
  distanceEm: ["DISTANCE · EM", "距离 · EM"], score: ["SCORE", "评分"], status: ["STATUS", "状态"],
  flags: ["FLAGS", "标记"],
  identityPending: ["identity pending", "身份待定"],
  scopeAll: ["Gamma · all {n}", "Gamma · 全部 {n} 个"],
  fit: ["fit {v}", "拟合 {v}"],
  contestedPill: ["contested", "争夺中"],
  statusCandidate: ["candidate", "候选"], statusContested: ["contested", "争夺"],
  statusUnscored: ["unscored", "未评分"],
  statusPartial: ["partial · {reason} · {pct}%", "部分 · {reason} · {pct}%"],
  statusMetricNotScanned: ["metric not scanned", "指标未扫描"],
  statusUnadmitted: ["identity unadmitted", "身份未接纳"],
  statusUnadmittedNext: ["identity unadmitted · next", "身份未接纳 · 下一个"],
  statusBookUnavailable: ["book unavailable", "账本不可用"],
  nodeMoved: ["node moved {a} → {b}", "节点移动 {a} → {b}"],
  contestedUp: ["contested ↑", "争夺 ↑"], contestedDown: ["contested ↓", "争夺 ↓"],
  scoreDelta: ["score Δ {v}", "评分 Δ {v}"],
  footerNull: ["A null score is a reason, never a zero. Partial books rank nowhere; Delta is not scanned in v1.", "空评分是一个原因，绝不是零。部分账本不参与排名；v1 不扫描 Delta。"],
  rollout: ["rollout order SPY · QQQ · SPXW · IWM · NDXP", "上线顺序 SPY · QQQ · SPXW · IWM · NDXP"],
  candidateK: ["CANDIDATE {k} / {n}", "候选 {k} / {n}"], row: ["ROW", "行"],
  scoreEligible: ["score · candidate eligible", "评分 · 符合候选"],
  scoreOutside: ["score · outside horizon", "评分 · 超出范围"],
  nullReason: ["null · {reason}", "空 · {reason}"],
  dominance: ["Dominance u", "主导度 u"], concentration: ["Concentration c", "集中度 c"],
  capped: ["capped", "已封顶"], strength: ["Strength", "强度"],
  distanceFit: ["Distance fit", "距离拟合"],
  emLine: ["{fit} · EM {em} · {pct}%", "{fit} · EM {em} · {pct}%"],
  regime: ["Regime", "状态"], regimeLine: ["×{m} · book net", "×{m} · 账本净额"],
  scanner: ["SCANNER", "扫描器"], scannerVersion: ["e7/v1", "e7/v1"],
  scannerBasis: ["gamma only · whole-population basis", "仅 Gamma · 全样本基准"],
  revisions: ["REVISIONS", "版本"],
  revOriginal: ["rev 1 original {t}", "第 1 版 原始 {t}"], revN: ["rev {n} {t}", "第 {n} 版 {t}"],
  caveat: ["The score ports the E7 reconstruction exactly. It needs a complete Gamma reduction, an expected move and an admitted identity; missing any one of these yields null with its reason.", "评分完全移植 E7 重构。它需要完整的 Gamma 归约、预期波动和已接纳身份；缺少任一项都会得到空值及其原因。"],
  openInExposure: ["Open {root} in Exposure", "在 Exposure 中打开 {root}"],
  watch: ["Watch {root}", "关注 {root}"],
  bookUnavailable: ["Book unavailable", "账本不可用"], retry: ["Retry", "重试"],
  noPresets: ["No presets to scan", "没有可扫描的预设"],
  reason_insufficient_identity: ["identity incomplete", "身份不完整"],
  reason_insufficient_freshness: ["book not fresh", "账本不新鲜"],
  reason_insufficient_coverage: ["coverage incomplete", "覆盖不完整"],
  reason_invalid_spot: ["spot invalid", "现货无效"],
  reason_invalid_node_strike: ["node strike invalid", "节点行权价无效"],
  reason_missing_expected_move: ["expected move missing", "缺少预期波动"],
  reason_invalid_expected_move: ["expected move invalid", "预期波动无效"],
  reason_unknown_regime: ["regime unknown", "状态未知"],
  reason_invalid_concentration: ["concentration invalid", "集中度无效"],
  reason_invalid_distance: ["distance invalid", "距离无效"],
  reason_empty_scope: ["empty scope", "范围为空"],
  reason_metric_not_scanned: ["metric not scanned", "指标未扫描"],
  reason_outside_horizon: ["outside horizon", "超出范围"],
  reason_other: ["unavailable", "不可用"],
} as const;

export type ExposureScanKey = keyof typeof COPY;
export const exposureScanT = (lang: "en" | "zh") => (key: ExposureScanKey): string =>
  COPY[key][lang === "zh" ? 1 : 0];

/** A reason enum never reaches the DOM: every reducer/scanner reason renders as
 * its sentence; anything unknown falls back to `reason_other`. */
export const scanReason = (lang: "en" | "zh") => (reason: string): string => {
  const t = exposureScanT(lang);
  const key = (`reason_${reason}`) as ExposureScanKey;
  return COPY[key] ? t(key) : t("reason_other");
};
