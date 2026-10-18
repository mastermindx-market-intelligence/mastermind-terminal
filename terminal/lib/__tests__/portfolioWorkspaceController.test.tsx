// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import PortfolioView from "@/components/PortfolioView";
import type PortfolioWorkspace from "@/components/PortfolioWorkspace";
import type PositionModal from "@/components/PositionModal";
import type { Position } from "@/lib/portfolio";
import { portfolioBookKey } from "@/lib/portfolioSnapshot.server";
import { computePortfolioRisk } from "@/lib/portfolioRisk";
import { computePortfolioRiskHistory } from "@/lib/portfolioRiskHistory";
import { computePortfolioTargets } from "@/lib/portfolioTargets";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type WorkspaceProps = ComponentProps<typeof PortfolioWorkspace>;
type ModalProps = ComponentProps<typeof PositionModal>;
let view: WorkspaceProps;
let modal: ModalProps | null = null;
vi.mock("@/components/PortfolioWorkspace", () => ({ default: (props: WorkspaceProps) => {
  view = props;
  return <div data-count={props.positions.length}>{props.riskContent}{props.historyContent}{props.targetsContent}</div>;
} }));
vi.mock("@/components/PositionModal", () => ({ default: (props: ModalProps) => { modal = props; return null; } }));
vi.mock("@/components/PortfolioBriefPanel", () => ({ default: () => null }));
vi.mock("@/components/EventImpactPanel", () => ({ default: () => null }));
vi.mock("@/lib/i18n", () => ({ useT: () => (key: string) => key, useLang: () => ({ lang: "en" }) }));
vi.mock("@/lib/dataCache", () => ({ getJSON: async () => ({ symbols: {} }) }));

const base: Position = { id: "record-a", ticker: "NVDA", shares: 10, entryPrice: 100,
  entryCurrency: "USD", entryDate: null, notes: "Original", status: "open", createdAt: null };
const book = (positions: Position[]) => ({ positions, bookKey: portfolioBookKey(positions) });
const risk = (positions: Position[]) => computePortfolioRisk(positions, {}, false);
const history = (positions: Position[]) => computePortfolioRiskHistory(positions, {}, null, null);
const target = (positions: Position[], weight = 30, bandPct = 5) => computePortfolioTargets(positions,
  [{ ticker: "NVDA", targetWeightPct: weight, bandPct, updatedAt: null }]);

type Pending = { body?: Record<string, unknown>; signal?: AbortSignal | null;
  resolve: (body: unknown, status?: number) => void; reject: (cause: unknown) => void };
let reads: { positions: Pending[]; risk: Pending[]; targets: Pending[]; history: Pending[]; writes: Pending[] };
let node: HTMLDivElement;
let root: Root;
const respond = (payload: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status,
  json: async () => payload }) as Response;
const flush = async () => { await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); }); };
async function resolve(pending: Pending, payload: unknown, status = 200) {
  expect(pending).toBeDefined();
  await act(async () => { pending.resolve(payload, status); for (let i = 0; i < 12; i++) await Promise.resolve(); });
}
async function mount(seed: Position[] = []) {
  await act(async () => { root.render(<PortfolioView positions={seed} email="fixture@example.com" />); });
  await flush();
}
async function refresh() { await act(async () => { view.onRetry(); }); await flush(); }
async function ready(positions = [base], weight = 30) {
  await mount(); await resolve(reads.positions[0], book(positions));
  await resolve(reads.risk[0], { ...book(positions), risk: risk(positions) });
  await resolve(reads.targets[0], { bookKey: portfolioBookKey(positions), summary: target(positions, weight) });
}
async function typeInto(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function targetInput() {
  const input = node.querySelector<HTMLInputElement>('input[aria-label="Target weight for NVDA, percent"]');
  if (!input) throw new Error("Missing target input: " + node.textContent?.slice(-500));
  return input;
}

beforeEach(() => {
  vi.useFakeTimers();
  reads = { positions: [], risk: [], targets: [], history: [], writes: [] }; modal = null;
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    if (url.startsWith("/api/quote")) return Promise.resolve(respond({ quotes: {} }));
    const list = init?.method === "POST" ? reads.writes
      : url === "/api/portfolio?view=positions" ? reads.positions
      : url === "/api/portfolio/targets" ? reads.targets
      : url === "/api/portfolio/risk-history" ? reads.history
      : reads.risk;
    return new Promise<Response>((done, reject) => list.push({ body: init?.body ? JSON.parse(String(init.body)) : undefined,
      signal: init?.signal, reject, resolve: (payload, status) => done(respond(payload, status)) }));
  }));
  node = document.createElement("div"); document.body.appendChild(node); root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount()); node.remove(); vi.useRealTimers(); vi.unstubAllGlobals();
});

