import path from "node:path";
/** P12.T2.S15.S4: prerequisites, never an admission/allowlist writer. */
export const NATIVE_INTELLIGENCE_PATHS = ["/intelligence", "/prophet", "/sectors"] as const;
export function requireNativeCatalog(catalog: { nativePaths: readonly string[]; legacyPaths: readonly string[] }) {
  const missing = NATIVE_INTELLIGENCE_PATHS.filter(path => !catalog.nativePaths.includes(path));
  const misclassified = NATIVE_INTELLIGENCE_PATHS.filter(path => catalog.legacyPaths.includes(path));
  if (missing.length || misclassified.length) throw Error(
    `I3_CANONICAL_IMPORT_REQUIRED missing=${missing.join(",")} legacy=${misclassified.join(",")}; ` +
    "derive from the real Terminal candidate, protect the Macro registry, then export/import verbatim; do not patch this test catalog",
  );
}
export function requireOwnedFixtureAuthority(base: string, billingBase: string | undefined) {
  const origin = new URL(base);
  if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || !origin.port || origin.port === "0" ||
      origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash ||
      billingBase !== origin.origin + "/api/__e2e__/native-intelligence/billing") throw Error(
    "NATIVE_MEMBER_FIXTURE_REQUIRED: explicit same-owned-origin BILLING_GATEWAY_BASE; never production billing or a page-gate bypass",
  );
  return origin.origin;
}

/** The pinned runner honors these env overrides before reporter options. Refuse
 * a borrowed ordinary report destination; never clear or rewrite that setting.
 */
export function requireOwnedReportOutputs(terminalRoot: string, values: { json?: string; last?: string }, cwd = process.cwd()) {
  const directory = path.resolve(terminalRoot, "test-results/native-intelligence");
  for (const [key, filename] of [["json", "report.json"], ["last", ".last-run.json"]] as const) {
    const value = values[key];
    if (value !== undefined && path.resolve(cwd, value) !== path.join(directory, filename))
      throw Error("NATIVE_JOURNEY_REPORT_DESTINATION_REFUSED");
  }
  return directory;
}

/** Dedicated invocation only. Bind the existing runner's browser URL and server URL,
 * never its unrelated default auth transport. No default config or runtime reader is changed.
 */
export function nativeFixtureServerEnvironment(base: string | undefined, serverUrl: string | undefined, env: Record<string, string> = {}) {
  if (!base || !serverUrl || (env.NODE_ENV !== undefined && env.NODE_ENV !== "development"))
    throw Error("NATIVE_FIXTURE_DECLARATION_REFUSED");
  const origin = requireOwnedFixtureAuthority(base, new URL(base).origin + "/api/__e2e__/native-intelligence/billing");
  const target = new URL(serverUrl);
  if (target.origin !== origin || target.username || target.password || target.hash)
    throw Error("NATIVE_FIXTURE_DECLARATION_REFUSED");
  return { ...env, NODE_ENV: "development", TERMINAL_E2E_FIXTURE: "1", TERMINAL_E2E_VERIFIED_AUTH: "1",
    TERMINAL_E2E_NATIVE_INTELLIGENCE: "1", NEXT_PUBLIC_SUPABASE_URL: origin + "/api/__e2e__/supabase",
    BILLING_GATEWAY_BASE: origin + "/api/__e2e__/native-intelligence/billing" };
}

/** Observation only: every mutation is still aborted by the incumbent fixture.
 * A local Auto-theme intent is never an account write/persistence success.
 */
export function isBlockedNativeAppearanceIntent(method: string, pathname: string, body: unknown): boolean {
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  if (method !== "PUT" || pathname !== "/api/__e2e__/supabase/auth/v1/user" || !object(body) ||
      Object.keys(body).join(",") !== "data" || !object(body.data) || !Object.keys(body.data).length) return false;
  return Object.entries(body.data).every(([key, value]) => {
    if (key === "theme") return value === "light" || value === "dark";
    if (key === "theme_auto") return value === "0" || value === "1";
    return key === "prefs" && object(value) && Object.keys(value).length > 0 &&
      Object.entries(value).every(([name, setting]) => name === "theme" ? setting === "light" || setting === "dark"
        : name === "themeAuto" && (setting === "0" || setting === "1"));
  });
}
