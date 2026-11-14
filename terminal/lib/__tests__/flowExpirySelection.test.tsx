// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FILTERS, FiltersPanel, type FlowFilters } from "@/components/flowdesk/FiltersPanel";

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const makeFilters = (exp: string | null): FlowFilters => ({
  ...DEFAULT_FILTERS, exp, right: "C", minPremium: 100_000,
  dteBuckets: ["1_7d"], mnyBuckets: ["atm"],
  badges: new Set(["whale"]), detections: new Set(["FRESH"]),
});

const buttons = () => [...host.querySelectorAll<HTMLButtonElement>('[data-testid="flow-filter-exp"] button')];
const named = (name: string) => buttons().find(button => button.textContent === name)!;
const snapshot = (filters: FlowFilters) => JSON.stringify({
  ...filters, badges: [...filters.badges], detections: [...filters.detections],
});

for (const lang of ["en", "zh"] as const) {
  describe(`Flow Desk exact expiry controls in ${lang}`, () => {
    const all = lang === "zh" ? "全部到期" : "All expirations";
    const retained = lang === "zh" ? "已选到期日：Oct 23, 2026" : "Selected expiry: Oct 23, 2026";

    it("distinguishes the same month/day in different years and selects the exact value", async () => {
      const filters = makeFilters(null);
      const before = snapshot(filters);
      const onChange = vi.fn();
      const options = ["2026-10-23", "2027-10-23"];
      await act(async () => root.render(<FiltersPanel filters={filters} onFiltersChange={onChange} lang={lang} expiryOptions={options} />));
      expect(buttons().map(button => button.textContent)).toEqual([all, "Oct 23, 2026", "Oct 23, 2027"]);
      await act(async () => named("Oct 23, 2027").click());
      expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...filters, exp: "2027-10-23" });
      expect(snapshot(filters)).toBe(before);
      expect(options).toEqual(["2026-10-23", "2027-10-23"]);
    });

    it("keeps a focused saved selection through feed changes without silently changing it", async () => {
      const filters = makeFilters("2026-10-23");
      const before = snapshot(filters);
      const onChange = vi.fn();
      const render = async (expiryOptions?: string[]) => act(async () =>
        root.render(<FiltersPanel filters={filters} onFiltersChange={onChange} lang={lang} expiryOptions={expiryOptions} />));
      await render(["2026-10-23", "2027-10-23"]);
      const selected = named("Oct 23, 2026");
      selected.focus();
      for (const options of [["2027-10-23"], [], undefined]) {
        await render(options);
        expect(named(retained)).toBe(selected);
        expect(document.activeElement).toBe(selected);
        expect(selected.getAttribute("aria-pressed")).toBe("true");
        expect(named(all).getAttribute("aria-pressed")).toBe("false");
        expect(buttons().filter(button => button.getAttribute("aria-pressed") === "true")).toHaveLength(1);
      }
      await render(["2026-10-23", "2027-10-23"]);
      expect(named("Oct 23, 2026")).toBe(selected);
      expect(document.activeElement).toBe(selected);
      expect(buttons().filter(button => button.textContent?.includes("Oct 23, 2026"))).toHaveLength(1);
      expect(onChange).not.toHaveBeenCalled();
      expect(snapshot(filters)).toBe(before);
    });

    it("clears only the retained expiry through the existing All expirations control", async () => {
      const filters = makeFilters("2026-10-23");
      const before = snapshot(filters);
      const onChange = vi.fn();
      await act(async () => root.render(<FiltersPanel filters={filters} onFiltersChange={onChange} lang={lang} expiryOptions={["2027-10-23"]} />));
      expect(named(retained).getAttribute("aria-pressed")).toBe("true");
      await act(async () => named(all).click());
      expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...filters, exp: null });
      expect(snapshot(filters)).toBe(before);
    });

    it("changes a retained expiry only after an explicit choice of another available date", async () => {
      const filters = makeFilters("2026-10-23");
      const onChange = vi.fn();
      await act(async () => root.render(<FiltersPanel filters={filters} onFiltersChange={onChange} lang={lang} expiryOptions={["2027-10-23"]} />));
      expect(named(retained).getAttribute("aria-pressed")).toBe("true");
      await act(async () => named("Oct 23, 2027").click());
      expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...filters, exp: "2027-10-23" });
    });

    it.each([{ description: "empty", expiryOptions: [] }, { description: "omitted", expiryOptions: undefined }])("has no fabricated selection for an $description expiry list", async ({ expiryOptions }) => {
      const onChange = vi.fn();
      await act(async () => root.render(<FiltersPanel filters={makeFilters(null)} onFiltersChange={onChange} lang={lang} expiryOptions={expiryOptions} />));
      expect(buttons().map(button => button.textContent)).toEqual([all]);
      expect(named(all).getAttribute("aria-pressed")).toBe("true");
      expect(onChange).not.toHaveBeenCalled();
    });
  });
}
