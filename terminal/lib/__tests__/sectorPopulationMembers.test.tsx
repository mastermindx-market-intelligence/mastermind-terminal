// @vitest-environment jsdom
/**
 * sectorPopulationMembers.test.tsx — permanent component gates for the member
 * table (review 14:21Z: B1, B2, N4), converted from the independent reviewer's
 * jsdom probes (l3probes/members.test.tsx P1/P2).
 *
 * Laws pinned here:
 *   - B1: the wire carries `group_index` only on the UNFILTERED first page.
 *     Choosing a basket (or applying a search) must never disable the picker —
 *     the captured list lives for the capture's life, so the reader can always
 *     go back to "All" or pick another basket.
 *   - B2: submitting an UNCHANGED query fires no request (run is keyed on
 *     [group, applied]) and therefore must never enter a loading state that
 *     nothing will leave — the table stays on screen.
 *   - N4: a failed "Load more" keeps every page already loaded; the failure is
 *     a per-page line with its own retry, and a successful retry extends the
 *     list — the reader never loses context to a transport failure.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import SectorPopulationMembers from "@/components/sector-intelligence/SectorPopulationMembers";
import { LangProvider } from "@/lib/i18n";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fixture = JSON.parse(readFileSync(
  join(__dirname, "fixtures", "sector_population.captured.v11_page1.json"), "utf8")) as Record<string, unknown>;

const urls: string[] = [];
/** The wire's page discipline: a filtered or continuation page carries no
 * group_index; only the unfiltered first page does. */
const pageFor = (url: string, mutate?: (page: Record<string, unknown>) => void): string => {
  const u = new URL(url, "http://x");
  const data = JSON.parse(JSON.stringify(fixture)) as Record<string, unknown>;
  const page = data.page as Record<string, unknown>;
  const g = u.searchParams.get("group"), q = u.searchParams.get("q");
  if (g || q) {
    delete page.group_index;
    page.filter = { group: g, q };
    page.next_cursor = null;
    page.complete = true;
  }
  mutate?.(page);
  return JSON.stringify(data);
};

let cursorResponse: (() => Response) | null = null;
/** r2 SF-4/N-B/S1 tests: per-test mutation of the served first page. */
let pageMutate: ((page: Record<string, unknown>) => void) | null = null;

beforeEach(() => {
  urls.length = 0;
  cursorResponse = null;
  pageMutate = null;
  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: RequestInit) => {
    urls.push(String(input));
    await new Promise(resolve => setTimeout(resolve, 5));
    if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const u = new URL(String(input), "http://x");
    if (u.searchParams.get("cursor") !== null && cursorResponse !== null) return cursorResponse();
    return new Response(pageFor(String(input), pageMutate ?? undefined), { status: 200, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
};

async function mount(): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<LangProvider><SectorPopulationMembers /></LangProvider>);
  });
  await flush();
  return { container, root };
}

const table = (c: HTMLElement): HTMLElement | null => c.querySelector('[data-testid="sector-population-table"]');
const loading = (c: HTMLElement): boolean => !!c.querySelector('[data-testid="sector-population-loading"]');
const groupOptions = (c: HTMLElement): string[] =>
  [...c.querySelectorAll("select option")].map(option => (option as HTMLOptionElement).value);
const chooseGroup = async (c: HTMLElement, value: string): Promise<void> => {
  const select = c.querySelector("select") as HTMLSelectElement;
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flush();
};

