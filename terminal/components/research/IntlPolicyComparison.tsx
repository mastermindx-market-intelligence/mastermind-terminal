"use client";
// IntlPolicyComparison.tsx — IM10-T3 artifact-only controlled panel (paper-waves-01a1101f).
// Repair r2 (bounded, after parent REQUEST_CHANGES): engine-faithful delta
// display, owner reason/baseline/currency text projection, period_mode inline
// error association, review escape on an empty snapshot. Controlled
// presentational renderer: parent owns state, steps, drawer and save.
// Types-only import from the accepted coherence module; no validation, math,
// fetch, storage or source admission here. Raw edits emit intent only; the
// parent host must synchronously invalidate via updatePolicyDraft.
import { useId, useRef, type ReactNode } from "react";
import type { PolicyPreviewSessionState } from "@/lib/intlPolicyPreviewSession";
import styles from "./IntlPolicyComparison.module.css";

/** Raw editing values — deliberately distinct from validated PolicySettings. */
export type PolicyDraftControl = {
 comparator: string; // raw economy id or "" (no default is ever applied)
 mode: "owner_horizon" | "fixed_dates";
 horizonKey: string; // raw key when mode = owner_horizon
 startDate: string; endDate: string; // raw when mode = fixed_dates
};
export type LabeledOption = { value: string; label: string };
/** Owner-projected localized errors. Fields: comparator | period_mode |
* period_key | period_start | period_end (unknown fields stay in summary). */
export type ProjectedFieldError = { field: string; message: string };
export type ComparisonBeforeLabels = { comparator?: string; period?: string; lens?: string };
/** Owner-localized labels for exact unavailable reason codes (no code grammar). */
export type ReasonLabelMap = Readonly<Record<string, string>>;
/** Independent owner-localized presentational baseline text. Not persistence,
* not a source schema, not admission; never inferred from the policy preview,
* and no saved-baseline math is performed or displayed. */
export type BaselineComparison = { status: "available" | "unavailable"; statusLabel: string; description: string };
export type IntlPolicyComparisonStep = "setup" | "review";
export type IntlPolicyComparisonProps = {
 state: PolicyPreviewSessionState;
 step: IntlPolicyComparisonStep;
 locale: "en" | "zh";
 question: string; // exact text, whitespace preserved
 focusEconomyLabel: string; // immutable, rendered readonly
 draft: PolicyDraftControl; // controlled raw draft
 comparatorOptions: readonly LabeledOption[];
 horizonOptions: readonly LabeledOption[];
 fieldErrors: readonly ProjectedFieldError[];
 comparisonBefore?: ComparisonBeforeLabels;
 reasonLabels?: ReasonLabelMap; // exact reason code -> already-localized owner label
 baselineComparison?: BaselineComparison; // owner text, rendered as supplied
 currencyPreference?: string; // owner-localized preference label; never FX-converted, no USD default
 dataTheme?: "dark" | "light"; // material variant only, not a theme owner
 onDraftChange: (patch: Partial<PolicyDraftControl>) => void; // intent only
 onPreview?: () => void; onReview?: () => void;
 onBack?: () => void; onInspectSource?: () => void;
};

