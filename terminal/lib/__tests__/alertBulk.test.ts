/**
 * alertBulk.test.ts — E18 scoped alert management: the contract the panel acts on.
 *
 * Each block pins one acceptance requirement of E18 (issue #916):
 *   AC-E18-01  the target is the captured selection, never the filtered / reordered view
 *   AC-E18-02  mixed acknowledged / refused / not-confirmed answers are each counted and visible
 *   AC-E18-03  a not-confirmed write is never replayed and never counted as paused / resumed
 *   AC-E18-04  only the owner's own refusal counts as one; signed-out and account switches stop
 *   AC-E18-05  a refresh keeps still-valid selection and names deleted / changed rows
 */
import { describe, expect, it } from "vitest";
import {
  NO_FILTER,
  addAll,
  alertState,
  applicability,
  capturePlan,
  classifyReply,
  emptySelection,
  fingerprint,
  isAck,
  matchesFilter,
  mergeReport,
  observeUnknown,
  planStillMatches,
  reconcileSelection,
  runPlan,
  summarize,
  tally,
  toBulkAlerts,
  toggle,
  typeGroup,
  type BulkAction,
  type BulkAlert,
  type Reply,
  type RowOutcome,
} from "@/lib/alertBulk";

const OWNER = "account:u1|a@example.com";

const mk = (id: string, symbol: string, active: boolean, condition: Record<string, unknown>): BulkAlert =>
  ({ id, symbol, active, condition, created_at: "2026-10-01T00:00:00Z" });

const armedNvda = mk("a1", "NVDA", true, { type: "signal", target: "BUY" });
const armedAapl = mk("a2", "AAPL", true, { type: "price", op: "above", value: 250 });
const pausedTsla = mk("a3", "TSLA", false, { type: "rsi", value: 30 });
const firedMsft = mk("a4", "MSFT", false, { type: "regime", triggered: { at: "2026-10-09T14:00:00Z", value: 1 } });
const armedOpt = mk("a5", "MARKET", true, { type: "opt_gamma_flip", root: "SPX" });
const INVENTORY = [armedNvda, armedAapl, pausedTsla, firedMsft, armedOpt];

/** The owner's reply for an id it accepted: the row back in the state the action produces. */
function ackFor(a: BulkAlert, action: BulkAction): Reply {
  const condition = { ...a.condition };
  if (action === "resume") delete condition.triggered;
  return { status: 200, body: { alert: { ...a, condition, active: action === "resume" } } };
}

function selectAll(rows: BulkAlert[]) {
  return addAll(emptySelection(OWNER), rows);
}

/** A scripted owner: answers per id and records every send. */
function scripted(answers: Record<string, Reply | (() => Promise<Reply>) | "throw">) {
  const sent: Array<[string, BulkAction]> = [];
  let inFlight = 0;
  let peak = 0;
  const send = async (id: string, action: BulkAction): Promise<Reply> => {
    sent.push([id, action]);
    inFlight++;
    peak = Math.max(peak, inFlight);
    try {
      await Promise.resolve();
      const a = answers[id];
      if (a === "throw") throw new Error("network down");
      if (typeof a === "function") return await a();
      if (!a) throw new Error(`unscripted id ${id}`);
      return a;
    } finally {
      inFlight--;
    }
  };
  return { send, sent, peak: () => peak };
}

describe("inventory reading", () => {
  it("drops rows without an id and refuses a non-list body", () => {
    expect(toBulkAlerts({ alerts: [] })).toBeNull();
    expect(toBulkAlerts([{ symbol: "X" }, { id: "", symbol: "Y" }, { id: "ok", symbol: "Z", active: true }])).toEqual([
      { id: "ok", symbol: "Z", active: true, condition: {}, created_at: "" },
    ]);
  });

  it("reads state from the stored fields only: active, else triggered stamp, else paused", () => {
    expect(alertState(armedNvda)).toBe("armed");
    expect(alertState(pausedTsla)).toBe("paused");
    expect(alertState(firedMsft)).toBe("fired");
  });

  it("groups types the way the owner's allow-list names them", () => {
    expect(typeGroup(armedOpt.condition)).toBe("options");
    expect(typeGroup({ type: "suite_sequence" })).toBe("suite");
    expect(typeGroup({ type: "made_up" })).toBe("other");
    expect(typeGroup(undefined)).toBe("other");
  });

  it("filters by state, type and a case-insensitive symbol fragment", () => {
    const f = (o: Partial<typeof NO_FILTER>) => INVENTORY.filter((a) => matchesFilter(a, { ...NO_FILTER, ...o })).map((a) => a.id);
    expect(f({})).toEqual(["a1", "a2", "a3", "a4", "a5"]);
    expect(f({ state: "armed" })).toEqual(["a1", "a2", "a5"]);
    expect(f({ type: "options" })).toEqual(["a5"]);
    expect(f({ symbol: "  ms " })).toEqual(["a4"]);
    expect(f({ state: "paused", type: "price" })).toEqual([]);
  });
});

