// @vitest-environment jsdom
/**
 * sectorNativeDossierDepth.test.tsx — r2 N-E mount gates for the two lane 7
 * reader mounts in the Drivers tab (SectorNativeDossier DossierDepth):
 * the calls board at the `actionBoard` mount and the watch at the
 * `typedBlocks.bottoming_watch` mount.
 *
 * Laws pinned here (the review's N-E: "Acceptable as defence in depth; a mount
 * test would pin it"):
 *   - The real captured preview sample (valid carried action_board, NO
 *     typed_blocks) renders the calls board's content and an honestly
 *     unavailable watch — never a zero-entry watch, never an error.
 *   - The watch renders ONLY from the typed block the owner produced: an
 *     injected `typed_blocks.bottoming_watch` (lane 7's contract payload)
 *     renders watch content without disturbing the board.
 *   - Payloads never cross surfaces: a watch payload planted in the board slot
 *     renders the board's shared unavailable state — never watch rows dressed
 *     up as calls — while the real watch block still renders its own content
 *     on the same mount.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import SectorNativeDossier from "@/components/sector-intelligence/SectorNativeDossier";
import type { SectorNativeContext } from "@/components/sector-intelligence/sectorNativeSlots";
import { sectorNativeGeneration } from "@/lib/sectorNativeGeneration";

const session = vi.hoisted(() => ({ identity: { kind: "guest" } as { kind: "guest" } }));
vi.mock("@/components/chrome/AppShell", () => ({ useShellIdentity: () => session.identity }));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: "en" }), useT: () => (key: string) => key }));

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

const capturedDoc = JSON.parse(readFileSync(
  join(__dirname, "fixtures", "sector_generation.captured.preview.v1.json"), "utf8"),
) as { projection: { data: Record<string, unknown> } };
const contract = JSON.parse(readFileSync(
  join(__dirname, "fixtures", "sectorDepthCallsContract.v1.json"), "utf8"),
) as { action_board: Record<string, unknown>; bottoming_watch_payload: Record<string, unknown> };

const sector0 = (capturedDoc.projection.data.core as { sectors: Array<{
  id: string; ticker: string; name: string; name_zh?: string;
}> }).sectors[0];

const handlers = {
  onView: vi.fn(), onBack: vi.fn(), onJob: vi.fn(), onOpenRotation: vi.fn(),
  onTheme: vi.fn(), onRefresh: vi.fn(), onSources: vi.fn(),
};

describe("DossierDepth — the lane 7 mounts pinned on real fixtures (r2 N-E)", () => {
  let root: Root, host: HTMLDivElement;
  beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  const mountDepth = async (wire: Record<string, unknown>): Promise<HTMLElement> => {
    const context: SectorNativeContext = {
      generation: sectorNativeGeneration(wire),
      transport: "ready", qualification: "accepted",
      subject: { id: sector0.id, ticker: sector0.ticker, name: sector0.name, nameZh: sector0.name_zh ?? sector0.name },
      ranked63: [sector0.id], lead21: sector0.id, language: "en", theme: "dark",
      binding: { ownerRevision: "r1", generationKey: "g1", subjectId: sector0.id, universe: "us",
        metric: "relative_wealth_pct", windows: [63], basis: "total_return" },
    };
    expect(context.generation, "fixture must admit as a native generation").not.toBeNull();
    await act(async () => {
      root.render(<SectorNativeDossier context={context} view="drivers" {...handlers} />);
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    return host;
  };

  it("the captured sample renders the calls board content and an honestly unavailable watch", async () => {
    const mounted = await mountDepth(capturedDoc);
    // The capture carries a valid action_board and NO typed_blocks: board
    // content, watch unavailable — never an empty watch, never an error.
    expect(mounted.querySelector("[data-depth-calls-board]")).not.toBeNull();
    expect(mounted.querySelector('[data-depth-unavailable="action_board"]')).toBeNull();
    expect(mounted.querySelector('[data-depth-unavailable="bottoming_watch"]')).not.toBeNull();
    expect(mounted.querySelector("[data-depth-bottoming-watch]")).toBeNull();
  });

  it("an owner-produced typed block renders watch content without touching the board", async () => {
    const withWatch = JSON.parse(JSON.stringify(capturedDoc)) as typeof capturedDoc;
    withWatch.projection.data.typed_blocks = {
      bottoming_watch: { status: "available", value: contract.bottoming_watch_payload },
    };
    const mounted = await mountDepth(withWatch);
    expect(mounted.querySelector("[data-depth-bottoming-watch]")).not.toBeNull();
    expect(mounted.querySelector('[data-depth-unavailable="bottoming_watch"]')).toBeNull();
    // The untouched board slot still renders its own content on the same mount.
    expect(mounted.querySelector("[data-depth-calls-board]")).not.toBeNull();
    expect(mounted.querySelector('[data-depth-unavailable="action_board"]')).toBeNull();
  });

  it("a watch payload planted in the board slot renders the board unavailable — payloads never cross surfaces", async () => {
    const crossed = JSON.parse(JSON.stringify(capturedDoc)) as typeof capturedDoc;
    const data = crossed.projection.data;
    // Keep the generation admissible (action_board.as_of must equal the
    // declared baseline) while every OTHER board key is the watch payload.
    // The planted copy is a DEEP clone: the whole-wire bound refuses any value
    // reachable twice, and the typed_blocks mount below keeps the original.
    const baselineAsOf = (data.action_board as { as_of: string }).as_of;
    data.action_board = {
      ...JSON.parse(JSON.stringify(contract.bottoming_watch_payload)) as Record<string, unknown>,
      as_of: baselineAsOf,
    };
    data.typed_blocks = {
      bottoming_watch: { status: "available", value: contract.bottoming_watch_payload },
    };
    const mounted = await mountDepth(crossed);
    expect(mounted.querySelector('[data-depth-unavailable="action_board"]')).not.toBeNull();
    expect(mounted.querySelector("[data-depth-calls-board]")).toBeNull();
    // The real watch block still renders its own content on the same mount.
    expect(mounted.querySelector("[data-depth-bottoming-watch]")).not.toBeNull();
    expect(mounted.querySelector('[data-depth-unavailable="bottoming_watch"]')).toBeNull();
  });
});

describe("DossierDepth calls-board navigation mount — third review rules (a)–(g), #1445 merged", () => {
  let root: Root, host: HTMLDivElement;
  beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

  /** A board whose hold lane carries one real theme row plus six crafted
   * sector rows: the lawful target, the review's hostile ids (both pass the
   * board's own isNavigableId), a missing id, and two evil-href rows — one on
   * a foreign id, one on a REAL generation id. Every row is a deep clone of a
   * real captured row with only the routing-relevant fields overridden, so
   * the board's closed-shape admission still passes. */
  const hostileBoardWire = (): Record<string, unknown> => {
    const wire = JSON.parse(JSON.stringify(capturedDoc)) as typeof capturedDoc;
    const hold = (wire.projection.data.action_board.lanes as Record<string, { rows: unknown[]; total: number }>).hold;
    const seed = JSON.parse(JSON.stringify(hold.rows[0])) as Record<string, unknown>;
    const row = (over: Record<string, unknown>) => ({ ...JSON.parse(JSON.stringify(seed)), ...over });
    hold.rows = [
      seed, // the real theme row — rule (e): a theme row must do NOTHING
      row({ kind: "sector", slug: "xlk", ticker: "XLK", name: "Lawful tech row", href: "basket/tech.html" }),
      row({ kind: "sector", slug: "..", ticker: "TT1", name: "Dotdot hostile row" }),
      row({ kind: "sector", slug: "__proto__", ticker: "TT2", name: "Proto hostile row" }),
      row({ kind: "sector", slug: "syn_sector_99", ticker: "TT3", name: "Missing id row" }),
      row({ kind: "sector", slug: "syn_sector_98", ticker: "TT4", name: "Evil href foreign row", href: "https://evil.example/x" }),
      row({ kind: "sector", slug: "xlf", ticker: "XLF", name: "Real id evil href row", href: "https://evil.example/sectors/xlf" }),
    ];
    hold.total = hold.rows.length; // lane.total ≥ rows.length (R2-N5)
    return wire as unknown as Record<string, unknown>;
  };

  const mountDepthWithSelect = async (wire: Record<string, unknown>, onSelect: (id: string) => void) => {
    const generation = sectorNativeGeneration(wire);
    expect(generation, "fixture must admit as a native generation").not.toBeNull();
    const context: SectorNativeContext = {
      generation, transport: "ready", qualification: "accepted",
      subject: { id: sector0.id, ticker: sector0.ticker, name: sector0.name, nameZh: sector0.name_zh ?? sector0.name },
      ranked63: [sector0.id], lead21: sector0.id, language: "en", theme: "dark",
      binding: { ownerRevision: "r1", generationKey: "g1", subjectId: sector0.id, universe: "us",
        metric: "relative_wealth_pct", windows: [63], basis: "total_return" },
    };
    await act(async () => {
      root.render(<SectorNativeDossier context={context} view="drivers" {...handlers} onSelect={onSelect} />);
    });
    await flush();
    return host;
  };

  /** The row card carrying the given name, and its Open detail button. */
  const detailButton = (mounted: HTMLElement, name: string): HTMLButtonElement => {
    const card = [...mounted.querySelectorAll("li")].find(li => li.textContent?.includes(name));
    expect(card, `row card ${name} must render`).toBeDefined();
    const button = [...card!.querySelectorAll("button")].find(b => b.textContent === "Open detail");
    expect(button, `row ${name} must carry an Open detail control`).toBeDefined();
    return button!;
  };

  /** Expand the hold group the way a reader does — through its own Show-all
   * control. The board spends its preview budget (PREVIEW_ROWS = 3) on SOURCE
   * order, so only the first three crafted rows render collapsed; the rows
   * beyond them (including the "__proto__" and missing-id rows) are reachable
   * only after this expansion, exactly as in production. */
  const expandHoldLane = async (mounted: HTMLElement) => {
    const showAll = [...mounted.querySelectorAll<HTMLButtonElement>("[data-depth-calls-board] button")]
      .find(b => /^Show all \d+ in Hold$/.test(b.textContent ?? ""));
    expect(showAll, "hold group must offer its Show-all control").toBeDefined();
    await act(async () => { showAll!.click(); });
  };

  it("rule (g): hostile rows change no workspace state; one lawful row selects exactly its id; href never navigates", async () => {
    const onSelect = vi.fn();
    const mounted = await mountDepthWithSelect(hostileBoardWire(), onSelect);
    expect(mounted.querySelector("[data-depth-calls-board]")).not.toBeNull();
    await expandHoldLane(mounted);
    const locationBefore = window.location.href;
    // No anchor exists anywhere in the board: with the mount's callback
    // present, rows render buttons — owner text is never an <a href>.
    expect(mounted.querySelectorAll("[data-depth-calls-board] a")).toHaveLength(0);
    // Hostile rows: "..", "__proto__" (both pass the board's isNavigableId),
    // an id the generation does not carry, and an evil href on a foreign id.
    for (const name of ["Dotdot hostile row", "Proto hostile row", "Missing id row", "Evil href foreign row"]) {
      await act(async () => { detailButton(mounted, name).click(); });
    }
    expect(onSelect).not.toHaveBeenCalled();
    expect(window.location.href).toBe(locationBefore);
    // Rule (e): the real theme row carries a control (its identity is
    // navigable-clean) but has no destination here — it must do nothing and
    // never feed the sector slot.
    await act(async () => { detailButton(mounted, "Test theme").click(); });
    expect(onSelect).not.toHaveBeenCalled();
    // A REAL id with a hostile href selects exactly its id: routing is by
    // identity, the href is never read, and the location never moves.
    await act(async () => { detailButton(mounted, "Real id evil href row").click(); });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("xlf");
    expect(window.location.href).toBe(locationBefore);
    // The one lawful row selects exactly its id.
    await act(async () => { detailButton(mounted, "Lawful tech row").click(); });
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenLastCalledWith("xlk");
    expect(window.location.href).toBe(locationBefore);
    // Still no anchor from owner text after every interaction.
    expect(mounted.querySelectorAll("[data-depth-calls-board] a")).toHaveLength(0);
  });

  it("without a selection exit every row control is a pure no-op — nothing selects, nothing throws", async () => {
    // onSelect absent (the workspace always passes it; this pins the optional
    // boundary): the mount still decides every target, but with no exit the
    // lawful row's control is as inert as the hostile ones.
    const wire = hostileBoardWire();
    const generation = sectorNativeGeneration(wire)!;
    expect(generation, "fixture must admit as a native generation").not.toBeNull();
    const context: SectorNativeContext = {
      generation, transport: "ready", qualification: "accepted",
      subject: { id: sector0.id, ticker: sector0.ticker, name: sector0.name, nameZh: sector0.name_zh ?? sector0.name },
      ranked63: [sector0.id], lead21: sector0.id, language: "en", theme: "dark",
      binding: { ownerRevision: "r1", generationKey: "g1", subjectId: sector0.id, universe: "us",
        metric: "relative_wealth_pct", windows: [63], basis: "total_return" },
    };
    const locationBefore = window.location.href;
    await act(async () => {
      root.render(<SectorNativeDossier context={context} view="drivers" {...handlers} />);
    });
    await flush();
    expect(host.querySelector("[data-depth-calls-board]")).not.toBeNull();
    await expandHoldLane(host);
    await act(async () => { detailButton(host, "Lawful tech row").click(); });
    await act(async () => { detailButton(host, "Proto hostile row").click(); });
    expect(window.location.href).toBe(locationBefore);
    // No anchor from owner text on this mount either.
    expect(host.querySelectorAll("[data-depth-calls-board] a")).toHaveLength(0);
  });
});
