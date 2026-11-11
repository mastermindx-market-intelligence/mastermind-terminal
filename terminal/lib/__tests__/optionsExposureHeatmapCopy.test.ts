import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  optionalQualifiedOptionsExposurePacket, qualifiedOptionsExposurePacket,
  verifyExpiryIntegrationNativePrerequisites,
} from "../../e2e/tools/optionsExposureEvidence.cjs";

const repo = join(__dirname, "../../..");
const capture = "terminal/docs/verification/exposure-workspace-20261103/heatmap-copy-20261111";
const r5 = "terminal/docs/verification/exposure-workspace-20261103/r5-alignment-20261110";
const family = {
  eod: { packet: "eod-heatmap-flowdesk-load-failure", pin: "274aa30a9c0466523b307d3709072c6dc80835fdd737f43aa387bfe9286c47ac" },
  gex: { packet: "gex-levels-heatmap-load-failure", pin: "286527601cb417b34e5e1899bb19a71518d43e0d630eb456a5634e6c23a2b3db" },
} as const;
type Family = keyof typeof family;
const nativePath = (kind: Family) => `terminal/docs/pr-crops/${family[kind].packet}/operations/exposure-source-compatibility-20261105/revisions/heatmap-copy-20261111`;
const rootPath = (kind: Family) => `terminal/docs/pr-crops/${family[kind].packet}/EVIDENCE.yml`;
const crops = (kind: Family): string[] => Object.keys(JSON.parse(readFileSync(join(repo, nativePath(kind), "capture-execution.json"), "utf8")).images);
const temporary: string[] = [];
afterEach(() => { for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true }); });