describe("AC-E18-01 — the target is the captured selection", () => {
  it("captures ids in the order they were selected, not inventory order", () => {
    let sel = emptySelection(OWNER);
    sel = toggle(sel, armedOpt);
    sel = toggle(sel, armedNvda);
    sel = toggle(sel, armedAapl);
    sel = toggle(sel, armedNvda); // un-tick
    const plan = capturePlan(sel, "pause");
    expect(plan.rows.map((r) => r.row.id)).toEqual(["a5", "a2"]);
  });

  it("select-shown only ADDS the rows the filter shows; it never drops hidden selected rows", () => {
    let sel = toggle(emptySelection(OWNER), pausedTsla);
    const shownArmed = INVENTORY.filter((a) => matchesFilter(a, { ...NO_FILTER, state: "armed" }));
    sel = addAll(sel, shownArmed);
    expect(sel.order).toEqual(["a3", "a1", "a2", "a5"]);
  });

  it("a filter applied after capture changes neither the plan nor what is sent", async () => {
    const sel = selectAll([armedNvda, armedAapl, armedOpt]);
    const plan = capturePlan(sel, "pause");
    // The user now narrows the view to options only and re-sorts the inventory.
    const narrowed = [...INVENTORY].reverse().filter((a) => matchesFilter(a, { ...NO_FILTER, type: "options" }));
    expect(narrowed.map((a) => a.id)).toEqual(["a5"]);
    const owner = scripted({ a1: ackFor(armedNvda, "pause"), a2: ackFor(armedAapl, "pause"), a5: ackFor(armedOpt, "pause") });
    await runPlan(plan, { concurrency: 1, currentOwner: () => OWNER, send: owner.send });
    expect(owner.sent).toEqual([["a1", "pause"], ["a2", "pause"], ["a5", "pause"]]);
  });

  it("rows the action would not change are skipped and never sent", async () => {
    const plan = capturePlan(selectAll([armedNvda, pausedTsla, firedMsft]), "pause");
    expect(plan.rows.map((r) => r.applies)).toEqual(["apply", "skip-paused", "skip-fired"]);
    const owner = scripted({ a1: ackFor(armedNvda, "pause") });
    const out = await runPlan(plan, { concurrency: 3, currentOwner: () => OWNER, send: owner.send });
    expect(owner.sent.map(([id]) => id)).toEqual(["a1"]);
    expect(Object.keys(out)).toEqual(["a1"]);
    expect(tally(plan, out)).toMatchObject({ total: 3, acknowledged: 1, skipped: 2 });
  });

  it("resume re-arms a triggered row and skips an armed one", () => {
    expect(applicability(firedMsft, "resume")).toBe("rearm");
    expect(applicability(pausedTsla, "resume")).toBe("apply");
    expect(applicability(armedNvda, "resume")).toBe("skip-armed");
  });

  it("keeps at most `concurrency` writes in flight", async () => {
    const rows = Array.from({ length: 9 }, (_, i) => mk(`r${i}`, `S${i}`, true, { type: "signal", target: "BUY" }));
    const answers = Object.fromEntries(rows.map((a) => [a.id, ackFor(a, "pause")]));
    const owner = scripted(answers);
    const out = await runPlan(capturePlan(selectAll(rows), "pause"), { concurrency: 3, currentOwner: () => OWNER, send: owner.send });
    expect(owner.peak()).toBeLessThanOrEqual(3);
    expect(owner.peak()).toBeGreaterThan(1);
    expect(Object.values(out).every((o) => o.kind === "acknowledged")).toBe(true);
  });
});

