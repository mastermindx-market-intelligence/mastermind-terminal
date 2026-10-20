// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode, act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import PortfolioView from "@/components/PortfolioView";
import type PortfolioWorkspace from "@/components/PortfolioWorkspace";
import type PositionModal from "@/components/PositionModal";
import type { Position } from "@/lib/portfolio";
import { portfolioBookKey } from "@/lib/portfolioSnapshot.server";
import { computePortfolioRisk } from "@/lib/portfolioRisk";
import { computePortfolioRiskHistory } from "@/lib/portfolioRiskHistory";
import { computePortfolioTargets } from "@/lib/portfolioTargets";
import { nativePrice } from "@/lib/portfolioMoney";
import { recordIssues } from "@/lib/portfolioWorkspace";

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
// The nightly manifest is the fallback price source; each quote case configures it before mount.
const manifestFixture = vi.hoisted(() => ({
  symbols: {} as Record<string, { name?: string; last?: number; chg?: number; currency?: unknown }>,
  // One toggled visibility getter for the whole suite (jsdom's default is unspecified).
  hidden: false,
}));
vi.mock("@/lib/dataCache", () => ({ getJSON: async () => ({ symbols: manifestFixture.symbols }) }));

const base: Position = { id: "record-a", ticker: "NVDA", shares: 10, entryPrice: 100,
  entryCurrency: "USD", entryDate: null, notes: "Original", status: "open", createdAt: null };
// Two accounts that hold the SAME eligible ticker: a route would accept a foreign write for it,
// so only the client owner fence can stop one (owner-fence contract, focused-proof item 4).
const bookA: Position[] = [base];
const recordB: Position = { ...base, id: "record-b", notes: "Owner B record" };
const bookB: Position[] = [recordB];

type OwnerTag = "A" | "B";
/** Immutable per-account identity ids. The email prop stays the same for A and B on purpose:
 *  ownership is the id, never the address. */
const identityOf = (owner: OwnerTag) => (owner === "A" ? "owner-a-user" : "owner-b-user");
let currentOwner: string = identityOf("A");

const book = (positions: Position[]) => ({ positions, bookKey: portfolioBookKey(positions) });
const risk = (positions: Position[]) => computePortfolioRisk(positions, {}, false);
const history = (positions: Position[]) => computePortfolioRiskHistory(positions, {}, null, null);
const target = (positions: Position[], weight = 30, bandPct = 5) => computePortfolioTargets(positions,
  [{ ticker: "NVDA", targetWeightPct: weight, bandPct, updatedAt: null }]);

type Pending = { url: string; method: "GET" | "POST"; owner: string;
  body?: Record<string, unknown>; signal?: AbortSignal | null;
  resolve: (body: unknown, status?: number) => void; reject: (cause: unknown) => void;
  /** Settle the fetch with a response whose body stays pending until `releaseBody`. */
  hold: (status?: number) => void; releaseBody: (body: unknown) => void };
let reads: { positions: Pending[]; risk: Pending[]; targets: Pending[]; history: Pending[];
  quotes: (Pending & { symbols: string[] })[]; writes: Pending[] };
let node: HTMLDivElement;
let root: Root;
const respond = (payload: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status,
  json: async () => payload }) as Response;
