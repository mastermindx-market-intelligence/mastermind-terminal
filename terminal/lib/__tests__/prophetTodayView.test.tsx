// @vitest-environment jsdom
/**
 * prophetTodayView.test.tsx — the Today board against the COMMITTED fixture
 * captures, byte-for-byte (public/data/prophet_sector_members_fixture).
 *
 * Laws pinned here (gap G1/G2/G21 acceptance, fix order B1/M2/M5/P1/P4):
 *   - Reading order: assessment → leadership table → research cases (the DOM
 *     order is the reading order; the ≤640 CSS swap is a composition detail).
 *   - The hero is the LEADING sector: the top-return group whose population is
 *     published. The bounded walk settles there (the fixtures publish 3 of 49;
 *     production publishes all and stops at the first candidate).
 *   - Nulls render the shared not-available vocabulary ("Not available"), never
 *     a zero and never an invented number; the owner's phase vocabulary is
 *     mapped (P4); the member-level "Return vs sector" measure has a designed
 *     unavailable label.
 *   - P0-1: a case card carries no trade direction, no open date and no plan
 *     pill — plan membership is ONE neutral pointer to the Plans lane.
 *   - P1-2/P1-3/P1-5: the hero says why it is the hero and who leads overall;
 *     every row carries a visible Research action; breadth absent for every
 *     group is stated once under the table, not as a column of nulls.
 *   - The compare selection is the URL contract's `sel`: chips, count, removal.
 *   - Committed actions call update() with the exact contract patches.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TodayView } from "@/components/prophet/today/TodayView";
import { DEFAULT_PROPHET_STATE, type ProphetUrlState } from "@/lib/prophetUrlState";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FIXTURE_DIR = join(process.cwd(), "public", "data", "prophet_sector_members_fixture");

/** The BFF's fixture seam, faithfully: index for no group, the group file when
 * it exists, 404 unknown_group otherwise (the exact branch the walk rides). */
const fixtureFetch = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
  const url = new URL(String(input), "https://terminal.test");
  if (url.pathname !== "/api/prophet/sector-members") {
    return new Response(JSON.stringify({ error: "not_fixture" }), { status: 404 });
  }
  const group = url.searchParams.get("group");
  if (group === null) {
    return new Response(readFileSync(join(FIXTURE_DIR, "index.json"), "utf8"), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }
  try {
    return new Response(readFileSync(join(FIXTURE_DIR, `group_${group}.json`), "utf8"), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "unknown_group", code: "unknown_group" }), { status: 404 });
  }
});

let host: HTMLDivElement;
let root: Root | undefined;
let state: ProphetUrlState;
const patches: Partial<ProphetUrlState>[] = [];
const update = (patch: Partial<ProphetUrlState>) => { patches.push(patch); };

/** Render + flush until the render settles: the population walk is a chain of
 * fetch → setState → effect cycles, so flush macro+microtasks generously. */
async function renderBoard() {
  root = createRoot(host);
  await act(async () => { root!.render(<TodayView state={state} update={update} />); });
  for (let i = 0; i < 40; i++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  }
}

beforeEach(() => {
  vi.stubGlobal("fetch", fixtureFetch);
  fixtureFetch.mockClear();
  patches.length = 0;
  state = structuredClone(DEFAULT_PROPHET_STATE);
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
  host.remove();
  vi.unstubAllGlobals();
});

const text = () => host.textContent ?? "";
/** The walk skips unpublished populations: Housing Chain leads the fixture's
 *  returns but has no published population, so one 404 precedes defensives. */
const WALK_404S = 1;

