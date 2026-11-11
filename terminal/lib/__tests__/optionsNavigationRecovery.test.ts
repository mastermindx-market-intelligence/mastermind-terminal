import { describe, expect, it } from "vitest";
import { shouldAutoRecoverNavigationError } from "@/lib/navigationRecovery";

describe("one-shot route error recovery matcher", () => {
  it.each([
    "/terminal",
    "/options",
    "/options/futures",
  ])("preserves existing chunk recovery on %s", (pathname) => {
    expect(shouldAutoRecoverNavigationError(new Error("ChunkLoadError: Loading chunk abc failed"), pathname)).toBe(true);
    expect(shouldAutoRecoverNavigationError(new Error("module factory is not available"), pathname)).toBe(true);
  });

  it.each([
    new TypeError("network error"),
    new TypeError("Failed to fetch"),
    new TypeError("Load failed"),
    new Error("Failed to fetch RSC payload"),
    new Error("ERR_HTTP2_PROTOCOL_ERROR"),
  ])("heals the known Options transport boundary once through the existing guard: %s", (error) => {
    expect(shouldAutoRecoverNavigationError(error, "/options")).toBe(true);
    expect(shouldAutoRecoverNavigationError(error, "/options/futures")).toBe(true);
  });

  it.each([
    "/",
    "/terminal",
    "/portfolio",
    "/options-trades",
    "/analysis",
  ])("does not auto-reload unrelated route %s for a generic network error", (pathname) => {
    expect(shouldAutoRecoverNavigationError(new TypeError("network error"), pathname)).toBe(false);
  });

  it("does not hide a programming exception or unrelated Error in Options", () => {
    expect(shouldAutoRecoverNavigationError(new TypeError("Cannot read properties of undefined"), "/options")).toBe(false);
    expect(shouldAutoRecoverNavigationError(new Error("network error"), "/options")).toBe(false);
    expect(shouldAutoRecoverNavigationError(new Error("feed unavailable"), "/options")).toBe(false);
  });
});
