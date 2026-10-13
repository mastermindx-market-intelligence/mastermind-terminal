// @vitest-environment jsdom
// PP2-UI-c — exact strike and days-to-expiry scope through the shared scope.
// The companion's existing transactional scope gains a Range radio (preset vs exact).
// Exact mode renders four text inputs (From/To strike, Min/Max days to expiry) and
// wires the parser (`optionsScopeBounds.parseScopeBounds`) into the live render.
// Falsifiers 2, 7, 8 of the accepted Paper contract (#723) are closed here.

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MatrixCompanion, type MatrixPreferences } from "@/components/options-companion/MatrixCompanion";
import { optionsT } from "@/components/options-companion/optionsStrings";
import { LangProvider } from "@/lib/i18n";
import {
  matrixForExactScope,
  EXACT_WINDOW_PCT,
} from "@/lib/optionsScopeExact";

const { fetchSnapshot } = vi.hoisted(() => ({ fetchSnapshot: vi.fn() }));
vi.mock("@/lib/flowClientCache", () => ({
  flowGetResult: fetchSnapshot,
  flowGetFresh: fetchSnapshot,
}));
const asData = (data: unknown) => ({ status: "data" as const, data });

// The declared-grid fixture (PP2-UI-c spec item 2):
//  - session 2026-07-09
//  - strikes [100,101,102,103,104]
//  - expiries ["2026-07-08","2026-07-09","2026-07-10","2026-07-16","2026-08-21"]
//  - published cells on most positions
//  - one in-range position deliberately absent: (102, 2026-07-10)
//  - one cell with a measured `gex: 0`: (100, 2026-07-09)
const SESSION = "2026-07-09";
const STRIKES = [100, 101, 102, 103, 104] as const;
const EXPIRIES = ["2026-07-08", "2026-07-09", "2026-07-10", "2026-07-16", "2026-08-21"] as const;
const measured = (strike: number, expiry: string, gex: number) => ({ strike, expiry, gex, call_oi: 0, put_oi: 0, call_vol: 0, put_vol: 0 });
function declaredFixture(extraExpiries: readonly string[] = EXPIRIES) {
  // For the in-range rectangle strikes [100..104] × expiries [09,10,16], publish every
  // position except (102, 2026-07-10), which is the spec's one deliberately absent.
  const cells = [
    measured(100, "2026-07-09", 0),                // measured zero
    measured(101, "2026-07-09", 1_000_000),
    measured(102, "2026-07-09", -1_500_000),
    measured(103, "2026-07-09", 2_000_000),
    measured(104, "2026-07-09", 500_000),
    measured(100, "2026-07-10", -300_000),
    measured(101, "2026-07-10", 800_000),
    // 102 × 2026-07-10 deliberately omitted — the one in-range absent position.
    measured(103, "2026-07-10", -1_000_000),
    measured(104, "2026-07-10", 600_000),
    measured(100, "2026-07-16", 200_000),
    measured(101, "2026-07-16", -700_000),
    measured(102, "2026-07-16", 1_500_000),
    measured(103, "2026-07-16", 400_000),
    measured(104, "2026-07-16", -500_000),
  ];
  return {
    schema: "options_structure.matrix/v1", root: "SPY", spot: 102,
    asof: "2026-07-09T21:04:11.000000+00:00", _build_meta: { asof_date: SESSION },
    strikes: [...STRIKES], expiries: [...extraExpiries], cells,
  };
}

let element: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); fetchSnapshot.mockReset();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-29T12:00:00Z"));
  element = document.createElement("div"); document.body.appendChild(element); root = createRoot(element);
});
afterEach(async () => { await act(async () => root.unmount()); element.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });

