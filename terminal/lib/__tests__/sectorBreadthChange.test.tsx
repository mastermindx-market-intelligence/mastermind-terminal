// @vitest-environment jsdom
/**
 * sectorBreadthChange.test.tsx — the breadth-change module (Paper R4 R7 +
 * 05:47Z deltas 1–7) mounted against the lane-3 FIXTURE (Macro #11128 head
 * c81cdbfa8fe50e098b20b3782bc2899b7fcb39d7 and Macro #11094 head 52e5ad722ef7;
 * unmerged; replace before arming — values are synthetic board examples).
 *
 * Laws pinned here, one per order item:
 *   - SORT: rows render by the 13-week like-for-like change, descending; a
 *     too-few sector sits BELOW the ranked list, never inside it.
 *   - TOO FEW: change and rank are missing ("—"), never 0; no "No value" tag;
 *     the share (45.5%) and the member count (8) stay (deltas 2, 3, 6, 7);
 *     the not-ranked copy reads "Not ranked: 8 members, 10 needed"; the
 *     answer binds "1" to "without a value" with U+00A0 (delta 4).
 *   - UNAVAILABLE: the Brief's honest line appears VERBATIM in EN and ZH; the
 *     subline does not claim anything about returns (delta 1); no table.
 *   - STALE: the label appears at exactly 2 completed weekly closes behind and
 *     not at 1; the board's 7-week scenario renders the notice and the
 *     "Latest session … data through …" as-of line.
 *   - DATE: "6 Nov 2026" (EN) / "2026年11月6日" (ZH).
 *   - PP: changes arrive in percentage points and are never rescaled —
 *     "+21.4" renders, "2140" does not; the bar is |change|/25 of a half track.
 *   - HOSTILE: null shares, missing directions, unknown basis, a producer
 *     change riding a sub-10 member set, and null member counts each degrade
 *     their own row without throwing; the adapter returns null (unavailable)
 *     for a wire with no recognizable ranked frame.
 *   - DUTY-OFFICER DELTA 2026-11-12: the fixture names Macro #11128 head
 *     0103db6e296bacbd97ab339b6fc41637add667f6; the member count shown is the
 *     live like-for-like set n_fixed_200_13w (Financials 76), never the
 *     archive's; the entire current frame comes from the live export and the
 *     two sources are never joined into one series.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const G = globalThis as unknown as { __SI_BREADTH_LANG?: "en" | "zh" };
G.__SI_BREADTH_LANG = "en";
vi.mock("@/lib/i18n", async (orig) => {
  const m = (await orig()) as Record<string, unknown>;
  return {
    ...m,
    useLang: () => ({ lang: G.__SI_BREADTH_LANG ?? "en", setLang: () => {} }),
  };
});
const identity = vi.hoisted(() => ({ identity: { kind: "guest" } as { kind: "guest" } }));
vi.mock("@/components/chrome/AppShell", () => ({ useShellIdentity: () => identity.identity }));

import SectorBreadthChange, {
  completedWeeklyClosesBehind,
  type SectorBreadthChangeInput,
} from "@/components/sector-intelligence/SectorBreadthChange";
import {
  sectorBreadthChangeFromWire,
  sectorBreadthFixtureFreshFull,
  sectorBreadthFixtureFreshTooFew,
  sectorBreadthFixtureStale,
} from "../__fixtures__/sectorBreadthChange.fixture";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no matchMedia; the module's desktop/compact switch needs it. The
// 1030px query reads a mutable flag so one stub serves both layouts.
let mediaCompact = false;
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: query.includes("1030") ? mediaCompact : false, media: query, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    }),
  });
});
afterAll(() => { G.__SI_BREADTH_LANG = "en"; });

let host: HTMLDivElement | null = null;
let root: Root | null = null;
const mount = (input?: SectorBreadthChangeInput | null, nameOf?: (id: string) => string | undefined) => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(<SectorBreadthChange input={input} nameOf={nameOf} onViewDataStatus={() => {}} />);
  });
  return host;
};
afterEach(() => {
  const r = root;
  if (r) act(() => { r.unmount(); });
  host?.remove();
  host = null; root = null;
  mediaCompact = false;
  G.__SI_BREADTH_LANG = "en";
});

const freshFull = () => sectorBreadthChangeFromWire(
  sectorBreadthFixtureFreshFull.live, sectorBreadthFixtureFreshFull.archive, sectorBreadthFixtureFreshFull.latestSession);
const freshTooFew = () => sectorBreadthChangeFromWire(
  sectorBreadthFixtureFreshTooFew.live, sectorBreadthFixtureFreshTooFew.archive, sectorBreadthFixtureFreshTooFew.latestSession);
const staleWorld = () => sectorBreadthChangeFromWire(
  sectorBreadthFixtureStale.live, sectorBreadthFixtureStale.archive, sectorBreadthFixtureStale.latestSession);

/** Structural clone for worlds mutated per test — JSON round-trip, exactly as
 * distinct wires would arrive. */
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

