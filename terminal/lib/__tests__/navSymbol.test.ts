import { describe, expect, it } from "vitest";
import { SYMBOL_AWARE_NAV_KEYS, navHref } from "@/lib/navSymbol";

const CHART = { k: "chart", href: "/terminal" };
const ANALYSIS = { k: "analysis", href: "/analysis" };
const DISCOVER = { k: "discover", href: "/discover" };

describe("navSymbol", () => {
  it("carries the active company to the symbol-aware workspaces", () => {
    expect(navHref(ANALYSIS, "SMR", "/terminal")).toBe("/analysis?symbol=SMR");
    expect(navHref(CHART, "SMR", "/analysis")).toBe("/terminal?symbol=SMR");
  });

  it("leaves workspaces that ignore ?symbol= undecorated", () => {
    expect(navHref(DISCOVER, "SMR", "/terminal")).toBe("/discover");
    for (const key of ["discover", "options", "scripts", "portfolio", "alerts"]) {
      expect(SYMBOL_AWARE_NAV_KEYS.has(key)).toBe(false);
    }
  });

  // Rewriting the address you are already on turns a no-op nav click into a real navigation —
  // on /terminal, a full chart remount fired by the button that only closes the open pane.
  it("never decorates the workspace you are already on", () => {
    expect(navHref(CHART, "SMR", "/terminal")).toBe("/terminal");
    expect(navHref(ANALYSIS, "SMR", "/analysis")).toBe("/analysis");
    expect(navHref(ANALYSIS, "SMR", "/analysis/anything")).toBe("/analysis");
  });

  // A path-prefix test, not a bare startsWith: a future /terminalx must not read as /terminal.
  it("matches the current workspace on path segments, not on characters", () => {
    expect(navHref(CHART, "SMR", "/terminals-of-doom")).toBe("/terminal?symbol=SMR");
  });

  it("is a plain href before the cursor hydrates", () => {
    expect(navHref(ANALYSIS, null, "/terminal")).toBe("/analysis");
    expect(navHref(ANALYSIS, undefined, "/terminal")).toBe("/analysis");
  });

  it("encodes symbols that carry URL-significant characters", () => {
    expect(navHref(ANALYSIS, "^NDX", "/terminal")).toBe("/analysis?symbol=%5ENDX");
    expect(navHref(ANALYSIS, "BRK.B", "/terminal")).toBe("/analysis?symbol=BRK.B");
  });
});
