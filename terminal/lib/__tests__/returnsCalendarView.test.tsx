// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import ReturnsCalendar from "@/components/ReturnsCalendar";
import ReturnsPreview from "@/components/ReturnsPreview";
import type { Bar } from "../fund";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const daily = (time: string, close: number, open = close): Bar =>
  ({ time, o: open, h: Math.max(open, close), l: Math.min(open, close), c: close, v: 10 });
const picker = (zh: boolean) => (en?: string | null, cn?: string | null) =>
  zh ? (cn || en || "") : (en || cn || "");
let host: HTMLDivElement;
let root: Root;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function element<T extends Element = HTMLElement>(selector: string): T {
  const found = host.querySelector<T>(selector);
  expect(found, selector).not.toBeNull();
  return found!;
}
function neutral(node: Element) {
  expect(node.classList.contains("up")).toBe(false);
  expect(node.classList.contains("down")).toBe(false);
}
function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

describe("Returns full and compact finite-value presentation", () => {
  for (const zh of [false, true]) {
    for (const factor of ["opening gap", "open to close"]) {
      it("renders withheld full-study values neutrally: " + (zh ? "ZH " : "EN ") + factor, async () => {
        const reference = 1e-308, close = 1e308;
        const bars = [
          daily("2026-09-30", reference),
          daily("2026-10-01", close, factor === "opening gap" ? close : reference),
        ];
        await act(async () => root.render(<ReturnsCalendar symbol="BTC-USD" bars={bars} pick={picker(zh)} />));
        const month = element(".returns-month-summary .primary strong");
        expect(month.textContent).toBe("—");
        neutral(month);
        const monthNote = element(".returns-month-summary .primary small").textContent;
        expect(monthNote).toContain(zh ? "月度收益计算不可用" : "Monthly return calculation unavailable");
        expect(monthNote).toContain("2026-09-30 → 2026-10-01");
        const day = element<HTMLButtonElement>("#returns-day-2026-10-01");
        neutral(day);
        expect(day.getAttribute("aria-label")).toContain(zh ? "收益计算不可用" : "Return calculation unavailable");
        expect(day.getAttribute("aria-label")).not.toContain(zh ? "此前观察收盘价不可用" : "Previous observed close unavailable");
        neutral(element(".returns-inspector-head strong"));
        expect(element(".returns-inspector-head small").textContent)
          .toBe(zh ? "收益计算不可用" : "Return calculation unavailable");
        expect(Array.from(host.querySelectorAll(".returns-month-summary .stats b"), x => x.textContent))
          .toEqual(["1", "0", "0", "—", "—"]);
        const factors = Array.from(host.querySelectorAll(".returns-range-factors b"));
        const unavailable = factors[factor === "opening gap" ? 0 : 1];
        const zero = factors[factor === "opening gap" ? 1 : 0];
        expect(unavailable.textContent).toBe("—");
        neutral(unavailable);
        expect(zero.textContent).toBe("0.00%");
        expect(host.textContent).not.toMatch(/Infinity|NaN/);
        expect(fetchSpy).not.toHaveBeenCalled();
      });
    }

    it("renders the compact summary without a false gain: " + (zh ? "ZH" : "EN"), async () => {
      const bars = [daily("2026-09-30", 1e-308), daily("2026-10-01", 1e308)];
      const onOpen = vi.fn();
      await act(async () => root.render(<ReturnsPreview bars={bars} pick={picker(zh)} onOpen={onOpen} />));
      const month = element(".returns-preview-main strong");
      expect(month.textContent).toBe("—");
      neutral(month);
      expect(element(".returns-preview-main small").textContent)
        .toContain(zh ? "月度收益计算不可用" : "Monthly return calculation unavailable");
      const recent = Array.from(host.querySelectorAll(".returns-preview-strip > div"));
      expect(recent).toHaveLength(2);
      recent.forEach(neutral);
      expect(recent[0].textContent).toContain(zh ? "缺少参考收盘价" : "Reference close unavailable");
      expect(recent[1].textContent).toContain(zh ? "收益计算不可用" : "Return calculation unavailable");
      expect(Array.from(host.querySelectorAll(".returns-preview-counts b"), x => x.textContent))
        .toEqual(["0", "0", "1"]);
      await act(async () => element<HTMLButtonElement>(".returns-preview-head button").click());
      expect(onOpen).toHaveBeenCalledTimes(1);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("exports the displayed month through the real Export action: " + (zh ? "ZH" : "EN"), async () => {
      const bars = [
        daily("2025-10-01", 5), daily("2026-09-30", 1e-308),
        daily("2026-10-01", 1e308), daily("2026-10-02", 1e308),
        daily("2026-11-02", 1e308),
      ];
      const created: Blob[] = [];
      const createObjectURL = vi.fn((value: Blob | MediaSource) => {
        if (!(value instanceof Blob)) throw new Error("Expected the actual CSV Blob");
        created.push(value);
        return "blob:returns-test";
      });
      const revokeObjectURL = vi.fn();
      const OriginalURL = URL;
      class DownloadURL extends OriginalURL {
        static createObjectURL = createObjectURL;
        static revokeObjectURL = revokeObjectURL;
      }
      vi.stubGlobal("URL", DownloadURL);
      const downloads: Array<{ href: string; filename: string }> = [];
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
        downloads.push({ href: this.href, filename: this.download });
      });
      await act(async () => root.render(<ReturnsCalendar symbol="BTC-USD" bars={bars} pick={picker(zh)} />));
      const previous = Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
        .find(b => b.getAttribute("aria-label") === (zh ? "上月" : "Previous month"));
      expect(previous).toBeDefined();
      await act(async () => previous!.click());
      expect(element(".returns-calendar-nav strong").textContent).toContain(zh ? "2026年10月" : "October 2026");
      const exportButton = Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
        .find(b => b.textContent === (zh ? "导出 CSV" : "Export CSV"));
      expect(exportButton).toBeDefined();
      await act(async () => exportButton!.click());
      expect(created).toHaveLength(1);
      expect(created[0]).toBeInstanceOf(Blob);
      expect(created[0].type).toBe("text/csv;charset=utf-8");
      expect(downloads).toEqual([{ href: "blob:returns-test", filename: "BTC-USD-returns-2026-10.csv" }]);
      expect(revokeObjectURL).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:returns-test");
      const csv = await readBlob(created[0]);
      const rows = csv.trimEnd().split("\n").map(row => row.split(","));
      expect(rows[0]).toEqual([
        "date", "open", "high", "low", "close", "previous_date", "previous_close",
        "close_to_close_return_pct", "observed_gap_calendar_days", "return_basis", "quality",
      ]);
      expect(rows).toHaveLength(3);
      expect(rows.every(row => row.length === 11)).toBe(true);
      expect(rows[1]).toEqual([
        "2026-10-01", "1e+308", "1e+308", "1e+308", "1e+308", "2026-09-30", "1e-308", "", "0",
        "daily_price_return_adjustment_unverified", "unavailable_return",
      ]);
      expect(rows[2][0]).toBe("2026-10-02");
      expect(rows[2][7]).toBe("0");
      expect(rows[2][9]).toBe("daily_price_return_adjustment_unverified");
      expect(rows[2][10]).toBe("observed_return");
      expect(csv).not.toMatch(/Infinity|NaN|2025-10|2026-11/);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  }

  it("keeps an observed zero valid while a missing monthly reference remains neutral", async () => {
    const bars = [daily("2026-10-01", 100), daily("2026-10-02", 100)];
    await act(async () => root.render(<>
      <ReturnsCalendar symbol="BTC-USD" bars={bars} pick={picker(false)} />
      <ReturnsPreview bars={bars} pick={picker(false)} onOpen={() => undefined} />
    </>));
    neutral(element(".returns-month-summary .primary strong"));
    neutral(element(".returns-preview-main strong"));
    expect(element(".returns-month-summary .primary small").textContent)
      .toContain("Prior observed close unavailable");
    expect(element(".returns-preview-main small").textContent).toBe("Reference close unavailable");
    const observed = element<HTMLButtonElement>("#returns-day-2026-10-02");
    expect(observed.querySelector("strong")?.textContent).toBe("0.00%");
    expect(observed.getAttribute("aria-label")).not.toContain("unavailable");
    expect(element(".returns-inspector-head strong").textContent).toBe("0.00%");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
