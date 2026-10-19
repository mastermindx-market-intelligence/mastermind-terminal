// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GUEST_IDENTITY, type AccountIdentity } from "@/lib/accountIdentity";

// The shell read stays pinned to the real guest value: every identity assertion below is
// driven through the page's explicit `identity` prop (the chart host's contract), never by
// simulating the hook.
vi.mock("@/components/chrome/AppShell", () => ({ useShellIdentity: () => GUEST_IDENTITY }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => React.createElement("a", props, children) }));

const harness = vi.hoisted(() => ({
  documents: new Map<string, unknown>(),
  fetches: [] as string[],
  posts: [] as { url: string; resolve: (response: Response) => void }[],
}));
vi.mock("@/lib/dataCache", () => ({
  getJSONResult: (url: string) => Promise.resolve(harness.documents.has(url) ? { status: "data", data: harness.documents.get(url) } : { status: "absent" }),
  invalidate: () => undefined,
}));
import ReturnsPage from "@/components/fin/ReturnsPage";
import { returnSessions } from "@/lib/returnsIntelligence";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const DAYS = returnSessions("2025-01-02", "2026-10-16")!.slice(-320);
const LATEST = DAYS.at(-1)!;
const accountA: AccountIdentity = { kind: "account", userId: "33333333-3333-4333-8333-333333333333", email: "owner-a@example.com" };
const accountB: AccountIdentity = { kind: "account", userId: "44444444-4444-4444-8444-444444444444", email: "owner-b@example.com" };

function historyDocument(symbol: string): unknown {
  let close = 100;
  const bars = DAYS.map((day, i) => {
    const prior = close, open = prior * (1 + (i % 3) * 0.0008);
    close *= Math.exp(0.0018 + (i % 7) * 0.0004);
    return [day, open, Math.max(open, close) * 1.002, Math.min(open, close) * 0.998, close, 1000000 + i * 17];
  });
  return { t: symbol, src: "fixture", bar_quality: "real_ohlc", bars,
    view: { schema: "terminal.ohlc_view.v1", listing: { mic: "XNAS", src: "fixture" },
      contract: { schema: "dataos.view_contract.v1", purpose: "terminal_daily_ohlc", identity_namespace: "synthetic_returns_fixture", field_units: { close: "USD/share" }, coverage: { from: DAYS[0], to: LATEST }, adjustment_reference: { basis: "tradj", as_at: "2026-10-16T20:00:00Z" }, evidence_mode: { mode: "CURRENT" } },
      segments: [], basis_drift: null, suspected_breaks: [], refusal_reasons: [] } };
}

let host: HTMLDivElement, root: Root;
const fetchUrls = () => harness.fetches.map(u => new URL(u, "http://localhost").pathname + new URL(u, "http://localhost").search);
const dayLabel = (day: string) => new Date(day + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const calendar = () => host.querySelector('[role="group"][aria-label="Session calendar"]') as HTMLElement | null;
const outlookSession = () => host.querySelector('section[aria-label="Forward outlook"] time')?.textContent ?? "";
const pressedDay = () => calendar()?.querySelector('button[aria-pressed="true"]')?.getAttribute("aria-label") ?? "";
async function render({ sym = "NVDA", identity = accountA }: { sym?: string; identity?: AccountIdentity } = {}) {
  await act(async () => { root.render(<ReturnsPage sym={sym} zh={false} identity={identity} />); });
  await act(async () => {});
}
async function click(element: Element) {
  await act(async () => { element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
  await act(async () => {});
}
const buttonWithText = (text: string) => [...host.querySelectorAll("button")].find(b => b.textContent?.trim() === text);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-18T00:00:00Z"));
  harness.documents.clear(); harness.fetches = []; harness.posts = [];
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    harness.fetches.push(url);
    if (url.includes("/api/returns/basket")) return new Promise<Response>(resolve => { harness.posts.push({ url, resolve }); });
    if (url.includes("/api/sector-intelligence")) {
      return Promise.resolve(new Response(JSON.stringify({ receipt: { source: "confluence", status: "ready", asOf: "2026-10-16", stale: false },
        data: { ok: true, asof: "2026-10-16", sectors: [], subsectors: [{ key: "semis", kind: "subsector", label: "Semiconductors", sector: "Technology", members: ["NVDA", "AMD", "AVGO"].map(ticker => ({ ticker })) }] } }), { status: 200 }));
    }
    return new Promise<Response>(() => undefined); // evidence reads stay pending; only presence is asserted
  }));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("a zero-bar 200 history stays a useful empty state — no dead calendar, no Through line, no evidence read", async () => {
  harness.documents.set("/data/NVDA.json", { t: "NVDA", src: "fixture", bars: [] });
  await render();
  expect(host.textContent).toContain("This history does not meet the return-data contract.");
  expect(buttonWithText("Retry")).toBeTruthy();
  expect(calendar()).toBeNull();
  expect(host.textContent).not.toContain("Through");
  expect(fetchUrls().some(u => u.startsWith("/api/flow"))).toBe(false);
});

