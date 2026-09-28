// @vitest-environment jsdom
// Real desk, summary and ladder; transport and unrelated presentation leaves are fixtures.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GexDeskView } from "@/components/gexdesk/GexDeskView";
import { makeGexT } from "@/components/gexdesk/gexStrings";

const input = vi.hoisted(() => ({ lang: "en" as "en" | "zh", gex: {} as unknown,
  matrix: {} as unknown, projected: null as unknown }));
vi.mock("@/lib/flowClientCache", () => ({ flowGet: async (key: string) => key.startsWith("matrix:") ? input.matrix : null }));
vi.mock("@/lib/flowStream", () => ({ useFlowStream: () => ({ data: input.gex, error: null }) }));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: input.lang }) }));
vi.mock("@/lib/searchTrack", () => ({ trackSearch: vi.fn() }));
vi.mock("@/components/gexdesk/ExposureMatrix", () => ({ ExposureMatrix: ({ matrix }: { matrix: unknown }) => {
  input.projected = matrix; return null;
} }));
vi.mock("@/components/gexdesk/MarketStateCard", () => ({ MarketStateCard: () => null }));
vi.mock("@/components/eodcontext/EodContextBelt", () => ({ EodContextBelt: () => null }));
vi.mock("@/components/gexdesk/GexHistory", () => ({ GexHistory: () => null }));
vi.mock("@/components/gexdesk/ExpiryBars", () => ({ ExpiryBars: () => null }));
vi.mock("@/components/gexdesk/ExposureExpiryDrawer", () => ({ ExposureExpiryDrawer: () => null }));
vi.mock("@/components/gexdesk/HeatSeekerCard", () => ({ HeatSeekerCard: () => null }));

const session = "2026-09-25";
const cell = (strike: number, gex: number | null, expiry = session) => ({ strike, expiry, gex });
function fixture(cells: Array<ReturnType<typeof cell> & Record<string, unknown>> = [cell(770, 8e6), cell(771, null)]) {
  input.gex = { schema: "options_hub.gex/v1", root: "SPY", asof: session, spot_ref: 770.5,
    net_gex_bn: 0.025, call_wall: 775, put_wall: 765, gamma_flip: 769, history: [],
    by_strike: [770, 771].map(strike => ({ strike, gamma_net: 12.5, gamma_call: 15,
      gamma_put: -2.5, delta_net: 1, vanna_net: 1, charm_net: 1 })),
    by_expiry: [{ exp: session, gamma_net: 10 }, { exp: "2026-09-28", gamma_net: 15 }] };
  return { schema: "options_structure.matrix/v1", root: "SPY", asof: "2026-09-26T00:05:00Z",
    _build_meta: { asof_date: session }, spot: 770.5, strikes: [770, 771],
    expiries: [session, "2026-09-28"], cells };
}
let node: HTMLDivElement;
let root: Root;
async function mount() { await act(async () => root.render(<GexDeskView />)); }
function button(label: string) {
  const value = [...node.querySelectorAll("button")].find(b => b.textContent?.trim() === label);
  expect(value).toBeDefined(); return value!;
}
async function selectZero() { await act(async () => button(makeGexT(input.lang)("expiry0Dte")).click()); }
const metric = () => node.querySelector('[data-tut="gex-summary"]')!.firstElementChild!;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 1000, height: 600 } as DOMRect);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.scrollTo = vi.fn();
  input.lang = "en"; input.matrix = fixture(); input.projected = null;
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("mounted source-reported Exposure lens", () => {
  it("shows the known $8M subtotal while withholding the incomplete selected total", async () => {
    await mount(); await selectZero();
    expect(metric().firstElementChild?.textContent).toBe("Reported GEX0DTE");
    expect(metric().lastElementChild?.textContent).toBe("—");
    expect((metric().lastElementChild as HTMLElement).style.color).toBe("var(--muted)");
    expect(node.querySelector('[data-testid="gex-lens-partial"]')?.textContent).toContain("Known subtotal +8.0M");
    expect(node.querySelector('[data-testid="gex-lens-partial"]')?.textContent).toContain("1 unresolved grid cells");
    expect(node.querySelector('[data-testid="gex-lens-source"]')?.textContent).toContain(session);
    expect(node.textContent).toContain("Fri, Sep 25 · source session");
    expect(node.textContent).not.toContain("Thu, Sep 24, 20:00 ET");
  });
  it("retains the same source warning for a numerically complete grid", async () => {
    input.matrix = fixture([cell(770, 1e6), cell(771, 2e6)]);
    await mount(); await selectZero();
    expect(metric().lastElementChild?.textContent).toBe("+3.0M");
    expect(node.querySelector('[data-testid="gex-lens-source"]')?.textContent).toContain("Source completeness is unknown");
    expect(node.querySelector('[data-testid="gex-lens-partial"]')).toBeNull();
  });
  it("preserves measured zero as a known subtotal", async () => {
    input.matrix = fixture([cell(770, 0), cell(771, null)]);
    await mount(); await selectZero();
    expect(metric().lastElementChild?.textContent).toBe("—");
    expect(node.querySelector('[data-testid="gex-lens-partial"]')?.textContent).toContain("Known subtotal 0");
  });
  it("uses Chinese source-state copy without leaking English", async () => {
    input.lang = "zh";
    await mount(); await selectZero();
    const source = node.querySelector('[data-testid="gex-lens-source"]')?.textContent;
    expect(source).toContain("源数据完整性未知"); expect(source).toContain("已知小计");
    expect(source).not.toContain("Known subtotal");
  });
  it.each(["wrong root", "missing session", "duplicate outside scope"]) ("refuses %s and preserves independent all-expiry values", async (fault) => {
    const doc = fixture();
    if (fault === "wrong root") doc.root = "QQQ";
    if (fault === "missing session") doc._build_meta.asof_date = "";
    if (fault === "duplicate outside scope") doc.cells.push(cell(770, 1e6, "2026-09-28"), cell(770, 2e6, "2026-09-28"));
    input.matrix = doc;
    await mount(); await selectZero();
    expect(button(makeGexT(input.lang)("expiry0Dte")).getAttribute("aria-disabled")).toBe("true");
    expect(metric().lastElementChild?.textContent).toBe("+25.0M");
    expect(node.querySelector('[data-testid="gex-lens-source"]')).toBeNull();
  });
  it("retains unrelated unusual analytics while sanitizing invalid GEX and incomplete OI", async () => {
    input.matrix = fixture([
      { ...cell(770, 1e6), unusual: { call: { ratio: 4 } }, call_oi: 10, put_oi: null },
      { ...cell(771, NaN), unusual: { put: { samples: 15 } } },
    ]);
    await mount();
    await act(async () => button(makeGexT(input.lang)("viewMatrix")).click());
    expect(input.projected).toMatchObject({ cells: [
      { unusual: { call: { ratio: 4 } }, call_oi: null, put_oi: null },
      { gex: null, unusual: { put: { samples: 15 } } },
    ] });
  });
});
