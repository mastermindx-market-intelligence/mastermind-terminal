// @vitest-environment jsdom
// Real GexDesk → admitted Lab; real client/BFF/source reader. Only Auth/I/O and unrelated presentation are inert.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import producer from "./fixtures/volObservationProducer.json";
import { GexDeskView } from "@/components/gexdesk/GexDeskView";
import { flowInvalidate } from "@/lib/flowClientCache";
import { GET } from "@/app/api/flow/route";
const state = vi.hoisted(() => ({ lang: "en", allowed: true }));
vi.mock("@/lib/entitlement", () => ({ getLiveOptionsAccess: async () => state.allowed ? "allowed" : "denied" }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: () => ({ ok: true }), tooMany: vi.fn() }));
vi.mock("next/dynamic", () => ({ default: (loader: () => Promise<React.ComponentType>) => {
  if (!String(loader).includes("AdmittedOptionsResearchLab")) return () => null;
  const Component = React.lazy(() => loader().then(component => ({ default: component })));
  return function Loaded(props: Record<string, unknown>) { return <React.Suspense fallback={null}><Component {...props} /></React.Suspense>; };
} }));
vi.mock("@/components/chrome/AppShell", () => ({ useShellIdentity: () => ({ kind: "account", userId: "11111111-1111-4111-8111-111111111111", email: "" }) }));
vi.mock("@/lib/entitlementStore", () => ({ useEntitlementSnapshot: () => ({ owner: "account:11111111-1111-4111-8111-111111111111", state: state.allowed ? "VERIFIED_PAID" : "LOADING", plan: { features: ["terminal_live_options"] } }) }));
vi.mock("@/components/researchlab/useResearchAppearance", () => ({ useResearchAppearance: vi.fn() }));
vi.mock("@/lib/flowStream", () => ({ useFlowStream: () => ({ data: null, error: null }) }));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: state.lang }) }));
vi.mock("@/lib/searchTrack", () => ({ trackSearch: vi.fn() }));
vi.mock("@/components/eodcontext/EodContextBelt", () => ({ EodContextBelt: () => null }));
vi.mock("@/components/gexdesk/GexSummaryBar", () => ({ GexSummaryBar: () => null }));
vi.mock("@/components/gexdesk/StrikeLadder", () => ({ StrikeLadder: () => null }));
vi.mock("@/components/gexdesk/GexHistory", () => ({ GexHistory: () => null }));
vi.mock("@/components/gexdesk/ExpiryBars", () => ({ ExpiryBars: () => null }));
vi.mock("@/components/gexdesk/ExposureExpiryDrawer", () => ({ ExposureExpiryDrawer: () => null }));
vi.mock("@/components/gexdesk/ExposureMatrix", () => ({ ExposureMatrix: () => null }));
vi.mock("@/components/gexdesk/HeatSeekerCard", () => ({ HeatSeekerCard: () => null }));
let host: HTMLDivElement, root: Root, symbol: string, payload: Record<string, unknown>, upstreamReads: number;
let counter = 0;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  symbol = ["SPY", "QQQ", "IWM", "DIA"][counter++]; state.lang = "en"; state.allowed = true; upstreamReads = 0;
  payload = { ...producer, root: symbol, observation_provenance: { ...producer.observation_provenance, root: symbol } };
  flowInvalidate(); vi.stubEnv("FLOW_FIXTURE", "0");
  window.history.replaceState(null, "", `/?research=1&symbol=${symbol}`);
  vi.stubGlobal("fetch", vi.fn(async (input: string, options?: RequestInit) => {
    const u = new URL(input, "https://terminal.example");
    const f = u.searchParams.get("f");
    if (u.pathname === "/api/flow" && f === `vol:${symbol}`) return GET(new Request(u, { headers: options?.headers }));
    if (u.pathname === `/api/hub/vol/${symbol}`) { upstreamReads++; return Response.json(payload); }
    if (f === `matrix:${symbol}`) return Response.json({ schema: "options_structure.matrix/v1", root: symbol, session: "2026-10-05", cells: [{ strike: 785, expiry: "2026-10-09", call_vol: 100, call_oi: 50, put_vol: 0, put_oi: null }] });
    return new Response("{}", { status: 404 });
  }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); flowInvalidate(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); window.history.replaceState(null, "", "/"); });
async function mount() {
  await act(async () => root.render(<GexDeskView />));
  for (let n = 0; n < 30 && !host.querySelector("select"); n++) await act(async () => new Promise(resolve => setTimeout(resolve, 5)));
  const button = [...host.querySelectorAll("button")].find(b => b.textContent === (state.lang === "en" ? "Volatility terrain" : "波动率曲面"));
  expect(button).toBeDefined(); await act(async () => button!.click());
}
const panel = () => host.querySelector('[data-testid="research-vol-diagnostics"]');
it.each(["en", "zh"])("carries actual producer output through existing vol read into mounted diagnostics (%s)", async lang => {
  state.lang = lang; await mount();
  expect(upstreamReads).toBe(1);
  expect(panel()?.textContent).toContain(lang === "en" ? "mean IV by expiry, strike and side" : "按到期日、行权价及方向计算平均隐含波动率");
  expect(panel()?.querySelectorAll("li")).toHaveLength(9);
  expect(panel()?.textContent).toContain(lang === "en" ? "Fitted surface unavailable" : "拟合曲面不可用");
  expect(panel()?.textContent).toContain(lang === "en" ? "Spot is not a supplied forward" : "现货价格不等于已提供的远期价格");
  expect(host.textContent).toContain("58.2%");
  state.allowed = false; await act(async () => root.render(<GexDeskView />));
  expect(panel()).toBeNull(); expect(host.textContent).not.toContain("58.2%");
  expect(upstreamReads).toBe(1);
});
it("withholds IV on contradictory output units through the real transport", async () => {
  payload.observation_provenance = { ...producer.observation_provenance, root: symbol, iv_unit: "ratio" };
  await mount(); expect(upstreamReads).toBe(1);
  expect(panel()?.textContent).toContain("IV values are withheld"); expect(host.textContent).not.toContain("58.2%");
});
it("does not borrow another root's provenance even when the existing route returns it", async () => {
  payload = { ...producer, root: "WRONG" };
  await mount(); expect(upstreamReads).toBe(1);
  expect(panel()?.textContent).toContain("No compatible observation source");
  expect(host.textContent).not.toContain("58.2%"); expect(panel()?.textContent).not.toContain("Producer declares");
});
