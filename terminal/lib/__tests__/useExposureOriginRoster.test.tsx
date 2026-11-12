// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useExposureOriginRoster, type ExposureOriginRoster } from "@/components/exposure-map/useExposureOriginRoster";
import type { ExposureOrigin } from "@/lib/exposureOrigin";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const origin: ExposureOrigin = {
  v: 1, kind: "sector", returnHref: "/discover?tab=sectors&sector=technology&group=semiconductors&sectorSort=return&sectorCompany=MSFT",
  sector: "technology", group: "semiconductors", company: "MSFT", index: 1, count: 3, sort: "return", query: "",
  asOf: "2026-10-20", contentHash: "hash12345678", method: "incumbent_rs_63_21/v1", benchmark: "SPY",
};
const body = {
  ok: true,
  receipt: { source: "confluence", status: "ready", asOf: "2026-10-20", contentHash: "hash12345678" },
  data: {
    ok: true,
    subsectors: [{ key: "semiconductors", label: "Semiconductors", members: [{ ticker: "NVDA", ret_20d: 3.1 }, { ticker: "AAPL", ret_20d: 1.2 }, { ticker: "MSFT", ret_20d: 2.4 }] }],
    sectors: [],
  },
};
const bodyWith = (patch: Record<string, unknown>) => ({ ...body, receipt: { ...body.receipt, ...patch } });

let container: HTMLDivElement;
let root: Root;

function Probe({ origin: value }: { origin: ExposureOrigin | null }) {
  const roster = useExposureOriginRoster(value);
  return <output data-testid="roster">{JSON.stringify(roster)}</output>;
}

const latest = (): ExposureOriginRoster => JSON.parse(document.querySelector('[data-testid="roster"]')!.textContent!) as ExposureOriginRoster;

function mount(originValue: ExposureOrigin | null, response: unknown = { ok: true, json: async () => body }): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root.render(<Probe origin={originValue} />); });
  return fetchMock;
}

const settle = async () => {
  for (let at = 0; at < 10 && latest().state === "loading"; at += 1) await act(async () => {});
};

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("useExposureOriginRoster", () => {
  it("returns exact with the sorted roster when the confluence receipt hash matches", async () => {
    const fetchMock = mount(origin);
    await settle();
    expect(latest()).toEqual({
      state: "exact", tickers: ["NVDA", "MSFT", "AAPL"], asOf: "2026-10-20", contentHash: "hash12345678", groupLabel: "Semiconductors",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/sector-intelligence?source=confluence");
    expect(init.cache).toBe("no-store");
    expect(init.credentials).toBe("same-origin");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns changed when the receipt hash differs", async () => {
    mount(origin, { ok: true, json: async () => bodyWith({ contentHash: "other1234567" }) });
    await settle();
    expect(latest().state).toBe("changed");
    expect(latest().tickers).toEqual(["NVDA", "MSFT", "AAPL"]);
    expect(latest().contentHash).toBe("other1234567");
  });

  it("returns unavailable on a non-ready receipt, on a network error, and for a null origin without fetching", async () => {
    mount(origin, { ok: true, json: async () => bodyWith({ status: "loading" }) });
    await settle();
    expect(latest().state).toBe("unavailable");
    act(() => root.unmount());
    container.remove();

    mount(origin, { ok: true, json: async () => { throw new Error("offline"); } });
    await settle();
    expect(latest().state).toBe("unavailable");
    act(() => root.unmount());
    container.remove();

    mount(null);
    expect(latest().state).toBe("unavailable");
    expect(latest().tickers).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