describe("SectorPopulationMembers — review gates", () => {
  it("B1: choosing a basket never disables the group picker", async () => {
    const { container, root } = await mount();
    const select = container.querySelector("select") as HTMLSelectElement;
    expect(select.disabled).toBe(false);
    const before = groupOptions(container);
    expect(before.length).toBeGreaterThan(2); // "All" + the capture's groups

    const basket = before[1];
    await chooseGroup(container, basket);
    // The filtered page carries NO group_index — the picker must stay alive on
    // the capture's captured list, not the current page's.
    expect((container.querySelector("select") as HTMLSelectElement).disabled).toBe(false);
    expect(groupOptions(container)).toEqual(before);
    expect(new URL(urls[urls.length - 1], "http://x").searchParams.get("group")).toBe(basket);

    // And back to "All" — the same capture, the same list.
    await chooseGroup(container, "");
    expect((container.querySelector("select") as HTMLSelectElement).disabled).toBe(false);
    expect(table(container)).not.toBeNull();
    act(() => root.unmount());
  });

  it("B2: an unchanged search submit never enters a loading state nothing will leave", async () => {
    const { container, root } = await mount();
    expect(table(container)).not.toBeNull();
    const fetchesBefore = urls.length;

    // Empty box on first view: applied is already null — nothing may change.
    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();
    expect(loading(container)).toBe(false);
    expect(table(container)).not.toBeNull();
    expect(urls.length).toBe(fetchesBefore);

    // Same non-empty query resubmitted: one flight for the change, none for the repeat.
    const input = container.querySelector("#sector-population-q") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "AAPL");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();
    expect(loading(container)).toBe(false);
    expect(table(container)).not.toBeNull();
    const afterFirst = urls.length;
    expect(afterFirst).toBe(fetchesBefore + 1);

    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();
    expect(loading(container)).toBe(false);
    expect(table(container)).not.toBeNull();
    expect(urls.length).toBe(afterFirst);
    act(() => root.unmount());
  });

  it("B2 (group form): re-selecting the current group fires nothing", async () => {
    const { container, root } = await mount();
    const basket = groupOptions(container)[1];
    await chooseGroup(container, basket);
    const before = urls.length;
    await chooseGroup(container, basket); // same value again
    expect(urls.length).toBe(before);
    expect(loading(container)).toBe(false);
    expect(table(container)).not.toBeNull();
    act(() => root.unmount());
  });

  it("N4: a failed Load more keeps the loaded pages and retries only the failed page", async () => {
    const { container, root } = await mount();
    const rowsAfterFirst = () => [...container.querySelectorAll('[data-testid="sector-population-table"] tbody tr')];
    expect(rowsAfterFirst().length).toBe((fixture.page as { rows: unknown[] }).rows.length);

    // The continuation dies in transport: the loaded page must survive.
    cursorResponse = () => new Response(JSON.stringify({ schema: "sector_generation.error/v1", code: "SERVICE_UNAVAILABLE" }), { status: 503, headers: { "content-type": "application/json" } });
    const loadMore = () => container.querySelector('[data-testid="sector-population-load-more"]');
    await act(async () => { (loadMore() as HTMLButtonElement).click(); });
    await flush();
    expect(table(container)).not.toBeNull(); // never a destroyed list
    expect(rowsAfterFirst().length).toBe((fixture.page as { rows: unknown[] }).rows.length);
    expect(container.querySelector('[data-testid="sector-population-page-failure"]')).not.toBeNull();
    expect(loadMore()).toBeNull(); // the failed affordance is replaced, not duplicated

    // Retry: only the failed continuation re-runs, and the list grows.
    cursorResponse = () => new Response(pageFor("", page => {
      (page.rows as Array<Record<string, unknown>>).forEach((row, index) => { row.symbol = `ZZ${index}`; });
      page.complete = true;
      page.next_cursor = null;
    }), { status: 200, headers: { "content-type": "application/json" } });
    await act(async () => {
      (container.querySelector('[data-testid="sector-population-page-retry"]') as HTMLButtonElement).click();
    });
    await flush();
    expect(container.querySelector('[data-testid="sector-population-page-failure"]')).toBeNull();
    expect(rowsAfterFirst().length).toBe((fixture.page as { rows: unknown[] }).rows.length * 2);
    const lastUrl = new URL(urls[urls.length - 1], "http://x");
    expect(lastUrl.searchParams.get("cursor")).not.toBeNull();
    act(() => root.unmount());
  });
});