describe("AC-E18-02 / 03 — every answer is classified on its own; nothing is replayed", () => {
  it("only the row back, under the expected id, in the produced state, is an acknowledgement", () => {
    const back = (over: Record<string, unknown>) => ({ ...armedNvda, active: false, ...over });
    expect(isAck(back({}), "a1", "pause")).toBe(true);
    expect(isAck(back({ id: "a2" }), "a1", "pause")).toBe(false);          // another row
    expect(isAck(back({ active: true }), "a1", "pause")).toBe(false);      // write did not land
    expect(isAck(back({ condition: "x" }), "a1", "pause")).toBe(false);    // malformed
    expect(isAck({ ok: true }, "a1", "pause")).toBe(false);
    // resume: armed and the triggered stamp gone (route.ts strips it on re-arm)
    expect(isAck({ ...firedMsft, active: true }, "a4", "resume")).toBe(false);
    const { triggered: _drop, ...clean } = firedMsft.condition;
    void _drop;
    expect(isAck({ ...firedMsft, active: true, condition: clean }, "a4", "resume")).toBe(true);
    // a pause that lands on a row the engine already fired is still an acknowledged pause
    expect(isAck({ ...firedMsft, active: false }, "a4", "pause")).toBe(true);
  });

  it("classifies the owner's replies; anything without the owner's own refusal is NOT confirmed", () => {
    const c = (reply: Reply) => classifyReply(reply, "a1", "pause").kind;
    expect(c(ackFor(armedNvda, "pause"))).toBe("acknowledged");
    expect(c({ status: 200, body: { alert: { ...armedNvda } } })).toBe("unknown");   // still armed
    expect(c({ status: 200, body: {} })).toBe("unknown");
    expect(c({ status: 200, body: null })).toBe("unknown");
    expect(c({ status: 400, body: { error: "Could not update alert" } })).toBe("unknown"); // failed update
    expect(c({ status: 500, body: null })).toBe("unknown");
    expect(c({ status: 502, body: "<html>bad gateway</html>" })).toBe("unknown");
    expect(c({ status: 404, body: null })).toBe("unknown");   // an edge 404 is not the owner's answer
    expect(c({ status: 401, body: "<html>" })).toBe("unknown");
    expect(c("transport-failed")).toBe("unknown");
    expect(classifyReply({ status: 404, body: { error: "not found" } }, "a1", "pause")).toEqual({ kind: "refused", reason: "not-found" });
    expect(classifyReply({ status: 403, body: { error: "upgrade" } }, "a1", "pause")).toEqual({ kind: "refused", reason: "not-allowed" });
    expect(classifyReply({ status: 401, body: { error: "unauthenticated" } }, "a1", "pause")).toEqual({ kind: "refused", reason: "signed-out" });
  });

  it("a mixed batch reports each kind separately and never one clean total", async () => {
    const plan = capturePlan(selectAll([armedNvda, armedAapl, armedOpt, pausedTsla, mk("gone", "AMD", true, { type: "signal", target: "SELL" })]), "pause");
    const owner = scripted({
      a1: ackFor(armedNvda, "pause"),
      a2: { status: 500, body: null },                        // not confirmed
      a5: "throw",                                            // dropped connection: not confirmed
      gone: { status: 404, body: { error: "not found" } },   // refused
    });
    const out = await runPlan(plan, { concurrency: 2, currentOwner: () => OWNER, send: owner.send });
    expect(out.a1.kind).toBe("acknowledged");
    expect(out.a2.kind).toBe("unknown");
    expect(out.a5.kind).toBe("unknown");
    expect(out.gone).toEqual({ kind: "refused", reason: "not-found" });
    expect(tally(plan, out)).toEqual({ total: 5, acknowledged: 1, refused: 1, unknown: 2, notSent: 0, skipped: 1, pending: 0 });
    const sum = summarize(plan, out);
    expect(sum.parts).toEqual([
      { kind: "done", n: 1 },
      { kind: "refused", n: 1 },
      { kind: "unknown", n: 2 },
      { kind: "skipped", n: 1 },
    ]);
    expect(sum.total).toBe(5);
  });

  it("sends every id exactly once — a not-confirmed write is never retried", async () => {
    const plan = capturePlan(selectAll([armedNvda, armedAapl, armedOpt]), "pause");
    const owner = scripted({ a1: "throw", a2: { status: 503, body: null }, a5: { status: 200, body: {} } });
    const out = await runPlan(plan, { concurrency: 3, currentOwner: () => OWNER, send: owner.send });
    expect(owner.sent.map(([id]) => id).sort()).toEqual(["a1", "a2", "a5"]);
    expect(owner.sent).toHaveLength(3);
    expect(Object.values(out).map((o) => o.kind)).toEqual(["unknown", "unknown", "unknown"]);
  });

  it("a later read showing the hoped-for state is reported as an observation, never as a pause", async () => {
    const plan = capturePlan(selectAll([armedNvda, armedAapl]), "pause");
    const owner = scripted({ a1: { status: 502, body: null }, a2: { status: 502, body: null } });
    const out = await runPlan(plan, { concurrency: 2, currentOwner: () => OWNER, send: owner.send });
    // The write to a1 DID land (the 502 came from the edge after it); a2 did not; nothing deleted.
    const after = [{ ...armedNvda, active: false }, armedAapl];
    expect(observeUnknown(out, after)).toEqual({ a1: { kind: "state", state: "paused" }, a2: { kind: "state", state: "armed" } });
    expect(observeUnknown(out, [])).toEqual({ a1: { kind: "missing" }, a2: { kind: "missing" } });
    expect(observeUnknown(out, null)).toEqual({ a1: { kind: "unreadable" }, a2: { kind: "unreadable" } });
    // ...and the count still says "not confirmed", not "paused".
    expect(tally(plan, out)).toMatchObject({ acknowledged: 0, unknown: 2 });
    expect(summarize(plan, out).parts).toEqual([{ kind: "unknown", n: 2 }]);
  });

  it("a pause acknowledged on a row that had already triggered is counted apart", () => {
    const plan = capturePlan(selectAll([armedNvda, armedAapl]), "pause");
    const out: Record<string, RowOutcome> = {
      a1: classifyReply(ackFor(armedNvda, "pause"), "a1", "pause"),
      a2: classifyReply({ status: 200, body: { alert: { ...armedAapl, active: false, condition: { ...armedAapl.condition, triggered: { at: "x" } } } } }, "a2", "pause"),
    };
    expect(summarize(plan, out).parts).toEqual([{ kind: "done", n: 1 }, { kind: "triggeredFirst", n: 1 }]);
  });

  it("rows still waiting are counted as waiting, not as done", () => {
    const plan = capturePlan(selectAll([armedNvda, armedAapl]), "pause");
    const out = { a1: classifyReply(ackFor(armedNvda, "pause"), "a1", "pause") };
    expect(summarize(plan, out).parts).toEqual([{ kind: "done", n: 1 }, { kind: "pending", n: 1 }]);
  });
});

