import { afterEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@/app/api/billing/gateway", () => ({ BILLING_BASE: "https://www.mastermind-x.com", billingAuthResult: auth }));
import { readWtiPath } from "../wtiPath.server";
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });
it("never fetches protected content for guests or unverified sessions", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  auth.mockResolvedValueOnce({ status: "denied" }).mockResolvedValueOnce({ status: "unavailable" });
  expect((await readWtiPath()).status).toBe("signin");
  expect((await readWtiPath()).status).toBe("unavailable"); expect(fetcher).not.toHaveBeenCalled();
});
it("uses a fixed no-store owner read and preserves entitlement and source errors", async () => {
  auth.mockResolvedValue({ status: "ok", token: "synthetic" });
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  for (const [code, result] of [[401,"signin"],[403,"restricted"],[429,"limited"],[503,"incoherent"],[200,"unavailable"]] as const) {
    fetcher.mockResolvedValueOnce(Response.json({detail:{code:"source_incoherent"}},{status:code}));
    expect((await readWtiPath()).status).toBe(result);
    const [url, init] = fetcher.mock.lastCall!;
    expect(String(url)).toBe("https://www.mastermind-x.com/api/ontology/explorer/v1?chain=oil_inflation_duration_derate");
    expect(init).toMatchObject({cache:"no-store",redirect:"error",headers:{Authorization:"Bearer synthetic"}});
  }
});
