import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchUsEquityDateStudyBars } from "../intradaySources";

const originalPolygon = process.env.POLYGON_API_KEY;
const originalMassive = process.env.MASSIVE_API_KEY;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalPolygon == null) delete process.env.POLYGON_API_KEY;
  else process.env.POLYGON_API_KEY = originalPolygon;
  if (originalMassive == null) delete process.env.MASSIVE_API_KEY;
  else process.env.MASSIVE_API_KEY = originalMassive;
});

describe("date-scoped U.S. equity session studies", () => {
  it("requests exactly one date at a boundary-safe 30-minute grain", async () => {
    process.env.POLYGON_API_KEY = "test-key";
    delete process.env.MASSIVE_API_KEY;
    let captured = "";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      captured = String(input);
      return new Response(JSON.stringify({
        results: [
          // 04:00 ET, accepted premarket.
          { t: Date.UTC(2026, 9, 14, 8, 0), o: 100, h: 101, l: 99, c: 100.5, v: 10 },
          // 09:30 ET, exact RTH boundary.
          { t: Date.UTC(2026, 9, 14, 13, 30), o: 101, h: 104, l: 100.5, c: 103, v: 20 },
          // 16:00 ET, accepted postmarket.
          { t: Date.UTC(2026, 9, 14, 20, 0), o: 103, h: 105, l: 102.5, c: 104, v: 30 },
          // 20:00 ET is outside Massive's extended owner and must be excluded.
          { t: Date.UTC(2026, 9, 15, 0, 0), o: 104, h: 106, l: 103, c: 105, v: 40 },
        ],
      }), { status: 200 });
    }));

    const bars = await fetchUsEquityDateStudyBars("AAPL", "30m", true, "2026-10-14");
    const url = new URL(captured);
    expect(url.pathname).toContain("/range/30/minute/2026-10-14/2026-10-14");
    expect(url.searchParams.get("adjusted")).toBe("true");
    expect(url.searchParams.get("sort")).toBe("asc");
    expect(bars.map((bar) => new Date(bar[0] * 1000).toISOString().slice(11, 16))).toEqual([
      "04:00",
      "09:30",
      "16:00",
    ]);
  });

  it("keeps the historical study on the canonical Massive lane and rejects non-U.S. symbols", async () => {
    process.env.POLYGON_API_KEY = "test-key";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchUsEquityDateStudyBars("0700.HK", "30m", true, "2026-10-14")).resolves.toEqual([]);
    await expect(fetchUsEquityDateStudyBars("BTC-USD", "30m", true, "2026-10-14")).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails loudly to the route when the provider is rate limited", async () => {
    process.env.POLYGON_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 429 })));
    await expect(fetchUsEquityDateStudyBars("AAPL", "30m", true, "2026-10-14"))
      .rejects.toThrow("polygon rate-limited");
  });
});