const flush = async () => { await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); }); };
async function resolve(pending: Pending, payload: unknown, status = 200) {
  expect(pending).toBeDefined();
  await act(async () => { pending.resolve(payload, status); for (let i = 0; i < 12; i++) await Promise.resolve(); });
}
/** Settle the fetch only; the body stays pending until releaseBody (owner-fence item 6). */
async function resolveHeld(pending: Pending, status = 200) {
  expect(pending).toBeDefined();
  await act(async () => { pending.hold(status); for (let i = 0; i < 12; i++) await Promise.resolve(); });
}
async function releaseBody(pending: Pending, payload: unknown) {
  expect(pending).toBeDefined();
  await act(async () => { pending.releaseBody(payload); for (let i = 0; i < 12; i++) await Promise.resolve(); });
}
async function mount(seed: Position[] = [], owner: OwnerTag = "A", strict = false) {
  currentOwner = identityOf(owner);
  const page = <PortfolioView positions={seed} email="fixture@example.com" userId={identityOf(owner)} />;
  await act(async () => { root.render(strict ? <StrictMode>{page}</StrictMode> : page); });
  await flush();
}
/** Rerender the SAME root as another account with its own seed (owner-fence item 2). */
async function switchOwner(owner: OwnerTag, seed: Position[]) {
  currentOwner = identityOf(owner);
  await act(async () => {
    root.render(<PortfolioView positions={seed} email="fixture@example.com" userId={identityOf(owner)} />);
  });
  await flush();
}
/** Advance to the next quote poll and hold it: the request is recorded but unanswered. */
async function holdQuote(advanceMs = 6000): Promise<Pending & { symbols: string[] }> {
  const index = reads.quotes.length;
  await act(async () => { vi.advanceTimersByTime(advanceMs); });
  await flush();
  expect(reads.quotes).toHaveLength(index + 1);
  return reads.quotes[index];
}
/** Advance to the next quote poll and answer it (first poll of a life is at 200 ms). */
async function pollQuote(payload: Record<string, { last?: number; chg?: number; currency?: string } | null>,
  advanceMs = 6000) {
  const request = await holdQuote(advanceMs);
  await resolve(request, { quotes: payload });
  return request;
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
  currentOwner = identityOf("A");
  reads = { positions: [], risk: [], targets: [], history: [], quotes: [], writes: [] }; modal = null;
  manifestFixture.symbols = {};
  manifestFixture.hidden = false;
  // Polls must actually run in jsdom; the spy is restored in afterEach (quote-expiry harness).
  vi.spyOn(document, "hidden", "get").mockImplementation(() => manifestFixture.hidden);
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) =>
    new Promise<Response>((done, reject) => {
      let releaseBody!: (payload: unknown) => void;
      const bodyGate = new Promise<unknown>((doneBody) => { releaseBody = doneBody; });
      const hold = (status = 200) => done({
        ok: status >= 200 && status < 300, status, json: async () => bodyGate,
      } as unknown as Response);
      const list = init?.method === "POST" ? reads.writes
        : url.startsWith("/api/quote") ? reads.quotes
        : url === "/api/portfolio?view=positions" ? reads.positions
        : url === "/api/portfolio/targets" ? reads.targets
        : url === "/api/portfolio/risk-history" ? reads.history
        : reads.risk;
      // The synthetic session owner is stamped AT FETCH ARRIVAL and never retroactively changed
      // when the test switches owners (owner-fence focused-proof item 1).
      const pending: Pending = { url, method: init?.method === "POST" ? "POST" : "GET", owner: currentOwner,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        signal: init?.signal, reject, resolve: (payload, status) => done(respond(payload, status)),
        hold, releaseBody };
      if (url.startsWith("/api/quote")) {
        (pending as Pending & { symbols: string[] }).symbols =
          (new URL(url, "https://fixture.test").searchParams.get("syms") ?? "").split(",").filter(Boolean);
      }
      list.push(pending as never);
    })));
  node = document.createElement("div"); document.body.appendChild(node); root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount()); node.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
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

  it.each([
    ["update", "position update failed"],
    ["delete", "position delete failed"],
  ] as const)("keeps a server-error %s refusal uncertain instead of claiming the position is gone", async (action, error) => {
    await ready();
    if (action === "update") {
      await act(async () => view.onEdit(base));
      let result: ReturnType<ModalProps["onSubmit"]>;
      await act(async () => { result = modal!.onSubmit({ ticker: "NVDA", shares: "20", entryPrice: "100",
        entryCurrency: "USD", entryDate: "", notes: "Original" }); });
      await resolve(reads.writes[0], { ok: false, error }, 500);
      expect(await result!).toEqual({ ok: false, reason: null });
      // The editor stays open with its draft; dismissal requires result.ok.
      expect(modal).not.toBeNull();
    } else {
      await act(async () => view.onDeleteRequest(base));
      await act(async () => view.onDeleteConfirm(base));
      await resolve(reads.writes[0], { ok: false, error }, 500);
      await flush();
    }
    expect(reads.writes[0].body).toMatchObject({ action, id: base.id });
    // Generic uncertainty, never the "no longer available" absence claim.
    expect(view.failure).toContain("couldn't confirm");
    expect(view.failure).not.toContain("no longer available");
    // The row and its open delete confirmation survive the failed write: no reload removed them.
    expect(view.positions).toEqual([base]);
    expect(reads.positions).toHaveLength(1);
    if (action === "delete") expect(view.confirmDelete).toBe(base.id);
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
    expect(reads.writes[1].body).toEqual({ action: "set", ticker: "NVDA", targetWeightPct: 35, bandPct: 7,
      expectedOwnerId: identityOf("A") });
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

  // C4 target-draft regression: an edit typed back to the previous canonical value while an
  // older save/readback is still settling must survive that readback — value equality cannot
  // tell it from an untouched field — and a later cross-field edit must save the preserved
  // pair, with Saved appearing only on the newer pair's own confirmed readback.
  it.each([
    ["target", 35, 5, 30, 7],
    ["band", 30, 7, 35, 5],
  ] as const)(
    "preserves a debouncing return-to-original %s through older confirmation",
    async (field, sentWeight, sentBand, nextWeight, nextBand) => {
      await ready();
      const input = targetInput();
      const band = node.querySelector<HTMLInputElement>(
        'input[aria-label="Band for NVDA, percentage points"]',
      )!;
      const edited = field === "target" ? input : band;
      const other = field === "target" ? band : input;

      expect(input.value).toBe("30"); expect(band.value).toBe("5");
      await typeInto(edited, String(field === "target" ? sentWeight : sentBand));
      await act(async () => { vi.advanceTimersByTime(500); }); await flush();
      expect(reads.writes).toHaveLength(1);
      expect(reads.writes[0].body).toEqual({
        action: "set", ticker: "NVDA", targetWeightPct: sentWeight, bandPct: sentBand,
        expectedOwnerId: identityOf("A"),
      });

      // Newer than the POST, but still inside its debounce.
      await typeInto(edited, field === "target" ? "30" : "5");
      await act(async () => { vi.advanceTimersByTime(100); }); await flush();
      expect(reads.writes).toHaveLength(1);

      // Complete older canonical confirmation without advancing time.
      await resolve(reads.writes[0], { ok: true });
      await resolve(reads.positions[1], book([base]));
      await resolve(reads.targets[1], {
        bookKey: portfolioBookKey([base]), summary: target([base], sentWeight, sentBand),
      });
      await flush();
      expect(targetInput()).toBe(input);
      expect(input.value).toBe("30"); expect(band.value).toBe("5");
      expect(node.textContent).not.toContain("Saved");
      expect(reads.writes).toHaveLength(1);

      // Cross-field edit must capture the preserved return-to-original value.
      await typeInto(other, String(field === "target" ? nextBand : nextWeight));
      expect(node.textContent).not.toContain("Saved");
      await act(async () => { vi.advanceTimersByTime(499); }); await flush();
      expect(reads.writes).toHaveLength(1);
      expect(node.textContent).not.toContain("Saved");
      await act(async () => { vi.advanceTimersByTime(1); }); await flush();
      expect(reads.writes).toHaveLength(2);
      expect(reads.writes[1].body).toEqual({
        action: "set", ticker: "NVDA", targetWeightPct: nextWeight, bandPct: nextBand,
        expectedOwnerId: identityOf("A"),
      });
      expect(node.textContent).not.toContain("Saved");

      // HTTP success or holdings alone cannot confirm this target pair.
      await resolve(reads.writes[1], { ok: true });
      expect(node.textContent).not.toContain("Saved");
      await resolve(reads.positions[2], book([base]));
      expect(node.textContent).not.toContain("Saved");
      await resolve(reads.targets[2], {
        bookKey: portfolioBookKey([base]), summary: target([base], nextWeight, nextBand),
      });
      await flush();
      expect(input.value).toBe(String(nextWeight));
      expect(band.value).toBe(String(nextBand));
      expect(node.textContent).toContain("Saved");
      expect(node.textContent).not.toContain("Saving target");
      expect(reads.writes).toHaveLength(2);
    },
  );

  it("still synchronizes untouched target and band fields from canonical refresh", async () => {
    await ready();
    const input = targetInput();
    const band = node.querySelector<HTMLInputElement>(
      'input[aria-label="Band for NVDA, percentage points"]',
    )!;
    await refresh();
    await resolve(reads.positions[1], book([base]));
    await resolve(reads.targets[1], {
      bookKey: portfolioBookKey([base]), summary: target([base], 40, 8),
    });
    expect(targetInput()).toBe(input);
    expect(input.value).toBe("40"); expect(band.value).toBe("8");
    expect(reads.writes).toHaveLength(0);
    expect(node.textContent).not.toContain("Saved");
  });

  it("keeps a newer draft and its schedule intact when a superseded save is refused late, and a post-unmount resolution is a safe no-op", async () => {
    await ready();
    const input = targetInput();
    await typeInto(input, "35");
    await act(async () => { vi.advanceTimersByTime(500); }); await flush();
    expect(reads.writes).toHaveLength(1);
    // The user's newer intent returns to the original while 35 is still in flight.
    await typeInto(input, "30");
    await resolve(reads.writes[0], { error: "save failed" }, 503);
    await flush();
    // The late refusal belongs to a superseded write: it must not restore old values, flash an
    // error over the newer draft, or unschedule the newer return-to-original save.
    expect(input.value).toBe("30");
    expect(node.textContent).not.toContain("Saved");
    expect(reads.writes).toHaveLength(1);
    await act(async () => { vi.advanceTimersByTime(500); }); await flush();
    expect(reads.writes[1].body).toEqual({ action: "set", ticker: "NVDA", targetWeightPct: 30, bandPct: 5,
      expectedOwnerId: identityOf("A") });
    // Closed state: resolutions arriving after unmount must be a safe no-op, not a crash.
    act(() => root.unmount());
    await resolve(reads.writes[1], { ok: true });
    if (reads.positions[2]) await resolve(reads.positions[2], book([base]));
    if (reads.targets[2]) await resolve(reads.targets[2], {
      bookKey: portfolioBookKey([base]), summary: target([base], 30, 5),
    });
    await flush();
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

/** Resolve the NEWEST pending canonical read and its optional analyses. Owner-switch scenarios
 *  leave superseded reads pending on purpose; reads are issued serially, so "newest pending" is
 *  always the read that belongs to the account being settled. */
async function settleLatestRead(positions: Position[], weight = 30) {
  const pending = reads.positions[reads.positions.length - 1];
  expect(pending).toBeDefined();
  await resolve(pending, book(positions));
  if (reads.risk[reads.risk.length - 1]) {
    await resolve(reads.risk[reads.risk.length - 1], { ...book(positions), risk: risk(positions) });
  }
  if (reads.targets[reads.targets.length - 1]) {
    await resolve(reads.targets[reads.targets.length - 1], { bookKey: portfolioBookKey(positions), summary: target(positions, weight) });
  }
}

// ── owner-generation fence (Terminal #1044 findings 6257618084 / 6257767153 /
//    6258253345) ─────────────────────────────────────────────────────────────
// The page keeps ONE root; A and B are rerendered into it with their own immutable identity and
// seed, sharing one email on purpose: ownership is the id, never the address. Every recorded
// request carries the synthetic session owner stamped at fetch arrival.
describe("Portfolio owner-generation fence", () => {
  it("never dispatches an intent queued behind a held write when the account changes (A→B)", async () => {
    await ready(bookA);
    await typeInto(targetInput(), "35");
    await act(async () => { vi.advanceTimersByTime(600); }); await flush();
    expect(reads.writes).toHaveLength(1);                      // A's set, held in flight
    await typeInto(targetInput(), "40");                       // A queues a second intent behind it
    await act(async () => { vi.advanceTimersByTime(600); }); await flush();
    expect(reads.writes).toHaveLength(1);                      // serialized behind the predecessor
    const readsBefore = reads.positions.length;
    await switchOwner("B", bookB);
    await settleLatestRead(bookB);
    await resolve(reads.writes[0], { ok: true }); await flush();
    // The held write's canonical readback never starts under B — the retired completion must not
    // call the shared reload() into the new session.
    expect(reads.positions).toHaveLength(readsBefore + 1);
    // The queued "40" intent was never dispatched.
    expect(reads.writes).toHaveLength(1);
    expect(view.failure).toBeNull();
    expect(targetInput().value).toBe("30");                    // B's own stored target, untouched
    // The chain still serves B's own writes after the retired ones settle.
    await typeInto(targetInput(), "45");
    await act(async () => { vi.advanceTimersByTime(600); }); await flush();
    expect(reads.writes).toHaveLength(2);
    expect(reads.writes[1].owner).toBe(identityOf("B"));
    expect(reads.writes[1].body).toMatchObject({ action: "set", ticker: "NVDA", targetWeightPct: 45 });
  });

  it("a target write held at its canonical readback cannot confirm, fall back, or paint under B", async () => {
    await ready(bookA);
    await typeInto(targetInput(), "35");
    await act(async () => { vi.advanceTimersByTime(600); }); await flush();
    await resolve(reads.writes[0], { ok: true });              // POST sent under A; readback starts
    expect(reads.positions).toHaveLength(2);
    const readback = reads.positions[1];
    await switchOwner("B", bookB);
    await settleLatestRead(bookB);
    const targetReadsBefore = reads.targets.length;            // B's own display read included
    await resolve(readback, book(bookA)); await flush();       // A's readback lands under B
    expect(view.positions).toEqual(bookB);                     // B's book still painted
    expect(view.failure).toBeNull();                           // no old outcome painted
    expect(node.textContent).not.toContain("Saved");           // no old confirmation
    expect(reads.writes).toHaveLength(1);
    // The superseded-read fallback target GET is fenced before it starts.
    expect(reads.targets).toHaveLength(targetReadsBefore);
  });

  it("A→B→A never revives the queued intent captured under the first A", async () => {
    await ready(bookA);
    await typeInto(targetInput(), "35");
    await act(async () => { vi.advanceTimersByTime(600); }); await flush();
    expect(reads.writes[0].owner).toBe(identityOf("A"));
    await typeInto(targetInput(), "40");
    await act(async () => { vi.advanceTimersByTime(600); }); await flush();
    await switchOwner("B", bookB);                             // generation advances
    await settleLatestRead(bookB);
    await switchOwner("A", bookA);                             // and again — the owner string matches
    await settleLatestRead(bookA);                             // but A's intent is two generations old
    const readsBefore = reads.positions.length;
    await resolve(reads.writes[0], { ok: true }); await flush();
    expect(reads.writes).toHaveLength(1);                      // the "40" never dispatches
    expect(reads.positions).toHaveLength(readsBefore);         // and its readback never starts
    expect(view.failure).toBeNull();
    // A fresh returned-A intent still executes once the chain settles.
    await typeInto(targetInput(), "42");
    await act(async () => { vi.advanceTimersByTime(600); }); await flush();
    expect(reads.writes).toHaveLength(2);
    expect(reads.writes[1].owner).toBe(identityOf("A"));
    expect(reads.writes[1].body).toMatchObject({ targetWeightPct: 42 });
    await resolve(reads.writes[1], { ok: true });
    await settleLatestRead(bookA, 42);
    expect(targetInput().value).toBe("42");
    expect(node.textContent).toContain("Saved");
  });

  it("a POST whose body settles after the transition returns uncertain and never reads back", async () => {
    await ready(bookA);
    await act(async () => view.onEdit(base));
    let result: ReturnType<ModalProps["onSubmit"]>;
    await act(async () => { result = modal!.onSubmit({ ticker: "NVDA", shares: "20", entryPrice: "100",
      entryCurrency: "USD", entryDate: "", notes: "Original" }); });
    expect(reads.writes).toHaveLength(1);
    await resolveHeld(reads.writes[0], 200);                   // fetch ok; body held
    const readsBefore = reads.positions.length;
    await switchOwner("B", bookB);
    await settleLatestRead(bookB);
    await releaseBody(reads.writes[0], { ok: true, position: { ...base, shares: 20 } });
    // Sent-but-unconfirmable, discriminated internally from never-dispatched; never "success".
    expect(await result!).toEqual({ ok: false, reason: null, retired: "sent-uncertain" });
    expect(view.failure).toBeNull();                           // and never painted into B
    expect(reads.positions).toHaveLength(readsBefore + 1);     // no A readback under B
    expect(view.positions).toEqual(bookB);
    expect(reads.writes).toHaveLength(1);
  });

  it("a readback body held across the transition cannot confirm through the fallback read", async () => {
    await ready(bookA);
    await typeInto(targetInput(), "35");
    await act(async () => { vi.advanceTimersByTime(600); }); await flush();
    await resolve(reads.writes[0], { ok: true });              // sent; its readback GET is in flight
    await resolveHeld(reads.positions[1], 200);                // hold the readback BODY
    await switchOwner("B", bookB);
    await settleLatestRead(bookB);
    const targetReadsBefore = reads.targets.length;            // B's own display read included
    await releaseBody(reads.positions[1], book(bookA));
    await flush();
    expect(view.positions).toEqual(bookB);
    expect(view.failure).toBeNull();
    expect(node.textContent).not.toContain("Saved");
    // The owner-fenced fallback readTargetsForBook(null) never ran.
    expect(reads.targets).toHaveLength(targetReadsBefore);
  });

  it("an unmounted instance never dispatches its queued intent; a sent one stays sent exactly once", async () => {
    await ready(bookA);
    await typeInto(targetInput(), "35");
    await act(async () => { vi.advanceTimersByTime(600); }); await flush();
    await typeInto(targetInput(), "40");                       // queued, not yet sent
    await act(async () => { vi.advanceTimersByTime(600); }); await flush();
    expect(reads.writes).toHaveLength(1);
    await act(async () => { root.render(null); }); await flush();   // the page instance is gone
    await switchOwner("B", bookB);                             // a NEW B instance mounts
    await settleLatestRead(bookB);
    await resolve(reads.writes[0], { ok: true }); await flush();
    expect(reads.writes).toHaveLength(1);                      // no obsolete dispatch, ever
    expect(reads.positions).toHaveLength(2);
    // The new instance writes normally.
    await typeInto(targetInput(), "45");
    await act(async () => { vi.advanceTimersByTime(600); }); await flush();
    expect(reads.writes).toHaveLength(2);
    expect(reads.writes[1].owner).toBe(identityOf("B"));
  });

  it("a StrictMode replacement cannot revive a retired token; the sent POST count stays one", async () => {
    await mount(bookA, "A", true);                             // setup → cleanup → setup
    await settleLatestRead(bookA);                             // the second setup's read is newest
    await typeInto(targetInput(), "35");
    await act(async () => { vi.advanceTimersByTime(600); }); await flush();
    await typeInto(targetInput(), "40");
    await act(async () => { vi.advanceTimersByTime(600); }); await flush();
    expect(reads.writes).toHaveLength(1);
    await act(async () => { root.render(null); }); await flush();
    await switchOwner("B", bookB);
    await settleLatestRead(bookB);
    await resolve(reads.writes[0], { ok: true }); await flush();
    expect(reads.writes).toHaveLength(1);
    expect(view.failure).toBeNull();
    await typeInto(targetInput(), "45");
    await act(async () => { vi.advanceTimersByTime(600); }); await flush();
    expect(reads.writes).toHaveLength(2);
    expect(reads.writes[1].owner).toBe(identityOf("B"));
  });

  it("same-owner email changes keep legitimate writes flowing, and a refused write does not wedge the fence", async () => {
    await mount(bookA);                                        // seed bookA, so the rerender below
    await settleLatestRead(bookA);                             // is presentation-only, not a seed change
    await act(async () => {
      root.render(<PortfolioView positions={bookA} email="renamed@example.com" userId={identityOf("A")} />);
    });
    await flush();
    await typeInto(targetInput(), "35");
    await act(async () => { vi.advanceTimersByTime(600); }); await flush();
    expect(reads.writes).toHaveLength(1);                      // presentation change wrote nothing off
    await resolve(reads.writes[0], { error: "save failed" }, 503);
    expect(node.textContent).toContain("couldn't confirm");    // honest uncertain refusal
    await typeInto(targetInput(), "36");
    await act(async () => { vi.advanceTimersByTime(600); }); await flush();
    expect(reads.writes).toHaveLength(2);                      // the chain was not wedged
    expect(reads.writes[1].body).toMatchObject({ targetWeightPct: 36 });
    await resolve(reads.writes[1], { ok: true });
    await settleLatestRead(bookA, 36);
    expect(targetInput().value).toBe("36");
    expect(node.textContent).toContain("Saved");
  });
});

// ── quote continuity and explicit-null expiry (findings 6257929672 /
//    6258114833, composition 6258253345) ─────────────────────────────────────
describe("Portfolio quote continuity across owners", () => {
  it("retires an in-flight previous-owner poll with identical tickers; a late A good changes nothing", async () => {
    manifestFixture.symbols = { NVDA: { last: 100, chg: 0, currency: "USD" } };
    await mount(bookA);
    const heldA = await holdQuote(200);                        // A's poll, held in flight
    await switchOwner("B", bookB);                             // same ticker, new owner epoch
    await pollQuote({ NVDA: { last: 110, chg: 10, currency: "USD" } }, 200);
    expect(view.quotes.NVDA).toMatchObject({ last: 110 });
    await pollQuote({ NVDA: null });
    await pollQuote({ NVDA: null });
    const beforeLate = view.quotes;
    expect(view.quotes.NVDA).toBeDefined();                    // grace not exhausted
    await resolve(heldA, { quotes: { NVDA: { last: 999, chg: 99, currency: "USD" } } });
    expect(view.quotes).toBe(beforeLate);                      // late A good: no refill, no reset
    await pollQuote({ NVDA: null });                           // B's OWN third miss expires
    expect(view.quotes.NVDA).toBeUndefined();
    expect(view.totals).toMatchObject({ marketValue: 1000, marketValueCurrency: "USD", dayChange: 0, valued: 1 });
  });

  it("A→B→A: the old quote poll and the old queued write are both dead in returned A", async () => {
    await ready(bookA);
    await typeInto(targetInput(), "35");
    await act(async () => { vi.advanceTimersByTime(600); }); await flush();
    // The debounce advance also consumed the poll's first 200 ms timer: A's first poll is
    // already in flight and held.
    expect(reads.quotes).toHaveLength(1);
    const heldA = reads.quotes[0];
    expect(heldA.owner).toBe(identityOf("A"));
    await switchOwner("B", bookB);
    await settleLatestRead(bookB);
    await pollQuote({ NVDA: { last: 110, chg: 10, currency: "USD" } }, 200);
    await switchOwner("A", bookA);
    await settleLatestRead(bookA);
    await pollQuote({ NVDA: { last: 120, chg: 0, currency: "USD" } }, 200);
    const settled = view.quotes;
    await resolve(heldA, { quotes: { NVDA: { last: 999, chg: 99, currency: "USD" } } });
    expect(view.quotes).toBe(settled);                         // first-A poll: dead
    const readsBefore = reads.positions.length;
    await resolve(reads.writes[0], { ok: true }); await flush();
    expect(reads.writes).toHaveLength(1);                       // first-A write: dead
    expect(reads.positions).toHaveLength(readsBefore);          // no old readback in returned A
    expect(view.failure).toBeNull();
    await typeInto(targetInput(), "42");                        // returned-A work still runs
    await act(async () => { vi.advanceTimersByTime(600); }); await flush();
    expect(reads.writes).toHaveLength(2);
    expect(reads.writes[1].owner).toBe(identityOf("A"));
  });

  it("a quote body settling after the transition neither refills nor advances the new miss count", async () => {
    await mount(bookA);
    const heldA = await holdQuote(200);
    await resolveHeld(heldA, 200);                             // fetch ok; body held
    await switchOwner("B", bookB);
    await pollQuote({ NVDA: { last: 110, chg: 10, currency: "USD" } }, 200);
    await releaseBody(heldA, { quotes: { NVDA: null } });      // stale body: a null "observation"
    expect(view.quotes.NVDA).toMatchObject({ last: 110 });     // B's good quote survives
    await pollQuote({ NVDA: null });
    await pollQuote({ NVDA: null });
    expect(view.quotes.NVDA).toBeDefined();                    // stale null never counted
    await pollQuote({ NVDA: null });
    expect(view.quotes.NVDA).toBeUndefined();                  // exactly three OWN misses expire
  });

  it("same-owner seed and email changes keep miss-count continuity; the fallback reprices the new book", async () => {
    manifestFixture.symbols = { NVDA: { last: 100, chg: 0, currency: "USD" } };
    await mount(bookA);
    await pollQuote({ NVDA: { last: 110, chg: 10, currency: "USD" } }, 200);
    await pollQuote({ NVDA: null });
    await pollQuote({ NVDA: null });
    await act(async () => {
      root.render(<PortfolioView positions={[{ ...base, shares: 12 }]} email="renamed@example.com"
        userId={identityOf("A")} />);
    });
    await flush();
    await pollQuote({ NVDA: null });                           // third consecutive miss across the refresh
    expect(view.quotes.NVDA).toBeUndefined();
    expect(view.totals).toMatchObject({ marketValue: 1200, marketValueCurrency: "USD", dayChange: 0, valued: 1 });
  });

  it("an equal-valued good observation resets the grace without replacing state or stealing focus", async () => {
    manifestFixture.symbols = { NVDA: { last: 100, chg: 0, currency: "USD" } };
    await ready(bookA);
    await pollQuote({ NVDA: { last: 110, chg: 10, currency: "USD" } }, 200);
    const input = targetInput(); input.focus();
    await typeInto(input, "37");
    await pollQuote({ NVDA: null });
    await pollQuote({ NVDA: null });
    const before = view.quotes;
    await pollQuote({ NVDA: { last: 110, chg: 10, currency: "USD" } });   // equal-valued good
    expect(view.quotes).toBe(before);                          // unchanged-value suppression
    expect(document.activeElement).toBe(input);                // focus preserved
    await pollQuote({ NVDA: null });
    await pollQuote({ NVDA: null });
    expect(view.quotes.NVDA).toBeDefined();                    // the grace was RESET, not exhausted
    await pollQuote({ NVDA: null });
    expect(view.quotes.NVDA).toBeUndefined();
  });

  it("only explicit nulls advance the grace: omission, HTTP failure, hidden tab; StrictMode cannot double-count", async () => {
    await mount(bookA, "A", true);                             // StrictMode mount
    await pollQuote({ NVDA: { last: 110, chg: 10, currency: "USD" } }, 200);
    for (let miss = 0; miss < 3; miss++) await pollQuote({ });  // omitted from the response
    expect(view.quotes.NVDA).toBeDefined();
    const httpFail = await holdQuote();
    await resolve(httpFail, { error: "upstream" }, 500);        // HTTP failure: no observation
    expect(view.quotes.NVDA).toBeDefined();
    const networkFail = await holdQuote();
    await act(async () => networkFail.reject(new TypeError("down")));
    expect(view.quotes.NVDA).toBeDefined();
    const pollsBefore = reads.quotes.length;
    manifestFixture.hidden = true;
    await act(async () => { vi.advanceTimersByTime(12000); }); await flush();
    expect(reads.quotes).toHaveLength(pollsBefore);            // hidden tab: not even a request
    manifestFixture.hidden = false;
    await pollQuote({ NVDA: null });
    await pollQuote({ NVDA: null });
    expect(view.quotes.NVDA).toBeDefined();                    // two real misses only — no double count
    await pollQuote({ NVDA: null });
    expect(view.quotes.NVDA).toBeUndefined();                  // the third explicit null retires it
  });

  it("the manifest fallback carries its own currency; an unknown-unit fallback leaves the named gap", async () => {
    manifestFixture.symbols = { NVDA: { last: 100, chg: 0 } }; // deliberate: no currency of its own
    await mount(bookA);
    await pollQuote({ NVDA: { last: 110, chg: 10, currency: "USD" } }, 200);
    expect(view.totals).toMatchObject({ marketValue: 1100, marketValueCurrency: "USD" });
    await pollQuote({ NVDA: null });
    await pollQuote({ NVDA: null });
    await pollQuote({ NVDA: null });
    expect(view.quotes.NVDA).toBeUndefined();
    // The fallback never borrows the retired quote's unit: the manifest row prices as unknown-unit.
    expect(nativePrice(view.quotes.NVDA, manifestFixture.symbols.NVDA))
      .toEqual({ last: 100, currency: null, chg: 0 });
    expect(recordIssues(bookA[0], view.quotes.NVDA, manifestFixture.symbols.NVDA)).toContain("quoteCurrency");
    expect(view.totals).toMatchObject({ valued: 1, marketValue: null, dayChange: null, unpriced: [] });
    expect(view.totals.monetaryGaps).toContain("NVDA");
  });

  it("with no fallback at all the retired quote leaves the record unpriced and named", async () => {
    await mount(bookA);                                        // empty manifest
    await pollQuote({ NVDA: { last: 110, chg: 10, currency: "USD" } }, 200);
    expect(view.totals).toMatchObject({ marketValue: 1100, marketValueCurrency: "USD" });
    await pollQuote({ NVDA: null });
    await pollQuote({ NVDA: null });
    await pollQuote({ NVDA: null });
    expect(view.quotes.NVDA).toBeUndefined();
    expect(nativePrice(view.quotes.NVDA, manifestFixture.symbols.NVDA)).toBeNull();
    expect(recordIssues(bookA[0], view.quotes.NVDA, manifestFixture.symbols.NVDA)).toContain("quote");
    expect(view.totals).toMatchObject({ valued: 0, marketValue: null, unpriced: ["NVDA"] });
  });

  it("miss counters do not follow a ticker across demand changes", async () => {
    manifestFixture.symbols = { NVDA: { last: 100, chg: 0, currency: "USD" }, AAPL: { last: 50, chg: 0, currency: "USD" } };
    const twoA: Position[] = [base, { ...base, id: "record-aapl", ticker: "AAPL" }];
    await mount(twoA);
    await pollQuote({ NVDA: { last: 110, chg: 10, currency: "USD" }, AAPL: { last: 55, chg: 5, currency: "USD" } }, 200);
    await pollQuote({ NVDA: null, AAPL: null });               // each symbol: one miss
    await pollQuote({ NVDA: null, AAPL: null });               // each symbol: two misses
    await act(async () => {
      root.render(<PortfolioView positions={[base]} email="fixture@example.com" userId={identityOf("A")} />);
    });
    await flush();                                             // AAPL leaves demand: its grace is pruned
    await act(async () => {
      root.render(<PortfolioView positions={twoA.slice()} email="fixture@example.com" userId={identityOf("A")} />);
    });
    await flush();                                             // AAPL returns with a FRESH grace
    await pollQuote({ NVDA: null, AAPL: null }, 200);          // NVDA's own count reaches three here
    expect(view.quotes.NVDA).toBeUndefined();                  // NVDA expired on its own third
    expect(view.quotes.AAPL).toBeDefined();                    // AAPL did not inherit a stale count
    await pollQuote({ NVDA: null });
    await pollQuote({ NVDA: null, AAPL: null });               // AAPL's second miss
    await pollQuote({ NVDA: null, AAPL: null });               // AAPL's third miss
    expect(view.quotes.AAPL).toBeUndefined();                  // and expires on its own third
  });
});
