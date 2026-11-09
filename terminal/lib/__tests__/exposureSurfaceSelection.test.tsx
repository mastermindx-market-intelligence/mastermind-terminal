// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ExposureMap from "@/components/exposure-map/ExposureMap";
import producer from "./fixtures/exposure-projection.json";
import * as chartLinks from "@/lib/exposureChartLink";

const locale = vi.hoisted(() => ({ lang: "en" }));
const viewport = vi.hoisted(() => ({ phone: false }));
const captured = vi.hoisted(() => ({ chart: [] as { optionsLevel?: { price: number } | null }[] }));
vi.mock("@/lib/i18n", () => ({ useLang: () => locale }));
vi.mock("next/dynamic", () => ({
  default: () => (props: { optionsLevel?: { price: number } | null }) => {
    captured.chart.push({ optionsLevel: props.optionsLevel });
    return null;
  },
}));
// Only the surface presentation is stubbed, to the two real cell callbacks over a
// known fixture cell; the parent's reader, state and landing behavior stay authentic.
vi.mock("@/components/exposure-map/ExposureSurface", () => ({
  default: ({ onOpenInMap, onPinCell }: {
    onOpenInMap: (cell: { strike: number; expiry: string }) => void;
    onPinCell: (cell: { strike: number; expiry: string }) => void;
  }) => <div>
    <button type="button" data-testid="surface-open-oct23" onClick={() => onOpenInMap({ strike: 100, expiry: "2026-10-23" })}>open oct23</button>
    <button type="button" data-testid="surface-pin-oct23" onClick={() => onPinCell({ strike: 100, expiry: "2026-10-23" })}>pin oct23</button>
    <button type="button" data-testid="surface-open-ghost" onClick={() => onOpenInMap({ strike: 100, expiry: "2026-10-30" })}>open ghost</button>
  </div>,
}));
vi.mock("@/components/exposure-map/FrozenNodeEntry", () => ({ default: () => null }));
vi.mock("@/components/exposure-map/ExposureDivergence", () => ({ default: () => null }));
vi.mock("@/components/chrome/AppShell", () => ({ useShellIdentity: () => ({ kind: "guest" }) }));
vi.mock("@/components/researchlab/useResearchAppearance", () => ({ useResearchAppearance: () => {} }));
vi.mock("@/lib/useMediaQuery", () => ({ useIsPhone: () => viewport.phone }));
vi.mock("@/lib/flowClientCache", () => ({ flowGetResult: async () => ({ kind: "unavailable" }) }));

const SESSION = "2026-10-13";
const EXPIRIES = ["2026-10-16", "2026-10-23"];

// Adapted from the ExposureSurface fixture recipe: a qualified projection whose
// strike 100 Gamma net is +100M on Oct 16 and +200M on Oct 23, so the all-expiry
// aggregate reads +300M and each expiry answers differently.
const projection = (() => {
  const base = structuredClone(producer) as typeof producer;
  base.clocks = { ...base.clocks, source_session: SESSION, oi_report_date: SESSION,
    oi_available_at: `${SESSION}T12:00:00Z`, option_observed_at: `${SESSION}T19:00:00Z`,
    underlying_observed_at: `${SESSION}T19:00:00Z`, greeks_available_at: `${SESSION}T19:01:00Z`,
    available_at: `${SESSION}T20:00:00Z` };
  const proto = base.cells[0]!;
  base.cells = EXPIRIES.map((expiry, e) => ({
    ...structuredClone(proto), expiry, strike: 100, economic_expiry_at: `${expiry}T20:00:00Z`,
    gamma: { ...proto.gamma, net: 100e6 * (e + 1), gross: 200e6 * (e + 1), known_net: 100e6 * (e + 1), known_gross: 200e6 * (e + 1),
      call: 150e6 * (e + 1), put: -50e6 * (e + 1) },
  }));
  base.cell_count = base.cells.length;
  return base;
})();

const book = { root: "SPY", asof: SESSION, spot_ref: 100,
  by_strike: [{ strike: 100, gamma_net: 300e6 }], by_expiry: EXPIRIES.map((exp) => ({ exp })),
  exposure_projection: projection };

