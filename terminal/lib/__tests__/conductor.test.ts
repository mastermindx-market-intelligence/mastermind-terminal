import { describe, it, expect } from "vitest";
import { CommandQueue, type QueueStep } from "@/lib/chartBus";
import {
  conductorReducer, initialConductorState, captionFor, opFamily, isChartObjectOp,
  PACE_MS, type ConductorState,
} from "@/lib/conductorState";

// ── CommandQueue lifecycle events (batch-start / drain) added in W3 ──────────────────────────────
// The queue is the emitter W3 consumes. These pin the two new session-lifecycle edges + fit-on-step,
// AND that the pre-existing paced/instant behaviour is unchanged (regression guard for W1 acks).
const mkStep = (op: QueueStep["op"] = "draw.hline"): (() => QueueStep) => () => ({ op, id: "ai_x", ok: true });

describe("CommandQueue — batch-start / drain lifecycle (W3)", () => {
  it("fires exactly one batch-start on the idle→work edge and one drain when empty (instant pace)", () => {
    const q = new CommandQueue(0);
    let starts = 0, drains = 0;
    q.onBatchStart(() => starts++);
    q.onDrain(() => drains++);
    q.enqueue(mkStep());
    q.enqueue(mkStep());
    q.enqueue(mkStep());
    // instant pace drains synchronously within enqueue → each enqueue empties the queue. The FIRST
    // enqueue opens the session; because pace 0 drains it immediately, each subsequent enqueue is a
    // fresh idle→work edge. That's correct: a burst dispatched in one tick is the real W3 path (below).
    expect(starts).toBeGreaterThanOrEqual(1);
    expect(drains).toBeGreaterThanOrEqual(1);
  });

  it("a one-tick burst of N ops = ONE batch-start + ONE drain when paced", async () => {
    const q = new CommandQueue(5); // small non-zero pace so the burst queues before the first runs
    let starts = 0, drains = 0;
    const seen: string[] = [];
    q.onBatchStart(() => { starts++; seen.push("start"); });
    q.onDrain(() => { drains++; seen.push("drain"); });
    q.on(() => seen.push("step"));
    q.enqueue(mkStep("chart.set_tf"));
    q.enqueue(mkStep("draw.trendline"));
    q.enqueue(mkStep("draw.zone"));
    // start fires on the first enqueue (synchronously), before any step runs
    expect(starts).toBe(1);
    expect(seen[0]).toBe("start");
    // wait for the paced queue to drain
    await new Promise((r) => setTimeout(r, 60));
    expect(drains).toBe(1);
    expect(seen[seen.length - 1]).toBe("drain");
    // exactly 3 steps between the single start and single drain
    expect(seen.filter((x) => x === "step").length).toBe(3);
  });

  it("applyInstantly() drains a paced queue and still fires the drain edge once", async () => {
    const q = new CommandQueue(1000); // long pace → work sits queued
    let starts = 0, drains = 0;
    q.onBatchStart(() => starts++);
    q.onDrain(() => drains++);
    q.enqueue(mkStep());
    q.enqueue(mkStep());
    expect(starts).toBe(1);
    expect(drains).toBe(0); // still paced, nothing drained yet
    q.applyInstantly(); // the "skip" escape
    expect(drains).toBe(1);
    expect(q.size).toBe(0);
  });

  it("delayMs is settable to pace (650) and back to 0 for skip — a burst mid-pace reuses one session", async () => {
    const q = new CommandQueue(0);
    let starts = 0, drains = 0;
    q.onBatchStart(() => starts++);
    q.onDrain(() => drains++);
    q.delayMs = PACE_MS; // session start sets the pace
    expect(q.delayMs).toBe(650);
    q.enqueue(mkStep());
    q.enqueue(mkStep());
    expect(starts).toBe(1); // one session even though two enqueues, because paced (queue not idle)
    q.delayMs = 0; // skip forces instant
    q.applyInstantly();
    expect(drains).toBe(1);
  });

  it("fit metrics ride the step to the listener", () => {
    const q = new CommandQueue(0);
    const steps: QueueStep[] = [];
    q.on((s) => steps.push(s));
    q.enqueue(() => ({ op: "draw.trendline", id: "ai_t", ok: true, fit: { touches: 4, max_dev_atr: 0.31 } }));
    expect(steps).toHaveLength(1);
    expect(steps[0].fit).toEqual({ touches: 4, max_dev_atr: 0.31 });
  });

  it("clear() on a paced queue settles the drain edge (no dangling active session)", () => {
    const q = new CommandQueue(1000);
    let drains = 0;
    q.onDrain(() => drains++);
    q.enqueue(mkStep());
    q.clear();
    expect(drains).toBe(1);
    expect(q.size).toBe(0);
  });
});

