"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useLang } from "@/lib/i18n";
import { APPROVE_REASONS, FORM_FIELD_LABELS, REJECT_REASONS, REQUIRED_FORM_FIELDS, confirmActionLabel, eventStateLabel, lifecycleLabel, reasonLabel, visibleReceiptFields, type FormFieldKey } from "./optionsIssueDeskLabels";
import { ISSUE_LIFECYCLE, normalizeIssueDeskPayload, type IssueDeskPayload, type IssueDeskProposal, type IssueDeskPosition } from "./optionsIssueDeskTypes";

type Action = { proposal: IssueDeskProposal; kind: "approve" | "reject" } | null;
type Form = Record<string, string>;
const EMPTY_FORM: Form = {};
const fmtClock = (v: string, zh = false) => new Date(v).toLocaleString(zh ? "zh-CN" : "en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" });
const num = (v: string) => Number(v);
function complete(form: Form, activeAllocation: number, expectedSymbol: string) {
  if (REQUIRED_FORM_FIELDS.some((key) => !form[key]?.trim())) return false;
  const n = (key: string) => num(form[key]);
  return ["reference", "trigger", "no_chase", "stop", "t1", "t2", "t1_fraction", "t2_fraction", "minimum_hold_days", "horizon_days", "invalidation", "strike", "quantity", "premium", "nbbo_bid", "nbbo_ask", "nbbo_mid", "spread", "spread_pct", "allocation"].every((key) => Number.isFinite(n(key)) && n(key) > 0)
    && ["loss_at_stop", "cash_after"].every((key) => Number.isFinite(n(key)) && n(key) >= 0)
    && Number.isInteger(n("minimum_hold_days")) && Number.isInteger(n("horizon_days")) && Number.isInteger(n("quantity")) && n("horizon_days") >= n("minimum_hold_days")
    && n("stop") < n("reference") && n("reference") <= n("trigger") && n("trigger") <= n("no_chase") && n("no_chase") < n("t1") && n("t1") < n("t2") && n("invalidation") <= n("stop")
    && n("t1_fraction") + n("t2_fraction") <= 1 && n("nbbo_bid") <= n("nbbo_mid") && n("nbbo_mid") <= n("nbbo_ask") && Math.abs(n("nbbo_mid") - (n("nbbo_bid") + n("nbbo_ask")) / 2) < .000001 && n("premium") >= n("nbbo_bid") && n("premium") <= n("nbbo_ask")
    && Math.abs(n("spread") - (n("nbbo_ask") - n("nbbo_bid"))) < .000001 && Math.abs(n("spread_pct") - n("spread") / n("nbbo_mid")) < .000001 && n("spread_pct") <= .2
    && n("allocation") <= .25 && n("loss_at_stop") <= n("allocation") && Math.abs(n("cash_after") - (1 - activeAllocation - n("allocation"))) < .000001
    && /^[a-fA-F0-9]{64}$/.test(form.receipt_sha256) && form.right === "C" && form.cooldown_clear === "true" && form.event_risk_clear === "true"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(form.quote_at) && Date.parse(form.quote_at) <= Date.now() && Date.now() - Date.parse(form.quote_at) <= 15 * 60_000 && Date.parse(`${form.expiry}T00:00:00Z`) >= Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`) + n("minimum_hold_days") * 86_400_000
    && (() => { const occ = form.occ_symbol.match(/^([A-Z0-9]{1,6})(\d{6})C(\d{8})$/); return !!occ && occ[1] === expectedSymbol && occ[2] === form.expiry.replaceAll("-", "").slice(2) && Number(occ[3]) / 1000 === n("strike"); })();
}
function issueReceipt(form: Form) {
  return { schema: "options.issue_receipt/v1", underlying: { reference: num(form.reference), trigger: num(form.trigger), no_chase: num(form.no_chase), stop: num(form.stop), t1: num(form.t1), t2: num(form.t2), t1_fraction: num(form.t1_fraction), t2_fraction: num(form.t2_fraction), minimum_hold_days: num(form.minimum_hold_days), horizon_days: num(form.horizon_days), starter_allowed: form.starter_allowed === "true", add_rule: form.add_rule, invalidation: num(form.invalidation) }, option: { occ_symbol: form.occ_symbol, right: "C", strike: num(form.strike), expiry: form.expiry, quantity: num(form.quantity), premium: num(form.premium), nbbo_bid: num(form.nbbo_bid), nbbo_ask: num(form.nbbo_ask), nbbo_mid: num(form.nbbo_mid), quote_at: form.quote_at, quote_source: form.quote_source, receipt_sha256: form.receipt_sha256, spread: num(form.spread), spread_pct: num(form.spread_pct) }, risk: { allocation_weight: num(form.allocation), loss_at_stop_weight: num(form.loss_at_stop), cash_after_weight: num(form.cash_after), disclosure: form.risk_disclosure }, portfolio_fit: { regime_alignment: "ALIGNED", sleeve: form.sleeve, correlation_cluster: form.correlation_cluster, cooldown_clear: form.cooldown_clear === "true", event_risk_clear: form.event_risk_clear === "true" } };
}
const copy = (zh: boolean, cn: string, en: string) => zh ? cn : en;
function prefill(proposal: IssueDeskProposal): Form {
  const macro = proposal.receipts.macro_candidate;
  if (!macro || typeof macro !== "object" || Array.isArray(macro)) return EMPTY_FORM;
  const receipt = macro as Record<string, unknown>;
  const value = (key: string) => typeof receipt[key] === "number" ? String(receipt[key]) : "";
  const targets = Array.isArray(receipt.targets) ? receipt.targets : [];
  return { reference: value("entry"), trigger: value("trigger"), no_chase: value("trigger"), stop: value("invalidation"), invalidation: value("invalidation"), t1: typeof targets[0] === "number" ? String(targets[0]) : "", t2: typeof targets[1] === "number" ? String(targets[1]) : "", horizon_days: value("horizon_days"), reason_codes: "" };
}

function Lifecycle({ position, zh }: { position: IssueDeskPosition; zh: boolean }) {
  const visited = new Set(position.events.map((event) => event.state));
  const receiptFields = visibleReceiptFields(position.issue_receipt, zh);
  return <article className="obs-issue-position" data-testid="issue-desk-position">
    <header><div><b>{position.symbol}</b><span>{copy(zh, "仅研究计划 · 非经纪交易", "Research plan only · not a brokerage trade")}</span></div><strong>{lifecycleLabel(position.lifecycle_state, zh)}</strong></header>
    <div className="obs-issue-lifecycle" aria-label={copy(zh, "持仓生命周期", "Position lifecycle")}>
      {ISSUE_LIFECYCLE.slice(0, 5).map((step) => <span key={step} className={visited.has(step) ? "is-done" : ""}>{lifecycleLabel(step, zh)}</span>)}
      <span className="obs-issue-terminal-label">{copy(zh, "终态", "End states")}</span>
      {ISSUE_LIFECYCLE.slice(5).map((step) => <span key={step} className={`obs-issue-terminal ${visited.has(step) ? "is-done" : ""}`}>{lifecycleLabel(step, zh)}</span>)}
    </div>
    <div className="obs-issue-events">{position.events.map((event) => <div key={event.event_id}><b>{eventStateLabel(event.state, zh)}</b><time>{fmtClock(event.available_at, zh)}</time><span>{event.reason_codes.map((code) => reasonLabel(code, zh)).join(" · ") || "—"}</span></div>)}</div>
    {receiptFields.length > 0 && <dl className="obs-issue-receipt-fields">{receiptFields.map((field) => <div key={field.key}><dt>{field.label}</dt><dd>{field.kind === "time" ? fmtClock(field.value, zh) : field.value}</dd></div>)}</dl>}
    <details><summary>{copy(zh, "显示技术细节", "Show technical details")}</summary><pre>{JSON.stringify(position.issue_receipt, null, 2)}</pre></details>
  </article>;
}

function ApprovalEditor({ form, setForm, zh }: { form: Form; setForm: (form: Form) => void; zh: boolean }) {
  const field = (key: FormFieldKey, type = "text") => { const [en, cn] = FORM_FIELD_LABELS[key]; return <label key={key}><span>{copy(zh, cn, en)}</span><input type={type} value={form[key] ?? ""} onChange={(e) => setForm({ ...form, [key]: e.target.value })} /></label>; };
  return <div className="obs-issue-editor" data-testid="issue-desk-approval-editor">
    <p>{copy(zh, "操作员证明的研究发布凭据。系统不会从当前期权数据中猜测合约或报价。", "Operator-attested research issue receipt. The desk never guesses a contract or quote from current options data.")}</p>
    <h4>{copy(zh, "底层计划", "Underlying plan")}</h4><div className="obs-issue-form-grid">{field("reference", "number")}{field("trigger", "number")}{field("no_chase", "number")}{field("stop", "number")}{field("t1", "number")}{field("t2", "number")}{field("t1_fraction", "number")}{field("t2_fraction", "number")}{field("minimum_hold_days", "number")}{field("horizon_days", "number")}{field("starter_allowed")}{field("add_rule")}{field("invalidation")}</div>
    <h4>{copy(zh, "期权执行", "Option execution")}</h4><div className="obs-issue-form-grid">{field("occ_symbol")}{field("right")}{field("strike", "number")}{field("expiry")}{field("quantity", "number")}{field("premium", "number")}{field("nbbo_bid", "number")}{field("nbbo_ask", "number")}{field("nbbo_mid", "number")}{field("spread", "number")}{field("spread_pct", "number")}{field("quote_at")}{field("quote_source")}{field("receipt_sha256")}</div>
    <h4>{copy(zh, "风险、披露与组合契合度", "Risk, disclosure, and portfolio fit")}</h4><div className="obs-issue-form-grid">{field("allocation", "number")}{field("loss_at_stop", "number")}{field("cash_after", "number")}{field("risk_disclosure")}{field("sleeve")}{field("correlation_cluster")}{field("cooldown_clear")}{field("event_risk_clear")}</div>
  </div>;
}

export function OptionsIssueDeskView() {
  const { lang } = useLang(); const zh = lang === "zh";
  const [payload, setPayload] = useState<IssueDeskPayload | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const [action, setAction] = useState<Action>(null); const [form, setForm] = useState<Form>(EMPTY_FORM); const [submitting, setSubmitting] = useState(false); const [idempotencyKey, setIdempotencyKey] = useState("");
  const load = useCallback(async () => { setLoading(true); setError(null); try { const response = await fetch("/api/options/issue-desk", { cache: "no-store" }); if (!response.ok) throw new Error(String(response.status)); const next = normalizeIssueDeskPayload(await response.json()); if (!next) throw new Error("contract"); setPayload(next); } catch (e) { setError(e instanceof Error ? e.message : "error"); } finally { setLoading(false); } }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
  const activeAllocation = useMemo(() => payload?.positions.reduce((total, position) => total + Number((position.issue_receipt.risk as Record<string, unknown>).allocation_weight ?? 0), 0) ?? 0, [payload]);
  const receiptReady = useMemo(() => complete(form, activeAllocation, action?.proposal.symbol ?? ""), [form, activeAllocation, action]);
  const reasonCodes = form.reason_codes?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  const submit = async () => { if (!action || submitting || !reasonCodes.length || reasonCodes.length > 8 || (action.kind === "approve" && !receiptReady)) return; setSubmitting(true); setError(null); try { const response = await fetch("/api/options/issue-desk/reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proposal_id: action.proposal.proposal_id, proposal_revision: action.proposal.proposal_revision, action: action.kind, reason_codes: reasonCodes, idempotency_key: idempotencyKey, ...(action.kind === "approve" ? { issue_receipt: issueReceipt(form) } : {}) }) }); if (!response.ok) { await load(); throw new Error(String(response.status)); } setAction(null); setForm(EMPTY_FORM); setIdempotencyKey(""); await load(); } catch (e) { setError(e instanceof Error ? e.message : "error"); } finally { setSubmitting(false); } };
  if (loading && !payload) return <div className="obs-issue-state">{copy(zh, "正在加载发布台…", "Loading Issue Desk…")}</div>;
  if (!payload) return <div className="obs-issue-state"><span>{error === "403" ? copy(zh, "需要操作员权限", "Operator authority required") : copy(zh, "发布台不可用", "Issue Desk unavailable")}</span><button className="obs-chip" onClick={load}>{copy(zh, "重试", "Retry")}</button></div>;
  return <section className="obs-issue-desk" data-testid="issue-desk"><header className="obs-issue-head"><div><span>{copy(zh, "人工审核 · 研究组合", "Human-reviewed · research portfolio")}</span><h2>{copy(zh, "Issue Desk 发布台", "Issue Desk")}</h2><p>{copy(zh, "候选方案不是信号。审批是明确的人类操作；不会改变 Macro 排名，也不会成为自动期权阿尔法。", "Proposals are not signals. Approval is an explicit human action; it cannot change Macro rank or become automatic Options Alpha.")}</p></div><div className="obs-issue-capacity"><b>{payload.capacity.remaining} / {payload.capacity.max_new_issues}</b><span>{copy(zh, "可发布名额 · 过去 3 个交易日", "issue slots · rolling 3 sessions")}</span><small>{copy(zh, "允许不发布", "abstention allowed")}</small></div></header>
    {error && <p className="obs-issue-error">{copy(zh, "操作未完成；已尽可能重新核对权威状态。", "Action was not completed; canonical state was rechecked when available.")} ({error})</p>}
    <section className="obs-issue-section"><header><h3>{copy(zh, "待审核提案", "Pending review")}</h3><span>{copy(zh, "精确 UTC：", "Exact UTC: ")}{payload.available_at}</span></header><div className="obs-issue-proposals">{payload.proposals.filter((p) => p.state === "PENDING_REVIEW").map((proposal) => <article key={proposal.proposal_id} className="obs-issue-proposal" data-testid="issue-desk-proposal"><div><b>{proposal.symbol}</b><span>{copy(zh, "待审核 · 非信号", "Pending review · not a signal")}</span></div><dl><div><dt>{copy(zh, "创建", "Created")}</dt><dd>{fmtClock(proposal.created_at, zh)}</dd></div><div><dt>{copy(zh, "可用", "Available")}</dt><dd>{fmtClock(proposal.available_at, zh)}</dd></div></dl><p>{proposal.reason_codes.length ? proposal.reason_codes.map((code) => reasonLabel(code, zh)).join(" · ") : copy(zh, "已冻结的研究凭据", "Frozen research receipts")}</p><details><summary>{copy(zh, "显示技术细节", "Show technical details")}</summary><pre>{JSON.stringify(proposal.receipts, null, 2)}</pre></details><div className="obs-issue-actions"><button className="obs-chip" onClick={() => { setAction({ proposal, kind: "reject" }); setForm({ reason_codes: "" }); setIdempotencyKey(crypto.randomUUID?.() ?? `${Date.now()}-issue-desk-review`); }}>{copy(zh, "拒绝", "Reject")}</button><button className="obs-chip is-primary" onClick={() => { setAction({ proposal, kind: "approve" }); setForm(prefill(proposal)); setIdempotencyKey(crypto.randomUUID?.() ?? `${Date.now()}-issue-desk-review`); }}>{copy(zh, "审批并发布研究计划", "Approve & issue research plan")}</button></div></article>)}{!payload.proposals.some((p) => p.state === "PENDING_REVIEW") && <p>{copy(zh, "当前没有待审核提案。无需凑满名额。", "No pending proposals. Slots are not a quota.")}</p>}</div></section>
    <section className="obs-issue-section"><header><h3>{copy(zh, "研究计划生命周期", "Research-plan lifecycle")}</h3><span>{copy(zh, "附加式事件 · 非经纪交易", "append-only events · not brokerage trades")}</span></header><div className="obs-issue-positions">{payload.positions.map((position) => <Lifecycle key={position.position_id} position={position} zh={zh} />)}{!payload.positions.length && <p>{copy(zh, "尚未发布研究计划。", "No research plans issued.")}</p>}</div></section>
    {action && createPortal(<div className="obs-issue-confirm" role="dialog" aria-modal="true" aria-label={copy(zh, "确认审核操作", "Confirm review action")}><div><h3>{action.kind === "approve" ? copy(zh, "确认发布研究计划", "Confirm research-plan issuance") : copy(zh, "确认拒绝", "Confirm rejection")}</h3><p>{confirmActionLabel(action.kind, action.proposal.symbol, zh)}</p><details><summary>{copy(zh, "显示技术细节", "Show technical details")}</summary><dl><div><dt>{copy(zh, "提案编号", "Proposal reference")}</dt><dd>{action.proposal.proposal_id}</dd></div></dl></details><label className="obs-issue-reasons"><span>{copy(zh, "原因", "Reason")}</span><select value={form.reason_codes ?? ""} onChange={(e) => setForm({ ...form, reason_codes: e.target.value })}><option value="">{copy(zh, "选择原因", "Select a reason")}</option>{(action.kind === "approve" ? APPROVE_REASONS : REJECT_REASONS).map((reason) => <option key={reason} value={reason}>{reasonLabel(reason, zh)}</option>)}</select></label>{action.kind === "approve" && <ApprovalEditor form={form} setForm={setForm} zh={zh} />}<div className="obs-issue-actions"><button className="obs-chip" onClick={() => { setAction(null); setForm(EMPTY_FORM); setIdempotencyKey(""); }}>{copy(zh, "取消", "Cancel")}</button><button className="obs-chip is-primary" disabled={submitting || !reasonCodes.length || reasonCodes.length > 8 || (action.kind === "approve" && !receiptReady)} onClick={submit}>{submitting ? copy(zh, "提交中…", "Submitting…") : action.kind === "approve" ? copy(zh, "确认发布", "Confirm issue") : copy(zh, "确认拒绝", "Confirm reject")}</button></div>{action.kind === "approve" && !receiptReady && <small>{copy(zh, "必须填写并通过所有操作员证明的底层、期权、NBBO、风险及披露字段。", "Complete and valid operator-attested underlying, option, NBBO, risk, and disclosure fields are required.")}</small>}</div></div>, document.body)}
  </section>;
}
