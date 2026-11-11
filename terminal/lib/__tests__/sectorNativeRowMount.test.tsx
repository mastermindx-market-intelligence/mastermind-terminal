// @vitest-environment jsdom
/**
 * sectorNativeRowMount.test.tsx — round 2 part 2 + fix r1: lane 7's five row
 * readers (`confluence_universe_{sp500,nasdaq,russell,baskets}` +
 * `theme_rows`) mounted in the dossier Drivers tab through the workspace's
 * own carried gate (`sectorRowBlocksFromFeed`).
 *
 * Laws pinned here:
 *   - NO ROW BLOCK CARRIED (fix r1 B-1): an absent `typed_blocks` key, a
 *     non-plain value (null, array, string, number — the decoder's own rule),
 *     an empty map, a map of only unknown names, the v1.0 producer's seven-key
 *     map, and a twelve-key map whose five row entries are all preview
 *     `audience_not_entitled` stubs ALL read null and render the Drivers tab
 *     byte-for-byte the committed master golden — never five fabricated
 *     not_produced stubs.
 *   - PER-READER CARRIAGE: a name that is not an own key of the raw map stays
 *     `undefined` — the readers' "prop omitted" path, which is master's
 *     typed-unavailable state. theme_rows alone, and one universe alone, mount
 *     only their own reader.
 *   - CARRIED ENTRY VERBATIM (fix r1 S-1): each reader gets the carried entry
 *     ITSELF, not the decoder's normalised one — a malformed entry (null, the
 *     string "available", `{status:"bogus"}`, `{status:"unavailable",
 *     reason:7}`) reads the reader's GENERIC unavailable wording in both
 *     languages, never "The owner engine did not produce this reading
 *     tonight."; a carried not_produced entry keeps that wording.
 *   - INTERIM AUDIENCE RULE (fix r1 item 3): the route reads preview for
 *     every member, so an exactly-audience_not_entitled entry is not carried
 *     and the false-for-members subscription wording never renders — a mixed
 *     map keeps master's state for the stub's reader while carried readers
 *     still render their rows.
 *   - CARRIED entitled (the five real producer specimens): rows render through
 *     the readers only — S&P 65 subsectors + 11 roll-up rows without links,
 *     Nasdaq's 0-subsector/6-roll-up build-time night, Russell's honest zero,
 *     baskets 49, theme table 49 with its own date. No copy beyond the
 *     readers' own states; no owner identifier becomes visible text.
 *   - ZH: carried `label_zh`/`name_zh` verbatim; null `label_zh` falls back to
 *     the producer's English label (no consumer-authored names); theme state
 *     words localize with the raw word only in `data-val`.
 *   - The full workspace mounts the same reads (memo → dossier prop) for the
 *     absent, seven-key and carried wires.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ZH without mounting LangProvider's document effect (same approach as
// sectorDepthRender.test.tsx): the real i18n module keeps its real copy
// tables; only useLang resolves through this override.
const G = globalThis as unknown as { __SI_ROW_LANG?: "en" | "zh" };
G.__SI_ROW_LANG = "en";
vi.mock("@/lib/i18n", async (orig) => {
  const m = (await orig()) as Record<string, unknown>;
  return {
    ...m,
    useLang: () => ({ lang: G.__SI_ROW_LANG ?? "en", setLang: () => {} }),
  };
});
const session = vi.hoisted(() => ({ identity: { kind: "guest" } as { kind: "guest" } }));
vi.mock("@/components/chrome/AppShell", () => ({ useShellIdentity: () => session.identity }));

import SectorNativeDossier from "@/components/sector-intelligence/SectorNativeDossier";
import SectorIntelligenceWorkspace, { sectorRowBlocksFromFeed } from "@/components/sector-intelligence/SectorIntelligenceWorkspace";
import type { SectorNativeContext } from "@/components/sector-intelligence/sectorNativeSlots";
import { sectorNativeGeneration, SECTOR_GENERATION_PATH } from "@/lib/sectorNativeGeneration";
import type { FeedPayload } from "../sectorIntelligence";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no matchMedia; the calls board's phone-disclosure query needs it.
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false, media: query, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    }),
  });
});

const captured = JSON.parse(readFileSync(
  join(__dirname, "fixtures", "sector_generation.captured.preview.v1.json"), "utf8"),
) as { source_session: string; projection: { data: Record<string, unknown>; receipt: Record<string, unknown> } };
const entitled = JSON.parse(readFileSync(
  join(__dirname, "fixtures", "typed_blocks_entitled.json"), "utf8"),
) as Record<string, { status: string; reason: string | null; value: unknown }>;

const ROW_BLOCK_NAMES = ["confluence_universe_sp500", "confluence_universe_nasdaq",
  "confluence_universe_russell", "confluence_universe_baskets", "theme_rows"] as const;
// The decoder's own closed twelve-name list minus the five row names (fix r1:
// the v1.0 producer's map shape, taken from lib/sectorNativeGeneration.ts).
const NO_ROW_NAMES_7 = ["r1_rising_priced_share", "r2_display_order", "r2_hazard_qualification",
  "etf_flows", "confluence", "bottoming_watch", "theme_table"] as const;

/** A deep clone of the real captured generation with `typed_blocks` set. */
const carriedWire = (blocks: unknown): Record<string, unknown> => {
  const wire = JSON.parse(JSON.stringify(captured)) as typeof captured;
  (wire.projection.data as Record<string, unknown>).typed_blocks = blocks;
  return wire as unknown as Record<string, unknown>;
};
/** Deep clone per use: the decoder's `bounded()` walk refuses a SHARED object
 * reference (its seen-set guard), and a wire that arrived as JSON can never
 * contain one — a test carrying the same malformed shape under two names must
 * carry two distinct objects, exactly as the real wire would. */
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
/** The five row entries as the served surface writes a stub. */
const stubBlocks = (reason: string): Record<string, unknown> => Object.fromEntries(
  ROW_BLOCK_NAMES.map(name => [name, { status: "unavailable", reason, value: null }]));
