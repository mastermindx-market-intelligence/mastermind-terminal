import { describe, expect, it } from "vitest";
import current from "../sharedShellRoutes.generated.json";
import { NATIVE_INTELLIGENCE_PATHS, requireNativeCatalog, requireOwnedFixtureAuthority, requireOwnedReportOutputs } from "../../e2e/fixtures/native-intelligence-contract";
describe("native entrance ordinary-CI prerequisite fences (not browser acceptance)", () => {
  it("records the actual absent I3 import without hand-enrolling production paths", () => {
    const missing = NATIVE_INTELLIGENCE_PATHS.filter(p => !current.nativePaths.includes(p));
    if (missing.length) expect(() => requireNativeCatalog(current)).toThrow("I3_CANONICAL_IMPORT_REQUIRED");
    else expect(() => requireNativeCatalog(current)).not.toThrow(); // canonical future import, never a copied allowlist
  });
  it.each(NATIVE_INTELLIGENCE_PATHS)("refuses a partial canonical import missing %s", absent => {
    expect(() => requireNativeCatalog({ nativePaths: NATIVE_INTELLIGENCE_PATHS.filter(p => p !== absent), legacyPaths: [] })).toThrow("I3_CANONICAL_IMPORT_REQUIRED");
  });
  it("refuses native/legacy dual classification", () => {
    expect(() => requireNativeCatalog({ nativePaths: NATIVE_INTELLIGENCE_PATHS, legacyPaths: ["/prophet"] })).toThrow("legacy=/prophet");
  });
  it("accepts a complete synthetic unit value without changing the production catalog", () => {
    expect(() => requireNativeCatalog({ nativePaths: NATIVE_INTELLIGENCE_PATHS, legacyPaths: [] })).not.toThrow();
  });
  it.each([undefined, "https://www.mastermind-x.com", "http://localhost:3108", "http://127.0.0.1:3109", "http://127.0.0.1:3108/"])("refuses billing outside exact declared owner (%s)", authority => {
    expect(() => requireOwnedFixtureAuthority("http://127.0.0.1:3108", authority)).toThrow("NATIVE_MEMBER_FIXTURE_REQUIRED");
  });
  it("refuses port zero even if both declarations agree", () => {
    expect(() => requireOwnedFixtureAuthority("http://127.0.0.1:0", "http://127.0.0.1:0/api/__e2e__/native-intelligence/billing")).toThrow("NATIVE_MEMBER_FIXTURE_REQUIRED");
  });
  it("accepts only the actual declared same-origin fixture authority", () => {
    expect(requireOwnedFixtureAuthority("http://127.0.0.1:3108", "http://127.0.0.1:3108/api/__e2e__/native-intelligence/billing")).toBe("http://127.0.0.1:3108");
  });
});

describe("new invocation preserves incumbent report destinations", () => {
  it("defaults to a separate subtree and permits only its exact explicit destinations", () => {
    expect(requireOwnedReportOutputs("/owned/terminal",{},"/owned/terminal")).toBe("/owned/terminal/test-results/native-intelligence");
    expect(requireOwnedReportOutputs("/owned/terminal",{json:"test-results/native-intelligence/report.json",last:"test-results/native-intelligence/.last-run.json"},"/owned/terminal")).toBe("/owned/terminal/test-results/native-intelligence");
  });
  it.each([{json:"test-results/report.json"},{last:"test-results/.last-run.json"},
    {json:"test-results/shared-shell-refinement/report.json"},{json:"/foreign/report.json"}])("refuses borrowed/stale ordinary output (%j)", values => {
    expect(() => requireOwnedReportOutputs("/owned/terminal",values,"/owned/terminal")).toThrow("NATIVE_JOURNEY_REPORT_DESTINATION_REFUSED");
  });
});
