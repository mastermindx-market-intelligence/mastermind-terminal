import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/entitlement", () => ({ hasLiveOptions: vi.fn() }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: vi.fn(() => ({ ok: true })), tooMany: () => new Response("limited", { status: 429 }) }));
vi.mock("@/lib/futuresCot", () => ({ readCotTff: vi.fn() }));
import { GET } from "../../app/api/futures/cot/route";
import { hasLiveOptions } from "../entitlement";
import { rateLimit } from "../rateLimit";
import { readCotTff } from "../futuresCot";
const ask = (query = "pair=ES") => GET(new Request("http://localhost/api/futures/cot?" + query));
const sample = { kind: "weekly_cftc_tff_futures_only", pair: "ES", reportDate: "2026-10-13", replayEligible: false };
beforeEach(() => {
  vi.clearAllMocks(); vi.mocked(hasLiveOptions).mockResolvedValue(true);
  vi.mocked(rateLimit).mockReturnValue({ ok: true } as never);
  vi.mocked(readCotTff).mockResolvedValue(sample as never);
});
describe("CFTC route preserves Futures entitlement and private no-store", () => {
  it("returns a valid weekly context after Options access is proven", async () => {
    const r = await ask();
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(r.headers.get("x-robots-tag")).toContain("noindex");
    expect(await r.json()).toEqual(sample);
    expect(readCotTff).toHaveBeenCalledWith("ES");
  });
  it("denies unsigned users before parsing or accessing upstream", async () => {
    vi.mocked(hasLiveOptions).mockResolvedValue(false);
    const r = await ask("pair=NQ");
    expect(r.status).toBe(403);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(readCotTff).not.toHaveBeenCalled();
  });
  it("refuses authority errors without falling back to public, paid or fixture bypass", async () => {
    vi.mocked(hasLiveOptions).mockRejectedValue(Error("auth unavailable"));
    const r = await ask();
    expect(r.status).toBe(403);
    expect(readCotTff).not.toHaveBeenCalled();
  });
  for(const query of ["pair=CL", "pair=ES&pair=NQ", "pair=ES&url=https://example.com", "pair=", ""]) {
    it("rejects unapproved query " + query, async () => {
      const r = await ask(query);
      expect(r.status).toBe(400);
      expect(r.headers.get("cache-control")).toBe("private, no-store");
      expect(readCotTff).not.toHaveBeenCalled();
    });
  }
  it("does not turn source errors or missing data into healthy empty rows", async () => {
    vi.mocked(readCotTff).mockResolvedValueOnce(null);
    expect((await ask()).status).toBe(503);
    vi.mocked(readCotTff).mockRejectedValueOnce(Error("secret upstream"));
    const r = await ask();
    expect(r.status).toBe(503);
    expect(await r.text()).not.toContain("secret");
  });
  it("does not allow a rate-limited request to contact upstream", async () => {
    vi.mocked(rateLimit).mockReturnValueOnce({ ok: false } as never);
    const r = await ask();
    expect(r.status).toBe(429);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(hasLiveOptions).not.toHaveBeenCalled();
    expect(readCotTff).not.toHaveBeenCalled();
  });
});
