// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ExposureChartReference from "@/components/exposure-map/ExposureChartReference";
import { LangProvider } from "@/lib/i18n";
import { exposureChartHref, type ExposureChartRequest } from "@/lib/exposureChartLink";

const { readSource, fingerprint } = vi.hoisted(() => ({ readSource: vi.fn(), fingerprint: vi.fn() }));
vi.mock("@/lib/flowClientCache", () => ({ flowGetResult: readSource }));
vi.mock("@/lib/exposureChartLink", async () => ({
  ...await vi.importActual<typeof import("@/lib/exposureChartLink")>("@/lib/exposureChartLink"),
  exposureChartFingerprint: fingerprint,
}));
const DIGEST = "a".repeat(64);
const REQUEST: ExposureChartRequest = { v: 1, root: "SPY", session: "2026-10-16", strike: 765, archived: false, metric: "gamma", lens: { kind: "all" }, shock: { spotPercent: 0, ivPoints: 0, calendarDays: 0 }, fingerprint: DIGEST };
const BOOK = { root: "SPY", asof: "2026-10-16", spot_ref: 763.25, by_strike: [{ strike: 765, gamma_net: -100, gamma_call: 100, gamma_put: -200 }] };
let host: HTMLDivElement, root: Root;
const onPin = vi.fn();
const banner = () => document.querySelector<HTMLElement>('[data-testid="exposure-chart-reference"]');
const nonNullPins = () => onPin.mock.calls.map(call => call[0]).filter(Boolean);
async function render(symbol = "SPY", active = true) {
  await act(async () => root.render(<LangProvider><ExposureChartReference symbol={symbol} active={active} pinned={null} onPin={onPin} /></LangProvider>));
}
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const storage = new Map<string, string>([["mm.lang", "en"]]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
    clear: () => storage.clear(),
  });
  window.history.replaceState({}, "", exposureChartHref(REQUEST)!);
  readSource.mockReset().mockResolvedValue({ status: "data", data: BOOK });
  fingerprint.mockReset().mockResolvedValue(DIGEST);
  onPin.mockReset();
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root?.unmount()); host?.remove(); vi.unstubAllGlobals();
  document.querySelectorAll("[data-testid=toolbar-more], [data-testid=roller-more], [data-context-launcher], [data-toolbar-action=snapshot]").forEach(element => element.remove());
});

