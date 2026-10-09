// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { flowGetMock } = vi.hoisted(() => ({ flowGetMock: vi.fn() }));
vi.mock("@/lib/flowClientCache", () => ({
  // VolView reads through flowGetResult: a payload is data, a null is a published absence (404).
  flowGetResult: async (key: string) => {
    const data = await flowGetMock(key);
    return data == null ? { status: "absent", httpStatus: 404 } : { status: "data", data };
  },
}));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: "en", setLang: () => undefined }) }));
vi.mock("@/lib/searchTrack", () => ({ trackSearch: () => undefined }));
vi.mock("@/components/ui/Tip", () => ({ Tip: ({children}: {children: React.ReactNode}) => <>{children}</> }));

import { VolView } from "@/components/vol/VolView";

let host: HTMLDivElement;
let root: Root;
const point = (strike: number, call_iv: number | null, put_iv: number | null) => ({ strike, call_iv, put_iv });
const payload = {
  schema: "options_hub.vol/v1",
  root: "SPY",
  asof: "2026-09-25",
  atm_iv: 12.5,
  iv_rank_252: 41,
  iv_rank_all: 52,
  coverage_days_all: 300,
  since_all: "2025-07-01",
  iv_52w_hi: 25,
  iv_52w_lo: 10,
  rv20: 12.7,
  vrp: -0.2,
  term: [
    { exp: "2026-10-02", dte: 7, atm_iv: 12.8 },
    { exp: "2026-10-16", dte: 21, atm_iv: null },
    { exp: "2026-10-23", dte: 28, atm_iv: 14.6 },
    { exp: "2026-11-20", dte: 56, atm_iv: 16.1 },
  ],
  smile: [
    { exp: "2026-10-23", points: [point(90, 22, 23), point(100, 20, 20), point(110, 21, 22)] },
    { exp: "2026-11-20", points: [point(90, 24, 25), point(100, 21, 22), point(110, 22, 24)] },
  ],
  history: Array.from({ length: 10 }, (_, i) => ({
    date: `2026-09-${String(i + 1).padStart(2, "0")}`,
    iv_rank: null,
    atm_iv: 12 + i * 0.2,
    close: null,
  })),
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  flowGetMock.mockReset();
  flowGetMock.mockImplementation(async (key: string) => key === "vol:SPY" ? payload : null);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function mount() {
  await act(async () => {
    root.render(<VolView />);
    await Promise.resolve();
    await Promise.resolve();
  });
  for (let i = 0; i < 10 && !host.querySelector('[data-testid="vol-expiry-context"]'); i++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  }
  const context = host.querySelector<HTMLElement>('[data-testid="vol-expiry-context"]');
  if (!context) throw new Error("shared expiry context did not mount");
  return context;
}

function termSelect() {
  const select = host.querySelector<HTMLSelectElement>('[data-testid="term-expiry-select"]');
  if (!select) throw new Error("term expiry selector missing");
  return select;
}
async function selectTerm(exp: string) {
  const select = termSelect();
  await act(async () => { select.value = exp; select.dispatchEvent(new Event("change", { bubbles: true })); });
}

function smileExpiry(exp: string) {
  const buttons = [...host.querySelectorAll<HTMLButtonElement>('button')];
  const button = buttons.find(candidate => candidate.textContent?.trim() === exp);
  if (!button) throw new Error(`smile expiry ${exp} missing`);
  return button;
}

describe("Volatility expiry-led investigation", () => {
  it("defaults to the first expiry that both term and smile actually supply", async () => {
    const context = await mount();
    expect(context.textContent).toContain("2026-10-23");
    expect(context.textContent).toContain("28 days");
    expect(context.textContent).toContain("reported ATM IV 14.6%");
    expect(context.textContent).toContain("smile supplied");
    expect(host.textContent).toContain("Headline ATM IV");
    expect(host.textContent).toContain("tenor not supplied");
    expect(host.textContent).toContain("Reported IV − RV20");
    expect(host.textContent).toContain("IV − realized-vol spread · history");
    expect(host.textContent).not.toContain("Volatility risk premium");
    expect(termSelect().value).toBe("2026-10-23");
    expect(smileExpiry("2026-10-23").getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps a selected missing term observation and refuses nearest-expiry smile substitution", async () => {
    const context = await mount();
    await selectTerm("2026-10-16");
    expect(context.textContent).toContain("2026-10-16");
    expect(context.textContent).toContain("21 days");
    expect(context.textContent).toContain("ATM IV unavailable");
    expect(context.textContent).toContain("smile unavailable for this expiry");
    expect(host.textContent).toContain("No smile for the selected expiry");
    expect(host.textContent).toContain("2026-10-16 has no supplied per-strike IV series");
    expect(termSelect().value).toBe("2026-10-16");
    expect(smileExpiry("2026-10-23").getAttribute("aria-pressed")).toBe("false");
  });

  it("lets the smile expiry selector move the same shared context without creating another owner", async () => {
    const context = await mount();
    await act(async () => smileExpiry("2026-11-20").click());
    expect(context.textContent).toContain("2026-11-20");
    expect(context.textContent).toContain("56 days");
    expect(context.textContent).toContain("reported ATM IV 16.1%");
    expect(context.textContent).toContain("smile supplied");
    expect(termSelect().value).toBe("2026-11-20");
    expect(smileExpiry("2026-11-20").getAttribute("aria-pressed")).toBe("true");
    expect(flowGetMock.mock.calls.filter(([key]) => key === "vol:SPY")).toHaveLength(1);
  });

  it("keeps a smile-only selected expiry in the real term selector, then returns to an admitted term expiry", async () => {
    const smileOnly = {
      ...payload,
      term: [{ exp: "2026-10-09", dte: 14, atm_iv: 13.3 }],
      smile: [{ exp: "2026-10-23", points: [point(90, 22, 23), point(100, 20, 20), point(110, 21, 22)] }],
    };
    flowGetMock.mockImplementation(async (key: string) => key === "vol:SPY" ? smileOnly : null);
    const context = await mount();
    await act(async () => smileExpiry("2026-10-23").click());
    expect(context.textContent).toContain("2026-10-23");
    expect(context.textContent).toContain("ATM IV unavailable");
    expect(context.textContent).toContain("smile supplied");
    expect(termSelect().value).toBe("2026-10-23");
    expect([...termSelect().options].find(option => option.value === "2026-10-23")?.textContent).toBe("2026-10-23 · ATM IV unavailable");

    await selectTerm("2026-10-09");
    expect(context.textContent).toContain("2026-10-09");
    expect(context.textContent).toContain("14 days");
    expect(context.textContent).toContain("reported ATM IV 13.3%");
    expect(context.textContent).toContain("smile unavailable for this expiry");
    expect(termSelect().value).toBe("2026-10-09");
  });

  it("keeps an ambiguous-DTE shared selection exact instead of silently falling back", async () => {
    const ambiguous = {
      ...payload,
      term: [
        { exp: "2026-10-09", dte: 14, atm_iv: 13.3 },
        { exp: "2026-10-16", dte: 21, atm_iv: 14.6 },
        { exp: "2026-10-16", dte: 28, atm_iv: 99 },
      ],
      smile: [{ exp: "2026-10-16", points: [point(90, 22, 23), point(100, 20, 20), point(110, 21, 22)] }],
    };
    flowGetMock.mockImplementation(async (key: string) => key === "vol:SPY" ? ambiguous : null);
    const context = await mount();
    expect(context.textContent).toContain("2026-10-16");
    expect(context.textContent).not.toContain("21 days");
    expect(context.textContent).not.toContain("28 days");
    expect(context.textContent).toContain("ATM IV unavailable · conflicting expiry records");
    expect(context.textContent).toContain("smile supplied");
    expect(termSelect().value).toBe("2026-10-16");
    expect([...termSelect().options].find(option => option.value === "2026-10-16")?.textContent).toBe("2026-10-16 · ATM IV unavailable");

    await selectTerm("2026-10-09");
    expect(context.textContent).toContain("2026-10-09");
    expect(context.textContent).toContain("14 days");
    expect(context.textContent).toContain("reported ATM IV 13.3%");
    expect(termSelect().value).toBe("2026-10-09");
  });

  it("renders the exact shared expiry when the term inventory is empty", async () => {
    const noTerm = {
      ...payload,
      term: [],
      smile: [{ exp: "2026-10-23", points: [point(90, 22, 23), point(100, 20, 20), point(110, 21, 22)] }],
    };
    flowGetMock.mockImplementation(async (key: string) => key === "vol:SPY" ? noTerm : null);
    const context = await mount();
    expect(context.textContent).toContain("2026-10-23");
    expect(context.textContent).toContain("ATM IV unavailable");
    expect(context.textContent).toContain("smile supplied");
    expect(termSelect().value).toBe("2026-10-23");
    expect(termSelect().options).toHaveLength(1);
    expect(termSelect().options[0].textContent).toBe("2026-10-23 · ATM IV unavailable");
  });

});