let host: HTMLDivElement, view: Root, unmounted: boolean;
let frames: Map<number, FrameRequestCallback>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-14T20:00:00Z"));
  locale.lang = "en"; viewport.phone = false; unmounted = false;
  vi.stubGlobal("matchMedia", (query: string) => ({
    media: query, matches: false, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: () => true,
  }));
  captured.chart.length = 0;
  frames = new Map();
  let frameId = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = ++frameId; frames.set(id, callback); return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => { frames.delete(id); });
  host = document.createElement("div"); document.body.append(host); view = createRoot(host);
});
afterEach(() => { if (!unmounted) act(() => view.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const mount = (root = "SPY", source: unknown = book) =>
  act(() => view.render(<ExposureMap root={root} source={source} matrix={null} />));
const picker = () => host.querySelector("select")!;
const inspector = () => host.querySelector<HTMLElement>('[data-testid="exposure-node-inspector"]')!;
const pressedMetric = () =>
  [...host.querySelectorAll('[role="group"] button')].find((b) => b.getAttribute("aria-pressed") === "true")!;
const selectedRows = () => host.querySelectorAll('tbody tr[aria-selected="true"]');
const level = () => captured.chart[captured.chart.length - 1]?.optionsLevel ?? null;
const surfaceTab = () =>
  [...host.querySelectorAll("button")].find((b) => !b.dataset.testid && /surface/i.test(b.textContent ?? ""))!;
const surfaceButton = (id: string) => host.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!;
const click = (el: Element) => act(() => { (el as HTMLElement).click(); });
const flushFrames = () => {
  // Execute scheduled work instead of hiding a competing/stale focus callback.
  for (let pass = 0; frames.size && pass < 10; pass++) {
    act(() => {
      const pending = [...frames.values()]; frames.clear();
      for (const callback of pending) callback(0);
    });
  }
  expect(frames.size).toBe(0);
};
const key = (target: Element, value: string, shiftKey = false) => act(() => {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: value, shiftKey, bubbles: true, cancelable: true }));
});
const openFromSurface = (action: string) => {
  const opener = surfaceTab(); click(opener);
  const button = surfaceButton(action); button.focus();
  expect(document.activeElement).toBe(button);
  click(button);
  expect(button.isConnected).toBe(false);
  return opener;
};
const phoneInspector = () => document.querySelector<HTMLElement>('[data-testid="exposure-node-inspector"]')!;
const closeButton = (within: HTMLElement) =>
  [...within.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Close inspector")!;
const usePhone = () => {
  viewport.phone = true;
  // jsdom has no layout; let the actual sheet's focusable-element filter see
  // these connected controls. Browser geometry/keyboard proof lives in e2e.
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (this: HTMLElement) {
    return (this.isConnected ? [new DOMRect(0, 0, 1, 1)] : []) as unknown as DOMRectList;
  });
};

it("opens a surface cell at its own expiry and Gamma, never the all-expiry aggregate", () => {
  locale.lang = "en";
  mount();
  click(host.querySelector("tbody tr th button")!);
  expect(inspector().textContent).toContain("+300M");
  click(surfaceTab());
  expect(level()).toBeNull();
  click(surfaceButton("surface-open-oct23"));
  expect(picker().value).toBe("2026-10-23");
  expect(picker().selectedOptions[0].disabled).toBe(false);
  expect(picker().selectedOptions[0].textContent).toBe("2026-10-23");
  expect(pressedMetric().textContent).toMatch(/gamma/i);
  expect(inspector().textContent).toContain("+200M");
  expect(inspector().textContent).toContain("400M");
  expect([...host.querySelectorAll("button")].find(b => b.textContent === "Signed net")?.getAttribute("aria-pressed")).toBe("true");
  expect(inspector().textContent).not.toContain("+300M");
  expect(selectedRows().length).toBeGreaterThan(0);
});

it("switches a Vanna parent to Gamma and the exact cell expiry", () => {
  locale.lang = "en";
  mount();
  const vanna = [...host.querySelectorAll('[role="group"] button')].find((b) => /vanna/i.test(b.textContent ?? ""))!;
  expect(vanna.getAttribute("data-locked")).toBeNull();
  click(vanna);
  expect(pressedMetric().textContent).toMatch(/vanna/i);
  click(surfaceTab());
  click(surfaceButton("surface-open-oct23"));
  expect(picker().value).toBe("2026-10-23");
  expect(pressedMetric().textContent).toMatch(/gamma/i);
  expect(inspector().textContent).toContain("+200M");
  expect(selectedRows().length).toBeGreaterThan(0);
});

it("pins the exact scoped Gamma cell and selection", () => {
  locale.lang = "en";
  mount();
  click(surfaceTab());
  expect(level()).toBeNull();
  click(surfaceButton("surface-pin-oct23"));
  expect(picker().value).toBe("2026-10-23");
  expect(pressedMetric().textContent).toMatch(/gamma/i);
  expect(inspector().textContent).toContain("+200M");
  expect(selectedRows().length).toBeGreaterThan(0);
  expect(level()?.price).toBe(100);
});