const sectorsInOrder = (h: HTMLElement) =>
  Array.from(h.querySelectorAll('[data-testid="sector-breadth-row"]'))
    .map(r => r.getAttribute("data-sector"));
const rowOf = (h: HTMLElement, sector: string) =>
  h.querySelector(`[data-testid="sector-breadth-row"][data-sector="${sector}"]`) as HTMLElement;

describe("adapter: two Macro files compared, never joined", () => {
  it("builds the fresh full world: eleven rows, as-of from the live meta's as_of_week, basis from live", () => {
    const input = freshFull();
    expect(input).not.toBeNull();
    expect(input!.rows).toHaveLength(11);
    expect(input!.asOfDate).toBe("2026-11-06");
    expect(input!.latestSession).toBe("2026-11-06");
    expect(input!.basis).toBe("reconstructed_current_membership");
    const utilities = input!.rows.find(r => r.sectorId === "Utilities")!;
    expect(utilities.changePp).toBe(21.4);
    expect(utilities.rank).toBe(1);
    expect(utilities.shareAbove200Now).toBe(78.6);
    expect(utilities.membersFixed13w).toBe(69);
  });

  it("takes the member count from the live like-for-like set, never the archive's and never n_members", () => {
    // Duty officer 2026-11-12: the count the Brief shows is n_fixed_200_13w —
    // Financials 76 in the live file, while the archive history prices 55 and
    // the live membership count is 79.
    const input = freshFull()!;
    const financials = input.rows.find(r => r.sectorId === "Financials")!;
    expect(financials.membersFixed13w).toBe(76);
    expect(financials.membersFixed13w).not.toBe(55);
    const h = mount(freshFull());
    const row = rowOf(h, "Financials");
    expect(row.textContent).toContain("76");
    expect(row.textContent).not.toContain("79");
  });

  it("never joins the two sources: the live frame wins even when the archive row differs", () => {
    const world = clone(sectorBreadthFixtureFreshFull);
    // Corrupt ONLY the archive: different change, share, count and as-of.
    const fin = world.archive.rows.find(r => r.group === "Financials")!;
    fin.fix_chg_pct_above_200_13w = -9.9;
    fin.pct_above_200 = 11.1;
    fin.n_fixed_200_13w = 55;
    world.archive.as_of = "2026-10-02";
    const input = sectorBreadthChangeFromWire(world.live, world.archive, world.latestSession)!;
    const financials = input.rows.find(r => r.sectorId === "Financials")!;
    expect(financials.changePp).toBe(1.2);
    expect(financials.shareAbove200Now).toBe(66.7);
    expect(financials.membersFixed13w).toBe(76);
    expect(input.asOfDate).toBe("2026-11-06");
    const h = mount(input);
    const row = rowOf(h, "Financials");
    expect(row.textContent).toContain("+1.2");
    expect(row.textContent).toContain("66.7%");
    expect(row.textContent).not.toContain("-9.9");
    expect(row.textContent).not.toContain("11.1%");
  });

  it("carries the too-few sector with a missing change and a present share", () => {
    const input = freshTooFew();
    const energy = input!.rows.find(r => r.sectorId === "Energy")!;
    expect(energy.changePp).toBeNull();
    expect(energy.rank).toBeNull();
    expect(energy.shareAbove200Now).toBe(45.5);
    expect(energy.membersFixed13w).toBe(8);
  });

  it("returns null — the unavailable state — when the live wire carries no current frame", () => {
    expect(sectorBreadthChangeFromWire(undefined, undefined, "2026-11-06")).toBeNull();
    expect(sectorBreadthChangeFromWire(
      { ...sectorBreadthFixtureFreshFull.live, latest_week: [] },
      sectorBreadthFixtureFreshFull.archive, "2026-11-06")).toBeNull();
    // A recognizable live frame with an invalid session date cannot be dated.
    expect(sectorBreadthChangeFromWire(sectorBreadthFixtureFreshFull.live,
      sectorBreadthFixtureFreshFull.archive, "not-a-date")).toBeNull();
  });

  it("names the exact unmerged heads in its header, to be replaced before arming", () => {
    const text = readFileSync(join(__dirname, "..", "__fixtures__", "sectorBreadthChange.fixture.ts"), "utf8");
    // Flatten comment line-wrapping: whitespace AND block-comment asterisks.
    const flat = text.replace(/[*\s]+/g, " ");
    expect(flat).toContain("Macro #11128 head 0103db6e296bacbd97ab339b6fc41637add667f6 and Macro #11094 head 52e5ad722ef7; unmerged; replace before arming");
  });
});

