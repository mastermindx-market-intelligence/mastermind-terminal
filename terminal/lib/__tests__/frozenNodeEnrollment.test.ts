import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/app/api/billing/gateway", () => ({ BILLING_BASE: "https://www.mastermind-x.com" }));
const service = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("../supabase/service", () => ({ createServiceClient: service.create }));
import fixture from "./fixtures/exposure-native-qqq-observed-v2.json";
import { createExposureMapReader } from "../exposureMap";
import { exposureValueFingerprint } from "../exposureChartLink";
import { createFrozenNodeInitialEnrollment, type FrozenNodeInitialIntent } from "../frozenNodeEnrollment";
const principal = "10000000-0000-4000-8000-000000000001";
const alertId = "30000000-0000-4000-8000-000000000001";
const intent = "40000000-0000-4000-8000-000000000001";
const other = "40000000-0000-4000-8000-000000000002";
const at = "2026-10-21T00:00:00Z";
const generation = "50000000-0000-4000-8000-000000000001";
function response(body: unknown, url: string) {
  const result = new Response(JSON.stringify(body));
  Object.defineProperty(result, "url", { value: url });
  return result;
}
async function setup() {
  const report = createExposureMapReader(fixture, "QQQ", null, "2026-10-21", Date.parse(at)).reportedGamma({ kind: "all" })!;
  const target = { root: report.root, securityId: report.securityId, sourceSession: report.sourceSession,
    sourceKey: await exposureValueFingerprint(fixture), definitionKey: report.definitionKey,
    scopeKey: report.scopeKey, availableAt: report.availableAt, sourceBinding: report.sourceBinding,
    members: report.members.filter(m => m.strike === 159).map(({ expiry, strike, right }) => ({ expiry, strike, right })),
    price: 159, qualification: "observed_partial" as const };
  const request: FrozenNodeInitialIntent = { attemptId: "60000000-0000-4000-8000-000000000001", alertId, principal, predicate: { type: "opt_frozen_node_proximity", root: "QQQ", target },
    expectedIntentRevision: intent, expectedGeneration: null, expectedRevision: null, lens: { kind: "all" } };
  const row = { id: alertId, user_id: principal, symbol: "QQQ", condition: structuredClone(request.predicate),
    active: true, created_at: "2026-10-20T00:00:00Z", frozen_runtime: null as unknown, frozen_intent_revision: intent };
  const runtime = { schema: "options.frozen_runtime/v1", alertId, principal, predicate: structuredClone(request.predicate),
    generation, revision: 0, createdAt: at, armingEpoch: at, priorState: null };
  const enrollment = { schema: "options.frozen_enrollment/v1", attemptId: request.attemptId,
    alertId, principal, predicate: structuredClone(request.predicate), intentRevision: intent,
    lens: structuredClone(request.lens), preparedAt: at, phase: "prepared", outcome: null as unknown };
  const rpc = vi.fn(async (_name: string, args: unknown): Promise<{ data: unknown; error: unknown }> => {
    const op = (args as { p_enrollment: { operation: string } }).p_enrollment.operation;
    return op === "prepare" ? { data: { kind: "prepared", enrollment: structuredClone(enrollment) }, error: null }
      : { data: { kind: "enrollment", enrollment: { ...structuredClone(enrollment), phase: "terminal",
        outcome: { kind: "data", runtime: structuredClone(runtime), intentRevision: intent } } }, error: null };
  });
  const read = vi.fn(async (): Promise<{ data: unknown; error: unknown }> => ({ data: row, error: null }));
  const builder = { select: vi.fn(() => builder), eq: vi.fn(() => builder), maybeSingle: read };
  const from = vi.fn(() => builder);
  service.create.mockReturnValue({ from, rpc });
  const auth = { getSession: vi.fn(async () => ({ data: { session: { access_token: "synthetic-token" } }, error: null })),
    getUser: vi.fn(async (_token: string) => { void _token; return { data: { user: { id: principal, user_metadata: {
      alert_email_optin: true, alert_categories: ["options_exposure_node"] } } }, error: null }; }) };
  const account = vi.fn(async () => response({ id: principal, tier: "essential", features: ["terminal_live_options"],
    status: "active", current_period_end: "2026-11-21T00:00:00Z" }, "https://www.mastermind-x.com/api/me"));
  const source = vi.fn(async (url: string) => response(fixture, url));
  const deps = { auth, accountFetcher: account, sourceTransport: { fetcher: source }, clock: () => at };
  return { request, row, runtime, deps, rpc, read, from, builder, auth, account, source, enrollment };
}
afterEach(() => { vi.useRealTimers(); service.create.mockReset(); });