it.each([
  ["surface-open-oct23", "root"], ["surface-pin-oct23", "root"],
  ["surface-open-oct23", "source"], ["surface-pin-oct23", "source"],
] as const)("never lands %s after a pending %s change", (action, change) => {
  locale.lang = "en";
  mount();
  click(surfaceTab());
  const other = { ...book, root: "QQQ", exposure_projection: { ...structuredClone(projection), root: "QQQ", security_id: "SEC:QQQ" } };
  act(() => {
    surfaceButton(action).click();
    view.render(<ExposureMap root={change === "root" ? "QQQ" : "SPY"} source={change === "root" ? other : { ...book }} matrix={null} />);
  });
  expect(picker().value).toBe("2026-10-23");
  expect(selectedRows().length).toBe(0);
  expect(inspector().textContent).not.toContain("Selected 100");
  expect(level()).toBeNull();
  mount();
  expect(selectedRows().length).toBe(0);
  expect(level()).toBeNull();
});

it("withdraws a handoff whose exact cell has no data instead of broadening", () => {
  locale.lang = "en";
  mount();
  click(surfaceTab());
  click(surfaceButton("surface-open-ghost"));
  expect(picker().value).toBe("2026-10-30");
  expect(picker().selectedOptions[0].disabled).toBe(true);
  expect(picker().selectedOptions[0].textContent).toContain("Not listed in this book");
  const recover = [...host.querySelectorAll("button")].find((b) => b.textContent === "Show all expiries");
  expect(recover).toBeDefined();
  expect(selectedRows().length).toBe(0);
  expect(inspector().textContent).not.toContain("+200M");
  expect(level()).toBeNull();
});

it.each(["surface-open-oct23", "surface-pin-oct23"])("hands %s focus to the desktop inspector and returns to the connected tab", action => {
  mount();
  const opener = openFromSurface(action);
  expect(document.activeElement).toBe(inspector().querySelector("h3"));
  expect(document.activeElement?.isConnected).toBe(true);
  flushFrames();
  expect(document.activeElement).toBe(inspector().querySelector("h3"));
  click(closeButton(inspector()));
  expect(document.activeElement).toBe(opener);
  expect(selectedRows().length).toBe(0);

  // A second activation of the same cell must not be suppressed by strike/identity equality.
  openFromSurface(action);
  expect(document.activeElement).toBe(inspector().querySelector("h3"));
  openFromSurface(action);
  expect(document.activeElement).toBe(inspector().querySelector("h3"));
  key(inspector(), "Escape");
  flushFrames();
  expect(document.activeElement).toBe(opener);
  expect(opener.isConnected).toBe(true);
});

it("does not steal focus on an unchanged read, locale render or phone-to-desktop resize", () => {
  mount(); openFromSurface("surface-open-oct23");
  const opener = surfaceTab(); opener.focus();
  mount(); flushFrames();
  expect(document.activeElement).toBe(opener);
  locale.lang = "zh"; mount(); flushFrames();
  expect(document.activeElement).toBe(opener);
  viewport.phone = true; mount(); flushFrames();
  viewport.phone = false; mount(); flushFrames();
  expect(document.activeElement).not.toBe(inspector().querySelector("h3"));
});

it.each([
  ["surface-open-oct23", "root"], ["surface-pin-oct23", "root"],
  ["surface-open-oct23", "source"], ["surface-pin-oct23", "source"],
] as const)("cancels %s focus when its pending %s changes", (action, change) => {
  mount(); click(surfaceTab());
  const opener = surfaceTab(), button = surfaceButton(action);
  button.focus();
  const other = { ...book, root: "QQQ", exposure_projection: { ...structuredClone(projection), root: "QQQ", security_id: "SEC:QQQ" } };
  act(() => {
    button.click();
    view.render(<ExposureMap root={change === "root" ? "QQQ" : "SPY"} source={change === "root" ? other : { ...book }} matrix={null} />);
  });
  flushFrames();
  expect(document.activeElement).toBe(opener);
  expect(selectedRows().length).toBe(0);
  expect(level()).toBeNull();
});

