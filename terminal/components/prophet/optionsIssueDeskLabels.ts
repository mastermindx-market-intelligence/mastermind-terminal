import type { IssueLifecycleState } from "./optionsIssueDeskTypes";

export type Pair = readonly [en: string, zh: string];

const NOT_CLASSIFIED: Pair = ["Not classified", "未分类"];

export const APPROVE_REASONS = ["PORTFOLIO_FIT", "REGIME_ALIGNED", "EXECUTION_VERIFIED", "DIVERSIFICATION_FIT"] as const;
export const REJECT_REASONS = ["ABSTAIN", "REGIME_MISMATCH", "CORRELATION_CAP", "COOLDOWN", "EVENT_RISK", "EXECUTION_MISSING", "LIQUIDITY", "NO_EDGE"] as const;
export const REQUIRED_FORM_FIELDS = ["reference", "trigger", "no_chase", "stop", "t1", "t2", "t1_fraction", "t2_fraction", "minimum_hold_days", "horizon_days", "starter_allowed", "add_rule", "invalidation", "occ_symbol", "right", "strike", "expiry", "quantity", "premium", "nbbo_bid", "nbbo_ask", "nbbo_mid", "quote_at", "quote_source", "receipt_sha256", "spread", "spread_pct", "allocation", "loss_at_stop", "cash_after", "risk_disclosure", "sleeve", "correlation_cluster", "cooldown_clear", "event_risk_clear"] as const;

export type ApproveReason = typeof APPROVE_REASONS[number];
export type RejectReason = typeof REJECT_REASONS[number];
export type FormFieldKey = typeof REQUIRED_FORM_FIELDS[number];

export const LIFECYCLE_LABELS: { [K in IssueLifecycleState]: Pair } = {
  ISSUED: ["Issued", "已发布"],
  PARTIAL_ALLOWED: ["Partial position allowed", "允许部分建仓"],
  ARMED: ["Waiting for the trigger", "等待触发"],
  TRIGGERED: ["Triggered", "已触发"],
  MANAGED: ["Being managed", "管理中"],
  CLOSED: ["Closed", "已结束"],
  CANCELLED: ["Cancelled", "已取消"],
  INVALIDATED: ["Plan no longer valid", "计划已失效"],
};

export const EVENT_STATE_LABELS = LIFECYCLE_LABELS;

export const FORM_FIELD_LABELS: Record<FormFieldKey, Pair> = {
  reference: ["Reference price", "参考价"],
  trigger: ["Trigger price", "触发价"],
  no_chase: ["Do-not-chase ceiling", "不追价上限"],
  stop: ["Stop", "止损"],
  t1: ["First target", "目标一"],
  t2: ["Second target", "目标二"],
  t1_fraction: ["Fraction at first target", "目标一比例"],
  t2_fraction: ["Fraction at second target", "目标二比例"],
  minimum_hold_days: ["Minimum hold days", "最短持有天数"],
  horizon_days: ["Holding period days", "持有期限天数"],
  starter_allowed: ["Allow a starter position (true/false)", "允许初始仓 (true/false)"],
  add_rule: ["Add-on rule", "加仓规则"],
  invalidation: ["Invalidation level", "失效价"],
  occ_symbol: ["OCC symbol (official options clearing record)", "OCC 代码（期权清算公司正式记录）"],
  right: ["Call only (C)", "方向（仅认购 C）"],
  strike: ["Strike", "行权价"],
  expiry: ["Expiry (YYYY-MM-DD)", "到期日 (YYYY-MM-DD)"],
  quantity: ["Quantity", "数量"],
  premium: ["Premium", "权利金"],
  nbbo_bid: ["NBBO (best available quote) · bid", "NBBO（最优买卖报价）· 买价"],
  nbbo_ask: ["NBBO ask", "NBBO 卖价"],
  nbbo_mid: ["NBBO mid", "NBBO 中间价"],
  spread: ["Spread", "价差"],
  spread_pct: ["Spread percent", "价差百分比"],
  quote_at: ["Quote time (UTC)", "报价时间 (UTC)"],
  quote_source: ["Quote source", "报价来源"],
  receipt_sha256: ["Receipt fingerprint (SHA-256)", "凭据指纹（SHA-256）"],
  allocation: ["Allocation weight", "配置比例"],
  loss_at_stop: ["Loss at stop weight", "止损损失"],
  cash_after: ["Cash after weight", "剩余现金"],
  risk_disclosure: ["Risk disclosure", "风险披露"],
  sleeve: ["Portfolio group", "组合分组"],
  correlation_cluster: ["Related-name group", "相关标的组"],
  cooldown_clear: ["Cooldown period has passed (true)", "冷却期已过 (true)"],
  event_risk_clear: ["Event risk is clear (true)", "事件风险已排除 (true)"],
};

