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
