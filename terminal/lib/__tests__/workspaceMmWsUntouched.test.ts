// mm.ws-untouched regression (freeze §6: "mm.ws (device key ...) and its sibling device keys ...
// are NOT workspace inputs and are NOT migrated into named workspaces ... No perpetual server<->
// browser sync loop exists or is added"). A grep-level proof rather than a behavioral one: the W2-A
// wiring in TerminalShell.tsx must not add a THIRD `localStorage`/`getItem`/`setItem` touch point for
// the "mm.ws" key beyond the two pre-existing ones (the mount-time restore and the debounced
// per-render persist) — loading or saving a NAMED workspace must never read or write that key.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SHELL_SRC = readFileSync(join(__dirname, "../../components/TerminalShell.tsx"), "utf8");

/** Every line whose text contains the literal `mm.ws` key (as a JS string, quoted either way),
 *  excluding sibling keys that merely SHARE the `mm.ws` prefix (`mm.wsSomethingElse` — none exist
 *  today, but the match is deliberately exact so a future near-miss key does not silently inflate
 *  this count and mask a real regression). */
function mmWsTouchLines(src: string): string[] {
  return src.split("\n").filter((line) => /["'`]mm\.ws["'`]/.test(line));
}

describe("mm.ws is untouched by the W2-A named-workspace wiring", () => {
  it("exactly the two pre-existing touch points remain — mount-time restore, and the debounced persist effect", () => {
    const lines = mmWsTouchLines(SHELL_SRC);
    expect(lines).toHaveLength(2);
    expect(lines.some((l) => l.includes('load("mm.ws"'))).toBe(true);
    expect(lines.some((l) => l.includes('localStorage.setItem("mm.ws"'))).toBe(true);
  });

  it("none of the W2-A workspace functions reference mm.ws at all", () => {
    const fns = ["saveLayout", "loadLayout", "renameWorkspaceAction", "duplicateWorkspaceAction", "exportWorkspaceAction", "importWorkspaceAction", "reloadLatestWorkspace", "saveWorkspaceAsCopy", "useSuggestedWorkspaceName"];
    for (const fn of fns) {
      const start = SHELL_SRC.indexOf(`function ${fn}(`);
      expect(start, `${fn} not found in TerminalShell.tsx`).toBeGreaterThan(-1);
      // Slice to the next top-level `function` or `const ... = () =>` declaration at the same
      // indentation as a cheap body boundary — generous (a few hundred lines) rather than exact,
      // since an exact brace-matcher is unnecessary for a "does the substring mm.ws appear" check.
      const body = SHELL_SRC.slice(start, start + 4000);
      const closeIdx = body.indexOf("\n  }\n");
      const scoped = closeIdx > -1 ? body.slice(0, closeIdx) : body;
      expect(scoped, `${fn} touches mm.ws`).not.toMatch(/["'`]mm\.ws["'`]/);
    }
  });
});
