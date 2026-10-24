import { beforeEach, describe, expect, it, vi } from "vitest";
import { draft, response } from "./fixtures/optionsPlanPayoff";
import { preparePlanExpiryRequest } from "../optionsPlanPayoff";
const auth = vi.hoisted(() => vi.fn());
vi.mock("@/app/api/billing/gateway", () => ({ billingAuthResult: auth, BILLING_BASE: "https://www.mastermind-x.com" }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: () => ({ ok: true }), tooMany: vi.fn() }));
import { POST } from "@/app/api/options/plan/expiry/route";
function request(payload?: unknown) {
  const built = preparePlanExpiryRequest(draft()); if (!built.ok) throw new Error();
  return new Request("http://localhost/api/options/plan/expiry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload ?? built.value) });
}
beforeEach(() => { vi.unstubAllGlobals(); auth.mockResolvedValue({ status: "ok", token: "verified" }); });
describe("private Plan proxy", () => {
  it("denies absent auth before any upstream read", async () => {
    auth.mockResolvedValue({ status: "denied" }); const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const r = await POST(request()); expect(r.status).toBe(401); expect(fetcher).not.toHaveBeenCalled();
    expect(r.headers.get("cache-control")).toBe("private, no-store");
  });
  it("forwards only canonical assumptions with verified bearer to fixed private API", async () => {
    const fetcher = vi.fn(async (_url, init) => new Response(JSON.stringify(response(JSON.parse(init.body))), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetcher);
    const r = await POST(request()); expect(r.status).toBe(200); expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe("https://www.mastermind-x.com/api/options/plan/expiry");
    expect(fetcher.mock.calls[0][1]).toMatchObject({ cache: "no-store", redirect: "error", headers: { Authorization: "Bearer verified" } });
    expect(r.headers.get("cache-control")).toBe("private, no-store");
  });
  it("returns only safe dated coverage for an unpriced exact selection, never rows or partial math", async () => {
    const built = preparePlanExpiryRequest(draft()); if (!built.ok) throw new Error();
    const raw = { ...response(built.value), status: "UNPRICED", curve: null, contracts: [{ secret_paid_row: true }] };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(raw), { headers: { "Content-Type": "application/json" } })));
    const r = await POST(request());
    expect(r.status).toBe(422);
    expect(await r.json()).toEqual({ status: "UNAVAILABLE", reason: "contract_terms_unavailable", coverage: {
      root: "SPY", contract_count: 20, expirations: ["2026-10-30"], as_of: "2026-10-23", captured_at: "2026-10-23T20:00:00Z",
    } });
    expect(r.headers.get("cache-control")).toBe("private, no-store");
  });
  it("never forwards caller evidence or arbitrary prices", async () => {
    const built = preparePlanExpiryRequest(draft()); if (!built.ok) throw new Error();
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    for (const payload of [{ ...built.value, reference_observation: {} }, { ...built.value, spots: [1, 2] }]) {
      expect((await POST(request(payload))).status).toBe(422);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("stops after one upstream failure and withholds malformed or overlarge success", async () => {
    for (const mode of ["failure", "malformed", "oversize"]) {
      const fetcher = vi.fn(async () => mode === "failure" ? Promise.reject(new Error("unavailable")) : new Response(mode === "oversize" ? " ".repeat(192 * 1024 + 1) : "{}", { headers: { "Content-Type": "application/json" } }));
      vi.stubGlobal("fetch", fetcher);
      const r = await POST(request()); expect(r.status).toBeGreaterThanOrEqual(400); expect(fetcher).toHaveBeenCalledOnce();
      expect(r.headers.get("cache-control")).toBe("private, no-store");
    }
  });
});
