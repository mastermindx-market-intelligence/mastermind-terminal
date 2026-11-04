"use client";

/**
 * EN/ZH copy for the exact-contract shortlist (E15). Feature-local so the
 * shared dictionary in i18n.tsx is never edited for this surface; unknown keys
 * fall through to the shared `useT()` lookup.
 *
 * Copy rules: never call a midpoint or a close "executable", never imply a
 * term is standard when the source did not supply it, and spell out "open
 * interest" instead of an abbreviation.
 */

import { useCallback } from "react";
import { useLang, useT } from "./i18n";

export const CONTRACT_SHORTLIST_LEX: Record<string, [string, string]> = {
  e15O_report_dated: ["Report dated {d}", "报告日期 {d}"],
  e15O_report_date_unavailable: ["Report date unavailable", "报告日期不可用"],
  e15O_reported_oi: ["Reported open interest", "报告未平仓量"],
  e15O_reported_doi_foot: ["Reported open interest reflects positions at the prior trading close. Change is this dated report minus the earlier report; it does not describe current intraday flow.", "报告未平仓量反映前一交易日收盘持仓。变动为本期带日期报告减前一期报告，不代表当前盘中资金流。"],
  e15Title: ["Contract shortlist", "合约候选"],
  e15Count: ["{n} of {max} pinned", "已固定 {n}/{max}"],
  e15HintEmpty: [
    "Pin up to four contracts from Open-interest builds or Hot contracts to compare what the source actually supplied.",
    "从「持仓增长」或「热门合约」中最多固定四个合约，对比数据源实际提供的字段。",
  ],
  e15HintOne: ["Pin one more contract to compare.", "再固定一个合约即可对比。"],
  e15Compare: ["Compare", "对比"],
  e15HideCompare: ["Hide comparison", "收起对比"],
  e15Clear: ["Clear", "清空"],
  e15ShowInList: ["Show in list", "在列表中查看"],
  e15RemoveAria: ["Remove {c} from the shortlist", "从候选中移除 {c}"],
  e15PinAria: ["Pin {c} to compare", "固定 {c} 用于对比"],
  e15UnpinAria: ["Unpin {c}", "取消固定 {c}"],
  e15Pinned: ["Pinned {c}.", "已固定 {c}。"],
  e15Unpinned: ["Removed {c}.", "已移除 {c}。"],
  e15Cleared: ["Shortlist cleared.", "候选已清空。"],

  e15RefuseRoot: ["Can't pin: this row has no usable ticker.", "无法固定：该行缺少有效代码。"],
  e15RefuseRight: ["Can't pin: call or put is not stated exactly.", "无法固定：未明确认购或认沽。"],
  e15RefuseExp: ["Can't pin: the expiry date is incomplete.", "无法固定：到期日不完整。"],
  e15RefuseStrike: ["Can't pin: the strike is missing or invalid.", "无法固定：行权价缺失或无效。"],
  e15RefuseTerms: ["Can't pin: a contract term in this row is malformed.", "无法固定：该行的合约条款格式有误。"],
  e15RefuseAmbiguous: [
    "Can't pin: this list has more than one row for this exact contract, so which one you mean is ambiguous.",
    "无法固定：该列表中同一合约出现多行，无法确定是哪一个。",
  ],
  e15RefuseSession: ["Can't pin: this list has no as-of date.", "无法固定：该列表没有截至日期。"],
  e15RefuseFull: ["The shortlist is full (four). Remove one to add another.", "候选已满（四个）。请先移除一个。"],

  e15HiddenByFilter: [
    "{c} is in the list but hidden by the current index filter. The filter was left as it is.",
    "{c} 在列表中，但被当前指数筛选隐藏；筛选未作更改。",
  ],
  e15NotInList: [
    "{c} is not in the current list. The pinned snapshot is kept.",
    "{c} 不在当前列表中；已固定的快照仍保留。",
  ],

  e15ListDoi: ["Open-interest builds", "持仓增长"],
  e15ListHotPrem: ["Hot contracts · by premium", "热门合约 · 按保费"],
  e15ListHotVol: ["Hot contracts · by volume", "热门合约 · 按成交量"],
  e15Call: ["Call", "认购"],
  e15Put: ["Put", "认沽"],
  e15Session: ["Session {d}", "交易日 {d}"],
  e15Stale: ["Older copy", "旧副本"],
  e15StaleTip: [
    "The server's refresh failed, so this list was served from an older cached copy.",
    "服务器刷新失败，该列表来自较早的缓存副本。",
  ],
  e15AdjustedHint: [
    "Root ends in a digit: usually an adjusted contract. Deliverable not supplied.",
    "代码以数字结尾：通常为调整后合约；数据源未提供交割物。",
  ],
  e15TermsSuffix: ["× {m}", "× {m}"],

  e15CmpTitle: ["Side by side: source values only", "并排对比：仅数据源数值"],
  e15CmpNoExec: [
    "Nothing here is a live or executable quote. Midpoints and closes are end-of-day reference marks.",
    "此处没有实时或可成交的报价。中间价和收盘价均为收盘参考价。",
  ],
  e15Field: ["Field", "字段"],
  e15NoteLike: [
    "Same list and same session ({d}): these values are like-for-like.",
    "同一列表、同一交易日（{d}）：数值可直接对比。",
  ],
  e15NoteSession: [
    "Not like-for-like: values come from different sessions ({ds}).",
    "不可直接对比：数值来自不同交易日（{ds}）。",
  ],
  e15NoteListMix: [
    "Not like-for-like: contracts come from different lists, which carry different fields.",
    "不可直接对比：合约来自不同列表，所含字段不同。",
  ],
  e15NoteStale: [
    "Not like-for-like: at least one list is an older cached copy because its refresh failed.",
    "不可直接对比：至少一个列表因刷新失败而来自较早的缓存副本。",
  ],
  e15NoteSameTwice: [
    "The same contract is pinned from two lists; each column keeps its own list's clock.",
    "同一合约从两个列表固定；各列保留各自列表的时间。",
  ],
  e15NoteTerms: [
    "Multiplier, deliverable, settlement and exercise style are not supplied by these lists. They are not assumed to be standard.",
    "这些列表未提供乘数、交割物、结算和行权方式，不假定为标准合约。",
  ],
  e15NoteAdjusted: [
    "A root ending in a digit is usually an adjusted contract. Confirm its terms elsewhere before comparing it with a standard one.",
    "以数字结尾的代码通常为调整后合约；与标准合约对比前请另行确认条款。",
  ],

  e15F_bid_ask: ["Executable bid / ask", "可成交买价／卖价"],
  e15F_spread: ["Bid-ask spread", "买卖价差"],
  e15F_quote_size: ["Quote size / depth", "挂单量／深度"],
  e15F_mid: ["Midpoint", "中间价"],
  e15F_close: ["Last trade at close", "收盘最后成交价"],
  e15F_oi: ["Open interest", "未平仓量"],
  e15F_oi_earlier: ["Earlier open interest", "前一期未平仓量"],
  e15F_oi_change: ["Open interest change", "未平仓变动"],
  e15F_volume: ["Contracts traded", "成交合约数"],
  e15F_traded_value: ["Traded value", "成交额"],
  e15F_vol_above_oi: ["Volume above open interest", "成交量高于未平仓量"],
  e15F_multiplier: ["Contract multiplier", "合约乘数"],
  e15F_deliverable: ["Deliverable", "交割物"],
  e15F_settlement: ["Settlement", "结算方式"],
  e15F_exercise_style: ["Exercise style", "行权方式"],

  e15B_executable_quote: ["Executable quote", "可成交报价"],
  e15B_reference_mark: ["Reference mark, not executable", "参考价，不可成交"],
  e15B_positions: ["Positions", "持仓"],
  e15B_activity: ["Activity", "成交"],
  e15B_source_estimate: ["Source estimate", "数据源估算"],
  e15B_contract_term: ["Contract term", "合约条款"],

  e15O_eod_mid: ["End-of-day bid/ask midpoint, {d} close", "{d} 收盘买卖中间价"],
  e15O_eod_close: ["Last trade, {d} close", "{d} 收盘最后成交"],
  e15O_oi_report: ["Report dated {d} (positions at the prior close)", "{d} 报告（前一收盘持仓）"],
  e15O_oi_report_prior: ["Earlier report, before {d}", "{d} 之前的报告"],
  e15O_oi_report_change: ["Report dated {d} minus the earlier report", "{d} 报告减前一期报告"],
  e15O_session_volume: ["{d} session", "{d} 交易日"],
  e15O_premium_estimate: [
    "Close × contracts × 100 for {d}; the 100 is the source's assumption",
    "{d} 收盘价 × 合约数 × 100；100 为数据源假设",
  ],
  e15O_vol_vs_oi: ["{d} volume vs report dated {d}", "{d} 成交量对比 {d} 报告"],
  e15O_term_supplied: ["Supplied by source", "数据源提供"],

  e15C_missing: ["Missing in this row (left blank)", "该行缺失（留空）"],
  e15C_not_in_list: ["Not carried by this list", "该列表不含此字段"],
  e15C_no_quote: ["Not supplied: no live quote in this source", "未提供：该数据源没有实时报价"],
  e15C_no_term: ["Not supplied, not assumed standard", "未提供，不假定为标准"],
  e15Yes: ["Yes", "是"],
  e15No: ["No", "否"],
};

/** Replace `{name}` placeholders. Missing values are left visible, never blanked. */
export function fillShortlistCopy(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole,
  );
}

export function useShortlistT() {
  const { lang } = useLang();
  const sharedT = useT();
  return useCallback(
    (key: string, fallback?: string): string => {
      const pair = CONTRACT_SHORTLIST_LEX[key];
      return pair ? pair[lang === "zh" ? 1 : 0] : sharedT(key, fallback);
    },
    [lang, sharedT],
  );
}