describe("Portfolio canonical reads and user intent", () => {
  it("publishes holdings without waiting for optional analysis and loads history only on demand", async () => {
    await mount(); await resolve(reads.positions[0], book([base]));
    expect(view.positions).toEqual([base]); expect(view.unreadable).toBe(false);
    expect(reads.risk).toHaveLength(1); expect(reads.targets).toHaveLength(1);
    expect(reads.history).toHaveLength(0);
    await act(async () => view.onSectionChange("holdings")); expect(reads.history).toHaveLength(0);
    await act(async () => view.onSectionChange("risk")); expect(reads.history).toHaveLength(1);
    await act(async () => view.onSectionChange("risk")); expect(reads.history).toHaveLength(1);
    await resolve(reads.risk[0], {}, 503); await resolve(reads.targets[0], {}, 503);
    expect(view.positions).toEqual([base]);
  });

  it("rejects an old generation even when the book key matches, and rejects a wrong current key", async () => {
    await mount(); await resolve(reads.positions[0], book([base]));
    await refresh(); await resolve(reads.positions[1], book([base]));
    await resolve(reads.risk[0], { ...book([base]), risk: risk([base]) });
    await resolve(reads.targets[0], { bookKey: portfolioBookKey([base]), summary: target([base], 80) });
    expect(view.risk).toBeNull(); expect(node.querySelector("input")).toBeNull();
    await resolve(reads.risk[1], { bookKey: portfolioBookKey([]), risk: risk([base]) });
    await resolve(reads.targets[1], { bookKey: portfolioBookKey([]), summary: target([base], 90) });
    expect(view.risk).toBeNull(); expect(node.querySelector("input")).toBeNull();
    await refresh(); await resolve(reads.positions[2], book([base]));
    await resolve(reads.risk[2], { ...book([base]), risk: risk([base]) });
    await resolve(reads.targets[2], { bookKey: portfolioBookKey([base]), summary: target([base], 40) });
    expect(view.risk).toEqual(risk([base])); expect(targetInput().value).toBe("40");
  });

  it("binds lazy history to its read generation and content key", async () => {
    await ready(); await act(async () => view.onSectionChange("risk"));
    await refresh(); await resolve(reads.positions[1], book([base]));
    expect(reads.history).toHaveLength(2);
    await resolve(reads.history[0], { bookKey: portfolioBookKey([base]), history: history([base]) });
    expect(node.querySelector('[data-testid="portfolio-risk-history"]')).toBeNull();
    await resolve(reads.history[1], { bookKey: portfolioBookKey([]), history: history([base]) });
    expect(node.querySelector('[data-testid="portfolio-risk-history"]')).toBeNull();
    await refresh(); await resolve(reads.positions[2], book([base]));
    await resolve(reads.history[2], { bookKey: portfolioBookKey([base]), history: history([base]) });
    expect(node.querySelector('[data-testid="portfolio-risk-history"]')).not.toBeNull();
  });

  it("preserves the last good book after a failed read without presenting old analysis as current", async () => {
    await ready();
    await refresh(); await resolve(reads.positions[1], { positions: null }, 503);
    expect(view.positions).toEqual([base]); expect(view.stale).toBe(true);
    expect(view.unreadable).toBe(false); expect(view.risk).toBeNull();
    expect(node.textContent).toContain("saved target values");
    expect(targetInput().value).toBe("30");
    expect(node.textContent).not.toContain("Add a position with a share count");
    expect(node.textContent).not.toContain("No share count or entry price yet");
  });

  it("preserves target text and focus through book invalidation and canonical readback", async () => {
    await ready(); const input = targetInput(); input.focus(); await typeInto(input, "37");
    const changed = [{ ...base, shares: 15 }];
    await refresh(); await resolve(reads.positions[1], book(changed));
    expect(view.risk).toBeNull(); expect(targetInput()).toBe(input);
    expect(input.value).toBe("37"); expect(document.activeElement).toBe(input);
    expect(node.textContent).toContain("saved target values");
    await resolve(reads.targets[1], { bookKey: portfolioBookKey(changed), summary: target(changed) });
    expect(targetInput()).toBe(input); expect(input.value).toBe("37");
    expect(document.activeElement).toBe(input);
  });

  it("returns a superseded mutation's own readback without overwriting the newer display", async () => {
    await ready(); await act(async () => view.onEdit(base));
    const saved = { ...base, shares: 20 };
    let result: ReturnType<ModalProps["onSubmit"]>;
    await act(async () => { result = modal!.onSubmit({ ticker: "NVDA", shares: "20", entryPrice: "100",
      entryCurrency: "USD", entryDate: "", notes: "Original" }); });
    await resolve(reads.writes[0], { ok: true, position: saved });
    expect(reads.positions).toHaveLength(2);
    await refresh();
    const newer = { ...saved, notes: "Later canonical revision" };
    await resolve(reads.positions[2], book([newer]));
    await resolve(reads.positions[1], book([saved]));
    expect(await result!).toEqual({ ok: true }); expect(view.positions).toEqual([newer]);
    expect(view.failure).toBeNull();
  });

  it("does not confirm HTTP success when its canonical readback contradicts the write receipt", async () => {
    await ready(); await act(async () => view.onEdit(base));
    let result: ReturnType<ModalProps["onSubmit"]>;
    await act(async () => { result = modal!.onSubmit({ ticker: "NVDA", shares: "20", entryPrice: "100",
      entryCurrency: "USD", entryDate: "", notes: "Original" }); });
    await resolve(reads.writes[0], { ok: true, position: { ...base, shares: 20 } });
    await resolve(reads.positions[1], book([base]));
    expect(await result!).toEqual({ ok: false, reason: null }); expect(view.failure).toContain("couldn't confirm");
  });

  it.each([
    [400, "invalid shares", "invalidPositionShares", "valid share count"],
    [409, "position intent conflict", "createConflict", "review the existing record"],
    [500, "invalid shares", null, "couldn't confirm"],
  ] as const)("carries a safe %s refusal into the active editor result", async (status, error, reason, message) => {
    await ready(); await act(async () => view.onAdd());
    let result: ReturnType<ModalProps["onSubmit"]>;
    await act(async () => { result = modal!.onSubmit({ ticker: "NVDA", shares: "3O", entryPrice: "100",
      entryCurrency: "USD", entryDate: "", notes: "Keep this draft" }); });
    await resolve(reads.writes[0], { error }, status);
    expect(await result!).toEqual({ ok: false, reason });
    expect(view.failure).toContain(message);
    expect(reads.positions).toHaveLength(1);
  });

  it("never labels a newer invalid band as saved when an earlier valid target finishes", async () => {
    await ready(); await typeInto(targetInput(), "35");
    await act(async () => { vi.advanceTimersByTime(600); }); await flush();
    const band = node.querySelector<HTMLInputElement>('input[aria-label="Band for NVDA, percentage points"]')!;
    await typeInto(band, "abc");
    await act(async () => { vi.advanceTimersByTime(600); }); await flush();
    expect(reads.writes).toHaveLength(1);
    expect(node.textContent).toContain("Your band has to be a number");
    await resolve(reads.writes[0], { ok: true });
    await resolve(reads.positions[1], book([base]));
    await resolve(reads.targets[1], { bookKey: portfolioBookKey([base]), summary: target([base], 35) });
    expect(band.value).toBe("abc"); expect(targetInput().value).toBe("35");
    expect(node.textContent).toContain("Your band has to be a number");
    expect(node.textContent).not.toContain("Saved");
    await typeInto(band, "7");
    await act(async () => { vi.advanceTimersByTime(600); }); await flush();
    expect(reads.writes).toHaveLength(2);
    expect(reads.writes[1].body).toEqual({ action: "set", ticker: "NVDA", targetWeightPct: 35, bandPct: 7 });
    await resolve(reads.writes[1], { ok: true });
    await resolve(reads.positions[2], book([base]));
    await resolve(reads.targets[2], { bookKey: portfolioBookKey([base]), summary: target([base], 35, 7) });
    expect(band.value).toBe("7"); expect(node.textContent).toContain("Saved");
    expect(node.textContent).not.toContain("Your band has to be a number");
  });

  it("does not carry Saved into a blank untargeted row after a canonical refresh removes the target", async () => {
    await ready(); await typeInto(targetInput(), "35");
    await act(async () => { vi.advanceTimersByTime(600); }); await flush();
    await resolve(reads.writes[0], { ok: true });
    await resolve(reads.positions[1], book([base]));
    await resolve(reads.targets[1], { bookKey: portfolioBookKey([base]), summary: target([base], 35) });
    expect(targetInput().value).toBe("35"); expect(node.textContent).toContain("Saved");

    // Another client cleared the target. This canonical refresh does not pass
    // through the local Clear callback that normally resets the save flash.
    await refresh(); await resolve(reads.positions[2], book([base]));
    await resolve(reads.targets[2], {
      bookKey: portfolioBookKey([base]), summary: computePortfolioTargets([base], []),
    });
    const row = node.querySelector('[data-ticker="NVDA"][data-status="untargeted"]');
    expect(row).not.toBeNull();
    expect(targetInput().value).toBe("");
    expect(node.querySelector<HTMLInputElement>('input[aria-label="Band for NVDA, percentage points"]')?.value).toBe("5");
    expect(row?.textContent).not.toContain("Saved");
    expect(reads.writes).toHaveLength(1);
  });

  it("does not label a newer invalid first-target draft as saved after an independent confirmation", async () => {
    await mount(); await resolve(reads.positions[0], book([base]));
    await resolve(reads.targets[0], {
      bookKey: portfolioBookKey([base]), summary: computePortfolioTargets([base], []),
    });
    const input = targetInput(); await typeInto(input, "35");
    await act(async () => { vi.advanceTimersByTime(600); }); await flush();
    await resolve(reads.writes[0], { ok: true });

    // The newer display still has no target. The superseded write must use its
    // own readback for confirmation without replacing that displayed summary.
    await refresh(); await resolve(reads.positions[2], book([base]));
    await resolve(reads.targets[1], {
      bookKey: portfolioBookKey([base]), summary: computePortfolioTargets([base], []),
    });
    await resolve(reads.positions[1], book([base]));
    expect(reads.targets).toHaveLength(3);
    await resolve(reads.targets[2], { bookKey: portfolioBookKey([base]), summary: target([base], 35) });
    expect(node.querySelector('[data-ticker="NVDA"][data-status="untargeted"]')).not.toBeNull();
    expect(targetInput()).toBe(input); expect(input.value).toBe("35"); expect(input.disabled).toBe(false);

    const band = node.querySelector<HTMLInputElement>('input[aria-label="Band for NVDA, percentage points"]')!;
    await typeInto(band, "abc");
    await act(async () => { vi.advanceTimersByTime(600); }); await flush();
    expect(band.value).toBe("abc"); expect(input.value).toBe("35");
    expect(node.textContent).toContain("Your band has to be a number");
    expect(node.textContent).not.toContain("Saved");
    expect(node.textContent).not.toContain("Saving target");
    expect(reads.writes).toHaveLength(1);
  });

  it("keeps target confirmation failure uncertain after a successful POST", async () => {
    await ready(); await typeInto(targetInput(), "35");
    await act(async () => { vi.advanceTimersByTime(600); }); await flush();
    await resolve(reads.writes[0], { ok: true });
    await resolve(reads.positions[1], book([base]));
    await resolve(reads.targets[1], { error: "unavailable" }, 503);
    expect(node.textContent).toContain("We couldn't confirm this change");
    expect(node.textContent).not.toContain("was not changed");
    expect(node.textContent).not.toContain("Saved");
  });

  it("keeps a newer target edit pending while an earlier save completes", async () => {
    await ready(); const input = targetInput();
    await typeInto(input, "35");
    await act(async () => { vi.advanceTimersByTime(1000); }); await flush();
    expect(reads.writes[0].body?.targetWeightPct).toBe(35);
    await typeInto(input, "42");
    await act(async () => { vi.advanceTimersByTime(1000); }); await flush();
    expect(reads.writes).toHaveLength(1); // The canonical writer still serializes both intents.
    await resolve(reads.writes[0], { ok: true });
    await resolve(reads.positions[1], book([base]));
    await resolve(reads.targets[1], { bookKey: portfolioBookKey([base]), summary: target([base], 35) });
    await flush();
    expect(input.value).toBe("42"); expect(reads.writes).toHaveLength(2);
    expect(node.textContent).not.toMatch(/Clear targetSaved/);
    expect(node.textContent).toContain("Saving target");
    expect(reads.writes[1].body?.targetWeightPct).toBe(42);
    await resolve(reads.writes[1], { ok: true });
    await resolve(reads.positions[2], book([base]));
    await resolve(reads.targets[2], { bookKey: portfolioBookKey([base]), summary: target([base], 42) });
    expect(input.value).toBe("42"); expect(node.textContent).toContain("Saved");
  });
  it("confirms a target canceled by a display refresh without restoring the old computed weights", async () => {
    await ready(); await typeInto(targetInput(), "35");
    await act(async () => { vi.advanceTimersByTime(1000); }); await flush();
    await resolve(reads.writes[0], { ok: true });
    await resolve(reads.positions[1], book([base])); // The write's target confirmation is now in flight.
    expect(reads.targets).toHaveLength(2);
    const changed = [base, { ...base, id: "record-b", ticker: "AAPL" }];
    await refresh();
    expect(reads.targets[1].signal?.aborted).toBe(true);
    await resolve(reads.positions[2], book(changed));
    await resolve(reads.targets[2], { bookKey: portfolioBookKey(changed), summary: target(changed, 35) });
    await act(async () => reads.targets[1].reject(new DOMException("Aborted", "AbortError")));
    await flush(); expect(reads.targets).toHaveLength(4);
    // This independent receipt is from the write's older book. It may confirm the
    // stored 35% intent, but its 100% current weight must not overwrite the new 50%.
    await resolve(reads.targets[3], { bookKey: portfolioBookKey([base]), summary: target([base], 35) });
    expect(view.positions).toEqual(changed);
    const card = node.querySelector('[data-ticker="NVDA"][data-status="outside_band"]');
    expect(card?.textContent).toContain("50%");
    expect(card?.textContent).not.toContain("100%");
    expect(targetInput().value).toBe("35"); expect(node.textContent).toContain("Saved");
    expect(node.textContent).not.toContain("Saving target");
  });

  it("preserves a failed first target draft and allows the corrected retry", async () => {
    await mount(); await resolve(reads.positions[0], book([base]));
    await resolve(reads.targets[0], { bookKey: portfolioBookKey([base]), summary: computePortfolioTargets([base], []) });
    const input = targetInput(); await typeInto(input, "37");
    await act(async () => { vi.advanceTimersByTime(1000); }); await flush();
    expect(input.disabled).toBe(true);
    await resolve(reads.writes[0], { error: "save failed" }, 503);
    expect(input.value).toBe("37"); expect(input.disabled).toBe(false);
    expect(node.textContent).not.toContain("Saved");
    await typeInto(input, "38");
    await act(async () => { vi.advanceTimersByTime(1000); }); await flush();
    expect(reads.writes[1].body?.targetWeightPct).toBe(38);
    await resolve(reads.writes[1], { ok: true });
    await resolve(reads.positions[1], book([base]));
    await resolve(reads.targets[1], { bookKey: portfolioBookKey([base]), summary: target([base], 38) });
    expect(targetInput().value).toBe("38"); expect(node.textContent).toContain("Saved");
  });

});