/** The v1.0 producer's seven-key map: no row block, non-row entries inert. */
const sevenKeyMap = (): Record<string, unknown> => Object.fromEntries(
  NO_ROW_NAMES_7.map(name => [name, { status: "unavailable", reason: "not_produced", value: null }]));
const AUDIENCE_STUB = { status: "unavailable", reason: "audience_not_entitled", value: null };

const sector0 = (captured.projection.data.core as { sectors: Array<{
  id: string; ticker: string; name: string; name_zh?: string;
}> }).sectors[0];

const feedOf = (wire: Record<string, unknown>): FeedPayload => ({
  data: wire, receipt: { source: "generation", status: "ready", path: SECTOR_GENERATION_PATH,
    asOf: captured.source_session, observedAt: "2026-11-10T00:00:00Z", contentHash: "fixed", stale: false },
});

const handlers = {
  onView: vi.fn(), onBack: vi.fn(), onJob: vi.fn(), onOpenRotation: vi.fn(),
  onTheme: vi.fn(), onRefresh: vi.fn(), onSources: vi.fn(), onSelect: vi.fn(),
};

/** Mount the dossier Drivers tab exactly as the workspace does: decode the
 * wire, run the real carried gate, pass its reads as the rowBlocks prop. */
const mountDrivers = async (wire: Record<string, unknown>, lang: "en" | "zh" = "en"): Promise<HTMLElement> => {
  G.__SI_ROW_LANG = lang;
  const generation = sectorNativeGeneration(wire);
  expect(generation, "fixture must admit as a native generation").not.toBeNull();
  const context: SectorNativeContext = {
    generation, transport: "ready", qualification: "accepted",
    subject: { id: sector0.id, ticker: sector0.ticker, name: sector0.name, nameZh: sector0.name_zh ?? sector0.name },
    ranked63: [sector0.id], lead21: sector0.id, language: lang, theme: "dark",
    binding: { ownerRevision: "r1", generationKey: "g1", subjectId: sector0.id, universe: "us",
      metric: "relative_wealth_pct", windows: [63], basis: "total_return" },
  };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<SectorNativeDossier context={context} view="drivers" {...handlers}
      rowBlocks={sectorRowBlocksFromFeed(feedOf(wire), generation)} />);
  });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  return host;
};

afterEach(() => {
  G.__SI_ROW_LANG = "en";
  document.body.replaceChildren();
});

