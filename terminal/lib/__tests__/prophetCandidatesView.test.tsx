// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProphetCandidatesView } from "@/components/prophet/candidates/ProphetCandidatesView";
import { DEFAULT_PROPHET_STATE, type ProphetUrlState } from "@/lib/prophetUrlState";
import { candidateFixture } from "./prophetCandidatesFixture";
vi.mock("next/link", () => ({ default: ({ children, prefetch: _prefetch, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => <a {...props}>{children}</a> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, current: ProphetUrlState;
const patches: Partial<ProphetUrlState>[] = [];
function Harness({ initial }: { initial: Partial<ProphetUrlState> }) {
  const [state, setState] = useState({ ...DEFAULT_PROPHET_STATE, lane: "candidates" as const, ...initial });
  current = state;
  return <ProphetCandidatesView state={state} update={patch => { patches.push(patch); setState(value => ({ ...value, ...patch })); }} />;
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
beforeEach(() => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); patches.length = 0;
  vi.stubGlobal("fetch", vi.fn(async () => json(candidateFixture())));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function render(initial: Partial<ProphetUrlState> = {}) { await act(async () => { root.render(<Harness initial={initial} />); }); }
async function click(element: Element | null) { expect(element).not.toBeNull(); await act(async () => { (element as HTMLButtonElement).click(); }); }
const buttons = () => [...host.querySelectorAll("button")];

describe("native candidate journey", () => {
  it("renders source order, score zero and null separately, with a dated source", async () => {
    await render();
    const rows = [...host.querySelectorAll('[data-testid="candidate-row"]')];
    expect(rows.map(row => row.querySelector("h3")?.textContent?.slice(0, 5))).toEqual(["DEMOA", "DEMOB", "DEMOC", "DEMOD"]);
    expect(rows[1].textContent).toContain("0.0"); expect(rows[2].textContent).toContain("Not scored"); expect(rows[2].textContent).not.toContain("0.0");
    expect(host.querySelector("time")?.dateTime).toBe("2026-11-12");
    expect(host.querySelector("h1")).toBeNull();
  });
  it("opens exact candidate detail and returns to the same filtered list and control", async () => {
    await render({ q: "Technology" });
    expect(host.querySelectorAll('[data-testid="candidate-row"]')).toHaveLength(2);
    await click(host.querySelector('[aria-label="Inspect DEMOC"]'));
    expect(current).toMatchObject({ lane: "candidates", q: "Technology", symbol: "DEMOC", view: "setup" });
    expect(host.querySelector("h2")).toBe(document.activeElement);
    expect(host.querySelector('[data-testid="candidate-detail"]')?.textContent).toContain("Sector display limit reached");
    expect(host.querySelector('a[href="/analysis?symbol=DEMOC&page=intelligence"]')).not.toBeNull();
    await click(buttons().find(button => button.textContent === "All candidates") ?? null);
    expect(current.q).toBe("Technology"); expect(current.symbol).toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Inspect DEMOC");
  });
  it("never turns an absent detail into another candidate or inferred plan", async () => {
    await render({ symbol: "MISSING" });
    expect(host.textContent).toContain("Candidate not in this publication"); expect(host.querySelector('[data-testid="candidate-detail"]')).toBeNull();
    expect(host.querySelector('[data-testid="candidate-row"]')).toBeNull();
  });
  it("preserves complete source counts when search has no matches", async () => {
    await render({ q: "NoSuchIssuer" });
    expect(host.textContent).toContain("No candidates match this search"); expect(host.textContent).toContain("0 of 4 candidates");
    expect(host.textContent).not.toContain("No eligible candidates in this publication");
    await click(buttons().find(button => button.textContent === "Clear search") ?? null);
    expect(host.querySelectorAll('[data-testid="candidate-row"]')).toHaveLength(4);
  });
  it("withdraws an old snapshot after an access refusal on refresh", async () => {
    await render(); expect(host.textContent).toContain("Aster Instruments");
    vi.mocked(fetch).mockResolvedValueOnce(json({ error: "entitlement_required" }, 403));
    await click(buttons().find(button => button.textContent === "Refresh") ?? null);
    expect(host.textContent).toContain("Prophet access required"); expect(host.textContent).not.toContain("Aster Instruments");
    expect(host.querySelector("time")).toBeNull(); expect(host.querySelector("dl")).toBeNull();
  });
  it("shows a verified empty list separately from failed reads", async () => {
    const empty = candidateFixture(); empty.projection.status = "empty"; empty.projection.rows = []; empty.projection.counts = { eligible: 0, in_buy_lane: 0, off_buy_lane: 0, scored: 0, unscored: 0 };
    vi.mocked(fetch).mockResolvedValueOnce(json(empty)); await render();
    expect(host.textContent).toContain("No eligible candidates in this publication"); expect(host.querySelector("time")).not.toBeNull();
    vi.mocked(fetch).mockResolvedValueOnce(json({}, 503)); await click(buttons().find(button => button.textContent === "Refresh") ?? null);
    expect(host.textContent).toContain("Candidate publication unavailable"); expect(host.querySelector("dl")).toBeNull();
  });
  it("settles a stalled read and ignores its eventual late result", async () => {
    vi.useFakeTimers(); let complete!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    await render(); expect(host.textContent).toContain("Reading the candidate publication");
    await act(async () => { await vi.advanceTimersByTimeAsync(12_001); });
    expect(host.textContent).toContain("Candidate publication unavailable");
    await act(async () => { complete(json(candidateFixture())); });
    expect(host.textContent).not.toContain("Aster Instruments");
  });
  it("cancels the private read when the enclosing account lifetime unmounts", async () => {
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(() => {})); await render();
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    await act(async () => { root.render(<div>Account ended</div>); });
    expect(signal?.aborted).toBe(true); expect(host.textContent).toBe("Account ended");
  });
});
