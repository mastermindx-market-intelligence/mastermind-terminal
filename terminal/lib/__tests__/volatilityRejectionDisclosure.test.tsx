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
import { VolVrpPanel, vrpOrderNote } from "@/components/vol/VolVrpPanel";
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
  const rows = [
    { dte: 7, exp: "2026-10-15", atm_iv: 14 },
    { dte: 30, exp: "2026-11-07", atm_iv: 15 },
    { dte: 30, exp: "bad", atm_iv: 99 },
    { dte: 60, exp: "2026-12-07", atm_iv: 16 },
    { dte: 90, exp: "2027-01-06", atm_iv: 17 },
  ] as VolTermRow[];
  const termNote = () => host.querySelector('[data-testid="term-conflict-status"]')?.textContent ?? "";

  it.each(["en", "zh"] as const)("%s: keeps one continuous 7→30→60→90 path and discloses the row as excluded, never as a break", async (lang) => {
    await render(<VolTermPanel term={rows} lang={lang} />);
    const paths = termPaths();
    expect(paths).toHaveLength(1);
    expect((paths[0].getAttribute("d") ?? "").match(/[ML]/g)).toEqual(["M", "L", "L", "L"]);
    // Review round 3: the curve is continuous, so the note must not claim a break.
    expect(termNote()).not.toContain(lang === "en" ? "breaks" : "断开");
    expect(termNote()).toContain(lang === "en"
      ? "1 supplied row with an invalid expiry date excluded"
      : "1 个到期日无效的已提供行已排除");
    expect(host.textContent).not.toContain("99");
    expect(host.innerHTML).not.toMatch(/NaN|Infinity/);
  });

  it.each(["en", "zh"] as const)("%s: one row at an observed DTE and one at an unobserved DTE → exactly one break claim and one exclusion", async (lang) => {
    await render(<VolTermPanel term={[...rows, { dte: 45, exp: "nope", atm_iv: 1 } as VolTermRow]} lang={lang} />);
    expect(termPaths()).toHaveLength(2); // the 45-DTE row is the one real break
    const note = termNote();
    if (lang === "en") {
      expect(note.match(/Curve breaks at/g)).toHaveLength(1);
      expect(note).toContain("Curve breaks at 1 supplied row with an invalid expiry date");
      expect(note).toContain("1 supplied row with an invalid expiry date excluded");
      expect(note).not.toContain("2 supplied row");
    } else {
      expect(note.match(/断开/g)).toHaveLength(1);
      expect(note).toContain("曲线在 1 个到期日无效的已提供行处断开");
      expect(note).toContain("1 个到期日无效的已提供行已排除");
    }
  });

  it("two rows at unobserved DTEs inside the drawn span → a plural break claim and no exclusion", async () => {
    await render(<VolTermPanel term={[...rows.filter((r) => r.exp !== "bad"), { dte: 45, exp: "nope", atm_iv: 1 }, { dte: 75, exp: "x", atm_iv: 2 }] as VolTermRow[]} lang="en" />);
    expect(termPaths()).toHaveLength(3);
    expect(termNote()).toContain("Curve breaks at 2 supplied rows with an invalid expiry date");
    expect(termNote()).not.toContain("excluded");
  });

  it("a row at an unobserved DTE beyond the drawn span is excluded, not called a break", async () => {
    await render(<VolTermPanel term={[...rows.filter((r) => r.exp !== "bad"), { dte: 120, exp: "nope", atm_iv: 1 }] as VolTermRow[]} lang="en" />);
    const paths = termPaths();
    expect(paths).toHaveLength(1);
    expect((paths[0].getAttribute("d") ?? "").match(/[ML]/g)).toEqual(["M", "L", "L", "L"]);
    expect(termNote()).not.toContain("breaks");
    expect(termNote()).toContain("1 supplied row with an invalid expiry date excluded");
  });
});

