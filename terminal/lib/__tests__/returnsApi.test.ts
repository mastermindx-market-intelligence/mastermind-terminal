import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { returnSessions } from "../returnsIntelligence";

const owner = vi.hoisted(() => ({
  claims: vi.fn(), open: vi.fn(), rate: vi.fn(), closes: [] as string[],
  files: new Map<string, unknown>(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getClaims: owner.claims } }) }));
vi.mock("node:fs/promises", () => ({ open: owner.open }));
vi.mock("@/lib/rateLimit", () => ({
  rateLimit: owner.rate,
  tooMany: () => new Response(JSON.stringify({ error: "rate_limited" }), { status: 429 }),
}));
import { POST } from "@/app/api/returns/basket/route";
import { GET } from "@/app/api/returns/forecast/route";

const days = returnSessions("2026-01-02", "2026-10-16")!;
function price(symbol: string) {
  return { t: symbol, src: "fixture", bars: days.map((d, i) => [d, 100+i, 100+i, 100+i, 100+i, 10]) };
}
const basket = (body: unknown) => POST(new Request("http://localhost/api/returns/basket", { method: "POST", body: JSON.stringify(body) }));
const input = () => ({ symbols: ["NVDA", "AMD"], horizon: 21, membershipAsOf: "2026-10-16" });
const forecast = (query = "symbol=NVDA&asOf=2026-10-16&horizon=21") => GET(new Request(`http://localhost/api/returns/forecast?${query}`));

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-18T00:00:00Z"));
  owner.files.clear(); owner.closes.length = 0; vi.clearAllMocks();
  owner.rate.mockReturnValue({ ok: true });
  owner.claims.mockResolvedValue({ data: { claims: { sub: "test-user" } }, error: null });
  owner.files.set("NVDA.json", price("NVDA")); owner.files.set("AMD.json", price("AMD"));
  owner.open.mockImplementation(async (name: string) => {
    const key = name.split("/").at(-1)!;
    if (!owner.files.has(key)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
    const body = owner.files.get(key);
    return {
      stat: async () => ({ isFile: () => true, size: JSON.stringify(body).length }),
      readFile: async () => JSON.stringify(body), close: async () => { owner.closes.push(key); },
    };
  });
});
afterEach(() => { vi.useRealTimers(); });

describe("Returns BFF access, resources, and exact context", () => {
  it("requires authenticated claims before reading either owner's files", async () => {
    owner.claims.mockResolvedValue({ data: null, error: null });
    for (const response of [await basket(input()), await forecast()]) {
      expect(response.status).toBe(401); expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(owner.open).not.toHaveBeenCalled();
  });
  it("fails closed when authentication is unavailable", async () => {
    owner.claims.mockRejectedValue(new Error("auth outage"));
    expect((await basket(input())).status).toBe(503); expect((await forecast()).status).toBe(503);
    expect(owner.open).not.toHaveBeenCalled();
  });
  it("honors the existing limiter before authentication or disk work", async () => {
    owner.rate.mockReturnValue({ ok: false });
    expect((await basket(input())).status).toBe(429); expect((await forecast()).status).toBe(429);
    expect(owner.claims).not.toHaveBeenCalled(); expect(owner.open).not.toHaveBeenCalled();
  });
  it("bounds the streamed body without trusting a Content-Length header", async () => {
    const response = await POST(new Request("http://localhost/api/returns/basket", { method: "POST", body: " ".repeat(16385) }));
    expect(response.status).toBe(413); expect(owner.open).not.toHaveBeenCalled();
  });
  it.each([
    { symbols: ["NVDA", "../AMD"] }, { symbols: ["NVDA", "NVDA"] },
    { symbols: ["NVDA"] }, { horizon: 7 }, { membershipAsOf: "2026-02-30" },
    { membershipAsOf: "2027-01-01" }, { through: "2026-10-19" },
  ])("rejects invalid membership or cutoff before file access: %j", async change => {
    expect((await basket({ ...input(), ...change })).status).toBe(400); expect(owner.open).not.toHaveBeenCalled();
  });
  it("does not drop an unavailable member or reweight survivors", async () => {
    owner.files.delete("AMD.json"); const response = await basket(input());
    expect(await response.json()).toMatchObject({ status: "incomplete", missing: ["AMD"] });
    expect(owner.closes).toContain("NVDA.json");
  });
  it("keeps request order, closes handles, and does not cache a private basket", async () => {
    const response = await basket({ ...input(), symbols: ["AMD", "NVDA"] });
    const result = await response.json();
    expect(result.status).toBe("ready"); expect(result.series.composite.members).toEqual(["AMD", "NVDA"]);
    expect(result.series.quality).toBe("unverified"); expect(owner.closes.sort()).toEqual(["AMD.json", "NVDA.json"]);
    expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("vary")).toBe("Cookie");
  });
  it("closes an oversized file without reading its body", async () => {
    const read = vi.fn(), close = vi.fn();
    owner.open.mockResolvedValue({ stat: async () => ({ isFile: () => true, size: 3 * 1024 * 1024 }), readFile: read, close });
    const response = await basket(input()); expect((await response.json()).status).toBe("incomplete");
    expect(read).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledTimes(2);
  });
  it("does not substitute seasonal win rates when Returns probabilities are absent", async () => {
    owner.files.set("NVDA.seasonal.json", { schema: "mastermind.seasonal_outlook/v1", symbol: "NVDA", win_rate: 0.99 });
    const response = await forecast(); expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ status: "abstain", reasons: ["QUALIFIED_FORECAST_NOT_PUBLISHED"] });
  });
  it("rejects a wrong artifact owner and non-session request", async () => {
    owner.files.set("NVDA.seasonal.json", { schema: "mastermind.seasonal_outlook/v1", symbol: "AMD", returns_forecasts: [] });
    expect(await (await forecast()).json()).toMatchObject({ status: "abstain", reasons: ["CONTEXT_MISMATCH"] });
    expect((await forecast("symbol=NVDA&asOf=2026-10-11&horizon=21")).status).toBe(400);
  });
  it("rejects ambiguous prediction vintages instead of choosing one arbitrarily", async () => {
    const c = { symbol: "NVDA", asOf: "2026-10-16", horizon: 21 };
    owner.files.set("NVDA.seasonal.json", { schema: "mastermind.seasonal_outlook/v1", symbol: "NVDA", returns_forecasts: [c, c] });
    expect(await (await forecast()).json()).toMatchObject({ status: "abstain", reasons: ["AMBIGUOUS_FORECAST_VINTAGE"] });
  });
});
