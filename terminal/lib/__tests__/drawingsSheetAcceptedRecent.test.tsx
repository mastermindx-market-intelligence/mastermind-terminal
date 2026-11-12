/**
 * drawingsSheetAcceptedRecent.test.tsx — the phone Drawings sheet's Favorites (its recents
 * list, `mm.drawRecents`) must only learn tools the parent actually armed.
 *
 * TerminalShell.activateDrawingTool refuses a tool whenever the active symbol's drawings are
 * not ready (an account read still pending or failed, or a drawing-owner switch in flight) or
 * creation is disabled. The sheet used to push the tapped tool into its recents before handing
 * it to the shell, so a refused tap still showed up under Favorites, as if it had been used.
 *
 * Mounts DrawingsSheet with react-dom/client (jsdom) behind a parent that owns `open` and the
 * armed tool, refusing exactly the way the shell does. MobileSheet portals only after its mount
 * frame, so timers are faked and flushed inside act (as mobileSheetKeepMounted.test.tsx does).
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, useEffect, useState } from "react";
import DrawingsSheet from "@/components/mobile/DrawingsSheet";
import { DRAW_RECENTS_KEY } from "@/lib/drawingTaxonomy";
import type { DrawKind } from "@/lib/drawings";

class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() { return this.store.size; }
  clear() { this.store.clear(); }
  getItem(key: string) { return this.store.get(key) ?? null; }
  key(index: number) { return [...this.store.keys()][index] ?? null; }
  removeItem(key: string) { this.store.delete(key); }
  setItem(key: string, value: string) { this.store.set(key, String(value)); }
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

type Harness = {
  accept: boolean;
  tool: DrawKind | null;
  setOpen: (open: boolean) => void;
};

let harness: Harness;

function Parent() {
  const [open, setOpen] = useState(false);
  const [tool, setTool] = useState<DrawKind | null>(null);
  useEffect(() => { harness.setOpen = setOpen; }, []);
  useEffect(() => { harness.tool = tool; }, [tool]);
  return (
    <DrawingsSheet
      open={open}
      onClose={() => setOpen(false)}
      activeTool={tool}
      // Mirrors TerminalShell.activateDrawingTool: a refusal leaves `tool` untouched.
      onPick={(id) => {
        if (!harness.accept) return false;
        setTool(id);
        return true;
      }}
    />
  );
}

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  vi.useFakeTimers();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: new MemoryStorage() });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  harness = { accept: true, tool: null, setOpen: () => {} };
  await act(async () => { root.render(<Parent />); });
  await flushFrames();
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.useRealTimers();
});

async function flushFrames() {
  await act(async () => { await vi.runAllTimersAsync(); });
}

const query = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const byTestId = (id: string) => {
  const element = query(id);
  if (!element) throw new Error(`missing [data-testid="${id}"]`);
  return element;
};
const recents = () => JSON.parse(localStorage.getItem(DRAW_RECENTS_KEY) || "[]") as DrawKind[];
const favoriteTiles = () =>
  [...document.querySelectorAll<HTMLElement>('[data-testid="drawings-sheet-grid"] [data-tool-id]')]
    .map((tile) => tile.getAttribute("data-tool-id"));

async function openSheet() {
  await act(async () => { harness.setOpen(true); });
  await flushFrames();
  byTestId("drawings-sheet-grid");
}

async function tapTile(category: string, tool: DrawKind) {
  await openSheet();
  await act(async () => { byTestId(`drawings-cat-${category}`).click(); });
  await act(async () => { byTestId(`drawings-tile-${tool}`).click(); });
  await flushFrames();
}

async function openFavorites() {
  await openSheet();
  await act(async () => { byTestId("drawings-cat-favorites").click(); });
}

describe("DrawingsSheet — Favorites follow the accepted tool", () => {
  it("does not record a tool the parent refuses", async () => {
    harness.accept = false;

    await tapTile("trendlines", "hline");

    expect(harness.tool).toBeNull();
    expect(recents()).toEqual([]);
    // The sheet still closes on a refused tap, as before; the shell's notice explains why.
    expect(query("drawings-sheet-grid")).toBeNull();

    await openFavorites();
    expect(favoriteTiles()).toEqual([]);
  });

  it("records a tool the parent arms", async () => {
    await tapTile("trendlines", "hline");

    expect(harness.tool).toBe("hline");
    expect(recents()).toEqual(["hline"]);
    expect(query("drawings-sheet-grid")).toBeNull();

    await openFavorites();
    expect(favoriteTiles()).toEqual(["hline"]);
  });

  it("keeps the earlier recents order when a later tap is refused", async () => {
    await tapTile("trendlines", "trendline");
    harness.accept = false;

    await tapTile("trendlines", "hline");

    expect(harness.tool).toBe("trendline");
    expect(recents()).toEqual(["trendline"]);
    await openFavorites();
    expect(favoriteTiles()).toEqual(["trendline"]);
  });
});