const GOLDEN_PATH = join(__dirname, "fixtures", "sectorNativeDossierDrivers.master.v1.html");
// React's useId counter is process-global, never rewinds, and is BASE-32:
// after 9 it emits `_r_a_`, `_r_b_`, … Only the FIRST mount of a process
// renders `_r_0_`/`_r_1_`/`_r_2_`; later mounts render `_r_4_`, `_r_a_`,
// `_r_l_`, … (verified by probe; unmounting does not reset it). Those opaque
// instance ids are the only difference between a later mount and the captured
// golden. Normalize an id-valued attribute (`="_r_<base32>_"`) on BOTH sides
// at comparison — the golden FILE stays unchanged — and pin the id COUNT
// unmasked so a lost or gained id still fails.
const ID_ATTR = /="_r_[0-9a-v]+_"/g;
const expectGolden = (host: HTMLElement) => {
  const actual = host.querySelector('[data-testid="sector-native-dossier"]')!.innerHTML;
  const golden = readFileSync(GOLDEN_PATH, "utf8");
  expect((actual.match(ID_ATTR) ?? []).length).toBe((golden.match(ID_ATTR) ?? []).length);
  expect(actual.replace(ID_ATTR, '="_r_N_"')).toBe(golden.replace(ID_ATTR, '="_r_N_"'));
};

describe("the carried gate — sectorRowBlocksFromFeed (round 2 part 2 + fix r1)", () => {
  it("an absent typed_blocks map (today's wire) reads null — the dossier keeps master's rendering", () => {
    const generation = sectorNativeGeneration(captured as unknown as Record<string, unknown>);
    expect(generation).not.toBeNull();
    // The decoded shape cannot tell absent from a carried all-not_produced map…
    expect(generation!.typedBlocks.theme_rows).toEqual({ status: "unavailable", reason: "not_produced", value: null });
    // …so the gate reads the raw wire document's own map and returns null.
    expect(sectorRowBlocksFromFeed(feedOf(captured as unknown as Record<string, unknown>), generation)).toBeNull();
  });

  it("no admitted generation (feed absent, erroring or null data) reads null", () => {
    expect(sectorRowBlocksFromFeed(undefined, null)).toBeNull();
    const generation = sectorNativeGeneration(captured as unknown as Record<string, unknown>);
    expect(sectorRowBlocksFromFeed({ data: null, receipt: feedOf({}).receipt }, generation)).toBeNull();
  });

  it("a typed_blocks value that is not a plain object reads null — the decoder's own rule (fix r1 B-1)", () => {
    for (const value of [null, [], "x", 42]) {
      const wire = carriedWire(value);
      const generation = sectorNativeGeneration(wire);
      expect(generation, `generation admits with typed_blocks=${JSON.stringify(value)}`).not.toBeNull();
      expect(sectorRowBlocksFromFeed(feedOf(wire), generation), `typed_blocks=${JSON.stringify(value)}`).toBeNull();
    }
  });

  it("an empty map, and a map of only unknown names, read null", () => {
    for (const blocks of [{}, { zzz: { status: "available", reason: null, value: {} } }]) {
      const wire = carriedWire(blocks);
      const generation = sectorNativeGeneration(wire);
      expect(generation).not.toBeNull();
      expect(sectorRowBlocksFromFeed(feedOf(wire), generation)).toBeNull();
    }
  });

  it("the v1.0 seven-key producer map — no row block carried — reads null (fix r1 B-1)", () => {
    const wire = carriedWire(sevenKeyMap());
    const generation = sectorNativeGeneration(wire);
    expect(generation).not.toBeNull();
    // The decoder decodes all seven; none of them is a row block.
    expect(generation!.typedBlocks.etf_flows).toEqual({ status: "unavailable", reason: "not_produced", value: null });
    expect(sectorRowBlocksFromFeed(feedOf(wire), generation)).toBeNull();
  });

  it("a twelve-key map whose five row entries are all preview audience stubs reads null (interim audience rule, fix r1 item 3)", () => {
    const wire = carriedWire({ ...sevenKeyMap(), ...stubBlocks("audience_not_entitled") });
    const generation = sectorNativeGeneration(wire);
    expect(generation).not.toBeNull();
    expect(sectorRowBlocksFromFeed(feedOf(wire), generation)).toBeNull();
  });

  it("a CARRIED all-not_produced map is not the absent case: the readers get their entries", () => {
    const wire = carriedWire(stubBlocks("not_produced"));
    const generation = sectorNativeGeneration(wire);
    const reads = sectorRowBlocksFromFeed(feedOf(wire), generation);
    expect(reads).not.toBeNull();
    expect(reads!.universeBlocks!.subsectors).toEqual({ state: "unavailable", reason: "not_produced" });
    expect(reads!.themeRows).toEqual({ state: "unavailable", reason: "not_produced" });
  });

  it("theme_rows carried alone yields only the theme read; the universes mount stays omitted", () => {
    const wire = carriedWire({ theme_rows: entitled.theme_rows });
    const generation = sectorNativeGeneration(wire);
    const reads = sectorRowBlocksFromFeed(feedOf(wire), generation);
    expect(reads).not.toBeNull();
    expect(reads!.universeBlocks).toBeUndefined();
    expect(reads!.themeRows?.state).toBe("available");
  });

  it("one universe carried alone yields only that reader's read", () => {
    const wire = carriedWire({ confluence_universe_sp500: entitled.confluence_universe_sp500 });
    const generation = sectorNativeGeneration(wire);
    const reads = sectorRowBlocksFromFeed(feedOf(wire), generation);
    expect(reads).not.toBeNull();
    expect(reads!.universeBlocks?.subsectors?.state).toBe("available");
    expect(reads!.universeBlocks?.nasdaq).toBeUndefined();
    expect(reads!.themeRows).toBeUndefined();
  });

  it("a carried malformed entry flows to the reader RAW — the reader's own classifier reads generic unknown (fix r1 S-1)", () => {
    for (const entry of [null, "available", { status: "bogus" }, { status: "unavailable", reason: 7 }]) {
      const wire = carriedWire({ theme_rows: entry });
      const generation = sectorNativeGeneration(wire);
      const reads = sectorRowBlocksFromFeed(feedOf(wire), generation);
      expect(reads?.themeRows, `entry=${JSON.stringify(entry)}`).toEqual({ state: "unavailable", reason: "unknown" });
    }
  });

  it("the entitled mapping yields one read per reader from its own block", () => {
    const wire = carriedWire(entitled);
    const generation = sectorNativeGeneration(wire);
    const reads = sectorRowBlocksFromFeed(feedOf(wire), generation);
    expect(reads).not.toBeNull();
    const subsectors = reads!.universeBlocks!.subsectors!;
    const nasdaq = reads!.universeBlocks!.nasdaq!;
    expect(subsectors.state).toBe("available");
    expect(subsectors.state === "available" && subsectors.asOf).toBe("2026-11-06");
    expect(subsectors.state === "available" && subsectors.asOfField).toBe("as_of");
    expect(nasdaq.state === "available" && nasdaq.asOfField).toBe("generated_utc");
    expect(reads!.universeBlocks!.russell!.state).toBe("available");
    expect(reads!.universeBlocks!.baskets!.state).toBe("available");
    expect(reads!.themeRows?.state).toBe("available");
    expect(reads!.themeRows?.state === "available" && reads!.themeRows.rows).toHaveLength(49);
  });
});