describe("AC-E18-04 — the owner decides; signed-out and account switches stop the batch", () => {
  it("a signed-out refusal stops every row not yet sent", async () => {
    const rows = [armedNvda, armedAapl, armedOpt];
    const plan = capturePlan(selectAll(rows), "pause");
    const owner = scripted({ a1: { status: 401, body: { error: "unauthenticated" } }, a2: ackFor(armedAapl, "pause"), a5: ackFor(armedOpt, "pause") });
    const out = await runPlan(plan, { concurrency: 1, currentOwner: () => OWNER, send: owner.send });
    expect(owner.sent.map(([id]) => id)).toEqual(["a1"]);
    expect(out).toEqual({
      a1: { kind: "refused", reason: "signed-out" },
      a2: { kind: "not-sent", reason: "signed-out" },
      a5: { kind: "not-sent", reason: "signed-out" },
    });
  });

  it("the page moving to another account stops every row not yet sent", async () => {
    let current = OWNER;
    const plan = capturePlan(selectAll([armedNvda, armedAapl, armedOpt]), "pause");
    const owner = scripted({
      a1: async () => { current = "account:u2|b@example.com"; return ackFor(armedNvda, "pause"); },
      a2: ackFor(armedAapl, "pause"),
      a5: ackFor(armedOpt, "pause"),
    });
    const out = await runPlan(plan, { concurrency: 1, currentOwner: () => current, send: owner.send });
    expect(owner.sent.map(([id]) => id)).toEqual(["a1"]);
    expect(out.a2).toEqual({ kind: "not-sent", reason: "account-changed" });
    expect(out.a5).toEqual({ kind: "not-sent", reason: "account-changed" });
    expect(tally(plan, out)).toMatchObject({ acknowledged: 1, notSent: 2 });
  });

  it("a plan captured under one account sends nothing once the page is on another", async () => {
    const plan = capturePlan(selectAll([armedNvda]), "pause");
    const owner = scripted({ a1: ackFor(armedNvda, "pause") });
    const out = await runPlan(plan, { concurrency: 3, currentOwner: () => "", send: owner.send });
    expect(owner.sent).toEqual([]);
    expect(out.a1).toEqual({ kind: "not-sent", reason: "account-changed" });
  });

  it("an id another account owns comes back as the owner's not-found refusal and nothing else", async () => {
    const foreign = mk("their-id", "NVDA", true, { type: "signal", target: "BUY" });
    const plan = capturePlan(selectAll([foreign, armedAapl]), "pause");
    const owner = scripted({ "their-id": { status: 404, body: { error: "not found" } }, a2: ackFor(armedAapl, "pause") });
    const out = await runPlan(plan, { concurrency: 2, currentOwner: () => OWNER, send: owner.send });
    expect(out["their-id"]).toEqual({ kind: "refused", reason: "not-found" });
    expect(out.a2.kind).toBe("acknowledged");
  });
});