describe("Main-chart exposure reference source binding", () => {
  it("checks the selected book and pins its real strike through the existing owner", async () => {
    await render();
    expect(readSource).toHaveBeenCalledWith("gex:SPY", { refresh: true });
    expect(banner()?.dataset.state).toBe("ready");
    expect(nonNullPins()).toEqual([{ root: "SPY", price: 765, session: "2026-10-16", label: expect.stringContaining("2026-10-16") }]);
    await render();
    expect(readSource).toHaveBeenCalledTimes(1);
    expect(nonNullPins()).toHaveLength(1);
  });
  it("uses the exact archive route only for an explicitly archived selection", async () => {
    window.history.replaceState({}, "", exposureChartHref({ ...REQUEST, archived: true })!);
    await render();
    expect(readSource).toHaveBeenCalledTimes(1);
    expect(readSource).toHaveBeenCalledWith("gex_at:SPY:2026-10-16", { refresh: true });
  });
  it.each(["a different source day", "a different root", "a missing selected strike"])("refuses %s", async reason => {
    const book = reason === "a different source day" ? { ...BOOK, asof: "2026-10-15" }
      : reason === "a different root" ? { ...BOOK, root: "QQQ" } : { ...BOOK, by_strike: [] };
    readSource.mockResolvedValue({ status: "data", data: book });
    await render();
    expect(banner()?.dataset.state).toBe("changed");
    expect(nonNullPins()).toHaveLength(0);
  });
  it("refuses a same-session correction instead of silently drawing the prior selection", async () => {
    fingerprint.mockResolvedValue("b".repeat(64));
    await render();
    expect(banner()?.dataset.state).toBe("changed");
    expect(nonNullPins()).toHaveLength(0);
  });
  it("keeps transport failure distinct from a changed source", async () => {
    readSource.mockResolvedValue({ status: "unavailable" });
    await render();
    expect(banner()?.dataset.state).toBe("unavailable");
    expect(nonNullPins()).toHaveLength(0);
  });
  it("does not acquire data or draw while access or replay prevents the reference", async () => {
    await render("SPY", false);
    expect(banner()?.dataset.state).toBe("paused");
    expect(readSource).not.toHaveBeenCalled();
    expect(nonNullPins()).toHaveLength(0);
    await render();
    expect(nonNullPins()).toHaveLength(1);
    await render("SPY", false);
    expect(onPin).toHaveBeenLastCalledWith(null);
    expect(banner()?.dataset.state).toBe("paused");
  });
  it("does not fetch or expose a SPY selection under a QQQ chart", async () => {
    await render("QQQ");
    expect(banner()).toBeNull();
    expect(readSource).not.toHaveBeenCalled();
  });
  it("drops a delayed verification after the chart symbol changes", async () => {
    let finish!: (value: unknown) => void;
    readSource.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await render();
    await render("QQQ");
    await act(async () => finish({ status: "data", data: BOOK }));
    expect(nonNullPins()).toHaveLength(0);
    expect(banner()).toBeNull();
  });
  it("drops a delayed fingerprint after Options access is withdrawn", async () => {
    let finish!: (value: string) => void;
    fingerprint.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await render();
    await render("SPY", false);
    await act(async () => finish(DIGEST));
    expect(nonNullPins()).toHaveLength(0);
  });
  it("dismisses the reference and removes its URL intent", async () => {
    const launcher = document.createElement("button");
    launcher.setAttribute("data-context-launcher", "");
    launcher.getClientRects = () => [new DOMRect(0, 0, 40, 40)] as unknown as DOMRectList;
    const toolbar = document.createElement("button");
    toolbar.dataset.testid = "toolbar-more";
    toolbar.getClientRects = () => [new DOMRect(0, 0, 40, 40)] as unknown as DOMRectList;
    document.body.append(launcher, toolbar);
    await render();
    const close = document.querySelector<HTMLButtonElement>('[aria-label="Dismiss exposure reference"]')!;
    await act(async () => close.click());
    expect(banner()).toBeNull();
    expect(window.location.hash).toBe("");
    expect(onPin).toHaveBeenLastCalledWith(null);
    expect(document.activeElement).toBe(toolbar);
  });
  it.each(["absent", "hidden"] as const)("returns Escape focus to the chart launcher when More is %s", async (more) => {
    if (more === "hidden") {
      const toolbar = document.createElement("button");
      toolbar.dataset.testid = "toolbar-more";
      document.body.appendChild(toolbar);
    }
    const launcher = document.createElement("button");
    launcher.setAttribute("data-context-launcher", "");
    launcher.getClientRects = () => [new DOMRect(0, 0, 40, 40)] as unknown as DOMRectList;
    document.body.appendChild(launcher);
    await render();
    const close = document.querySelector<HTMLButtonElement>('[aria-label="Dismiss exposure reference"]')!;
    close.focus();
    await act(async () => close.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(banner()).toBeNull();
    expect(window.location.hash).toBe("");
    expect(onPin).toHaveBeenLastCalledWith(null);
    expect(document.activeElement).toBe(launcher);
  });
  it("skips a disabled chart launcher when restoring focus", async () => {
    const launcher = document.createElement("button");
    launcher.setAttribute("data-context-launcher", "");
    launcher.disabled = true;
    launcher.getClientRects = () => [new DOMRect(0, 0, 40, 40)] as unknown as DOMRectList;
    const snapshot = document.createElement("div");
    snapshot.dataset.toolbarAction = "snapshot";
    const button = document.createElement("button");
    button.getClientRects = () => [new DOMRect(0, 0, 40, 40)] as unknown as DOMRectList;
    snapshot.appendChild(button);
    document.body.append(launcher, snapshot);
    await render();
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Dismiss exposure reference"]')!.click());
    expect(document.activeElement).toBe(button);
  });
  it("leaves ordinary chart navigation free of Options acquisition", async () => {
    window.history.replaceState({}, "", "/terminal?symbol=SPY");
    await render();
    expect(banner()).toBeNull();
    expect(readSource).not.toHaveBeenCalled();
  });
});
