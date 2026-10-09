import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  session: { access_token: "fixture-access" } as { access_token: string } | null,
  sink: null as ((payload: string) => void) | null,
  warm: null as string | null,
  detach: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: {
  getSession: async () => ({ data: { session: state.session } }),
  getUser: async () => ({ data: { user: state.session ? { id: "fixture-owner" } : null } }),
} }) }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: () => ({ ok: true }), tooMany: vi.fn() }));
vi.mock("@/lib/flowSource", () => ({ isValidF: () => true }));
vi.mock("@/lib/flowBroadcast", () => ({ subscribe: (_f: string, sink: (payload: string) => void) => {
  state.sink = sink; if (state.warm) sink(state.warm); return state.detach;
} }));
let answer: unknown, fetcher: ReturnType<typeof vi.fn>, response: Response | undefined;
async function open(signal?: AbortSignal) {
  const route = await import("../../app/api/flow/stream/route");
  response = await route.GET(new Request("http://localhost/api/flow/stream?f=feed", { signal }));
  expect(response.status).toBe(200); return response;
}
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(0); process.env.FLOW_FIXTURE = "0";
  state.session = { access_token: "fixture-access" }; state.sink = null; state.warm = null; state.detach.mockReset(); response = undefined;
  answer = { tier: "pro", features: ["terminal_live_options"] };
  fetcher = vi.fn(async () => new Response(JSON.stringify(answer), { headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetcher);
});
afterEach(async () => {
  if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
  vi.useRealTimers(); vi.unstubAllGlobals(); delete process.env.FLOW_FIXTURE;
});
describe("actual SSE route lifetime and entitlement owner", () => {
  it("rechecks actual feature authority and drops queued bytes on revocation", async () => {
    const r = await open(); state.sink!('data: {"paid":true}\n\n');
    answer = { tier: "essential", features: [] };
    await vi.advanceTimersByTimeAsync(45_000);
    expect(fetcher).toHaveBeenCalledTimes(2); expect(state.detach).toHaveBeenCalledTimes(1);
    const reader = r.body!.getReader(); await expect(reader.read()).rejects.toThrow(); reader.releaseLock();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("keeps an authorized operator stream alive through actual owner revalidation", async () => {
    answer = { tier: "unlimited", features: [] }; const r = await open(); const reader = r.body!.getReader();
    await reader.read(); await vi.advanceTimersByTimeAsync(45_000);
    expect(fetcher).toHaveBeenCalledTimes(2); expect(state.detach).not.toHaveBeenCalled();
    state.sink!('data: {"next":true}\n\n'); expect(new TextDecoder().decode((await reader.read()).value)).toContain('"next":true');
    await reader.cancel(); expect(state.detach).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it("parks a new frame during an unresolved authority read and resumes after approval", async () => {
    const r = await open(), reader = r.body!.getReader(); await reader.read();
    let release!: (response: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise<Response>(resolve => { release = resolve; }));
    await vi.advanceTimersByTimeAsync(45_000);
    let delivered = false; const next = reader.read().then(value => { delivered = true; return value; });
    state.sink!('data: {"latest":true}\n\n'); await vi.advanceTimersByTimeAsync(0); expect(delivered).toBe(false);
    release(new Response(JSON.stringify(answer))); await vi.advanceTimersByTimeAsync(0);
    expect(new TextDecoder().decode((await next).value)).toContain('"latest":true');
    await reader.cancel(); expect(state.detach).toHaveBeenCalledTimes(1);
  });
  it("fails closed on a hung recheck and ignores its later positive response", async () => {
    const r = await open(); let release!: (response: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise<Response>(resolve => { release = resolve; }));
    await vi.advanceTimersByTimeAsync(45_000); await vi.advanceTimersByTimeAsync(15_000);
    expect(state.detach).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    release(new Response(JSON.stringify(answer))); await vi.advanceTimersByTimeAsync(0);
    expect(state.detach).toHaveBeenCalledTimes(1);
    const reader = r.body!.getReader(); await expect(reader.read()).rejects.toThrow(); reader.releaseLock();
  });
  it("accepts a legitimate two-MiB frame and closes a non-reading connection at its byte budget", async () => {
    await open(); state.sink!("data: " + "x".repeat(2 * 1024 * 1024) + "\n\n");
    expect(state.detach).not.toHaveBeenCalled();
    for (let i = 0; i < 8; i++) state.sink!("data: " + "x".repeat(1024 * 1024) + "\n\n");
    expect(state.detach).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it("detaches even when an oversized warm frame closes synchronously during subscribe", async () => {
    state.warm = "data: " + "x".repeat(9 * 1024 * 1024) + "\n\n";
    await open(); expect(state.detach).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it("cleans abort and fixture mode without creating a second entitlement reader", async () => {
    process.env.FLOW_FIXTURE = "1"; const controller = new AbortController(); const r = await open(controller.signal);
    expect(fetcher).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    controller.abort(); expect(state.detach).toHaveBeenCalledTimes(1);
    const reader = r.body!.getReader(); await reader.read(); expect((await reader.read()).done).toBe(true); reader.releaseLock();
  });
});
