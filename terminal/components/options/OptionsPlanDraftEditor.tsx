"use client";

import React, { useId, useState, type FormEvent } from "react";
import { buildComparison, type CompareCell } from "@/lib/optionsContractShortlist";
import { validateOptionsPlanDraft, type OptionsPlanDraft } from "@/lib/optionsPlanDraft";
import styles from "./ContractShortlist.module.css";

/** Controlled integration seam for Plan. The action owner supplies an admitted
 * continuation; this editor performs no fetch, save, storage or valuation. Mount
 * with a new key when the person explicitly replaces the source draft. */
export function OptionsPlanDraftEditor({ draft, lang, onApply, onClose, contextDescription, applyLabel, onEdit }: {
  draft: OptionsPlanDraft;
  lang: "en" | "zh";
  onApply: (draft: OptionsPlanDraft) => void;
  onClose: () => void;
  contextDescription?: string;
  applyLabel?: string;
  onEdit?: () => void;
}) {
  const id = useId();
  const t = (en: string, zh: string) => lang === "zh" ? zh : en;
  const checked = validateOptionsPlanDraft(draft);
  const [research, setResearch] = useState(draft.research);
  const [assumptions, setAssumptions] = useState(draft.legs.map(leg => ({
    side: leg.assumptions.side ?? "", quantity: leg.assumptions.quantity?.toString() ?? "",
    entry: leg.assumptions.entry?.premium_per_unit.toString() ?? "",
    usd: leg.assumptions.entry?.currency === "USD",
  })));
  const [error, setError] = useState(false);
  if (!checked.ok) return <section className={styles.cmp} role="alert">
    <p>{t("This Plan source is invalid. Return to the exact-contract shortlist to prepare it again.", "计划来源无效，请返回精确合约候选列表重新准备。")}</p>
    <button type="button" className={`chip ${styles.planControl}`} onClick={onClose}>{t("Close draft", "关闭草稿")}</button>
  </section>;
  const frozen = checked.value;
  const changeLeg = (i: number, patch: Partial<typeof assumptions[number]>) => {
    onEdit?.();
    setAssumptions(values => values.map((v, index) => index === i ? { ...v, ...patch } : v));
    setError(false);
  };
  const entryNumber = (s: string) => /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(s) ? Number(s) : NaN;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const candidate = {
      ...frozen, research,
      legs: frozen.legs.map((leg, i) => ({
        snapshot: leg.snapshot,
        assumptions: {
          side: assumptions[i].side || null,
          quantity: assumptions[i].quantity === "" ? null : /^\d+$/.test(assumptions[i].quantity) ? Number(assumptions[i].quantity) : NaN,
          entry: assumptions[i].entry === "" ? null : {
            kind: "user_assumption", premium_per_unit: entryNumber(assumptions[i].entry), currency: assumptions[i].usd ? "USD" : null,
          },
        },
      })),
    };
    const result = validateOptionsPlanDraft(candidate);
    if (!result.ok) { setError(true); return; }
    setError(false);
    onApply(result.value);
  };
  const cellText = (cell: CompareCell) => cell.state === "value" ? String(cell.value)
    : cell.state === "missing" ? t("Missing in this snapshot", "此快照缺失") : t("Not supplied", "来源未提供");
  return <section className={styles.cmp} aria-labelledby={`${id}-title`} data-testid="options-plan-draft">
    <div className={styles.cmpHd}><h3 className={styles.cmpTitle} id={`${id}-title`}>{t("Plan draft", "计划草稿")}</h3>
      <p className={styles.cmpNoExec}>{t("Record your research and assumptions. This draft is not saved to your account.", "记录研究观点与假设，此草稿尚未保存到账户。")}</p></div>
    <p className={styles.hint}>{contextDescription ?? t("Dated reference marks remain separate from your entry assumption. Quotes, fees and a compatible valuation model are unavailable; no payoff or profit is calculated.", "带日期的参考价格与入场假设分别保留。当前缺少报价、费用及兼容估值模型，不计算收益或损益。")}</p>
    <form className={styles.planForm} onSubmit={submit} noValidate>
      <label htmlFor={`${id}-thesis`}>{t("Research thesis", "研究观点")}<textarea id={`${id}-thesis`} value={research.thesis} onChange={e => { onEdit?.(); setResearch(v => ({ ...v, thesis: e.target.value })); setError(false); }} /></label>
      <label htmlFor={`${id}-invalidation`}>{t("What would invalidate the thesis?", "哪些情况会推翻观点？")}<textarea id={`${id}-invalidation`} value={research.invalidation} onChange={e => { onEdit?.(); setResearch(v => ({ ...v, invalidation: e.target.value })); setError(false); }} /></label>
      <label htmlFor={`${id}-horizon`}>{t("Research horizon — separate from option expiry", "研究期限——与合约到期日分别记录")}<input id={`${id}-horizon`} value={research.horizon} onChange={e => { onEdit?.(); setResearch(v => ({ ...v, horizon: e.target.value })); setError(false); }} /></label>
      {frozen.legs.map((leg, i) => {
        const p = leg.snapshot, a = assumptions[i], rows = buildComparison([p]).rows;
        return <fieldset key={p.pinKey} className={styles.planLeg}>
          <legend><bdi>{p.identity.root} · {p.identity.exp} · {p.identity.strike} · {p.identity.right === "C" ? t("Call", "看涨") : t("Put", "看跌")}</bdi></legend>
          <p className={styles.pinMeta}>{p.family === "doi" ? t("Open-interest builds", "持仓变化") : t("Hot contracts", "热门合约")} · {t("Source as of", "来源时点")} <bdi>{p.asofRaw}</bdi> · {t("Session", "交易日")} {p.session}</p>
          <p className={styles.pinMeta}>{t("First known and publication times: unknown", "首次可知时间及发布时间：未知")} · {p.sourceStale ? t("Refresh failed at selection", "选择时刷新失败") : t("No failed-refresh flag at selection", "选择时无刷新失败标记")}</p>
          <dl className={styles.planSource}>{rows.filter(r => r.basis === "contract_term" || r.basis === "reference_mark" || r.basis === "executable_quote").map(r => <div key={r.field} data-plan-field={r.field} data-basis={r.basis}>
            <dt>{({ mid: t("EOD midpoint reference", "日终中间价参考"), close: t("EOD last-trade reference", "日终末笔成交参考"), bid_ask: t("Bid / ask", "买卖报价"), spread: t("Quote spread", "买卖价差"), quote_size: t("Quote size", "报价数量"), multiplier: t("Contract multiplier", "合约乘数"), deliverable: t("Deliverable", "交割标的"), settlement: t("Settlement", "结算方式"), exercise_style: t("Exercise style", "行权方式") } as Record<string, string>)[r.field] ?? r.field}</dt>
            <dd data-cell-state={r.cells[0].state}><bdi>{cellText(r.cells[0])}</bdi></dd>
          </div>)}</dl>
          <div className={styles.planFields}>
            <label htmlFor={`${id}-side-${i}`}>{t("Your assumed side", "假设方向")}<select id={`${id}-side-${i}`} value={a.side} onChange={e => changeLeg(i, { side: e.target.value as typeof a.side })}><option value="">{t("Not specified", "未填写")}</option><option value="buy">{t("Buy", "买入")}</option><option value="sell">{t("Sell", "卖出")}</option></select></label>
            <label htmlFor={`${id}-quantity-${i}`}>{t("Your assumed quantity — contracts", "假设数量——张")}<input id={`${id}-quantity-${i}`} inputMode="numeric" value={a.quantity} onChange={e => changeLeg(i, { quantity: e.target.value })} /></label>
            <label htmlFor={`${id}-entry-${i}`}>{t("Your entry assumption — premium per unit", "假设入场价——每单位权利金")}<input id={`${id}-entry-${i}`} inputMode="decimal" value={a.entry} onChange={e => changeLeg(i, { entry: e.target.value })} /></label>
            <label htmlFor={`${id}-usd-${i}`}>{t("Assumed premium denomination", "权利金假设币种")}<select id={`${id}-usd-${i}`} value={a.usd ? "USD" : ""} onChange={e => changeLeg(i, { usd: e.target.value === "USD" })}><option value="">{t("Not specified", "未填写")}</option><option value="USD">{t("USD — my assumption", "美元——个人假设")}</option></select></label>
          </div>
        </fieldset>;
      })}
      {error && <p role="alert" className={styles.status}>{t("Check the draft: quantity must be a positive whole number of contracts. An entered premium needs a nonnegative number and an explicit denomination. Thesis and invalidation allow 4,000 characters; horizon allows 160.", "请检查草稿：合约数量须为正整数。填写权利金时须使用非负数并明确币种。观点及证伪条件各限4000字符，研究期限限160字符。")}</p>}
      <div className={styles.trayActions}><button type="button" className={`chip ${styles.planControl}`} onClick={onClose}>{t("Close draft", "关闭草稿")}</button><button type="submit" className={`chip ${styles.planControl}`}>{applyLabel ?? t("Apply draft", "应用草稿")}</button></div>
    </form>
  </section>;
}
