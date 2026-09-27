// CMX W3 — the conductor's pure state machine.
//
// This is the DOM-free, framework-free brain of the ChartConductor overlay: it turns the chartBus
// CommandQueue's lifecycle + step stream (see lib/chartBus.ts — onBatchStart / on(step) / onDrain)
// into the overlay's visible state (orb phase, current caption, the step-rail log, the done count).
// ChartConductor.tsx is the thin React view that feeds events in and renders the returned state; ALL
// the transition logic + caption-fallback + done-count arithmetic live here so they unit-test in the
// repo's pure-logic vitest idiom (no jsdom, no @testing-library) exactly like chartBus.test.ts.
//
// Design stance (Fable): one orchestrated moment. The machine is deliberately small — five phases,
// one reducer, no timers of its own (the view owns the 1.2s done-delay + the 650ms pace and feeds a
// "drain"/"doneTimer" event when they fire). Determinism here is what makes the whole overlay testable.

import type { QueueStep, Fit } from "@/lib/chartBus";
import type { Lang } from "@/lib/i18n";

// ── phases ──────────────────────────────────────────────────────────────────────────────────────
// idle      — no session; overlay dormant (only the permanent W1 .ai-chip shows).
// summoned  — batch-start fired; the orb blooms in. First frame of a session.
// thinking  — session live, between applied steps (orb breathes).
// acting    — a step just applied (orb fires its per-op pulse). Collapses back to thinking.
// done      — queue drained; orb settles, plate shows the "Done — N" line for its window.
export type Phase = "idle" | "summoned" | "thinking" | "acting" | "done";

// One row in the step rail. `family` drives the row icon; `fit` (when present) is the ack chip.
export type OpFamily = "chart" | "line" | "zone" | "fib" | "label" | "ai" | "scene";
export type RailRow = {
  seq: number;      // monotonic per-session index (rail key + ordering)
  op: QueueStep["op"];
  family: OpFamily;
  caption: string;  // resolved caption (model caption, or the plain per-family fallback)
  fit?: Fit;        // {touches, max_dev_atr} — shown as a mono chip, raw numbers only
  ok: boolean;
  error?: string; // bounded machine code, never arbitrary exception prose
};

export type ConductorState = {
  phase: Phase;
  caption: string;     // the CURRENT plate caption (last applied step's caption); "" when idle
  rows: RailRow[];     // newest last; the rail auto-follows to the bottom
  applied: number;     // count of ok draw/chart ops applied this session (the done-count)
  captionSwapKey: number; // bumps on every caption change so the view can re-trigger the crossfade
};

export const initialConductorState = (): ConductorState => ({
  phase: "idle",
  caption: "",
  rows: [],
  applied: 0,
  captionSwapKey: 0,
});

// ── op family classification ──────────────────────────────────────────────────────────────────
// Maps a chartBus op to its rail-icon family. Kept exhaustive over the op vocabulary so a new op
// surfaces here as a compile prompt rather than silently defaulting.
export function opFamily(op: QueueStep["op"]): OpFamily {
  switch (op) {
    case "unknown":
    case "chart.set_symbol":
    case "chart.set_tf":
    case "chart.set_indicators":
    case "chart.set_range":
      return "chart";
    case "draw.trendline":
    case "draw.ray":
    case "draw.hline":
    case "draw.channel":
    case "draw.path":
      return "line";
    case "draw.zone":
    case "draw.risk_box":
      return "zone";
    case "draw.fib":
      return "fib";
    case "draw.label":
    case "draw.marker":
      return "label";
    case "ai.clear":
    case "ai.undo":
      return "ai";
    case "scene.begin":
    case "scene.end":
      return "scene";
  }
  return "line";
}

// ── caption fallback ────────────────────────────────────────────────────────────────────────────
// When a step arrives with no model caption, show a plain per-family line (EN/ZH). The model's own
// captions are already language-matched and are shown verbatim (textContent) by the view; these are
// only the gap-fillers. Deliberately generic — never invents a verdict or a specific level.
const FAMILY_FALLBACK: Record<OpFamily, [string, string]> = {
  chart: ["Setting the timeframe", "调整时间周期"],
  line: ["Drawing a line", "绘制线条"],
  zone: ["Marking a zone", "标注区域"],
  fib: ["Mapping the retracement", "映射回撤"],
  label: ["Placing a label", "添加标签"],
  ai: ["Clearing the layer", "清除图层"],
  scene: ["Setting the scene", "布置场景"],
};

export type StepOutcome = "accepted" | "rejected" | "unconfirmed" | "cancelled";

function errorCode(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,79}$/.test(value) ? value : undefined;
}

