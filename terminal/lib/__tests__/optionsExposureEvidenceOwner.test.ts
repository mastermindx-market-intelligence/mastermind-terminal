import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, lstatSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { qualifiedOptionsExposurePacket, requireIntegrationExecution, requireOptionsIntegrationBrowserCases, requireExpiryGreeksBrowserCases, requireExpiryGreeksScreenshotSet } from "./helpers/optionsExposureEvidence";

const REPO = join(__dirname, "../../..");
type OwnedPacket = {
  selection?: string; path: string; sha256: string; descriptorSha256?: string;
  captureRevision?: string; capturedAtHead: string | null;
  layoutFiles: Record<string, string>; sourceFiles?: Record<string, string>;
  plan: { required: boolean; changed: string[] };
};
const owner = createRequire(import.meta.url)("../../e2e/tools/capture_ci_evidence.cjs") as {
  EOD_CROPS: string[];
  eodPacket(repo: string): OwnedPacket;
  gexPacket(repo: string): OwnedPacket;
};
const gexCrops = (createRequire(import.meta.url)("../../e2e/tools/capture_gex_levels_heatmap_load_failure.cjs") as { expectedFiles(): string[] }).expectedFiles();
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function shadowRepo(overrides: Record<string, Buffer | string>, sourceRoot = REPO): string {
  const root = mkdtempSync(join(tmpdir(), "eod-qualified-consumer-"));
  roots.push(root);
  const keys = Object.keys(overrides);
  function mirror(folder: string): void {
    mkdirSync(join(root, folder), { recursive: true });
    for (const name of readdirSync(join(sourceRoot, folder))) {
      const file = folder ? folder + "/" + name : name;
      const source = join(sourceRoot, file), target = join(root, file);
      if (Object.hasOwn(overrides, file)) writeFileSync(target, overrides[file]);
      else if (keys.some(key => key.startsWith(file + "/"))) mirror(file);
      else symlinkSync(source, target);
    }
  }
  mirror("");
  return root;
}


describe("shadow evidence repositories", () => {
  it("mirrors dangling entries while preserving source alias semantics", () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), "eod-shadow-source-"));
    roots.push(sourceRoot);
    mkdirSync(join(sourceRoot, "data"));
    writeFileSync(join(sourceRoot, "data/value.txt"), "original");
    symlinkSync("missing-target", join(sourceRoot, "macro-site-link"), "file");
    symlinkSync("data", join(sourceRoot, "directory-alias"), "dir");
    symlinkSync(join("data", "value.txt"), join(sourceRoot, "file-alias"), "file");

    const shadow = shadowRepo({ "data/value.txt": "isolated" }, sourceRoot);
    const dangling = join(shadow, "macro-site-link");
    expect(lstatSync(dangling).isSymbolicLink()).toBe(true);
    expect(() => readFileSync(dangling)).toThrow(/ENOENT/);
    expect(readFileSync(join(shadow, "directory-alias/value.txt"), "utf8")).toBe("original");
    expect(readFileSync(join(shadow, "file-alias"), "utf8")).toBe("original");
    expect(readFileSync(join(shadow, "data/value.txt"), "utf8")).toBe("isolated");
    expect(readFileSync(join(sourceRoot, "data/value.txt"), "utf8")).toBe("original");
  });
});


