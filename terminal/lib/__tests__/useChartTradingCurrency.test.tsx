// @vitest-environment jsdom
// B1 — useChartTradingCurrency: the frame-bar chip's currency read through the
// INCUMBENT fund document. Only getFund is stubbed (vi.mock); tradingCurrencyFor and
// the analysis-symbol grammar run for real, so the canonical-form precheck, the exact
// ticker gate and the quote_currency shape gate are exercised, not mirrored.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useChartTradingCurrency } from "@/lib/useChartTradingCurrency";
import { getFund } from "@/lib/fund";

vi.mock("@/lib/fund", () => ({ getFund: vi.fn() }));

const getFundMock = vi.mocked(getFund);

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function deferred(): { promise: Promise<unknown>; resolve: (v: unknown) => void; reject: (e?: unknown) => void } {
  let resolve!: (v: unknown) => void;
  let reject!: (e?: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// The fund shape mirrors the real /data/<SYM>.fund.json producer (Fund interface in
// lib/fund.ts): ticker + quote_currency carry the trading answer, stmt_currency is the
// financial-reporting currency and must stay unreachable.
const fund = (ticker: string, quote_currency: string | undefined, stmt_currency: string | null = "CNY") =>
  ({ schema: "mastermind.fund/v1", ticker, quote_currency, stmt_currency });

function Probe({ symbol, dataReady }: { symbol: string; dataReady: boolean }) {
  const ccy = useChartTradingCurrency(symbol, dataReady);
  return <span data-testid="ccy">{ccy === null ? "null" : ccy}</span>;
}

let roots: Root[] = [];
function harness() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  const show = (symbol: string, dataReady = true) => {
    act(() => { root.render(<Probe symbol={symbol} dataReady={dataReady} />); });
  };
  return {
    host,
    show,
    unmount: () => act(() => { root.unmount(); }),
    text: () => host.querySelector<HTMLElement>('[data-testid="ccy"]')?.textContent ?? "",
  };
}
afterEach(() => {
  for (const root of roots) act(() => { root.unmount(); });
  roots = [];
  document.body.innerHTML = "";
  getFundMock.mockReset();
});

describe("useChartTradingCurrency", () => {
  it("mounted ready pane resolves BABA's USD trading currency; the CNY statement currency is ignored", async () => {
    const d = deferred();
    getFundMock.mockReturnValue(d.promise as Promise<never>);
    const h = harness();
    h.show("BABA");
    // Nothing until the read settles — the chip says unknown, and exactly one read started.
    expect(h.text()).toBe("null");
    expect(getFundMock).toHaveBeenCalledTimes(1);
    expect(getFundMock).toHaveBeenCalledWith("BABA");

    await act(async () => { d.resolve(fund("BABA", "USD", "CNY")); });
    expect(h.text()).toBe("USD");
    // The statement currency never surfaces, even though the row carried it.
    expect(h.text()).not.toBe("CNY");
  });

  it("9988.HK resolves HKD through the same incumbent read path", async () => {
    const d = deferred();
    getFundMock.mockReturnValue(d.promise as Promise<never>);
    const h = harness();
    h.show("9988.HK");
    await act(async () => { d.resolve(fund("9988.HK", "HKD")); });
    expect(h.text()).toBe("HKD");
    expect(getFundMock).toHaveBeenCalledWith("9988.HK");
  });

  it("a row whose ticker is not exactly the requested symbol answers null", async () => {
    const d = deferred();
    getFundMock.mockReturnValue(d.promise as Promise<never>);
    const h = harness();
    h.show("9988.HK");
    // A stale BABA row can never answer for 9988.HK (and vice versa).
    await act(async () => { d.resolve(fund("BABA", "USD")); });
    expect(h.text()).toBe("null");
  });

  it("missing or malformed quote_currency answers null, never a suffix guess", async () => {
    for (const quote of [undefined, "usd", "USDD", "US", ""]) {
      const d = deferred();
      getFundMock.mockReturnValue(d.promise as Promise<never>);
      const h = harness();
      h.show("BABA");
      await act(async () => { d.resolve(fund("BABA", quote)); });
      expect(h.text()).toBe("null");
    }
  });

  it("a rejected read answers null and the chip stays explicit about it", async () => {
    const d = deferred();
    getFundMock.mockReturnValue(d.promise as Promise<never>);
    const h = harness();
    h.show("BABA");
    await act(async () => { d.reject(new Error("network gone")); });
    expect(h.text()).toBe("null");
  });

  it("a late promise for an OLD symbol can never repaint the new symbol's chip", async () => {
    const first = deferred();
    const second = deferred();
    getFundMock.mockReturnValueOnce(first.promise as Promise<never>).mockReturnValueOnce(second.promise as Promise<never>);
    const h = harness();
    h.show("BABA");
    h.show("9988.HK");
    // The BABA read settles while 9988.HK is mounted.
    await act(async () => { first.resolve(fund("BABA", "USD")); });
    expect(h.text()).toBe("null");
    // Only 9988.HK's own read paints.
    await act(async () => { second.resolve(fund("9988.HK", "HKD")); });
    expect(h.text()).toBe("HKD");
  });

  it("swapping back to a symbol repaints from that symbol's own read, not the stale one", async () => {
    const first = deferred();
    const second = deferred();
    // One read per effect run; in production getFund's own cache dedupes the BABA re-read.
    const third = deferred();
    getFundMock
      .mockReturnValueOnce(first.promise as Promise<never>)
      .mockReturnValueOnce(second.promise as Promise<never>)
      .mockReturnValueOnce(third.promise as Promise<never>);
    const h = harness();
    h.show("BABA");
    h.show("9988.HK");
    h.show("BABA");
    // The 9988.HK read settles while BABA is mounted again: it must stay invisible.
    await act(async () => { second.resolve(fund("9988.HK", "HKD")); });
    expect(h.text()).toBe("null");
    // BABA's own read paints.
    await act(async () => { third.resolve(fund("BABA", "USD")); });
    expect(h.text()).toBe("USD");
  });

  it("unmount cancels: a read settling after teardown stores nothing and throws nothing", async () => {
    const d = deferred();
    getFundMock.mockReturnValue(d.promise as Promise<never>);
    const h = harness();
    h.show("BABA");
    h.unmount();
    expect(getFundMock).toHaveBeenCalledTimes(1);
    await act(async () => { d.resolve(fund("BABA", "USD")); });
    expect(document.querySelector('[data-testid="ccy"]')).toBe(null);
  });

  it("dataReady=false defers the read entirely", () => {
    const h = harness();
    h.show("BABA", false);
    expect(getFundMock).not.toHaveBeenCalled();
    expect(h.text()).toBe("null");

    // Going ready starts exactly one read.
    const d = deferred();
    getFundMock.mockReturnValue(d.promise as Promise<never>);
    h.show("BABA", true);
    expect(getFundMock).toHaveBeenCalledTimes(1);
  });

  it("a stored answer goes dark the moment dataReady drops, without waiting for an effect", async () => {
    const d = deferred();
    getFundMock.mockReturnValue(d.promise as Promise<never>);
    const h = harness();
    h.show("BABA");
    await act(async () => { d.resolve(fund("BABA", "USD")); });
    expect(h.text()).toBe("USD");
    h.show("BABA", false);
    expect(h.text()).toBe("null");
  });

  it.each(["baba", " baba", "BABA ", "BABA+9988.HK", "BABA/9988", "", "9988.hk"])(
    "non-canonical symbol %j never fetches",
    (bad) => {
      const h = harness();
      h.show(bad);
      expect(getFundMock).not.toHaveBeenCalled();
      expect(h.text()).toBe("null");
    },
  );
});
