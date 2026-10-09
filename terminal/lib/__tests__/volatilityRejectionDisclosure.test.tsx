// @vitest-environment jsdom
/**
 * Review round 2 on #780: a source that was supplied but rejected must never read
 * as an unpublished one, and a rejected row must not open a gap on a span the
 * source fully reported.
 *
 * - IV − realized-vol spread: the strict, no-winner session-order rule may reject
 *   many supplied rows (one bad date rejects every row it contradicts). The panel
 *   must say how many rows were rejected and why, and never fall back to the
 *   "has not been published" empty state while a store was supplied.
 * - Term structure: an invalid-expiry row whose DTE is already observed by an
 *   admitted row adds no gap; the 30→60 span stays continuous while the rejected
 *   row is still disclosed.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VolVrpPanel } from "@/components/vol/VolVrpPanel";
import { VolTermPanel } from "@/components/vol/VolTermPanel";
import type { AggPoint, AggTrendPayload } from "@/lib/aggTrend";
import type { VolTermRow } from "@/components/vol/volTypes";

vi.mock("@/components/ui/Tip", () => ({ Tip: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

let host: HTMLDivElement;
let root: Root;
const base = Date.UTC(2025, 0, 1);
const day = (i: number) => new Date(base + i * 86_400_000).toISOString().slice(0, 10);
function aggHistory(n: number): AggTrendPayload {
  let spot = 100;
  const series = Array.from({ length: n }, (_, i) => {
    const row = { d: day(i), s: spot, iv: 0.2 };
    spot = i % 3 === 0 ? spot * 1.011 : i % 3 === 1 ? spot / 1.004 : spot * 0.997;
    return row;
  });
  return { schema: "options_hub.aggtrend/v1", root: "SPY", asof: series.at(-1)!.d, series };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render(node: React.ReactNode) { await act(async () => root.render(node)); }

const orderStatus = () => host.querySelector('[data-testid="vrp-order-status"]');
const termPaths = () => [...host.querySelectorAll<SVGPathElement>("path")].filter((p) => p.getAttribute("stroke") === "var(--brand-2)");

describe("IV − realized-vol spread: supplied rows rejected for date order are disclosed, never 'unpublished'", () => {
  it.each(["en", "zh"] as const)("%s: one early-dated row near the end rejects the earlier rows and says so", async (lang) => {
    const agg = aggHistory(130);
    // Every earlier row is later than this date, so the no-winner rule rejects 125 + this row.
    agg.series![125] = { ...agg.series![125], d: "2001-01-01" };
    await render(<VolVrpPanel vrp={1.1} agg={agg} sourceAsOf={agg.series!.at(-1)!.d} lang={lang} />);
    expect(host.textContent).not.toContain("has not been published");
    expect(host.textContent).not.toContain("尚未发布");
    const status = orderStatus();
    expect(status?.getAttribute("role")).toBe("status");
    expect(status?.textContent).toContain("126");
    expect(status?.textContent).toContain(lang === "en" ? "out-of-order" : "顺序错乱");
    // the empty state names the supplied-but-rejected store, not an absent one
    expect(host.textContent).toContain(lang === "en" ? "rejected for duplicate or out-of-order dates" : "因日期重复或顺序错乱被排除");
    expect(host.innerHTML).not.toMatch(/NaN|Infinity/);
  });

  it.each(["en", "zh"] as const)("%s: a far-future outlier mid-series discloses the rejected tail count", async (lang) => {
    const agg = aggHistory(300);
    // Rows 150..299 are all earlier than 2099, so the outlier and the 149 rows after it are rejected.
    agg.series![150] = { ...agg.series![150], d: "2099-01-01" };
    await render(<VolVrpPanel vrp={1.1} agg={agg} sourceAsOf={agg.series!.at(-1)!.d} lang={lang} />);
    expect(host.querySelector("svg")).toBeTruthy(); // the admitted 150 sessions still draw
    const status = orderStatus();
    expect(status?.getAttribute("role")).toBe("status");
    expect(status?.textContent).toContain("150");
    expect(status?.textContent).toContain(lang === "en" ? "out-of-order" : "顺序错乱");
    expect(host.innerHTML).not.toMatch(/NaN|Infinity/);
  });

  it("a supplied store with too few derivable sessions is not described as unpublished either", async () => {
    const agg = aggHistory(130);
    agg.series = agg.series!.map((row) => ({ d: row.d, iv: row.iv }) as AggPoint); // closes missing
    await render(<VolVrpPanel vrp={1.1} agg={agg} sourceAsOf={agg.series.at(-1)!.d} lang="en" />);
    expect(host.textContent).not.toContain("has not been published");
    expect(host.textContent).toContain("were supplied for this root");
    expect(orderStatus()).toBeNull();
    await render(<VolVrpPanel vrp={1.1} agg={agg} sourceAsOf={agg.series.at(-1)!.d} lang="zh" />);
    expect(host.textContent).not.toContain("尚未发布");
  });

  it("controls: an absent store still says unpublished, and clean history has no ordering note", async () => {
    await render(<VolVrpPanel vrp={1.1} agg={null} sourceAsOf="2025-05-10" lang="en" />);
    expect(host.textContent).toContain("has not been published");
    expect(orderStatus()).toBeNull();
    const clean = aggHistory(130);
    await render(<VolVrpPanel vrp={1.1} agg={clean} sourceAsOf={clean.series!.at(-1)!.d} lang="en" />);
    expect(orderStatus()).toBeNull();
    expect(host.textContent).not.toContain("has not been published");
  });
});

describe("term structure: an invalid-expiry row at an already-observed DTE opens no gap", () => {
  it("keeps one continuous 7→30→60→90 path and still discloses the rejected row", async () => {
    const rows = [
      { dte: 7, exp: "2026-10-15", atm_iv: 14 },
      { dte: 30, exp: "2026-11-07", atm_iv: 15 },
      { dte: 30, exp: "bad", atm_iv: 99 },
      { dte: 60, exp: "2026-12-07", atm_iv: 16 },
      { dte: 90, exp: "2027-01-06", atm_iv: 17 },
    ] as VolTermRow[];
    await render(<VolTermPanel term={rows} lang="en" />);
    const paths = termPaths();
    expect(paths).toHaveLength(1);
    expect((paths[0].getAttribute("d") ?? "").match(/[ML]/g)).toEqual(["M", "L", "L", "L"]);
    expect(host.querySelector('[data-testid="term-conflict-status"]')?.textContent).toContain("invalid expiry date");
    expect(host.textContent).not.toContain("99");
    expect(host.innerHTML).not.toMatch(/NaN|Infinity/);
  });
});