describe("current EOD owner and native reader", () => {
  it("selects the same qualified manifest and preserves its actual capture identity", () => {
    const selected = qualifiedOptionsExposurePacket(REPO, "eod", owner.EOD_CROPS);
    const packet = owner.eodPacket(REPO);
    expect(packet.selection).toBe("qualified");
    expect(packet.path).toBe(relative(REPO, selected.evidence));
    expect(packet.sha256).toBe(selected.native.native_manifest_sha256);
    expect(packet.layoutFiles).toEqual(Object.fromEntries(selected.layout.map(file => [file, selected.sources[file]])));
    expect(packet.sourceFiles).toEqual(selected.sources);
    expect(packet.plan).toEqual({ required: false, changed: [] });
    expect(packet.capturedAtHead).toBe("90f275f15b4d174f003fb5b1087823dce6ec865a");
    expect(packet.captureRevision).toBe("options-integration-20261109");
    expect(packet.descriptorSha256).toBe("77b3b7f07746290cad33262a3d95c221e947a5acd5e940ae95b9d9458f510a18");
    const historical = JSON.parse(readFileSync(join(REPO, "terminal/docs/pr-crops/eod-heatmap-flowdesk-load-failure/operations/exposure-source-compatibility-20261105/revisions/ui-copy-integration-20261109/capture-execution.json"), "utf8"));
    expect(historical.branchHead).toBe("282ea2c40d839fecbe5ae5dc53de9c29a02850f6");
  });

  for (const file of ["terminal/components/flowdesk/FlowFreshnessReceipt.tsx", "terminal/components/flowdesk/InspectorPane.tsx",
    "terminal/components/gexdesk/GexSummaryBar.tsx", "terminal/lib/dte.ts",
    "terminal/e2e/exposure-partial-totals.spec.ts", "terminal/public/data/gex_fixture.json"]) {
    it("refuses reuse after mounted desk source drift: " + file, () => {
      const root = shadowRepo({ [file]: readFileSync(join(REPO, file), "utf8") + "\n// isolated source drift\n" });
      expect(() => owner.eodPacket(root)).toThrow(/NO_QUALIFIED_CAPTURE/);
    });
  }

  it("refuses a corrupted selected image through the actual owner", () => {
    const selected = qualifiedOptionsExposurePacket(REPO, "eod", owner.EOD_CROPS);
    const file = relative(REPO, join(selected.cropDir, "chainheat-retried-390.png"));
    const bytes = Buffer.from(readFileSync(join(REPO, file)));
    bytes[bytes.length - 1] ^= 1;
    const root = shadowRepo({ [file]: bytes });
    expect(() => owner.eodPacket(root)).toThrow(/INTEGRATION_NATIVE_IMAGE/);
  });

  it("refuses a changed descriptor rather than recapturing over history", () => {
    const selected = qualifiedOptionsExposurePacket(REPO, "eod", owner.EOD_CROPS);
    const file = relative(REPO, join(dirname(dirname(selected.evidence)), "native-packet.json"));
    const root = shadowRepo({ [file]: readFileSync(join(REPO, file), "utf8") + "\n" });
    expect(() => owner.eodPacket(root)).toThrow(/INTEGRATION_PACKET_DIGEST/);
  });

  it("refuses a removed declaration even when the historical root remains a valid raw manifest", () => {
    const file = "terminal/docs/pr-crops/eod-heatmap-flowdesk-load-failure/EVIDENCE.yml";
    const text = readFileSync(join(REPO, file), "utf8");
    const root = shadowRepo({ [file]: text.slice(text.indexOf("\n\n") + 2) });
    expect(() => owner.eodPacket(root)).toThrow(/EXPIRY_INTEGRATION_ROOT:eod/);
  });
});

describe("paired Options integration proof", () => {
  it("refuses a mixed current family declaration", () => {
    const file = "terminal/docs/pr-crops/gex-levels-heatmap-load-failure/EVIDENCE.yml";
    const root = shadowRepo({ [file]: readFileSync(join(REPO, file), "utf8").replace("options-integration-20261109", "ui-copy-integration-20261109") });
    expect(() => owner.eodPacket(root)).toThrow(/EXPIRY_INTEGRATION_ROOT:gex/);
  });
  it("refuses a complete-image receipt with an incomplete frame matrix", () => {
    const selected = qualifiedOptionsExposurePacket(REPO, "eod", owner.EOD_CROPS);
    const execution = structuredClone(selected.execution!);
    execution.frames.pop();
    expect(() => requireIntegrationExecution(execution, "eod", owner.EOD_CROPS, "options-integration")).toThrow(/INTEGRATION_FRAME_SET/);
  });
  it("refuses a current receipt without settled native-server proof", () => {
    const selected = qualifiedOptionsExposurePacket(REPO, "eod", owner.EOD_CROPS);
    const execution = structuredClone(selected.execution!);
    execution.nativeSupervisor!.serverReportedStopped = false;
    expect(() => requireIntegrationExecution(execution, "eod", owner.EOD_CROPS, "options-integration")).toThrow(/INTEGRATION_NATIVE_SETTLEMENT/);
  });
  for (const change of ["missing", "duplicate", "unrelated", "skipped"]) it("refuses a wrong complete browser identity set: " + change, () => {
    const base = join(REPO, "terminal/docs/verification/exposure-workspace-20261103");
    const historical = JSON.parse(readFileSync(join(base, "ui-copy-integration-20261109/qualification.json"), "utf8"));
    const current = JSON.parse(readFileSync(join(base, "options-integration-20261109/qualification.json"), "utf8"));
    requireOptionsIntegrationBrowserCases(current, historical);
    if (change === "missing") current.expectedPassed.pop();
    if (change === "duplicate") current.expectedPassed[1] = current.expectedPassed[0];
    if (change === "unrelated") current.expectedPassed[0] = "mobile|unrelated passing test";
    if (change === "skipped") current.expectedSkipped.push(current.expectedPassed.pop());
    expect(() => requireOptionsIntegrationBrowserCases(current, historical)).toThrow(/OPTIONS_INTEGRATION_BROWSER_CASE_SET/);
  });
});