// All copy is [en, zh]; CJK never receives allcaps or letter tracking.
const L = {
 eyebrow: ["DRAFT · NOT SAVED", "草稿 · 未保存"],
heading: ["Compare first. Save deliberately.", "先对比，再谨慎保存。"],
steps: [["01 · Set comparison", "01 · 设定对比"], ["02 · Inspect preview", "02 · 查看预览"], ["03 · Review & save", "03 · 复核并保存"]],
setupTitle: ["Set the comparison", "设定对比"], focus: ["Focus economy", "焦点经济体"],
fromSavedRO: ["From saved research · read-only", "来自已保存研究 · 只读"],
compareWith: ["Compare with", "对比对象"], addedInDraft: ["Added in draft", "草稿中新增"],
comparatorPrompt: ["Select an economy", "请选择经济体"], window: ["Observation window", "观测窗口"],
modeRolling: ["Rolling horizon", "滚动窗口"], modeFixed: ["Fixed dates", "固定日期"],
horizon: ["Horizon", "期限"], horizonPrompt: ["Select a horizon", "请选择期限"],
start: ["Start", "开始日期"], end: ["End", "结束日期"],
fixedNote: ["Fixed dates replace the rolling window only if saved.", "保存后固定日期才取代滚动窗口。"],
lensName: ["Nominal policy settings", "名义政策设定"],
lensMeaning: ["Change in the absolute rate gap · basis points", "利率绝对差距的变化 · 基点"],
previewBtn: ["Update preview", "更新预览"],
previewNote: ["A preview reads evidence, it does not save; settings changes need a new preview.", "预览只读取证据，不保存；设置更改需重新预览。"],
fxNote: ["Policy rates stay percentages, not currency-converted.", "政策利率为百分比，不经汇率换算。"],
reviewBtn: ["Review changes", "复核更改"], back: ["Back to saved research", "返回已保存研究"],
inspect: ["Inspect series, dates & source definitions", "检查序列、日期与来源定义"],
idleBody: ["Set the comparison, then update the preview to read eligible observations.", "设定对比后更新预览，读取符合条件的观测。"],
loading: ["Reading eligible observations…", "正在读取符合条件的观测…"],
rowStart: ["Signed gap at start", "起点带符号差距"], rowEnd: ["Signed gap at end", "终点带符号差距"],
rowChange: ["Signed change", "带符号变化"], rowAbs: ["Change in absolute gap", "绝对差距的变化"], rowDir: ["Direction", "方向"],
crossesNote: ["The signed gap crossed zero between the dates; the sign alone does not describe the move.", "带符号差距在两日期间跨零，仅凭符号不足以描述变化。"],
scopeNote: ["Answers the nominal-rate comparison only — not expected paths, real rates or an investment decision.", "仅回答名义利率对比——不含预期路径、实际利率或投资决策。"],
unavailableTitle: ["Preview unavailable", "预览不可用"],
unavailableBody: ["No numeric result is shown for these settings.", "这些设置暂无数值结果。"],
reasons: ["Reasons", "原因"], missing: ["Missing observations", "缺失观测"],
reasonUnknown: ["Additional reason unavailable.", "其余原因不可用。"],
reasonKnown: { qualification_unavailable: ["Qualification for this data setup is not available yet.", "此数据设置的资质校验暂不可用。"], invalid_preview_response: ["The preview response was not usable.", "预览响应不可用。"] } as Record<string, [string, string]>,
baselineTitle: ["Compared with saved evidence", "与已保存证据对比"],
baselineTag: ["UNAVAILABLE FOR THIS SETUP", "本设置暂不可用"],
baselineBody: ["Saved-baseline comparison is unavailable. Any change shown is across the selected dates, not since saving.", "与已保存基准的对比不可用。所示变化基于所选日期，并非自保存以来。"],
summaryTitle: ["Fix these settings before previewing", "请先修正以下设置再预览"],
reviewTitle: ["Review what will change.", "复核将要更改的内容。"],
reviewMissing: ["No review snapshot is available yet.", "暂无可复核的快照。"],
yourChanges: ["Your changes", "您的更改"], saved: ["SAVED", "已保存"], change: ["YOUR CHANGE", "您的更改"],
rowComparator: ["Comparison economy", "对比经济体"], rowWindow: ["Observation window", "观测窗口"], rowLens: ["Comparison lens", "对比视角"],
notSpecified: ["Not specified", "未指定"], focusNote: ["Focus remains", "焦点仍为"],
sameBody: ["Question text, focus, selected measures, baseline and evidence references are all retained.", "问题文本、焦点、所选指标、基准与证据引用均保留。"],
reviewBaselineNote: ["Saved-baseline comparison is unavailable; no conclusion about changes since saving is shown.", "与已保存基准的对比不可用；不显示关于自保存以来变化的结论。"],
backToPreview: ["Back to preview · Keep draft", "返回预览 · 保留草稿"],
} as const;
type LKey = Exclude<keyof typeof L, "steps" | "reasonKnown">;
// Per direction: [headline en, zh, big label en, zh, direction word en, zh].
const DIR: Record<string, readonly [string, string, string, string, string, string]> = {
 narrowed: ["The nominal policy gap narrowed.", "名义政策差距收窄。", "narrower over the window", "窗口内收窄", "narrowed", "收窄"],
 widened: ["The nominal policy gap widened.", "名义政策差距扩大。", "wider over the window", "窗口内扩大", "widened", "扩大"],
 unchanged_at_endpoints: ["The nominal policy gap is unchanged at the endpoints.", "名义政策差距在两端点保持不变。", "unchanged at the endpoints", "两端点保持不变", "unchanged at endpoints", "两端点不变"],
};
const SLOT: Record<string, readonly [string, string]> = { a_start: ["start", "开始"], a_end: ["end", "结束"], b_start: ["start", "开始"], b_end: ["end", "结束"] };
const num = (v: number): string => { const r = Math.abs(v) <= Number.MAX_VALUE / 100 ? Math.round(v * 100) / 100 : v; return Object.is(r, -0) ? "0" : String(r); }; // zero retained, no falsy placeholder
const signedBp = (v: number): string => `${v > 0 ? "+" : ""}${num(v)} bp`;
const bp = (v: number): string => `${num(v)} bp`;