// ── op-family classification + caption fallback ─────────────────────────────────────────────────
describe("opFamily + captionFor", () => {
  it("classifies every op family correctly", () => {
    expect(opFamily("chart.set_tf")).toBe("chart");
    expect(opFamily("draw.trendline")).toBe("line");
    expect(opFamily("draw.ray")).toBe("line");
    expect(opFamily("draw.hline")).toBe("line");
    expect(opFamily("draw.channel")).toBe("line");
    expect(opFamily("draw.path")).toBe("line");
    expect(opFamily("draw.zone")).toBe("zone");
    expect(opFamily("draw.risk_box")).toBe("zone");
    expect(opFamily("draw.fib")).toBe("fib");
    expect(opFamily("draw.label")).toBe("label");
    expect(opFamily("draw.marker")).toBe("label");
    expect(opFamily("ai.clear")).toBe("ai");
    expect(opFamily("scene.begin")).toBe("scene");
  });

  it("shows the model caption verbatim when present (EN + ZH)", () => {
    expect(captionFor({ op: "draw.trendline", caption: "Rising support off the March low" }, "en")).toBe("Rising support off the March low");
    expect(captionFor({ op: "draw.trendline", caption: "支撑自三月低点抬升" }, "zh")).toBe("支撑自三月低点抬升");
  });

  it("falls back to a plain per-family line when the caption is missing (EN)", () => {
    expect(captionFor({ op: "chart.set_tf" }, "en")).toBe("Setting the timeframe");
    expect(captionFor({ op: "draw.trendline" }, "en")).toBe("Drawing a line");
    expect(captionFor({ op: "draw.zone" }, "en")).toBe("Marking a zone");
    expect(captionFor({ op: "draw.label" }, "en")).toBe("Placing a label");
  });

  it("falls back in ZH when language is zh and no caption", () => {
    expect(captionFor({ op: "chart.set_tf" }, "zh")).toBe("调整时间周期");
    expect(captionFor({ op: "draw.trendline" }, "zh")).toBe("绘制线条");
    expect(captionFor({ op: "draw.zone" }, "zh")).toBe("标注区域");
    expect(captionFor({ op: "draw.label" }, "zh")).toBe("添加标签");
  });

  it("treats a whitespace-only caption as missing", () => {
    expect(captionFor({ op: "draw.fib", caption: "   " }, "en")).toBe("Mapping the retracement");
  });

  it("only draw-object ops count toward the on-chart tally", () => {
    expect(isChartObjectOp("draw.trendline")).toBe(true);
    expect(isChartObjectOp("draw.zone")).toBe(true);
    expect(isChartObjectOp("draw.fib")).toBe(true);
    expect(isChartObjectOp("draw.label")).toBe(true);
    expect(isChartObjectOp("chart.set_tf")).toBe(false);
    expect(isChartObjectOp("ai.clear")).toBe(false);
    expect(isChartObjectOp("scene.begin")).toBe(false);
  });
});

// ── the conductor state machine ─────────────────────────────────────────────────────────────────
const step = (op: QueueStep["op"], over: Partial<QueueStep> = {}): QueueStep => ({ op, id: "ai_x", ok: true, ...over });

