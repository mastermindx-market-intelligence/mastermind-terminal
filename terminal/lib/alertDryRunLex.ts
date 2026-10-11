"use client";
import { useCallback } from "react";
import { useLang, useT } from "./i18n";

/** Feature-local EN/ZH copy for the alert dry run (components/alerts/AlertDryRunPanel.tsx).
 * Kept out of the global LEX so unrelated screen evidence stays byte-stable. `{x}` slots are
 * filled by the caller. Unknown keys fall through to the shared dictionary (event names). */
export const ALERT_DRY_RUN_LEX: Record<string, [string, string]> = {
  drTitle: ["Dry run", "试运行"],
  drRun: ["Dry run on current data", "按当前数据试运行"],
  drRunning: ["Evaluating…", "评估中…"],
  drCancel: ["Cancel", "取消"],
  drRerun: ["Run again", "重新运行"],
  drReadOnly: ["Read-only: nothing is created, armed, acknowledged or sent.", "只读：不会创建、启用、确认或发送任何提醒。"],
  drIntro: [
    "Checks this condition against the latest daily bars with the same evaluator that fires suite alerts.",
    "使用触发套件提醒的同一评估器，按最新日线数据检查此条件。",
  ],
  drSignInHint: ["Sign in to run a dry run.", "登录后才能试运行。"],

  "drVerdict.would_trigger": ["Would trigger now", "现在会触发"],
  "drVerdict.not_met": ["Would not trigger now", "现在不会触发"],
  "drVerdict.cannot_evaluate": ["Cannot evaluate", "无法评估"],
  "drVerdict.unsupported": ["Not supported by the dry run", "试运行不支持"],
  drWouldSub: [
    "If created now, its next scheduled evaluation on this same data would fire it.",
    "若现在创建，下一次定时评估在相同数据上会触发它。",
  ],
  drNotMetSub: [
    "The condition is not met on current data. The alert would stay armed and keep waiting.",
    "当前数据未满足条件。提醒将保持启用并继续等待。",
  ],
  drUnavailable: ["Dry run unavailable: no verdict. Try again.", "试运行暂不可用：没有结论，请重试。"],
  drCancelled: ["Dry run cancelled: no verdict.", "试运行已取消：没有结论。"],

  "drReason.signed_out": ["Sign in to run a dry run.", "登录后才能试运行。"],
  "drReason.plan_not_confirmed": [
    "Your plan could not be confirmed for this {tier} condition, so it was not evaluated.",
    "无法确认您的订阅包含此{tier}级条件，因此未评估。",
  ],
  "drReason.rate_limited": ["Too many dry runs. Wait a minute and try again.", "试运行过于频繁，请稍候再试。"],
  "drReason.malformed": ["The condition is incomplete or invalid.", "条件不完整或无效。"],
  "drReason.invalid_symbol": ["This symbol can't be evaluated.", "无法评估此代码。"],
  "drReason.no_data": ["No usable daily bars for this symbol.", "此代码没有可用的日线数据。"],
  "drReason.stale_data": [
    "Daily bars end {date}: too old to answer \"right now\", so nothing was evaluated.",
    "日线数据截至 {date}，过旧，无法回答“现在”，因此未评估。",
  ],
  "drReason.compute_failed": ["The suite could not be computed on these bars.", "无法在这些K线上计算该套件。"],
  "drReason.unsupported_type": [
    "This alert type is evaluated by the server engine, which the dry run does not run.",
    "此类提醒由服务器引擎评估，试运行不运行该引擎。",
  ],
  "drReason.supplied_state": [
    "Conditions that carry recorded alert state are not previewed.",
    "带有已记录提醒状态的条件不提供预览。",
  ],

  drCondition: ["Condition", "条件"],
  drInstrument: ["Instrument", "标的"],
  drTimeframe: ["Timeframe", "周期"],
  drTfValue: ["1D: daily bars, module defaults", "1D：日线，模块默认参数"],
  drDataThrough: ["Data through", "数据截至"],
  drBarsN: ["{n} bars", "{n} 根K线"],
  drSourceAsOf: ["Source file written", "数据文件写入"],
  drEvaluatedAt: ["Evaluated", "评估时间"],
  drFreshWindow: ["Fresh window", "新鲜窗口"],
  drCreationFloor: ["Counts confirmations from", "计入确认起始日"],
  drWithin: ["within {n} bars", "{n} 根K线内"],
  drTrace: ["Why", "原因"],
  drRecent: ["Recent matching events", "近期相关事件"],
  drNoRecent: ["None in the computed history.", "计算历史中没有。"],
  drDrawn: ["drawn", "绘制"],
  drConfirmedOn: ["confirmed", "确认"],
  drStrength: ["strength", "强度"],
  drEngineNote: ["Evaluator note", "评估器说明"],
  drUnknown: ["unknown", "未知"],

  "drStep.data": ["Daily bars loaded", "已载入日线"],
  "drStep.fresh_window": ["Only events confirmed in the last 3 bars can fire", "只有最近3根K线内确认的事件才能触发"],
  "drStep.event_in_window": ["An event of this type confirmed in the fresh window", "新鲜窗口内确认了此类事件"],
  "drStep.filters": ["Direction / strength filter met", "满足方向/强度筛选"],
  "drStep.creation_floor": ["Confirmed on or after the creation day (today)", "在创建日（今天）或之后确认"],
  "drStep.initial_state": ["Starts from a new alert's exact state: no prior events", "从新提醒的确切状态开始：无先前事件"],
  "drStep.sequence_replay": ["Step A, then step B within the bar limit, confirmed today or later", "先A后B且在K线数限制内，今天或之后确认"],
  "drStep.prior_history": [
    "Events before today are not replayed (that would invent alert history)",
    "不重放今天之前的事件（否则会虚构提醒历史）",
  ],

  "drSt.pass": ["met", "满足"],
  "drSt.fail": ["not met", "未满足"],
  "drSt.skipped": ["not reached", "未到达"],
  "drSt.not_applicable": ["no filter", "无筛选"],
  "drSt.unsupported": ["not simulated", "不模拟"],

  drSeqState: ["Sequence state", "序列状态"],
  "drSeq.idle": ["Idle: waiting for step A", "空闲：等待步骤A"],
  "drSeq.simulated_armed": [
    "SIMULATED: step A on {date} would arm it (computed here, not recorded)",
    "模拟：{date} 的步骤A会启用它（此处计算，未记录）",
  ],
  "drSeq.completed": ["Completed: step B confirmed", "已完成：步骤B已确认"],
  drSeqInput: ["Started from: new alert, no recorded events", "起始状态：新提醒，无已记录事件"],

  "drTier.free": ["Free", "免费"],
  "drTier.essential": ["Insider", "Insider"],
  "drTier.pro": ["Pro", "Pro"],
  "drDir.bull": ["bullish", "看涨"],
  "drDir.bear": ["bearish", "看跌"],
};

export function useAlertDryRunT() {
  const { lang } = useLang();
  const sharedT = useT();
  return useCallback((key: string, fallback?: string): string => {
    const pair = ALERT_DRY_RUN_LEX[key];
    return pair ? pair[lang === "zh" ? 1 : 0] : sharedT(key, fallback);
  }, [lang, sharedT]);
}