export function IntlPolicyComparison(props: IntlPolicyComparisonProps) {
 const { state, step, locale, question, focusEconomyLabel, draft, comparatorOptions,
  horizonOptions, fieldErrors, comparisonBefore, reasonLabels, baselineComparison,
  currencyPreference, dataTheme = "dark" } = props;
 const s = styles, zh = locale === "zh";
 const t = (k: LKey): string => L[k][zh ? 1 : 0];
 const uid = useId();
 const errFor = (f: string) => fieldErrors.find((e) => e.field === f);
 const refs = { comparator: useRef<HTMLSelectElement | null>(null), period_mode: useRef<HTMLButtonElement | null>(null),
  period_key: useRef<HTMLSelectElement | null>(null), period_start: useRef<HTMLInputElement | null>(null), period_end: useRef<HTMLInputElement | null>(null) };
 const summaryRef = useRef<HTMLDivElement | null>(null);
 const patch = (p: Partial<PolicyDraftControl>) => props.onDraftChange(p); // raw intent only
 const labelOf = (v: string) => comparatorOptions.find((o) => o.value === v)?.label ?? v;
 const horizonLabel = (k: string) => horizonOptions.find((o) => o.value === k)?.label ?? k;
 const settings = state.validation.ok ? state.validation.settings : null;
 const windowLabel = settings ? (settings.period.mode === "fixed_dates"
  ? `${settings.period.start} – ${settings.period.end}` : horizonLabel(settings.period.key)) : "";
 // Rates stay percentages. A supplied preference is owner-localized text only;
 // with no preference prop the note asserts no specific currency (no USD claim).
 const fxText = currencyPreference === undefined ? t("fxNote")
  : zh ? `${currencyPreference}偏好不变；政策利率为百分比，不经汇率换算。`
  : `${currencyPreference} preference unchanged; policy rates stay percentages, not currency-converted.`;
 // Exact-code owner label first; then existing safe known labels; then the
 // explicit unavailable fallback. Raw provider text is never rendered.
 const reasonText = (code: string): string => {
  const supplied = reasonLabels && Object.hasOwn(reasonLabels, code) ? reasonLabels[code] : undefined;
  if (typeof supplied === "string") return supplied;
  const known = Object.hasOwn(L.reasonKnown, code) ? L.reasonKnown[code] : undefined;
  return known ? known[zh ? 1 : 0] : t("reasonUnknown");
 };

 // Preview attempt: valid -> parent intent; invalid -> focus the first input
 // matching a projected error (no native alert); else focus the summary.
 const tryPreview = () => {
  if (!props.onPreview) return;
  if (state.validation.ok) { props.onPreview(); return; }
  for (const e of fieldErrors) {
   const r = (refs as Record<string, { current: { focus(): void } | null }>)[e.field];
   if (r?.current) { r.current.focus(); return; }
  }
  summaryRef.current?.focus();
 };

 const field = (name: string, labelText: string, tag: string | undefined,
  control: (invalid: boolean, describedBy: string | undefined, inputId: string) => ReactNode) => {
  const e = errFor(name), inputId = `${uid}-${name}`, errId = `${inputId}-err`;
  return (
   <div className={s.control}>
    <div className={s.row}>
     <label className={s.label} htmlFor={inputId}>{labelText}</label>
     {tag ? <span className={s.note}>{tag}</span> : null}
    </div>
    {control(!!e, e ? errId : undefined, inputId)}
    {e ? <p className={s.fieldError} id={errId}>{e.message}</p> : null}
   </div>
  );
 };

 const currentStep = step === "review" ? 3 : state.pending || state.preview ? 2 : 1;
 const header = (
  <header className={s.header}>
   <p className={s.eyebrow}>{t("eyebrow")}</p>
   <h2 className={s.heading}>{step === "review" ? t("reviewTitle") : t("heading")}</h2>
   <p className={s.question}>{question}</p>
   <ol className={s.steps}>
    {L.steps.map((st, i) => (
     <li key={st[0]} className={s.step} data-state={i + 1 === currentStep ? "current" : i + 1 < currentStep ? "done" : "todo"}
      aria-current={i + 1 === currentStep ? "step" : undefined}>{st[zh ? 1 : 0]}</li>
    ))}
   </ol>
  </header>
 );

 if (step === "review") {
  const review = state.review;
  // Escape is retained even when the snapshot is empty/invalidated; disabled
  // only when the callback is absent. No save/confirmation write control.
  const reviewActions = (
   <div className={s.actions}>
    <span className={s.note}>{t("eyebrow")}</span>
    <button type="button" className={`${s.btn} ${s.ghost}`} onClick={() => props.onBack?.()}
     disabled={!props.onBack}>{t("backToPreview")}</button>
   </div>
  );
  return (
   <section className={s.root} data-lang={locale} data-theme={dataTheme} data-step="review">
    {header}
    {review === null ? (
     <>
      <p className={s.note}>{t("reviewMissing")}</p>
      {reviewActions}
     </>
    ) : (
     <>
      <div className={s.panel}>
       <h3 className={s.title}>{t("yourChanges")}</h3>
       {([
        ["rowComparator", labelOf(review.settings.economy_b), comparisonBefore?.comparator],
        ["rowWindow", review.settings.period.mode === "fixed_dates"
         ? `${review.settings.period.start} – ${review.settings.period.end}`
         : horizonLabel(review.settings.period.key), comparisonBefore?.period],
        ["rowLens", t("lensName"), comparisonBefore?.lens],
       ] as const).map(([row, after, before]) => (
        <div key={row} className={s.group}>
         <h4 className={s.label}>{t(row)}</h4>
         <p className={s.note}>{t("saved")}: {before ?? t("notSpecified")}</p>
         <p className={s.after}>{t("change")}: {after}</p>
        </div>
       ))}
       <p className={s.note}>{t("focusNote")} {focusEconomyLabel}.</p>
      </div>
      <div className={s.limit}>
       <p className={s.note}>{t("sameBody")}</p>
       {baselineComparison ? (
        <>
         <p className={s.label}>{baselineComparison.statusLabel}</p>
         <p className={s.note}>{baselineComparison.description}</p>
        </>
       ) : <p className={s.warn}>{t("reviewBaselineNote")}</p>}
      </div>
      {reviewActions}
     </>
    )}
   </section>
  );
 }

 const preview = state.preview;
 const qualified = preview?.state === "qualified" ? preview : null;
 const unavailable = preview?.state === "unavailable" ? preview : null;
 const dir = qualified ? DIR[qualified.direction] : null;
 const missingLabels = unavailable ? unavailable.missing_refs.map((m) =>
  `${m.startsWith("a_") ? focusEconomyLabel : labelOf(unavailable.identity.settings.economy_b)} · ${SLOT[m][zh ? 1 : 0]}`) : [];
 const modeErr = errFor("period_mode");
 const modeErrId = `${uid}-period_mode-err`; // stable per-instance id

 return (
  <section className={s.root} data-lang={locale} data-theme={dataTheme} data-step="setup">
   {header}
   {fieldErrors.length > 0 ? (
    <div className={s.summary} role="alert" ref={summaryRef} tabIndex={-1}>
     <p className={s.summaryTitle}>{t("summaryTitle")}</p>
     {fieldErrors.map((e) => <p key={`${e.field}:${e.message}`} className={s.fieldError}>{e.message}</p>)}
    </div>
   ) : null}
   <div className={s.columns}>
    <div className={s.panel}>
     <h3 className={s.title}>{t("setupTitle")}</h3>
     <div className={s.group}>
      <div className={s.row}><span className={s.label}>{t("focus")}</span><span className={s.note}>{t("fromSavedRO")}</span></div>
      <div className={s.readonlyBox}>{focusEconomyLabel}</div>
     </div>
     <div className={s.group}>
      {field("comparator", t("compareWith"), t("addedInDraft"), (invalid, describedBy, inputId) => (
       <select id={inputId} ref={refs.comparator} className={s.select} value={draft.comparator}
        aria-invalid={invalid || undefined} aria-describedby={describedBy}
        onChange={(ev) => patch({ comparator: ev.target.value })}>
        <option value="">{t("comparatorPrompt")}</option>
        {comparatorOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
       </select>
      ))}
     </div>
     <div className={s.group}>
      <span className={s.label}>{t("window")}</span>
      <div className={s.modeRow} role="group" aria-label={t("window")}
       aria-invalid={modeErr ? true : undefined} aria-describedby={modeErr ? modeErrId : undefined}>
       <button type="button" ref={refs.period_mode} className={s.modeBtn} aria-pressed={draft.mode === "owner_horizon"}
        onClick={() => patch({ mode: "owner_horizon" })}>{t("modeRolling")}</button>
       <button type="button" className={s.modeBtn} aria-pressed={draft.mode === "fixed_dates"}
        onClick={() => patch({ mode: "fixed_dates" })}>{t("modeFixed")}</button>
      </div>
      {modeErr ? <p className={s.fieldError} id={modeErrId}>{modeErr.message}</p> : null}
      {draft.mode === "owner_horizon" ? field("period_key", t("horizon"), undefined, (invalid, describedBy, inputId) => (
       <select id={inputId} ref={refs.period_key} className={s.select} value={draft.horizonKey}
        aria-invalid={invalid || undefined} aria-describedby={describedBy}
        onChange={(ev) => patch({ horizonKey: ev.target.value })}>
        <option value="">{t("horizonPrompt")}</option>
        {horizonOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
       </select>
      )) : null}
      {draft.mode === "fixed_dates" ? (
       <div className={s.dateRow}>
        {field("period_start", t("start"), undefined, (invalid, describedBy, inputId) => (
         <input id={inputId} ref={refs.period_start} className={s.input} type="text" value={draft.startDate}
          aria-invalid={invalid || undefined} aria-describedby={describedBy}
          onChange={(ev) => patch({ startDate: ev.target.value })} />
        ))}
        {field("period_end", t("end"), undefined, (invalid, describedBy, inputId) => (
         <input id={inputId} ref={refs.period_end} className={s.input} type="text" value={draft.endDate}
          aria-invalid={invalid || undefined} aria-describedby={describedBy}
          onChange={(ev) => patch({ endDate: ev.target.value })} />
        ))}
       </div>
      ) : null}
      {draft.mode === "fixed_dates" ? <p className={s.warn}>{t("fixedNote")}</p> : null}
     </div>
     <div className={s.group}>
      <div className={s.lensBox}>
       <span className={s.lensName}>{t("lensName")}</span>
       <span className={s.note}>{t("lensMeaning")}</span>
      </div>
     </div>
     <div className={s.group}>
      <button type="button" className={`${s.btn} ${s.accent}`} onClick={tryPreview}
       disabled={!props.onPreview}>{t("previewBtn")}</button>
      <p className={s.note}>{t("previewNote")}</p>
      <p className={s.note}>{fxText}</p>
     </div>
    </div>
    <div className={s.column}>
     <div className={`${s.panel} ${s.resultPanel}`} aria-busy={state.pending !== null || undefined} aria-live="polite">
      {state.pending !== null ? (
       <p className={s.note} role="status">{t("loading")}</p>
      ) : qualified && dir ? (
       <>
        <div className={s.resultMain}>
         <div className={s.resultText}>
          <p className={s.headline}>{dir[zh ? 1 : 0]}</p>
          <p className={s.note}>{t("scopeNote")}</p>
         </div>
         <div className={s.bigBox}>
          <span className={s.bigNum}>{bp(Math.abs(qualified.absolute_change_bp))}</span>
          <span className={s.bigLabel}>{dir[zh ? 3 : 2]}</span>
         </div>
        </div>
        <div className={s.tableWrap}>
         <table className={s.table}><tbody>
          {([[t("window"), windowLabel], [t("rowStart"), signedBp(qualified.signed_start_bp)], [t("rowEnd"), signedBp(qualified.signed_end_bp)],
           [t("rowChange"), signedBp(qualified.signed_change_bp)], [t("rowAbs"), signedBp(qualified.absolute_change_bp)],
           [t("rowDir"), dir[zh ? 5 : 4]]] as const).map(([k, v]) => (
           <tr key={k}><th scope="row">{k}</th><td className={v.endsWith("bp") ? s.num : undefined}>{v}</td></tr>
          ))}
         </tbody></table>
        </div>
        {qualified.crosses_zero ? <p className={s.warn}>{t("crossesNote")}</p> : null}
       </>
      ) : unavailable ? (
       <>
        <h4 className={s.title}>{t("unavailableTitle")}</h4>
        <p className={s.note}>{t("unavailableBody")}</p>
        <div className={s.group}>
         <span className={s.label}>{t("reasons")}</span>
         {unavailable.reasons.map((r, i) => (
          <p key={i} className={s.note}>{reasonText(r)}</p>
         ))}
         {unavailable.reasons.length === 0 ? <p className={s.note}>{t("reasonUnknown")}</p> : null}
        </div>
        {missingLabels.length > 0 ? (
         <div className={s.group}>
          <span className={s.label}>{t("missing")}</span>
          {missingLabels.map((m) => <p key={m} className={s.note}>{m}</p>)}
         </div>
        ) : null}
       </>
      ) : (
       <p className={s.note}>{t("idleBody")}</p>
      )}
     </div>
     <div className={s.limit}>
      <div className={s.row}>
       <h4 className={s.title}>{t("baselineTitle")}</h4>
       <span className={baselineComparison ? s.label : s.warn}>{baselineComparison ? baselineComparison.statusLabel : t("baselineTag")}</span>
      </div>
      <p className={s.note}>{baselineComparison ? baselineComparison.description : t("baselineBody")}</p>
     </div>
     <button type="button" className={s.linkBtn} onClick={() => props.onInspectSource?.()}
      disabled={!props.onInspectSource}>{t("inspect")}</button>
     <div className={s.actions}>
      <div className={s.actionsBtns}>
       <button type="button" className={`${s.btn} ${s.ghost}`} onClick={() => props.onBack?.()}
        disabled={!props.onBack}>{t("back")}</button>
       <button type="button" className={`${s.btn} ${s.primary}`} onClick={() => props.onReview?.()}
        disabled={!props.onReview || !state.validation.ok}>{t("reviewBtn")}</button>
      </div>
     </div>
    </div>
   </div>
  </section>
 );
}