describe("Today board — committed-fixture acceptance", () => {
  it("reads assessment → leadership table → cases, in that DOM order", async () => {
    await renderBoard();
    const hero = host.querySelector('[data-testid="prophet-today-hero"]');
    const table = host.querySelector('[data-testid="prophet-today-table"]');
    const cases = host.querySelector('[data-symbol="CLX"]');
    expect(hero).not.toBeNull();
    expect(table).not.toBeNull();
    expect(cases).not.toBeNull();
    expect(hero!.compareDocumentPosition(table!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(table!.compareDocumentPosition(cases!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("settles the focus on the leading sector with a published population", async () => {
    await renderBoard();
    const groupReads = fixtureFetch.mock.calls
      .map(call => new URL(String(call[0]), "https://terminal.test").searchParams.get("group"))
      .filter(Boolean);
    // Housing (top return, unpublished) yields to defensives — and the walk
    // STOPS there.
    expect(groupReads).toHaveLength(WALK_404S + 1);
    expect(groupReads![0]).toBe("housing");
    expect(groupReads![WALK_404S]).toBe("defensives");
    expect(text()).toContain("Defensives");
  });

  it("renders the owner's read and reason vocabulary, never invented numbers", async () => {
    await renderBoard();
    const hero = host.querySelector('[data-testid="prophet-today-hero"]')!.textContent ?? "";
    // B1: the assessment sentence names the leading sector and its direction.
    // P2-3: the verb follows the group noun ("Defensives are …").
    expect(hero).toContain("Defensives are ahead of the market.");
    // P4: the owner's phase vocabulary is mapped for display.
    expect(host.querySelector('[data-testid="prophet-today-owner-label"]')!.textContent).toBe("Expansion");
    expect(hero).toContain("+10.4%");
    expect(hero).toContain("-5.6%");
    expect(hero).toContain("+16.0 pp");
    // P1-5: the fixture produces no breadth for ANY group — one muted line in
    // plain words, not a stat tile and not a column of pipeline vocabulary.
    expect(host.querySelector('[data-testid="prophet-today-breadth-unavailable"]')!.textContent)
      .toBe("Participation (above trend): not available");
    expect(hero).not.toContain("0/");
    // P1-2: the hero says why it carries the hero, and that Housing leads
    // overall while its members are not in this reading.
    const rank = host.querySelector('[data-testid="prophet-today-rank"]')!.textContent ?? "";
    expect(rank).toContain("Highest-ranked group with published members");
    expect(rank).toContain("Housing Chain leads overall");
    expect(rank).toContain("members not in this reading");
    // P1-3: plan counts belong to the Plans lane — no plan pill in the hero.
    expect(host.querySelector('[data-testid="prophet-today-open-plans"]')).toBeNull();
    // P1-7: the one action is "Inspect sector →".
    expect(host.querySelector('[data-testid="prophet-today-open-group"]')!.textContent).toBe("Inspect sector →");
    // The mixed-basis verdict, in plain words with both clocks.
    expect(host.querySelector('[data-testid="prophet-today-clocks"]')!.textContent).toContain("2026-11-06");
    expect(host.querySelector('[data-testid="prophet-today-verdict"]')!.textContent).toContain("different sessions");
  });

  it("reports the group's cases without inventing entries, return or questions", async () => {
    await renderBoard();
    const clx = host.querySelector('[data-testid="prophet-today-case"][data-symbol="CLX"]')!;
    // P0-1: no trading permission on a descriptive sector-strength board.
    expect(clx.textContent).not.toContain("Long");
    expect(clx.textContent).not.toContain("Opened");
    expect(clx.textContent).not.toContain("Open plan");
    // Plan membership survives as ONE neutral pointer to the Plans lane.
    expect(clx.querySelector('[data-testid="prophet-today-case-plans"]')!.textContent)
      .toBe("Also in Model plans →");
    expect(clx.textContent).toContain("No entry assessment is published");
    // M2: the member-level relative measure is not served — the designed
    // unavailable label, not a zero and not an invented question.
    expect(clx.querySelector('[data-testid="prophet-today-case-vs-sector"]')!.textContent).toBe("not published");
    expect(clx.textContent).toContain("Return vs sector");
    // Defensives publishes exactly six open plans and no early observations:
    // every case shows and no fold is invented.
    expect(host.querySelectorAll('[data-testid="prophet-today-case"]').length).toBe(6);
    expect(host.querySelector('[data-testid="prophet-today-more-cases"]')).toBeNull();
  });

  it("ranks the leadership table by group return with the fixture's leaders first", async () => {
    await renderBoard();
    const rows = [...host.querySelectorAll('[data-testid="prophet-today-leader-row"]')];
    expect(rows.length).toBe(8);
    expect(rows[0].textContent).toContain("Housing");
    expect(rows[0].textContent).toContain("+14.1%");
    // P1-3: the plan-count columns are gone; every row carries a visible
    // Research action instead of being silently clickable.
    expect(rows[0].textContent).toContain("Research →");
    expect(rows[0].textContent).not.toContain("Open plans");
    // P1-5: breadth is absent for every group, so the column is dropped and the
    // fact is stated once under the table.
    expect(host.querySelector('[data-testid="prophet-today-table"]')!.textContent)
      .not.toContain("Not available");
    expect(host.querySelector('[data-testid="prophet-today-breadth-note"]')!.textContent)
      .toBe("Participation (above trend) isn't available for this reading.");
    // P1-2: the hero group's row is marked with a quiet fill, no coloured edge.
    const heroRow = rows.find(row => row.textContent?.includes("Defensives"))!;
    expect(heroRow.className).toContain("heroRow");
    // P1: negative and positive measures carry semantic ink by meaning.
    const defensivesRow = rows.find(row => row.textContent?.includes("Defensives"))!;
    expect(defensivesRow.querySelector(".numUp, [class*=numUp]")).not.toBeNull();
  });

  it("carries the compare selection as chips with count and removal", async () => {
    state = { ...state, sel: ["CLX", "PG"] };
    await renderBoard();
    const strip = host.querySelector('[data-testid="prophet-today-sel"]')!;
    expect(strip.textContent).toContain("CLX");
    expect(strip.textContent).toContain("PG");
    expect(strip.textContent).toContain("2 of 12 selected");
    const compare = strip.querySelector<HTMLButtonElement>('[data-testid="prophet-today-compare-selected"]')!;
    expect(compare.disabled).toBe(false);
    await act(async () => { compare.click(); });
    expect(patches.at(-1)).toEqual({ lane: "sector", view: "compare", group: "defensives", symbol: null, plan: null });
    await act(async () => {
      strip.querySelector<HTMLButtonElement>('button[aria-label*="CLX"]')!.click();
    });
    expect(patches.at(-1)).toEqual({ sel: ["PG"] });
  });

  it("committed actions speak the contract patches exactly", async () => {
    await renderBoard();
    await act(async () => {
      (host.querySelector('[data-testid="prophet-today-case"][data-symbol="CLX"] [data-testid="prophet-today-case-setup"]') as HTMLButtonElement).click();
    });
    // The focused (derived) group rides along so the setup's Back can load it.
    expect(patches.at(-1)).toEqual({ lane: "sector", view: "setup", group: "defensives", symbol: "CLX", plan: null });
    await act(async () => {
      (host.querySelector('[data-testid="prophet-today-case"][data-symbol="GIS"] [data-testid="prophet-today-case-compare"]') as HTMLButtonElement).click();
    });
    expect(patches.at(-1)).toEqual({ sel: ["GIS"] });
    await act(async () => {
      (host.querySelector('[data-testid="prophet-today-leader-row"]') as HTMLTableRowElement).click();
    });
    expect(patches.at(-1)).toEqual({
      lane: "sector", view: "population", group: "housing", symbol: null, q: "", state: null, offset: 0,
    });
  });

  it("a deep-linked sector wins the focus and its unpublished population says so", async () => {
    state = { ...state, group: "housing" };
    await renderBoard();
    expect(text()).toContain("Housing");
    expect(text()).toContain("+14.1%");
    // The deep link is respected: no walk away from the named group.
    const groupReads = fixtureFetch.mock.calls
      .map(call => new URL(String(call[0]), "https://terminal.test").searchParams.get("group"))
      .filter(Boolean);
    expect(groupReads).toEqual(["housing"]);
    const notFound = host.querySelector('[data-testid="prophet-today-cases-notfound"]');
    expect(notFound).not.toBeNull();
    expect(notFound!.textContent).toContain("not in the current sector read");
    // The hero still carries the index context the reader deep-linked for.
    expect(host.querySelector('[data-testid="prophet-today-hero"]')!.textContent).toContain("+14.1%");
  });
});