describe("full state", () => {
  it("sorts by the change, descending, and shows the as-of date as 6 Nov 2026", () => {
    const h = mount(freshFull());
    expect(h.querySelector('[data-testid="sector-breadth-change"]')!.getAttribute("data-state")).toBe("full");
    expect(sectorsInOrder(h)).toEqual([
      "Utilities", "Consumer Staples", "Health Care", "Real Estate", "Energy", "Financials",
      "Materials", "Industrials", "Consumer Discretionary", "Communication Services", "Technology",
    ]);
    expect(h.textContent).toContain("6 sectors improving, 5 deteriorating");
    expect(h.textContent).toContain("Largest increase Utilities +21.4");
    expect(h.textContent).toContain("largest decrease Technology −19.6");
    expect(h.textContent).toContain("As of 6 Nov 2026 · weekly close");
    expect(h.textContent).toContain("Basis: today's members applied to the past");
    expect(h.textContent).toContain("11 of 11 sectors ranked");
  });

  it("renders percentage points without rescaling and scales bars as |change|/25 of a half track", () => {
    const h = mount(freshFull());
    const utilities = rowOf(h, "Utilities");
    expect(utilities.textContent).toContain("+21.4");
    expect(utilities.textContent).toContain("78.6%");
    // 21.4 pp of a 25-pp half track = 42.8% of the track; the level fill is the share itself.
    const widths = Array.from(utilities.querySelectorAll<HTMLElement>("[style]"))
      .map(el => el.style.width);
    expect(widths).toContain("42.8%");
    expect(widths).toContain("78.6%");
    expect(h.textContent).not.toContain("2140");
    expect(h.textContent).not.toContain("214.0 pp");
    expect(h.textContent).not.toContain("1960");
  });

  it("pairs every colour with a sign, an arrow word and a week count", () => {
    const h = mount(freshFull());
    expect(rowOf(h, "Utilities").textContent).toContain("Improving");
    expect(rowOf(h, "Utilities").textContent).toContain("· 6 wks");
    expect(rowOf(h, "Technology").textContent).toContain("Deteriorating");
    expect(rowOf(h, "Technology").textContent).toContain("· 8 wks");
  });

  it("formats the date 2026年11月6日 in Chinese", () => {
    G.__SI_BREADTH_LANG = "zh";
    const h = mount(freshFull());
    expect(h.textContent).toContain("截至2026年11月6日 · 周线收盘");
    expect(h.textContent).toContain("基准：以今日成员回溯历史");
  });
});

