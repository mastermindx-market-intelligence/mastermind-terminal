// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Bar6 } from "../intradayShared";
import fixture from "./fixtures/exposure-native-qqq-observed-v2.json";
import ExposureMap from "@/components/exposure-map/ExposureMap";

const layout = vi.hoisted(() => ({ phone: false, lang: "en" }));
const daily = vi.hoisted(() => vi.fn());
vi.mock("@/lib/dataCache", async (original) => ({ ...await original<object>(), getOhlcView: daily }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: layout.lang }) }));
vi.mock("@/components/chrome/AppShell", () => ({ useShellIdentity: () => ({ kind: "guest" }) }));
vi.mock("@/components/researchlab/useResearchAppearance", () => ({ useResearchAppearance: () => {} }));
vi.mock("@/lib/useMediaQuery", () => ({ useIsPhone: () => layout.phone }));
vi.mock("@/lib/flowClientCache", () => ({ flowGetResult: async () => ({ kind: "unavailable" }) }));

const session = "2026-10-20";
const displayOpen = Date.parse(session + "T09:30Z") / 1000;
const bars: Bar6[] = Array.from({ length: 78 }, (_, i) => {
  const c = 100 + i * .05 + 5 * Math.sin(i / 4) * (1 - i / 300);
  return [displayOpen + i * 300, c, c + 1, c - 1, c, 1];
});
let host: HTMLDivElement, view: Root;
const fetchBars = vi.fn();
const response = (root: string, at = Date.now()) => Response.json({ t: root, tf: "5m", bars,
  source_evidence: { assembly_clock: { assembled_at: new Date(at).toISOString(), cache_state: "cache" } } });
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(session + "T19:59:50Z"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  layout.phone = false; layout.lang = "en";
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  daily.mockReset().mockResolvedValue({ status: "absent" });
  fetchBars.mockReset().mockImplementation(async () => response("QQQ"));
  vi.stubGlobal("fetch", fetchBars);
  host = document.createElement("div"); document.body.append(host); view = createRoot(host);
});
afterEach(() => { act(() => view.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function mount(root = "QQQ", archivedSession?: string, source = fixture, stale = false) {
  await act(async () => view.render(<ExposureMap root={root} source={source} matrix={null} archivedSession={archivedSession} stale={stale} />));
}
const panel = () => host.querySelector('[data-testid="exposure-divergence"]')!;
const button = (text: string) => [...host.querySelectorAll("button")].find(b => b.textContent === text)!;
const cell = () => panel().querySelector('[data-timeframe="5m"]')!;
const inspector = () => host.querySelector('[data-testid="exposure-node-inspector"]')!;

it("never promotes the captured 15:55 open bar on a timer tick", async () => {
  await mount();
  const latestClose = () => panel().querySelector("tbody tr td:last-child")?.textContent;
  expect(latestClose()).toContain("15:55 ET");
  await act(async () => vi.advanceTimersByTime(30_000));
  expect(latestClose()).toContain("15:55 ET");
});

it("withdraws the pre-close snapshot in both consumers until a fresh post-close read", async () => {
  await mount();
  await act(async () => button("Include hidden divergence").click());
  expect(cell().getAttribute("aria-label")).toContain("rsi14-w2-s60-v1");
  expect(cell().textContent).toMatch(/bars since confirmation/);
  expect(inspector().textContent).toContain("rsi14-w2-s60-v1");
  const row = () => [...panel().querySelectorAll("tbody tr")].find(tr => tr.firstChild?.textContent === "5m")!;
  expect(row().textContent).toContain("15:55 ET");
  await act(async () => vi.advanceTimersByTime(30_000));
  expect(row().textContent).toContain("15:55 ET");
  expect(cell().textContent).toContain("Stale bars");
  expect(inspector().textContent).toContain("Stale bars");
  expect(fetchBars).toHaveBeenCalledTimes(1);
  // A newly served response can itself be an assembly cached before the close.
  fetchBars.mockImplementationOnce(async () => response("QQQ", Date.parse(session + "T19:59:50Z")));
  await act(async () => button("Refresh price snapshot").click());
  expect(cell().textContent).toContain("Stale bars");
  await act(async () => button("Refresh price snapshot").click());
  expect(row().textContent).toContain("16:00 ET");
  expect(cell().textContent).toMatch(/bars since confirmation/);
});

it("explains a confirmed short-term divergence that opposes the leading net Gamma level", async () => {
  const conflict = "Confirmed bullish divergence conflicts with the leading net Gamma level below the snapshot spot.";
  const source = {
    ...fixture,
    exposure_projection: {
      ...fixture.exposure_projection,
      underlying_reference: { ...fixture.exposure_projection.underlying_reference, value: 160 },
    },
  };
  await mount();
  await act(async () => button("Include hidden divergence").click());
  expect(cell().textContent).toContain("Hidden bullish");
  expect(panel().textContent).not.toContain(conflict);

  await mount("QQQ", undefined, source);
  expect(panel().textContent).toContain(conflict);
  expect(inspector().textContent).toContain(conflict);

  await act(async () => (panel().querySelector('[data-timeframe="D"]') as HTMLButtonElement).click());
  expect(panel().textContent).not.toContain(conflict);
  await act(async () => (cell() as HTMLButtonElement).click());
  expect(panel().textContent).toContain(conflict);

  await mount("QQQ", undefined, source, true);
  expect(panel().textContent).not.toContain(conflict);
  await mount("QQQ", undefined, source);
  expect(panel().textContent).toContain(conflict);

  await act(async () => vi.advanceTimersByTime(30_000));
  expect(cell().textContent).toContain("Stale bars");
  expect(panel().textContent).not.toContain(conflict);
  expect(inspector().textContent).not.toContain(conflict);
  expect(fetchBars).toHaveBeenCalledTimes(1);
});

it("keeps underlying momentum across expiry selection, withdraws it in archive and rejects a late old-root response", async () => {
  await mount();
  await act(async () => button("Include hidden divergence").click());
  const previous = cell().textContent;
  const select = host.querySelector("select")!;
  await act(async () => { select.value = "zero"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(cell().textContent).toBe(previous);
  expect(fetchBars).toHaveBeenCalledTimes(1);
  let settle!: (response: Response) => void;
  fetchBars.mockImplementationOnce(() => new Promise<Response>(resolve => { settle = resolve; }));
  await act(async () => button("Refresh price snapshot").click());
  expect(cell().textContent).toContain("Unavailable");
  await mount("QQQ", "2026-10-19");
  expect(panel()).toBeNull();
  expect(inspector().textContent).not.toContain("rsi14-w2-s60-v1");
  fetchBars.mockResolvedValueOnce(Response.json({ t: "SPY", tf: "5m", bars: [] }));
  await mount("SPY");
  await act(async () => settle(response("QQQ")));
  expect(inspector().textContent).toContain("SPY · 5m");
  expect(cell().textContent).toContain("Unavailable");
  expect(inspector().textContent).not.toContain("bars since confirmation");
  await mount("QQQ");
  expect(inspector().textContent).toContain("QQQ · 5m");
  expect(fetchBars).toHaveBeenCalledTimes(4);
});

it("reopens the phone node inspector on the current chart timeframe using the same snapshot", async () => {
  layout.phone = true;
  await mount();
  await act(async () => vi.advanceTimersByTime(16));
  const selectStrike = () => [...host.querySelectorAll("button")].find(b => b.textContent?.startsWith("Provisional net leader159"))!;
  const sheet = () => document.body.querySelector('[data-testid="exposure-node-inspector"]');
  await act(async () => selectStrike().click());
  expect(sheet()?.textContent).toContain("QQQ · 5m");
  await act(async () => [...sheet()!.querySelectorAll("button")].find(b => b.textContent === "Close inspector")!.click());
  expect(sheet()).toBeNull();
  await act(async () => (panel().querySelector('[data-timeframe="30m"]') as HTMLButtonElement).click());
  await act(async () => selectStrike().click());
  expect(sheet()?.textContent).toContain("QQQ · 30m");
  expect(sheet()?.textContent).not.toContain("QQQ · 5m");
  expect(fetchBars).toHaveBeenCalledTimes(1);
});


it("renders the same profile and confirmation age in Chinese in the chart and inspector", async () => {
  layout.lang = "zh";
  await mount();
  await act(async () => button("包含隐藏背离").click());
  expect(cell().getAttribute("aria-label")).toMatch(/根 K 线前确认.*rsi14-w2-s60-v1 · 常规与隐藏背离/);
  expect(inspector().textContent).toContain("确认时间 / 距今 K 线数");
  expect(inspector().textContent).not.toContain("Regular and hidden");
});

it("binds daily and weekly closes to the cached observation across refresh and reopen", async () => {
  const cache = await vi.importActual<typeof import("../dataCache")>("../dataCache");
  cache.invalidate();
  daily.mockImplementation(cache.getOhlcView);
  const days = [12, 13, 14, 15, 16, 19, 20, 21, 22, 23];
  const prices = days.map(d => [`2026-10-${d}`, 100, 102, 98, 101, 5]);
  const beforeClose = Date.parse("2026-10-23T19:59:50Z");
  vi.setSystemTime(beforeClose);
  let dailyRequests = 0;
  let versionTime = beforeClose;
  fetchBars.mockImplementation(async (url: string) => {
    if (url.includes("/api/intraday")) return Response.json({ t: "QQQ", tf: "5m", bars: [] });
    dailyRequests++;
    return Response.json({ t: "QQQ", bars: prices }, { headers: { "last-modified": new Date(versionTime).toUTCString() } });
  });
  await mount();
  const closes = () => ["D", "W"].map(frame => [...panel().querySelectorAll("tbody tr")]
    .find(row => row.firstChild?.textContent === frame)?.lastChild?.textContent);
  expect(closes()).toEqual(["2026-10-22 16:00 ET", "2026-10-16 16:00 ET"]);
  await act(async () => vi.advanceTimersByTime(20_000));
  await act(async () => button("Refresh price snapshot").click());
  await mount("QQQ", "2026-10-19");
  await mount();
  expect(dailyRequests).toBe(1);
  expect(closes()).toEqual(["2026-10-22 16:00 ET", "2026-10-16 16:00 ET"]);
  // Even a new transport read can serve the pre-close version.
  cache.invalidate();
  await act(async () => button("Refresh price snapshot").click());
  expect(closes()).toEqual(["2026-10-22 16:00 ET", "2026-10-16 16:00 ET"]);
  cache.invalidate();
  versionTime = Date.now();
  prices.at(-1)![4] = 102;
  await act(async () => button("Refresh price snapshot").click());
  expect(closes()).toEqual(["2026-10-23 16:00 ET", "2026-10-23 16:00 ET"]);
  expect(dailyRequests).toBe(3);
  cache.invalidate();
});