function Harness({ root: r = "SPY", lang = "en" as "en" | "zh", onPin, onPrefs }: {
  root?: string; lang?: "en" | "zh"; onPin?: ReturnType<typeof vi.fn>; onPrefs?: ReturnType<typeof vi.fn>;
}) {
  const [prefs, setPrefs] = React.useState<MatrixPreferences>({ expiries: "3", window: 25, norm: "global" });
  const noop = React.useCallback(() => {}, []);
  const pin = onPin ?? noop;
  const cb = onPrefs ?? setPrefs;
  return <LangProvider>
    <MatrixCompanion root={r} metric="gex" prefs={prefs} onPrefs={cb} t={optionsT(lang)}
      pinned={null} onPin={pin} replayActive={false} />
  </LangProvider>;
}
// PP2-UI-c repair 1: holds prefs outside the companion so the second Apply in
// n2b can observe the propagated norm without remounting.
function PrefsHarness({ initial, onPrefs, lang = "en" as "en" | "zh" }: {
  initial: MatrixPreferences; onPrefs?: ReturnType<typeof vi.fn>; lang?: "en" | "zh";
}) {
  const [prefs, setPrefs] = React.useState<MatrixPreferences>(initial);
  const handle = React.useCallback((next: MatrixPreferences) => {
    onPrefs?.(next);
    setPrefs(next);
  }, [onPrefs]);
  return <LangProvider>
    <MatrixCompanion root="SPY" metric="gex" prefs={prefs} onPrefs={handle}
      t={optionsT(lang)} pinned={null} onPin={() => {}} replayActive={false} />
  </LangProvider>;
}
async function renderOnce(payload: unknown, lang: "en" | "zh" = "en", opts: { root?: string; onPin?: ReturnType<typeof vi.fn>; onPrefs?: ReturnType<typeof vi.fn> } = {}) {
  fetchSnapshot.mockResolvedValue(asData(payload));
  await act(async () => root.render(<Harness root={opts.root} lang={lang} onPin={opts.onPin} onPrefs={opts.onPrefs} />));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}
