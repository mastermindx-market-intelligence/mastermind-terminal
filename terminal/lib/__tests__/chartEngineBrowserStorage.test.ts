// @vitest-environment jsdom
// browserStorage.ts is the only module in the engine-selection corner allowed to touch a
// browser global. Its contract is two-valued: a usable EngineStorage, or null when the
// host has none — including when merely TOUCHING window.localStorage throws (Safari
// private mode / cookies disabled), which must never reach a chart mount.
import { afterEach, describe, expect, it } from "vitest";
import {
  STORAGE_KEY,
  resolveMountEngineImpl,
  resolveMountEngineSelection,
} from "@/lib/chart-engine/select";
import { browserEngineStorage } from "@/lib/chart-engine/browserStorage";

// vitest's jsdom env forwards jsdom's own `localStorage` onto the global ONLY when the runner's
// Node has no global by that name: getWindowKeys() drops a jsdom key that is already `in global`
// unless vitest's fixed KEYS list names it, and that list has no "localStorage". Node >= 22 ships
// an experimental `localStorage` accessor that is undefined without --localstorage-file, so on
// those runners window.localStorage is undefined and all five cases below would fail for a reason
// that has nothing to do with browserStorage.ts. Pin the real jsdom Storage first (house
// precedent: thesisProposalReadState.test.tsx). No-op on runners where jsdom's Storage already
// arrived, e.g. CI's Node 20.
function hostStorageUsable(): boolean {
  try {
    const candidate: unknown = window.localStorage;
    return (
      typeof candidate === "object" &&
      candidate !== null &&
      typeof (candidate as { getItem?: unknown }).getItem === "function"
    );
  } catch {
    return false;
  }
}
if (!hostStorageUsable()) {
  const dom = (globalThis as unknown as { jsdom?: { window: Window } }).jsdom;
  if (!dom) throw new Error("chartEngineBrowserStorage.test.ts: no jsdom window to source a Storage from");
  const real = dom.window.localStorage;
  Object.defineProperty(window, "localStorage", { configurable: true, get: () => real });
}

const nativeDesc = Object.getOwnPropertyDescriptor(window, "localStorage") ??
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(window), "localStorage");

function denyLocalStorageGetter(): void {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get() { throw new Error("SecurityError: cookies disabled"); },
  });
}

afterEach(() => {
  if (nativeDesc) Object.defineProperty(window, "localStorage", nativeDesc);
  window.localStorage.removeItem(STORAGE_KEY);
});

describe("browserEngineStorage()", () => {
  it("returns the host localStorage when the getter is healthy", () => {
    expect(browserEngineStorage()).toBe(window.localStorage);
  });

  it("returns null when merely TOUCHING window.localStorage throws", () => {
    denyLocalStorageGetter();
    expect(() => window.localStorage).toThrow();
    let out: unknown = "unset";
    expect(() => { out = browserEngineStorage(); }).not.toThrow();
    expect(out).toBeNull();
  });

  it("the mount path still resolves when storage access throws", () => {
    denyLocalStorageGetter();
    expect(() => resolveMountEngineImpl(window.location.search)).not.toThrow();
    expect(resolveMountEngineSelection(window.location.search)).toMatchObject({ impl: "mm", source: "default" });
    expect(resolveMountEngineSelection("?engine=lwc")).toMatchObject({ impl: "lwc", source: "url" });
  });

  it("with a healthy host the default storage parameter really persists a url choice", () => {
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(resolveMountEngineImpl("?engine=lwc")).toBe("lwc");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("lwc");
  });

  it("a stored mm never makes lwc unreachable (K1, real host)", () => {
    window.localStorage.setItem(STORAGE_KEY, "mm");
    expect(resolveMountEngineImpl("")).toBe("mm");
    expect(resolveMountEngineImpl("?engine=lwc")).toBe("lwc");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("lwc");
    expect(resolveMountEngineImpl("")).toBe("lwc");
  });
});
