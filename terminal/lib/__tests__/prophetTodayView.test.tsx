// @vitest-environment jsdom
/**
 * prophetTodayView.test.tsx — the Today board against the COMMITTED fixture
 * captures, byte-for-byte (public/data/prophet_sector_members_fixture).
 *
 * Laws pinned here (gap G1/G2/G21 acceptance):
 *   - Reading order: assessment → research cases → leadership table (the DOM
 *     order is the reading order).
 *   - The bounded population walk settles on the first candidate with a
 *     PUBLISHED population (the fixtures publish 3 of 49; production publishes
 *     all and stops at the first).
 *   - Nulls render the owner's reason ("not produced"), never a zero and never
 *     an invented number; no entry assessment is published for any member.
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
/** The walk skips unpublished populations: Financials…Utilities (ranks 1–6)
 * 404 before us_sector_industrials (rank 7 by open plans) reads. */
const WALK_404S = 11;

describe("Today board — committed-fixture acceptance", () => {
  it("reads assessment → cases → leadership, in that DOM order", async () => {
    await renderBoard();
    const hero = host.querySelector('[data-testid="prophet-today-hero"]');
    const cases = host.querySelector('[data-symbol="CARR"]');
    const table = host.querySelector('[data-testid="prophet-today-table"]');
    expect(hero).not.toBeNull();
    expect(cases).not.toBeNull();
    expect(table).not.toBeNull();
    expect(hero!.compareDocumentPosition(cases!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(cases!.compareDocumentPosition(table!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("settles the focus on the first candidate with a published population", async () => {
    await renderBoard();
    const groupReads = fixtureFetch.mock.calls
      .map(call => new URL(String(call[0]), "https://terminal.test").searchParams.get("group"))
      .filter(Boolean);
    // The walk read every higher-open-plan candidate (each unpublished) before
    // landing the first published one — and STOPPED there.
    expect(groupReads).toHaveLength(WALK_404S + 1);
    expect(groupReads![WALK_404S]).toBe("us_sector_industrials");
    expect(text()).toContain("Industrials (Equal-Weight)");
  });

  it("renders the owner's read and reason vocabulary, never invented numbers", async () => {
    await renderBoard();
    const hero = host.querySelector('[data-testid="prophet-today-hero"]')!.textContent ?? "";
    expect(hero).toContain("Recovery");
    expect(hero).toContain("+1.1%");
    expect(hero).toContain("-5.6%");
    expect(hero).toContain("+6.7 pp");
    // The fixture produces no breadth for ANY group: the owner's reason shows.
    expect(hero).toContain("not produced");
    expect(hero).not.toContain("0/");
    // Coverage counts are reported facts from the index, not derived here.
    expect(host.querySelector('[data-testid="prophet-today-open-plans"]')!.textContent).toBe("7");
    // The mixed-basis verdict, in plain words with both clocks.
    expect(host.querySelector('[data-testid="prophet-today-clocks"]')!.textContent).toContain("2026-11-06");
    expect(host.querySelector('[data-testid="prophet-today-verdict"]')!.textContent).toContain("different sessions");
  });

  it("reports cases without inventing entries, and folds the rest behind Still developing", async () => {
    await renderBoard();
    const carr = host.querySelector('[data-testid="prophet-today-case"][data-symbol="CARR"]')!;
    expect(carr.textContent).toContain("Open plan");
    expect(carr.textContent).toContain("Long");
    expect(carr.textContent).toContain("Opened 2026-10-20");
    expect(carr.textContent).toContain("No entry assessment is published");
    // 18 case members in the fixture group: 6 shown, 12 named behind the fold.
    expect(host.querySelectorAll('[data-testid="prophet-today-case"]').length).toBe(18);
    const fold = host.querySelector('[data-testid="prophet-today-more-cases"]') as HTMLDetailsElement | null;
    expect(fold).not.toBeNull();
    expect(fold!.textContent).toContain("12 further cases");
    expect(fold!.open).toBe(false);
    // Early observations sit inside the fold, not above it.
    const adp = host.querySelector('[data-testid="prophet-today-case"][data-symbol="ADP"]')!;
    expect(adp.textContent).toContain("Early observation");
    expect(adp.closest("details")).toBe(fold);
  });

  it("ranks the leadership table by group return with the fixture's leaders first", async () => {
    await renderBoard();
    const rows = [...host.querySelectorAll('[data-testid="prophet-today-leader-row"]')];
    expect(rows.length).toBe(8);
    expect(rows[0].textContent).toContain("Housing");
    expect(rows[0].textContent).toContain("+14.1%");
    expect(rows[0].textContent).toContain("2"); // open plans count column
    // Nulls in the reason vocabulary, never zeros.
    expect(rows[0].textContent).toContain("not produced");
  });

  it("carries the compare selection as chips with count and removal", async () => {
    state = { ...state, sel: ["CARR", "GE"] };
    await renderBoard();
    const strip = host.querySelector('[data-testid="prophet-today-sel"]')!;
    expect(strip.textContent).toContain("CARR");
    expect(strip.textContent).toContain("GE");
    expect(strip.textContent).toContain("2 of 12 selected");
    await act(async () => {
      strip.querySelector<HTMLButtonElement>('button[aria-label*="CARR"]')!.click();
    });
    expect(patches.at(-1)).toEqual({ sel: ["GE"] });
  });

  it("committed actions speak the contract patches exactly", async () => {
    await renderBoard();
    await act(async () => {
      (host.querySelector('[data-testid="prophet-today-case"][data-symbol="CARR"] [data-testid="prophet-today-case-setup"]') as HTMLButtonElement).click();
    });
    expect(patches.at(-1)).toEqual({ lane: "sector", view: "setup", symbol: "CARR", plan: null });
    await act(async () => {
      (host.querySelector('[data-testid="prophet-today-case"][data-symbol="GE"] [data-testid="prophet-today-case-compare"]') as HTMLButtonElement).click();
    });
    expect(patches.at(-1)).toEqual({ sel: ["GE"] });
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
