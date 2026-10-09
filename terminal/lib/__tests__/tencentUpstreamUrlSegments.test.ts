import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchIntraday, fetchQuotes, tencentKlineUrl, tencentQuoteUrl } from "@/lib/intradaySources";

/**
 * Every Tencent code, and the kline scale, that reaches an upstream URL stays inert text.
 *
 * tencentCode is the first layer: it only returns "sh"/"sz" plus digits for an A-share and "hk"
 * plus five digits for Hong Kong. The URL builders are the second. A code that got past a looser
 * rule must not be able to add a query parameter, a fragment or a path step to the request the
 * server makes on the reader's behalf (CodeQL js/request-forgery on the upstream fetch).
 */

const QUOTE = "https://qt.gtimg.cn/q=";
const KLINE = "https://ifzq.gtimg.cn/appstock/app/kline/mkline?param=";

/** One code of each shape tencentCode emits: Shanghai, Shenzhen, Hong Kong. */
const REAL = ["sh600547", "sz000001", "hk00700"];
/** The native mkline scales fetchTencent asks for. */
const SCALES = ["m1", "m5", "m15", "m30", "m60"];

/** Adds a query parameter and a fragment if it is interpolated raw. */
const HOSTILE = "sh600547&x=1#y";

/** Each one changes the quote request if interpolated raw: a fragment, a query, a step up. */
const HOSTILE_QUOTE_CODES = [HOSTILE, "sh600547?x=1", "sh600547/../admin"];

afterEach(() => { vi.unstubAllGlobals(); });

function stubFetch(body: string) {
  const fetchSpy = vi.fn(async (...args: Parameters<typeof fetch>) => {
    void args;
    return new Response(body, { status: 200 });
  });
  vi.stubGlobal("fetch", fetchSpy);
  return () => fetchSpy.mock.calls.map((call) => String(call[0]));
}

describe("Tencent upstream URLs keep each code inside its own piece", () => {
  it("builds today's exact URLs for every real code", () => {
    expect(tencentQuoteUrl(REAL)).toBe("https://qt.gtimg.cn/q=sh600547,sz000001,hk00700");
    expect(tencentQuoteUrl(["hk00700"])).toBe("https://qt.gtimg.cn/q=hk00700");
    expect(tencentKlineUrl("sh600547", "m1"))
      .toBe("https://ifzq.gtimg.cn/appstock/app/kline/mkline?param=sh600547,m1,,640");
    expect(tencentKlineUrl("sz000001", "m5"))
      .toBe("https://ifzq.gtimg.cn/appstock/app/kline/mkline?param=sz000001,m5,,640");
    expect(tencentKlineUrl("hk00700", "m60"))
      .toBe("https://ifzq.gtimg.cn/appstock/app/kline/mkline?param=hk00700,m60,,640");
    // Encoding is the identity for every real code and scale: nothing is escaped.
    for (const code of REAL) {
      for (const scale of SCALES) expect(tencentKlineUrl(code, scale)).not.toContain("%");
    }
    expect(tencentQuoteUrl(REAL)).not.toContain("%");
  });

  it("sends today's exact quote request upstream for real symbols", async () => {
    const urls = stubFetch("");
    await fetchQuotes(["600547.SS", "000001.SZ", "0700.HK"]);
    expect(urls()).toEqual(["https://qt.gtimg.cn/q=sh600547,sz000001,hk00700"]);
  });

  it("sends today's exact kline requests upstream for real symbols", async () => {
    const urls = stubFetch("{}");
    await fetchIntraday("600547.SS", "5m", false);
    await fetchIntraday("000001.SZ", "1h", false);
    expect(urls()).toEqual([
      "https://ifzq.gtimg.cn/appstock/app/kline/mkline?param=sh600547,m5,,640",
      "https://ifzq.gtimg.cn/appstock/app/kline/mkline?param=sz000001,m60,,640",
    ]);
  });

  it("never lets a quote code add a query, a fragment or a path step", () => {
    for (const bad of HOSTILE_QUOTE_CODES) {
      const u = new URL(tencentQuoteUrl(["sz000001", bad, "hk00700"]));
      expect(u.search, bad).toBe("");
      expect(u.hash, bad).toBe("");
      // Still the one q= segment, still three comma-separated codes, the hostile one intact.
      expect(u.pathname.split("/"), bad).toHaveLength(2);
      expect(u.pathname.startsWith("/q=sz000001,"), bad).toBe(true);
      const codes = u.pathname.slice("/q=".length).split(",");
      expect(codes, bad).toHaveLength(3);
      expect(decodeURIComponent(codes[1]), bad).toBe(bad);
    }
    expect(tencentQuoteUrl([HOSTILE])).toBe(QUOTE + "sh600547%26x%3D1%23y");
  });

  it("never lets the code or the scale add a query parameter or a fragment to a kline request", () => {
    for (const [code, scale] of [[HOSTILE, "m1"], ["sh600547", "m1&x=1#y"]]) {
      const u = new URL(tencentKlineUrl(code, scale));
      expect(u.pathname).toBe("/appstock/app/kline/mkline");
      expect([...u.searchParams.keys()], `${code} ${scale}`).toEqual(["param"]);
      expect(u.searchParams.get("param")).toBe(`${code},${scale},,640`);
      expect(u.hash, `${code} ${scale}`).toBe("");
    }
    expect(tencentKlineUrl(HOSTILE, "m1")).toBe(KLINE + "sh600547%26x%3D1%23y,m1,,640");
  });
});
