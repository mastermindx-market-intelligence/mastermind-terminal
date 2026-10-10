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

import type { ChartOp, QueueStep, Fit } from "@/lib/chartBus";
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
  op: ChartOp;
  family: OpFamily;
  caption: string;  // resolved caption (model caption, or the plain per-family fallback)
  fit?: Fit;        // {touches, max_dev_atr} — shown as a mono chip via fitBadgeText (LEX cmxFitOne/cmxFitMany)
  ok: boolean;
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
export function opFamily(op: ChartOp): OpFamily {
  switch (op) {
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

export function captionFor(step: Pick<QueueStep, "op" | "caption">, lang: Lang): string {
  const c = (step.caption ?? "").trim();
  if (c) return c; // model caption — already language-matched, shown as-is
  const fam = opFamily(step.op);
  const pair = FAMILY_FALLBACK[fam];
  return lang === "zh" ? pair[1] : pair[0];
}

// The rail's fit chip text. LEX cmxFitOne/cmxFitMany, picked like drawingCountOne/Many; the ack's
// numbers print verbatim and "ATR" stays an untranslated abbreviation in zh. `t` is the view's useT().
export function fitBadgeText(fit: Fit, t: (key: string, fallback?: string) => string): string {
  return t(fit.touches === 1 ? "cmxFitOne" : "cmxFitMany")
    .replace("{n}", String(fit.touches))
    .replace("{atr}", String(fit.max_dev_atr));
}

// Whether an applied step counts toward the done "N on chart" tally + the acting pulse. Draw ops that
// put an object on the chart count; chart.* view changes and scene markers do not (nothing is "on
// chart" from them), and rejects (ok:false) never count. ai.clear/undo are not additive either.
export function isChartObjectOp(op: ChartOp): boolean {
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
      // A fresh session always starts from a clean slate — a previous session's done-state is cleared
      // the instant new work arrives (spec: "If the rail is open it stays until closed" is a VIEW
      // concern; the machine's rows reset so the new session's rail is its own).
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
        fit: step.fit,
        ok: step.ok,
      };
      const applied = s.applied + (step.ok && isChartObjectOp(step.op) ? 1 : 0);
      // An applied step lands the orb in "acting"; a rejected step doesn't pulse but is still logged.
      const phase: Phase = step.ok ? "acting" : (s.phase === "idle" ? "summoned" : s.phase);
      // Only advance the caption for an ok step — a reject shouldn't blank the last good caption.
      const nextCaption = step.ok ? caption : s.caption;
      const swap = step.ok && caption !== s.caption ? s.captionSwapKey + 1 : s.captionSwapKey;
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