async function openScope() {
  const opener = element.querySelector<HTMLButtonElement>('[data-testid="options-scope-toggle"]')!;
  await act(async () => { opener.click(); });
}
async function pickMode(mode: "preset" | "exact") {
  const radio = element.querySelector<HTMLInputElement>(`[data-testid="options-scope-mode-${mode}"]`)!;
  await act(async () => { radio.click(); });
}
async function typeFromTo(from: string, to: string) {
  const fromInput = element.querySelector<HTMLInputElement>('[data-testid="options-scope-from"]')!;
  const toInput = element.querySelector<HTMLInputElement>('[data-testid="options-scope-to"]')!;
  // React's controlled input suppresses onChange when the new value equals the
  // current one — but the prefilled values in exact mode already match several
  // test inputs, so use the native setter to force React to register the change.
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(fromInput, from); fromInput.dispatchEvent(new Event("input", { bubbles: true }));
    setter.call(toInput, to); toInput.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function typeDte(min: string, max: string) {
  const minInput = element.querySelector<HTMLInputElement>('[data-testid="options-scope-dte-min"]')!;
  const maxInput = element.querySelector<HTMLInputElement>('[data-testid="options-scope-dte-max"]')!;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(minInput, min); minInput.dispatchEvent(new Event("input", { bubbles: true }));
    setter.call(maxInput, max); maxInput.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function applyScope() {
  const button = element.querySelector<HTMLButtonElement>('[data-testid="options-scope-apply"]')!;
  await act(async () => { button.click(); });
}
async function cancelScope() {
  const button = element.querySelector<HTMLButtonElement>('[data-testid="options-scope-cancel"]')!;
  await act(async () => { button.click(); });
}
function issues() { return element.querySelector('[data-testid="options-scope-issues"]')?.textContent ?? ""; }
function applyButton() { return element.querySelector<HTMLButtonElement>('[data-testid="options-scope-apply"]')!; }
async function changeNorm(value: "global" | "column") {
  const select = element.querySelector<HTMLSelectElement>('[data-testid="options-scope-norm"]');
  expect(select).not.toBeNull();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(select, value);
    select!.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function changeWindow(value: string) {
  const select = element.querySelector<HTMLSelectElement>('[data-testid="options-scope-window"]')!;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
function fromInput() { return element.querySelector<HTMLInputElement>('[data-testid="options-scope-from"]')!; }
function toInput() { return element.querySelector<HTMLInputElement>('[data-testid="options-scope-to"]')!; }
function minInput() { return element.querySelector<HTMLInputElement>('[data-testid="options-scope-dte-min"]')!; }
function maxInput() { return element.querySelector<HTMLInputElement>('[data-testid="options-scope-dte-max"]')!; }

describe("PP2-UI-c (u1) matrixForExactScope", () => {
  it("keeps only SxE cells, filters declared axes, preserves derived-grid, and does not mutate input", () => {
    const declared = declaredFixture();
    const before = JSON.stringify(declared);
    const S = [101, 102, 103] as const;
    const E = ["2026-07-09", "2026-07-10"] as const;
    const result = matrixForExactScope(declared, S, E);
    expect(JSON.stringify(declared)).toBe(before); // no mutation
    // Declared strikes are ascending in the doc; the function preserves that order.
    expect(result.strikes).toEqual([101, 102, 103]);
    expect(result.expiries).toEqual(["2026-07-09", "2026-07-10"]); // declared filtered to E
    expect(result.cells!.filter((c) => c.strike === 102 && c.expiry === "2026-07-10")).toHaveLength(0); // the absent position stays absent
    expect(result.cells!.filter((c) => c.strike === 103 && c.expiry === "2026-07-09").length).toBeGreaterThan(0); // in-range kept
    expect(result.cells!.some((c) => c.strike === 100 || c.strike === 104 || c.expiry === "2026-07-16")).toBe(false);
    // Derived-grid (no declared axes) — never rewritten to "declared-grid"
    const derived = { ...declaredFixture(), strikes: undefined, expiries: undefined } as Parameters<typeof matrixForExactScope>[0];
    const derivedResult = matrixForExactScope(derived, [101], ["2026-07-09"]);
    expect(derivedResult.strikes).toBeUndefined();
    expect(derivedResult.expiries).toBeUndefined();
  });
  it("exports a finite positive windowPct that excludes no strike", () => {
    expect(Number.isFinite(EXACT_WINDOW_PCT)).toBe(true);
    expect(EXACT_WINDOW_PCT).toBeGreaterThan(0);
    expect(EXACT_WINDOW_PCT).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("PP2-UI-c (u2) exact mode UI appears with prefilled fields and pending edits", () => {
  it("renders the radio, prefills from the applied scope, and pending edits do not change the grid", async () => {
    await renderOnce(declaredFixture());
    const totalBefore = element.querySelector('[data-options-total]')?.textContent;
    const modeBefore = element.querySelector('[data-options-scope-mode]')?.getAttribute('data-options-scope-mode');
    expect(modeBefore).toBe("preset");
    await openScope(); await pickMode("exact");
    expect(element.querySelector('[data-testid="options-scope-editor"]')).not.toBeNull();
    // The four inputs are present and prefill from the applied scope
    expect(fromInput()).not.toBeNull();
    expect(toInput()).not.toBeNull();
    expect(minInput()).not.toBeNull();
    expect(maxInput()).not.toBeNull();
    expect(fromInput().value).toBe("100");
    expect(toInput().value).toBe("104");
    expect(minInput().value).toBe("0");
    expect(maxInput().value).toBe("7");
    // Editing while editing must not change the applied grid or scope-mode
    await typeFromTo("101", "103");
    expect(element.querySelector('[data-options-scope]')?.getAttribute('data-options-scope')).toBe("editing");
    expect(element.querySelector('[data-options-total]')?.textContent).toBe(totalBefore);
    expect(element.querySelector('[data-options-scope-mode]')?.getAttribute('data-options-scope-mode')).toBe(modeBefore);
  });
});

describe("PP2-UI-c (u3) invalid drafts block Apply and never zero the map", () => {
  const cases: Array<{ label: string; from: string; to: string; dteMin: string; dteMax: string; expectIn: string; ariaInputs: string[]; noInput?: boolean }> = [
    { label: "From empty",      from: "",     to: "104", dteMin: "",   dteMax: "",   expectIn: "From",    ariaInputs: ["from"] },
    { label: "abc",             from: "abc",  to: "104", dteMin: "",   dteMax: "",   expectIn: "From",    ariaInputs: ["from"] },
    { label: "0",               from: "0",    to: "104", dteMin: "",   dteMax: "",   expectIn: "positive", ariaInputs: ["from", "to"] },
    { label: "From > To",       from: "104",  to: "100", dteMin: "",   dteMax: "",   expectIn: "exceed",   ariaInputs: ["from", "to"] },
    { label: "Min days 1.5",    from: "100",  to: "104", dteMin: "1.5", dteMax: "",   expectIn: "whole",    ariaInputs: ["min", "max"] },
    { label: "Min > Max days",  from: "100",  to: "104", dteMin: "10", dteMax: "5",  expectIn: "Min days", ariaInputs: ["min", "max"] },
    { label: "no strikes",      from: "900",  to: "901", dteMin: "",   dteMax: "",   expectIn: "strikes", ariaInputs: [], noInput: true },
    { label: "no expiries",     from: "100",  to: "104", dteMin: "100", dteMax: "200", expectIn: "expiries", ariaInputs: [], noInput: true },
  ];
  for (const c of cases) {
    it(`${c.label} — Apply disabled, sentence visible, grid unchanged`, async () => {
      await renderOnce(declaredFixture());
      const totalBefore = element.querySelector('[data-options-total]')?.textContent;
      await openScope(); await pickMode("exact");
      await typeFromTo(c.from, c.to);
      await typeDte(c.dteMin, c.dteMax);
      expect(applyButton().disabled).toBe(true);
      expect(issues()).toContain(c.expectIn);
      expect(element.querySelector('[data-options-total]')?.textContent).toBe(totalBefore);
      // aria-invalid is set on the right input(s); for code groups with no input, nothing is marked.
      const inv = [fromInput(), toInput(), minInput(), maxInput()];
      for (let i = 0; i < inv.length; i++) {
        const kind = ["from", "to", "min", "max"][i];
        const expect_aria = c.ariaInputs.includes(kind);
        expect(inv[i].getAttribute("aria-invalid")).toBe(expect_aria ? "true" : "false");
        if (expect_aria) expect(inv[i].getAttribute("aria-describedby")).toBe("options-scope-issues");
      }
    });
  }
});

describe("PP2-UI-c (u4) a valid Apply rewires the grid, total, dominant and scope mode", () => {
  it("applies exact bounds, shows denominator, dominant inside bounds, and returns focus", async () => {
    await renderOnce(declaredFixture());
    await openScope(); await pickMode("exact");
    await typeFromTo("100", "104");
    await typeDte("0", "7");
    expect(applyButton().disabled).toBe(false);
    await applyScope();
    expect(element.querySelector('[data-testid="options-scope-editor"]')).toBeNull();
    expect(element.querySelector('[data-options-scope]')?.getAttribute('data-options-scope')).toBe("applied");
    expect(element.querySelector('[data-options-scope-mode]')?.getAttribute('data-options-scope-mode')).toBe("exact");
    // Grid: 5 strikes (all five) x 3 expiries (0, 1, 7 DTE) = 15 positions. (102, 2026-07-10) is the absent position.
    const rowCount = element.querySelectorAll('[data-options-grid] tbody tr').length;
    expect(rowCount).toBe(5);
    const colCount = element.querySelectorAll('[data-options-grid] thead th').length - 1;
    expect(colCount).toBe(3);
    // [data-options-total] denominator: known/expected = 14/15; the absent position is "missing" not zero.
    // The strong is the bare formatted value (a confident 14/15 belongs in the small).
    const summary = element.querySelector('[data-options-total]')?.parentElement?.textContent ?? "";
    expect(summary).toMatch(/14\/15/);
    // The measured zero (100, 2026-07-09) is known.
    const measuredZero = element.querySelector<HTMLButtonElement>('[data-options-grid] button[data-value="0"]');
    expect(measuredZero).not.toBeNull();
    // Dominant node is inside the bounds.
    const dominant = element.querySelector('[data-testid="options-dominant-node"]');
    expect(dominant).not.toBeNull();
    expect(dominant!.getAttribute("data-strike")).toBe("103");
    // scopeMeta reads "100–104 · 0–7 days to expiry · Global scale" (preset days unit)
    expect(element.querySelector('[data-testid="options-scope-meta"]')?.textContent ?? "").toMatch(/100.*104.*0.*7.*days/i);
    // Focus is on the toggle.
    expect(document.activeElement?.getAttribute("data-testid")).toBe("options-scope-toggle");
  });
});

describe("PP2-UI-c (u5) cancel and Escape restore exact edits and return focus", () => {
  for (const lang of ["en", "zh"] as const) {
    for (const action of ["cancel", "escape"] as const) {
      it(`${lang} — ${action} restores mode, four fields and focus`, async () => {
        await renderOnce(declaredFixture(), lang);
        await openScope(); await pickMode("exact");
        await typeFromTo("101", "103");
        await typeDte("1", "3");
        expect(fromInput().value).toBe("101");
        if (action === "escape") {
          await act(async () => { fromInput().focus(); fromInput().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
        } else {
          await cancelScope();
        }
        expect(element.querySelector('[data-testid="options-scope-editor"]')).toBeNull();
        expect(element.querySelector('[data-options-scope-mode]')?.getAttribute('data-options-scope-mode')).toBe("preset");
        // Reopen: back to preset mode with the original prefilled (still preset) values.
        await openScope();
        expect((element.querySelector<HTMLInputElement>('[data-testid="options-scope-mode-preset"]')!).checked).toBe(true);
        expect((element.querySelector<HTMLInputElement>('[data-testid="options-scope-mode-exact"]')!).checked).toBe(false);
        expect(element.querySelector('[data-testid="options-scope-from"]')).toBeNull(); // preset mode: no exact inputs
        expect(document.activeElement?.getAttribute("data-testid")).toBe("options-scope-toggle");
        // Switching back to exact must re-prefill from the APPLIED scope, not the
        // typed-but-uncommitted "101"/"103"/"1"/"3".
        await pickMode("exact");
        expect(fromInput().value).toBe("100");
        expect(toInput().value).toBe("104");
        expect(minInput().value).toBe("0");
        expect(maxInput().value).toBe("7");
      });
    }
  }
});

describe("PP2-UI-c (u6) 0–0 days selects only the session expiry", () => {
  it("with the session expiry present, the column is the session column alone", async () => {
    await renderOnce(declaredFixture());
    await openScope(); await pickMode("exact");
    await typeFromTo("100", "104");
    await typeDte("0", "0");
    expect(applyButton().disabled).toBe(false);
    await applyScope();
    const headers = element.querySelectorAll('[data-options-grid] thead th');
    expect(headers.length - 1).toBe(1); // first th is the strike column label
    expect(headers[1]?.textContent ?? "").toContain("07-09");
  });
  it("with no same-day expiry, Apply is disabled and the no_expiries sentence shows", async () => {
    await renderOnce(declaredFixture(["2026-07-08", "2026-07-10", "2026-07-16", "2026-08-21"]));
    await openScope(); await pickMode("exact");
    await typeFromTo("100", "104");
    await typeDte("0", "0");
    expect(applyButton().disabled).toBe(true);
    expect(issues().toLowerCase()).toContain("expir");
    // The nearest later expiry (2026-07-10) is never silently promoted to 0DTE.
    const headers = [...element.querySelectorAll('[data-options-grid] thead th')];
    expect(headers.some((h) => h.textContent?.includes("07-10"))).toBe(false);
  });
});

describe("PP2-UI-c (u7) selection outside the exact scope shows the outside path; restoring brings it back", () => {
  it("selects, narrows outside, restores inside", async () => {
    await renderOnce(declaredFixture());
    const cell = element.querySelector<HTMLButtonElement>('[data-options-grid] button[aria-label^="102,"]')!;
    expect(cell).toBeTruthy();
    await act(async () => { cell.click(); });
    expect(cell.getAttribute("aria-pressed")).toBe("true");
    await openScope(); await pickMode("exact");
    // Range excludes 102 by clipping From>To=101 — but inverted; use a narrower band that excludes 102.
    await typeFromTo("100", "101");
    await typeDte("0", "7");
    await applyScope();
    expect(element.querySelector('[data-testid="options-selection-outside"]')).not.toBeNull();
    expect(element.querySelector('[data-options-grid] button[aria-pressed="true"]')).toBeNull();
    // Restore a scope that contains 102 again.
    await openScope(); await pickMode("exact");
    await typeFromTo("100", "104");
    await typeDte("0", "7");
    await applyScope();
    const restored = element.querySelector<HTMLButtonElement>('[data-options-grid] button[aria-label^="102,"]');
    expect(restored).not.toBeNull();
    expect(restored!.getAttribute("aria-pressed")).toBe("true");
    expect(element.querySelector('[data-testid="options-selection-outside"]')).toBeNull();
  });
});

describe("PP2-UI-c (u8) snapshot re-qualification against the new session", () => {
  function queueMatrix(reads: unknown[]) {
    const docs = [...reads];
    fetchSnapshot.mockImplementation((feed: string) => {
      if (typeof feed === "string" && feed.startsWith("matrix:")) {
        const next = docs.shift();
        return Promise.resolve(asData(next ?? docs[docs.length - 1]));
      }
      return Promise.resolve({ status: "absent" });
    });
  }
  async function refresh() {
    const button = [...element.querySelectorAll<HTMLButtonElement>("button")]
      .find((b) => (b.getAttribute("aria-label") ?? b.textContent ?? "").replace(/\s+/g, " ").trim() === "Refresh snapshot");
    if (!button) throw new Error("no refresh button");
    await act(async () => { button.click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  }

  it("a newer one-day-later session shifts the bounded column set", async () => {
    const docA = declaredFixture();
    // Build a parallel "session 2026-07-10" doc with the same strikes and shifted expiries.
    const docC = {
      schema: "options_structure.matrix/v1", root: "SPY", spot: 102,
      asof: "2026-07-10T21:04:11.000000+00:00", _build_meta: { asof_date: "2026-07-10" },
      strikes: [...STRIKES], expiries: ["2026-07-10", "2026-07-11", "2026-07-17"],
      cells: [
        measured(100, "2026-07-10", 0),
        measured(101, "2026-07-10", 1_000_000),
        measured(103, "2026-07-10", 2_000_000),
        measured(104, "2026-07-10", 500_000),
      ],
    };
    queueMatrix([docA, docC]);
    await act(async () => root.render(<Harness />));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    // Apply exact dteMin=0, dteMax=0 against the original session 2026-07-09.
    await openScope(); await pickMode("exact");
    await typeFromTo("100", "104");
    await typeDte("0", "0");
    await applyScope();
    let headers = [...element.querySelectorAll('[data-options-grid] thead th')];
    expect(headers.length - 1).toBe(1);
    expect(headers[1]?.textContent ?? "").toContain("07-09");
    // Queue the newer doc and apply it. A cell must be selected so the queue holds.
    const cell = element.querySelector<HTMLButtonElement>('[data-options-grid] button[data-value]:not([data-value="missing"])')!;
    expect(cell).toBeTruthy();
    await act(async () => { cell.click(); });
    await refresh();
    const banner = element.querySelector('[data-testid="options-newer-snapshot"]');
    expect(banner).not.toBeNull();
    const applyBtn = element.querySelector<HTMLButtonElement>('[data-testid="options-apply-newer"]')!;
    await act(async () => { applyBtn.click(); });
    expect(element.querySelector('[data-testid="options-newer-snapshot"]')).toBeNull();
    // After applying the newer session, the only-in-scope column shifts to 2026-07-10.
    headers = [...element.querySelectorAll('[data-options-grid] thead th')];
    expect(headers[1]?.textContent ?? "").toContain("07-10");
  });

  it("a newer session with no expiry in range renders options-scope-empty with the sentence and no total", async () => {
    const docA = declaredFixture();
    // Future snapshot: session 2026-08-22, expiries are all >= 24 days out so the
    // applied exact dte [0,7] no longer matches anything in the new session.
    const future = {
      schema: "options_structure.matrix/v1", root: "SPY", spot: 102,
      asof: "2026-08-22T21:04:11.000000+00:00", _build_meta: { asof_date: "2026-08-22" },
      strikes: [...STRIKES], expiries: ["2026-09-15", "2026-10-22", "2026-11-21"],
      cells: [
        measured(100, "2026-09-15", 1),
        measured(101, "2026-10-22", 1),
        measured(102, "2026-11-21", 1),
      ],
    };
    queueMatrix([docA, future]);
    await act(async () => root.render(<Harness />));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await openScope(); await pickMode("exact");
    await typeFromTo("100", "104");
    await typeDte("0", "7");
    await applyScope();
    expect(element.querySelector('[data-options-grid]')).not.toBeNull();
    // Select a cell so the newer build queues instead of replacing the live snapshot.
    const cell = element.querySelector<HTMLButtonElement>('[data-options-grid] button[data-value]:not([data-value="missing"])')!;
    await act(async () => { cell.click(); });
    await refresh();
    const applyBtn = element.querySelector<HTMLButtonElement>('[data-testid="options-apply-newer"]')!;
    expect(applyBtn).not.toBeNull();
    await act(async () => { applyBtn.click(); });
    // After applying: no expiry in [0,7] days of 2026-08-22 → options-scope-empty
    const empty = element.querySelector('[data-testid="options-scope-empty"]');
    expect(empty).not.toBeNull();
    expect(empty?.textContent ?? "").toMatch(/expir/i);
    expect(element.querySelector('[data-options-grid]')).toBeNull();
    expect(element.querySelector('[data-options-total]')).toBeNull();
  });
});

describe("PP2-UI-c (u9) localStorage never carries the exact strings; remount under a different root starts in preset", () => {
  it("onPrefs is never called with the four exact-mode strings; a remount with another root starts in preset mode", async () => {
    const onPrefs = vi.fn();
    await renderOnce(declaredFixture(), "en", { onPrefs });
    await openScope(); await pickMode("exact");
    await typeFromTo("100", "104");
    await typeDte("0", "7");
    await applyScope();
    const calls = onPrefs.mock.calls.map((c) => JSON.stringify(c[0])).join("\n");
    expect(calls).not.toContain('"from":"100"');
    expect(calls).not.toContain('"to":"104"');
    expect(calls).not.toContain('"dteMin":"0"');
    expect(calls).not.toContain('"dteMax":"7"');
    // Remount with a different root: the new instance starts in preset mode with no exact fields.
    await act(async () => root.unmount());
    element = document.createElement("div"); document.body.appendChild(element); root = createRoot(element);
    fetchSnapshot.mockResolvedValue(asData({ ...declaredFixture(), root: "QQQ" }));
    await act(async () => root.render(<Harness root="QQQ" />));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(element.querySelector('[data-options-scope-mode]')?.getAttribute('data-options-scope-mode')).toBe("preset");
    await openScope();
    expect(element.querySelector('[data-testid="options-scope-from"]')).toBeNull();
  });
});

describe("PP2-UI-c (u10) a one-strike range renders one row", () => {
  it("From = To = 102 with empty dte bounds is valid and renders one row", async () => {
    await renderOnce(declaredFixture());
    await openScope(); await pickMode("exact");
    await typeFromTo("102", "102");
    await typeDte("", "");
    expect(applyButton().disabled).toBe(false);
    await applyScope();
    const rowCount = element.querySelectorAll('[data-options-grid] tbody tr').length;
    expect(rowCount).toBe(1);
    expect(element.querySelector('[data-options-grid] tbody th')?.textContent ?? "").toContain("102");
  });
});

// PP2-UI-c repair 1 (R1 norm in exact scope, R2 empty issue region).
describe("PP2-UI-c repair 1 (n1) one norm select in exact mode", () => {
  it("opens the editor, picks exact mode, and shows exactly one options-scope-norm", async () => {
    await renderOnce(declaredFixture());
    await openScope(); await pickMode("exact");
    const norms = element.querySelectorAll('[data-testid="options-scope-norm"]');
    expect(norms.length).toBe(1);
    expect((norms[0] as HTMLSelectElement).tagName).toBe("SELECT");
  });
});

describe("PP2-UI-c repair 1 (n2a) preset→exact apply commits only the norm change", () => {
  it("onPrefs is called once with the then-current prefs and only norm replaced", async () => {
    const onPrefs = vi.fn();
    await renderOnce(declaredFixture(), "en", { onPrefs });
    await openScope();
    await changeWindow("6");
    await pickMode("exact");
    await typeFromTo("100", "104");
    await typeDte("0", "7");
    await changeNorm("column");
    expect(applyButton().disabled).toBe(false);
    await applyScope();
    expect(onPrefs).toHaveBeenCalledTimes(1);
    expect(onPrefs).toHaveBeenLastCalledWith({ expiries: "3", window: 25, norm: "column" });
    expect(element.querySelector('[data-options-scope-mode]')?.getAttribute("data-options-scope-mode")).toBe("exact");
  });
});

describe("PP2-UI-c repair 1 (n2b) exact-apply with a norm-only change commits a single norm-replaced prefs call", () => {
  it("after the first apply, reopening and changing only the norm enables Apply and calls onPrefs once with only norm replaced", async () => {
    const onPrefs = vi.fn();
    // Use PrefsHarness so the post-apply prefs flow back into the next render.
    fetchSnapshot.mockResolvedValue(asData(declaredFixture()));
    await act(async () => root.render(<PrefsHarness initial={{ expiries: "3", window: 25, norm: "global" }} onPrefs={onPrefs} />));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    // First apply: switch to exact, type valid fields, change norm to "column", Apply.
    await openScope(); await pickMode("exact");
    await typeFromTo("100", "104"); await typeDte("0", "7");
    await changeNorm("column");
    await applyScope();
    expect(onPrefs).toHaveBeenCalledTimes(1);
    expect(onPrefs).toHaveBeenLastCalledWith({ expiries: "3", window: 25, norm: "column" });
    expect(element.querySelector('[data-options-scope-mode]')?.getAttribute("data-options-scope-mode")).toBe("exact");
    // Second apply: reopen, change ONLY the norm to "global", Apply.
    onPrefs.mockClear();
    await openScope();
    expect(element.querySelector('[data-testid="options-scope-norm"]')).not.toBeNull();
    await changeNorm("global");
    expect(applyButton().disabled).toBe(false);
    await applyScope();
    expect(onPrefs).toHaveBeenCalledTimes(1);
    expect(onPrefs).toHaveBeenLastCalledWith({ expiries: "3", window: 25, norm: "global" });
    expect(element.querySelector('[data-options-scope-mode]')?.getAttribute("data-options-scope-mode")).toBe("exact");
  });
});

describe("PP2-UI-c repair 1 (n3) norm change is discarded by Cancel and Escape", () => {
  for (const action of ["cancel", "escape"] as const) {
    it(`${action} restores the norm select to the applied value and never calls onPrefs`, async () => {
      const onPrefs = vi.fn();
      await renderOnce(declaredFixture(), "en", { onPrefs });
      await openScope(); await pickMode("exact");
      await changeNorm("column");
      if (action === "escape") {
        const norm = element.querySelector<HTMLSelectElement>('[data-testid="options-scope-norm"]')!;
        await act(async () => { norm.focus(); norm.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
      } else {
        await cancelScope();
      }
      expect(element.querySelector('[data-testid="options-scope-editor"]')).toBeNull();
      expect(onPrefs).not.toHaveBeenCalled();
      // Reopen: the norm select shows the applied prefs.norm.
      await openScope();
      const select = element.querySelector<HTMLSelectElement>('[data-testid="options-scope-norm"]')!;
      expect(select.value).toBe("global");
    });
  }
});

describe("PP2-UI-c repair 1 (n4) no empty issue region renders while data is still loading", () => {
  it("with no data, opening the editor in exact mode renders neither an issues element nor an empty status region", async () => {
    // The MatrixCompanion derives `data` from the snapshot; an absent read leaves
    // the editor openable but with no parseDraft. Today that path renders an
    // empty `options-scope-issues` <p> — the bug this case guards against.
    fetchSnapshot.mockResolvedValue({ status: "absent" });
    await act(async () => root.render(<Harness />));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await openScope(); await pickMode("exact");
    expect(element.querySelector('[data-testid="options-scope-issues"]')).toBeNull();
    const statusInEditor = element.querySelector('[data-testid="options-scope-editor"] [role="status"]');
    expect(statusInEditor).toBeNull();
  });
});