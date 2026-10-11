// @vitest-environment jsdom
//
// E16 — the shell-side review hook and its bar, mounted for real (react-dom/client + act; this repo
// has no @testing-library). Covers what the pure-module tests cannot: one storage write per user
// action, a burst of Next presses inside one frame, the owner boundary, an honest "not saved"
// state when the browser store refuses the write, an unreadable saved review, the revision check
// between two tabs, and a list rename.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import WatchlistReviewBar from "@/components/watchlist/WatchlistReviewBar";
import { useWatchlistReview, type WatchlistReview } from "@/lib/useWatchlistReview";
import { WL_REVIEW_KEY } from "@/lib/watchlistReview";
import { PHONE_QUERY } from "@/lib/useMediaQuery";

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
const click = (label: string, within: ParentNode = host) => act(() => {
  const found = [...within.querySelectorAll("button")].find((el) => el.getAttribute("aria-label") === label || el.textContent?.trim() === label);
  if (!found) throw new Error(`no button "${label}"`);
  (found as HTMLButtonElement).click();
});
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

// jsdom has no matchMedia; the bar asks the phone query to pick its slot. Default: not a phone.
let phone = false;
const matchMedia = (query: string) => ({
  matches: query === PHONE_QUERY ? phone : false, media: query, onchange: null,
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
});