describe("DossierDepth row mounts — no row block carried equals master (golden)", () => {
  it("the Drivers tab renders the committed master golden byte-for-byte (captured wire, no typed_blocks)", async () => {
    const host = await mountDrivers(captured as unknown as Record<string, unknown>);
    expectGolden(host);
    // The golden's legible core, asserted where it matters most:
    expect(host.querySelector('[data-depth-unavailable="confluence"]')).not.toBeNull();
    expect(host.querySelector('[data-depth-unavailable="theme_table"]')).not.toBeNull();
    expect(host.querySelector("[data-universe]")).toBeNull();
    expect(host.querySelector('[data-theme-rows="true"]')).toBeNull();
    expect(host.querySelector("[data-block-state=unavailable]")).toBeNull();
  });

  // Fix r1 B-1's own cases: every one of these rendered five fabricated
  // not_produced stubs at the reviewed head; each must equal the SAME golden.
  it.each([
    ["typed_blocks null", null],
    ["typed_blocks an array", []],
    ["typed_blocks a string", "x"],
    ["typed_blocks a number", 42],
    ["an empty map", {}],
    ["a map of only unknown names", { zzz: { status: "unavailable", reason: "not_produced", value: null } }],
    ["the v1.0 seven-key producer map (no row block carried)", sevenKeyMap()],
    ["a twelve-key map whose five row entries are all preview audience stubs",
      { ...sevenKeyMap(), ...stubBlocks("audience_not_entitled") }],
  ])("no row block carried — %s: the Drivers tab equals the master golden byte-for-byte", async (_title, value) => {
    const host = await mountDrivers(carriedWire(value));
    expectGolden(host);
    expect(host.querySelector("[data-universe]")).toBeNull();
    expect(host.querySelector("[data-block-state=unavailable]")).toBeNull();
    expect(host.querySelector('[data-theme-rows="true"]')).toBeNull();
  });
});

