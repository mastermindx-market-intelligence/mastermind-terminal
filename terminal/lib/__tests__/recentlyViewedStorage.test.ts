// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { clearRecentlyViewed, getRecentlyViewed, pushRecentlyViewed, RECENTLY_VIEWED_KEY } from "../recentlyViewed";

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const operations = {
  read: () => getRecentlyViewed(),
  push: () => pushRecentlyViewed("NVDA"),
  clear: () => clearRecentlyViewed(),
};

function denyGetter(): void {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() { throw new DOMException("Storage is unavailable", "SecurityError"); },
  });
}

function usableStorage(): Map<string, string> {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    },
  });
  return values;
}

afterEach(() => {
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

describe("optional recently-viewed storage", () => {
  for (const [name, operation] of Object.entries(operations)) {
    it(`${name} contains storage getter denial`, () => {
      denyGetter();
      expect(operation).not.toThrow();
      if (name === "read") expect(operation()).toEqual([]);
    });

    it(`${name} recovers after getter denial without a module reload`, () => {
      denyGetter();
      expect(operation).not.toThrow();
      const values = usableStorage();
      values.set("mm.searchHistory", '["OLD"]');
      pushRecentlyViewed("aapl");
      pushRecentlyViewed("nvda");
      expect(getRecentlyViewed()).toEqual(["NVDA", "AAPL"]);
      clearRecentlyViewed();
      expect(getRecentlyViewed()).toEqual([]);
      expect(values.get("mm.searchHistory")).toBe('["OLD"]');
    });

    it(`${name} contains storage method denial`, () => {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: {
          getItem() { throw new DOMException("Blocked read", "SecurityError"); },
          setItem() { throw new DOMException("Blocked write", "SecurityError"); },
        },
      });
      expect(operation).not.toThrow();
    });

    it(`${name} tolerates absent storage`, () => {
      Reflect.deleteProperty(globalThis, "localStorage");
      expect(operation).not.toThrow();
    });
  }

  it("preserves retained history when reads fail but writes succeed, then recovers", () => {
    const values = usableStorage();
    values.set(RECENTLY_VIEWED_KEY, '["AAPL","MSFT"]');
    values.set("mm.searchHistory", '["OLD"]');
    let denyRead = true;
    let writes = 0;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem(key: string) {
          if (denyRead) throw new DOMException("Blocked read", "SecurityError");
          return values.get(key) ?? null;
        },
        setItem(key: string, value: string) { writes += 1; values.set(key, value); },
      },
    });
    expect(getRecentlyViewed()).toEqual([]);
    expect(() => pushRecentlyViewed("NVDA")).not.toThrow();
    expect(writes).toBe(0);
    expect(values.get(RECENTLY_VIEWED_KEY)).toBe('["AAPL","MSFT"]');
    denyRead = false;
    pushRecentlyViewed("BABA");
    expect(getRecentlyViewed()).toEqual(["BABA", "AAPL", "MSFT"]);
    expect(values.get("mm.searchHistory")).toBe('["OLD"]');
  });

  it("still honors an explicit clear while prior history cannot be read", () => {
    const values = usableStorage();
    values.set(RECENTLY_VIEWED_KEY, '["AAPL","MSFT"]');
    values.set("mm.searchHistory", '["OLD"]');
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem() { throw new DOMException("Blocked read", "SecurityError"); },
        setItem(key: string, value: string) { values.set(key, value); },
      },
    });
    clearRecentlyViewed();
    expect(values.get(RECENTLY_VIEWED_KEY)).toBe("[]");
    expect(values.get("mm.searchHistory")).toBe('["OLD"]');
  });

  it("preserves the last successful list on quota failure, then recovers", () => {
    const values = usableStorage();
    values.set(RECENTLY_VIEWED_KEY, '["AAPL"]');
    let denyWrite = true;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem(key: string, value: string) {
          if (denyWrite) throw new DOMException("Storage full", "QuotaExceededError");
          values.set(key, value);
        },
      },
    });
    expect(() => pushRecentlyViewed("NVDA")).not.toThrow();
    expect(getRecentlyViewed()).toEqual(["AAPL"]);
    denyWrite = false;
    pushRecentlyViewed("NVDA");
    expect(getRecentlyViewed()).toEqual(["NVDA", "AAPL"]);
  });

  it.each(["broken", "{}", "null", "42"])("recovers from invalid saved history %s", (raw) => {
    const values = usableStorage();
    values.set(RECENTLY_VIEWED_KEY, raw);
    expect(getRecentlyViewed()).toEqual([]);
    pushRecentlyViewed(" aapl ");
    expect(getRecentlyViewed()).toEqual(["AAPL"]);
  });
});
