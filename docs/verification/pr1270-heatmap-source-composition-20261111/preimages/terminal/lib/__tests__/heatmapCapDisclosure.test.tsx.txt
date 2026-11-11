/**
 * heatmapCapDisclosure.test.tsx — presentation tests for cached USD-cap copy
 * and the complete missing-symbol list (keyboard / mobile disclosure).
 *
 * Mounts MissingCapDisclosure with react-dom/client (jsdom). Does not
 * reinstall packages. @testing-library/react is not in the supplied
 * closure — exact missing name: @testing-library/react.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
import {
  cachedUsdCapCopy,
  completeMissingCapNames,
  MissingCapDisclosure,
} from "@/components/heatmap/HeatmapView";
import type { CapCoverage } from "@/lib/heatmapCapitalization";

function coverageOf(partial: Partial<CapCoverage> & Pick<CapCoverage, "total" | "withCap" | "missingCap" | "invalidCap">): CapCoverage {
  return {
    missingTickers: [],
    invalidTickers: [],
    ...partial,
  };
}

const RAW_IMPL_NAMES = [
  "market_cap_usd",
  "mcap",
  "build_universe",
  "polygon_ref",
  "Polygon reference",
  "ingest/",
  "referenceKey",
  "named cached-reference",
  "mtime",
];

function allCopyText(zh: boolean, cov: CapCoverage): string {
  const c = cachedUsdCapCopy(zh, cov, { pruned: true, renderedCount: 500, scopedCount: 600 });
  return [c.modeLabel, c.modeNote, c.coverageNote, c.pruneNote, c.emptyCapWarn, c.missingHeading, c.missingRegionLabel]
    .filter(Boolean)
    .join("\n");
}

describe("cachedUsdCapCopy — truthful bilingual product copy", () => {
  const cov = coverageOf({
    total: 6,
    withCap: 2,
    missingCap: 1,
    invalidCap: 3,
    missingTickers: ["MISS"],
    invalidTickers: ["ZERO", "NAN", "INF"],
  });

  it("EN explains cached USD capitalization, unknown reference date, and quote time", () => {
    const text = allCopyText(false, cov);
    expect(text).toMatch(/cached USD market capitalization/i);
    expect(text).toMatch(/reference date is unknown/i);
    expect(text).toMatch(/quote time/i);
    expect(text).toMatch(/live overlay or end-of-day/i);
    expect(text).toMatch(/price × volume proxy/);
    expect(text).not.toMatch(/saved views are reinterpreted/);
  });

  it("ZH explains cached USD cap, unknown date, and distinguishes quote time", () => {
    const text = allCopyText(true, cov);
    expect(text).toContain("缓存的美元市值");
    expect(text).toContain("财务参考日期未知");
    expect(text).toContain("行情时间");
    expect(text).toContain("实时覆盖或收盘");
    expect(text).toContain("价格×成交量代理");
  });

  it("does not expose raw column / cache / implementation names in EN or ZH", () => {
    const en = allCopyText(false, cov);
    const zh = allCopyText(true, cov);
    for (const forbidden of RAW_IMPL_NAMES) {
      expect(en.toLowerCase()).not.toContain(forbidden.toLowerCase());
      expect(zh.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("coverage note reports usable / missing / unusable counts against the original universe", () => {
    const en = cachedUsdCapCopy(false, cov, { pruned: false, renderedCount: 6, scopedCount: 6 });
    expect(en.coverageNote).toContain("usable 2/6");
    expect(en.coverageNote).toContain("missing 1");
    expect(en.coverageNote).toContain("unusable 3");
    expect(en.coverageNote).toMatch(/original scoped universe of 6/);
    const zh = cachedUsdCapCopy(true, cov, { pruned: false, renderedCount: 6, scopedCount: 6 });
    expect(zh.coverageNote).toContain("可用 2/6");
    expect(zh.coverageNote).toContain("缺失 1");
    expect(zh.coverageNote).toContain("不可用 3");
  });
});

describe("completeMissingCapNames — no 24-name truncation", () => {
  it("returns the full invalid-then-missing list (same cardinality as coverage)", () => {
    const invalidTickers = Array.from({ length: 18 }, (_, i) => `INV${i}`);
    const missingTickers = Array.from({ length: 12 }, (_, i) => `MIS${i}`);
    const cov = coverageOf({
      total: 40,
      withCap: 10,
      missingCap: 12,
      invalidCap: 18,
      invalidTickers,
      missingTickers,
    });
    const names = completeMissingCapNames(cov);
    expect(names.length).toBe(30);
    expect(names.length).toBeGreaterThan(24);
    expect(names).toEqual([...invalidTickers, ...missingTickers]);
    expect(names).toContain("INV17");
    expect(names).toContain("MIS11");
    expect(names).not.toContain("…");
  });
});

describe("MissingCapDisclosure — complete list, keyboard and mobile", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("renders every name past 24, with native details/summary and a focusable scroll region", () => {
    const names = Array.from({ length: 30 }, (_, i) => `T${String(i).padStart(2, "0")}`);
    const heading = "30 names without usable cached USD cap (12 missing · 18 unusable) — kept visible, no map area";
    const regionLabel = "Complete list of names without usable cached USD cap";

    act(() => {
      root.render(
        <MissingCapDisclosure names={names} heading={heading} regionLabel={regionLabel} />
      );
    });

    const details = container.querySelector("details");
    const summary = container.querySelector("summary");
    const region = container.querySelector('[role="list"]') as HTMLElement | null;
    expect(details).toBeTruthy();
    expect(details?.open).toBe(true);
    expect(summary?.textContent).toContain("30 names without usable cached USD cap");
    expect(summary?.textContent).toContain("12 missing");
    expect(summary?.textContent).toContain("18 unusable");
    expect(region).toBeTruthy();
    expect(region?.tabIndex).toBe(0);
    expect(region?.getAttribute("aria-label")).toBe(regionLabel);
    expect(region?.style.maxHeight).toBe("140px");
    expect(region?.style.overflowY).toBe("auto");
    expect(region?.style.touchAction).toBe("pan-y");

    const items = container.querySelectorAll('[role="listitem"]');
    expect(items.length).toBe(30);
    expect(container.textContent).toContain("T00");
    expect(container.textContent).toContain("T23");
    expect(container.textContent).toContain("T24");
    expect(container.textContent).toContain("T29");
    expect(container.textContent).not.toMatch(/\.\.\.\+\d/);
    expect(container.textContent).not.toMatch(/…\+\d/);
  });

  it("renders nothing when the missing list is empty", () => {
    act(() => {
      root.render(
        <MissingCapDisclosure
          names={[]}
          heading="none"
          regionLabel="Complete list of names without usable cached USD cap"
        />
      );
    });
    expect(container.querySelector("details")).toBeNull();
    expect(container.textContent).toBe("");
  });
});