describe("DossierDepth row mounts — one row block carried alone", () => {
  it("theme_rows alone: its 49-row table renders; the universes keep master's whole-section state", async () => {
    const host = await mountDrivers(carriedWire({ theme_rows: entitled.theme_rows }));
    const table = host.querySelector('[data-theme-rows="true"]');
    expect(table).not.toBeNull();
    expect(table!.querySelectorAll("tbody tr")).toHaveLength(49);
    // No universe block carried: the universes mount is omitted wholesale —
    // master's whole-section unavailable, no tab shell, nothing else changes.
    expect(host.querySelector("[data-universe]")).toBeNull();
    expect(host.querySelector('[data-depth-unavailable="confluence"]')).not.toBeNull();
    expect(host.querySelector("[data-block-state=unavailable]")).toBeNull();
  });

  it("confluence_universe_sp500 alone: the S&P tab renders its rows; the other tabs and the theme table keep master's states", async () => {
    const host = await mountDrivers(carriedWire({ confluence_universe_sp500: entitled.confluence_universe_sp500 }));
    expect(host.querySelector('[data-universe="subsectors"]')).not.toBeNull();
    expect(host.textContent).toContain("Software - Application");
    expect(host.querySelector('[data-theme-rows="true"]')).toBeNull();
    expect(host.querySelector('[data-depth-unavailable="theme_table"]')).not.toBeNull();
    // Not carried ⇒ the reader's prop-omitted path: master's per-tab state —
    // never a fabricated stub, never another universe's rows.
    for (const id of ["nasdaq", "russell", "baskets"]) {
      await act(async () => { host.querySelector<HTMLButtonElement>(`[data-universe="${id}"]`)!.click(); });
      expect(host.querySelector('[data-depth-unavailable="confluence"]'), `tab ${id}`).not.toBeNull();
      expect(host.querySelector("[data-block-state=unavailable]"), `tab ${id}`).toBeNull();
      expect(host.textContent).not.toContain("Software - Application");
    }
    // Returning to the carried tab still renders its rows.
    await act(async () => { host.querySelector<HTMLButtonElement>('[data-universe="subsectors"]')!.click(); });
    expect(host.textContent).toContain("Software - Application");
  });
});