/** A throwing setter may already have changed the chart; never label it a no-effect refusal. */
export function stepOutcome(step: Pick<QueueStep, "ok" | "error">): StepOutcome {
  if (step.ok) return "accepted";
  const code = errorCode(step.error);
  if (code === "command_cancelled_by_user" || code === "command_cancel_receipt_failed") return "cancelled";
  return code?.endsWith("_application_failed") ? "unconfirmed" : "rejected";
}

export function outcomeLabel(outcome: StepOutcome, lang: Lang): string {
  const labels: Record<StepOutcome, [string, string]> = {
    accepted: ["Accepted", "已接受"], rejected: ["Not applied", "未执行"],
    unconfirmed: ["Unconfirmed", "结果未确认"], cancelled: ["Cancelled", "已取消"],
  };
  return labels[outcome][lang === "zh" ? 1 : 0];
}

/** Fixed product copy only: client captions/errors cannot impersonate a successful action. */
export function rejectionCaption(error: unknown, lang: Lang): string {
  const code = errorCode(error);
  const pair: [string, string] = code === "command_cancelled_by_user"
    ? ["Cancelled before execution. Changes already applied were kept.", "已在执行前取消。之前已执行的更改保留。"]
    : code === "command_cancel_receipt_failed"
      ? ["Cancelled locally; the acknowledgement could not be recorded.", "已在本地取消，但未能记录确认回执。"]
    : code?.endsWith("_application_failed")
    ? ["Could not confirm the change. Inspect the chart before trying again.", "无法确认更改结果。请先检查图表，再决定是否重试。"]
    : code === "command_target_transition_pending"
      ? ["The chart is still switching. Read it again before sending this action.", "图表仍在切换。请重新读取图表后再发出此操作。"]
    : code?.startsWith("command_target_") && code.endsWith("_mismatch")
      ? ["The chart changed. This action was not applied to the new view.", "图表已改变。此操作未在新视图中执行。"]
    : code === "command_target_required" || code === "command_target_unavailable" || code === "bad_command_target"
      ? ["The intended chart could not be confirmed. Reconnect and read the chart first.", "无法确认目标图表。请先重新连接并读取图表。"]
    : code === "command_receiver_unmounted"
      ? ["The chart was closed before this action could run.", "图表已关闭，此操作未执行。"]
    : code === "unknown_ai_object"
      ? ["An AI mark in this selection is no longer present. Refresh the selection.", "所选 AI 标注已不存在。请更新选择。"]
    : code === "object_cap_exceeded" || code === "batch_cap_exceeded"
      ? ["The chart's annotation limit was reached. Use fewer AI marks.", "已达到图表标注上限。请减少 AI 标注数量。"]
    : code?.includes("indicator") || code?.includes("native_setting") || code === "bad_native_params"
      ? ["The requested study edit is not supported or has invalid settings.", "不支持此指标编辑，或参数无效。"]
    : code === "bad_range"
      ? ["The requested chart range is invalid. Choose a valid start and end.", "请求的图表范围无效。请选择有效的起止时间。"]
    : ["This chart action was rejected. Read the chart before changing the request.", "图表拒绝了此操作。请先读取图表，再修改请求。"];
  return pair[lang === "zh" ? 1 : 0];
}

export function captionFor(
  step: Pick<QueueStep, "op" | "caption"> & Partial<Pick<QueueStep, "ok" | "error">>, lang: Lang,
): string {
  if (step.ok === false) return rejectionCaption(step.error, lang);
  const c = (step.caption ?? "").trim();
  if (c) return c;
  // The old family fallback called every chart command a timeframe change and every
  // AI command a clear. Describe the actual op without inventing a symbol or value.
  const specific: Partial<Record<QueueStep["op"], [string, string]>> = {
    "chart.set_symbol": ["Changing the chart symbol", "切换图表标的"],
    "chart.set_tf": ["Setting the timeframe", "调整时间周期"],
    "chart.set_indicators": ["Updating chart studies", "更新图表指标"],
    "chart.set_range": ["Adjusting the chart view", "调整图表视图"],
    "ai.clear": ["Removing AI marks", "移除 AI 标注"],
    "ai.undo": ["Reverting the latest AI drawing group", "撤回最近一组 AI 绘图"],
    unknown: ["Unsupported chart action", "不支持的图表操作"],
  };
  const pair = specific[step.op] ?? FAMILY_FALLBACK[opFamily(step.op)];
  return pair[lang === "zh" ? 1 : 0];
}

