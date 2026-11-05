// @vitest-environment jsdom
// T09 — the by-expiration bars and term-structure drawer keep one expiration population
// across greeks. A row with no value for the active greek stays in that population as an
// unknown (a dash in the bars, a disclosed count in the drawer), never silently dropped and
// never drawn as a zero. A measured zero stays a zero.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExpiryBars } from "@/components/gexdesk/ExpiryBars";
import { ExposureExpiryDrawer } from "@/components/gexdesk/ExposureExpiryDrawer";
import { byExpiryToTermStructure, type ExpiryRow } from "@/lib/expiryTermStructure";

vi.mock("@/components/surface/EodReplayTag", () => ({ EodReplayTag: () => null }));

const ASOF = "2026-07-10T20:15:00Z";
const ROWS: ExpiryRow[] = [
  { exp: "2026-07-10", gamma_net: 10, delta_net: 0 },
  { exp: "2026-07-17", gamma_net: 20 }, // no delta_net
  { exp: "2026-07-24", gamma_net: -5, delta_net: -3 },
];

let node: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); });
async function render(el: React.ReactElement) { await act(async () => root.render(el)); }
/** Rendered bar rows as [expiry label, value] pairs. */
function barRows(): Array<[string, string]> {
  const scroll = node.querySelector(".obs-scroll")!;
  return [...scroll.children].filter((c) => c.children.length >= 3).map((r) =>
    [r.firstElementChild!.firstElementChild!.textContent ?? "", r.lastElementChild!.textContent ?? ""]);
}

describe("term structure — one population across greeks", () => {
  it("reports the same expiration population for gamma and delta and names the unknown rows", () => {
    const g = byExpiryToTermStructure(ROWS, "gamma", ASOF);
    const d = byExpiryToTermStructure(ROWS, "delta", ASOF);
    expect(g.rowCount).toBe(3);
    expect(d.rowCount).toBe(3);
    expect(g.unresolved).toEqual([]);
    expect(d.unresolved).toEqual(["2026-07-17"]);
    // A measured zero is a node with net 0, not an unknown.
    expect(d.nodes.find((n) => n.exp === "2026-07-10")?.net).toBe(0);
  });
});

describe("ExpiryBars — unknown rows stay visible as a dash", () => {
  it("keeps every expiration under delta and renders the missing one as —, the zero as 0", async () => {
    await render(<ExpiryBars byExpiry={ROWS} greek="delta" asOf={ASOF} lang="en" />);
    expect(barRows()).toEqual([["07-10", "0"], ["07-17", "—"], ["07-24", "-3.0M"]]);
  });
  it("shows the same three expirations under gamma", async () => {
    await render(<ExpiryBars byExpiry={ROWS} greek="gamma" asOf={ASOF} lang="en" />);
    expect(barRows().map((r) => r[0])).toEqual(["07-10", "07-17", "07-24"]);
  });
});

describe("ExposureExpiryDrawer — the header count does not change with the greek", () => {
  it("counts the full population and discloses the unknown expiration under delta", async () => {
    await render(<ExposureExpiryDrawer byExpiry={ROWS} greek="gamma" asOf={ASOF} lang="en" />);
    const gammaCount = node.querySelector(".obs-xdrawer-count")?.textContent;
    await render(<ExposureExpiryDrawer byExpiry={ROWS} greek="delta" asOf={ASOF} lang="en" />);
    expect(node.querySelector(".obs-xdrawer-count")?.textContent).toBe(gammaCount);
    expect(gammaCount).toContain("3");
    await act(async () => (node.querySelector(".obs-xdrawer-hd") as HTMLButtonElement).click());
    expect(node.querySelector('[data-testid="xdrawer-unresolved"]')?.textContent).toContain("1");
  });
});
