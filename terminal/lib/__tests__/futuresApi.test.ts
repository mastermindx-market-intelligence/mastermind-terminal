import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/entitlement", () => ({ hasLiveOptions: vi.fn() }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: vi.fn(() => ({ ok: true })), tooMany: () => new Response("limited", { status: 429 }) }));
vi.mock("@/lib/futuresSourceRead", () => ({ readFuturesSource: vi.fn() }));
import { GET } from "../../app/api/futures/route";
import { hasLiveOptions } from "../entitlement";
import { readFuturesSource } from "../futuresSourceRead";
import { rateLimit } from "../rateLimit";
import { joinFuturesSource } from "../futuresSourceJoin";
import { DEFAULT_FUTURES_REQUEST } from "../futuresRequest";
import { sourceFixture, fixtureNow } from "./fixtures/futuresSourceFixture";
const ask = (query = "pair=ES") => GET(new Request(`http://127.0.0.1/api/futures?${query}`));
beforeEach(() => { vi.clearAllMocks(); vi.mocked(hasLiveOptions).mockResolvedValue(true);
  vi.mocked(rateLimit).mockReturnValue({ ok: true } as never);
  vi.mocked(readFuturesSource).mockResolvedValue(joinFuturesSource(sourceFixture(), DEFAULT_FUTURES_REQUEST, fixtureNow)); });
afterEach(() => vi.unstubAllEnvs());
describe("futures API uses existing entitlement before any upstream source", () => {
  it("authorized response is private and source-validated", async () => {
    const response = await ask(); expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await response.json()).frames).toHaveLength(24);
  });
  for (const environment of ["development", "production"]) it(`fixture flags cannot bypass data access in ${environment}`, async () => {
    vi.stubEnv("NODE_ENV", environment); vi.stubEnv("FLOW_FIXTURE", "1"); vi.stubEnv("TERMINAL_E2E_FIXTURE", "1");
    vi.mocked(hasLiveOptions).mockResolvedValue(false); const response = await ask();
    expect(response.status).toBe(403); expect(readFuturesSource).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("authority errors refuse data rather than turning into open guest mode", async () => {
    vi.mocked(hasLiveOptions).mockRejectedValue(Error("authority down")); expect((await ask()).status).toBe(403);
    expect(readFuturesSource).not.toHaveBeenCalled();
  });
  it("checks access again after a prior successful read", async () => {
    expect((await ask()).status).toBe(200); vi.mocked(hasLiveOptions).mockResolvedValue(false);
    expect((await ask()).status).toBe(403); expect(readFuturesSource).toHaveBeenCalledTimes(1);
  });
  for (const query of ["pair=ES&pair=NQ", "pair=CL", "pair=ES&url=https://other", "rows=3", "at=NaN"])
    it(`rejects invalid ${query} without source access`, async () => {
      expect((await ask(query)).status).toBe(400); expect(readFuturesSource).not.toHaveBeenCalled();
    });
  for (const reason of ["source_unavailable", "source_restricted", "source_invalid", "no_replay_frame", "stale_source"] as const)
    it(`does not mask ${reason} as empty healthy data`, async () => {
      vi.mocked(readFuturesSource).mockResolvedValue({ status: "unavailable", reason }); const response = await ask();
      expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: reason });
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    });
  it("unexpected source failures do not expose upstream exception strings", async () => {
    vi.mocked(readFuturesSource).mockRejectedValue(Error("internal secret path")); const response = await ask();
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("secret");
  });
  it("rate-limited errors also cannot be cached", async () => {
    vi.mocked(rateLimit).mockReturnValue({ ok: false } as never); const response = await ask();
    expect(response.status).toBe(429); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(hasLiveOptions).not.toHaveBeenCalled(); expect(readFuturesSource).not.toHaveBeenCalled();
  });
});