describe("SectorPopulationMembers — r2 SF-4/N-B/S1 render gates", () => {
  const cell = (c: HTMLElement, row: number, column: number): string =>
    (c.querySelectorAll('[data-testid="sector-population-table"] tbody tr')[row]?.children[column] as HTMLElement | undefined)?.textContent ?? "";
  const optionText = (c: HTMLElement, value: string): string => {
    const option = [...c.querySelectorAll("select option")].find(o => (o as HTMLOptionElement).value === value) as HTMLOptionElement | undefined;
    return option?.textContent ?? "";
  };
  const withZh = async (run: (mounted: { container: HTMLElement; root: Root }) => Promise<void>): Promise<void> => {
    document.documentElement.setAttribute("data-lang", "zh");
    const mounted = await mount();
    try { await run(mounted); } finally {
      act(() => mounted.root.unmount());
      document.documentElement.removeAttribute("data-lang");
    }
  };

  it("S1: a null configured roster renders 'not stated', never zero", async () => {
    pageMutate = page => {
      const population = ((page as { capture: { population: Record<string, unknown> } }).capture).population;
      population.configured_current = null;
      population.complete = null;
    };
    const { container, root } = await mount();
    const counts = container.querySelector('[data-testid="sector-population-counts"]')?.textContent ?? "";
    expect(counts).toContain("configured roster not stated by the owner");
    expect(counts).not.toMatch(/of 0/);
    expect(counts).not.toContain("1020"); // the dropped roster, not the stale number
    act(() => root.unmount());
  });

  it("SF-4: taxonomy reasons render copy, never the raw owner code (en)", async () => {
    pageMutate = page => {
      const rows = (page as { rows: Array<Record<string, unknown>> }).rows;
      rows[0].industry = { status: "unavailable", reason: "gics_feed_not_produced" };
      rows[1].industry = { status: "unavailable", reason: "not_produced" };
    };
    const { container, root } = await mount();
    expect(cell(container, 0, 2)).toBe("Unavailable");            // unlisted reason → generic
    expect(cell(container, 1, 2)).toBe("Not produced for this reading"); // wire-listed reason
    expect(cell(container, 0, 3)).toBe("Not in current classification");  // fixture's sub-industry reason
    expect(container.textContent).not.toContain("gics_feed_not_produced");
    act(() => root.unmount());
  });

  it("SF-4: the zh surface renders the same mapped copy, never the raw code (zh)", async () => {
    pageMutate = page => {
      const rows = (page as { rows: Array<Record<string, unknown>> }).rows;
      rows[0].industry = { status: "unavailable", reason: "gics_feed_not_produced" };
      rows[1].industry = { status: "unavailable", reason: "not_produced" };
    };
    await withZh(async ({ container }) => {
      expect(cell(container, 0, 2)).toBe("不可用");
      expect(cell(container, 1, 2)).toBe("本次读取未产出");
      expect(cell(container, 0, 3)).toBe("不在当前分类中");
      expect(container.textContent).not.toContain("gics_feed_not_produced");
    });
  });

  it("N-B: an unnamed group reads 'Unnamed group' — the raw id is never reader-facing (en)", async () => {
    pageMutate = page => {
      (page as { group_index: Array<Record<string, unknown>> }).group_index.push(
        { group_id: "unnamed_probe", name: null, n_members_listed: 3, n_configured_current: 3, n_unserved: 0 });
    };
    const { container, root } = await mount();
    const text = optionText(container, "unnamed_probe");
    expect(text).toContain("Unnamed group");
    expect(text).not.toContain("unnamed_probe");
    act(() => root.unmount());
  });

  it("N-B: the zh picker uses the page's zh group name and the generic unnamed label (zh)", async () => {
    pageMutate = page => {
      (page as { group_index: Array<Record<string, unknown>> }).group_index.push(
        { group_id: "unnamed_probe", name: null, n_members_listed: 3, n_configured_current: 3, n_unserved: 0 });
    };
    await withZh(async ({ container }) => {
      // The descriptor on the served page carries name_zh for housing.
      expect(optionText(container, "housing")).toContain("住房产业链");
      expect(optionText(container, "unnamed_probe")).toContain("未命名分组");
      expect(optionText(container, "unnamed_probe")).not.toContain("unnamed_probe");
    });
  });

  it("N-B: the industry label localizes to its zh twin when the wire carries it (zh)", async () => {
    pageMutate = page => {
      (page as { rows: Array<Record<string, unknown>> }).rows[0].industry =
        { status: "available", label: "Household Durables", label_zh: "耐用消费品" };
    };
    await withZh(async ({ container }) => {
      expect(cell(container, 0, 2)).toBe("耐用消费品");
    });
  });

  it("item 6: an index name_zh names the zh picker option for a group not on the page (zh)", async () => {
    // The index carries a zh twin for a group whose page descriptor is absent
    // (the fixture page lists housing only): the zh option reads the index's zh
    // name — never the English name, never the raw id. The page descriptor's
    // own name_zh still wins for the group that IS on the page (housing).
    pageMutate = page => {
      (page as { group_index: Array<Record<string, unknown>> }).group_index.push(
        { group_id: "precious", name: "Precious Metals", name_zh: "贵金属矿商",
          n_members_listed: 4, n_configured_current: 4, n_unserved: 0 });
    };
    await withZh(async ({ container }) => {
      expect(optionText(container, "precious")).toContain("贵金属矿商");
      expect(optionText(container, "precious")).not.toContain("Precious Metals");
      expect(optionText(container, "housing")).toContain("住房产业链"); // descriptor still wins
    });
  });

  it("item 6: with no zh anywhere the option keeps the generic fallback, never the raw id (zh)", async () => {
    pageMutate = page => {
      (page as { group_index: Array<Record<string, unknown>> }).group_index.push(
        { group_id: "no_zh_probe", name: "Named Group", name_zh: null,
          n_members_listed: 2, n_configured_current: 2, n_unserved: 0 });
    };
    await withZh(async ({ container }) => {
      expect(optionText(container, "no_zh_probe")).toContain("Named Group");
      expect(optionText(container, "no_zh_probe")).not.toContain("no_zh_probe");
    });
  });

  it("N-A: a capture rollover never leaves the picker disabled while a group is set", async () => {
    // First page: capture C1 with group_index (fixture default). After the
    // reader chooses a basket, the owner's answer comes from a NEW capture
    // (context_ref changed, no group_index): the captured list is honestly
    // absent for it, but the picker must stay usable — the group is still
    // set, and "All groups" is always a lawful next choice.
    const { container, root } = await mount();
    const basket = groupOptions(container)[1];
    expect(basket).not.toBe("");
    pageMutate = page => { (page as { context_ref: string }).context_ref = "rollover-capture-2"; };
    await chooseGroup(container, basket);
    const select = container.querySelector("select") as HTMLSelectElement;
    expect(select.disabled).toBe(false);
    // The filter state still holds the chosen basket — proven by the request
    // the rollover page answered, not by the option list (the new capture
    // carries none, so the select's live value reads "" in the DOM).
    expect(new URL(urls[urls.length - 1], "http://x").searchParams.get("group")).toBe(basket);
    expect(groupOptions(container)).toEqual([""]); // the new capture carried no list
    await chooseGroup(container, "");
    expect(new URL(urls[urls.length - 1], "http://x").searchParams.get("group")).toBeNull();
    expect(table(container)).not.toBeNull();
    act(() => root.unmount());
  });
});