describe("IV − realized-vol spread: 'Partial' is claimed only for a rejection inside the displayed window", () => {
  it.each(["en", "zh"] as const)("%s: an old duplicate outside the 252-session window is disclosed without calling the visible history partial", async (lang) => {
    const agg = aggHistory(400);
    agg.series![50] = { ...agg.series![50], d: agg.series![49].d }; // rows 49 and 50 rejected; window starts far later
    await render(<VolVrpPanel vrp={1.1} agg={agg} sourceAsOf={agg.series!.at(-1)!.d} lang={lang} />);
    expect(host.querySelector('svg[role="img"]')).toBeTruthy();
    const status = orderStatus()?.textContent ?? "";
    expect(status).not.toContain(lang === "en" ? "Partial" : "不完整");
    expect(status).toContain(lang === "en" ? "2 supplied rows outside the displayed window" : "显示区间之外有 2 个已提供行");
  });

  it("a duplicate inside the displayed window is still called partial, with a plural count", async () => {
    const agg = aggHistory(400);
    agg.series![350] = { ...agg.series![350], d: agg.series![349].d };
    await render(<VolVrpPanel vrp={1.1} agg={agg} sourceAsOf={agg.series!.at(-1)!.d} lang="en" />);
    expect(orderStatus()?.textContent).toBe("Partial spread history · 2 supplied rows rejected for a duplicate or out-of-order date");
  });

  it("the order note is singular for one row and plural otherwise, in every scope", () => {
    // Every order rejection pairs with another valid-dated row it contradicts, so a single
    // rejected row cannot be rendered from a store; the formatter's n===1 branch is pinned here.
    expect(vrpOrderNote("en", 1, "window")).toBe("Partial spread history · 1 supplied row rejected for a duplicate or out-of-order date");
    expect(vrpOrderNote("en", 1, "outside")).toBe("1 supplied row outside the displayed window rejected for a duplicate or out-of-order date");
    expect(vrpOrderNote("en", 1, "undrawn")).toBe("1 supplied row rejected for a duplicate or out-of-order date");
    expect(vrpOrderNote("en", 3, "undrawn")).toBe("3 supplied rows rejected for a duplicate or out-of-order date");
    expect(vrpOrderNote("zh", 1, "window")).toBe("差值历史不完整 · 1 个已提供行因日期重复或顺序错乱被排除");
    expect(vrpOrderNote("en", 0, "window")).toBeNull();
  });
});

describe("IV − realized-vol spread: a supplied store's empty state names the actual cause", () => {
  it.each(["en", "zh"] as const)("%s: every session date malformed → names the malformed dates, not missing closes or IV", async (lang) => {
    const agg = aggHistory(130);
    agg.series = agg.series!.map((row) => ({ ...row, d: row.d.replace(/-/g, "") }));
    await render(<VolVrpPanel vrp={1.1} agg={agg} sourceAsOf="2025-05-10" lang={lang} />);
    const text = host.textContent ?? "";
    expect(text).not.toContain(lang === "en" ? "has not been published" : "尚未发布");
    expect(text).toContain(lang === "en" ? "130 supplied rows have no valid session date" : "130 个已提供行没有有效的交易日日期");
    expect(text).not.toContain(lang === "en" ? "have the closes and IV needed" : "具备推导历史区间所需收盘价与IV");
    expect(orderStatus()).toBeNull();
  });

  it("one malformed date in a short store uses the singular", async () => {
    const agg = aggHistory(30);
    agg.series![10] = { ...agg.series![10], d: "2025/01/11" };
    await render(<VolVrpPanel vrp={1.1} agg={agg} sourceAsOf={agg.series!.at(-1)!.d} lang="en" />);
    expect(host.textContent).toContain("1 supplied row has no valid session date");
  });

  it.each(["en", "zh"] as const)("%s: a 10-row store with one duplicate is too short regardless of ordering", async (lang) => {
    const agg = aggHistory(10);
    agg.series![5] = { ...agg.series![5], d: agg.series![4].d };
    await render(<VolVrpPanel vrp={1.1} agg={agg} sourceAsOf={agg.series!.at(-1)!.d} lang={lang} />);
    const text = host.textContent ?? "";
    expect(text).not.toContain(lang === "en" ? "has not been published" : "尚未发布");
    expect(text).not.toContain(lang === "en" ? "leaving too few sessions" : "顺序确定的交易日不足");
    expect(text).not.toContain(lang === "en" ? "could not be put in session order" : "无法按交易日排序");
    expect(text).toContain(lang === "en" ? "fewer than 60 sessions" : "少于 60 个");
    expect(orderStatus()?.textContent).toContain("2"); // the rejection itself is still disclosed
  });
});