describe("too-few state (below 10 like-for-like members)", () => {
  it("shows the change and rank as missing — never 0 — below the ranked list, with the real share and member count", () => {
    const h = mount(freshTooFew());
    expect(h.querySelector('[data-testid="sector-breadth-change"]')!.getAttribute("data-state")).toBe("too-few");
    const order = sectorsInOrder(h);
    expect(order).toHaveLength(11);
    expect(order[order.length - 1]).toBe("Energy");
    expect(order.indexOf("Energy")).toBe(10);
    const energy = rowOf(h, "Energy");
    expect(energy.textContent).toContain("Not ranked: 8 members, 10 needed");
    expect(energy.textContent).toContain("45.5%");
    expect(energy.textContent).not.toContain("No value");
    // missing, never zero: no change value, no 0.0 pp, rank and bar are dashes
    expect(energy.textContent).not.toMatch(/\b0\.0\b/);
    expect(energy.getAttribute("data-ranked")).toBe("false");
    expect(h.textContent).toContain("10 of 11 sectors ranked · 1 under 10 members");
    // delta 4: the tail binds with U+00A0 (asserted with plain spaces in the
    // dedicated delta-4 test below via the same escape)
    expect(h.textContent).toContain("5 improving, 5 deteriorating, 1 without a value");
  });

  it("binds the count to \"without a value\" with a non-breaking space (delta 4)", () => {
    const h = mount(freshTooFew());
    expect(h.textContent).toContain("1 without a value");
  });

  it("keeps the compact row honest: dash value, dashed bar, share left, not-ranked right", () => {
    mediaCompact = true;
    const h = mount(freshTooFew());
    const energy = rowOf(h, "Energy");
    expect(energy.textContent).toContain("—");
    expect(energy.textContent).toContain("Not ranked: 8 members, 10 needed");
    expect(energy.textContent).toContain("45.5%");
    // a ranked compact row carries the pp unit inline
    expect(rowOf(h, "Utilities").textContent).toContain("+21.4 pp");
  });
});

describe("stale state (completed weekly closes, not calendar days)", () => {
  it("counts whole 7-day steps: 2 at the boundary, not 1", () => {
    expect(completedWeeklyClosesBehind("2026-10-23", "2026-11-06")).toBe(2);
    expect(completedWeeklyClosesBehind("2026-10-30", "2026-11-06")).toBe(1);
    expect(completedWeeklyClosesBehind("2026-09-18", "2026-11-06")).toBe(7);
    expect(completedWeeklyClosesBehind("2026-11-06", "2026-11-06")).toBe(0);
    expect(completedWeeklyClosesBehind("", "2026-11-06")).toBe(0);
    expect(completedWeeklyClosesBehind("2026-12-01", "2026-11-06")).toBe(0);
  });

  it("labels stale at 2 completed closes behind and not at 1", () => {
    const base = staleWorld()!;
    const h2 = mount({ ...base, asOfDate: "2026-10-23" });
    expect(h2.querySelector('[data-testid="sector-breadth-change"]')!.getAttribute("data-state")).toBe("stale");
    expect(h2.textContent).toContain("Stale: 2 weeks behind the latest session.");

    const h1 = mount({ ...base, asOfDate: "2026-10-30" });
    expect(h1.querySelector('[data-testid="sector-breadth-change"]')!.getAttribute("data-state")).toBe("full");
    expect(h1.querySelector('[data-testid="sector-breadth-stale"]')).toBeNull();
    expect(h1.textContent).not.toContain("Stale");
  });

  it("renders the board's 7-week scenario with the two-date as-of line", () => {
    const h = mount(staleWorld());
    expect(h.querySelector('[data-testid="sector-breadth-change"]')!.getAttribute("data-state")).toBe("stale");
    expect(h.querySelector('[data-testid="sector-breadth-stale"]')).not.toBeNull();
    expect(h.textContent).toContain("Stale: 7 weeks behind the latest session.");
    expect(h.textContent).toContain("The ranking is as of the data date, not the latest session.");
    expect(h.textContent).toContain("Latest session 6 Nov 2026 · data through 18 Sep 2026");
  });
});

