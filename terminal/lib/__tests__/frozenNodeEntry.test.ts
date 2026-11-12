import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/app/api/billing/gateway", () => ({ BILLING_BASE: "https://www.mastermind-x.com" }));
vi.mock("@/lib/entitlement", () => ({ isPaidTier: vi.fn(async () => true), isProTier: vi.fn(async () => true) }));
const H = vi.hoisted(() => ({ db: null as unknown, creates: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: H.creates }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => H.db }));
import fixture from "./fixtures/exposure-native-qqq-observed-v2.json";
import { POST } from "@/app/api/alerts/route";
import { createFrozenNodeEntryJourney } from "../frozenNodeEntryClient";
import { frozenEntrySelection } from "../frozenNodeEntrySelection";
import { withFrozenEntryJournal } from "../frozenNodeEntryJournal";
import type { FrozenEntryDescriptor } from "../frozenNodeEntryProtocol";
const A = "10000000-0000-4000-8000-000000000001", B = "10000000-0000-4000-8000-000000000002";
const token = "40000000-0000-4000-8000-000000000001", generation = "50000000-0000-4000-8000-000000000001";
const at = "2026-10-21T00:00:00Z";
function response(body: unknown, url: string) { const r = Response.json(body); Object.defineProperty(r, "url", { value: url }); return r; }
function sharedLock() {
  const held = new Set<string>();
  return { request: vi.fn(async (name: string, options: LockOptions, cb: (lock: Lock | null) => Promise<unknown>) => {
    expect(options).toEqual({ mode: "exclusive", ifAvailable: true });
    if (held.has(name)) return cb(null);
    held.add(name); try { return await cb({ name, mode: "exclusive" } as Lock); } finally { held.delete(name); }
  }) } as unknown as Pick<LockManager, "request">;
}
async function setup() {
  const selection = (await frozenEntrySelection({ root: "QQQ", source: fixture, lens: { kind: "all" }, price: 159, metric: "gamma",
    shock: { spotPercent: 0, ivPoints: 0, calendarDays: 0 }, now: Date.parse(at) }))!;
  let user = A, clientOwner = A, currentSelection = "original";
  const insertControl = { lose: false, hang: false, started: () => {} };
  const table = new Map<string, Record<string, unknown>>(), counters = { insert: 0, reads: 0, count: 0 };
  const auth = { getSession: vi.fn(async () => ({ data: { session: { access_token: "synthetic-token" } }, error: null })),
    getUser: vi.fn(async () => ({ data: { user: { id: user, user_metadata: { alert_email_optin: true, alert_categories: ["options_exposure_node"] } } }, error: null })) };
  const rpc = vi.fn(async (_name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> => {
    const e = args.p_enrollment as { operation: string; attemptId: string; lens: unknown }, row = table.get(String(args.p_alert_id));
    if (!row || row.user_id !== args.p_principal) return { data: { kind: "unavailable", reason: "missing" }, error: null };
    const saved = row.frozen_enrollment as Record<string, unknown> | null;
    if (e.operation === "reconcile") return { data: saved?.attemptId === e.attemptId ? { kind: "enrollment", enrollment: saved } : { kind: "unavailable", reason: "missing_receipt" }, error: null };
    if (e.operation === "prepare") {
      if (saved) return { data: { kind: "pending", enrollment: saved }, error: null };
      row.frozen_enrollment = { schema: "options.frozen_enrollment/v1", attemptId: e.attemptId, alertId: args.p_alert_id, principal: args.p_principal,
        predicate: structuredClone(args.p_predicate), intentRevision: args.p_expected_intent_revision, lens: structuredClone(e.lens), preparedAt: at, phase: "prepared", outcome: null };
      return { data: { kind: "prepared", enrollment: row.frozen_enrollment }, error: null };
    }
    if (e.operation !== "arm") throw new Error("forbidden operation");
    row.frozen_runtime = { schema: "options.frozen_runtime/v1", alertId: args.p_alert_id, principal: args.p_principal, predicate: args.p_predicate,
      generation, revision: 0, createdAt: at, armingEpoch: at, priorState: null };
    row.frozen_enrollment = { ...saved, phase: "terminal", outcome: { kind: "data", runtime: row.frozen_runtime, intentRevision: args.p_expected_intent_revision } };
    return { data: { kind: "enrollment", enrollment: row.frozen_enrollment }, error: null };
  });
  const from = vi.fn(() => {
    const filters: [string, unknown][] = []; let insertion: Record<string, unknown> | null = null, count = false;
    const q = { select: vi.fn((_cols: string, options?: { count?: string }) => { count = options?.count === "exact"; return q; }),
      eq: vi.fn((k: string, v: unknown) => { filters.push([k, v]); return q; }),
      insert: vi.fn((v: Record<string, unknown>) => { insertion = structuredClone(v); return q; }),
      maybeSingle: vi.fn(async () => { counters.reads++; return { data: structuredClone([...table.values()].find(r => filters.every(([k, v]) => r[k] === v)) ?? null), error: null }; }),
      single: vi.fn(async () => {
        counters.insert++;
        if (!insertion || table.has(String(insertion.id))) return { data: null, error: { code: "23505" } };
        const row: Record<string, unknown> = { ...insertion, created_at: at, frozen_runtime: null, frozen_enrollment: null, frozen_intent_revision: token };
        table.set(String(row.id), row); const insertedSnapshot = structuredClone(row); insertControl.started();
        if (insertControl.lose) throw new Error("insert reply lost");
        if (insertControl.hang) return new Promise<never>(() => {});
        return { data: insertedSnapshot, error: null };
      }),
      then: (resolve: (v: unknown) => unknown) => { if (!count) throw new Error("unexpected query"); counters.count++; return Promise.resolve(resolve({ count: [...table.values()].filter(r => filters.every(([k, v]) => r[k] === v)).length, error: null })); } };
    return q;
  });
  H.db = { auth, from, rpc }; H.creates.mockResolvedValue(H.db);
  const upstream = vi.fn(async (url: string | URL | Request) => {
    const address = String(url);
    return address.endsWith("/api/me") ? response({ id: user, tier: "essential", features: ["terminal_live_options"], status: "active", current_period_end: "2026-11-21T00:00:00Z" }, address) : response(fixture, address);
  });
  vi.stubGlobal("fetch", upstream);
  const storageMap = new Map<string, string>();
  const storage = { getItem: vi.fn((key: string) => storageMap.get(key) ?? null), setItem: vi.fn((key: string, value: string) => { storageMap.set(key, value); }), removeItem: vi.fn((key: string) => { storageMap.delete(key); }) };
  const requests: unknown[] = [];
  const route = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)));
    return POST(new Request("https://entry.test/api/alerts", { ...init, headers: { ...init?.headers, origin: "https://entry.test" } }));
  });
  const ports = { storage, locks: sharedLock(), enabled: true, fetcher: route as typeof fetch,
    currentOwner: async () => clientOwner, currentSelection: () => currentSelection };
  const request = { owner: A, selectionKey: "original", selection };
  return { selection, request, ports, storage, storageMap, route, requests, table, counters, rpc, auth, from, upstream,
    insertControl, account: (id: string) => { user = id; clientOwner = id; }, selectionKey: (key: string) => { currentSelection = key; } };
}
const ops = (x: Awaited<ReturnType<typeof setup>>) => x.rpc.mock.calls.map(call => (call[1].p_enrollment as { operation: string }).operation);
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(at); vi.stubEnv("MM_OPTIONS_FROZEN_ENTRY_ENABLED", "1"); H.creates.mockReset(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("composed default-OFF entry → browser retention → actual alerts POST → exact restart", () => {
  it("default-off server returns before Auth, table, account/source or lifecycle effects", async () => {
    const x = await setup(); vi.stubEnv("MM_OPTIONS_FROZEN_ENTRY_ENABLED", "0");
    const result = await x.route("/api/alerts", { method: "POST", headers: { "x-mm-frozen-entry": "v1", "Content-Type": "application/json" }, body: JSON.stringify({ action: "issue", selection: x.selection }) });
    expect(result.status).toBe(409); expect(H.creates).not.toHaveBeenCalled(); expect(x.upstream).not.toHaveBeenCalled(); expect(x.from).not.toHaveBeenCalled(); expect(x.rpc).not.toHaveBeenCalled();
    const journey = createFrozenNodeEntryJourney(x.request, { ...x.ports, enabled: false });
    const before = x.route.mock.calls.length;
    await journey.prepare(); await journey.enroll(); await journey.recover();
    expect(x.route).toHaveBeenCalledTimes(before); expect(x.storage.getItem).not.toHaveBeenCalled();
  });
  it("issuance+retention creates no alert; only explicit confirmation INSERTs then PREPARE/ARM once", async () => {
    const x = await setup(), journey = createFrozenNodeEntryJourney(x.request, x.ports);
    expect((await journey.prepare()).kind).toBe("retained");
    expect(x.counters.insert).toBe(0); expect(x.rpc).not.toHaveBeenCalled();
    expect([...x.storageMap.values()][0]).toContain('"retained"');
    const [a, b] = await Promise.all([journey.enroll(), journey.enroll()]);
    expect(a.kind).toBe("committed"); expect(b).toEqual(a);
    expect(x.counters.insert).toBe(1); expect(ops(x)).toEqual(["prepare", "arm"]);
    expect([...x.storageMap.values()][0]).toContain('"dispatched"');
  });
  it.each(["issuance-loss", "retention-throw", "retention-readback", "no-lock", "wrong-selection", "account-switch"])("%s before confirmation sends no effect-bearing request", async fault => {
    const x = await setup();
    if (fault === "issuance-loss") { const original = x.ports.fetcher; x.ports.fetcher = vi.fn(async (url, init) => { await original(url, init); throw new Error("issuance response lost"); }); }
    if (fault === "retention-throw") x.storage.setItem.mockImplementation(() => { throw new Error("quota"); });
    if (fault === "retention-readback") x.storage.setItem.mockImplementation(() => {});
    if (fault === "no-lock") x.ports.locks = null as never;
    if (fault === "wrong-selection") x.selectionKey("changed");
    if (fault === "account-switch") x.account(B);
    const journey = createFrozenNodeEntryJourney(x.request, x.ports);
    expect((await journey.prepare()).kind).not.toBe("retained"); await journey.enroll();
    expect(x.counters.insert).toBe(0); expect(x.rpc).not.toHaveBeenCalled();
  });
  it("two separate tabs share journal lock: one issuance retained, no overwrite or second enrollment", async () => {
    const x = await setup(), a = createFrozenNodeEntryJourney(x.request, x.ports), b = createFrozenNodeEntryJourney(x.request, x.ports);
    const results = await Promise.all([a.prepare(), b.prepare()]);
    expect(results.filter(r => r.kind === "retained")).toHaveLength(1); expect(x.route).toHaveBeenCalledTimes(1);
    await Promise.all([a.enroll(), b.enroll()]); expect(x.counters.insert).toBe(1); expect(ops(x)).toEqual(["prepare", "arm"]);
    const retained = [...x.storageMap.values()][0];
    await createFrozenNodeEntryJourney(x.request, x.ports).prepare(); expect([...x.storageMap.values()][0]).toBe(retained);
  });
  it("crash after reference retention before dispatch cannot resume creation on restart", async () => {
    const x = await setup(); await createFrozenNodeEntryJourney(x.request, x.ports).prepare();
    const restarted = createFrozenNodeEntryJourney(x.request, x.ports);
    expect((await restarted.enroll()).kind).toBe("effect_unknown");
    expect((await restarted.recover()).kind).toBe("effect_unknown");
    expect(x.counters.insert).toBe(0); expect(x.rpc).not.toHaveBeenCalled();
    expect(x.requests.map(r => (r as { action: string }).action)).toEqual(["issue", "reconcile"]);
  });
  it("pre-dispatch journal failure sends nothing", async () => {
    const x = await setup(), journey = createFrozenNodeEntryJourney(x.request, x.ports); await journey.prepare();
    x.storage.setItem.mockImplementation(() => { throw new Error("disk unavailable"); });
    expect((await journey.enroll()).kind).toBe("unavailable"); expect(x.counters.insert).toBe(0); expect(x.rpc).not.toHaveBeenCalled();
  });
  it("HTTP response loss after full original effect recovers committed readonly, no second ARM", async () => {
    const x = await setup(), original = x.ports.fetcher;
    x.ports.fetcher = vi.fn(async (url, init) => { const r = await original(url, init); if (JSON.parse(String(init?.body)).action === "enroll") throw new Error("response lost"); return r; });
    const journey = createFrozenNodeEntryJourney(x.request, x.ports); await journey.prepare(); expect((await journey.enroll()).kind).toBe("effect_unknown");
    expect((await createFrozenNodeEntryJourney(x.request, x.ports).recover()).kind).toBe("committed");
    expect(x.counters.insert).toBe(1); expect(ops(x)).toEqual(["prepare", "arm", "reconcile"]);
  });
  it.each(["prepare", "arm"])("lost %s response stays same reference and readonly recovery never dispatches twice", async fault => {
    const x = await setup(), original = x.rpc.getMockImplementation()!;
    x.rpc.mockImplementation(async (name, args) => { const reply = await original(name, args); if ((args.p_enrollment as { operation: string }).operation === fault) throw new Error("reply lost"); return reply; });
    const journey = createFrozenNodeEntryJourney(x.request, x.ports); await journey.prepare(); expect((await journey.enroll()).kind).toBe("effect_unknown");
    const recovered = await createFrozenNodeEntryJourney(x.request, x.ports).recover();
    expect(recovered.kind).toBe(fault === "arm" ? "committed" : "effect_unknown");
    expect(ops(x)).toEqual(fault === "arm" ? ["prepare", "arm", "reconcile"] : ["prepare", "reconcile"]);
    expect(x.counters.insert).toBe(1);
  });
  it.each(["selection", "account", "revoked-account", "corrected-source"])("%s change after reference retention cannot create/ARM", async fault => {
    const x = await setup(), journey = createFrozenNodeEntryJourney(x.request, x.ports); await journey.prepare();
    if (fault === "selection") x.selectionKey("changed");
    if (fault === "account") x.account(B);
    if (fault === "revoked-account") x.upstream.mockImplementation(async url => response({ id: A, tier: "free" }, String(url)));
    if (fault === "corrected-source") x.upstream.mockImplementation(async url => String(url).endsWith("/api/me") ? response({ id: A, tier: "essential", features: ["terminal_live_options"], status: "active", current_period_end: "2026-11-21T00:00:00Z" }, String(url)) : response({ ...fixture, corrected: true }, String(url)));
    expect((await journey.enroll()).kind).not.toBe("committed"); expect(x.counters.insert).toBe(0); expect(x.rpc).not.toHaveBeenCalled();
  });
  it("selection switch recovery identifies ORIGINAL node/ref, never the newly displayed selection", async () => {
    const x = await setup(), journey = createFrozenNodeEntryJourney(x.request, x.ports); await journey.prepare(); await journey.enroll();
    x.selectionKey("different-strike");
    const result = await createFrozenNodeEntryJourney({ ...x.request, selectionKey: "different-strike", selection: null }, x.ports).recover();
    expect(result.kind).toBe("committed"); expect(result.original).toMatchObject({ root: "QQQ", price: 159, session: "2026-10-20" });
    expect(ops(x)).toEqual(["prepare", "arm", "reconcile"]);
  });
  it.each(["deleted", "replaced", "accountB"])("%s original receipt never authorizes adoption, retry or another creation", async fault => {
    const x = await setup(), journey = createFrozenNodeEntryJourney(x.request, x.ports); await journey.prepare(); await journey.enroll();
    const row = [...x.table.values()][0];
    if (fault === "deleted") x.table.clear();
    if (fault === "replaced") row.frozen_enrollment = { ...(row.frozen_enrollment as Record<string, unknown>), attemptId: B };
    if (fault === "accountB") x.account(B);
    expect((await journey.recover()).kind).not.toBe("committed");
    await createFrozenNodeEntryJourney(x.request, x.ports).enroll(); expect(x.counters.insert).toBe(1);
  });
  it("retained journal is not server authority; direct existing-id duplicate can never adopt its row", async () => {
    const x = await setup(), journey = createFrozenNodeEntryJourney(x.request, x.ports); await journey.prepare(); await journey.enroll();
    const saved = JSON.parse([...x.storageMap.values()][0]);
    const descriptor = saved.descriptor as FrozenEntryDescriptor;
    const before = x.rpc.mock.calls.length;
    const duplicate = await x.route("/api/alerts", { method: "POST", headers: { "Content-Type": "application/json", "x-mm-frozen-entry": "v1" }, body: JSON.stringify({ action: "enroll", descriptor }) });
    expect((await duplicate.json()).kind).toBe("effect_unknown"); expect(x.rpc).toHaveBeenCalledTimes(before);
  });
  it("corrupt storage is blocked rather than empty; missing lock cannot fall back", async () => {
    const x = await setup(); x.storage.getItem.mockReturnValue("not JSON");
    await createFrozenNodeEntryJourney(x.request, x.ports).prepare(); expect(x.route).not.toHaveBeenCalled();
    const value = await withFrozenEntryJournal({ ...x.ports, locks: null as never }, A, async () => "unsafe"); expect(value).toBeNull();
  });
});

describe("admission deadlines, selection races and uncertain create boundaries", () => {
  it("hung owner before issuance settles/releases lock; late Auth cannot issue or retain", async () => {
    const x = await setup(); let started!: () => void, late!: (owner: string) => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    x.ports.currentOwner = () => { started(); return new Promise<string>(resolve => { late = resolve; }); };
    const pending = createFrozenNodeEntryJourney(x.request, x.ports).prepare();
    await ready; await vi.advanceTimersByTimeAsync(5_001);
    expect((await pending).kind).toBe("unavailable");
    expect(await withFrozenEntryJournal(x.ports, A, async slot => slot.read().state)).toBe("empty");
    late(A); await Promise.resolve(); expect(x.route).not.toHaveBeenCalled(); expect(x.storage.setItem).not.toHaveBeenCalled();
  });
  it("hung owner AFTER dispatch marker holds UNKNOWN but releases lock, late Auth cannot POST", async () => {
    const x = await setup(); let calls = 0, started!: () => void, late!: (owner: string) => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    x.ports.currentOwner = () => { if (++calls < 4) return Promise.resolve(A); started(); return new Promise<string>(resolve => { late = resolve; }); };
    const journey = createFrozenNodeEntryJourney(x.request, x.ports); await journey.prepare();
    const pending = journey.enroll(); await ready; await vi.advanceTimersByTimeAsync(5_001);
    expect((await pending).kind).toBe("effect_unknown");
    expect(await withFrozenEntryJournal(x.ports, A, async slot => slot.read().state)).toBe("held");
    late(A); await Promise.resolve(); expect(x.requests).toHaveLength(1); expect(x.counters.insert).toBe(0);
    expect([...x.storageMap.values()][0]).toContain('"dispatched"');
  });
  it.each(["selection", "account"])("async A issuance then %s B before response cannot retain or enroll", async fault => {
    const x = await setup(), original = x.ports.fetcher;
    let received!: () => void, release!: () => void;
    const ready = new Promise<void>(resolve => { received = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    x.ports.fetcher = vi.fn(async (url, init) => { const response = await original(url, init); received(); await gate; return response; });
    const journey = createFrozenNodeEntryJourney(x.request, x.ports), pending = journey.prepare();
    await ready; if (fault === "selection") x.selectionKey("B-strike"); else x.account(B); release();
    expect((await pending).kind).toBe("unavailable"); await journey.enroll();
    expect(x.storage.setItem).not.toHaveBeenCalled(); expect(x.counters.insert).toBe(0); expect(x.rpc).not.toHaveBeenCalled();
  });
  it.each(["lost", "timeout"])("INSERT %s never reads/adopts existing row to continue ARM", async fault => {
    const x = await setup(); x.insertControl.lose = fault === "lost"; x.insertControl.hang = fault === "timeout";
    let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; }); x.insertControl.started = started;
    const journey = createFrozenNodeEntryJourney(x.request, x.ports); await journey.prepare();
    const pending = journey.enroll(); await ready;
    if (fault === "timeout") await vi.advanceTimersByTimeAsync(5_001);
    expect((await pending).kind).toBe("effect_unknown"); expect(x.counters.reads).toBe(0); expect(x.rpc).not.toHaveBeenCalled();
    expect((await createFrozenNodeEntryJourney(x.request, x.ports).recover()).kind).toBe("effect_unknown");
    expect(x.counters.insert).toBe(1); expect(x.rpc).not.toHaveBeenCalled();
  });
  it("50 owner alerts remains a refusal before INSERT, without disturbing other families", async () => {
    const x = await setup(); for (let i = 0; i < 50; i++) x.table.set(String(i), { id: String(i), user_id: A, condition: { type: "price" } });
    const before = structuredClone([...x.table]); const journey = createFrozenNodeEntryJourney(x.request, x.ports); await journey.prepare();
    expect((await journey.enroll()).kind).not.toBe("committed"); expect(x.counters.insert).toBe(0); expect([...x.table]).toEqual(before);
  });
  it("journal owner binding, read cap and escaped slot cannot create an unfenced reference", async () => {
    const x = await setup(), journey = createFrozenNodeEntryJourney(x.request, x.ports); await journey.prepare();
    let escaped!: Parameters<Parameters<typeof withFrozenEntryJournal>[2]>[0];
    const descriptor = await withFrozenEntryJournal(x.ports, A, async slot => { escaped = slot; const r = slot.read(); return r.state === "held" ? r.descriptor : null; });
    expect(descriptor).not.toBeNull(); expect(escaped.dispatch(descriptor!)).toBe(false);
    expect(await withFrozenEntryJournal(x.ports, B, async slot => slot.retain(descriptor!))).toBe(false);
    x.storage.getItem.mockReturnValue("x".repeat(131_073));
    expect(await withFrozenEntryJournal(x.ports, A, async slot => slot.read().state)).toBe("blocked");
  });
});

describe("server admission is independent of caller journal selectors", () => {
  it("two concurrent direct submissions yield only one INSERT creator and one PREPARE/ARM", async () => {
    const x = await setup(), journey = createFrozenNodeEntryJourney(x.request, x.ports); await journey.prepare();
    const descriptor = JSON.parse([...x.storageMap.values()][0]).descriptor;
    const send = () => x.route("/api/alerts", { method: "POST", headers: { "Content-Type": "application/json", "x-mm-frozen-entry": "v1" }, body: JSON.stringify({ action: "enroll", descriptor }) });
    const replies = await Promise.all([send(), send()]);
    const bodies = await Promise.all(replies.map(r => r.json()));
    expect(bodies.filter(b => b.kind === "enrollment" && b.result.kind === "committed")).toHaveLength(1);
    expect(bodies.filter(b => b.kind === "effect_unknown")).toHaveLength(1);
    expect(x.table.size).toBe(1); expect(ops(x)).toEqual(["prepare", "arm"]);
  });
  it.each(["principal", "future", "extra-token", "target"])("forged %s descriptor cannot create an alert or ARM", async fault => {
    const x = await setup(), journey = createFrozenNodeEntryJourney(x.request, x.ports); await journey.prepare();
    const descriptor = JSON.parse([...x.storageMap.values()][0]).descriptor;
    if (fault === "principal") descriptor.principal = B;
    if (fault === "future") descriptor.issuedAt = "2099-01-01T00:00:00Z";
    if (fault === "extra-token") descriptor.expectedIntentRevision = token;
    if (fault === "target") descriptor.predicate.target.price = 160;
    await x.route("/api/alerts", { method: "POST", headers: { "Content-Type": "application/json", "x-mm-frozen-entry": "v1" }, body: JSON.stringify({ action: "enroll", descriptor }) });
    expect(x.counters.insert).toBe(0); expect(x.rpc).not.toHaveBeenCalled();
  });
  it("foreign origin is refused; ordinary generic POST still rejects frozen type", async () => {
    const x = await setup();
    const foreign = await POST(new Request("https://entry.test/api/alerts", { method: "POST", headers: { "Content-Type": "application/json", "x-mm-frozen-entry": "v1", origin: "https://other.test" }, body: JSON.stringify({ action: "issue", selection: x.selection }) }));
    expect(foreign.status).toBe(403); expect(H.creates).not.toHaveBeenCalled();
    const generic = await POST(new Request("https://entry.test/api/alerts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol: "QQQ", condition: x.selection.predicate }) }));
    expect(generic.status).toBe(400); expect(x.counters.insert).toBe(0); expect(x.upstream).not.toHaveBeenCalled();
  });
  it.each(["vanna", "combined", "delta"])("%s/chart/scenario selection never produces a frozen Gamma target", async metric => {
    expect(await frozenEntrySelection({ root: "QQQ", source: fixture, lens: { kind: "all" }, price: 159, metric, shock: { spotPercent: 0, ivPoints: 0, calendarDays: 0 }, now: Date.parse(at) })).toBeNull();
    expect(await frozenEntrySelection({ root: "QQQ", source: fixture, lens: { kind: "all" }, price: 159, metric: "gamma", shock: { spotPercent: 1, ivPoints: 0, calendarDays: 0 }, now: Date.parse(at) })).toBeNull();
  });
});

describe("known missing reference is not new issuance permission", () => {
  it("recover empty -> UNKNOWN sticks in same journey and existing owner slot across restart", async () => {
    const x = await setup(), journey = createFrozenNodeEntryJourney(x.request, x.ports);
    expect((await journey.recover()).kind).toBe("effect_unknown");
    expect((await journey.prepare()).kind).toBe("effect_unknown");
    const restarted = createFrozenNodeEntryJourney(x.request, x.ports);
    expect((await restarted.prepare()).kind).toBe("effect_unknown"); await restarted.enroll();
    expect(x.route).not.toHaveBeenCalled(); expect(x.counters.insert).toBe(0);
    expect([...x.storageMap.values()][0]).toContain('"reference_unknown"');
  });
});


it.each(["pause-restore", "delete-reinsert"])("%s after INSERT acknowledgment snapshot cannot arm stale initial intent", async fault => {
  const x = await setup(); x.insertControl.started = () => {
    const [id, row] = [...x.table][0];
    // Protected intent token rotates even when final visible predicate/active
    // values equal the original. Returning snapshot still carries original token.
    if (fault === "delete-reinsert") { x.table.delete(id); x.table.set(id, { ...row, frozen_intent_revision: B }); }
    else row.frozen_intent_revision = B;
  };
  const journey = createFrozenNodeEntryJourney(x.request, x.ports); await journey.prepare();
  expect((await journey.enroll()).kind).not.toBe("committed");
  expect(x.counters.insert).toBe(1); expect(x.rpc).not.toHaveBeenCalled();
});