export const APPROVE_REASON_LABELS: { [K in ApproveReason]: Pair } = {
  PORTFOLIO_FIT: ["Fits the portfolio", "符合组合要求"],
  REGIME_ALIGNED: ["Fits current market conditions", "符合当前市场环境"],
  EXECUTION_VERIFIED: ["Execution details verified", "执行细节已核实"],
  DIVERSIFICATION_FIT: ["Adds diversification", "有助于分散风险"],
};

export const REJECT_REASON_LABELS: { [K in RejectReason]: Pair } = {
  ABSTAIN: ["Choosing not to issue", "选择不发布"],
  REGIME_MISMATCH: ["Market conditions do not fit", "市场环境不匹配"],
  CORRELATION_CAP: ["Too similar to existing names", "与已有标的过于相似"],
  COOLDOWN: ["Still in a cooldown period", "仍在冷却期内"],
  EVENT_RISK: ["Event risk is too high", "事件风险过高"],
  EXECUTION_MISSING: ["Execution details are missing", "缺少执行细节"],
  LIQUIDITY: ["Liquidity is too thin", "流动性不足"],
  NO_EDGE: ["No clear advantage", "没有明显优势"],
};

const QUOTE_SOURCE_LABELS: Record<string, Pair> = {
  operator_attested_nbbo: ["Operator-attested best available quote", "操作员确认的最优买卖报价"],
};

function pickLabel(map: Record<string, Pair>, code: string, zh: boolean): string {
  const pair = map[code];
  if (!pair?.[0] || !pair[1]) return zh ? NOT_CLASSIFIED[1] : NOT_CLASSIFIED[0];
  return zh ? pair[1] : pair[0];
}

export function lifecycleLabel(code: string, zh: boolean): string {
  return pickLabel(LIFECYCLE_LABELS, code, zh);
}

export function eventStateLabel(code: string, zh: boolean): string {
  return pickLabel(EVENT_STATE_LABELS, code, zh);
}

export function approveReasonLabel(code: string, zh: boolean): string {
  return pickLabel(APPROVE_REASON_LABELS, code, zh);
}

export function rejectReasonLabel(code: string, zh: boolean): string {
  return pickLabel(REJECT_REASON_LABELS, code, zh);
}

export function reasonLabel(code: string, zh: boolean): string {
  return pickLabel({ ...APPROVE_REASON_LABELS, ...REJECT_REASON_LABELS }, code, zh);
}

function humaniseAttested(text: string): string {
  const normalised = text.trim().replace(/[_-]/g, " ").replace(/\s+/g, " ");
  if (!normalised) return "";
  return normalised.charAt(0).toUpperCase() + normalised.slice(1);
}

export function quoteSourceLabel(code: string, zh: boolean): string {
  const trimmed = code.trim();
  if (!trimmed) return "";
  const mapped = QUOTE_SOURCE_LABELS[trimmed];
  if (mapped?.[0] && mapped[1]) return zh ? mapped[1] : mapped[0];
  return humaniseAttested(trimmed);
}

export function confirmActionLabel(kind: "approve" | "reject", symbol: string, zh: boolean): string {
  if (kind === "approve") return zh ? `为 ${symbol} 发布研究计划` : `Issue a research plan for ${symbol}`;
  return zh ? `拒绝 ${symbol} 提案` : `Reject the ${symbol} proposal`;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

function presentText(v: unknown): string | null {
  if (typeof v === "string") {
    const text = v.trim();
    return text && text !== "undefined" && text !== "null" ? text : null;
  }
  return typeof v === "number" && Number.isFinite(v) ? String(v) : null;
}

export type ReceiptDisplayField = {
  key: "contract" | "quote_source" | "timestamp";
  label: string;
  value: string;
  kind: "text" | "time";
};

export function visibleReceiptFields(receipt: unknown, zh: boolean): ReceiptDisplayField[] {
  const root = asRecord(receipt);
  const option = asRecord(root?.option) ?? {};
  const fields: ReceiptDisplayField[] = [];
  const contract = presentText(option.occ_symbol);
  if (contract) fields.push({ key: "contract", label: zh ? "合约（OCC 代码）" : "Contract (OCC symbol)", value: contract, kind: "text" });
  const quoteSource = presentText(option.quote_source);
  const quoteSourceText = quoteSource ? quoteSourceLabel(quoteSource, zh) : "";
  if (quoteSourceText) fields.push({ key: "quote_source", label: zh ? "报价来源" : "Quote source", value: quoteSourceText, kind: "text" });
  const timestamp = presentText(option.quote_at);
  if (timestamp) fields.push({ key: "timestamp", label: zh ? "报价时间（纽约）" : "Quote time (New York)", value: timestamp, kind: "time" });
  return fields;
}
