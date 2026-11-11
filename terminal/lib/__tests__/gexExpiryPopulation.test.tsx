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
import { makeGexT } from "@/components/gexdesk/gexStrings";

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

const MIXED: ExpiryRow[] = [
  { exp: "2026-08-07", gamma_net: 5, charm_net: 1 },
  { exp: "2026-07-24", gamma_net: 0, vanna_net: 0, charm_net: 0 },
  { exp: "2026-07-10", gamma_net: 2, vanna_net: 2, charm_net: 2 },
  {
    exp: "2026-07-17", gamma_net: -1, vanna_net: null, charm_net: -1,
    exposure_support: {
      basis: "admitted_input_contracts",
      vanna: { known_contracts: 1, admitted_contracts: 2, known_net: -0.25 },
      charm: { known_contracts: 2, admitted_contracts: 2, known_net: -1 },
    },
  },
  { exp: "2026-07-31", gamma_net: 3, charm_net: 3 },
];

describe("enriched support preserves the protected expiry population", () => {
  it("sorts unresolved expiries and keeps known subtotals and true zero distinct", () => {
    const vanna = byExpiryToTermStructure(MIXED, "vanna", ASOF);
    expect(vanna).toMatchObject({ rowCount: 5, sourceCount: 5, missingCount: 2, partialCount: 1 });
    expect(vanna.unresolved).toEqual(["2026-07-31", "2026-08-07"]);
    expect(vanna.nodes.map(({ exp, net, sign, partial }) => ({ exp, net, sign, partial }))).toEqual([
      { exp: "2026-07-10", net: 2, sign: 1, partial: false },
      { exp: "2026-07-17", net: -0.25, sign: -1, partial: true },
      { exp: "2026-07-24", net: 0, sign: 0, partial: false },
    ]);
    const charm = byExpiryToTermStructure(MIXED, "charm", ASOF);
    expect(charm).toMatchObject({ rowCount: 5, sourceCount: 5, missingCount: 0, partialCount: 0, unresolved: [] });
    expect(charm.nodes).toHaveLength(5);
  });

  it.each(["en", "zh"] as const)("renders missing, zero and partial rows truthfully in %s", async lang => {
    const t = makeGexT(lang);
    await render(<ExpiryBars byExpiry={MIXED} greek="vanna" asOf={ASOF} lang={lang} />);
    expect([...node.querySelectorAll("[data-expiry]")].map(row => row.getAttribute("data-expiry")))
      .toEqual(["2026-07-10", "2026-07-17", "2026-07-24", "2026-07-31", "2026-08-07"]);
    const partial = node.querySelector('[data-expiry="2026-07-17"]')!;
    expect(partial.getAttribute("data-partial")).toBe("true");
    expect(partial.getAttribute("title")).toBe(`${t("expiryKnownSubtotal")} · 1/2 ${t("expiryAdmittedInputs")}`);
    expect(partial.querySelector(".num")?.textContent).toContain("-250K");
    const zero = node.querySelector('[data-expiry="2026-07-24"]')!;
    expect(zero.querySelector(".num")?.textContent).toBe("0");
    expect((zero.querySelector(".num") as HTMLElement).style.color).toBe("var(--muted)");
    expect(zero.children[1].childElementCount).toBe(0);
    for (const exp of ["2026-07-31", "2026-08-07"]) {
      const missing = node.querySelector(`[data-expiry="${exp}"]`)!;
      expect(missing.querySelector(".num")?.textContent).toBe("—");
      expect((missing.querySelector(".num") as HTMLElement).style.color).toBe("var(--text-dim)");
      expect(missing.children[1].childElementCount).toBe(0);
    }
    expect(node.querySelector('[data-testid="expiry-support"]')?.textContent)
      .toBe(t("expirySupportSummary").replace("{known}", "3").replace("{total}", "5").replace("{partial}", "1"));
  });

  it.each(["en", "zh"] as const)("keeps the drawer count stable while its valued population changes in %s", async lang => {
    const t = makeGexT(lang);
    await render(<ExposureExpiryDrawer byExpiry={MIXED} greek="vanna" asOf={ASOF} lang={lang} />);
    const count = node.querySelector(".obs-xdrawer-count")?.textContent;
    expect(count).toContain("5");
    await act(async () => (node.querySelector(".obs-xdrawer-hd") as HTMLButtonElement).click());
    expect(node.querySelector('[data-testid="expiry-support"]')?.textContent)
      .toBe(t("expirySupportSummary").replace("{known}", "3").replace("{total}", "5").replace("{partial}", "1"));
    expect(node.querySelector('[data-testid="xdrawer-unresolved"]')?.textContent)
      .toBe(t("xdrawerUnresolved").replace("{n}", "2").replace("{m}", "5"));
    await render(<ExposureExpiryDrawer byExpiry={MIXED} greek="charm" asOf={ASOF} lang={lang} />);
    expect(node.querySelector(".obs-xdrawer-count")?.textContent).toBe(count);
    expect(node.querySelector('[data-testid="expiry-support"]')).toBeNull();
    expect(node.querySelector('[data-testid="xdrawer-unresolved"]')).toBeNull();
  });
});