describe("SectorPopulationMembers — item 5 (COO 19:15Z): lane 1 point-in-time facts render honestly", () => {
  const cell = (c: HTMLElement, row: number, column: number): string =>
    (c.querySelectorAll('[data-testid="sector-population-table"] tbody tr')[row]?.children[column] as HTMLElement | undefined)?.textContent ?? "";
  const withZh = async (run: (mounted: { container: HTMLElement; root: Root }) => Promise<void>): Promise<void> => {
    document.documentElement.setAttribute("data-lang", "zh");
    const mounted = await mount();
    try { await run(mounted); } finally {
      act(() => mounted.root.unmount());
      document.documentElement.removeAttribute("data-lang");
    }
  };
  const countsLine = (c: HTMLElement) => c.querySelector('[data-testid="sector-population-counts"]')?.textContent ?? "";
  const clockNote = (c: HTMLElement) => c.querySelector('[data-testid="sector-population-roster-clock"]')?.textContent ?? null;
  const snapshotLine = (c: HTMLElement) => c.querySelector('[data-testid="sector-population-snapshot"]')?.textContent ?? null;
  const taxonomyNote = (c: HTMLElement) => c.querySelector('[data-testid="sector-population-taxonomy-basis"]')?.textContent ?? null;
  const firstKnownCell = (c: HTMLElement, row: number) => cell(c, row, 4);
  const snapshotFact = (equals: boolean | null) => ({
    status: "available", source: "baskets_membership_pit", as_of: "2026-11-06", suite: "baskets",
    groups: { housing: { status: "available", snapshot_date: "2026-11-05", members_sha: "a".repeat(64), member_count: 18, equals_current_roster: equals } },
  });
  const firstKnownFact = () => ({
    status: "available", source: "baskets_membership_pit", as_of: "2026-11-06",
    basis: "lower_bound_from_stored_snapshots", basis_note: "note",
    store_first: "2025-01-15", store_last: "2026-11-05", absent_pair_reason: "no_stored_snapshot",
    groups: { housing: { MHK: "2025-06-02", FBIN: null } },
  });
  const identityOf = (page: Record<string, unknown>) =>
    ((page as { capture: { identity: Record<string, unknown> } }).capture).identity;
  const populationOf = (page: Record<string, unknown>) =>
    ((page as { capture: { population: Record<string, unknown> } }).capture).population;

  // B-1 (third review): the producer's own non-agree bytes — the clock beside
  // configured_current/complete/unaccounted ALL null — must render the member
  // list with not-stated counts. The earlier version of these tests paired a
  // mismatched clock with unaccounted:0 and configured_current:1020, a shape
  // the producer never emits.
  const producerNonAgree = (clock: unknown) => (page: Record<string, unknown>) => {
    const pop = populationOf(page);
    pop.roster_clock = clock;
    pop.configured_current = null; pop.complete = null; pop.unaccounted = null;
  };

  it("B-1: the producer's non-agree mismatch page renders the list with not-stated counts (en)", async () => {
    pageMutate = producerNonAgree({ status: "mismatch", reason: "roster_as_of_mismatch",
      roster_as_of: "2026-11-07", capture_effective_as_of: "2026-11-06" });
    const { container, root } = await mount();
    expect(countsLine(container)).toContain("configured roster not stated by the owner");
    expect(countsLine(container)).not.toContain("1020");
    expect(countsLine(container)).not.toContain("unaccounted"); // null prints nothing
    expect(clockNote(container)).toContain("roster clock does not agree with the capture session");
    expect(cell(container, 0, 0)).toBeTruthy(); // the member list itself still renders
    act(() => root.unmount());
  });

  it("B-1: the producer's non-agree roster_block_absent page renders the same honest states (zh)", async () => {
    pageMutate = producerNonAgree({ status: "unavailable", reason: "roster_block_absent", roster_as_of: "2026-11-06" });
    await withZh(async ({ container }) => {
      expect(countsLine(container)).toContain("所有者未给出配置名单");
      expect(countsLine(container)).not.toContain("1020");
      expect(clockNote(container)).toContain("名册时钟与采集会话不一致");
    });
  });

  it("N-4: an agree label over differing clocks keeps the counts not stated beside a clock note (en)", async () => {
    pageMutate = page => {
      populationOf(page).roster_clock = { status: "agree", roster_as_of: "2026-11-06", capture_effective_as_of: "2026-11-07" };
    };
    const { container, root } = await mount();
    expect(countsLine(container)).toContain("configured roster not stated by the owner");
    expect(countsLine(container)).not.toContain("1020");
    expect(clockNote(container)).toContain("roster clock does not agree with the capture session");
    act(() => root.unmount());
  });

  it("agree with a null unaccounted states no counts and shows no clock note (en)", async () => {
    pageMutate = page => {
      const pop = populationOf(page);
      pop.roster_clock = { status: "agree", roster_as_of: "2026-11-06", capture_effective_as_of: "2026-11-06" };
      pop.unaccounted = null;
    };
    const { container, root } = await mount();
    expect(countsLine(container)).toContain("configured roster not stated by the owner");
    expect(countsLine(container)).not.toContain("1020");
    expect(clockNote(container)).toBeNull();
    act(() => root.unmount());
  });

  it("an agreeing clock keeps the stated counts and renders no clock note", async () => {
    pageMutate = page => {
      populationOf(page).roster_clock = { status: "agree", roster_as_of: "2026-11-06", capture_effective_as_of: "2026-11-06" };
    };
    const { container, root } = await mount();
    expect(countsLine(container)).toContain("1020");
    expect(clockNote(container)).toBeNull();
    act(() => root.unmount());
  });

  it("a carried-but-unreadable clock is not-agree: counts not stated even against a stated roster", async () => {
    pageMutate = page => {
      populationOf(page).roster_clock = 42;
    };
    const { container, root } = await mount();
    expect(countsLine(container)).not.toContain("1020");
    expect(clockNote(container)).toContain("roster clock does not agree");
    act(() => root.unmount());
  });

  it("first-known dates word the lower bound, and a null pair is not 'not a member' (en)", async () => {
    pageMutate = page => { identityOf(page).membership_first_known = firstKnownFact(); };
    const { container, root } = await mount();
    expect(firstKnownCell(container, 0)).toContain("First seen in stored snapshots on or before 2025-06-02");
    expect(firstKnownCell(container, 0)).toContain("2023-05-09"); // the current-basis date stays
    expect(firstKnownCell(container, 1)).toContain("No stored snapshot holds this pair");
    expect(container.textContent).not.toMatch(/joined/i);
    act(() => root.unmount());
  });

  it("zh lower-bound and null-pair wordings (zh)", async () => {
    pageMutate = page => { identityOf(page).membership_first_known = firstKnownFact(); };
    await withZh(async ({ container }) => {
      expect(firstKnownCell(container, 0)).toContain("不晚于 2025-06-02 已见于存储成员快照");
      expect(firstKnownCell(container, 1)).toContain("存储快照中没有该配对的记录");
    });
  });

  it("an unavailable or absent first-known fact keeps the column exactly as today", async () => {
    const { container, root } = await mount(); // fixture placeholder: unavailable/not_produced
    expect(firstKnownCell(container, 0)).toBe("2023-05-09");
    act(() => root.unmount());
    pageMutate = page => { identityOf(page).membership_first_known = { status: "available", basis: "wrong" }; };
    const second = await mount();
    expect(firstKnownCell(second.container, 0)).toBe("2023-05-09");
    act(() => second.root.unmount());
  });

  it("the selected group's stored snapshot states date, count and roster comparison", async () => {
    for (const [equals, expected] of [[true, "matches the current roster"],
      [false, "differs from the current roster"], [null, "current-roster comparison unavailable"]] as const) {
      pageMutate = page => { identityOf(page).membership_snapshot = snapshotFact(equals); };
      const { container, root } = await mount();
      await chooseGroup(container, "housing");
      expect(snapshotLine(container)).toContain("Stored membership snapshot 2026-11-05: 18 members");
      expect(snapshotLine(container)).toContain(expected);
      act(() => root.unmount());
    }
  });

  it("a carried-unavailable snapshot for the selected group renders the generic line; an absent one renders nothing", async () => {
    pageMutate = page => { identityOf(page).membership_snapshot = { status: "unavailable", reason: "carried_block_undated" }; };
    const { container, root } = await mount();
    await chooseGroup(container, "housing");
    expect(snapshotLine(container)).toContain("Point-in-time membership snapshot unavailable");
    act(() => root.unmount());
    pageMutate = null; // today's wire carries no snapshot fact at all
    const second = await mount();
    await chooseGroup(second.container, "housing");
    expect(snapshotLine(second.container)).toBeNull();
    act(() => second.root.unmount());
  });

  it("the taxonomy current-basis stamp renders the basis note; today's placeholder does not", async () => {
    pageMutate = page => {
      identityOf(page).taxonomy_revision = { status: "unavailable", reason: "no_point_in_time_classification_source",
        labels_basis: "current_not_point_in_time", labels: ["industry", "sub_industry"] };
    };
    const { container, root } = await mount();
    expect(taxonomyNote(container)).toContain("Classifications are current-basis, not point-in-time");
    act(() => root.unmount());
    pageMutate = null;
    const second = await mount();
    expect(taxonomyNote(second.container)).toBeNull();
    act(() => second.root.unmount());
  });

  it("removed_members carried_block_undated renders the generic unavailable note, never a number", async () => {
    pageMutate = page => { populationOf(page).removed_members = { status: "unavailable", reason: "carried_block_undated" }; };
    const { container, root } = await mount();
    expect(table(container)).not.toBeNull(); // the page was never refused
    const removed = container.querySelector('[data-testid="sector-population-removed"]')?.textContent ?? "";
    expect(removed).toContain("Removed-member list unavailable");
    expect(removed).not.toMatch(/\d/);
    act(() => root.unmount());
  });
});