describe("DossierDepth row mounts — carried entitled (the five real specimens)", () => {
  it("renders the S&P tab by default: 65 subsectors, an 11-row roll-up with no links, and the theme table with its own date", async () => {
    const host = await mountDrivers(carriedWire(entitled));
    // All four universe tabs exist; the S&P tab is active by default.
    for (const id of ["subsectors", "nasdaq", "russell", "baskets"]) {
      expect(host.querySelector(`[data-universe="${id}"]`), `tab ${id}`).not.toBeNull();
    }
    expect(host.textContent).toContain("Software - Application");
    expect(host.textContent).toContain("Basic Materials");
    // S1: sec-* roll-up labels render with NO link (no /subsector/sec-*.html route).
    expect(host.querySelectorAll('[data-rollup="sectors"] a')).toHaveLength(0);
    // The theme table renders through its reader: 49 rows, its own date only.
    const table = host.querySelector('[data-theme-rows="true"]');
    expect(table).not.toBeNull();
    expect(table!.querySelectorAll("tbody tr")).toHaveLength(49);
    expect(table!.textContent).toContain("Memory, HBM & Storage");
    expect(host.querySelector("[data-rows-asof]")!.getAttribute("data-rows-asof")).toBe("2026-11-06");
    // Scope 8: no owner identifier becomes visible text anywhere the mount renders.
    const receipt = captured.projection.receipt as { generation_id: string; content_sha256: string };
    expect(host.textContent).not.toContain(receipt.generation_id);
    expect(host.textContent).not.toContain(receipt.content_sha256);
  });

  it("each universe tab renders its OWN block: Nasdaq's build-time night, Russell's honest zero, baskets 49", async () => {
    const host = await mountDrivers(carriedWire(entitled));
    const open = async (id: string) => {
      await act(async () => { host.querySelector<HTMLButtonElement>(`[data-universe="${id}"]`)!.click(); });
    };
    await open("nasdaq");
    expect(host.textContent).toContain("2026-11-09 09:38 UTC");
    expect(host.textContent).toContain("Internet & Platforms");
    // amalg-* roll-up rows keep their published detail routes.
    expect(host.querySelector('[data-rollup="sectors"] a[href="/subsector_nasdaq/amalg-internet-platforms.html"]')).not.toBeNull();
    // Cross-block law: the S&P specimen (65 rows) never bleeds into Russell.
    expect(host.textContent).not.toContain("Software - Application");
    await open("russell");
    expect(host.querySelector('[data-empty="subsectors"]')).not.toBeNull();
    expect(host.textContent).not.toContain("Software - Application");
    expect(host.textContent).toContain("2026-11-09 09:39 UTC");
    await open("baskets");
    expect(host.textContent).toContain("Crypto & Digital Rails");
  });

  it("ZH: carried label_zh/name_zh verbatim; null label_zh falls back to the producer's English label", async () => {
    const host = await mountDrivers(carriedWire(entitled), "zh");
    // Baskets carry a real label_zh — rendered verbatim, no consumer authoring.
    await act(async () => { host.querySelector<HTMLButtonElement>('[data-universe="baskets"]')!.click(); });
    expect(host.textContent).toContain("加密与数字轨道");
    expect(host.textContent).not.toContain("Crypto & Digital Rails");
    // The theme table carries name_zh for all 49 rows.
    expect(host.querySelector('[data-theme-rows="true"]')!.textContent).toContain("内存、HBM 与存储");
    // The S&P specimen's label_zh is null on every row: the producer's English
    // label shows (documented fallback) — no invented Chinese name.
    await act(async () => { host.querySelector<HTMLButtonElement>('[data-universe="subsectors"]')!.click(); });
    expect(host.textContent).toContain("Software - Application");
    // State words localize: the raw English word never reaches the ZH DOM
    // (an out-of-set word would carry it only in data-val, never as text).
    const zhTable = host.querySelector('[data-theme-rows="true"]')!;
    expect(zhTable.textContent).not.toContain("deteriorating");
    expect(zhTable.textContent).not.toContain("avoid");
  });
});

