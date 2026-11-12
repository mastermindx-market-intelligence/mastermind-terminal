// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CompanyIntelligencePage from "@/components/fin/CompanyIntelligencePage";
import { normalizeEventWorkspace, type EventWorkspaceResult } from "@/lib/eventWorkspace";
import type { CompanyIntelligenceResult } from "@/lib/companyIntelligence";
import rawWorkspace from "./fixtures/aapl-event-workspace.json";

const edges = vi.hoisted(() => ({ v1: vi.fn(), v2: vi.fn(), lang: "en" as "en" | "zh" }));
vi.mock("@/lib/i18n", async original => ({ ...await original<typeof import("@/lib/i18n")>(), useLang: () => ({ lang: edges.lang }) }));
vi.mock("@/lib/companyIntelligence", async original => ({ ...await original<typeof import("@/lib/companyIntelligence")>(), getCompanyIntelligence: edges.v1 }));
vi.mock("@/lib/eventWorkspace", async original => ({ ...await original<typeof import("@/lib/eventWorkspace")>(), getCurrentEventWorkspace: edges.v2 }));
vi.mock("@/components/fin/CompanyIntelligenceV2Current", () => ({ default: ({ ticker }: { ticker: string }) => <div data-current-reader={ticker}>Current reader</div> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const workspace = normalizeEventWorkspace(rawWorkspace)!;
const ready: EventWorkspaceResult = {
  ok: true, available: true, state: "ready", event_id: workspace.event_id, workspace,
  authority: "context_only", is_context_only: true, display_only: true,
  receipt: { generation_id: workspace.generation_id, workspace_sha256: "a".repeat(64), marker_sha256: "b".repeat(64), workspace_url: "https://example.test/immutable-fixture.json" },
};
const missing: EventWorkspaceResult = { ok: false, available: false, state: "error", error: { code: "not_found", message: "Not covered", retryable: false } };
const absent: CompanyIntelligenceResult = { ok: false, state: "error", error: { code: "not_found", message: "Not covered", retryable: false } };
const failure: EventWorkspaceResult = { ok: false, available: false, state: "error", error: { code: "upstream_unavailable", message: "Temporarily unavailable", retryable: true } };
type Pending<T> = { ticker: string; signal: AbortSignal; resolve: (result: T) => void };
let v1: Pending<CompanyIntelligenceResult>[], v2: Pending<EventWorkspaceResult>[];
let root: Root | null, host: HTMLDivElement;
const retry = () => Array.from(host.querySelectorAll("button")).find(button => button.textContent === (edges.lang === "zh" ? "重试" : "Retry"));
async function render(ticker = "AAPL") {
  await act(async () => { root!.render(<CompanyIntelligencePage sym={ticker} onOpenTx={() => {}} />); });
}
async function expire() { await act(async () => { await vi.advanceTimersByTimeAsync(15_001); }); }

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-09T00:00:00Z"));
  edges.lang = "en"; edges.v1.mockReset(); edges.v2.mockReset(); v1 = []; v2 = [];
  edges.v1.mockImplementation((ticker: string, options: { signal: AbortSignal }) => new Promise(resolve => v1.push({ ticker, signal: options.signal, resolve })));
  edges.v2.mockImplementation((ticker: string, options: { signal: AbortSignal }) => new Promise(resolve => v2.push({ ticker, signal: options.signal, resolve })));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null; host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe("Company Intelligence read recovery", () => {
  it.each(["en", "zh"] as const)("ends a never-settling current read with usable %s retry", async lang => {
    edges.lang = lang; await render(); expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
    await expire();
    expect(host.querySelector('[aria-busy="true"]')).toBeNull(); expect(retry()).toBeDefined();
    expect(v1[0].signal.aborted).toBe(true); expect(v2[0].signal.aborted).toBe(true);
    expect(host.querySelector("[data-current-reader]")).toBeNull();
  });
  it("bounds the standard-reader fallback after current coverage returns not found", async () => {
    await render(); await act(async () => { v2[0].resolve(missing); }); await expire();
    expect(host.querySelector('[aria-busy="true"]')).toBeNull();
    expect(host.textContent).toContain("Company intelligence unavailable"); expect(retry()).toBeDefined();
  });
  it("keeps a ready current workspace visible while canceling its stalled optional reader", async () => {
    await render(); await act(async () => { v2[0].resolve(ready); });
    expect(host.querySelector('[data-current-reader="AAPL"]')).not.toBeNull();
    await expire();
    expect(host.querySelector('[data-current-reader="AAPL"]')).not.toBeNull(); expect(v1[0].signal.aborted).toBe(true);
  });
  it("does not let a late response replace the timeout, and explicit retry recovers", async () => {
    await render(); await expire(); await act(async () => { v2[0].resolve(ready); v1[0].resolve(absent); });
    expect(host.querySelector("[data-current-reader]")).toBeNull(); expect(retry()).toBeDefined();
    await act(async () => { retry()!.click(); });
    expect(v2).toHaveLength(2); expect(v2[1].signal).not.toBe(v2[0].signal);
    await act(async () => { v2[1].resolve(ready); v1[1].resolve(absent); });
    expect(host.querySelector('[data-current-reader="AAPL"]')).not.toBeNull();
  });
  it("starts a new retry even when the wall clock remains identical", async () => {
    vi.spyOn(Date, "now").mockReturnValue(0);
    await render(); await act(async () => { v2[0].resolve(failure); v1[0].resolve(absent); });
    await act(async () => { retry()!.click(); });
    expect(v2).toHaveLength(2); expect(v1).toHaveLength(2);
    expect(edges.v2.mock.calls[1][1].retryNonce).not.toBe(edges.v2.mock.calls[0][1].retryNonce);
  });
  it("cleans up the deadline once both reads have settled", async () => {
    await render(); await act(async () => { v2[0].resolve(ready); v1[0].resolve(absent); });
    expect(vi.getTimerCount()).toBe(0); await expire();
    expect(v2[0].signal.aborted).toBe(false); expect(host.querySelector('[data-current-reader="AAPL"]')).not.toBeNull();
  });
  it("cancels the old symbol and ignores its late result without hiding the new reader", async () => {
    await render(); await render("MSFT"); expect(v2[0].signal.aborted).toBe(true);
    await act(async () => { v2[1].resolve(ready); v1[1].resolve(absent); v2[0].resolve(failure); v1[0].resolve(absent); });
    await expire(); expect(host.querySelector('[data-current-reader="MSFT"]')).not.toBeNull();
  });
  it("cancels outstanding work and its deadline on unmount", async () => {
    await render(); await act(async () => { root!.unmount(); }); root = null;
    expect(v1[0].signal.aborted).toBe(true); expect(v2[0].signal.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });
  it("preserves a nonretryable source error when only the optional reader times out", async () => {
    await render(); await act(async () => { v2[0].resolve({ ok: false, available: false, state: "error", error: { code: "invalid_payload", message: "Source receipt unavailable", retryable: false } }); });
    await expire(); expect(host.textContent).toContain("Source receipt unavailable"); expect(retry()).toBeUndefined();
    expect(host.querySelector("[data-current-reader]")).toBeNull();
  });
  it("bounds the real current reader when HTTP headers arrive but its JSON body stalls", async () => {
    const actual = await vi.importActual<typeof import("@/lib/eventWorkspace")>("@/lib/eventWorkspace");
    edges.v2.mockImplementation(actual.getCurrentEventWorkspace);
    let release!: (value: unknown) => void;
    const fetcher = vi.fn(async () => ({ ok: true, status: 200, json: () => new Promise(resolve => { release = resolve; }) }));
    vi.stubGlobal("fetch", fetcher);
    await render(); await expire();
    expect(host.querySelector('[aria-busy="true"]')).toBeNull(); expect(retry()).toBeDefined();
    await act(async () => { release(ready); });
    expect(host.querySelector("[data-current-reader]")).toBeNull();
  });
  it("bounds the real standard reader's stalled body after verified current coverage is absent", async () => {
    const actual = await vi.importActual<typeof import("@/lib/companyIntelligence")>("@/lib/companyIntelligence");
    edges.v1.mockImplementation(actual.getCompanyIntelligence);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) })));
    await render(); await act(async () => { v2[0].resolve(missing); }); await expire();
    expect(host.querySelector('[aria-busy="true"]')).toBeNull();
    expect(host.textContent).toContain("Company intelligence unavailable"); expect(retry()).toBeDefined();
  });
});
