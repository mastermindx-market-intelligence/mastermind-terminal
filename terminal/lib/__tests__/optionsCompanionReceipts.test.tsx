// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MatrixCompanion, type MatrixPreferences } from "@/components/options-companion/MatrixCompanion";
import { optionsT } from "@/components/options-companion/optionsStrings";
import { LangProvider } from "@/lib/i18n";
const { fetchSnapshot } = vi.hoisted(() => ({ fetchSnapshot: vi.fn() }));
vi.mock("@/lib/flowClientCache", () => ({ flowGetResult: fetchSnapshot, flowGetFresh: fetchSnapshot }));
const asData = (data: unknown) => ({ status: "data" as const, data });
let element: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); fetchSnapshot.mockReset();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  element = document.createElement("div"); document.body.appendChild(element); root = createRoot(element);
});
afterEach(async () => { await act(async () => root.unmount()); element.remove(); vi.useRealTimers(); });

const SESSION = "2026-07-09";
const ISO_A = "2026-07-09T21:04:11.412870+00:00";
const ISO_B = "2026-07-09T21:35:00.000000+00:00";
const ISO_C = "2026-07-10T00:05:00.000000+00:00";
const SESSION_C = "2026-07-10";
const fullSource = (session = SESSION) => ({
  eod: session, greeks: session, oi_publication: session,
  previous_oi_publication: "2026-07-08", latest_oi_publication: session,
});

function doc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "options_structure.matrix/v1", root: "NVDA", spot: 193, asof: ISO_A,
    _build_meta: { asof_date: SESSION },
    cells: [
      { strike: 192, expiry: SESSION, gex: 1_000_000, call_oi: 2, put_oi: 1 },
      { strike: 194, expiry: SESSION, gex: 2_000_000, call_oi: 3, put_oi: 2 },
      { strike: 196, expiry: SESSION, gex: -500_000, call_oi: 1, put_oi: 3 },
    ],
    ...overrides,
  };
}

function Harness({ lang = "en" as "en" | "zh", onPin }: { lang?: "en" | "zh"; onPin?: ReturnType<typeof vi.fn> }) {
  const [prefs, setPrefs] = React.useState<MatrixPreferences>({ expiries: "3", window: 25, norm: "global" });
  const noop = React.useCallback(() => {}, []);
  const pin = onPin ?? noop;
  return <LangProvider>
    <MatrixCompanion root="NVDA" metric="gex" prefs={prefs} onPrefs={setPrefs} t={optionsT(lang)}
      pinned={null} onPin={pin} replayActive={false} />
  </LangProvider>;
}

