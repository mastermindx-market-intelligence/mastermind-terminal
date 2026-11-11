import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/app/api/billing/gateway", () => ({ BILLING_BASE: "https://www.mastermind-x.com" }));
import fixture from "./fixtures/exposure-native-qqq-observed-v2.json";
import { createExposureMapReader } from "../exposureMap";
import { exposureValueFingerprint } from "../exposureChartLink";
import { evalFrozenNodeProximity, type FrozenNodeAdmissionContext, type FrozenNodePriorState, type FrozenNodeTarget } from "../optionsAlerts";
import { readFrozenNodeSourceAction, FROZEN_NODE_ACCOUNT_POLICY, FROZEN_NODE_COMMERCIAL_DECISION } from "../frozenNodeSourceAction";
const id = "10000000-0000-4000-8000-000000000001";
const at = "2026-10-21T00:00:00Z";
const token = "synthetic-session-token";
const accountUrl = "https://www.mastermind-x.com/api/me";
const user = () => ({ id, user_metadata: { alert_email_optin: true, alert_categories: ["options_exposure_node"] } });
const me = () => ({ id, tier: "essential", features: ["terminal_live_options"], status: "active", current_period_end: "2026-11-21T00:00:00Z" });
function response(body: unknown, url: string, headers?: Record<string, string>) {
  const result = new Response(JSON.stringify(body), { headers });
  Object.defineProperty(result, "url", { value: url });
  return result;
}
async function setup() {
  const report = createExposureMapReader(fixture, "QQQ", null, "2026-10-21", Date.parse(at)).reportedGamma({ kind: "all" })!;
  const expected: FrozenNodeTarget = {
    root: report.root, securityId: report.securityId, sourceSession: report.sourceSession,
    sourceKey: await exposureValueFingerprint(fixture), definitionKey: report.definitionKey,
    scopeKey: report.scopeKey, availableAt: report.availableAt, sourceBinding: report.sourceBinding,
    members: report.members.filter(member => member.strike === 159).map(({ expiry, strike, right }) => ({ expiry, strike, right })),
    price: 159, qualification: "observed_partial",
  };
  const auth = { getSession: vi.fn(async () => ({ data: { session: { access_token: token } }, error: null })),
    getUser: vi.fn(async (_token: string) => ({ data: { user: user() }, error: null })) };
  const accountFetcher = vi.fn(async (_url: string, _init?: RequestInit) => response(me(), accountUrl));
  const sourceFetcher = vi.fn(async (url: string, _init?: RequestInit) => response(fixture, url));
  const deps = { auth, accountFetcher, sourceTransport: { fetcher: sourceFetcher }, clock: () => at };
  const request = { expected, principal: id, lens: { kind: "all" } as const };
  return { request, deps, auth, accountFetcher, sourceFetcher };
}
afterEach(() => vi.useRealTimers());

