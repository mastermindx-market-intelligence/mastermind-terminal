// @vitest-environment jsdom
import React, { act } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OptionsCompanion from "@/components/options-companion/OptionsCompanion";
import styles from "@/components/options-companion/OptionsCompanion.module.css";
import { LangProvider } from "@/lib/i18n";
const { fetchSnapshot } = vi.hoisted(() => ({ fetchSnapshot: vi.fn() }));
vi.mock("@/lib/flowClientCache", () => ({ flowGetResult: fetchSnapshot, flowGetFresh: fetchSnapshot }));
const asData = (data: unknown) => ({ status: "data" as const, data });
let element: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); fetchSnapshot.mockReset();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  try { localStorage.removeItem("mm.optionsCompanion.v1"); } catch { /* storage is optional */ }
  element = document.createElement("div"); document.body.appendChild(element); root = createRoot(element);
});
afterEach(async () => { await act(async () => root.unmount()); element.remove(); vi.useRealTimers(); });
const doc = { schema: "options_structure.matrix/v1", root: "NVDA", spot: 193, asof: "2026-09-25T20:21:00Z",
  _build_meta: { asof_date: "2026-09-25" }, cells: [
    { strike: 192, expiry: "2026-09-25", gex: 1_000_000, call_oi: 2, put_oi: 1 },
    { strike: 194, expiry: "2026-09-25", gex: 2_000_000, call_oi: 3, put_oi: 2 },
    { strike: 194, expiry: "2026-10-02", gex: -500_000, call_oi: 1, put_oi: 3 },
    { strike: 196, expiry: "2026-10-02", gex: 250_000, call_oi: 2, put_oi: 2 },
  ] };
const NO_PIN = () => {};
const buttonsNamed = (name: string) => [...element.querySelectorAll<HTMLButtonElement>("button")]
  .filter((button) => (button.getAttribute("aria-label") ?? button.textContent ?? "").replace(/\s+/g, " ").trim() === name);

async function renderHost(host: "rail" | "page", onClose?: () => void) {
  fetchSnapshot.mockResolvedValue(asData(doc));
  await act(async () => root.render(
    <LangProvider>
      <OptionsCompanion symbol="NVDA" access="allowed" host={host} onClose={onClose} pinned={null} onPin={NO_PIN} replayActive={false} />
    </LangProvider>,
  ));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  const cell = element.querySelector<HTMLButtonElement>('[data-options-grid] button[data-value]:not([data-value="missing"])');
  expect(cell).toBeTruthy();
  await act(async () => cell!.click());
}
function pressEscape() {
  const section = element.querySelector<HTMLElement>("[data-options-companion]")!;
  const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  act(() => { section.dispatchEvent(event); });
  return event;
}

describe("options companion host", () => {
  it("rail host keeps the close button, chart pin, desk link and Escape-to-close", async () => {
    const onClose = vi.fn();
    await renderHost("rail", onClose);
    expect(element.querySelector("[data-options-companion]")?.getAttribute("data-options-host")).toBe("rail");
    expect(buttonsNamed("Close options panel")).toHaveLength(1);
    expect(buttonsNamed("Pin strike on chart")).toHaveLength(1);
    expect(element.querySelector('a[href="/options?tab=prism"]')).toBeTruthy();
    expect(pressEscape().defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("page host has no close button, no chart pin, no link back to the desk it is on, and leaves Escape to the page", async () => {
    await renderHost("page");
    const section = element.querySelector("[data-options-companion]")!;
    expect(section.getAttribute("data-options-host")).toBe("page");
    expect(section.querySelector("header")).toBeNull();
    expect(buttonsNamed("Close options panel")).toHaveLength(0);
    expect(buttonsNamed("Pin strike on chart")).toHaveLength(0);
    expect(element.querySelector('a[href^="/options?tab="]')).toBeNull();
    // The selected-node strip still offers the inspector, so the page keeps a selected-node action.
    expect(element.querySelector('[data-testid="options-selected-summary"] [data-testid="options-inspect-node"]')).toBeTruthy();
    expect(pressEscape().defaultPrevented).toBe(false);
  });

  it("puts the size container on a wrapper so the two-column map rule can apply", async () => {
    await renderHost("rail", () => {});
    expect(styles.mapHost).toBeTruthy();
    expect(styles.mapHost).not.toBe(styles.mapLayout);
    const layout = element.querySelector('[data-testid="options-map-layout"]')!;
    expect(layout.parentElement!.classList.contains(styles.mapHost)).toBe(true);
    const css = readFileSync(path.resolve(__dirname, "../../components/options-companion/OptionsCompanion.module.css"), "utf8");
    const rule = (selector: string) => css.match(new RegExp(`(^|\\n)${selector.replace(".", "\\.")}\\{([^}]*)\\}`))?.[2] ?? "";
    expect(rule(".mapHost")).toContain("container-type:inline-size");
    expect(rule(".mapLayout")).not.toContain("container-type");
    expect(css).toMatch(/@container \(min-width:640px\)\{\.mapLayout\{display:grid/);
  });

  it("lets a host size the grid without changing the rail defaults", () => {
    const css = readFileSync(path.resolve(__dirname, "../../components/shared/StrikeExpiryMatrixRail.module.css"), "utf8");
    expect(css).toContain(".scroll{min-height:180px;max-height:var(--matrix-rail-max,320px);");
    expect(css).toContain(".scroll{min-height:240px;max-height:var(--matrix-rail-max-touch,min(50svh,420px))}");
    expect(css).toContain("@media (max-width:640px){.scroll{max-height:var(--matrix-rail-max-phone,364px)}}");
  });
});
