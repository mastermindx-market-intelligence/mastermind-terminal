/**
 * Options R1 W3C — condition watches over a saved investigation. Pure builder and projector:
 * no I/O, no React. Evaluation, delivery, deduplication and access control stay with the
 * existing alerts owner (ingest/alerts_engine.py + /api/alerts); nothing is offered here that
 * the owner cannot evaluate, and every condition carries the `evidence` link back to the exact
 * investigation revision it was created from. The link is outside the owner's transient key set
 * (ingest `_CONDITION_TRANSIENT_KEYS` holds only evaluator state plus `triggered`), so it is
 * hashed into condition_version — a different revision mints a different fire id — and the
 * owner's `price` evaluator reads only `op` and `value`, ignoring it.
 */
import { isValidRoot } from "./flowRoot";

export type WatchKind = "price_touch" | "price_proximity" | "exposure_change" | "rotation_transition" | "event_time";
export const WATCH_KINDS_OFFERED: readonly WatchKind[] = ["price_touch", "price_proximity"];
export type WatchRefusalReason = "no_evaluator" | "strike_level_not_expressible" | "invalid_threshold" | "invalid_symbol";
export interface WatchLink { investigation_id: string; revision: number }
export type WatchCondition =
  | { type: "price"; op: "above" | "below"; value: number; evidence: WatchLink }
  | { type: "opt_wall_touch"; root: string; wall: "call" | "put"; within_pct: number; evidence: WatchLink };
export type WatchBuild =
  | { ok: true; symbol: string; condition: WatchCondition; plain: { en: string; zh: string } }
  | { ok?: undefined; refused: true; kind: WatchKind; reason: WatchRefusalReason; plain: { en: string; zh: string } };

const REFUSALS: Record<WatchRefusalReason, { en: string; zh: string }> = {
  no_evaluator: { en: "No evaluator for this watch kind exists in the alerts owner, so it cannot be armed here.",
    zh: "提醒系统没有此类监测的评估器，无法在此创建。" },
  strike_level_not_expressible: { en: "Price proximity is offered for wall levels only; a single strike is not expressible in the owner's condition.",
    zh: "价格接近仅支持墙位水平；提醒系统的条件无法表达单个行权价。" },
  invalid_threshold: { en: "Enter a threshold greater than zero before arming this watch.",
    zh: "请先输入大于零的阈值，再创建监测。" },
  invalid_symbol: { en: "Enter a readable symbol or options root before arming this watch.",
    zh: "请先输入可读取的代码或期权根代码，再创建监测。" },
};
const refused = (kind: WatchKind, reason: WatchRefusalReason): WatchBuild => ({ refused: true, kind, reason, plain: REFUSALS[reason] });
const LEVEL = "evaluated every 5 minutes against the latest hub quote · fires once, then disarms";
const LEVEL_ZH = "每 5 分钟按最新中枢报价评估 · 触发一次后自动解除";
const level2 = (value: number) => value.toFixed(2);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function buildWatchCondition(
  link: WatchLink, symbol: string, kind: WatchKind,
  params: { op?: "above" | "below"; value?: number; band_pct?: number; wall?: "call" | "put"; strike?: number } = {},
): WatchBuild {
  const name = typeof symbol === "string" ? symbol.trim().toUpperCase() : "";
  if (!name) return refused(kind, "invalid_symbol");
  const evidence: WatchLink = { investigation_id: link.investigation_id, revision: link.revision };
  if (kind === "price_touch") {
    if (!isNum(params.value) || params.value <= 0 || (params.op !== "above" && params.op !== "below")) return refused(kind, "invalid_threshold");
    return { ok: true, symbol: name, condition: { type: "price", op: params.op, value: params.value, evidence },
      plain: { en: `Last price ${params.op} ${level2(params.value)} · ${LEVEL}`, zh: `最新价${params.op === "above" ? "高于" : "低于"} ${level2(params.value)} · ${LEVEL_ZH}` } };
  }
  if (kind === "price_proximity") {
    if (params.strike !== undefined) return refused(kind, "strike_level_not_expressible");
    if (!isValidRoot(name)) return refused(kind, "invalid_symbol");
    if (!isNum(params.band_pct) || params.band_pct <= 0) return refused(kind, "invalid_threshold");
    const wall = params.wall === "put" ? "put" : "call";
    return { ok: true, symbol: name, condition: { type: "opt_wall_touch", root: name, wall, within_pct: params.band_pct, evidence },
      plain: { en: `Last price within ${params.band_pct}% of the ${name} ${wall} wall (EOD level) · ${LEVEL}`, zh: `最新价进入 ${name} ${wall === "put" ? "看跌" : "看涨"}墙（EOD 水平）${params.band_pct}% 以内 · ${LEVEL_ZH}` } };
  }
  return refused(kind, "no_evaluator");
}

/** One row of the owner's GET /api/alerts answer, narrowed to what a watch reads. */
export interface OwnerAlertRow { id: string; symbol?: string; active?: boolean; condition?: Record<string, unknown> & { triggered?: { at?: string; value?: number; note?: string } }; created_at?: string }
export type WatchState = { state: "armed"; since: string | null } | { state: "fired"; at: string; value: number | null; note: string | null; disarmed: boolean } | { state: "unknown" };

export function watchState(row: OwnerAlertRow): WatchState {
  if (!row || typeof row !== "object" || typeof row.id !== "string" || !row.id) return { state: "unknown" };
  const triggered = row.condition && typeof row.condition === "object" ? row.condition.triggered : undefined;
  if (triggered !== undefined && triggered !== null) {
    if (typeof triggered !== "object") return { state: "unknown" };
    return { state: "fired", at: typeof triggered.at === "string" ? triggered.at : "",
      value: isNum(triggered.value) ? triggered.value : null, note: typeof triggered.note === "string" ? triggered.note : null, disarmed: !row.active };
  }
  if (row.active !== true) return { state: "unknown" };
  return { state: "armed", since: typeof row.created_at === "string" ? row.created_at : null };
}

export function watchesFor(rows: readonly OwnerAlertRow[], investigationId: string): OwnerAlertRow[] {
  return (rows ?? []).filter(row => {
    const evidence = row?.condition?.evidence;
    return !!evidence && typeof evidence === "object" && (evidence as WatchLink).investigation_id === investigationId;
  });
}

const BEYOND: Record<"en" | "zh", (current: string, op: "above" | "below" | string, threshold: string) => string> = {
  en: (current, op, threshold) => `The current quote ${current} is already ${op === "above" ? "above" : "below"} ${threshold}, so this watch fires on the next evaluation.`,
  zh: (current, op, threshold) => `当前报价 ${current} 已${op === "above" ? "高于" : "低于"} ${threshold}，此监测将在下一次评估时触发。`,
};

/** Stated before arming: arming while already beyond the threshold fires on the next evaluation. */
export function armingNote(threshold: number, op: "above" | "below", current: { value: number; asOf: string } | null, lang: "en" | "zh"): string {
  if (!current) return lang === "zh"
    ? "此处未加载当前报价；如果价格已越过阈值，此监测将在下一次评估时触发。"
    : "current quote not loaded here; if the price is already beyond the threshold the watch fires on the next evaluation";
  const beyond = op === "above" ? current.value > threshold : current.value < threshold;
  return beyond ? BEYOND[lang](current.value.toFixed(2), op, threshold.toFixed(2)) : "";
}