describe("AC-E18-05 — refresh keeps valid selection and names what moved", () => {
  it("keeps present rows with the fresh copy, drops and names deleted rows, names changed rows", () => {
    const sel = selectAll([armedNvda, armedAapl, pausedTsla]);
    const firedAapl = { ...armedAapl, active: false, condition: { ...armedAapl.condition, triggered: { at: "t" } } };
    const fresh = [firedAapl, mk("new", "AMD", true, { type: "signal", target: "BUY" }), pausedTsla];
    const { selection, report } = reconcileSelection(sel, fresh);
    expect(selection.order).toEqual(["a2", "a3"]);
    expect(selection.rows.a2).toBe(firedAapl);
    expect(report.deleted.map((a) => a.id)).toEqual(["a1"]);
    expect(report.changed).toEqual([{ before: armedAapl, after: firedAapl }]);
    expect(selection.rows.new).toBeUndefined(); // a new row is never selected for the user
  });

  it("an unchanged, reordered inventory reports nothing", () => {
    const sel = selectAll([armedNvda, armedAapl]);
    const { selection, report } = reconcileSelection(sel, [...INVENTORY].reverse());
    expect(selection.order).toEqual(["a1", "a2"]);
    expect(report).toEqual({ deleted: [], changed: [] });
  });

  it("condition key order does not count as a change", () => {
    const reordered = { ...armedAapl, condition: { value: 250, op: "above", type: "price" } };
    expect(fingerprint(reordered)).toBe(fingerprint(armedAapl));
  });

  it("merges successive reports into one line per alert", () => {
    const v2 = { ...armedAapl, active: false };
    const v3 = { ...armedAapl, active: false, condition: { ...armedAapl.condition, triggered: { at: "t" } } };
    const r1 = { deleted: [], changed: [{ before: armedAapl, after: v2 }] };
    const r2 = { deleted: [], changed: [{ before: v2, after: v3 }] };
    expect(mergeReport(r1, r2)).toEqual({ deleted: [], changed: [{ before: armedAapl, after: v3 }] });
    // changed back to how it was selected: no longer a change worth naming
    expect(mergeReport(r1, { deleted: [], changed: [{ before: v2, after: armedAapl }] })).toEqual({ deleted: [], changed: [] });
    // changed, then deleted: reported once, as deleted
    expect(mergeReport(r1, { deleted: [v2], changed: [] })).toEqual({ deleted: [v2], changed: [] });
  });

  it("a review is unconfirmable once any captured row changes or disappears", () => {
    const plan = capturePlan(selectAll([armedNvda, armedAapl]), "pause");
    expect(planStillMatches(plan, INVENTORY)).toBe(true);
    expect(planStillMatches(plan, [...INVENTORY].reverse())).toBe(true);
    expect(planStillMatches(plan, INVENTORY.filter((a) => a.id !== "a2"))).toBe(false);
    expect(planStillMatches(plan, INVENTORY.map((a) => (a.id === "a1" ? { ...a, active: false } : a)))).toBe(false);
  });
});
