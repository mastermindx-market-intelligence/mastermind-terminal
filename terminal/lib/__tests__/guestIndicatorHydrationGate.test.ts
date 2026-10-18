import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The same guest journey was exercised in a real Chromium profile: mm.inds=["trend"]
// with Nine-Bar enabled renders on first boot, but the unguarded initial anon cap then
// overwrote storage with ["ema","vol","macd"] on reload. These guards pin the
// ordering contract; the separate browser witness tests actual React hydration.
const shell = readFileSync(join(__dirname, "../../components/TerminalShell.tsx"), "utf8");

describe("guest indicator restore must precede the anonymous cap and persistence", () => {
  it("never caps initial SSR defaults before persisted indicators are hydrated", () => {
    const cap = shell.slice(shell.indexOf("// ── Free-tier gate"), shell.indexOf("// Preserve OpenMarket-style defaults"));
    expect(cap).toContain("if (!prefsHydrated || loggedIn) return;");
    expect(cap).toContain("[indParams, inds, loggedIn, prefsHydrated]");
  });

  it("never persists an unhydrated render's indicator set", () => {
    const position = shell.indexOf("const indsMounted = useRef(false);");
    expect(position).toBeGreaterThan(0);
    const persistence = shell.slice(position, position + 440);
    expect(persistence).toContain("if (!prefsHydrated) return;");
    expect(persistence).toContain("[inds, prefsHydrated]");
  });
});
