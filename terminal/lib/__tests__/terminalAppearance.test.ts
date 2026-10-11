// @vitest-environment jsdom
// Wrong local-hour boundaries, cache fallback, event duplication or divergent
// prepaint behavior each changes a visible document state asserted here.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appearanceChoice, resolveAppearance, readAppearanceChoice, applyTerminalAppearance,
  nextAppearanceBoundary, TERMINAL_APPEARANCE_INIT, subscribeAppearanceIntent,
} from "@/lib/terminalAppearance";

beforeEach(() => {
  localStorage.clear(); document.documentElement.dataset.theme = "dark";
});
afterEach(() => { vi.restoreAllMocks(); });

describe("incumbent light/dark/auto contract", () => {
  it.each([
    [6, 59, "dark"], [7, 0, "light"], [18, 59, "light"], [19, 0, "dark"],
  ] as const)("auto at local %i:%i is %s", (hour, minute, want) => {
    expect(resolveAppearance("auto", new Date(2026, 7, 1, hour, minute))).toBe(want);
  });
  it("explicit choices ignore the clock", () => {
    expect(resolveAppearance("light", new Date(2026, 7, 1, 23))).toBe("light");
    expect(resolveAppearance("dark", new Date(2026, 7, 1, 12))).toBe("dark");
  });
  it("uses only closed incumbent preference values", () => {
    expect(appearanceChoice({ theme: "light", themeAuto: "1" })).toBe("auto");
    expect(appearanceChoice({ theme: "light", themeAuto: "0" })).toBe("light");
    expect(appearanceChoice({ theme: "dark" }, "light")).toBe("dark");
    expect(appearanceChoice({ theme: "system", themeAuto: true }, "light")).toBe("light");
    expect(appearanceChoice(null)).toBe("dark");
    expect(appearanceChoice(["light"])).toBe("dark");
  });
  it("reads the same cache and fails safely when storage is absent or malformed", () => {
    expect(readAppearanceChoice()).toBe("dark");
    localStorage.setItem("theme", "light"); expect(readAppearanceChoice()).toBe("light");
    localStorage.setItem("themeAuto", "1"); expect(readAppearanceChoice()).toBe("auto");
    localStorage.setItem("themeAuto", "true"); localStorage.setItem("theme", "system");
    expect(readAppearanceChoice()).toBe("dark");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw Error("blocked"); });
    expect(readAppearanceChoice()).toBe("dark");
  });
  it("applies visible mode even when cache writes are blocked, with one event per mode change", () => {
    const seen: string[] = [];
    const listen = (event: Event) => seen.push((event as CustomEvent<string>).detail);
    window.addEventListener("mm:theme", listen);
    try {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("blocked"); });
      applyTerminalAppearance("light"); applyTerminalAppearance("light");
      expect(document.documentElement.dataset.theme).toBe("light");
      applyTerminalAppearance("dark");
      expect(seen).toEqual(["light", "dark"]);
    } finally { window.removeEventListener("mm:theme", listen); }
  });
  it("notifies actual device intents even without a mode change, suppresses sync echoes and unsubscribes", () => {
    const intent = vi.fn();
    const unsubscribe = subscribeAppearanceIntent(intent);
    try {
      applyTerminalAppearance("light", new Date(2026, 7, 1, 8));
      applyTerminalAppearance("auto", new Date(2026, 7, 1, 8));
      expect(intent.mock.calls).toEqual([["light"], ["auto"]]);
      applyTerminalAppearance("auto", new Date(2026, 7, 1, 19), false);
      expect(document.documentElement.dataset.theme).toBe("dark");
      expect(intent).toHaveBeenCalledTimes(2);
      unsubscribe();
      applyTerminalAppearance("light");
      expect(intent).toHaveBeenCalledTimes(2);
    } finally { unsubscribe(); }
  });
  it("explicit selection clears the incumbent auto flag; auto caches the current resolved mode", () => {
    applyTerminalAppearance("auto", new Date(2026, 7, 1, 8));
    expect(localStorage.getItem("themeAuto")).toBe("1");
    expect(localStorage.getItem("theme")).toBe("light");
    applyTerminalAppearance("dark");
    expect(localStorage.getItem("themeAuto")).toBeNull();
    expect(localStorage.getItem("theme")).toBe("dark");
  });
  it("schedules the next local calendar boundary without a fixed UTC/day interval", () => {
    expect(nextAppearanceBoundary(new Date(2026, 7, 1, 6, 59)).getTime()).toBe(new Date(2026, 7, 1, 7).getTime());
    expect(nextAppearanceBoundary(new Date(2026, 7, 1, 7)).getTime()).toBe(new Date(2026, 7, 1, 19).getTime());
    expect(nextAppearanceBoundary(new Date(2026, 7, 1, 19)).getTime()).toBe(new Date(2026, 7, 2, 7).getTime());
  });
});

describe("real prepaint program", () => {
  it.each([
    ["light", null, 23, "light"], ["dark", null, 8, "dark"],
    ["dark", "1", 7, "light"], ["light", "1", 19, "dark"],
    ["system", "true", 8, "dark"], [null, null, 8, "dark"],
  ] as const)("cache theme=%s auto=%s hour=%i paints %s", (theme, auto, hour, want) => {
    const values: Record<string, string | null> = { theme, themeAuto: auto };
    const attrs: Record<string, string> = {};
    class LocalClock extends Date { getHours() { return hour; } }
    new Function("document", "localStorage", "Date", TERMINAL_APPEARANCE_INIT)(
      { documentElement: { setAttribute: (key: string, value: string) => { attrs[key] = value; } } },
      { getItem: (key: string) => values[key] }, LocalClock,
    );
    expect(attrs["data-theme"]).toBe(want);
  });
  it("blocked storage still paints safe dark instead of aborting initialization", () => {
    const attrs: Record<string, string> = {};
    new Function("document", "localStorage", TERMINAL_APPEARANCE_INIT)(
      { documentElement: { setAttribute: (key: string, value: string) => { attrs[key] = value; } } },
      { getItem: () => { throw Error("blocked"); } },
    );
    expect(attrs["data-theme"]).toBe("dark");
  });
});
