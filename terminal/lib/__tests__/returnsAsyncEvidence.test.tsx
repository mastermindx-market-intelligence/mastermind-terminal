// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AccountIdentity } from "@/lib/accountIdentity";
import type { ReturnSeries } from "../returnsIntelligence";

vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => React.createElement("a", props, children) }));
import ReturnsEvidencePanel from "@/components/fin/returns/ReturnsEvidencePanel";

// Real identities passed as the panel's required prop. Identity behaviour is driven
// through that contract — never by simulating the shell hook (the panel does not read
// AppShell itself; its host resolves the identity).
const accountA: AccountIdentity = { kind: "account", userId: "11111111-1111-4111-8111-111111111111", email: "owner-a@example.com" };
const accountB: AccountIdentity = { kind: "account", userId: "22222222-2222-4222-8222-222222222222", email: "owner-b@example.com" };

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
type Pending = { url: string; signal: AbortSignal; resolve: (response: Response) => void };
let pending: Pending[];
const series: ReturnSeries = { symbol: "NVDA", bars: [], basis: "reported_price", quality: "unverified", source: "fixture", issues: [], breaks: [], asOf: "2026-10-16" };
async function render(symbol = "NVDA", session = "2026-10-16", horizon: 5 | 21 | 63 = 21, identity: AccountIdentity = accountA, composite = false) {
  await act(async () => { root.render(<ReturnsEvidencePanel symbol={symbol} session={session} horizon={horizon} series={{ ...series, symbol }} zh={false} composite={composite} identity={identity} />); });
}
async function resolve(items: Pending[], symbol: string, gex: number) {
  await act(async () => {
    for (const item of items) {
      const u = new URL(item.url, "http://localhost"), f = u.searchParams.get("f") || "";
      const body = f.startsWith("gex")
        ? { schema: "options_hub.gex/v1", root: symbol, asof: "2026-10-16", net_gex_bn: gex }
        : f.startsWith("ticker:") ? { schema: "live_flow.ticker/v1", root: symbol, asof: "2026-10-16", day: { gross: gex * 1000, n_events: 7 } }
        : { status: "abstain", reasons: [`MODEL_${symbol}`] };
      item.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }
  });
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-18T00:00:00Z"));
  pending = [];
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit) => new Promise<Response>(resolve => { pending.push({ url, signal: init.signal as AbortSignal, resolve }); })));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("cannot display a late response beneath a newly selected stock", async () => {
  await render(); const old = pending.slice();
  await render("AMD"); const current = pending.slice(old.length);
  expect(old.every(p => p.signal.aborted)).toBe(true);
  await resolve(current, "AMD", 5); expect(host.textContent).toMatch(/\$5(?:\.0+)?B/);
  await resolve(old, "NVDA", 99); expect(host.textContent).not.toMatch(/\$99(?:\.0+)?B/);
  expect(host.textContent).toContain("model amd"); expect(host.textContent).not.toContain("model nvda");
});

it("clears private evidence immediately on account change and rejects the old owner's completion", async () => {
  await render(); const a = pending.slice(); await resolve(a, "NVDA", 9);
  expect(host.textContent).toMatch(/\$9(?:\.0+)?B/);
  await render("NVDA", "2026-10-16", 21, accountB);
  expect(host.textContent).not.toMatch(/\$9(?:\.0+)?B/); expect(host.textContent).toContain("Loading this session");
  await resolve(pending.slice(a.length), "NVDA", 2); expect(host.textContent).toMatch(/\$2(?:\.0+)?B/);
  await resolve(a, "NVDA", 9); expect(host.textContent).toMatch(/\$2(?:\.0+)?B/); expect(host.textContent).not.toMatch(/\$9(?:\.0+)?B/);
});

it("historical selection requests the exact GEX archive and never today's flow", async () => {
  await render(); const current = pending.slice(); await resolve(current, "NVDA", 9);
  await render("NVDA", "2026-10-15");
  const historical = pending.slice(current.length).map(p => new URL(p.url, "http://localhost"));
  expect(historical.some(u => u.searchParams.get("f") === "gex_at:NVDA:2026-10-15")).toBe(true);
  expect(historical.some(u => u.searchParams.get("f")?.startsWith("ticker:"))).toBe(false);
  expect(host.textContent).not.toMatch(/\$9(?:\.0+)?B/);
});

it("a flow outage is presented as a failed read, and carries the selected symbol to Exposure", async () => {
  await render();
  await act(async () => { for (const item of pending) item.resolve(new Response("{}", { status: 503 })); });
  expect(host.textContent).toContain("Flow evidence could not be loaded.");
  expect(host.querySelector("a")?.getAttribute("href")).toBe("/options?tab=gex&symbol=NVDA");
});

it("an option root the flow route would refuse terminates absent instead of loading forever", async () => {
  await render("TOOLONGTICKERX");
  expect(host.textContent).toContain("No positioning snapshot is published for this session.");
  expect(host.textContent).toContain("A matching historical flow snapshot is not available here.");
  expect(host.textContent).not.toContain("Loading this session");
  expect(pending.some(p => new URL(p.url, "http://localhost").searchParams.get("f")?.startsWith("gex"))).toBe(false);
  expect(pending.some(p => new URL(p.url, "http://localhost").searchParams.get("f")?.startsWith("ticker:"))).toBe(false);
});

it("a composite basket fetches no option or forecast evidence", async () => {
  await render("NVDA", "2026-10-16", 21, accountA, true);
  expect(host.textContent).toContain("Inspect a constituent for its options evidence.");
  expect(pending).toHaveLength(0);
});
