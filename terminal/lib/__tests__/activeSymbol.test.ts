import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACTIVE_SYMBOL_EVENT,
  ACTIVE_SYMBOL_KEY,
  normalizeActiveSymbol,
  readActiveSymbol,
  resetActiveSymbolCache,
  subscribeActiveSymbol,
  writeActiveSymbol,
} from "@/lib/activeSymbol";

type Listener = (event: unknown) => void;

function stubStorage() {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
  };
  return store;
}

function stubWindow() {
  const listeners = new Map<string, Set<Listener>>();
  (globalThis as unknown as { window: unknown }).window = {
    addEventListener: (type: string, fn: Listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: Listener) => { listeners.get(type)?.delete(fn); },
    dispatchEvent: (event: { type: string }) => {
      listeners.get(event.type)?.forEach((fn) => fn(event));
      return true;
    },
  };
  // The module dispatches a real CustomEvent; Node 18+ has one, but keep the shape explicit.
  if (typeof (globalThis as { CustomEvent?: unknown }).CustomEvent === "undefined") {
    (globalThis as unknown as { CustomEvent: unknown }).CustomEvent = class {
      type: string; detail: unknown;
      constructor(type: string, init?: { detail?: unknown }) { this.type = type; this.detail = init?.detail; }
    };
  }
  return listeners;
}

describe("activeSymbol", () => {
  let store: Map<string, string>;
  let listeners: Map<string, Set<Listener>>;

  beforeEach(() => {
    store = stubStorage();
    listeners = stubWindow();
    resetActiveSymbolCache();
  });
  afterEach(() => {
    delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
    delete (globalThis as unknown as { window?: unknown }).window;
    resetActiveSymbolCache();
  });

  it("has no cursor until a surface publishes one", () => {
    expect(readActiveSymbol()).toBeNull();
  });

  it("round-trips a published symbol, canonicalized", () => {
    writeActiveSymbol(" smr ");
    expect(store.get(ACTIVE_SYMBOL_KEY)).toBe("SMR");
    expect(readActiveSymbol()).toBe("SMR");
  });

  it("accepts the shapes real tickers take", () => {
    for (const raw of ["BRK.B", "RDS-A", "^NDX", "BTC-USD", "600547.SS"]) {
      expect(normalizeActiveSymbol(raw)).toBe(raw.toUpperCase());
    }
  });

  // A composite is a chart subject, not a company: /analysis has no page for it, so storing one
  // would hand the workspace a symbol it must reject — the NVDA fallback this module exists to end.
  it("refuses composites so the cursor stays on the last real company", () => {
    writeActiveSymbol("SMR");
    writeActiveSymbol("AAPL+MSFT");
    expect(readActiveSymbol()).toBe("SMR");
    expect(normalizeActiveSymbol("AAPL+MSFT")).toBeNull();
  });

  it("refuses values that are not usable symbols", () => {
    writeActiveSymbol("SMR");
    for (const bad of ["", "   ", "../data/x", "a b", null, undefined, 42, "SYM/OTHER"]) {
      writeActiveSymbol(bad);
    }
    expect(readActiveSymbol()).toBe("SMR");
  });

  it("notifies same-tab subscribers exactly once per real change", () => {
    const onChange = vi.fn();
    const stop = subscribeActiveSymbol(onChange);

    writeActiveSymbol("SMR");
    expect(onChange).toHaveBeenCalledTimes(1);

    // A re-render republishing the same value must not churn listeners.
    writeActiveSymbol("SMR");
    writeActiveSymbol("smr");
    expect(onChange).toHaveBeenCalledTimes(1);

    writeActiveSymbol("TSLA");
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(readActiveSymbol()).toBe("TSLA");

    stop();
    writeActiveSymbol("AAPL");
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  // The bundler does not guarantee one instance of this module across chunks, so a subscriber
  // may be a SECOND copy whose in-memory cache the writer never touched. Measured in the browser:
  // the nav's Analysis link stayed bare while mm.activeSymbol in the same tab already read AAPL.
  // A notification must therefore always send the next read back to storage.
  it("re-reads storage on notification instead of trusting its own cache", () => {
    expect(readActiveSymbol()).toBeNull();          // cache now memoizes "no cursor"

    const onChange = vi.fn();
    subscribeActiveSymbol(onChange);

    // Another module copy's write: storage moves, this copy's cache does not.
    store.set(ACTIVE_SYMBOL_KEY, "SMR");
    listeners.get(ACTIVE_SYMBOL_EVENT)?.forEach((fn) => fn({ type: ACTIVE_SYMBOL_EVENT }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(readActiveSymbol()).toBe("SMR");
  });

  it("adopts a change made in another tab", () => {
    writeActiveSymbol("SMR");
    const onChange = vi.fn();
    subscribeActiveSymbol(onChange);

    store.set(ACTIVE_SYMBOL_KEY, "TSLA");
    listeners.get("storage")?.forEach((fn) => fn({ type: "storage", key: ACTIVE_SYMBOL_KEY }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(readActiveSymbol()).toBe("TSLA");
  });

  it("ignores another tab's unrelated key but honours a full clear", () => {
    writeActiveSymbol("SMR");
    const onChange = vi.fn();
    subscribeActiveSymbol(onChange);

    listeners.get("storage")?.forEach((fn) => fn({ type: "storage", key: "mm.recentlyViewed" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(readActiveSymbol()).toBe("SMR");

    store.clear();
    listeners.get("storage")?.forEach((fn) => fn({ type: "storage", key: null }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(readActiveSymbol()).toBeNull();
  });

  it("survives a browser that refuses site data", () => {
    (globalThis as unknown as { localStorage: unknown }).localStorage = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    };
    resetActiveSymbolCache();

    expect(readActiveSymbol()).toBeNull();
    expect(() => writeActiveSymbol("SMR")).not.toThrow();
  });

  it("names the event the shell dispatches", () => {
    expect(ACTIVE_SYMBOL_EVENT).toBe("mm:active-symbol");
  });
});
