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