describe("DossierDepth row mounts — stub entries (status: unavailable)", () => {
  // Fix r1: audience_not_entitled moved out of this loop — under the interim
  // audience rule an all-stub map reads null (golden above); a mixed map
  // keeps master's state for the stub's reader (its own tests below).
  const REASON_COPY: Record<string, string> = {
    not_produced: "The owner engine did not produce this reading tonight.",
    invalid_shape: "This reading arrived in a form we cannot present.",
    block_too_large: "This reading is too large to deliver and was not carried.",
  };
  it.each([
    ["not_produced"], ["invalid_shape"], ["block_too_large"],
  ])("a %s stub shows the readers' own per-reason states — no rows, no tables, no raw reason word", async reason => {
    const host = await mountDrivers(carriedWire(stubBlocks(reason)));
    // The universes section renders its tabbed shell; the ACTIVE tab's panel
    // and the theme table each show their own unavailable state.
    expect(host.querySelector("[data-universe]")).not.toBeNull();
    const blocks = host.querySelectorAll("[data-block-state=unavailable]");
    expect(blocks.length).toBe(2);
    expect(blocks[0].textContent!.length).toBeGreaterThan(0);
    expect(blocks[1].textContent!.length).toBeGreaterThan(0);
    expect(host.textContent).toContain(REASON_COPY[reason]);
    // Every tab's read is the stub: switching universes keeps the same state.
    for (const id of ["nasdaq", "russell", "baskets"]) {
      await act(async () => { host.querySelector<HTMLButtonElement>(`[data-universe="${id}"]`)!.click(); });
      expect(host.querySelector("[data-block-state=unavailable]")).not.toBeNull();
      expect(host.querySelector('[data-rollup="sectors"]')).toBeNull();
    }
    expect(host.querySelector('[data-theme-rows="true"]')).toBeNull();
    expect(host.textContent).not.toContain(reason);
    expect(host.textContent).not.toContain("Software - Application");
    expect(host.textContent).not.toContain("Memory, HBM & Storage");
  });

  it("a mixed map — sp500 a preview audience stub, theme carried: the stub is NOT carried, so the universes keep master's whole-section state and the wording never shows", async () => {
    const host = await mountDrivers(carriedWire({
      confluence_universe_sp500: AUDIENCE_STUB, theme_rows: entitled.theme_rows,
    }));
    // The interim rule swallows the audience stub: that reader's prop is
    // omitted, no other universe is carried, so the whole universes section
    // is master's own state — the false-for-members wording never renders.
    expect(host.querySelector("[data-universe]")).toBeNull();
    expect(host.querySelector('[data-depth-unavailable="confluence"]')).not.toBeNull();
    expect(host.querySelector("[data-block-state=unavailable]")).toBeNull();
    expect(host.textContent).not.toContain("Not included in your current subscription.");
    // The carried reader is untouched by the rule: its table still renders.
    const table = host.querySelector('[data-theme-rows="true"]');
    expect(table).not.toBeNull();
    expect(table!.querySelectorAll("tbody tr")).toHaveLength(49);
  });

  it("ZH: the same mixed map keeps master's universes state; the Chinese subscription wording never shows", async () => {
    const host = await mountDrivers(carriedWire({
      confluence_universe_sp500: AUDIENCE_STUB, theme_rows: entitled.theme_rows,
    }), "zh");
    expect(host.querySelector("[data-universe]")).toBeNull();
    expect(host.querySelector('[data-depth-unavailable="confluence"]')).not.toBeNull();
    expect(host.textContent).not.toContain("当前订阅不包含此读数。");
    expect(host.querySelector('[data-theme-rows="true"]')!.textContent).toContain("内存、HBM 与存储");
  });

  it.each([
    ["null", null],
    ["the string \"available\"", "available"],
    ["{status:\"bogus\"}", { status: "bogus" }],
    ["{status:\"unavailable\", reason:7}", { status: "unavailable", reason: 7 }],
  ])("a carried malformed entry (%s) reads the readers' GENERIC wording — never a stated owner fact (fix r1 S-1)", async (_title, entry) => {
    const host = await mountDrivers(carriedWire({
      // Two DISTINCT objects of the same malformed shape (clone): the decoder's
      // bounded() walk refuses a shared reference, which JSON never produces.
      confluence_universe_sp500: clone(entry), theme_rows: clone(entry),
    }));
    const blocks = host.querySelectorAll("[data-block-state=unavailable]");
    expect(blocks.length).toBe(2);
    expect(host.textContent).toContain("This reading is unavailable right now.");
    expect(host.textContent).not.toContain("The owner engine did not produce this reading tonight.");
    expect(host.querySelector('[data-theme-rows="true"]')).toBeNull();
    expect(host.textContent).not.toContain("Software - Application");
  });

  it("ZH: a carried malformed entry reads the Chinese generic wording, never the not_produced line", async () => {
    const host = await mountDrivers(carriedWire({
      confluence_universe_sp500: { status: "bogus" }, theme_rows: { status: "unavailable", reason: 7 },
    }), "zh");
    expect(host.textContent).toContain("此读数暂不可用。");
    expect(host.textContent).not.toContain("所有者引擎今晚未生成此读数。");
  });

  it("a hostile out-of-set reason falls to the readers' generic state; the word never reaches the DOM", async () => {
    const host = await mountDrivers(carriedWire(stubBlocks("hostile_reason_word")));
    expect(host.querySelectorAll("[data-block-state=unavailable]").length).toBe(2);
    expect(host.textContent).not.toContain("hostile_reason_word");
  });

  it("carried reliability wins over the derived count, and nothing measured reads not stated (groupReliability at the mount)", async () => {
    // Two crafted rows on an otherwise-real S&P envelope: one CARRIES
    // reliability "low" with a wide measured count (the carried word must win
    // over a derived "high"), one carries neither reliability nor a count
    // (the honest tier is not_stated — never a "low" coerced from null).
    const spValue = JSON.parse(JSON.stringify(
      (entitled.confluence_universe_sp500 as { value: Record<string, unknown> }).value));
    const rows = spValue.data.subsectors as Array<Record<string, unknown>>;
    const seed = JSON.parse(JSON.stringify(rows[0])) as Record<string, unknown>;
    const crafted = (over: Record<string, unknown>) => ({ ...JSON.parse(JSON.stringify(seed)), ...over });
    rows.unshift(
      crafted({ key: "carried-low-wide", label: "Carried Low Wide Coverage", reliability: "low", n_priced: 30 }),
      crafted({ key: "nothing-measured", label: "Nothing Measured Row", reliability: null, n_priced: null }),
    );
    const host = await mountDrivers(carriedWire({
      ...entitled, confluence_universe_sp500: { status: "available", reason: null, value: spValue },
    }));
    const relOf = (label: string): string | null => {
      const row = [...host.querySelectorAll("tr")]
        .find(tr => tr.querySelector("th button")?.textContent === label);
      expect(row, `group row ${label} must render`).toBeDefined();
      return row!.querySelector("[data-rel]")?.getAttribute("data-rel") ?? null;
    };
    expect(relOf("Carried Low Wide Coverage")).toBe("low");
    expect(relOf("Nothing Measured Row")).toBe("not_stated");
  });
});

