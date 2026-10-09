// @vitest-environment jsdom
// T09 — the mounted Exposure desk: real desk, summary bar and strike ladder; transport and
// unrelated presentation leaves are fixtures. Adapted from the consumed #768 harness.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GexDeskView } from "@/components/gexdesk/GexDeskView";
import { makeGexT } from "@/components/gexdesk/gexStrings";

const input = vi.hoisted(() => ({ lang: "en" as "en" | "zh", gex: {} as unknown, matrix: {} as unknown }));
vi.mock("@/lib/flowClientCache", () => ({
  flowGet: async (key: string) => (key.startsWith("matrix:") ? input.matrix : null),
}));
vi.mock("@/lib/flowStream", () => ({ useFlowStream: () => ({ data: input.gex, error: null }) }));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: input.lang }) }));
vi.mock("@/lib/searchTrack", () => ({ trackSearch: vi.fn() }));
vi.mock("@/components/gexdesk/ExposureMatrix", () => ({ ExposureMatrix: () => null }));
vi.mock("@/components/gexdesk/MarketStateCard", () => ({ MarketStateCard: () => null }));
vi.mock("@/components/eodcontext/EodContextBelt", () => ({ EodContextBelt: () => null }));
vi.mock("@/components/gexdesk/GexHistory", () => ({ GexHistory: () => null }));
vi.mock("@/components/gexdesk/ExpiryBars", () => ({ ExpiryBars: () => null }));
vi.mock("@/components/gexdesk/ExposureExpiryDrawer", () => ({ ExposureExpiryDrawer: () => null }));
vi.mock("@/components/gexdesk/HeatSeekerCard", () => ({ HeatSeekerCard: () => null }));

const session = "2026-09-25";
const later = "2026-09-28";
const cell = (strike: number, gex: number | null, expiry = session) => ({ strike, expiry, gex });
type Row = { strike: number; gamma_net: number; gamma_call: number; gamma_put: number;
  delta_net?: number; vanna_net?: number; charm_net?: number };

function fixture(cells = [cell(770, 8e6), cell(771, null)], rows?: Row[]) {
  input.gex = {
    schema: "options_hub.gex/v1", root: "SPY", asof: `${session}T20:15:00Z`, spot_ref: 770.5,
    net_gex_bn: 0.025, call_wall: 775, put_wall: 765, gamma_flip: 769, history: [],
    by_strike: rows ?? [770, 771].map((strike) => ({ strike, gamma_net: 12.5, gamma_call: 15,
      gamma_put: -2.5, delta_net: 1, vanna_net: 3.3, charm_net: 1 })),
    by_expiry: [{ exp: session, gamma_net: 10 }, { exp: later, gamma_net: 15 }],
  };
  return { schema: "options_structure.matrix/v1", root: "SPY", asof: `${session}T21:04:00Z`,
    _build_meta: { asof_date: session }, spot: 770.5, strikes: [770, 771],
    expiries: [session, later], cells };
}

let node: HTMLDivElement;
let root: Root;
const t = () => makeGexT(input.lang);
async function mount() { await act(async () => root.render(<GexDeskView />)); }
function button(label: string) {
  const found = [...node.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
  expect(found, `button ${label}`).toBeDefined();
  return found!;
}
async function click(label: string) { await act(async () => button(label).click()); }
const netMetric = () => node.querySelector('[data-tut="gex-summary"]')!.firstElementChild!;
const netValue = () => netMetric().lastElementChild!.textContent;
/** The value cell of one ladder row, found by its strike label. */
function ladderValue(strike: number): string | null {
  const scroll = node.querySelector('[data-tut="gex-ladder"] .obs-scroll');
  expect(scroll).not.toBeNull();
  const row = [...scroll!.children].find((r) => r.firstElementChild?.firstElementChild?.textContent === String(strike));
  expect(row, `ladder row ${strike}`).toBeDefined();
  return row!.lastElementChild!.textContent;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  input.lang = "en"; input.matrix = fixture();
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("mounted Exposure desk — partial expiry totals", () => {
  it("(a) withholds the 0DTE total when one cell is unknown and discloses the known subtotal", async () => {
    await mount(); await click(t()("expiry0Dte"));
    expect(netValue()).toBe("—");
    expect(ladderValue(770)).toBe("+8.0M");
    expect(ladderValue(771)).toBe("—");
    const partial = node.querySelector('[data-testid="gex-lens-partial"]')?.textContent ?? "";
    expect(partial).toContain("+8.0M");
    expect(partial).toContain("1");
  });

  it("(a) shows the complete total once every selected cell is known", async () => {
    input.matrix = fixture([cell(770, 1e6), cell(771, 2e6)]);
    await mount(); await click(t()("expiry0Dte"));
    expect(netValue()).toBe("+3.0M");
    expect(node.querySelector('[data-testid="gex-lens-partial"]')).toBeNull();
  });

  it("(b) a measured zero stays 0 while the unknown neighbour keeps the total withheld", async () => {
    input.matrix = fixture([cell(770, 0), cell(771, null)]);
    await mount(); await click(t()("expiry0Dte"));
    expect(ladderValue(770)).toBe("0");
    expect(ladderValue(771)).toBe("—");
    expect(netValue()).toBe("—");
  });

  it("(c) the 0DTE anchor is the matrix source session, not its build clock", async () => {
    const doc = fixture([cell(770, 1e6), cell(771, 2e6)]);
    doc.asof = "2026-09-26T00:05:00Z"; // built after UTC midnight
    input.matrix = doc;
    await mount(); await click(t()("expiry0Dte"));
    expect(netValue()).toBe("+3.0M");
  });

  it("(d) switching to Vanna never shows the gamma expiry split under a Vanna label", async () => {
    await mount(); await click(t()("expiry0Dte"));
    expect(ladderValue(770)).toBe("+8.0M");
    await click(t()("greekVanna"));
    // The all-expiry Vanna aggregate from by_strike, not the 0DTE gamma cell.
    expect(ladderValue(770)).toBe("+3.3M");
    expect(ladderValue(771)).toBe("+3.3M");
    expect(node.textContent).toContain(t()("expiryGammaOnlyNote"));
    expect(button(t()("expiry0Dte")).getAttribute("aria-disabled")).toBe("true");
    expect(button(t()("expiry0Dte")).getAttribute("aria-pressed")).toBe("false");
  });

  it("(d) a strike without a Vanna value shows a dash, never a zero", async () => {
    input.matrix = fixture([cell(770, 1e6), cell(771, 2e6)], [
      { strike: 770, gamma_net: 12.5, gamma_call: 15, gamma_put: -2.5, vanna_net: 3.3 },
      { strike: 771, gamma_net: 12.5, gamma_call: 15, gamma_put: -2.5 },
    ]);
    await mount(); await click(t()("greekVanna"));
    expect(ladderValue(770)).toBe("+3.3M");
    expect(ladderValue(771)).toBe("—");
  });
});
