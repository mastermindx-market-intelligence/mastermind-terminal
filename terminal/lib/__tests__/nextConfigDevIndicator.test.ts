import { afterEach, describe, expect, it, vi } from "vitest";

// B-PLAT-7 re-scope (2026-09-07): `devIndicators` in next.config.ts must be conditional on
// TERMINAL_E2E_FIXTURE, not hard-coded `false` — a hard-coded value would silence the Next.js
// dev-tools indicator for every local developer, not just evidence captures. This is the
// two-way assertion the frozen spec calls for: importing the REAL config module (not a copy of
// its logic) with the flag set proves the "capture" branch, and importing it again with the
// flag unset (vi.resetModules() forces next.config.ts to re-evaluate process.env) proves an
// ordinary `npm run dev` — no flag — keeps the indicator. e2e/plat-dev-indicator.spec.ts is the
// companion DOM-level proof, run under the flag (the only dev server this suite ever drives).
const ORIGINAL_FIXTURE_FLAG = process.env.TERMINAL_E2E_FIXTURE;

describe("next.config.ts devIndicators gate", () => {
  afterEach(() => {
    if (ORIGINAL_FIXTURE_FLAG === undefined) delete process.env.TERMINAL_E2E_FIXTURE;
    else process.env.TERMINAL_E2E_FIXTURE = ORIGINAL_FIXTURE_FLAG;
    vi.resetModules();
  });

  it("suppresses the indicator when TERMINAL_E2E_FIXTURE is set (evidence captures)", async () => {
    process.env.TERMINAL_E2E_FIXTURE = "1";
    vi.resetModules();
    const { default: nextConfig } = await import("../../next.config");
    expect(nextConfig.devIndicators).toBe(false);
  });

  it("leaves the indicator at its Next.js default when TERMINAL_E2E_FIXTURE is unset (local dev)", async () => {
    delete process.env.TERMINAL_E2E_FIXTURE;
    vi.resetModules();
    const { default: nextConfig } = await import("../../next.config");
    expect(nextConfig.devIndicators).toBeUndefined();
  });
});

describe("fixture development cache isolation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each([
    { mode: "development", fixture: "1", transport: undefined, cache: false, debug: undefined },
    { mode: "development", fixture: "1", transport: "intl-fixture-v1", cache: false, debug: false },
    { mode: "development", fixture: "0", transport: "intl-fixture-v1", cache: undefined, debug: undefined },
    { mode: "development", fixture: undefined, transport: undefined, cache: undefined, debug: undefined },
    { mode: "production", fixture: "1", transport: "intl-fixture-v1", cache: undefined, debug: undefined },
    { mode: "test", fixture: "1", transport: "intl-fixture-v1", cache: undefined, debug: undefined },
  ])("keeps the actual config boundary for $mode / fixture=$fixture / transport=$transport", async ({ mode, fixture, transport, cache, debug }) => {
    vi.stubEnv("NODE_ENV", mode);
    vi.stubEnv("TERMINAL_E2E_FIXTURE", fixture);
    vi.stubEnv("TERMINAL_E2E_CLOSED_CANONICAL_TRANSPORT", transport);
    vi.resetModules();
    const { default: nextConfig } = await import("../../next.config");
    expect(nextConfig.experimental?.turbopackFileSystemCacheForDev).toBe(cache);
    expect(nextConfig.experimental?.reactDebugChannel).toBe(debug);
    expect(nextConfig.experimental?.turbopackFileSystemCacheForBuild).toBeUndefined();
  });
});
