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
