// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MatrixCompanion, type MatrixPreferences } from "@/components/options-companion/MatrixCompanion";
import { optionsT } from "@/components/options-companion/optionsStrings";
import type { OptionsChartLevel } from "@/lib/optionsCompanion";
// Market Memory has its own transport and race tests; scope tests stay deterministic.
vi.mock("@/lib/flowClientCache", () => ({ flowGetFresh: vi.fn(async () => null) }));
const transport = vi.hoisted(() => ({ data: null as unknown }));
vi.mock("@/components/options-companion/useOptionsSnapshot", () => ({ useOptionsSnapshot: () => ({ data: transport.data, loading: false, failed: false, refresh: vi.fn() }) }));
let node: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-29T12:00:00Z"));
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
  transport.data = { schema: "options_structure.matrix/v1", root: "SPY", spot: 770, asof: "2026-09-26T00:05:00Z", _build_meta: { asof_date: "2026-09-25" }, cells: [
    { strike: 770, expiry: "2026-09-25", gex: 8e6 }, { strike: 771, expiry: "2026-09-25", gex: 1e6 },
    { strike: 770, expiry: "2026-09-28", gex: -2e6 }, { strike: 771, expiry: "2026-09-28", gex: 3e6 },
  ] };
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); vi.restoreAllMocks(); });
function target(id: string) { const el = node.querySelector<HTMLElement>('[data-testid="' + id + '"]'); expect(el).not.toBeNull(); return el!; }
async function mount(lang: "en" | "zh") {
  function Host() {
    const [prefs, onPrefs] = React.useState<MatrixPreferences>({ expiries: "3", window: 25, norm: "global" });
    const [pinned, onPin] = React.useState<OptionsChartLevel | null>(null);
    return <MatrixCompanion root="SPY" metric="gex" prefs={prefs} onPrefs={onPrefs} t={optionsT(lang)} pinned={pinned} onPin={onPin} replayActive={false} />;
  }
  await act(async () => root.render(<Host />));
}
describe.each(["en", "zh"] as const)("scope focus return in %s", (lang) => {
  it.each(["cancel", "apply", "escape"])("returns focus to opener after %s, preserving the correct draft behavior", async (action) => {
    await mount(lang); const opener = target("options-scope-toggle");
    await act(async () => { opener.focus(); opener.click(); });
    const expiry = target("options-scope-expiries") as HTMLSelectElement;
    await act(async () => { expiry.focus(); expiry.value = "0dte"; expiry.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(node.querySelector('[data-options-total]')?.textContent).toBe("+10M");
    await act(async () => {
      if (action === "escape") expiry.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      else { const button = target("options-scope-" + action); button.focus(); button.click(); }
    });
    expect(node.querySelector('[data-testid="options-scope-editor"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(node.querySelector('[data-options-total]')?.textContent).toBe(action === "apply" ? "+9M" : "+10M");
    expect(opener.getAttribute("aria-expanded")).toBe("false");
  });
});