function shadow(overrides: Record<string, string | Buffer | null>): string {
  const d06 = "terminal/docs/verification/exposure-workspace-20261103/d06-r5-copy-20261111";
  if (existsSync(join(repo, d06))) {
    const historical: Record<string, string | Buffer | null> = {
      [d06]: null,
      "terminal/app/globals.css": readFileSync(join(repo, d06, "prior-globals.css.txt")),
    };
    for (const kind of ["gex", "eod"] as const) {
      historical[rootPath(kind)] = readFileSync(join(repo, d06, "prior-roots", kind + ".EVIDENCE.yml"));
      historical[`terminal/docs/pr-crops/${family[kind].packet}/operations/exposure-source-compatibility-20261105/revisions/d06-r5-copy-20261111`] = null;
    }
    overrides = { ...historical, ...overrides };
  }
  const root = mkdtempSync(join(tmpdir(), "exposure-heatmap-copy-"));
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

describe("heatmap copy native prerequisites", () => {
  it("validates both fresh families without claiming current browser acceptance", () => {
    expect(verifyExpiryIntegrationNativePrerequisites(shadow({}))).toEqual({
      state: "NATIVE_ONLY_VALIDATED", currentBrowserQualified: false,
      gex: { revision: "heatmap-copy-20261111", descriptorSha256: family.gex.pin },
      eod: { revision: "heatmap-copy-20261111", descriptorSha256: family.eod.pin },
    });
  }, 30_000);

  it.each([
    "terminal/components/eodcontext/DarkPoolMini.tsx",
    "terminal/components/gexdesk/StrikeLadder.tsx",
    "terminal/e2e/tools/capture_eod_heatmap_flowdesk_load_failure.cjs",
    "terminal/e2e/tools/capture_gex_levels_heatmap_load_failure.cjs",
  ])("rejects current drift in either family or producer: %s", path => {
    const root = shadow({ [path]: readFileSync(join(repo, path), "utf8") + "\n// changed current source\n" });
    expect(() => verifyExpiryIntegrationNativePrerequisites(root)).toThrow(/NO_QUALIFIED_CAPTURE|INTEGRATION_CURRENT_PRODUCER/);
  }, 30_000);

  it.each(["attempt.json", "supervision.json", "EVIDENCE.before.yml"])("rejects changed immutable native custody: %s", file => {
    const path = nativePath("eod") + "/" + file;
    const root = shadow({ [path]: readFileSync(join(repo, path), "utf8") + "\n" });
    expect(() => verifyExpiryIntegrationNativePrerequisites(root)).toThrow("HEATMAP_COPY_NATIVE_FILE:eod:");
  }, 30_000);

  it("does not substitute an old native descriptor for the fresh nonselected family", () => {
    const root = shadow({ [nativePath("eod") + "/native-packet.json"]: readFileSync(join(repo,
      `terminal/docs/pr-crops/${family.eod.packet}/operations/exposure-source-compatibility-20261105/revisions/options-integration-20261109/native-packet.json`)) });
    expect(() => verifyExpiryIntegrationNativePrerequisites(root)).toThrow("HEATMAP_COPY_NATIVE_DESCRIPTOR:eod");
  }, 30_000);

  it("retains the actual momentum capture preimage rather than the later R5 adoption root", () => {
    const root = shadow({ [nativePath("gex") + "/EVIDENCE.before.yml"]: readFileSync(join(repo, capture, "prior-roots/gex.EVIDENCE.yml")) });
    expect(() => verifyExpiryIntegrationNativePrerequisites(root)).toThrow("HEATMAP_COPY_NATIVE_FILE:gex:");
  }, 30_000);

  it.each([
    capture + "/prior-roots/eod.EVIDENCE.yml",
    r5 + "/browser-artifacts/playwright/.last-run.json",
  ])("continues validating the complete immutable R5 predecessor: %s", path => {
    const root = shadow({ [path]: readFileSync(join(repo, path), "utf8") + "\n" });
    expect(() => verifyExpiryIntegrationNativePrerequisites(root)).toThrow(/HEATMAP_COPY_PRIOR_ROOT:eod|R5_RAW_EXPORT_BYTES:/);
  }, 30_000);

  it("keeps ordinary R5 qualification strict when the named copy successor is absent", () => {
    const root = shadow({
      [capture]: null, [nativePath("eod")]: null, [nativePath("gex")]: null,
      [rootPath("eod")]: readFileSync(join(repo, capture, "prior-roots/eod.EVIDENCE.yml")),
      [rootPath("gex")]: readFileSync(join(repo, capture, "prior-roots/gex.EVIDENCE.yml")),
    });
    // The actual copy source remains changed. No public mode grants old-native applicability.
    expect(() => qualifiedOptionsExposurePacket(root, "gex", crops("gex"))).toThrow("NO_QUALIFIED_CAPTURE");
  }, 30_000);
});

describe("heatmap copy browser successor", () => {
  it.each(["eod", "gex"] as const)("returns the fresh %s identity and current native sources", kind => {
    const packet = qualifiedOptionsExposurePacket(shadow({}), kind, crops(kind));
    expect(packet.captureRevision).toBe("heatmap-copy-20261111");
    expect(packet.hasExposureHistory).toBe(true);
    expect(packet.exposureHistorical).not.toBeNull();
    expect(packet.protectedManifest).toBeTruthy();
    expect(packet.optionsHistorySources).toBeDefined();
    expect(packet.descriptorSha256).toBe(family[kind].pin);
    expect(packet.native.native_manifest_sha256).toBe(JSON.parse(readFileSync(join(repo, nativePath(kind), "capture-execution.json"), "utf8")).manifestSha256);
    expect(Object.keys(packet.sources)).toHaveLength(kind === "eod" ? 32 : 29);
  }, 30_000);

  it("fails public qualification without the copy browser descriptor while native preflight remains explicit", () => {
    const root = shadow({ [capture + "/browser-successor.json"]: null });
    expect(verifyExpiryIntegrationNativePrerequisites(root).currentBrowserQualified).toBe(false);
    expect(() => qualifiedOptionsExposurePacket(root, "gex", crops("gex"))).toThrow(/ENOENT/);
    expect(() => optionalQualifiedOptionsExposurePacket(root, "gex", crops("gex"))).toThrow(/ENOENT/);
  }, 30_000);

  it("keeps native-only success separate from browser source drift", () => {
    const path = "terminal/components/exposure-map/ExposureDivergence.tsx";
    const root = shadow({ [path]: readFileSync(join(repo, path), "utf8") + "\n// browser-only drift\n" });
    expect(verifyExpiryIntegrationNativePrerequisites(root).currentBrowserQualified).toBe(false);
    expect(() => qualifiedOptionsExposurePacket(root, "gex", crops("gex"))).toThrow("NO_QUALIFIED_CAPTURE");
  }, 30_000);

  it("rejects substituting the old R5 browser descriptor as copy proof", () => {
    const root = shadow({ [capture + "/browser-successor.json"]: readFileSync(join(repo, r5, "browser-successor.json")) });
    expect(() => qualifiedOptionsExposurePacket(root, "gex", crops("gex"))).toThrow("HEATMAP_COPY_SUCCESSOR_DESCRIPTOR");
  }, 30_000);

  it("rejects a predecessor declaration as the current selected root", () => {
    const root = shadow({ [rootPath("eod")]: readFileSync(join(repo, capture, "prior-roots/eod.EVIDENCE.yml")) });
    expect(() => qualifiedOptionsExposurePacket(root, "gex", crops("gex"))).toThrow("HEATMAP_COPY_CURRENT_ROOT:eod");
  }, 30_000);

  it.each(["browser-report.json", "expiry-journeys/browser-report.json", "expiry-journeys/browser-artifacts/playwright/.last-run.json"])("rejects corrupt actual browser evidence: %s", file => {
    const path = capture + "/" + file;
    const root = shadow({ [path]: readFileSync(join(repo, path), "utf8") + "\n" });
    expect(() => qualifiedOptionsExposurePacket(root, "gex", crops("gex"))).toThrow(/INTEGRATION_BROWSER_FILE:|EXPIRY_INTEGRATION_JOURNEY_(FILE|ARTIFACT):/);
  }, 30_000);
});