describe("expiry integration with retained EOD identity", () => {
  const revision = "expiry-greeks-integration-20261110";
  const descriptorSha256 = "6432faf8713536aaa14319bb310289b26a68cfa5dd923801d2f4a7b7bf1fc453";
  const browserDir = join(REPO, "terminal/docs/verification/exposure-workspace-20261103", revision);
  const nativeDir = join(REPO, "terminal/docs/pr-crops/gex-levels-heatmap-load-failure/operations/exposure-source-compatibility-20261105/revisions", revision);
  const journey = () => JSON.parse(readFileSync(join(browserDir, "expiry-journeys/qualification.json"), "utf8"));
  const execution = () => JSON.parse(readFileSync(join(nativeDir, "capture-execution.json"), "utf8"));

  it("selects the fresh GEX packet through the shared owner without relabeling EOD", () => {
    const selected = qualifiedOptionsExposurePacket(REPO, "gex", gexCrops);
    const packet = owner.gexPacket(REPO);
    expect(packet.selection).toBe("qualified");
    expect(packet.path).toBe(relative(REPO, selected.evidence));
    expect(packet.path).toContain(revision + "/qualified-root/EVIDENCE.yml");
    expect(packet.sha256).toBe(selected.native.native_manifest_sha256);
    expect(packet.descriptorSha256).toBe(descriptorSha256);
    expect(packet.capturedAtHead).toBe("a985bf7f37b9a5a9fc490f8b3eb72be04869bfe4");
    expect(packet.captureRevision).toBe(revision);
    expect(packet.sourceFiles).toEqual(selected.sources);
    expect(packet.layoutFiles).toEqual(Object.fromEntries(selected.layout.map(file => [file, selected.sources[file]])));
    expect(packet.plan).toEqual({ required: false, changed: [] });
  });

  for (const file of ["terminal/components/gexdesk/ExpiryBars.tsx",
    "terminal/components/gexdesk/ExposureExpiryDrawer.tsx", "terminal/lib/expiryTermStructure.ts",
    "terminal/e2e/exposure-expiry-greeks.spec.ts", "terminal/e2e/responsive.spec.ts"]) {
    it("refuses retained EOD when expiry consumer proof drifts: " + file, () => {
      const root = shadowRepo({ [file]: readFileSync(join(REPO, file), "utf8") + "\n// isolated expiry source drift\n" });
      expect(() => owner.eodPacket(root)).toThrow(/NO_QUALIFIED_CAPTURE/);
    });
  }

  it("keeps validating the prior Options GEX descriptor", () => {
    const file = "terminal/docs/pr-crops/gex-levels-heatmap-load-failure/operations/exposure-source-compatibility-20261105/revisions/options-integration-20261109/native-packet.json";
    const root = shadowRepo({ [file]: readFileSync(join(REPO, file), "utf8") + "\n" });
    expect(() => owner.eodPacket(root)).toThrow(/OPTIONS_INTEGRATION_PACKET_DIGEST:gex/);
  });

  it("accepts the actual fresh native execution", () => {
    expect(() => requireIntegrationExecution(execution(), "gex", gexCrops, "expiry-greeks-integration")).not.toThrow();
  });

  it("refuses an old Options receipt relabeled as the fresh revision", () => {
    const file = join(REPO, "terminal/docs/pr-crops/gex-levels-heatmap-load-failure/operations/exposure-source-compatibility-20261105/revisions/options-integration-20261109/capture-execution.json");
    const prior = JSON.parse(readFileSync(file, "utf8"));
    prior.revision = revision;
    expect(() => requireIntegrationExecution(prior, "gex", gexCrops, "expiry-greeks-integration")).toThrow(/INTEGRATION_CAPTURE_IDENTITY/);
  });

  it("refuses to assign the fresh GEX identity to EOD", () => {
    const selected = qualifiedOptionsExposurePacket(REPO, "eod", owner.EOD_CROPS);
    expect(() => requireIntegrationExecution(selected.execution!, "eod", owner.EOD_CROPS, "expiry-greeks-integration")).toThrow(/EXPIRY_INTEGRATION_RETAINS_EOD_IDENTITY/);
  });

  for (const change of ["unreported stop", "unsettled", "timed out"]) {
    it("refuses native capture without settlement: " + change, () => {
      const value = execution();
      if (change === "unreported stop") value.nativeSupervisor.serverReportedStopped = false;
      if (change === "unsettled") value.nativeSupervisor.serverSettled = false;
      if (change === "timed out") value.nativeSupervisor.timedOut = true;
      expect(() => requireIntegrationExecution(value, "gex", gexCrops, "expiry-greeks-integration")).toThrow(/INTEGRATION_NATIVE_SETTLEMENT/);
    });
  }

  it("refuses a native receipt belonging to another capture", () => {
    const value = execution();
    value.nativeReceipt.captureId = "unrelated-capture";
    expect(() => requireIntegrationExecution(value, "gex", gexCrops, "expiry-greeks-integration")).toThrow(/INTEGRATION_NATIVE_RECEIPT/);
  });

  it("refuses an incomplete fresh native frame set", () => {
    const value = execution();
    value.frames.pop();
    expect(() => requireIntegrationExecution(value, "gex", gexCrops, "expiry-greeks-integration")).toThrow(/INTEGRATION_FRAME_SET/);
  });

  it("accepts the actual nine-case expiry browser matrix", () => {
    expect(() => requireExpiryGreeksBrowserCases(journey())).not.toThrow();
  });

  for (const change of ["missing", "duplicate", "unrelated", "wrong project", "skipped"]) {
    it("refuses an incomplete or substituted expiry browser matrix: " + change, () => {
      const proof = journey();
      if (change === "missing") proof.expectedPassed.pop();
      if (change === "duplicate") proof.expectedPassed[1] = proof.expectedPassed[0];
      if (change === "unrelated") proof.expectedPassed[0] = "mobile|unrelated passing test";
      if (change === "wrong project") proof.expectedPassed[0] = proof.expectedPassed[0].replace(/^[^|]+/, "unqualified-phone");
      if (change === "skipped") proof.expectedSkipped.push(proof.expectedPassed.pop());
      expect(() => requireExpiryGreeksBrowserCases(proof)).toThrow(/EXPIRY_INTEGRATION_BROWSER_CASE_SET/);
    });
  }

  const artifacts = (): Record<string, string> =>
    JSON.parse(readFileSync(join(browserDir, "expiry-journeys/browser-execution.json"), "utf8")).artifactFiles;

  it("accepts the actual 27 expiry screenshots", () => {
    expect(() => requireExpiryGreeksScreenshotSet(artifacts())).not.toThrow();
  });

  for (const change of ["missing", "duplicate basename", "unrelated substitution", "extra PNG"]) {
    it("refuses a partial or aliased screenshot set: " + change, () => {
      const files = artifacts();
      const [first, second] = Object.keys(files).filter(file => file.endsWith(".png"));
      if (change === "missing") delete files[first];
      if (change === "duplicate basename") {
        delete files[second];
        files["browser-artifacts/alias/" + first.split("/").at(-1)] = files[first];
      }
      if (change === "unrelated substitution") {
        const digest = files[first];
        delete files[first];
        files["browser-artifacts/unrelated.png"] = digest;
      }
      if (change === "extra PNG") files["browser-artifacts/extra.png"] = files[first];
      expect(() => requireExpiryGreeksScreenshotSet(files)).toThrow(/EXPIRY_INTEGRATION_JOURNEY_SCREENSHOT_SET/);
    });
  }
});