/** Counts command results, not pixels. Zero live marks must remain zero after a clear. */
export function conductorSummary(state: Pick<ConductorState, "rows">, count: number, lang: Lang): string {
  const totals: Record<StepOutcome, number> = { accepted: 0, rejected: 0, unconfirmed: 0, cancelled: 0 };
  for (const row of state.rows) {
    if (row.ok && opFamily(row.op) === "scene") continue; // scene markers are not chart mutations
    totals[stepOutcome(row)] += 1;
  }
  const parts: string[] = [];
  if (totals.accepted) parts.push(lang === "zh" ? `${totals.accepted} 项已接受` : `${totals.accepted} accepted`);
  if (totals.rejected) parts.push(lang === "zh" ? `${totals.rejected} 项未执行` : `${totals.rejected} not applied`);
  if (totals.unconfirmed) parts.push(lang === "zh" ? `${totals.unconfirmed} 项结果未确认` : `${totals.unconfirmed} unconfirmed`);
  if (totals.cancelled) parts.push(lang === "zh" ? `${totals.cancelled} 项已取消` : `${totals.cancelled} cancelled`);
  const marks = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : null;
  if (!parts.length) parts.push(lang === "zh" ? "无图表操作" : "No chart actions");
  if (marks !== null) parts.push(lang === "zh" ? `${marks} 个 AI 标注` : `${marks} AI marks`);
  return parts.join(" · ");
}

// Whether an applied step counts toward the done "N on chart" tally + the acting pulse. Draw ops that
// put an object on the chart count; chart.* view changes and scene markers do not (nothing is "on
// chart" from them), and rejects (ok:false) never count. ai.clear/undo are not additive either.
export function isChartObjectOp(op: QueueStep["op"]): boolean {
  return opFamily(op) === "line" || opFamily(op) === "zone" || opFamily(op) === "fib" || opFamily(op) === "label";
}

// ── the reducer ─────────────────────────────────────────────────────────────────────────────────
export type ConductorEvent =
  | { type: "start" }                                   // batch-start edge (queue idle → work)
  | { type: "step"; step: QueueStep; lang: Lang }       // a QueueStep was emitted (op applied/rejected)
  | { type: "drain" }                                   // queue emptied (paced path or skip)
  | { type: "doneWindowElapsed" }                       // the view's 5s done-plate window closed
  | { type: "reset" };                                  // hard reset back to idle (e.g. overlay unmount)

export function conductorReducer(s: ConductorState, ev: ConductorEvent): ConductorState {
  switch (ev.type) {
    case "start": {
      // Follow-on notifications inside the existing settle window belong to the same
      // visible sequence. Do not erase an immediate rejection when the next command arrives.
      if (s.phase !== "idle" && s.phase !== "done") return { ...s, phase: "thinking" };
      return { phase: "summoned", caption: "", rows: [], applied: 0, captionSwapKey: s.captionSwapKey + 1 };
    }
    case "step": {
      const { step, lang } = ev;
      const caption = captionFor(step, lang);
      const row: RailRow = {
        seq: s.rows.length,
        op: step.op,
        family: opFamily(step.op),
        caption,
        fit: step.ok ? step.fit : undefined,
        ok: step.ok,
        error: errorCode(step.error),
      };
      const applied = s.applied + (step.ok && isChartObjectOp(step.op) ? 1 : 0);
      // An applied step lands the orb in "acting"; a rejected step doesn't pulse but is still logged.
      const phase: Phase = step.ok ? "acting" : (s.phase === "idle" ? "summoned" : s.phase);
      // A refusal must be visible even when no action succeeded. Its fixed reason replaces
      // a model caption that might incorrectly say the rejected edit was already done.
      const nextCaption = caption;
      const swap = caption !== s.caption ? s.captionSwapKey + 1 : s.captionSwapKey;
      return { phase, caption: nextCaption, rows: [...s.rows, row], applied, captionSwapKey: swap };
    }
    case "drain": {
      // Queue empty → done. If nothing was ever applied (an all-reject session) we still settle to
      // done so the overlay resolves rather than hanging in "acting".
      if (s.phase === "idle") return s;
      return { ...s, phase: "done" };
    }
    case "doneWindowElapsed": {
      // The 5s done-plate window closed. Phase returns to idle so the plate collapses + the orb starts
      // its linger-fade — but the rows/applied tally are KEPT so a rail opened after the session ended
      // still shows what the Brain drew (spec: "If the rail is open it stays until closed"). The next
      // session's "start" is what clears the rail. Guard: only from done (a new session may have begun).
      if (s.phase !== "done") return s;
      return { ...s, phase: "idle", caption: "" };
    }
    case "reset":
      return initialConductorState();
  }
  return s;
}

// ── pacing constants (single source of truth, shared with the view + tests) ─────────────────────
export const PACE_MS = 650;        // queue delay while a session animates (reduced-motion → 0)
export const DONE_SETTLE_MS = 1200; // idle-after-drain before the done plate shows
export const DONE_WINDOW_MS = 5000; // how long the "Done — N" plate stays before collapsing
export const ORB_LINGER_MS = 12000; // orb fade after the done window