beforeEach(() => {
  store = new CountingStorage();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: store });
  phone = false;
  Object.defineProperty(window, "matchMedia", { configurable: true, value: matchMedia });
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
    click("Next symbol");
    expect(navigate).toHaveBeenLastCalledWith("TSLA");
    click("Next symbol");
    expect(navigate).toHaveBeenLastCalledWith("AAPL");
    expect(text("wl-review-position")).toBe("3 of 4");
  });

  it("writes exactly once per action and never on a re-render", () => {
    render({ owner: "guest", lists: { Tech: rows("NVDA", "TSLA", "AAPL") } });
    expect(writes()).toBe(0);
    act(() => latest.start("Tech"));
    expect(writes()).toBe(1);
    click("Next symbol");
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
    expect(text("wl-review-notice")).toBe("No available symbol after this one.");
  });

  it("skips an unavailable symbol by name and never opens a neighbour in its place", () => {
    render({ owner: "guest", lists: { Tech: rows("NVDA", "ZZZQ", "AAPL") } });
    act(() => latest.start("Tech"));
    click("Next symbol");
    expect(navigate.mock.calls.map(([symbol]) => symbol)).toEqual(["NVDA", "AAPL"]);
    expect(text("wl-review-notice")).toBe("Skipped ZZZQ (no market data).");
    expect(text("wl-review-summary")).toContain("1 unavailable");
  });

  it("shows a removed symbol as removed, separates drift, and refreshes only on request", () => {
    render({ owner: "guest", lists: { Tech: rows("NVDA", "TSLA", "AAPL") } });
    act(() => latest.start("Tech"));
    click("Next symbol");
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
    click("Next symbol");
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
    click("Next symbol");
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
    click("Next symbol");
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

describe("useWatchlistReview: unreadable, other tabs, rename (AC-E16-05)", () => {
  const good = (owner: string) => {
    render({ owner, lists: { Tech: rows("NVDA", "TSLA", "AAPL") } });
    act(() => latest.start("Tech"));
    const saved = store.getItem(WL_REVIEW_KEY)!;
    act(() => root.unmount());
    root = createRoot(host);
    store.data.clear();
    store.writes = 0;
    navigate.mockReset();
    return (JSON.parse(saved) as Record<string, unknown>)[owner];
  };

  it("says a saved review could not be read before a new start replaces it", () => {
    store.data.set(WL_REVIEW_KEY, JSON.stringify({ guest: { v: 1, listName: "Tech", symbols: ["NVDA"], cursor: 7 } }));
    render({ owner: "guest", lists: { Tech: rows("NVDA", "TSLA", "AAPL") } });
    expect(latest.unreadable).toBe(true);
    expect(latest.itinerary).toBeNull();
    expect(text("wl-review-unreadable")).toMatch(/could not be read\. Starting a review replaces it\./);
    // Reading it wrote nothing; the record is untouched until the user acts.
    expect(writes()).toBe(0);
    act(() => latest.start("Tech"));
    expect(writes()).toBe(1);
    expect(host.querySelector('[data-testid="wl-review-unreadable"]')).toBeNull();
    expect(stored("guest").symbols).toEqual(["NVDA", "TSLA", "AAPL"]);
  });

  it("an absent review shows no unreadable notice", () => {
    render({ owner: "guest", lists: { Tech: rows("NVDA") } });
    expect(latest.unreadable).toBe(false);
    expect(host.querySelector('[data-testid="wl-review-unreadable"]')).toBeNull();
  });

  it("Discard removes only this owner's unreadable record, and says so when it cannot", () => {
    const other = good("account:b");
    store.data.set(WL_REVIEW_KEY, JSON.stringify({ guest: "not a review", "account:b": other }));
    render({ owner: "guest", lists: { Tech: rows("NVDA") } });
    store.fail = true;
    click("Discard it");
    expect(text("wl-review-notice")).toBe("Could not remove the saved review from this device.");
    expect(host.querySelector('[data-testid="wl-review-unreadable"]')).not.toBeNull();
    store.fail = false;
    click("Discard it");
    expect(host.querySelector('[data-testid="wl-review-unreadable"]')).toBeNull();
    expect(stored("guest")).toBeUndefined();
    expect(stored("account:b")).toEqual(other);
  });

  it("a tab that is behind adopts the newer saved review instead of writing over it", () => {
    // Tab B mounts in its own root on the same browser store, after tab A has started.
    const hostB = document.createElement("div");
    document.body.appendChild(hostB);
    const rootB = createRoot(hostB);
    const navigateB = vi.fn<(symbol: string) => void>();
    let tabB!: WatchlistReview;
    function TabB() {
      const review = useWatchlistReview({ owner: "guest", lists: { Tech: rows("NVDA", "TSLA", "AAPL", "MSFT") }, listMeta: {}, listsReady: true, manifestSymbols: MANIFEST, navigate: navigateB });
      tabB = review;
      return <WatchlistReviewBar review={review} activeSymbol="NVDA" activeList="Tech" activeListCount={4} manifestSymbols={MANIFEST} />;
    }
    try {
      render({ owner: "guest", lists: { Tech: rows("NVDA", "TSLA", "AAPL", "MSFT") } });
      act(() => latest.start("Tech"));
      act(() => rootB.render(<TabB />));
      expect(tabB.current).toBe("NVDA");

      // Tab A moves on to TSLA. Tab B still shows NVDA and presses Next.
      click("Next symbol");
      expect(stored("guest").cursor).toBe(1);
      const before = writes();
      click("Next symbol", hostB);
      // B adopted A's position (TSLA) and showed it; it did not write NVDA→TSLA over A's record.
      expect(writes()).toBe(before);
      expect(stored("guest").cursor).toBe(1);
      expect(tabB.current).toBe("TSLA");
      expect(navigateB).toHaveBeenLastCalledWith("TSLA");
      expect(hostB.querySelector('[data-testid="wl-review-notice"]')?.textContent).toBe("This review changed in another tab. Showing its latest saved position.");
      // The next press in B is a normal step from the adopted position.
      click("Next symbol", hostB);
      expect(stored("guest").cursor).toBe(2);
      expect(tabB.current).toBe("AAPL");

      // Now A is behind. Its marker press adopts B's position instead of marking TSLA.
      click("Mark reviewed");
      expect(stored("guest").marks).toEqual({});
      expect(latest.current).toBe("AAPL");

      // Resume in a tab that is behind shows the saved position, not its own stale one.
      click("Next symbol", hostB);
      navigate.mockReset();
      act(() => latest.resume());
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenLastCalledWith("MSFT");

      // B ends the review. A's next press finds it ended and does not bring it back.
      click("End review", hostB);
      expect(stored("guest")).toBeUndefined();
      const beforeEnd = writes();
      click("Previous symbol");
      expect(writes()).toBe(beforeEnd);
      expect(stored("guest")).toBeUndefined();
      expect(latest.itinerary).toBeNull();
      expect(text("wl-review-notice")).toBe("This review was ended in another tab.");
    } finally {
      act(() => rootB.unmount());
      hostB.remove();
    }
  });

  it("follows a list rename without moving the chart", () => {
    render({ owner: "guest", lists: { Tech: rows("NVDA", "TSLA", "AAPL") } });
    act(() => latest.start("Tech"));
    click("Next symbol");
    navigate.mockReset();
    act(() => latest.renameList("Tech", "Semis"));
    render({ owner: "guest", lists: { Semis: rows("NVDA", "TSLA", "AAPL") } });
    expect(host.querySelector('[data-testid="wl-review"]')?.getAttribute("data-review-list")).toBe("Semis");
    expect(latest.listMissing).toBe(false);
    expect(text("wl-review-current")).toBe("TSLA");
    expect((stored("guest") as unknown as { listName: string }).listName).toBe("Semis");
    expect(navigate).not.toHaveBeenCalled();
    // A rename of some other list leaves the review alone.
    const before = writes();
    act(() => latest.renameList("Other", "Else"));
    expect(writes()).toBe(before);
  });
});

describe("WatchlistReviewBar slots: the phone fold (R2.3)", () => {
  // The shell mounts the bar twice: `rail-top` first in the rail, `phone-foot` after the oracle row.
  function Slots({ lists, owner = "guest" }: { lists: Rows; owner?: string }) {
    const review = useWatchlistReview({ owner, lists, listMeta: {}, listsReady: true, manifestSymbols: MANIFEST, navigate });
    latest = review;
    const props = { review, activeSymbol: "AAPL", activeList: "Tech", activeListCount: lists.Tech?.length ?? 0, manifestSymbols: MANIFEST };
    return (
      <>
        <div data-slot="rail-top"><WatchlistReviewBar {...props} /></div>
        <div data-slot="phone-foot"><WatchlistReviewBar slot="phone-foot" {...props} /></div>
      </>
    );
  }
  const count = (slot: string, testId: string) => host.querySelectorAll(`[data-slot="${slot}"] [data-testid="${testId}"]`).length;
  const lists = { Tech: rows("NVDA", "TSLA") };

  it("puts the idle state after the oracle row on a phone only, and keeps the active review at the top", () => {
    for (const isPhone of [false, true]) {
      phone = isPhone;
      act(() => { root.render(<Slots key={String(isPhone)} lists={lists} />); });
      // Exactly one idle control at any width: at the top of the rail off a phone, at the foot on one.
      expect(count("rail-top", "wl-review-idle-start")).toBe(isPhone ? 0 : 1);
      expect(count("phone-foot", "wl-review-idle-start")).toBe(isPhone ? 1 : 0);
      act(() => latest.start("Tech"));
      expect(count("rail-top", "wl-review")).toBe(1);
      expect(count("phone-foot", "wl-review")).toBe(0);
      expect(host.querySelectorAll('[data-testid="wl-review-idle-start"]')).toHaveLength(0);
      act(() => latest.end());
      expect(host.querySelectorAll('[data-testid="wl-review"]')).toHaveLength(0);
    }
  });

  it("shows an unreadable saved review beside the phone's idle control, not above the oracle row", () => {
    store.data.set(WL_REVIEW_KEY, JSON.stringify({ guest: "not a review" }));
    phone = true;
    act(() => { root.render(<Slots lists={lists} />); });
    expect(count("rail-top", "wl-review-unreadable")).toBe(0);
    expect(count("phone-foot", "wl-review-unreadable")).toBe(1);
  });

  it("keeps the unsaved-end alert where the active bar was (the top) at every width", () => {
    for (const isPhone of [false, true]) {
      phone = isPhone;
      store.fail = false;
      act(() => { root.render(<Slots key={String(isPhone)} lists={lists} />); });
      act(() => latest.start("Tech"));
      store.fail = true;
      act(() => latest.end());
      expect(count("rail-top", "wl-review-unsaved")).toBe(1);
      expect(count("phone-foot", "wl-review-unsaved")).toBe(0);
      expect(host.querySelectorAll('[data-testid="wl-review-idle-start"]')).toHaveLength(0);
      store.fail = false;
      act(() => latest.dismissUnsaved());
      store.data.clear();
    }
  });

  it("starting from the phone's control brings the active bar on screen", () => {
    phone = true;
    const frames: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { frames.push(callback); return frames.length; });
    const original = Element.prototype.scrollIntoView;
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    try {
      act(() => { root.render(<Slots lists={lists} />); });
      act(() => (host.querySelector('[data-slot="phone-foot"] [data-testid="wl-review-idle-start"]') as HTMLButtonElement).click());
      expect(navigate).toHaveBeenLastCalledWith("NVDA");
      act(() => { frames.splice(0).forEach((callback) => callback(0)); });
      expect(scrolled).toHaveBeenCalledTimes(1);
      expect(scrolled.mock.contexts[0]).toBe(host.querySelector('[data-slot="rail-top"] [data-testid="wl-review"]'));
    } finally {
      Element.prototype.scrollIntoView = original;
      raf.mockRestore();
    }
  });
});
