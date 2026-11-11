import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  optionalQualifiedOptionsExposurePacket, qualifiedOptionsExposurePacket,
  verifyExpiryIntegrationNativePrerequisites,
} from "../../e2e/tools/optionsExposureEvidence.cjs";

const repo = join(__dirname, "../../..");
const capture = "terminal/docs/verification/exposure-workspace-20261103/r5-alignment-20261110";
const exported = "docs/verification/pr646-r5-browser-ci-20261110";
const families = {
  eod: { packet: "eod-heatmap-flowdesk-load-failure", revision: "options-integration-20261109",
    descriptorSha256: "77b3b7f07746290cad33262a3d95c221e947a5acd5e940ae95b9d9458f510a18" },
  gex: { packet: "gex-levels-heatmap-load-failure", revision: "expiry-greeks-integration-20261110",
    descriptorSha256: "6432faf8713536aaa14319bb310289b26a68cfa5dd923801d2f4a7b7bf1fc453" },
} as const;
type Family = keyof typeof families;
const rootPath = (kind: Family) => `terminal/docs/pr-crops/${families[kind].packet}/EVIDENCE.yml`;
const crops = (kind: Family): string[] => Object.keys(JSON.parse(readFileSync(join(repo,
  `terminal/docs/pr-crops/${families[kind].packet}/operations/exposure-source-compatibility-20261105/revisions/${families[kind].revision}/capture-execution.json`), "utf8")).images);
const temporary: string[] = [];
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });

// Copy only the path being falsified; all other evidence is read through symlinks.
// A null leaf omits that file without ever deleting or writing the real repository.
function shadow(overrides: Record<string, string | Buffer | null>): string {
  const root = mkdtempSync(join(tmpdir(), "exposure-r5-successor-"));
  temporary.push(root);
  const keys = Object.keys(overrides);
  function mirror(folder: string) {
    mkdirSync(join(root, folder), { recursive: true });
    for (const name of readdirSync(join(repo, folder))) {
      const relative = folder ? `${folder}/${name}` : name;
      if (Object.hasOwn(overrides, relative)) {
        const value = overrides[relative];
        if (value !== null) writeFileSync(join(root, relative), value);
      } else if (keys.some(key => key.startsWith(relative + "/"))) mirror(relative);
      else symlinkSync(join(repo, relative), join(root, relative));
    }
  }
  mirror("");
  return root;
}

describe("hosted R5 browser successor", () => {
  it.each(["eod", "gex"] as const)("accepts the complete actual packet and retains the %s native identity", kind => {
    const selected = qualifiedOptionsExposurePacket(repo, kind, crops(kind));
    expect(selected.captureRevision).toBe(families[kind].revision);
    expect(selected.descriptorSha256).toBe(families[kind].descriptorSha256);
    expect(Object.keys(selected.sources)).toHaveLength(kind === "eod" ? 32 : 29);
  }, 30_000);

  it("keeps native preflight distinct from current browser acceptance", () => {
    const path = "terminal/components/exposure-map/ExposureDivergence.tsx";
    const root = shadow({ [path]: readFileSync(join(repo, path), "utf8") + "\n// browser source changed\n" });
    const native = verifyExpiryIntegrationNativePrerequisites(root);
    expect(native).toEqual({
      state: "NATIVE_ONLY_VALIDATED", currentBrowserQualified: false,
      gex: { revision: families.gex.revision, descriptorSha256: families.gex.descriptorSha256 },
      eod: { revision: families.eod.revision, descriptorSha256: families.eod.descriptorSha256 },
    });
    expect(() => qualifiedOptionsExposurePacket(root, "gex", crops("gex"))).toThrow("NO_QUALIFIED_CAPTURE");
  }, 30_000);

  it.each([
    ["EOD", "terminal/components/eodcontext/DarkPoolMini.tsx"],
    ["GEX", "terminal/components/gexdesk/StrikeLadder.tsx"],
    ["producer", "terminal/e2e/tools/capture_gex_levels_heatmap_load_failure.cjs"],
  ])("rejects current %s drift in native preflight, including the nonselected family", (_name, path) => {
    const root = shadow({ [path]: readFileSync(join(repo, path), "utf8") + "\n// native source changed\n" });
    expect(() => verifyExpiryIntegrationNativePrerequisites(root)).toThrow(/NO_QUALIFIED_CAPTURE|INTEGRATION_CURRENT_PRODUCER/);
  }, 30_000);

  it("does not fall back when the R5 descriptor is missing but its history directory remains", () => {
    const root = shadow({ [capture + "/browser-successor.json"]: null });
    expect(() => qualifiedOptionsExposurePacket(root, "gex", crops("gex"))).toThrow(/ENOENT/);
    expect(() => optionalQualifiedOptionsExposurePacket(root, "gex", crops("gex"))).toThrow(/ENOENT/);
  });

  it("does not return a legacy null when the declared current root is missing", () => {
    const root = shadow({ [rootPath("gex")]: null });
    expect(() => optionalQualifiedOptionsExposurePacket(root, "gex", crops("gex"))).toThrow(/ENOENT/);
  });

  it("does not accept a predecessor declaration as the current root", () => {
    const root = shadow({ [rootPath("gex")]: readFileSync(join(repo, capture, "prior-roots/gex.EVIDENCE.yml")) });
    expect(() => qualifiedOptionsExposurePacket(root, "gex", crops("gex"))).toThrow("R5_CURRENT_ROOT:gex");
  });

  it("rejects corruption of the archived logical predecessor root", () => {
    const path = capture + "/prior-roots/eod.EVIDENCE.yml";
    const root = shadow({ [path]: readFileSync(join(repo, path), "utf8") + "\n" });
    expect(() => qualifiedOptionsExposurePacket(root, "gex", crops("gex"))).toThrow("R5_PRIOR_ROOT:eod");
  });

  it.each([
    capture + "/browser-artifacts/playwright/.last-run.json",
    capture + "/expiry-journeys/browser-artifacts/playwright/.last-run.json",
    exported + "/prior-browser-root-integration/.last-run.json",
    exported + "/prior-browser-root-expiry/.last-run.json",
  ])("rejects a missing hidden exporter member: %s", path => {
    const root = shadow({ [path]: null });
    expect(() => qualifiedOptionsExposurePacket(root, "gex", crops("gex"))).toThrow(/ENOENT/);
  }, 30_000);

  // These exercise the outer immutable-byte boundary. Shared report and checkout
  // tests separately falsify case identity, retries, chart witnesses and ancestry.
  it.each([
    capture + "/browser-execution.json",
    capture + "/lifecycle.json",
    capture + "/expiry-journeys/browser-report.json",
  ])("rejects changed captured bytes without rewriting their digest: %s", path => {
    const root = shadow({ [path]: readFileSync(join(repo, path), "utf8") + "\n" });
    expect(() => qualifiedOptionsExposurePacket(root, "gex", crops("gex"))).toThrow("R5_RAW_EXPORT_BYTES:");
  }, 30_000);
});