it("a history published under a different symbol refuses into the same empty state", async () => {
  harness.documents.set("/data/NVDA.json", historyDocument("AMD"));
  await render();
  expect(host.textContent).toContain("This history does not meet the return-data contract.");
  expect(calendar()).toBeNull();
  expect(fetchUrls().some(u => u.startsWith("/api/flow"))).toBe(false);
});

it("a symbol outside the covered universe says so instead of loading", async () => {
  await render({ sym: "AAPL240118C00150000" });
  expect(host.textContent).toContain("This view currently covers US equities and ETFs.");
  expect(harness.fetches).toHaveLength(0);
});

it("reducing the range resets an out-of-window pin to the latest session on chart, calendar and inspector", async () => {
  harness.documents.set("/data/NVDA.json", historyDocument("NVDA"));
  await render();
  expect(host.textContent).toContain("Returns intelligence");
  for (let i = 0; i < 7; i++) await click(host.querySelector('button[aria-label="Previous month"]')!);
  const picked = calendar()!.querySelector('button[aria-label^="2026-"]:not(:disabled)')!;
  const pickedDay = picked.getAttribute("aria-label")!.slice(0, 10);
  expect(pickedDay < "2026-07").toBe(true); // more than 126 sessions before the latest
  await click(picked);
  expect(outlookSession().startsWith(pickedDay)).toBe(true);
  expect(fetchUrls().some(u => u.includes(`gex_at%3ANVDA%3A${pickedDay}`) || u.includes(`gex_at:NVDA:${pickedDay}`))).toBe(true);

  await click(buttonWithText("1M")!);
  expect(outlookSession().startsWith(LATEST)).toBe(true);
  expect(pressedDay().startsWith(LATEST)).toBe(true);
  const readout = host.querySelector('[class*="chartReadout"]')?.textContent ?? "";
  expect(readout).toContain(dayLabel(LATEST));
  expect(readout).not.toContain(dayLabel(pickedDay));
  // The inspector moved off the archive: the current-session read is re-requested.
  expect(fetchUrls().filter(u => u.includes("gex%3ANVDA") || u.includes("gex:NVDA")).length).toBeGreaterThanOrEqual(2);
});

it("keeps a pin the reduced window still shows", async () => {
  harness.documents.set("/data/NVDA.json", historyDocument("NVDA"));
  await render();
  const kept = calendar()!.querySelector(`button[aria-label^="${DAYS.at(-4)!}"]`)!;
  await click(kept);
  await click(buttonWithText("1M")!);
  expect(outlookSession().startsWith(DAYS.at(-4)!)).toBe(true);
  expect(pressedDay().startsWith(DAYS.at(-4)!)).toBe(true);
});

it("an account change clears basket state and the previous owner's late response cannot repopulate it", async () => {
  harness.documents.set("/data/NVDA.json", historyDocument("NVDA"));
  await render({ identity: accountA });
  await click(buttonWithText("Sector / theme basket")!);
  await act(async () => {});
  const select = () => host.querySelector('select[aria-label="Source group"]') as HTMLSelectElement;
  expect([...select().options].some(o => o.value === "semis")).toBe(true);
  await act(async () => { select().value = "semis"; select().dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => {});
  expect(host.textContent).toContain("Checking every constituent…");
  expect(harness.posts).toHaveLength(1);

  await render({ identity: accountB });
  expect(host.textContent).not.toContain("Members ·");
  expect(host.textContent).toContain("Checking every constituent…");
  await act(async () => { harness.posts[0].resolve(new Response(JSON.stringify({ status: "incomplete", reason: "MEMBERS_UNAVAILABLE", missing: ["AMD"] }), { status: 200 })); });
  await act(async () => {});
  expect(host.textContent).not.toContain("Members ·");
  expect(host.textContent).toContain("Checking every constituent…");
});
