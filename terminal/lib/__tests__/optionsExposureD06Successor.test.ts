import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  optionalQualifiedOptionsExposurePacket, qualifiedOptionsExposurePacket,
  verifyExpiryIntegrationNativePrerequisites, requireIntegrationExecution, type IntegrationExecution,
} from "../../e2e/tools/optionsExposureEvidence.cjs";

const repo = join(__dirname, "../../..");
const capture = "terminal/docs/verification/exposure-workspace-20261103/d06-r5-copy-20261111";
const copy = "terminal/docs/verification/exposure-workspace-20261103/heatmap-copy-20261111";
const family = {
  eod: { packet: "eod-heatmap-flowdesk-load-failure", pin: "46b35e7f1bf23454dede63797644bb4d8082bdb484dfa7918e377f9b3e1c6a90" },
  gex: { packet: "gex-levels-heatmap-load-failure", pin: "076271811c0cedfec4ad4d0344ec3594aa20c9d44e30cd1287fc94179ebe471c" },
} as const;
type Family = keyof typeof family;
const nativePath = (kind: Family) => `terminal/docs/pr-crops/${family[kind].packet}/operations/exposure-source-compatibility-20261105/revisions/d06-r5-copy-20261111`;
const rootPath = (kind: Family) => `terminal/docs/pr-crops/${family[kind].packet}/EVIDENCE.yml`;
const crops = (kind: Family): string[] => Object.keys(JSON.parse(readFileSync(join(repo, nativePath(kind), "capture-execution.json"), "utf8")).images);
const temporary: string[] = [];
afterEach(() => { for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true }); });