describe("the full workspace mounts the same reads (memo → dossier prop)", () => {
  let root: Root, host: HTMLDivElement;
  const sourceOf = (input: RequestInfo | URL) => new URL(String(input), "https://example.test").searchParams.get("source")!;
  const renderWorkspace = async (generationData: unknown) => {
    window.history.replaceState(null, "",
      "/discover?tab=sectors&sectorWorkspace=detail&sectorJob=research&sectorView=drivers&sector=xlk");
    vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const source = sourceOf(input);
      if (source !== "generation") {
        return Response.json({ data: { as_of: "2026-11-06", sectors: [] },
          receipt: { source, status: "ready", path: "/" + source, asOf: "2026-11-06",
            observedAt: "2026-11-10T00:00:00Z", contentHash: source, stale: false } });
      }
      return Response.json({ data: generationData, receipt: { source, status: "ready",
        path: SECTOR_GENERATION_PATH, asOf: captured.source_session,
        observedAt: "2026-11-10T00:00:00Z", contentHash: "generation:fixed", stale: false } });
    });
    await act(async () => { root.render(<SectorIntelligenceWorkspace />); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  };
  beforeEach(() => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(0);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove(); vi.restoreAllMocks();
  });

  it("today's absent wire keeps master's typed-unavailable confluence and theme_table", async () => {
    await renderWorkspace(captured);
    expect(host.querySelector('[data-testid="sector-native-dossier-depth"]')).not.toBeNull();
    expect(host.querySelector('[data-depth-unavailable="confluence"]')).not.toBeNull();
    expect(host.querySelector('[data-depth-unavailable="theme_table"]')).not.toBeNull();
    expect(host.querySelector("[data-universe]")).toBeNull();
    expect(host.querySelector('[data-theme-rows="true"]')).toBeNull();
  });

  it("the v1.0 seven-key map keeps master's surfaces through the workspace (fix r1 B-1)", async () => {
    await renderWorkspace(carriedWire(sevenKeyMap()));
    expect(host.querySelector('[data-testid="sector-native-dossier-depth"]')).not.toBeNull();
    expect(host.querySelector('[data-depth-unavailable="confluence"]')).not.toBeNull();
    expect(host.querySelector('[data-depth-unavailable="theme_table"]')).not.toBeNull();
    expect(host.querySelector("[data-universe]")).toBeNull();
    expect(host.querySelector('[data-theme-rows="true"]')).toBeNull();
    expect(host.querySelector("[data-block-state=unavailable]")).toBeNull();
  });

  it("a carried entitled wire renders the rows through the same gate", async () => {
    await renderWorkspace(carriedWire(entitled));
    expect(host.querySelector("[data-universe]")).not.toBeNull();
    expect(host.textContent).toContain("Software - Application");
    const table = host.querySelector('[data-theme-rows="true"]');
    expect(table).not.toBeNull();
    expect(table!.querySelectorAll("tbody tr")).toHaveLength(49);
  });
});

afterAll(() => {
  G.__SI_ROW_LANG = "en";
});