describe("explicit server source/action reader, no production wiring", () => {
  it("composes exact token/principal, fresh account, consent and native full-source identity", async () => {
    const x = await setup(), before = structuredClone(x.request);
    const result = await readFrozenNodeSourceAction(x.request, x.deps);
    expect(result).toEqual({ kind: "admitted", context: {
      principal: id, action: "frozen_node_proximity", evaluationAt: at, target: before.expected,
      rights: { allowed: true, policy_version: FROZEN_NODE_ACCOUNT_POLICY, checked_at: at },
      rights_decision_ref: FROZEN_NODE_COMMERCIAL_DECISION,
    } });
    expect(x.auth.getUser).toHaveBeenCalledTimes(1);
    expect(x.auth.getUser).toHaveBeenCalledWith(token);
    expect(x.accountFetcher).toHaveBeenCalledTimes(1);
    expect(x.accountFetcher).toHaveBeenCalledWith(accountUrl, expect.objectContaining({
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store", redirect: "error",
    }));
    expect(x.sourceFetcher).toHaveBeenCalledTimes(1);
    expect(x.request).toEqual(before);
    expect(JSON.stringify(result)).not.toContain(token);
    if (result.kind !== "admitted") throw new Error("expected source/action result");
    for (const key of ["createdAt", "armingEpoch", "priorState", "generation", "revision"]) expect(result.context).not.toHaveProperty(key);
    expect(result.context.target.members).toHaveLength(2); // missing P measurement still bound
    expect(result.context.target.qualification).toBe("observed_partial");
  });
  it("can enter the incumbent evaluator only after separately attested lifecycle composition", async () => {
    const x = await setup();
    const result = await readFrozenNodeSourceAction(x.request, x.deps);
    if (result.kind !== "admitted") throw new Error(JSON.stringify(result));
    const epoch = "2026-10-20T20:00:00Z";
    const envelope = { principal: id, createdAt: epoch, evaluationAt: at };
    const cond = { type: "opt_frozen_node_proximity" as const, root: "QQQ", target: x.request.expected };
    expect(evalFrozenNodeProximity(cond, envelope, result.context as unknown as FrozenNodeAdmissionContext, { spot: 160, asof: at, basis: "LIVE" }).fired).toBeNull();
    const admitted = { ...result.context, createdAt: epoch, armingEpoch: epoch, priorState: null };
    const first = evalFrozenNodeProximity(cond, envelope, admitted, { spot: 160, asof: at, basis: "LIVE" });
    expect(first.fired).toBe(false);
    const later = "2026-10-21T00:00:01Z";
    const next = await readFrozenNodeSourceAction(x.request, { ...x.deps, clock: () => later });
    if (next.kind !== "admitted") throw new Error(JSON.stringify(next));
    const sampled = evalFrozenNodeProximity(cond, { ...envelope, evaluationAt: later }, { ...next.context,
      createdAt: epoch, armingEpoch: epoch, priorState: first.nextState as FrozenNodePriorState }, { spot: 159.1, asof: later, basis: "LIVE" });
    expect(sampled.fired).toBe(true);
    expect(sampled.note).toContain("sampled proximity");
  });
  it.each(["auth", "principal", "macro-id", "tier", "consent", "category"])("withholds %s before any source read", async fault => {
    const x = await setup();
    if (fault === "auth") x.auth.getUser.mockResolvedValue({ data: { user: user() }, error: "revoked" as never });
    if (fault === "principal") x.request.principal = "20000000-0000-4000-8000-000000000002";
    if (fault === "macro-id") x.accountFetcher.mockImplementation(async () => response({ ...me(), id: "other" }, accountUrl));
    if (fault === "tier") x.accountFetcher.mockImplementation(async () => response({ ...me(), tier: "free" }, accountUrl));
    if (fault === "consent" || fault === "category") x.auth.getUser.mockResolvedValue({ data: { user: { ...user(), user_metadata: {
      alert_email_optin: fault !== "consent", alert_categories: fault === "category" ? [] : ["options_exposure_node"],
    } } }, error: null });
    Object.assign(x.request, { allowed: true, rights: { allowed: true }, priorState: {}, evaluationAt: at });
    expect((await readFrozenNodeSourceAction(x.request, x.deps)).kind).not.toBe("admitted");
    expect(x.sourceFetcher).not.toHaveBeenCalled();
  });
  it("does not borrow corrected/missing source or a pruned member set", async () => {
    const x = await setup();
    x.sourceFetcher.mockImplementation(async url => response({ ...fixture, correction_outside_selected_price: "changed" }, url));
    expect(await readFrozenNodeSourceAction(x.request, x.deps)).toEqual({ kind: "unavailable", reason: "source_fingerprint_mismatch" });
    x.sourceFetcher.mockImplementation(async url => { const r = new Response(null, { status: 404 }); Object.defineProperty(r, "url", { value: url }); return r; });
    expect((await readFrozenNodeSourceAction(x.request, x.deps)).kind).toBe("missing");
    x.sourceFetcher.mockImplementation(async url => response(fixture, url));
    x.request.expected.members.pop();
    expect((await readFrozenNodeSourceAction(x.request, x.deps)).kind).toBe("unavailable");
  });
  it("snapshots the full requested identity before authentication awaits", async () => {
    const x = await setup(), original = structuredClone(x.request.expected);
    let release!: () => void;
    x.auth.getSession.mockImplementation(() => new Promise(resolve => { release = () => resolve({ data: { session: { access_token: token } }, error: null }); }));
    const pending = readFrozenNodeSourceAction(x.request, x.deps);
    await Promise.resolve();
    x.request.expected.root = "SPY"; x.request.expected.members.pop(); x.request.principal = "other";
    release();
    const result = await pending;
    expect(result.kind).toBe("admitted");
    if (result.kind === "admitted") expect(result.context.target).toEqual(original);
  });
  it.each(["redirect", "wrong-url", "size", "json", "newline-length"])("refuses account %s", async fault => {
    const x = await setup();
    x.accountFetcher.mockImplementation(async () => {
      const r = fault === "json" ? new Response("{broken") : response(me(), fault === "wrong-url" ? "https://elsewhere.invalid/api/me" : accountUrl,
        fault === "size" ? { "content-length": "65537" } : undefined);
      if (fault === "json") Object.defineProperty(r, "url", { value: accountUrl });
      if (fault === "redirect") Object.defineProperty(r, "redirected", { value: true });
      if (fault === "newline-length") Object.defineProperty(r, "headers", { value: { get: () => "12\n" } });
      return r;
    });
    expect((await readFrozenNodeSourceAction(x.request, x.deps)).kind).toBe("unavailable");
    expect(x.sourceFetcher).not.toHaveBeenCalled();
  });
  it.each(["auth", "fetch", "stream"])("bounds an unresponsive %s capability", async fault => {
    const x = await setup(); vi.useFakeTimers();
    if (fault === "auth") x.auth.getSession.mockImplementation(() => new Promise(() => {}));
    if (fault === "fetch") x.accountFetcher.mockImplementation(() => new Promise(() => {}));
    if (fault === "stream") x.accountFetcher.mockImplementation(async () => {
      const r = new Response(new ReadableStream({ pull: () => new Promise(() => {}), cancel: () => new Promise(() => {}) }));
      Object.defineProperty(r, "url", { value: accountUrl }); return r;
    });
    const pending = readFrozenNodeSourceAction(x.request, x.deps);
    await vi.advanceTimersByTimeAsync(5_001);
    expect((await pending).kind).toBe("unavailable");
    expect(x.sourceFetcher).not.toHaveBeenCalled();
  });
});
