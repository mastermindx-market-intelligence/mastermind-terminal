import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchHubOvernightWallDate } from "../overnightHistory";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Terminal overnight history proxy", () => {
  it("calls only the loopback Quote Hub contract and accepts finite Bar6 rows", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.hostname).toBe("127.0.0.1");
      expect(url.pathname).toBe("/overnight-bars");
      expect(url.searchParams.get("symbol")).toBe("AAPL");
      expect(url.searchParams.get("date")).toBe("2026-10-14");
      expect(url.searchParams.get("tf")).toBe("1h");
      expect(init?.headers).toBeUndefined();
      return new Response(JSON.stringify({
        status: "available",
        source: "alpaca-boats",
        bars: [
          [Date.UTC(2026, 9, 14, 2) / 1000, 100, 102, 99, 101, 42],
          ["bad", 1, 2, 3, 4, 5],
        ],
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchHubOvernightWallDate("AAPL", "1h", "2026-10-14");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("available");
    expect(result.source).toBe("alpaca-boats");
    expect(result.bars).toEqual([
      [Date.UTC(2026, 9, 14, 2) / 1000, 100, 102, 99, 101, 42],
    ]);
  });

  it("fails soft on Hub transport and malformed payloads", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("hub offline"); }));
    await expect(fetchHubOvernightWallDate("AAPL", "1h", "2026-10-14")).resolves.toMatchObject({
      status: "unavailable",
      bars: [],
    });

    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    await expect(fetchHubOvernightWallDate("AAPL", "1h", "2026-10-14")).resolves.toMatchObject({
      status: "unavailable",
      bars: [],
    });
  });

  it("preserves Hub coverage states without estimating data", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      status: "not_configured",
      source: "alpaca-boats",
      bars: [],
      note: "Alpaca overnight credentials are not configured on Quote Hub",
    }), { status: 200 })));

    await expect(fetchHubOvernightWallDate("AAPL", "1h", "2026-10-14")).resolves.toEqual({
      status: "not_configured",
      source: "alpaca-boats",
      bars: [],
      note: "Alpaca overnight credentials are not configured on Quote Hub",
    });
  });
});
