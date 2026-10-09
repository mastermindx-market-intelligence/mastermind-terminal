// @vitest-environment jsdom
/**
 * Review round 1 on #780: source identity and ordering must never be trusted
 * implicitly. A duplicated or out-of-order session, a term row whose coordinate
 * is half-valid, and an unbounded "far" tenor each produced a plausible but
 * wrong reading before this suite.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VolVrpPanel, deriveVrpSeries } from "@/components/vol/VolVrpPanel";
import { VolTermPanel } from "@/components/vol/VolTermPanel";
import { VolHistoryPanel } from "@/components/vol/VolHistoryPanel";
import type { AggTrendPayload } from "@/lib/aggTrend";
import type { VolTermRow } from "@/components/vol/volTypes";

vi.mock("@/components/ui/Tip", () => ({ Tip: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

let host: HTMLDivElement;
let root: Root;
const base = Date.UTC(2026, 3, 1);
const day = (i: number) => new Date(base + i * 86_400_000).toISOString().slice(0, 10);
function aggHistory(n = 90): AggTrendPayload {
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

const tile = (label: string) => [...host.querySelectorAll(".fin-kpi")].find((node) => node.textContent?.includes(label));
const vertexCount = () => [...host.querySelectorAll("polyline")]
  .reduce((sum, line) => sum + (line.getAttribute("points") ?? "").trim().split(/\s+/).filter(Boolean).length, 0);
const strictlyAscending = (dates: string[]) => dates.every((d, i) => i === 0 || d > dates[i - 1]);
const termPaths = () => [...host.querySelectorAll<SVGPathElement>("path")].filter((p) => p.getAttribute("stroke") === "var(--brand-2)");

describe("IV − realized-vol spread admits each session date once, in ascending order", () => {
  it("a duplicated last session withholds the 1-session change and adds no polyline point", async () => {
    const clean = aggHistory();
    const last = clean.series!.at(-1)!.d;
    await render(<VolVrpPanel vrp={1.1} agg={clean} sourceAsOf={last} lang="en" />);
    const cleanVertices = vertexCount();
    expect(cleanVertices).toBeGreaterThan(0);

    const dup = aggHistory();
    dup.series = [...dup.series!, { ...dup.series!.at(-1)! }];
    await render(<VolVrpPanel vrp={1.1} agg={dup} sourceAsOf={last} lang="en" />);
    expect(tile("1-session change")?.querySelector(".v")?.textContent).toBe("—");
    expect(vertexCount()).toBeLessThanOrEqual(cleanVertices);
    expect(strictlyAscending(deriveVrpSeries(dup).map((p) => p.d))).toBe(true);
    expect(host.innerHTML).not.toMatch(/NaN|Infinity/);
  });

  it("an out-of-order session is a gap, never a return across the wrong pair of dates", async () => {
    const agg = aggHistory(130);
    const rows = [...agg.series!];
    [rows[60], rows[61]] = [rows[61], rows[60]];
    agg.series = rows;
    const derived = deriveVrpSeries(agg);
    expect(derived.length).toBeGreaterThan(0);
    expect(strictlyAscending(derived.map((p) => p.d))).toBe(true);
    await render(<VolVrpPanel vrp={1.1} agg={agg} sourceAsOf={rows.at(-1)!.d} lang="en" />);
    expect(host.querySelectorAll("polyline")).toHaveLength(2);
    expect(host.innerHTML).not.toMatch(/NaN|Infinity/);
  });
});

describe("term rows with a half-valid coordinate break the curve instead of bridging it", () => {
  it("a valid DTE with an invalid expiry date keeps a gap at that tenor", async () => {
    const rows = [
      { dte: 7, exp: "2026-10-08", atm_iv: 14 },
      { dte: 30, exp: "2026/10/31", atm_iv: 99 },
      { dte: 60, exp: "2026-11-30", atm_iv: 16 },
    ] as VolTermRow[];
    await render(<VolTermPanel term={rows} lang="en" />);
    expect(termPaths()).toHaveLength(2);
    expect(termPaths().every((p) => !(p.getAttribute("d") ?? "").includes("L"))).toBe(true);
    expect(host.textContent).not.toContain("99");
    expect(host.innerHTML).not.toMatch(/NaN|Infinity/);
  });

  it("a valid expiry date with an unplaceable DTE withholds line continuity", async () => {
    const rows = [
      { dte: 7, exp: "2026-10-08", atm_iv: 14 },
      { dte: null, exp: "2026-10-31", atm_iv: 99 },
      { dte: 60, exp: "2026-11-30", atm_iv: 16 },
    ] as unknown as VolTermRow[];
    await render(<VolTermPanel term={rows} lang="en" />);
    expect(termPaths()).toHaveLength(2);
    expect(termPaths().every((p) => !(p.getAttribute("d") ?? "").includes("L"))).toBe(true);
    expect(host.textContent).not.toContain("99");
  });
});

describe("term-structure shape chip compares a bounded far tenor", () => {
  // The literal 3D/700D pair from review never reached the chip (3D itself is nearer 90D than 700D),
  // so it is kept as a control; the failing pairs are those where the unbounded "nearest 90D" row
  // is a different, far-from-90D tenor.
  it.each([
    ["en", 3, 700],
    ["en", 3, 10],
    ["zh", 3, 10],
    ["en", 1, 160],
    ["zh", 1, 160],
  ] as const)("%s: %sD vs %sD cannot be labelled Contango or Inverted", async (lang, frontDte, farDte) => {
    const rows = [
      { dte: frontDte, exp: "2026-10-11", atm_iv: 12 },
      { dte: farDte, exp: "2028-09-07", atm_iv: 20 },
    ] as VolTermRow[];
    await render(<VolTermPanel term={rows} lang={lang} />);
    for (const label of ["Contango", "Inverted", "正向期限结构", "期限结构倒挂"]) expect(host.textContent).not.toContain(label);
  });

  it("a far tenor within 45 days of 90D still states the source shape", async () => {
    const rows = [
      { dte: 3, exp: "2026-10-11", atm_iv: 12 },
      { dte: 120, exp: "2027-02-05", atm_iv: 20 },
    ] as VolTermRow[];
    await render(<VolTermPanel term={rows} lang="en" />);
    expect(host.textContent).toContain("Contango");
  });
});

describe("history coverage discloses where the observations end", () => {
  it("names the last observed session, not only the first", async () => {
    const history = Array.from({ length: 15 }, (_, i) => ({
      date: `2026-09-${String(i + 1).padStart(2, "0")}`, atm_iv: 12 + i / 10, iv_rank: null, close: null,
    }));
    await render(<VolHistoryPanel history={history} iv52wHi={null} iv52wLo={null} lang="en" />);
    expect(host.textContent).toContain("15 sessions");
    expect(host.textContent).toContain("through 2026-09-15");
    await render(<VolHistoryPanel history={history} iv52wHi={null} iv52wLo={null} lang="zh" />);
    expect(host.textContent).toContain("至 2026-09-15");
  });
});
