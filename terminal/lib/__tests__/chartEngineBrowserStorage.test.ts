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
