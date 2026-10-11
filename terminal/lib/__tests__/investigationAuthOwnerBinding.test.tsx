// @vitest-environment jsdom
import React, { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import type { AuthLifecycleSnapshot, AuthObserver } from "@/lib/supabase/authLifecycle";
import { subscribeInvestigationAuthOwner } from "@/lib/supabase/investigationAuthOwner";
import { useInvestigationAuthLifecycle, type InvestigationAuthProjection } from "@/components/workspaces/InvestigationAuthContext";
import InvestigationWorkspace from "@/components/workspaces/InvestigationWorkspace";

const mocks = vi.hoisted(() => ({ client: vi.fn(), recover: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: mocks.client }));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: "en" }) }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.ComponentProps<"a">) => { projections.push(useInvestigationAuthLifecycle()); return <a {...props}>{children}</a>; } }));
vi.mock("@/lib/investigationContracts", () => ({ INVESTIGATION_MANIFEST_SCHEMA_V2: "investigation.manifest.v2", validateInvestigationManifest: () => ({ ok: true, errors: [] }), validateStoredInvestigationManifest: () => ({ ok: true }), canonicalInvestigationJson: () => "" }));
vi.mock("@/lib/investigations", () => ({ INVESTIGATION_ADMISSION: {} }));
vi.mock("@/lib/investigationSave", () => ({
 beginInvestigationSave: vi.fn(), settleInvestigationSave: (state: unknown) => state,
 retryInvestigationSave: () => null, investigationCommandToReconcile: () => null,
 recoverInvestigationSave: mocks.recover, receiptRequiresOwnerCheck: () => false,
 resendsRefusedReferences: () => false,
}));
vi.mock("@/components/workspaces/InvestigationTheses", () => ({ InvestigationThesisPicker: () => <Probe/>, InvestigationThesisReader: () => null }));
vi.mock("@/components/workspaces/InvestigationEvidenceReview", () => ({ default: () => null }));
vi.mock("@/components/workspaces/InvestigationReplay", () => ({ default: () => null }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Callback = (event: AuthChangeEvent, session: Session | null) => void;
function syntheticSession(principal = "account-A", sessionId = "session-A"): Session {
 const payload = btoa(JSON.stringify({ sub: principal, session_id: sessionId, aal: "aal1" })).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
 return { access_token: `synthetic.${payload}.signature`, user: { id: principal } } as Session;
}
function harness(initial?: Session | null) {
 const observers: Array<{ callback: Callback; active: boolean }> = [];
 let active = 0, maxActive = 0;
 const checks: Array<{ resolve: (result: unknown) => void; reject: () => void }> = [];
 const onAuthStateChange = vi.fn((callback: Callback) => {
  const entry = { callback, active: true }; observers.push(entry); active++; maxActive = Math.max(active, maxActive);
  if (initial !== undefined) callback("INITIAL_SESSION", initial);
  return { data: { subscription: { unsubscribe: vi.fn(() => { if (entry.active) { entry.active = false; active--; } }) } } };
 });
 const getClaims = vi.fn(() => new Promise<unknown>((resolve, reject) => checks.push({ resolve, reject: () => reject(new Error("synthetic verification failure")) })));
 const auth: AuthObserver = { onAuthStateChange, getClaims };
 return {
  auth, onAuthStateChange, getClaims, observers, checks,
  emit(event: string, session: Session | null) { for (const entry of observers) if (entry.active) entry.callback(event as AuthChangeEvent, session); },
  late(index: number, event: string, session: Session | null) { observers[index].callback(event as AuthChangeEvent, session); },
  active: () => active, maxActive: () => maxActive,
  verify(index = 0, principal = "account-A", sessionId = "session-A") { checks[index].resolve({ data: { claims: { sub: principal, session_id: sessionId, aal: "aal1" } }, error: null }); },
 };
}
let root: Root | null, element: HTMLDivElement;
let projections: Array<InvestigationAuthProjection | null>;
let fetchMock: ReturnType<typeof vi.fn>;
function Probe() { const projection = useInvestigationAuthLifecycle(); projections.push(projection); return <output data-testid="auth-projection">{projection?.snapshot.availability ?? "absent"}</output>; }
const pendingStorage = '{"owner":"account-A","command":{"operation_id":"synthetic-retained-operation"}}';
function retainedPending() {
 return { phase: "uncertain", principal: "account-A", command: { action: "create", id: "synthetic-record", operation_id: "synthetic-retained-operation", expected_revision: 0, manifest: { intent: { title: "Retained exact draft", question: "Retained question", subjects: [] }, continuation: {}, layout_refs: [], thesis_refs: [], evidence_refs: [] } } };
}
function mountPending(ownerKey = "account-A", revision?: number, strict = false) {
 const node = <InvestigationWorkspace ownerKey={ownerKey} initialRevision={revision}/>;
 act(() => { root!.render(strict ? <StrictMode>{node}</StrictMode> : node); });
}
async function timers() { await act(async () => { await vi.runAllTimersAsync(); }); }
function latest() { return projections.at(-1)!; }
function seedPending() { sessionStorage.setItem("mm.investigation.pending.v2:account-A", pendingStorage); mocks.recover.mockImplementation((owner: string) => owner === "account-A" ? retainedPending() : null); }
beforeEach(() => {
 vi.useFakeTimers(); mocks.client.mockReset(); mocks.recover.mockReset(); sessionStorage.clear(); projections = [];
 element = document.createElement("div"); document.body.append(element); root = createRoot(element);
 fetchMock = vi.fn(async (url: string) => ({ json: async () => url === "/api/investigations" ? { status: "listed", items: [] } : { layouts: [] } }));
 vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { if (root) act(() => root!.unmount()); root = null; element.remove(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("private existing-owner adapter with frozen lifecycle", () => {
 it("uses one SDK observer; pending, unverified and verified ready are distinct", async () => {
  const h = harness(), lifecycle = vi.fn(), principal = vi.fn();
  const binding = subscribeInvestigationAuthOwner(lifecycle, principal, () => h.auth)!;
  expect(binding.getSnapshot().availability).toBe("pending");
  expect(h.onAuthStateChange).toHaveBeenCalledTimes(1);
  h.emit("SIGNED_IN", syntheticSession());
  expect(binding.getSnapshot().availability).toBe("unverified"); expect(principal).toHaveBeenLastCalledWith("account-A");
  expect(h.getClaims).not.toHaveBeenCalled(); expect(lifecycle).not.toHaveBeenCalled();
  await timers(); expect(h.getClaims).toHaveBeenCalledTimes(1);
  h.verify(); await timers(); expect(binding.getSnapshot().availability).toBe("ready");
  expect(Object.isFrozen(binding.getSnapshot())).toBe(true);
  expect(Object.keys(binding.getSnapshot()).sort()).toEqual(["auth_epoch", "availability", "principal_partition"]);
  binding.unsubscribe(); expect(h.active()).toBe(0);
 });
 it("keeps observed user principal independent of malformed token, unknown event and verification failure", async () => {
  const h = harness(), principal = vi.fn(); const binding = subscribeInvestigationAuthOwner(() => {}, principal, () => h.auth)!;
  h.emit("SIGNED_IN", { user: { id: "account-A" }, access_token: "not-a-token" } as Session);
  expect(principal).toHaveBeenLastCalledWith("account-A"); expect(binding.getSnapshot().availability).toBe("unavailable");
  h.emit("SIGNED_IN", syntheticSession()); await timers(); h.checks[0].reject(); await timers();
  expect(binding.getSnapshot().availability).toBe("unverified"); expect(principal).toHaveBeenLastCalledWith("account-A");
  h.emit("SYNTHETIC_UNKNOWN", syntheticSession()); expect(principal).toHaveBeenLastCalledWith("account-A"); expect(binding.getSnapshot().availability).toBe("unavailable");
  h.emit("PASSWORD_RECOVERY", syntheticSession()); expect(principal).toHaveBeenLastCalledWith("account-A"); expect(binding.getSnapshot().availability).toBe("unverified");
  binding.unsubscribe();
 });
 it("preserves null/different-user observation and does not invent a principal when SDK user access throws", () => {
  const h = harness(), principal = vi.fn(); const binding = subscribeInvestigationAuthOwner(() => {}, principal, () => h.auth)!;
  h.emit("SIGNED_IN", syntheticSession("account-B", "session-B")); expect(principal).toHaveBeenLastCalledWith("account-B");
  h.emit("SIGNED_OUT", null); expect(principal).toHaveBeenLastCalledWith(null);
  const before = principal.mock.calls.length;
  const session = syntheticSession(); Object.defineProperty(session, "user", { get() { throw new Error("synthetic SDK user unavailable"); } });
  expect(() => h.emit("SIGNED_IN", session)).not.toThrow(); expect(principal).toHaveBeenCalledTimes(before);
  binding.unsubscribe();
 });
 it("reports setup failure as absence, rather than a fabricated lifecycle identity", () => {
  expect(subscribeInvestigationAuthOwner(() => {}, () => {}, () => { throw new Error("synthetic client setup failure"); })).toBeNull();
  expect(subscribeInvestigationAuthOwner(() => {}, () => {}, () => ({ onAuthStateChange() { throw new Error("synthetic subscription setup failure"); }, getClaims: async () => null }))).toBeNull();
  expect(subscribeInvestigationAuthOwner(() => {}, () => {}, () => ({ onAuthStateChange: () => ({ data: { subscription: null } }), getClaims: async () => null }) as unknown as AuthObserver)).toBeNull();
 });
 it("cleanup suppresses both callback paths and late checks; replacement binds its own client", async () => {
  const first = harness(), second = harness(), principal = vi.fn(), lifecycle = vi.fn();
  const old = subscribeInvestigationAuthOwner(lifecycle, principal, () => first.auth)!;
  first.emit("SIGNED_IN", syntheticSession()); await timers(); lifecycle.mockClear(); principal.mockClear();
  old.unsubscribe(); old.unsubscribe(); first.late(0, "SIGNED_IN", syntheticSession("account-B", "session-B")); first.verify(); await timers();
  expect(principal).not.toHaveBeenCalled(); expect(lifecycle).not.toHaveBeenCalled(); expect(first.active()).toBe(0);
  const current = subscribeInvestigationAuthOwner(lifecycle, principal, () => second.auth)!;
  expect(second.active()).toBe(1); expect(current.getSnapshot().availability).toBe("pending"); current.unsubscribe();
 });
});

describe("existing Workspace projection transport and unchanged Saved authority", () => {
 it("outside the owner returns null and creates no subscription", () => {
  act(() => root!.render(<Probe/>)); expect(latest()).toBeNull(); expect(mocks.client).not.toHaveBeenCalled();
 });
 it("publishes frozen pending projection and safe snapshots without admitting initial verification", async () => {
  const h = harness(); mocks.client.mockReturnValue({ auth: h.auth }); seedPending(); mountPending();
  expect(projections[0]).toBeNull();
  const projection = latest()!; expect(projection.snapshot.availability).toBe("pending"); expect(Object.isFrozen(projection)).toBe(true);
  expect(h.active()).toBe(1); expect(h.onAuthStateChange).toHaveBeenCalledTimes(1);
  act(() => h.emit("INITIAL_SESSION", syntheticSession()));
  expect(projection.getSnapshot()?.availability).toBe("unverified"); await timers();
  expect(latest()!.snapshot.availability).toBe("unverified"); expect(element.querySelector<HTMLInputElement>('input[aria-label="Title"]')?.value).toBe("Retained exact draft");
  expect(sessionStorage.getItem("mm.investigation.pending.v2:account-A")).toBe(pendingStorage);
  expect(Object.keys(projection).sort()).toEqual(["getSnapshot", "snapshot"]);
  const serialized = JSON.stringify(latest()); expect(serialized).not.toContain("access_token"); expect(serialized).not.toContain("signature"); expect(serialized).not.toContain("session-A");
 });
 it("fresh accessor sees a callback change before deferred React notification; Saved stays retained", async () => {
  const h = harness(); mocks.client.mockReturnValue({ auth: h.auth }); seedPending(); mountPending();
  act(() => h.emit("SIGNED_IN", syntheticSession())); await timers(); h.verify(); await timers();
  const readyRender = latest()!; expect(readyRender.snapshot.availability).toBe("ready");
  act(() => h.emit("SYNTHETIC_UNKNOWN", syntheticSession()));
  expect(readyRender.snapshot.availability).toBe("ready"); expect(readyRender.getSnapshot()?.availability).toBe("unavailable");
  expect(element.querySelector<HTMLInputElement>('input[aria-label="Title"]')?.value).toBe("Retained exact draft"); expect(element.textContent).not.toContain("Your account changed");
  await timers(); expect(latest()!.snapshot.availability).toBe("unavailable");
  expect(sessionStorage.getItem("mm.investigation.pending.v2:account-A")).toBe(pendingStorage);
  expect(fetchMock.mock.calls.every(([, init]) => !(init as RequestInit | undefined)?.method || (init as RequestInit).method === "GET")).toBe(true);
 });
 it("same-user recovery and verification failure never reset pending Saved state", async () => {
  const h = harness(); mocks.client.mockReturnValue({ auth: h.auth }); seedPending(); mountPending();
  act(() => h.emit("SIGNED_IN", syntheticSession())); await timers(); h.checks[0].reject(); await timers();
  expect(latest()!.snapshot.availability).toBe("unverified");
  act(() => h.emit("PASSWORD_RECOVERY", syntheticSession())); await timers();
  expect(element.querySelector<HTMLInputElement>('input[aria-label="Title"]')?.value).toBe("Retained exact draft"); expect(element.textContent).not.toContain("Your account changed");
  expect(sessionStorage.getItem("mm.investigation.pending.v2:account-A")).toBe(pendingStorage);
 });
 it.each([syntheticSession("account-B", "session-B"), null])("original principal mismatch ends displayed owner and retains original pending bytes", async session => {
  const h = harness(); mocks.client.mockReturnValue({ auth: h.auth }); seedPending(); mountPending();
  act(() => h.emit(session ? "SIGNED_IN" : "SIGNED_OUT", session));
  expect(element.textContent).toContain("Your account changed or your session ended");
  expect(sessionStorage.getItem("mm.investigation.pending.v2:account-A")).toBe(pendingStorage);
  expect(fetchMock.mock.calls.every(([, init]) => (init as RequestInit).signal?.aborted)).toBe(true);
  expect(fetchMock.mock.calls.every(([, init]) => !(init as RequestInit).method)).toBe(true);
  await timers();
 });
 it("local-preview bypass stays absent without a client/subscriber", () => {
  mocks.recover.mockReturnValue(retainedPending()); sessionStorage.setItem("mm.investigation.pending.v2:local-preview", pendingStorage);
  mountPending("local-preview"); expect(latest()).toBeNull(); expect(mocks.client).not.toHaveBeenCalled();
 });
 it("client/subscription setup failure preserves original scope abort/account-ended behavior", () => {
  mocks.client.mockImplementation(() => { throw new Error("synthetic setup failure"); }); seedPending(); mountPending();
  expect(element.textContent).toContain("Your account changed or your session ended"); expect(latest()).toBeNull();
  expect(fetchMock.mock.calls.every(([, init]) => (init as RequestInit).signal?.aborted)).toBe(true);
  expect(sessionStorage.getItem("mm.investigation.pending.v2:account-A")).toBe(pendingStorage);
 });
 it("synchronous initial callback publishes the actual unverified module snapshot", () => {
  const h = harness(syntheticSession()); mocks.client.mockReturnValue({ auth: h.auth }); seedPending(); mountPending();
  expect(latest()!.snapshot.availability).toBe("unverified"); expect(latest()!.getSnapshot()).toBe(latest()!.snapshot); expect(h.getClaims).not.toHaveBeenCalled();
 });
 it("StrictMode has one active listener; cleanup and old callbacks cannot control the new lifetime", async () => {
  const h = harness(); mocks.client.mockReturnValue({ auth: h.auth }); seedPending(); mountPending("account-A", undefined, true);
  expect(h.onAuthStateChange).toHaveBeenCalledTimes(2); expect(h.active()).toBe(1); expect(h.maxActive()).toBe(1);
  act(() => h.late(0, "SIGNED_IN", syntheticSession("account-B", "session-B"))); expect(element.textContent).not.toContain("Your account changed");
  const old = latest()!; act(() => root!.unmount()); root = null;
  expect(old.getSnapshot()).toBeNull(); expect(h.active()).toBe(0);
  h.late(1, "SIGNED_IN", syntheticSession("account-B", "session-B")); await timers(); expect(old.getSnapshot()).toBeNull();
 });
 it("effect rebinding hides the prior projection and obtains the current client without stale callback influence", () => {
  const first = harness(), second = harness(); mocks.client.mockReturnValueOnce({ auth: first.auth }).mockReturnValueOnce({ auth: second.auth }); seedPending(); mountPending();
  const old = latest()!; const offset = projections.length; mountPending("account-A", 2);
  expect(projections.slice(offset)).toContain(null); expect(old.getSnapshot()).toBeNull(); expect(first.active()).toBe(0); expect(second.active()).toBe(1);
  expect(latest()!.snapshot.auth_epoch).not.toBe(old.snapshot.auth_epoch);
  act(() => first.late(0, "SIGNED_OUT", null)); expect(element.textContent).not.toContain("Your account changed");
 });
});