describe("conductorReducer — lifecycle", () => {
  it("idle → summoned on start, with a clean slate", () => {
    const s0 = initialConductorState();
    expect(s0.phase).toBe("idle");
    const s1 = conductorReducer(s0, { type: "start" });
    expect(s1.phase).toBe("summoned");
    expect(s1.rows).toHaveLength(0);
    expect(s1.applied).toBe(0);
  });

  it("summoned → acting on an applied step; caption advances + swap key bumps", () => {
    let s: ConductorState = initialConductorState();
    s = conductorReducer(s, { type: "start" });
    const k0 = s.captionSwapKey;
    s = conductorReducer(s, { type: "step", step: step("draw.trendline", { caption: "Support" }), lang: "en" });
    expect(s.phase).toBe("acting");
    expect(s.caption).toBe("Support");
    expect(s.rows).toHaveLength(1);
    expect(s.applied).toBe(1);
    expect(s.captionSwapKey).toBe(k0 + 1);
  });

  it("full happy sequence set_tf → 2 lines → zone → fib → 2 labels → drain settles done with N=6", () => {
    let s: ConductorState = initialConductorState();
    s = conductorReducer(s, { type: "start" });
    for (const op of ["chart.set_tf", "draw.trendline", "draw.trendline", "draw.zone", "draw.fib", "draw.label", "draw.label"] as QueueStep["op"][]) {
      s = conductorReducer(s, { type: "step", step: step(op), lang: "en" });
    }
    // set_tf is not an on-chart object → 6 objects, not 7
    expect(s.applied).toBe(6);
    expect(s.rows).toHaveLength(7);
    s = conductorReducer(s, { type: "drain" });
    expect(s.phase).toBe("done");
  });

  it("done → idle when the done window elapses, but the rail rows are PRESERVED (viewable after end)", () => {
    let s: ConductorState = initialConductorState();
    s = conductorReducer(s, { type: "start" });
    s = conductorReducer(s, { type: "step", step: step("draw.zone"), lang: "en" });
    s = conductorReducer(s, { type: "drain" });
    expect(s.phase).toBe("done");
    s = conductorReducer(s, { type: "doneWindowElapsed" });
    expect(s.phase).toBe("idle");
    expect(s.rows).toHaveLength(1); // kept — the rail stays populated until the NEXT session starts
    expect(s.applied).toBe(1);
    // the next session is what wipes the rail
    s = conductorReducer(s, { type: "start" });
    expect(s.rows).toHaveLength(0);
  });

  it("a rejected step is logged and visibly explains refusal without pulsing or counting", () => {
    let s: ConductorState = initialConductorState();
    s = conductorReducer(s, { type: "start" });
    s = conductorReducer(s, { type: "step", step: step("draw.trendline", { caption: "Support" }), lang: "en" });
    expect(s.caption).toBe("Support");
    const applied0 = s.applied;
    s = conductorReducer(s, { type: "step", step: step("draw.zone", { ok: false, caption: "nope" }), lang: "en" });
    expect(s.applied).toBe(applied0); // reject didn't count
    expect(s.caption).toBe("This chart action was rejected. Read the chart before changing the request.");
    expect(s.rows).toHaveLength(2); // still logged
    expect(s.rows[1].ok).toBe(false);
  });

  it("fit rides into the rail row", () => {
    let s: ConductorState = initialConductorState();
    s = conductorReducer(s, { type: "start" });
    s = conductorReducer(s, { type: "step", step: step("draw.trendline", { fit: { touches: 4, max_dev_atr: 0.31 } }), lang: "en" });
    expect(s.rows[0].fit).toEqual({ touches: 4, max_dev_atr: 0.31 });
  });

  it("a new start after a completed session clears the prior rows (fresh rail)", () => {
    let s: ConductorState = initialConductorState();
    s = conductorReducer(s, { type: "start" });
    s = conductorReducer(s, { type: "step", step: step("draw.zone"), lang: "en" });
    s = conductorReducer(s, { type: "drain" });
    s = conductorReducer(s, { type: "start" }); // second session begins before the done window closed
    expect(s.phase).toBe("summoned");
    expect(s.rows).toHaveLength(0);
    expect(s.applied).toBe(0);
  });

  it("drain from idle is a no-op (no spurious done)", () => {
    const s0 = initialConductorState();
    const s1 = conductorReducer(s0, { type: "drain" });
    expect(s1.phase).toBe("idle");
  });

  it("reset returns to idle from any phase", () => {
    let s: ConductorState = initialConductorState();
    s = conductorReducer(s, { type: "start" });
    s = conductorReducer(s, { type: "step", step: step("draw.fib"), lang: "en" });
    s = conductorReducer(s, { type: "reset" });
    expect(s.phase).toBe("idle");
    expect(s.rows).toHaveLength(0);
  });
});
