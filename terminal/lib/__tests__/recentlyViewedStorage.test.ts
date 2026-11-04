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
