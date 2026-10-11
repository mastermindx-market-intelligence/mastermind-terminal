// @vitest-environment jsdom
//
// E16 — the shell-side review hook and its bar, mounted for real (react-dom/client + act; this repo
// has no @testing-library). Covers what the pure-module tests cannot: one storage write per user
// action, a burst of Next presses inside one frame, the owner boundary, and an honest "not saved"
// state when the browser store refuses the write.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import WatchlistReviewBar from "@/components/watchlist/WatchlistReviewBar";
import { useWatchlistReview, type WatchlistReview } from "@/lib/useWatchlistReview";
import { WL_REVIEW_KEY } from "@/lib/watchlistReview";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Rows = Record<string, { symbol: string; section: string }[]>;
const rows = (...symbols: string[]) => symbols.map((symbol) => ({ symbol, section: "" }));
const MANIFEST: Record<string, { name: string }> = {
  NVDA: { name: "NVIDIA" }, TSLA: { name: "Tesla" }, AAPL: { name: "Apple" }, MSFT: { name: "Microsoft" }, AMZN: { name: "Amazon" },
};

let host: HTMLDivElement;
let root: Root;
let latest: WatchlistReview;
const navigate = vi.fn<(symbol: string) => void>();

function Harness({ owner, lists, manifest = MANIFEST, active = "AAPL" }: { owner: string; lists: Rows; manifest?: Record<string, unknown> | null; active?: string }) {
  const review = useWatchlistReview({ owner, lists, listMeta: {}, listsReady: true, manifestSymbols: manifest, navigate });
  latest = review;
  return <WatchlistReviewBar review={review} activeSymbol={active} activeList="Tech" activeListCount={lists.Tech?.length ?? 0} manifestSymbols={manifest} />;
}

function render(props: Parameters<typeof Harness>[0]) {
  act(() => { root.render(<Harness {...props} />); });
}

function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((el) => el.getAttribute("aria-label") === label || el.textContent?.trim() === label);
  if (!found) throw new Error(`no button "${label}"`);
  return found as HTMLButtonElement;
}
const click = (label: string) => act(() => { button(label).click(); });
const text = (testId: string) => host.querySelector(`[data-testid="${testId}"]`)?.textContent ?? null;
const stored = (owner: string) => (JSON.parse(store.getItem(WL_REVIEW_KEY) || "{}") as Record<string, { cursor: number; symbols: string[]; marks: Record<string, unknown> }>)[owner];

// Node 26 ships its own (broken without a backing file) global `localStorage`, which shadows
// jsdom's; install a counting in-memory Storage instead, the same way chartSettingsHydration does.
class CountingStorage {
  data = new Map<string, string>();
  writes = 0;
  fail = false;
  get length() { return this.data.size; }
  keys() { return [...this.data.keys()]; }
  key(index: number) { return this.keys()[index] ?? null; }
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) {
    this.writes++;
    if (this.fail) throw new DOMException("full", "QuotaExceededError");
    this.data.set(key, String(value));
  }
  removeItem(key: string) { this.writes++; if (this.fail) throw new DOMException("blocked", "SecurityError"); this.data.delete(key); }
  clear() { this.data.clear(); }
}
let store: CountingStorage;
const writes = () => store.writes;