async function renderOnce(payload: unknown, lang: "en" | "zh" = "en", onPin?: ReturnType<typeof vi.fn>) {
  fetchSnapshot.mockResolvedValue(asData(payload));
  await act(async () => root.render(<Harness lang={lang} onPin={onPin} />));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

function openReceipts() {
  const details = element.querySelector<HTMLDetailsElement>('[data-testid="options-receipts"]');
  if (!details) throw new Error("options-receipts missing");
  act(() => { details.open = true; details.dispatchEvent(new Event("toggle", { bubbles: true })); });
}

const buttonsByLabel = (name: string): HTMLButtonElement[] =>
  [...element.querySelectorAll<HTMLButtonElement>("button")]
    .filter((button) => (button.getAttribute("aria-label") ?? button.textContent ?? "").replace(/\s+/g, " ").trim() === name);

describe("PP2-UI-a source receipts", () => {
  it("(a) full source_dates renders each clock in its row and both previous/latest rows", async () => {
    await renderOnce(doc({ asof: ISO_A, _build_meta: { asof_date: SESSION, source_dates: fullSource() } }));
    openReceipts();
    const details = element.querySelector('[data-testid="options-receipts"]')!;
    const buildTime = details.querySelector("time")!;
    expect(buildTime.getAttribute("dateTime")).toBe(ISO_A);
    expect(buildTime.textContent).toBe(ISO_A);
    expect(details.textContent).toContain("End-of-day prices");
    expect(details.textContent).toContain(SESSION);
    expect(details.textContent).toContain("Option greeks");
    expect(details.textContent).toContain("Open-interest publication");
    expect(details.textContent).toContain("Previous open-interest publication");
    expect(details.textContent).toContain("Latest open-interest publication");
    expect(details.textContent).toContain("2026-07-08");
  });

  it("(b) no source_dates: only Map build shows the asof; spot clock always unavailable; previous/latest absent", async () => {
    await renderOnce(doc({ asof: ISO_A, _build_meta: { asof_date: SESSION } }));
    openReceipts();
    const details = element.querySelector('[data-testid="options-receipts"]')!;
    const buildTime = details.querySelector("time")!;
    expect(buildTime.getAttribute("dateTime")).toBe(ISO_A);
    expect(buildTime.textContent).toBe(ISO_A);
    expect(details.textContent).toContain("End-of-day prices");
    expect(details.textContent).toContain("unavailable");
    expect(details.textContent).toContain("Option greeks");
    expect(details.textContent).toContain("Open-interest publication");
    expect(details.textContent).toContain("Spot price clock");
    expect(details.textContent).not.toContain("Previous open-interest publication");
    expect(details.textContent).not.toContain("Latest open-interest publication");
  });

  it("(c) eod differs from session: warning marker and mixed line; equal dates neither exists", async () => {
    const mismatch = doc({ _build_meta: { asof_date: SESSION, source_dates: { ...fullSource(SESSION), eod: "2026-07-08" } } });
    await renderOnce(mismatch);
    openReceipts();
    const summary1 = element.querySelector('[data-testid="options-receipts"] > summary')!;
    expect(summary1.textContent).toContain("⚠");
    expect(element.querySelector('[data-testid="options-receipts-mixed"]')?.textContent).toContain("Source dates differ from the map session.");
  });

  it("(c2) equal dates: no warning marker, no mixed line", async () => {
    const equal = doc({ _build_meta: { asof_date: SESSION, source_dates: fullSource(SESSION) } });
    await renderOnce(equal);
    openReceipts();
    const summary = element.querySelector('[data-testid="options-receipts"] > summary')!;
    expect(summary.textContent).not.toContain("⚠");
    expect(element.querySelector('[data-testid="options-receipts-mixed"]')).toBeNull();
  });

  it("(d) unzoned asof and impossible greeks both render as unavailable", async () => {
    const broken = doc({ asof: "2026-07-09T21:04:11", _build_meta: { asof_date: SESSION, source_dates: { ...fullSource(), greeks: "2026-02-30" } } });
    await renderOnce(broken);
    openReceipts();
    const details = element.querySelector('[data-testid="options-receipts"]')!;
    const buildTime = details.querySelector("time")!;
    expect(buildTime.textContent).toBe("unavailable");
    expect(details.textContent).toContain("Option greeks");
    expect(details.textContent).toContain("unavailable");
  });

  it("(e) ZH render reads 数据来源, 不可用, ZH row labels; no new string contains OI", async () => {
    await renderOnce(doc({ asof: ISO_A, _build_meta: { asof_date: SESSION } }), "zh");
    openReceipts();
    const details = element.querySelector('[data-testid="options-receipts"]')!;
    expect(details.textContent).toContain("数据来源");
    expect(details.textContent).toContain("不可用");
    expect(details.textContent).toContain("热力图生成时间");
    expect(details.textContent).toContain("收盘价格");
    expect(details.textContent).toContain("期权希腊值");
    expect(details.textContent).toContain("持仓量发布日");
    expect(details.textContent).toContain("现价时间");
    // Confirm what the production fixture actually publishes; receipts pull from it.
    const receiptsText = Object.values({
      build: ISO_A, eod: null, greeks: null, oiPublication: null,
      previousOiPublication: null, latestOiPublication: null, spotClock: null,
    }).join(" ");
    expect(receiptsText).not.toMatch(/\bOI\b/);
  });
});

describe("PP2-UI-a held newer snapshot", () => {
  function queueMatrix(reads: unknown[]) {
    const docs = reads;
    fetchSnapshot.mockImplementation((feed: string) => {
      if (typeof feed === "string" && feed.startsWith("matrix:")) {
        const next = docs.shift();
        return Promise.resolve(asData(next ?? docs[docs.length - 1]));
      }
      return Promise.resolve({ status: "absent" });
    });
  }

  async function selectFirstCell() {
    const cell = element.querySelector<HTMLButtonElement>('[data-options-grid] button[data-value]:not([data-value="missing"])');
    if (!cell) throw new Error("no cell");
    await act(async () => cell.click());
  }

  async function refresh() {
    const button = buttonsByLabel("Refresh snapshot")[0];
    if (!button) throw new Error("no refresh button");
    await act(async () => button.click());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  }

  it("(f) newer build is queued while a node is selected and the displayed values stay on A", async () => {
    const onPin = vi.fn();
    const docA = doc();
    const docB = doc({ asof: ISO_B, cells: [{ strike: 192, expiry: SESSION, gex: 1_000_000, call_oi: 2, put_oi: 1 },
      { strike: 194, expiry: SESSION, gex: 9_999_000, call_oi: 3, put_oi: 2 },
      { strike: 196, expiry: SESSION, gex: -500_000, call_oi: 1, put_oi: 3 }] });
    queueMatrix([docA, docB]);
    await act(async () => root.render(<Harness onPin={onPin} />));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const cell192 = element.querySelector<HTMLButtonElement>('[data-options-grid] button[aria-label^="192,"]');
    expect(cell192).toBeTruthy();
    await act(async () => cell192!.click());
    expect(onPin).toHaveBeenCalled();
    const cellTextBefore = element.querySelector<HTMLButtonElement>('[data-options-grid] button[aria-label^="194,"]')?.textContent ?? "";
    expect(cellTextBefore).toContain("2M");
    onPin.mockClear();
    await refresh();
    const banner = element.querySelector('[data-testid="options-newer-snapshot"]');
    expect(banner).toBeTruthy();
    expect(banner?.textContent).toContain(ISO_B);
    const cellTextAfter = element.querySelector<HTMLButtonElement>('[data-options-grid] button[aria-label^="194,"]')?.textContent ?? "";
    expect(cellTextAfter).toBe(cellTextBefore);
    const strip = element.querySelector('[data-testid="options-selected-summary"]')?.textContent ?? "";
    expect(strip).toContain("192");
    expect(onPin).not.toHaveBeenCalledWith(null);
  });

  it("(g) applying the queued snapshot shows B's values, B's receipts, clears the selection and calls onPin(null)", async () => {
    const onPin = vi.fn();
    const docA = doc();
    const docB = doc({ asof: ISO_B, _build_meta: { asof_date: SESSION, source_dates: fullSource() }, cells: [
      { strike: 192, expiry: SESSION, gex: 1_000_000, call_oi: 2, put_oi: 1 },
      { strike: 194, expiry: SESSION, gex: 9_999_000, call_oi: 3, put_oi: 2 },
      { strike: 196, expiry: SESSION, gex: -500_000, call_oi: 1, put_oi: 3 }] });
    queueMatrix([docA, docB]);
    await act(async () => root.render(<Harness onPin={onPin} />));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await selectFirstCell();
    await refresh();
    const applyBtn = element.querySelector<HTMLButtonElement>('[data-testid="options-apply-newer"]');
    expect(applyBtn).toBeTruthy();
    onPin.mockClear();
    await act(async () => applyBtn!.click());
    expect(element.querySelector('[data-testid="options-newer-snapshot"]')).toBeNull();
    openReceipts();
    const details = element.querySelector('[data-testid="options-receipts"]')!;
    expect(details.querySelector("time")?.textContent).toBe(ISO_B);
    expect(details.textContent).toContain(SESSION);
    const strip = element.querySelector('[data-testid="options-selected-summary"]')?.textContent ?? "";
    expect(strip).toContain("Select a cell to inspect");
    expect(onPin).toHaveBeenCalledWith(null);
  });

  it("(h) with no selection the newer build replaces A directly and no banner appears", async () => {
    const docA = doc();
    const docB = doc({ asof: ISO_B });
    queueMatrix([docA, docB]);
    await act(async () => root.render(<Harness />));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await refresh();
    expect(element.querySelector('[data-testid="options-newer-snapshot"]')).toBeNull();
    openReceipts();
    const details = element.querySelector('[data-testid="options-receipts"]')!;
    expect(details.querySelector("time")?.textContent).toBe(ISO_B);
  });

  it("(i) clicking Clear with a queued B applies the queued build", async () => {
    const docA = doc();
    const docB = doc({ asof: ISO_B, cells: [{ strike: 192, expiry: SESSION, gex: 1_000_000, call_oi: 2, put_oi: 1 },
      { strike: 194, expiry: SESSION, gex: 9_999_000, call_oi: 3, put_oi: 2 },
      { strike: 196, expiry: SESSION, gex: -500_000, call_oi: 1, put_oi: 3 }] });
    queueMatrix([docA, docB]);
    await act(async () => root.render(<Harness />));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await selectFirstCell();
    await refresh();
    expect(element.querySelector('[data-testid="options-newer-snapshot"]')).toBeTruthy();
    const clearBtn = buttonsByLabel("Clear selection")[0];
    await act(async () => clearBtn.click());
    expect(element.querySelector('[data-testid="options-newer-snapshot"]')).toBeNull();
    openReceipts();
    const details = element.querySelector('[data-testid="options-receipts"]')!;
    expect(details.querySelector("time")?.textContent).toBe(ISO_B);
  });

  it("(j) a queued build with a different session applies that session after apply", async () => {
    const onPin = vi.fn();
    const docA = doc();
    const docBPrime = doc({ asof: ISO_C, _build_meta: { asof_date: SESSION_C }, cells: [
      { strike: 192, expiry: SESSION_C, gex: 1_000_000, call_oi: 2, put_oi: 1 },
      { strike: 194, expiry: SESSION_C, gex: 2_000_000, call_oi: 3, put_oi: 2 },
      { strike: 196, expiry: SESSION_C, gex: -500_000, call_oi: 1, put_oi: 3 }] });
    queueMatrix([docA, docBPrime]);
    await act(async () => root.render(<Harness onPin={onPin} />));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await selectFirstCell();
    await refresh();
    const applyBtn = element.querySelector<HTMLButtonElement>('[data-testid="options-apply-newer"]');
    expect(applyBtn).toBeTruthy();
    await act(async () => applyBtn!.click());
    const session = element.querySelector("[data-options-session]")?.getAttribute("data-options-session");
    expect(session).toBe(SESSION_C);
  });
});