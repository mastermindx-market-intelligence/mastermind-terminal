/**
 * fixtureSeam.ts — reachability gate for the BFF fixture branches.
 *
 * The fixture seams exist for `next dev` and the Playwright lanes only. A
 * production runtime (`next start`, NODE_ENV=production) reaches a fixture
 * branch ONLY with the prod-build canary's explicit marker
 * (`TERMINAL_E2E_CANARY=1`, set solely in playwright.prodbuild.config.ts's
 * webServer env). A stray FLOW_FIXTURE/TERMINAL_E2E_FIXTURE value on a real
 * host trips the guard and the route behaves as live: upstream auth,
 * entitlement and transport run exactly as without the variable.
 */
export type FixtureSeamEnv = {
  FLOW_FIXTURE?: string | undefined;
  TERMINAL_E2E_FIXTURE?: string | undefined;
  NODE_ENV?: string | undefined;
  TERMINAL_E2E_CANARY?: string | undefined;
};

export function fixtureSeamReachable(env: FixtureSeamEnv = process.env): boolean {
  if (env.FLOW_FIXTURE !== "1" && env.TERMINAL_E2E_FIXTURE !== "1") return false;
  if (env.NODE_ENV !== "production") return true;
  return env.TERMINAL_E2E_CANARY === "1";
}
