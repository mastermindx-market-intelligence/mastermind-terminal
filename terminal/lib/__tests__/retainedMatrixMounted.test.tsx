// @vitest-environment jsdom
// Actual GexDesk -> admitted Lab -> incumbent client reader; only external I/O and presentation leaves replaced.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { webcrypto, createHash } from "node:crypto";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { retainedFixture, principal, secondPrincipal } from "./fixtures/retainedMatrixReadFixture";
import { GexDeskView } from "@/components/gexdesk/GexDeskView";
import { flowInvalidate } from "../flowClientCache";
import { GET } from "@/app/api/flow/route";
const state = vi.hoisted(() => ({ user: "11111111-1111-4111-8111-111111111111", allowed: true, lang: "en", retry: null as (() => void) | null }));
vi.mock("@/app/api/billing/gateway", () => ({ billingPrincipalAuthResult: async () => ({ status: "ok", principal: state.user, token: "inert-server-token" }) }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: () => ({ ok: true }), tooMany: vi.fn() }));
vi.mock("next/dynamic", () => ({ default: (loader: () => Promise<React.ComponentType>) => {
  if (!String(loader).includes("AdmittedOptionsResearchLab")) return () => null;
  const Component = React.lazy(() => loader().then(component => ({ default: component })));
  return function Loaded(props: Record<string, unknown>) { state.retry = props.onRetryMatrix as (() => void) | null; return <React.Suspense fallback={null}><Component {...props} /></React.Suspense>; };
} }));
vi.mock("@/components/chrome/AppShell", () => ({ useShellIdentity: () => ({ kind: "account", userId: state.user, email: "" }) }));
vi.mock("@/lib/entitlementStore", () => ({ useEntitlementSnapshot: () => ({ owner: `account:${state.user}`, state: state.allowed ? "VERIFIED_PAID" : "LOADING", plan: { features: ["terminal_live_options"] } }) }));
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
let host: HTMLDivElement, root: Root;
const pending: Array<{ url: URL; owner: string; resolve: (v: unknown) => void }> = [];
let fixture = retainedFixture();
const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data });
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.stubGlobal("crypto", webcrypto);
  vi.stubEnv("FLOW_FIXTURE", "0"); state.user = principal; state.allowed = true; state.lang = "en"; fixture = retainedFixture(); pending.length = 0; flowInvalidate();
  window.history.replaceState(null, "", "/?research=1");
  vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => {
    const u = new URL(url, "https://terminal.example");
    if (u.searchParams.has("retained")) {
      if (u.pathname === "/api/flow") return GET(new Request(u, { headers: options?.headers }));
      expect(u.pathname).toBe("/api/hub/matrix/SPY");
      expect(new Headers(options?.headers).get("Authorization")).toBe("Bearer inert-server-token");
      return new Promise(resolve => pending.push({ url: u, owner: new Headers(options?.headers).get("X-Mastermind-Expected-Principal")!, resolve }));
    }
    return Promise.resolve(u.searchParams.get("f") === "matrix:SPY" ? ok(fixture.matrix) : { ok: false, status: 404 });
  }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); flowInvalidate(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); window.history.replaceState(null, "", "/"); });
const render = async () => { await act(async () => root.render(<GexDeskView />));
  for (let n = 0; n < 15 && !host.querySelector("select"); n++) await act(async () => new Promise(resolve => setTimeout(resolve, 5)));
};
const panel = () => host.querySelector('[data-testid="research-retained"]');
async function click(text: string) { const button = [...host.querySelectorAll("button")].find(b => b.textContent === text); expect(button, text + " / " + host.textContent).toBeDefined(); await act(async () => button!.click()); }
async function select(index: number, value: string) { const element = host.querySelectorAll("select")[index]; expect(element).toBeDefined(); await act(async () => { element.value = value; element.dispatchEvent(new Event("change", { bubbles: true })); }); }
async function choose() { await click(state.lang === "zh" ? "100 看涨 · 2026-10-30" : "100 Call · 2026-10-30"); await select(0, "call"); await select(1, "2026-10-30"); }
async function settle(index: number) {
  const p = pending[index]; expect(p).toBeDefined(); const response = JSON.parse(JSON.stringify(fixture.response));
  response.retained.owner_id = p.owner;
  const wire = JSON.parse(response.retained.wire_utf8);
  wire.selector.side = p.url.searchParams.get("side"); response.retained.selector.side = wire.selector.side;
  response.retained.wire_utf8 = JSON.stringify(wire);
  response.retained.selection_sha256 = createHash("sha256").update(p.url.searchParams.get("selection")!).digest("hex");
  await act(async () => p.resolve(ok(response)));
  // WebCrypto digests complete on subsequent tasks.
  for (let n = 0; n < 30; n++) await act(async () => new Promise(resolve => setTimeout(resolve, 2)));
}
it.each(["en", "zh"])("joins actual selector -> same Matrix read -> exact panel (%s), without all-expiry fallback", async lang => {
  state.lang = lang; await render(); expect(pending).toHaveLength(0);
  await click(lang === "zh" ? "100 看涨 · 2026-10-30" : "100 Call · 2026-10-30"); expect(pending).toHaveLength(0);
  await select(0, "call"); expect(pending).toHaveLength(0); await select(1, "2026-10-30"); expect(pending).toHaveLength(1);
  expect(pending[0].owner).toBe(principal); await settle(0); expect(panel()?.textContent).toContain("9007199254740993");
  expect([...host.querySelectorAll("button")].find(b => b.textContent === (lang === "zh" ? "保存研究" : "Save investigation"))?.disabled).toBe(true);
});
it.each(["expiry", "side", "lens", "owner", "entitlement", "source", "session", "root"])("withdraws joined output and fences late response on %s", async reason => {
  await render(); await choose();
  if (reason === "expiry") await select(1, "all");
  if (reason === "side") await select(0, "put");
  if (reason === "lens") await click("Flow & packages");
  if (reason === "owner") { state.user = secondPrincipal; await render(); }
  if (reason === "entitlement") { state.allowed = false; await render(); }
  if (["source", "session", "root"].includes(reason)) {
    if (reason === "source") fixture.matrix.stale = true;
    if (reason === "session") fixture.matrix._build_meta.asof_date = "2026-10-20";
    if (reason === "root") fixture.matrix.root = "QQQ";
    await act(async () => { flowInvalidate("matrix:SPY"); document.dispatchEvent(new Event("visibilitychange")); });
  }
  await settle(0); expect(panel()?.textContent ?? "").not.toContain("9007199254740993");
});
it("A -> all-expiry -> A starts a new flight; late first A cannot repopulate", async () => {
  await render(); await choose(); await select(1, "all"); await select(1, "2026-10-30"); expect(pending).toHaveLength(2);
  await settle(0); expect(panel()).toBeNull(); await settle(1); expect(panel()?.textContent).toContain("9007199254740993");
  await select(1, "all"); expect(panel()).toBeNull();
});
it("language-only render preserves the exact flight and mounted values", async () => {
  await render(); await choose(); await settle(0); state.lang = "zh"; await render();
  expect(pending).toHaveLength(1); expect(panel()?.textContent).toContain("9007199254740993");
});

