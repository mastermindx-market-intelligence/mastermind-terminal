// @vitest-environment jsdom
/**
 * Shared expiry selection across root switches: a late response for an older root,
 * a payload that names another root, a missing root, and a duplicate expiry on the
 * new root. The selection is root-keyed and every surface must read the same root.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { flowGetMock } = vi.hoisted(() => ({ flowGetMock: vi.fn() }));
vi.mock("@/lib/flowClientCache", () => ({ flowGet: flowGetMock }));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: "en", setLang: () => undefined }) }));
vi.mock("@/lib/searchTrack", () => ({ trackSearch: () => undefined }));
vi.mock("@/components/ui/Tip", () => ({ Tip: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

import { VolView } from "@/components/vol/VolView";

const point = (strike: number, call_iv: number | null, put_iv: number | null) => ({ strike, call_iv, put_iv });
function volPayload(root: string, asof: string, term: { exp: string; dte: number; atm_iv: number | null }[], smileExps: string[], base: number) {
  return {
    schema: "options_hub.vol/v1",
    root,
    asof,
    atm_iv: base,
    iv_52w_hi: base + 10,
    iv_52w_lo: base - 5,
    rv20: base - 1,
    vrp: 1,
    term,
    smile: smileExps.map((exp) => ({ exp, points: [point(90, base + 2, base + 3), point(100, base, base), point(110, base + 1, base + 2)] })),
    history: Array.from({ length: 10 }, (_, i) => ({ date: `${asof.slice(0, 8)}${String(i + 1).padStart(2, "0")}`, iv_rank: null, atm_iv: base + i * 0.1, close: null })),
  };
}

const SPY = volPayload("SPY", "2026-09-25", [
  { exp: "2026-10-23", dte: 28, atm_iv: 14.6 },
  { exp: "2026-11-20", dte: 56, atm_iv: 16.1 },
  { exp: "2026-12-18", dte: 84, atm_iv: 17.3 },
], ["2026-10-23", "2026-11-20"], 12);
// QQQ also lists 2026-12-18: SPY's chosen expiry must not carry over by date alone.
const QQQ = volPayload("QQQ", "2026-09-26", [
  { exp: "2026-10-30", dte: 34, atm_iv: 19.4 },
  { exp: "2026-10-30", dte: 34, atm_iv: 88.8 },
  { exp: "2026-11-20", dte: 55, atm_iv: 20.2 },
  { exp: "2026-12-18", dte: 83, atm_iv: 21.7 },
], ["2026-11-20", "2026-12-18"], 18);
const IWM = volPayload("IWM", "2026-09-24", [
  { exp: "2026-10-09", dte: 15, atm_iv: 31.3 },
], ["2026-10-09"], 30);

let host: HTMLDivElement;
let root: Root;
let releaseIwm: (() => void) | null;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  releaseIwm = null;
  flowGetMock.mockReset();
  flowGetMock.mockImplementation(async (key: string) => {
    if (key === "vol:SPY") return SPY;
    if (key === "vol:QQQ") return QQQ;
    if (key === "vol:DIA") return SPY; // a source answering with another root's payload
    if (key === "vol:IWM") return new Promise((resolve) => { releaseIwm = () => resolve(IWM); });
    return null;
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function settle() {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
const context = () => host.querySelector<HTMLElement>('[data-testid="vol-expiry-context"]');
const termSelect = () => host.querySelector<HTMLSelectElement>('[data-testid="term-expiry-select"]');
const pressedSmile = () => [...host.querySelectorAll<HTMLButtonElement>('button[aria-pressed="true"]')].map((b) => b.textContent?.trim());

async function commitRoot(next: string) {
  const input = host.querySelector<HTMLInputElement>('input[list="vol-roots"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
}
async function selectTerm(exp: string) {
  const select = termSelect()!;
  await act(async () => { select.value = exp; select.dispatchEvent(new Event("change", { bubbles: true })); });
}

describe("Volatility shared selection across root sources", () => {
  it("drops a late older-root response and does not carry an expiry choice across roots", async () => {
    await act(async () => root.render(<VolView />));
    await settle();
    await selectTerm("2026-12-18");
    expect(context()!.textContent).toContain("2026-12-18");
    expect(context()!.textContent).toContain("17.3%");

    await commitRoot("IWM"); // slow source, still pending
    await commitRoot("QQQ"); // newer pick resolves first
    await settle();
    expect(host.textContent).toContain("2026-09-26"); // QQQ snapshot date in the as-of chip
    // QQQ default is its own first expiry that term and smile both carry, not SPY's choice.
    expect(context()!.textContent).toContain("2026-11-20");
    expect(context()!.textContent).toContain("55 days");
    expect(context()!.textContent).toContain("20.2%");
    expect(termSelect()!.value).toBe("2026-11-20");
    expect(pressedSmile()).toContain("2026-11-20");
    // The duplicated QQQ expiry stays an unavailable identity and never leaks its 88.8 revision.
    expect(host.textContent).not.toContain("88.8");

    // The older root resolves late; nothing from it may appear.
    expect(releaseIwm).toBeTypeOf("function");
    await act(async () => { releaseIwm!(); });
    await settle();
    expect(host.textContent).not.toContain("2026-10-09");
    expect(host.textContent).not.toContain("31.3");
    expect(host.textContent).toContain("2026-09-26");
    expect(context()!.textContent).toContain("2026-11-20");
    expect(termSelect()!.value).toBe("2026-11-20");
  });

  it("keeps a selected QQQ expiry exact across term, context and smile", async () => {
    await act(async () => root.render(<VolView />));
    await settle();
    await commitRoot("QQQ");
    await settle();
    await selectTerm("2026-10-30");
    expect(context()!.textContent).toContain("2026-10-30");
    expect(context()!.textContent).not.toContain("19.4");
    expect(host.textContent).not.toContain("88.8");
    expect(termSelect()!.value).toBe("2026-10-30");
    expect(pressedSmile()).not.toContain("2026-11-20");
    expect(host.textContent).toContain("No smile for the selected expiry");
  });

  it("shows the honest empty state for a payload naming another root and for a missing root", async () => {
    await act(async () => root.render(<VolView />));
    await settle();
    await commitRoot("DIA");
    await settle();
    expect(context()).toBeNull();
    expect(host.textContent).not.toContain("2026-10-23");
    expect(host.textContent).not.toContain("2026-09-25");
    await commitRoot("XYZ");
    await settle();
    expect(context()).toBeNull();
    expect(host.querySelectorAll("svg[role=\"img\"]")).toHaveLength(0); // the header search glyph is decorative
  });
});
