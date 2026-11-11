// @vitest-environment jsdom
/**
 * sectorNativeRowMount.test.tsx — round 2 part 2: lane 7's five row readers
 * (`confluence_universe_{sp500,nasdaq,russell,baskets}` + `theme_rows`)
 * mounted in the dossier Drivers tab through the workspace's own carried gate
 * (`sectorRowBlocksFromFeed`).
 *
 * Laws pinned here:
 *   - ABSENT `typed_blocks` (today's wire): the dossier renders byte-for-byte
 *     the master rendering — proved against a committed golden DOM captured at
 *     the master-equal pre-mount head, never a hand-written expectation.
 *   - The carried gate reads the RAW wire document's own key: the decoder maps
 *     an absent map to the same all-not_produced shape a carried map may hold,
 *     so only the own-key check separates "owner carried blocks" (readers get
 *     their entries) from "nothing carried" (master rendering, reads null).
 *   - CARRIED entitled (the five real producer specimens): rows render through
 *     the readers only — S&P 65 subsectors + 11 roll-up rows without links,
 *     Nasdaq's 0-subsector/6-roll-up build-time night, Russell's honest zero,
 *     baskets 49, theme table 49 with its own date. No copy beyond the
 *     readers' own states; no owner identifier becomes visible text.
 *   - STUBS (`status:"unavailable"`, every reason incl. `audience_not_entitled`
 *     and a hostile out-of-set word): the readers' own per-reason states; the
 *     raw reason word never reaches the DOM; no rows, no tables.
 *   - ZH: carried `label_zh`/`name_zh` verbatim; null `label_zh` falls back to
 *     the producer's English label (no consumer-authored names); theme state
 *     words localize with the raw word only in `data-val`.
 *   - The full workspace mounts the same reads (memo → dossier prop) for both
 *     the absent and carried wires.
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

/** A deep clone of the real captured generation with `typed_blocks` set. */
const carriedWire = (blocks: Record<string, unknown>): Record<string, unknown> => {
  const wire = JSON.parse(JSON.stringify(captured)) as typeof captured;
  wire.projection.data.typed_blocks = blocks;
  return wire as unknown as Record<string, unknown>;
};
/** The five row entries as the served surface writes a stub. */
const stubBlocks = (reason: string): Record<string, unknown> => Object.fromEntries(
  ROW_BLOCK_NAMES.map(name => [name, { status: "unavailable", reason, value: null }]));

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

describe("the carried gate — sectorRowBlocksFromFeed (round 2 part 2)", () => {
  it("an absent typed_blocks map (today's wire) reads null — the dossier keeps master's rendering", () => {
    const generation = sectorNativeGeneration(captured as unknown as Record<string, unknown>);
    expect(generation).not.toBeNull();
    // The decoded shape cannot tell absent from a carried all-not_produced map…
    expect(generation!.typedBlocks.theme_rows).toEqual({ status: "unavailable", reason: "not_produced", value: null });
    // …so the gate reads the raw wire document's own key and returns null.
    expect(sectorRowBlocksFromFeed(feedOf(captured as unknown as Record<string, unknown>), generation)).toBeNull();
  });

  it("no admitted generation (feed absent, erroring or null data) reads null", () => {
    expect(sectorRowBlocksFromFeed(undefined, null)).toBeNull();
    const generation = sectorNativeGeneration(captured as unknown as Record<string, unknown>);
    expect(sectorRowBlocksFromFeed({ data: null, receipt: feedOf({}).receipt }, generation)).toBeNull();
  });

  it("a CARRIED all-not_produced map is not the absent case: the readers get their entries", () => {
    const wire = carriedWire(stubBlocks("not_produced"));
    const generation = sectorNativeGeneration(wire);
    const reads = sectorRowBlocksFromFeed(feedOf(wire), generation);
    expect(reads).not.toBeNull();
    expect(reads!.universeBlocks.subsectors).toEqual({ state: "unavailable", reason: "not_produced" });
    expect(reads!.themeRows).toEqual({ state: "unavailable", reason: "not_produced" });
  });

  it("the entitled mapping yields one read per reader from its own block", () => {
    const wire = carriedWire(entitled);
    const generation = sectorNativeGeneration(wire);
    const reads = sectorRowBlocksFromFeed(feedOf(wire), generation);
    expect(reads).not.toBeNull();
    const subsectors = reads!.universeBlocks.subsectors!;
    const nasdaq = reads!.universeBlocks.nasdaq!;
    expect(subsectors.state).toBe("available");
    expect(subsectors.state === "available" && subsectors.asOf).toBe("2026-11-06");
    expect(subsectors.state === "available" && subsectors.asOfField).toBe("as_of");
    expect(nasdaq.state === "available" && nasdaq.asOfField).toBe("generated_utc");
    expect(reads!.universeBlocks.russell!.state).toBe("available");
    expect(reads!.universeBlocks.baskets!.state).toBe("available");
    expect(reads!.themeRows.state).toBe("available");
    expect(reads!.themeRows.state === "available" && reads!.themeRows.rows).toHaveLength(49);
  });
});

describe("DossierDepth row mounts — absent map (today's wire) equals master", () => {
  it("the Drivers tab renders the committed master golden byte-for-byte (captured wire, no typed_blocks)", async () => {
    const host = await mountDrivers(captured as unknown as Record<string, unknown>);
    const actual = host.querySelector('[data-testid="sector-native-dossier"]')!.innerHTML;
    // Captured at the master-equal pre-mount head (branch 883b5cbe2: the only
    // dossier diff vs origin/master was a comment), same harness, same wire.
    expect(actual).toBe(readFileSync(GOLDEN_PATH, "utf8"));
    // The golden's legible core, asserted where it matters most:
    expect(host.querySelector('[data-depth-unavailable="confluence"]')).not.toBeNull();
    expect(host.querySelector('[data-depth-unavailable="theme_table"]')).not.toBeNull();
    expect(host.querySelector("[data-universe]")).toBeNull();
    expect(host.querySelector('[data-theme-rows="true"]')).toBeNull();
    expect(host.querySelector("[data-block-state=unavailable]")).toBeNull();
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
  it.each([
    ["audience_not_entitled"], ["not_produced"], ["invalid_shape"], ["block_too_large"],
  ])("a %s stub shows the readers' own states — no rows, no tables, no raw reason word", async reason => {
    const host = await mountDrivers(carriedWire(stubBlocks(reason)));
    // The universes section renders its tabbed shell; the ACTIVE tab's panel
    // and the theme table each show their own unavailable state.
    expect(host.querySelector("[data-universe]")).not.toBeNull();
    const blocks = host.querySelectorAll("[data-block-state=unavailable]");
    expect(blocks.length).toBe(2);
    expect(blocks[0].textContent!.length).toBeGreaterThan(0);
    expect(blocks[1].textContent!.length).toBeGreaterThan(0);
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