it.each(["entitlement", "owner", "lens", "pin"])("withdraws an already displayed exact result on %s", async change => {
  await render(); await choose(); await settle(0); expect(panel()?.textContent).toContain("9007199254740993");
  if (change === "entitlement") { state.allowed = false; await render(); }
  if (change === "owner") { state.user = secondPrincipal; await render(); }
  if (change === "lens") await click("Flow & packages");
  if (change === "pin") await click("Dismiss selection");
  expect(panel()).toBeNull();
});
it("fresh supplier denial withdraws the private pair while ordinary Matrix stays visible", async () => {
  await render(); await choose(); await settle(0); expect(panel()?.textContent).toContain("9007199254740993");
  await click("Open interest"); expect(pending).toHaveLength(2); expect(panel()).toBeNull();
  await act(async () => pending[1].resolve(ok({ schema: "options.matrix.read/v1", status: "unavailable", display: null, retained: null, reason: "source_use_denied" })));
  expect(panel()).toBeNull(); expect(host.textContent).toContain("100 Call · 2026-10-30");
});

it.each(["cells", "coverage"])("withdraws retained values beside same-marker different ordinary %s", async field => {
  fixture.matrix = { ...fixture.matrix, ...(field === "cells" ? { cells: [{ ...fixture.matrix.cells[0], call_oi: 7 }] } : { coverage: { unrelated: true } }) };
  await render(); await choose(); await settle(0);
  expect(panel()).toBeNull();
});
it("unchanged ordinary Retry requalifies once through the same owner", async () => {
  await render(); await choose(); await settle(0); expect(panel()).not.toBeNull();
  expect(state.retry).toBeTypeOf("function"); await act(async () => state.retry!());
  expect(pending).toHaveLength(2); expect(panel()).toBeNull();
  await settle(1); expect(panel()?.textContent).toContain("9007199254740993");
});
it("ordinary Retry fences the older qualified flight even with identical selection", async () => {
  await render(); await choose(); await act(async () => state.retry!());
  expect(pending).toHaveLength(2);
  await settle(0); expect(panel()).toBeNull();
  await settle(1); expect(panel()?.textContent).toContain("9007199254740993");
});

it("a successful side change keeps the concrete expiry and qualifies its new exact frame", async () => {
  await render(); await choose(); await settle(0); expect(panel()).not.toBeNull();
  await select(0, "all"); expect(pending).toHaveLength(2); expect(panel()).toBeNull();
  expect(pending[1].url.searchParams.get("expiry")).toBe("2026-10-30");
  expect(pending[1].url.searchParams.get("side")).toBe("all");
  await settle(1); expect(panel()?.textContent).toContain("9007199254740993");
  await render(); expect(pending).toHaveLength(2);
});
it("large-decimal source coordinate remains unqualified through the existing numeric selector", async () => {
  fixture = retainedFixture(principal, "123456789012.12345678"); await render();
  const coordinate = [...host.querySelectorAll("button")].find(b => b.textContent?.includes("Call · 2026-10-30"));
  expect(coordinate).toBeDefined(); await act(async () => coordinate!.click());
  await select(0, "call"); await select(1, "2026-10-30"); expect(pending).toHaveLength(1);
  expect(JSON.parse(pending[0].url.searchParams.get("selection")!).primary.strike).not.toBe("123456789012.12345678");
  await settle(0); expect(panel()).toBeNull();
});
