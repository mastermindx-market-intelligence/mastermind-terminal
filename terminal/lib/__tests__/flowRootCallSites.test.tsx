// @vitest-environment jsdom
/**
 * isValidRoot (lib/flowRoot.ts) is the one option-root rule, and it is a security rule: the
 * /api/flow route applies it to every f-param whose tail is a root. The Levels board's ticker
 * commit and the options-alert root normalizer (the alert form and the alerts route alike)
 * must call it, never keep a copy. Here the rule is swapped for edited versions, and each
 * call site must follow every edit.
 */
import React, { act } from "react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { rule, flowGetMock } = vi.hoisted(() => ({
  rule: vi.fn<(root: string) => boolean>(),
  flowGetMock: vi.fn(),
}));
vi.mock("@/lib/flowRoot", () => ({ isValidRoot: (root: string) => rule(root) }));
vi.mock("@/lib/flowClientCache", () => ({ flowGet: (f: string) => flowGetMock(f) }));
vi.mock("@/lib/searchTrack", () => ({ trackSearch: () => undefined }));

import { LevelsView } from "@/components/levels/LevelsView";
import { canonicalizeOptAlertIdentity, normalizeOptAlertRoot } from "@/lib/optionsAlerts";
import { normalizeStoredAlert } from "@/app/api/alerts/route";

let shipped: (root: string) => boolean;
// Two edits to lib/flowRoot.ts: one more head character allowed, and a 4-character cap.
const widened = (r: string) => r.length <= 12 && /^[A-Z0-9]{1,11}(?:[.-][A-Z0-9]{1,4})?$/.test(r);
const narrowed = (r: string) => shipped(r) && r.length <= 4;
// 12 characters, the ticker box's maxLength; upper-casing turns ß into SS (13).
const EXPANDS = "abcdefghij.ß";
// One head character past the pattern's 10. The widened edit admits it.
const LONG_HEAD = "abcdefghijk";

let host: HTMLDivElement;
let root: Root;

beforeAll(async () => {
  shipped = (await vi.importActual<typeof import("@/lib/flowRoot")>("@/lib/flowRoot")).isValidRoot;
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  rule.mockReset();
  rule.mockImplementation((r) => shipped(r));
  flowGetMock.mockReset();
  flowGetMock.mockResolvedValue(null);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function settle() {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
const asked = () => flowGetMock.mock.calls.map(([f]) => f as string);

async function renderLevels() {
  await act(async () => root.render(<LevelsView />));
  await settle();
  expect(asked()).toContain("levels:SPY");
}

/** Type into the Levels ticker box and press Enter, the way a reader commits a root. */
async function commitLevels(typed: string) {
  const input = host.querySelector<HTMLInputElement>('input[list="levels-roots"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, typed);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  await settle();
}

const rootAlert = (root: string) => ({ symbol: "SPY", condition: { type: "opt_gamma_flip", root } });

describe("Levels board ticker commit follows lib/flowRoot.ts", () => {
  it("as shipped: a root the route refuses is never sent, even one typed in 12 characters", async () => {
    expect(EXPANDS).toHaveLength(12);
    expect(EXPANDS.toUpperCase()).toBe("ABCDEFGHIJ.SS");
    await renderLevels();
    await commitLevels(EXPANDS);
    expect(asked()).not.toContain("levels:ABCDEFGHIJ.SS");
    expect(rule).toHaveBeenCalledWith("ABCDEFGHIJ.SS");
    await commitLevels(LONG_HEAD);
    expect(asked()).not.toContain("levels:ABCDEFGHIJK");
    await commitLevels("brk.b");
    expect(asked()).toContain("levels:BRK.B");
  });

  it("a widened rule widens what the board asks for", async () => {
    rule.mockImplementation(widened);
    await renderLevels();
    await commitLevels(LONG_HEAD);
    expect(asked()).toContain("levels:ABCDEFGHIJK");
  });

  it("a narrowed rule narrows what the board asks for", async () => {
    expect(shipped("GOOGL")).toBe(true);
    rule.mockImplementation(narrowed);
    await renderLevels();
    await commitLevels("googl");
    expect(asked()).not.toContain("levels:GOOGL");
    await commitLevels("qqq");
    expect(asked()).toContain("levels:QQQ");
  });
});

describe("options-alert root normalizer (alert form and alerts route) follows lib/flowRoot.ts", () => {
  it("as shipped: a root the route refuses is never stored, even one typed in 12 characters", () => {
    expect(normalizeOptAlertRoot(EXPANDS)).toBeNull();
    expect(canonicalizeOptAlertIdentity("SPY", rootAlert(EXPANDS).condition)).toBeNull();
    expect(normalizeStoredAlert(rootAlert(EXPANDS))).toMatchObject({ identity_state: "unresolved" });
    expect(normalizeOptAlertRoot(LONG_HEAD)).toBeNull();
    expect(normalizeOptAlertRoot(" brk.b ")).toBe("BRK.B");
  });

  it("a widened rule widens what an alert may store", () => {
    rule.mockImplementation(widened);
    expect(normalizeOptAlertRoot(` ${LONG_HEAD} `)).toBe("ABCDEFGHIJK");
    expect(canonicalizeOptAlertIdentity("SPY", rootAlert(LONG_HEAD).condition)).toEqual({
      symbol: "ABCDEFGHIJK",
      condition: { type: "opt_gamma_flip", root: "ABCDEFGHIJK" },
    });
    expect(normalizeStoredAlert(rootAlert(LONG_HEAD))).toMatchObject({ symbol: "ABCDEFGHIJK", identity_state: "ok" });
  });

  it("a narrowed rule narrows what an alert may store", () => {
    rule.mockImplementation(narrowed);
    expect(normalizeOptAlertRoot("googl")).toBeNull();
    expect(normalizeOptAlertRoot("qqq")).toBe("QQQ");
    expect(canonicalizeOptAlertIdentity("GOOGL", rootAlert("googl").condition)).toBeNull();
    expect(normalizeStoredAlert(rootAlert("googl"))).toMatchObject({ identity_state: "unresolved" });
  });
});

describe("the root pattern has one home", () => {
  it("no other Terminal source file carries its own copy", () => {
    const terminal = join(__dirname, "..", "..");
    const pattern = /const ROOT_RE = \/(.+)\/;/.exec(readFileSync(join(terminal, "lib", "flowRoot.ts"), "utf8"))?.[1];
    expect(pattern, "ROOT_RE in lib/flowRoot.ts").toBeTruthy();

    // Product source only; tests may quote the pattern on purpose.
    const sources = (dir: string, out: string[] = []): string[] => {
      for (const entry of readdirSync(dir)) {
        if (entry === "__tests__") continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) sources(full, out);
        else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry)) out.push(full);
      }
      return out;
    };
    const holders = ["app", "components", "lib", "scripts"]
      .flatMap((dir) => sources(join(terminal, dir)))
      .filter((file) => readFileSync(file, "utf8").includes(pattern!))
      .map((file) => relative(terminal, file));
    expect(holders).toEqual([join("lib", "flowRoot.ts")]);
  });
});