describe("dormant initial enrollment: actual account/source reader + single intent-bound arm", () => {
  it("uses authoritative exact row and attempt-bound RPC; arms once without sampling/firing", async () => {
    const x = await setup(), original = structuredClone(x.request);
    const attempt = createFrozenNodeInitialEnrollment(x.request, x.deps);
    const [first, second] = await Promise.all([attempt.run(), attempt.run()]);
    expect(first).toEqual({ kind: "committed", intent: original, historicalRuntime: x.runtime, currentState: "unavailable" });
    expect(second).toEqual(first);
    expect(x.rpc).toHaveBeenCalledTimes(2);
    expect(x.rpc).toHaveBeenLastCalledWith("arm_frozen_node_runtime", { p_alert_id: alertId, p_principal: principal,
      p_predicate: original.predicate, p_expected_generation: null, p_expected_revision: null, p_expected_intent_revision: intent,
      p_enrollment: { operation: "arm", attemptId: original.attemptId, lens: original.lens } });
    expect(x.from).toHaveBeenCalledWith("alerts");
    expect(x.builder.eq.mock.calls).toEqual([["id", alertId], ["user_id", principal]]);
    expect(x.auth.getUser).toHaveBeenCalledWith("synthetic-token");
    expect(x.account).toHaveBeenCalledTimes(1); expect(x.source).toHaveBeenCalledTimes(1);
    expect(x.row.frozen_runtime).toBeNull(); // fake transport never mutates a real store
    if (first.kind !== "committed") throw new Error("expected arm");
    first.historicalRuntime.principal = "changed"; first.intent.predicate.target.members.pop();
    expect(await attempt.run()).toEqual({ kind: "committed", intent: original, historicalRuntime: x.runtime, currentState: "unavailable" });
  });
  it("pins intent and Auth methods before all awaits, not a client allowed flag", async () => {
    const x = await setup(), original = structuredClone(x.request);
    let release!: () => void;
    x.auth.getSession.mockImplementation(() => new Promise(resolve => { release = () => resolve({ data: { session: { access_token: "synthetic-token" } }, error: null }); }));
    const attempt = createFrozenNodeInitialEnrollment(x.request, x.deps), pending = attempt.run();
    await Promise.resolve();
    x.request.principal = other; x.request.predicate.target.members.pop(); x.request.expectedIntentRevision = other;
    x.auth.getUser = vi.fn(async () => { throw new Error("replacement must not run"); });
    release();
    expect(await pending).toEqual({ kind: "committed", intent: original, historicalRuntime: x.runtime, currentState: "unavailable" });
  });
  it.each(["principal", "consent", "account", "source"])("rejects real %s admission failure before privileged row read", async fault => {
    const x = await setup();
    if (fault === "principal") x.request.principal = other;
    if (fault === "consent") x.auth.getUser.mockResolvedValue({ data: { user: { id: principal, user_metadata: { alert_email_optin: false, alert_categories: [] } } }, error: null });
    if (fault === "account") x.account.mockImplementation(async () => response({ id: principal, tier: "free" }, "https://www.mastermind-x.com/api/me"));
    if (fault === "source") x.source.mockImplementation(async url => response({ ...fixture, corrected: true }, url));
    expect((await createFrozenNodeInitialEnrollment(x.request, x.deps).run()).kind).not.toBe("committed");
    expect(service.create).not.toHaveBeenCalled(); expect(x.rpc).not.toHaveBeenCalled();
  });
  it.each(["id", "owner", "symbol", "predicate", "pause", "runtime", "token", "created"])("withholds %s row mismatch without arm", async fault => {
    const x = await setup();
    if (fault === "id") x.row.id = other;
    if (fault === "owner") x.row.user_id = other;
    if (fault === "symbol") x.row.symbol = "SPY";
    if (fault === "predicate") Object.assign(x.row.condition, { within_pct: 0.7 });
    if (fault === "pause") x.row.active = false;
    if (fault === "runtime") x.row.frozen_runtime = x.runtime;
    if (fault === "token") x.row.frozen_intent_revision = other;
    if (fault === "created") x.row.created_at = "bad";
    expect(await createFrozenNodeInitialEnrollment(x.request, x.deps).run()).toEqual({ kind: "conflict", reason: "persisted_intent_mismatch" });
    expect(x.rpc).not.toHaveBeenCalled();
  });
  it.each(["extra-grant", "generation", "revision", "triggered", "threshold"])("rejects invalid %s pin before network or DB", async fault => {
    const x = await setup();
    if (fault === "extra-grant") Object.assign(x.request, { allowed: true });
    if (fault === "generation") Object.assign(x.request, { expectedGeneration: generation });
    if (fault === "revision") Object.assign(x.request, { expectedRevision: 0 });
    if (fault === "triggered") Object.assign(x.request.predicate, { triggered: true });
    if (fault === "threshold") x.request.predicate.within_pct = Infinity;
    expect(await createFrozenNodeInitialEnrollment(x.request, x.deps).run()).toEqual({ kind: "unavailable", reason: "invalid_initial_intent" });
    expect(x.auth.getSession).not.toHaveBeenCalled(); expect(service.create).not.toHaveBeenCalled();
  });
  it("retains DB race refusal; never regenerates intent or invokes another arm", async () => {
    const x = await setup();
    x.rpc.mockResolvedValue({ data: { kind: "conflict", reason: "stale_intent_revision" }, error: null });
    const attempt = createFrozenNodeInitialEnrollment(x.request, x.deps);
    expect(await attempt.run()).toEqual({ kind: "conflict", reason: "stale_intent_revision" });
    expect(await attempt.run()).toEqual({ kind: "conflict", reason: "stale_intent_revision" });
    expect(x.rpc).toHaveBeenCalledTimes(1);
  });
  it.each(["error", "reject", "timeout", "principal", "predicate", "token", "generation", "prior", "old-epoch", "extra"])("retains %s arm as UNKNOWN without retry", async fault => {
    const x = await setup();
    let ready: Promise<void> | undefined;
    if (fault === "error") x.rpc.mockResolvedValue({ data: null, error: { message: "unreturned" } });
    else if (fault === "reject") x.rpc.mockRejectedValue(new Error("network lost"));
    else if (fault === "timeout") {
      let started!: () => void;
      ready = new Promise(resolve => { started = resolve; });
      x.rpc.mockImplementation(() => { vi.useFakeTimers(); started(); return new Promise(() => {}); });
    }
    else {
      const body = { kind: "data", runtime: structuredClone(x.runtime), intentRevision: intent };
      if (fault === "principal") body.runtime.principal = other;
      if (fault === "predicate") body.runtime.predicate.target.members.pop();
      if (fault === "token") body.intentRevision = other;
      if (fault === "generation") body.runtime.generation = "bad";
      if (fault === "prior") Object.assign(body.runtime, { priorState: {} });
      if (fault === "old-epoch") { body.runtime.armingEpoch = "2026-10-20T23:59:59Z"; body.runtime.createdAt = body.runtime.armingEpoch; }
      if (fault === "extra") Object.assign(body.runtime, { allowed: true });
      x.rpc.mockResolvedValueOnce({ data: { kind: "prepared", enrollment: x.enrollment }, error: null })
        .mockResolvedValue({ data: { kind: "enrollment", enrollment: { ...x.enrollment, phase: "terminal", outcome: body } }, error: null });
    }
    const attempt = createFrozenNodeInitialEnrollment(x.request, x.deps), pending = attempt.run();
    if (ready) { await ready; await vi.advanceTimersByTimeAsync(5_001); }
    const result = await pending;
    expect(result).toEqual({ kind: "effect_unknown", reason: "enrollment_acknowledgment_unknown", intent: x.request });
    expect(await attempt.run()).toEqual(result); expect(x.rpc).toHaveBeenCalledTimes(["error", "reject", "timeout"].includes(fault) ? 1 : 2);
  });
  it("does not turn unavailable row lookup into an arm", async () => {
    const x = await setup();
    x.read.mockResolvedValue({ data: null, error: { message: "unknown read" } });
    expect(await createFrozenNodeInitialEnrollment(x.request, x.deps).run()).toEqual({ kind: "unavailable", reason: "persisted_intent_unavailable" });
    expect(x.rpc).not.toHaveBeenCalled();
  });
  it("recovers a lost committed response after process restart using only the exact retained attempt", async () => {
    const x = await setup();
    const terminal = { kind: "enrollment", enrollment: { ...x.enrollment, phase: "terminal",
      outcome: { kind: "data", runtime: x.runtime, intentRevision: intent } } };
    x.rpc.mockResolvedValueOnce({ data: { kind: "prepared", enrollment: x.enrollment }, error: null })
      .mockRejectedValueOnce(new Error("response lost after commit"));
    expect((await createFrozenNodeInitialEnrollment(x.request, x.deps).run()).kind).toBe("effect_unknown");
    x.rpc.mockResolvedValue({ data: terminal, error: null });
    x.read.mockClear(); x.from.mockClear(); x.rpc.mockClear();
    const restarted = createFrozenNodeInitialEnrollment(structuredClone(x.request), x.deps);
    expect(await restarted.reconcile()).toEqual({ kind: "committed", intent: x.request, historicalRuntime: x.runtime, currentState: "unavailable" });
    expect(x.from).not.toHaveBeenCalled();
    expect(x.rpc).toHaveBeenCalledTimes(1);
    expect(x.rpc.mock.calls[0][1]).toMatchObject({ p_enrollment: { operation: "reconcile", attemptId: x.request.attemptId } });
  });
  it("does not arm an existing prepare after restart, even if the current row still matches", async () => {
    const x = await setup();
    x.rpc.mockResolvedValue({ data: { kind: "pending", enrollment: x.enrollment }, error: null });
    const restarted = createFrozenNodeInitialEnrollment(x.request, x.deps);
    expect((await restarted.run()).kind).toBe("effect_unknown");
    expect(x.rpc).toHaveBeenCalledTimes(1);
    expect(x.rpc.mock.calls[0][1]).toMatchObject({ p_enrollment: { operation: "prepare" } });
  });
  it("closes PREPARED only through explicit fence, never automatic reconciliation", async () => {
    const x = await setup();
    x.rpc.mockResolvedValue({ data: { kind: "enrollment", enrollment: { ...x.enrollment,
      phase: "terminal", outcome: { kind: "conflict", reason: "enrollment_not_committed" } } }, error: null });
    const restarted = createFrozenNodeInitialEnrollment(x.request, x.deps);
    expect(await restarted.fence()).toEqual({ kind: "conflict", reason: "enrollment_not_committed" });
    expect(x.from).not.toHaveBeenCalled();
    expect(x.rpc).toHaveBeenCalledTimes(1);
    expect(x.rpc.mock.calls[0][1]).toMatchObject({ p_enrollment: { operation: "fence" } });
  });
  it.each(["attempt", "principal", "predicate", "lens", "intent", "extra"])("never attributes a substituted %s envelope during reconciliation", async fault => {
    const x = await setup();
    const saved = { ...structuredClone(x.enrollment), phase: "terminal",
      outcome: { kind: "data", runtime: x.runtime, intentRevision: intent } };
    if (fault === "attempt") saved.attemptId = other;
    if (fault === "principal") saved.principal = other;
    if (fault === "predicate") saved.predicate.target.members.pop();
    if (fault === "lens") Object.assign(saved, { lens: { kind: "week" } });
    if (fault === "intent") saved.intentRevision = other;
    if (fault === "extra") Object.assign(saved, { allowed: true });
    x.rpc.mockResolvedValue({ data: { kind: "enrollment", enrollment: saved }, error: null });
    expect((await createFrozenNodeInitialEnrollment(x.request, x.deps).reconcile()).kind).toBe("effect_unknown");
    expect(x.rpc).toHaveBeenCalledTimes(1);
    expect(x.from).not.toHaveBeenCalled();
  });
  it.each(["principal", "consent", "account", "source"])("requires current %s admission before reconciliation", async fault => {
    const x = await setup();
    if (fault === "principal") x.request.principal = other;
    if (fault === "consent") x.auth.getUser.mockResolvedValue({ data: { user: { id: principal, user_metadata: { alert_email_optin: false, alert_categories: [] } } }, error: null });
    if (fault === "account") x.account.mockImplementation(async () => response({ id: principal, tier: "free" }, "https://www.mastermind-x.com/api/me"));
    if (fault === "source") x.source.mockImplementation(async url => response({ ...fixture, corrected: true }, url));
    expect((await createFrozenNodeInitialEnrollment(x.request, x.deps).reconcile()).kind).not.toBe("committed");
    expect(service.create).not.toHaveBeenCalled(); expect(x.rpc).not.toHaveBeenCalled();
  });
  it.each(["stale_intent_revision", "not_found_or_not_owner", "enrollment_attempt_conflict", "enrollment_generation_changed"])("preserves UNKNOWN when %s prevents exact-attempt reconciliation", async reason => {
    const x = await setup();
    x.rpc.mockResolvedValue({ data: { kind: "conflict", reason }, error: null });
    expect(await createFrozenNodeInitialEnrollment(x.request, x.deps).reconcile()).toEqual({
      kind: "effect_unknown", reason: "enrollment_acknowledgment_unknown", intent: x.request,
    });
    expect(x.rpc).toHaveBeenCalledTimes(1);
    expect(x.from).not.toHaveBeenCalled();
  });


  it.each(["absent", "prepared"])("leaves %s reconciliation UNKNOWN without fence/prepare/arm", async state => {
    const x = await setup();
    x.rpc.mockResolvedValue({ data: state === "absent" ? { kind: "unavailable", reason: "enrollment_not_prepared" }
      : { kind: "pending", enrollment: x.enrollment }, error: null });
    expect(await createFrozenNodeInitialEnrollment(x.request, x.deps).reconcile()).toEqual({
      kind: "effect_unknown", reason: "enrollment_acknowledgment_unknown", intent: x.request,
    });
    expect(x.rpc).toHaveBeenCalledTimes(1);
    expect(x.rpc.mock.calls[0][1]).toMatchObject({ p_enrollment: { operation: "reconcile" } });
  });
  it("requires current account admission on EACH explicit read, even after a prior committed ack", async () => {
    const x = await setup();
    const reader = createFrozenNodeInitialEnrollment(x.request, x.deps);
    expect((await reader.reconcile()).kind).toBe("committed");
    x.auth.getUser.mockResolvedValue({ data: { user: { id: principal, user_metadata: { alert_email_optin: false, alert_categories: [] } } }, error: null });
    expect((await reader.reconcile()).kind).toBe("denied");
    expect(x.rpc).toHaveBeenCalledTimes(1); // second admission denied before receipt read
  });
  it("a later explicit read can observe commit after an earlier PREPARED snapshot, without replay", async () => {
    const x = await setup();
    x.rpc.mockResolvedValueOnce({ data: { kind: "pending", enrollment: x.enrollment }, error: null });
    const reader = createFrozenNodeInitialEnrollment(x.request, x.deps);
    expect((await reader.reconcile()).kind).toBe("effect_unknown");
    const result = await reader.reconcile();
    expect(result).toMatchObject({ kind: "committed", historicalRuntime: x.runtime, currentState: "unavailable" });
    expect(x.rpc.mock.calls.map(c => (c[1] as {p_enrollment:{operation:string}}).p_enrollment.operation)).toEqual(["reconcile", "reconcile"]);
  });
  it.each(["error", "timeout"])("retains %s PREPARE uncertainty and never auto-dispatches late arm", async fault => {
    const x = await setup();
    let deliver!: () => void;
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    if (fault === "error") x.rpc.mockRejectedValue(new Error("prepare response unknown"));
    else {
      x.rpc.mockImplementation(() => {
        vi.useFakeTimers(); started();
        return new Promise(resolve => { deliver = () => resolve({ data: { kind: "prepared", enrollment: x.enrollment }, error: null }); });
      });
    }
    const operation = createFrozenNodeInitialEnrollment(x.request, x.deps);
    const pending = operation.run();
    if (fault === "timeout") {
      // Timer begins at the actual mocked PREPARE boundary, after native
      // source hashing. A late fulfillment must not resume dispatch.
      await ready; await vi.advanceTimersByTimeAsync(5_001);
    }
    expect((await pending).kind).toBe("effect_unknown");
    if (fault === "timeout") { deliver(); await Promise.resolve(); }
    expect((await operation.run()).kind).toBe("effect_unknown");
    expect(x.rpc).toHaveBeenCalledTimes(1);
  });
});
