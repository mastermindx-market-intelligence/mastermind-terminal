// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, StrictMode } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import ScreenerView from "@/components/ScreenerView";
import type { CacheOutcome, GetOpts, Revalidation } from "@/lib/dataCache";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ get: vi.fn(), invalidate: vi.fn() }));
vi.mock("@/lib/dataCache", () => ({ getJSONResult: h.get, invalidate: h.invalidate }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: "en" }), useT: () => (key: string) => key }));
vi.mock("@/lib/useMarketPrefs", () => ({ useMarketPrefs: () => ({ prefs: { enabled: [] }, ready: false }) }));
vi.mock("@/lib/flowClientCache", () => ({ flowGet: async () => null }));
// Keep this suite focused on manifest SWR; classification has independent adoption tests.
vi.mock("@/lib/useClassificationScan", () => ({ useClassificationScan: () => ({ source: { kind: "absent" }, retry: vi.fn() }) }));
vi.mock("@/components/AssetLogo", () => ({ default: () => null }));
vi.mock("@/components/screener/SmartScreensPanel", () => ({ default: () => null }));

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
const manifest = (sym: string) => ({ as_of: sym, symbols: { [sym]: { last: 111, chg: 4, vol: 1000, sec: "Equities", mkt: "NASDAQ" } } });
const old = manifest("OLD"), fresh = manifest("FRESH");
const stale = (revalidation: Promise<Revalidation>): CacheOutcome => ({ status: "data", data: old, stale: { ageMs: 3600000, source: "disk", revalidation } });
const mount = () => render(<ScreenerView identity={{ kind: "guest" }} />);
const settle = async (fn: () => void = () => {}) => { await act(async () => { fn(); }); };

beforeEach(() => {
  h.get.mockReset(); h.invalidate.mockReset();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("StrictMode's discarded setup does not own the cached scan's background refresh", async () => {
  h.get.mockResolvedValue({ status: "data", data: old });
  render(<StrictMode><ScreenerView identity={{ kind: "guest" }} /></StrictMode>);
  await settle();
  expect(h.get).toHaveBeenCalledTimes(1);
});

it("retains the old scan and exposes Retry when its background refresh fails", async () => {
  const refresh = deferred<Revalidation>(); h.get.mockResolvedValue(stale(refresh.promise));
  const view = mount(); await settle();
  expect(view.container.querySelector(".sym-cell")?.textContent).toContain("OLD");
  expect(view.container.querySelector("[data-scr-refresh]")).toBeNull();
  await settle(() => refresh.resolve("failed"));
  expect(view.container.querySelector("[data-scr-refresh]")?.textContent).toContain("admStale");
  expect(view.container.querySelector(".sym-cell")?.textContent).toContain("OLD");
  h.get.mockResolvedValue({ status: "data", data: fresh });
  await settle(() => fireEvent.click(view.container.querySelector("[data-scr-refresh] button")!));
  expect(h.invalidate).toHaveBeenCalledWith("/data/manifest.json");
  expect(view.container.querySelector(".sym-cell")?.textContent).toContain("FRESH");
  expect(view.container.querySelector("[data-scr-refresh]")).toBeNull();
});

it("accepts a valid refreshed scan without labelling it failed", async () => {
  const refresh = deferred<Revalidation>(); h.get.mockResolvedValue(stale(refresh.promise));
  const view = mount(); await settle();
  const opts = h.get.mock.calls[0][1] as GetOpts;
  await settle(() => { opts.onRevalidate?.(fresh); refresh.resolve("ok"); });
  expect(view.container.querySelector(".sym-cell")?.textContent).toContain("FRESH");
  expect(view.container.querySelector("[data-scr-refresh]")).toBeNull();
});

it("does not treat successful JSON transport with an invalid manifest as a successful refresh", async () => {
  const refresh = deferred<Revalidation>(); h.get.mockResolvedValue(stale(refresh.promise));
  const view = mount(); await settle();
  const opts = h.get.mock.calls[0][1] as GetOpts;
  await settle(() => { opts.onRevalidate?.({ symbols: [] }); refresh.resolve("ok"); });
  expect(view.container.querySelector(".sym-cell")?.textContent).toContain("OLD");
  expect(view.container.querySelector("[data-scr-refresh]")?.textContent).toContain("admStale");
});

it("a refresh already delivered before the stale promise resumes cannot be overwritten by the old scan", async () => {
  const initial = deferred<CacheOutcome>(); h.get.mockReturnValue(initial.promise);
  const view = mount(); await settle(); const opts = h.get.mock.calls[0][1] as GetOpts;
  await settle(() => { opts.onRevalidate?.(fresh); initial.resolve(stale(Promise.resolve("ok"))); });
  expect(view.container.querySelector(".sym-cell")?.textContent).toContain("FRESH");
  expect(view.container.querySelector("[data-scr-refresh]")).toBeNull();
});

it("a superseded refresh does not label the scan as a failed request", async () => {
  const refresh = deferred<Revalidation>(); h.get.mockResolvedValue(stale(refresh.promise));
  const view = mount(); await settle(); await settle(() => refresh.resolve("superseded"));
  expect(view.container.querySelector("[data-scr-refresh]")).toBeNull();
});

it("an unmounted consumer cannot contaminate a newly mounted scan with its late refresh", async () => {
  const refresh = deferred<Revalidation>(); h.get.mockResolvedValueOnce(stale(refresh.promise));
  const previous = mount(); await settle(); const oldOpts = h.get.mock.calls[0][1] as GetOpts;
  previous.unmount(); h.get.mockResolvedValue({ status: "data", data: fresh });
  const current = mount(); await settle();
  await settle(() => { oldOpts.onRevalidate?.(old); refresh.resolve("failed"); });
  expect(current.container.querySelector(".sym-cell")?.textContent).toContain("FRESH");
  expect(current.container.querySelector("[data-scr-refresh]")).toBeNull();
});
