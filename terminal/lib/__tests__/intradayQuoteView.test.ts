import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchQuotes } from "../intradaySources";

const quote = {
  sym: "NVDA", last: 100, prevClose: 99, chg: 1.0101,
  open: 99, high: 101, low: 98, vol: 1, amount: 100,
  ts: 1, live: false, source: "test", market: "us", basis: "DELAYED_15M",
};

afterEach(() => { vi.unstubAllGlobals(); });

describe("fetchQuotes Quote Hub projection", () => {
  it("adds view=regular when the caller requests the regular-only plane", async () => {
    const fetchSpy = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args;
      return new Response(JSON.stringify({ NVDA: quote }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    await fetchQuotes(["NVDA"], { view: "regular" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = String(fetchSpy.mock.calls[0][0]);
    expect(new URL(url).searchParams.get("view")).toBe("regular");
  });

  it("keeps the default/full request backward-compatible", async () => {
    const fetchSpy = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args;
      return new Response(JSON.stringify({ NVDA: quote }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    await fetchQuotes(["NVDA"]);

    const url = String(fetchSpy.mock.calls[0][0]);
    expect(new URL(url).searchParams.has("view")).toBe(false);
  });
});
