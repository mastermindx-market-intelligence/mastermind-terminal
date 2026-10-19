import { describe, expect, it, vi } from "vitest";
import { ensureBrainPrincipalBinding } from "../brainPrincipal";
import type { MastermindBrainHost } from "../mastermindBrain";
function harness() {
  const host = new EventTarget() as EventTarget & MastermindBrainHost;
  host.MM_BRAIN_CFG = {}; host.MMBrain = { setPrincipal: vi.fn() };
  type Session = { user: { id: string } } | null;
  let event!: (event: string, session: Session) => void;
  let resolve!: (value: { data: { session: Session }; error?: unknown }) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<{ data: { session: Session }; error?: unknown }>((a, b) => { resolve = a; reject = b; });
  const auth = { getSession: vi.fn(() => promise), onAuthStateChange: vi.fn((cb: typeof event) => { event = cb; }) };
  const factory = vi.fn(() => auth);
  return { host, auth, factory, resolve, reject, event: (id: string | null) => event("AUTH_CHANGED", id ? { user: { id } } : null) };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
describe("Brain auth drives its document-level cache partition", () => {
  it("keeps unresolved identity empty and hands the exact user id to a late widget", async () => {
    const h = harness(); delete h.host.MMBrain; ensureBrainPrincipalBinding(h.host, h.factory);
    expect(h.host.MM_BRAIN_CFG).toEqual({ principal: null });
    h.resolve({ data: { session: { user: { id: "A" } } } }); await settle();
    expect(h.host.MM_BRAIN_CFG).toEqual({ principal: "A" });
    h.host.MMBrain = { setPrincipal: vi.fn() }; h.host.dispatchEvent(new Event("mm-brain-ready"));
    expect(h.host.MMBrain.setPrincipal).toHaveBeenLastCalledWith("A");
  });
  it("projects account switch and logout synchronously", () => {
    const h = harness(); ensureBrainPrincipalBinding(h.host, h.factory);
    for (const id of ["A", "B", null]) { h.event(id); expect(h.host.MM_BRAIN_CFG?.principal).toBe(id); expect(h.host.MMBrain?.setPrincipal).toHaveBeenLastCalledWith(id); }
  });
  it("a slow initial session cannot restore A after an auth event selects B", async () => {
    const h = harness(); ensureBrainPrincipalBinding(h.host, h.factory); h.event("B");
    h.resolve({ data: { session: { user: { id: "A" } } } }); await settle();
    expect(h.host.MM_BRAIN_CFG?.principal).toBe("B"); expect(h.host.MMBrain?.setPrincipal).toHaveBeenLastCalledWith("B");
  });
  it("a failed initial read cannot clear a newer identity", async () => {
    const h = harness(); ensureBrainPrincipalBinding(h.host, h.factory); h.event("B"); h.reject(new Error("unavailable")); await settle();
    expect(h.host.MM_BRAIN_CFG?.principal).toBe("B");
  });
  it("route remounts reuse one observer and reloaded widgets get the latest identity", () => {
    const h = harness(); ensureBrainPrincipalBinding(h.host, h.factory); h.event("A"); ensureBrainPrincipalBinding(h.host, h.factory);
    expect(h.factory).toHaveBeenCalledTimes(1); expect(h.auth.onAuthStateChange).toHaveBeenCalledTimes(1);
    h.event("B"); h.host.MMBrain = { setPrincipal: vi.fn() }; h.host.dispatchEvent(new Event("mm-brain-ready"));
    expect(h.host.MMBrain.setPrincipal).toHaveBeenCalledTimes(1); expect(h.host.MMBrain.setPrincipal).toHaveBeenLastCalledWith("B");
  });
  it("auth failure and old bundles keep an empty display partition", async () => {
    const h = harness(); h.host.MMBrain = { mounted: true }; ensureBrainPrincipalBinding(h.host, h.factory);
    h.resolve({ data: { session: null }, error: new Error("unauthenticated") }); await settle(); expect(h.host.MM_BRAIN_CFG).toEqual({ principal: null });
  });
  it("unavailable setup fails closed and can bind on a later mount", () => {
    const h = harness(); h.host.MM_BRAIN_CFG = { principal: "prior" };
    ensureBrainPrincipalBinding(h.host, () => { throw new Error("missing config"); }); expect(h.host.MMBrain?.setPrincipal).toHaveBeenLastCalledWith(null);
    ensureBrainPrincipalBinding(h.host, h.factory); h.event("B"); expect(h.host.MM_BRAIN_CFG?.principal).toBe("B");
  });
});
