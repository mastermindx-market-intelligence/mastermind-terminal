import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(), createClient: vi.fn(), preflight: vi.fn(), rateLimit: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/rateLimit", async (original) => ({ ...await original<typeof import("@/lib/rateLimit")>(), rateLimit: mocks.rateLimit }));
vi.mock("@/lib/evidenceToThesis", async (original) => ({ ...await original<typeof import("@/lib/evidenceToThesis")>(), preflightEvidenceToThesis: mocks.preflight }));
import { POST } from "@/app/api/research-assistant/route";

const held = {
  schema: "mastermind.evidence-to-thesis/v1", symbol: "AAPL", question: "services demand",
  state: "generation_held", reason: "temporary_generation_unavailable", evidence: [], coverage: null,
};
function request(body: unknown = { symbol: "AAPL", question: "services demand" }) {
  return new Request("https://terminal.test/api/research-assistant", { method: "POST", body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createClient.mockResolvedValue({ auth: { getUser: mocks.getUser } });
  mocks.getUser.mockResolvedValue({ data: { user: { id: "qa-user-a" } } });
  mocks.preflight.mockResolvedValue(held);
  mocks.rateLimit.mockReturnValue({ ok: true, remaining: 9, retryAfterSec: 0 });
});
afterEach(() => vi.useRealTimers());

describe("research assistant authenticated read-only route", () => {
  it("requires a verified user before archive reads", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.preflight).not.toHaveBeenCalled();
  });

  it("holds if authentication cannot be checked", async () => {
    mocks.getUser.mockRejectedValue(new Error("down"));
    expect((await POST(request())).status).toBe(503);
    expect(mocks.preflight).not.toHaveBeenCalled();
  });

  it("returns the held state without forwarding a token or accepting another user identity", async () => {
    const req = request();
    const response = await POST(req);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(held);
    expect(mocks.preflight).toHaveBeenCalledWith("AAPL", "services demand", { signal: req.signal });
    expect((await POST(request({ symbol: "AAPL", question: "services", userId: "qa-user-b" }))).status).toBe(400);
    expect(mocks.preflight).toHaveBeenCalledTimes(1);
  });

  it("checks identity on every request instead of retaining an authenticated result", async () => {
    expect((await POST(request())).status).toBe(200);
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect((await POST(request())).status).toBe(401);
    expect(mocks.getUser).toHaveBeenCalledTimes(2);
    expect(mocks.preflight).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid, overlong and unknown request fields before retrieval", async () => {
    for (const body of [[], null, { symbol: "AAPL", question: "" }, { symbol: "AAPL", question: "x".repeat(241) }, { symbol: "AAPL", question: "services", gatewayUrl: "https://other.test" }]) {
      expect((await POST(request(body))).status).toBe(400);
    }
    expect(mocks.preflight).not.toHaveBeenCalled();
  });

  it("bounds a chunked request without trusting Content-Length", async () => {
    const canceled = vi.fn();
    const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(4097)); }, cancel: canceled });
    const req = new Request("https://terminal.test/api/research-assistant", { method: "POST", body, duplex: "half" } as RequestInit);
    expect((await POST(req)).status).toBe(400);
    expect(canceled).toHaveBeenCalled();
    expect(mocks.preflight).not.toHaveBeenCalled();
  });

  it("cancels a declared oversized request before reading it", async () => {
    const canceled = vi.fn();
    const body = new ReadableStream({ cancel: canceled });
    const req = new Request("https://terminal.test/api/research-assistant", {
      method: "POST", body, headers: { "content-length": "4097" }, duplex: "half",
    } as RequestInit);
    expect((await POST(req)).status).toBe(400);
    expect(canceled).toHaveBeenCalled();
    expect(mocks.preflight).not.toHaveBeenCalled();
  });

  it("rate limits before auth and retrieval", async () => {
    mocks.rateLimit.mockReturnValue({ ok: false, remaining: 0, retryAfterSec: 60 });
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.preflight).not.toHaveBeenCalled();
  });

  it("cancels a stalled request body after its bounded read window", async () => {
    vi.useFakeTimers();
    const canceled = vi.fn();
    const body = new ReadableStream({ cancel: canceled });
    const req = new Request("https://terminal.test/api/research-assistant", { method: "POST", body, duplex: "half" } as RequestInit);
    const response = POST(req);
    await vi.advanceTimersByTimeAsync(5001);
    expect((await response).status).toBe(400);
    expect(canceled).toHaveBeenCalled();
    expect(mocks.preflight).not.toHaveBeenCalled();
  });
});