function shadow(overrides: Record<string, string | Buffer | null>): string {
  const root = mkdtempSync(join(tmpdir(), "exposure-d06-"));
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

describe("D06 native prerequisites", () => {
  it("qualifies both fresh native families while leaving browser acceptance unclaimed", () => {
    expect(verifyExpiryIntegrationNativePrerequisites(repo)).toEqual({
      state: "NATIVE_ONLY_VALIDATED", currentBrowserQualified: false,
      gex: { revision: "d06-r5-copy-20261111", descriptorSha256: family.gex.pin },
      eod: { revision: "d06-r5-copy-20261111", descriptorSha256: family.eod.pin },
    });
  }, 30_000);

  it.each([
    "terminal/components/eodcontext/DarkPoolMini.tsx",
    "terminal/components/gexdesk/StrikeLadder.tsx",
    "terminal/e2e/tools/capture_eod_heatmap_flowdesk_load_failure.cjs",
    "terminal/e2e/tools/capture_gex_levels_heatmap_load_failure.cjs",
  ])("rejects current drift in either family or producer: %s", path => {
    const root = shadow({ [path]: readFileSync(join(repo, path), "utf8") + "\n// changed source\n" });
    expect(() => verifyExpiryIntegrationNativePrerequisites(root)).toThrow(/NO_QUALIFIED_CAPTURE|INTEGRATION_CURRENT_PRODUCER/);
  }, 30_000);

  it.each(["attempt.json", "supervision.json", "command.json", "driver.log"])("rejects changed native custody: %s", file => {
    const path = nativePath("eod") + "/" + file;
    const root = shadow({ [path]: readFileSync(join(repo, path), "utf8") + "\n" });
    expect(() => verifyExpiryIntegrationNativePrerequisites(root)).toThrow("D06_NATIVE_FILE:eod:");
  }, 30_000);

  it.each([
    capture + "/prior-roots/eod.EVIDENCE.yml",
    copy + "/browser-artifacts/playwright/.last-run.json",
  ])("validates complete immutable copy history: %s", path => {
    const root = shadow({ [path]: readFileSync(join(repo, path), "utf8") + "\n" });
    expect(() => verifyExpiryIntegrationNativePrerequisites(root)).toThrow(/D06_PRIOR_ROOT:eod|INTEGRATION_BROWSER_ARTIFACT:/);
  }, 30_000);

  it("keeps ordinary copy qualification strict when D06 history is absent", () => {
    const root = shadow({
      [capture]: null, [nativePath("eod")]: null, [nativePath("gex")]: null,
      [rootPath("eod")]: readFileSync(join(repo, capture, "prior-roots/eod.EVIDENCE.yml")),
      [rootPath("gex")]: readFileSync(join(repo, capture, "prior-roots/gex.EVIDENCE.yml")),
    });
    // D06 CSS is deliberately retained: no public flag may excuse predecessor applicability.
    expect(() => qualifiedOptionsExposurePacket(root, "gex", crops("gex"))).toThrow("NO_QUALIFIED_CAPTURE");
  }, 30_000);

  it.each(["eod", "gex"] as const)("retains the actual %s worktree identity and rejects a fabricated source tree", kind => {
    const execution = JSON.parse(readFileSync(join(repo, nativePath(kind), "capture-execution.json"), "utf8")) as IntegrationExecution;
    expect(execution.capturedSourceTree).toBeUndefined();
    expect(execution.actualGit?.head).toBe("357c32f1a330dda9362955361ae0ab30a3e54048");
    expect(execution.publishedBasis).toBe("4deaa727aa862eb6d004b35dbcfba7d86ecb2a4e");
    expect(() => requireIntegrationExecution(execution, kind, crops(kind), "d06-integration")).not.toThrow();
    expect(() => requireIntegrationExecution({ ...execution, capturedSourceTree: execution.actualGit!.headTree },
      kind, crops(kind), "d06-integration")).toThrow("D06_WORKTREE_IDENTITY");
    expect(() => requireIntegrationExecution({ ...execution, actualGit: { ...execution.actualGit!, head: execution.publishedBasis! } },
      kind, crops(kind), "d06-integration")).toThrow(/INTEGRATION_CAPTURE_IDENTITY|D06_WORKTREE_IDENTITY/);
  });
});

describe("D06 browser successor", () => {
  it.each(["eod", "gex"] as const)("returns the fresh %s manifest and current source map", kind => {
    const packet = qualifiedOptionsExposurePacket(repo, kind, crops(kind));
    const execution = JSON.parse(readFileSync(join(repo, nativePath(kind), "capture-execution.json"), "utf8"));
    expect(packet.captureRevision).toBe("d06-r5-copy-20261111");
    expect(packet.descriptorSha256).toBe(family[kind].pin);
    expect(packet.native.native_manifest_sha256).toBe(execution.manifestSha256);
    expect(packet.execution?.actualGit).toEqual(execution.actualGit);
    expect(Object.keys(packet.sources)).toHaveLength(kind === "eod" ? 32 : 29);
  }, 30_000);

  it("never substitutes historical browser acceptance for a missing D06 descriptor", () => {
    const root = shadow({ [capture + "/browser-successor.json"]: null });
    expect(verifyExpiryIntegrationNativePrerequisites(root).currentBrowserQualified).toBe(false);
    expect(() => qualifiedOptionsExposurePacket(root, "gex", crops("gex"))).toThrow(/ENOENT/);
    expect(() => optionalQualifiedOptionsExposurePacket(root, "gex", crops("gex"))).toThrow(/ENOENT/);
  }, 30_000);

  it("keeps native-only success distinct from current browser source drift", () => {
    const path = "terminal/components/exposure-map/ExposureDivergence.tsx";
    const root = shadow({ [path]: readFileSync(join(repo, path), "utf8") + "\n// browser source changed\n" });
    expect(verifyExpiryIntegrationNativePrerequisites(root).currentBrowserQualified).toBe(false);
    expect(() => qualifiedOptionsExposurePacket(root, "gex", crops("gex"))).toThrow("NO_QUALIFIED_CAPTURE");
  }, 30_000);

  it("rejects a predecessor root as the current declaration", () => {
    const root = shadow({ [rootPath("eod")]: readFileSync(join(repo, capture, "prior-roots/eod.EVIDENCE.yml")) });
    expect(() => qualifiedOptionsExposurePacket(root, "gex", crops("gex"))).toThrow("D06_CURRENT_ROOT:eod");
  }, 30_000);

  it.each(["browser-report.json", "expiry-journeys/browser-report.json", "expiry-journeys/browser-artifacts/playwright/.last-run.json"])("rejects changed actual browser evidence: %s", file => {
    const path = capture + "/" + file;
    const root = shadow({ [path]: readFileSync(join(repo, path), "utf8") + "\n" });
    expect(() => qualifiedOptionsExposurePacket(root, "gex", crops("gex"))).toThrow(/INTEGRATION_BROWSER_FILE:|EXPIRY_INTEGRATION_JOURNEY_(FILE|ARTIFACT):/);
  }, 30_000);
});