it("keeps a missing-cell handoff on the Surface tab and cancels a pending handoff on Close", () => {
  mount();
  const opener = openFromSurface("surface-open-ghost");
  flushFrames();
  expect(document.activeElement).toBe(opener);
  expect(selectedRows().length).toBe(0);

  openFromSurface("surface-open-oct23");
  click(surfaceTab());
  const close = closeButton(inspector());
  act(() => { surfaceButton("surface-pin-oct23").click(); close.click(); });
  flushFrames();
  expect(document.activeElement).toBe(opener);
  expect(selectedRows().length).toBe(0);
  expect(level()).toBeNull();
});

it.each(["surface-open-oct23", "surface-pin-oct23"])("lets the real phone sheet own %s focus, Tab containment and return", action => {
  usePhone(); mount(); flushFrames();
  const opener = openFromSurface(action);
  // No parent RAF competes with the sheet. The connected opener remains focused
  // until MobileSheet runs its own initial-focus callback.
  expect(document.activeElement).toBe(opener);
  flushFrames();
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(document.activeElement).toBe(phoneInspector().querySelector("h3"));
  expect(document.activeElement).not.toBe(phoneInspector());
  key(dialog, "Tab", true);
  const last = document.activeElement!;
  expect(last).not.toBe(dialog);
  expect(dialog.contains(last)).toBe(true);
  key(last, "Tab");
  const first = document.activeElement!;
  expect(first).not.toBe(last);
  expect(dialog.contains(first)).toBe(true);
  key(first, "Tab", true);
  expect(document.activeElement).toBe(last);
  key(last, "Escape");
  flushFrames();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(opener);

  openFromSurface(action); flushFrames();
  click(closeButton(phoneInspector())); flushFrames();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(opener);
});

it.each(["root", "source", "close", "unmount"] as const)("cancels the phone sheet's scheduled focus on %s", change => {
  usePhone(); mount(); flushFrames();
  const opener = openFromSurface("surface-open-oct23");
  expect(document.activeElement).toBe(opener);
  if (change === "close") click(closeButton(phoneInspector()));
  else if (change === "unmount") {
    act(() => view.unmount()); unmounted = true;
    const survivor = document.createElement("button"); host.append(survivor); survivor.focus();
    flushFrames();
    expect(document.activeElement).toBe(survivor);
    return;
  } else {
    const other = { ...book, root: "QQQ", exposure_projection: { ...structuredClone(projection), root: "QQQ", security_id: "SEC:QQQ" } };
    mount(change === "root" ? "QQQ" : "SPY", change === "root" ? other : { ...book });
  }
  flushFrames();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(opener);
  expect(level()).toBeNull();
});


const RETURN_REQUEST: chartLinks.ExposureChartRequest = { v: 1, root: "SPY", session: SESSION,
  strike: 100, archived: false, metric: "gamma", lens: { kind: "one", exp: "2026-10-23" },
  shock: { spotPercent: 0, ivPoints: 0, calendarDays: 0 }, fingerprint: "a".repeat(64) };
it("focuses only the source-validated returned inspector and escapes to its selected row", async () => {
  vi.spyOn(chartLinks, "exposureChartFingerprint").mockResolvedValue(RETURN_REQUEST.fingerprint);
  await act(async () => view.render(<ExposureMap root="SPY" source={book} matrix={null} initialRequest={RETURN_REQUEST} />));
  expect(host.querySelector('[data-testid="exposure-return-check"]')?.getAttribute("data-state")).toBe("ready");
  expect(document.activeElement).toBe(inspector().querySelector("h3"));
  expect(inspector().textContent).toContain("+200M");
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(document.activeElement).toBe(host.querySelector("tbody tr th button"));
});
it("does not move focus for a returned selection whose source digest changed", async () => {
  vi.spyOn(chartLinks, "exposureChartFingerprint").mockResolvedValue("b".repeat(64));
  const before = document.activeElement;
  await act(async () => view.render(<ExposureMap root="SPY" source={book} matrix={null} initialRequest={RETURN_REQUEST} />));
  expect(host.querySelector('[data-testid="exposure-return-check"]')?.getAttribute("data-state")).toBe("changed");
  expect(document.activeElement).toBe(before);
  expect(selectedRows()).toHaveLength(0);
});
it("does not move focus when a returned source is unavailable", async () => {
  const before = document.activeElement;
  await act(async () => view.render(<ExposureMap root="SPY" source={null} sourceStatus="unavailable" matrix={null} initialRequest={RETURN_REQUEST} />));
  expect(host.querySelector('[data-testid="exposure-return-check"]')?.getAttribute("data-state")).toBe("unavailable");
  expect(document.activeElement).toBe(before);
  expect(selectedRows()).toHaveLength(0);
});