beforeEach(() => {
  store = new CountingStorage();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: store });
  navigate.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("useWatchlistReview + WatchlistReviewBar", () => {
  it("follows the frozen order after the live list is re-sorted (the E16 falsifier)", () => {
    render({ owner: "guest", lists: { Tech: rows("NVDA", "TSLA", "AAPL", "MSFT") } });
    act(() => latest.start("Tech"));
    expect(navigate).toHaveBeenLastCalledWith("NVDA");
    expect(text("wl-review-next")).toBe("Next: TSLA");

    // A background quote re-rank reorders the live list. Same members, different order: in the
    // live list NVDA is now followed by MSFT, so a review reading the live order would go there.
    render({ owner: "guest", lists: { Tech: rows("TSLA", "NVDA", "MSFT", "AAPL") } });
    expect(text("wl-review-next")).toBe("Next: TSLA");
    expect(host.querySelector('[data-testid="wl-review-drift"]')).toBeNull();
    click("Next company");
    expect(navigate).toHaveBeenLastCalledWith("TSLA");
    click("Next company");
    expect(navigate).toHaveBeenLastCalledWith("AAPL");
    expect(text("wl-review-position")).toBe("3 of 4");
  });

  it("writes exactly once per action and never on a re-render", () => {
    render({ owner: "guest", lists: { Tech: rows("NVDA", "TSLA", "AAPL") } });
    expect(writes()).toBe(0);
    act(() => latest.start("Tech"));
    expect(writes()).toBe(1);
    click("Next company");
    expect(writes()).toBe(2);
    click("Mark reviewed");
    expect(writes()).toBe(3);
    // Quote / manifest / list updates re-render the bar; none of them write.
    render({ owner: "guest", lists: { Tech: rows("AAPL", "NVDA", "TSLA") }, manifest: { ...MANIFEST } });
    render({ owner: "guest", lists: { Tech: rows("AAPL", "NVDA", "TSLA") }, manifest: { ...MANIFEST }, active: "TSLA" });
    expect(writes()).toBe(3);
    expect(store.keys()).toEqual([WL_REVIEW_KEY]);
    expect(stored("guest").marks).toEqual({ TSLA: expect.objectContaining({ state: "reviewed" }) });
  });

  it("advances one step per press when presses land inside one frame", () => {
    render({ owner: "guest", lists: { Tech: rows("NVDA", "TSLA", "AAPL", "MSFT") } });
    act(() => latest.start("Tech"));
    navigate.mockReset();
    act(() => { latest.next(); latest.next(); latest.next(); latest.next(); });
    expect(navigate.mock.calls.map(([symbol]) => symbol)).toEqual(["TSLA", "AAPL", "MSFT"]);
    expect(stored("guest").cursor).toBe(3);
    expect(text("wl-review-notice")).toBe("No available company after this one.");
  });

  it("skips an unavailable company by name and never opens a neighbour in its place", () => {
    render({ owner: "guest", lists: { Tech: rows("NVDA", "ZZZQ", "AAPL") } });
    act(() => latest.start("Tech"));
    click("Next company");
    expect(navigate.mock.calls.map(([symbol]) => symbol)).toEqual(["NVDA", "AAPL"]);
    expect(text("wl-review-notice")).toBe("Skipped ZZZQ (no market data).");
    expect(text("wl-review-summary")).toContain("1 unavailable");
  });

  it("shows a removed company as removed, separates drift, and refreshes only on request", () => {
    render({ owner: "guest", lists: { Tech: rows("NVDA", "TSLA", "AAPL") } });
    act(() => latest.start("Tech"));
    click("Next company");
    render({ owner: "guest", lists: { Tech: rows("NVDA", "AAPL", "AMZN") } });
    expect(text("wl-review-current")).toBe("TSLA");
    expect(text("wl-review-availability")).toMatch(/removed from the list after this review started/i);
    expect(button("Mark reviewed").disabled).toBe(true);
    expect(text("wl-review-drift")).toMatch(/1 added, 1 removed/);
    const before = writes();
    navigate.mockReset();
    click("Update review to the current list");
    expect(writes()).toBe(before + 1);
    expect(stored("guest").symbols).toEqual(["NVDA", "AAPL", "AMZN"]);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(text("wl-review-current")).toBe(navigate.mock.calls[0][0]);
  });

  it("keeps each owner's review to that owner, including across a switch and back", () => {
    render({ owner: "account:a", lists: { Tech: rows("NVDA", "TSLA", "AAPL") } });
    act(() => latest.start("Tech"));
    click("Next company");
    render({ owner: "account:b", lists: { Tech: rows("NVDA", "TSLA", "AAPL") } });
    expect(host.querySelector('[data-testid="wl-review"]')).toBeNull();
    expect(latest.itinerary).toBeNull();
    const before = writes();
    act(() => latest.next());
    expect(writes()).toBe(before);
    render({ owner: "account:a", lists: { Tech: rows("NVDA", "TSLA", "AAPL") } });
    expect(text("wl-review-current")).toBe("TSLA");
    expect(stored("account:b")).toBeUndefined();
  });

  it("says 'not saved' when the store refuses a write, and Retry clears it", () => {
    render({ owner: "guest", lists: { Tech: rows("NVDA", "TSLA", "AAPL") } });
    act(() => latest.start("Tech"));
    store.fail = true;
    click("Next company");
    expect(text("wl-review-current")).toBe("TSLA");
    expect(host.querySelector('[data-testid="wl-review-save"]')?.getAttribute("data-save")).toBe("unsaved");
    expect(stored("guest").cursor).toBe(0);
    store.fail = false;
    click("Retry save");
    expect(host.querySelector('[data-testid="wl-review-save"]')?.getAttribute("data-save")).toBe("saved");
    expect(stored("guest").cursor).toBe(1);
  });

  it("restores the saved position after a remount (reload)", () => {
    render({ owner: "guest", lists: { Tech: rows("NVDA", "TSLA", "AAPL") } });
    act(() => latest.start("Tech"));
    click("Next company");
    act(() => root.unmount());
    root = createRoot(host);
    navigate.mockReset();
    render({ owner: "guest", lists: { Tech: rows("AAPL", "TSLA", "NVDA") } });
    expect(text("wl-review-current")).toBe("TSLA");
    expect(text("wl-review-next")).toBe("Next: AAPL");
    // Resuming does not move the chart by itself.
    expect(navigate).not.toHaveBeenCalled();
  });
});
