import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getSession: vi.fn(),
  getUser: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/rateLimit", () => ({
  rateLimit: () => ({ ok: true, remaining: 100, retryAfterSec: 0 }),
}));

import { authenticate, boundedJson, macroRead, runMedTech, type MedTechAuth } from "@/lib/medtechServer";
import { GET as proxy } from "@/app/api/medtech/[...path]/route";

const snapshot = "a".repeat(64);
const token = "fixture-server-session";
const auth: MedTechAuth = { token, userId: "fixture-owner", db: { from: vi.fn() } };
const dto = { schema: "medtech.events/v1", snapshot_id: snapshot, items: [] };

beforeEach(() => {
  vi.stubEnv("BRAIN_GATEWAY_URL", "https://mastermind-x.com");
  mocks.getSession.mockResolvedValue({ data: { session: { access_token: token } }, error: null });
  mocks.getUser.mockResolvedValue({ data: { user: { id: "fixture-owner" } }, error: null });
  mocks.createClient.mockResolvedValue({ auth: { getSession: mocks.getSession, getUser: mocks.getUser } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(dto)));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("MedTech account and transport boundary", () => {
  it("verifies the same bearer it forwards, never a caller's Authorization or cookies", async () => {
    const request = new Request("https://app.mastermind-x.com/api/medtech/events", {
      headers: { authorization: "Bearer caller-controlled", cookie: "private=fixture" },
    });
    const response = await proxy(request, { params: Promise.resolve({ path: ["events"] }) });
    expect(response.status).toBe(200);
    expect(mocks.getUser).toHaveBeenCalledWith(token);
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toBe("https://mastermind-x.com/api/medtech/events");
    expect(options).toMatchObject({
      headers: { authorization: "Bearer " + token, accept: "application/json" },
      redirect: "error", cache: "no-store",
    });
    expect((options?.headers as Record<string, string>).cookie).toBeUndefined();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Authorization, Cookie");
  });

  it("stops before source reads when no session exists", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
    const action = vi.fn();
    const response = await runMedTech(new Request("https://app.mastermind-x.com/api/medtech/events"), false, action);
    expect(response.status).toBe(401);
    expect(action).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("does not trust an unverified user or turn an auth outage into sign-out", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: { status: 401 } });
    await expect(authenticate()).rejects.toMatchObject({ status: 401 });
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: { status: 503 } });
    await expect(authenticate()).rejects.toMatchObject({ status: 503, code: "account_unavailable" });
  });

  it("refuses cross-origin and non-JSON writes before invoking a mutation", async () => {
    const action = vi.fn();
    const cross = await runMedTech(new Request("https://app.mastermind-x.com/api/medtech/watches", {
      method: "POST", headers: { origin: "https://other.example", "content-type": "application/json" },
    }), true, action);
    expect(cross.status).toBe(403);
    const plain = await runMedTech(new Request("https://app.mastermind-x.com/api/medtech/watches", {
      method: "POST", headers: { origin: "https://app.mastermind-x.com", "content-type": "text/plain" },
    }), true, action);
    expect(plain.status).toBe(415);
    expect(action).not.toHaveBeenCalled();
  });

  it("rejects arbitrary paths, nested path escapes, duplicate query keys and source overrides", async () => {
    await expect(macroRead(auth, "/../../private")).rejects.toMatchObject({ status: 404 });
    for (const query of ["?q=a&q=b", "?url=https://other.example", "?q=" + "x".repeat(121)]) {
      const response = await proxy(new Request("https://app.mastermind-x.com/api/medtech/events" + query),
        { params: Promise.resolve({ path: ["events"] }) });
      expect(response.status).toBe(400);
    }
    const nested = await proxy(new Request("https://app.mastermind-x.com/api/medtech/events/x"),
      { params: Promise.resolve({ path: ["events", "fda-510k-K260001", "private"] }) });
    expect(nested.status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [403, "subscription_required"], [409, "snapshot_changed"], [500, "source_unavailable"],
  ])("preserves the meaning of upstream %s without forwarding its body", async (status, code) => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("private source path /secret", { status: Number(status) }));
    await expect(macroRead(auth, "/events")).rejects.toMatchObject({ code });
  });

  it("fails closed on invalid JSON, wrong schemas, or an oversized chunked source", async () => {
    for (const response of [
      new Response("{broken", { headers: { "content-type": "application/json" } }),
      Response.json({ schema: "private.raw/v1", snapshot_id: snapshot }),
      new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); controller.close();
      } }), { headers: { "content-type": "application/json" } }),
    ]) {
      vi.mocked(fetch).mockResolvedValueOnce(response);
      await expect(macroRead(auth, "/events")).rejects.toMatchObject({ status: 503, code: "source_unavailable" });
    }
  });

  it("bounds request streams as they arrive and stops a stalled body", async () => {
    const body = new Response("x".repeat(8193)).body;
    await expect(boundedJson(body, 8192)).rejects.toMatchObject({ status: 413 });
    const stalled = new ReadableStream<Uint8Array>({ start() {} });
    await expect(boundedJson(stalled, 8192, 15)).rejects.toMatchObject({ status: 408 });
  });
});
