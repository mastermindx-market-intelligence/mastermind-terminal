import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/entitlement", () => ({ hasLiveOptions: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("TEST_NOT_FOUND"); } }));
vi.mock("@/components/OptionsPaywall", () => ({ default: function Paywall() { return null; } }));
vi.mock("@/components/mounts/FuturesWorkspaceMount", () => ({ default: function Mount() { return null; } }));
import Page from "../../app/(shell)/options/futures/page";
import Mount from "../../components/mounts/FuturesWorkspaceMount";
import Paywall from "../../components/OptionsPaywall";
import { hasLiveOptions } from "../entitlement";
const page = (query: Record<string, string | string[] | undefined> = {}) => Page({ searchParams: Promise.resolve(query) });
beforeEach(() => { vi.clearAllMocks(); vi.mocked(hasLiveOptions).mockResolvedValue(false); });
afterEach(() => vi.unstubAllEnvs());
describe("futures production page access boundary", () => {
  it("does not mount the data consumer for denied users", async () => expect((await page()).type).toBe(Paywall));
  it("authority failure remains a paywall", async () => {
    vi.mocked(hasLiveOptions).mockRejectedValue(Error("offline")); expect((await page()).type).toBe(Paywall);
  });
  it("production cannot use developer fixture flags to open the page", async () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("FLOW_FIXTURE", "1"); vi.stubEnv("TERMINAL_E2E_FIXTURE", "1");
    expect((await page()).type).toBe(Paywall); expect(hasLiveOptions).toHaveBeenCalledOnce();
  });
  it("authorized users get the reusable consumer with canonical request only", async () => {
    vi.mocked(hasLiveOptions).mockResolvedValue(true); const result = await page({ pair: "NQ", interval: "5", rows: "4", expiry: "zero" });
    expect(result.type).toBe(Mount); expect(result.props.initialRequest).toMatchObject({ pair: "NQ", intervalMinutes: 5, priceStepTicks: 4, expiry: "zero" });
  });
  for (const query of [{ pair: ["ES", "NQ"] }, { interval: "60" }, { url: "http://other" }, { at: "NaN" }])
    it(`bad page query does not silently select an unrelated instrument ${JSON.stringify(query)}`, async () => {
      vi.mocked(hasLiveOptions).mockResolvedValue(true); await expect(page(query)).rejects.toThrow("TEST_NOT_FOUND");
    });
  it("the deliberate development page preview still requires both development and fixture selection", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("FLOW_FIXTURE", "1"); expect((await page()).type).toBe(Mount);
    expect(hasLiveOptions).not.toHaveBeenCalled(); vi.stubEnv("FLOW_FIXTURE", "0"); expect((await page()).type).toBe(Paywall);
  });
});