describe("unavailable state (the live input until L1-FO1)", () => {
  it("shows the Brief's honest line verbatim with no returns claim", () => {
    const h = mount(null);
    expect(h.querySelector('[data-testid="sector-breadth-change"]')!.getAttribute("data-state")).toBe("unavailable");
    expect(h.textContent).toContain("Constituent membership is not supplied by this source.");
    expect(h.textContent).toContain("Breadth change needs each sector's members. Without them no share, change or rank is shown.");
    expect(h.textContent).not.toContain("Sector returns above are unaffected.");
    expect(h.textContent).toContain("View data status");
    expect(h.querySelector('[data-testid="sector-breadth-row"]')).toBeNull();
    // no table: neither layout branch mounts, so no column headers either
    expect(h.querySelector('[role="table"]')).toBeNull();
    expect(h.textContent).not.toContain("Above 200-session now");
  });

  it("shows the honest line verbatim in Chinese", () => {
    G.__SI_BREADTH_LANG = "zh";
    const h = mount(undefined);
    expect(h.textContent).toContain("此来源未提供成分股名单。");
  });

  it("keeps the compact unavailable header honest: no as-of date, source unavailable", () => {
    mediaCompact = true;
    const h = mount(null);
    expect(h.textContent).toContain("No as-of date · source unavailable");
  });
});

describe("hostile input degrades its own row, never the module", () => {
  it("survives null share, missing direction, unknown basis and a producer change on a sub-10 set", () => {
    const input: SectorBreadthChangeInput = {
      asOfDate: "2026-11-06",
      latestSession: "2026-11-06",
      basis: "something_new",
      rows: [
        { sectorId: "Utilities", shareAbove200Now: null, changePp: 21.4, rank: 1, direction: null, runWeeks: 6, membersFixed13w: 69 },
        { sectorId: "Energy", shareAbove200Now: 45.5, changePp: 3.7, rank: 2, direction: "improving", runWeeks: 2, membersFixed13w: 9 },
        { sectorId: "Financials", shareAbove200Now: 66.7, changePp: 1.2, rank: 3, direction: "improving", runWeeks: 1, membersFixed13w: null },
      ],
    };
    const h = mount(input);
    expect(h.querySelector('[data-testid="sector-breadth-change"]')!.getAttribute("data-state")).toBe("too-few");
    // null share degrades the level cell only
    expect(rowOf(h, "Utilities").textContent).toContain("—");
    // 9 like-for-like members force the change and rank missing even though the
    // producer sent a change — never zero, share stays (delta 7, belt and braces)
    const energy = rowOf(h, "Energy");
    expect(energy.getAttribute("data-ranked")).toBe("false");
    expect(energy.textContent).toContain("Not ranked: 9 members, 10 needed");
    expect(energy.textContent).not.toContain("+3.7");
    expect(energy.textContent).toContain("45.5%");
    // null member count renders a dash, not 0
    expect(rowOf(h, "Financials").textContent).toContain("—");
    // unknown basis hides the basis line rather than guessing one
    expect(h.textContent).not.toContain("Basis:");
  });

  it("falls back to the raw sector id when no nameOf resolves one", () => {
    const h = mount({ asOfDate: "2026-11-06", latestSession: "2026-11-06", basis: "dated",
      rows: [{ sectorId: "Technology", shareAbove200Now: 34.8, changePp: -19.6, rank: 1, direction: "deteriorating", runWeeks: 8, membersFixed13w: 82 }] });
    expect(h.textContent).toContain("Technology");
    expect(h.textContent).toContain("Basis: dated membership");
    expect(h.textContent).toContain("0 sectors improving, 1 deteriorating");
  });
});
