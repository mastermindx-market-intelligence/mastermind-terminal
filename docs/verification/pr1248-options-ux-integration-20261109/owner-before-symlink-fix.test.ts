import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { qualifiedOptionsExposurePacket, requireIntegrationExecution, requireOptionsIntegrationBrowserCases } from "./helpers/optionsExposureEvidence";

const REPO = join(__dirname, "../../..");
const owner = createRequire(import.meta.url)("../../e2e/tools/capture_ci_evidence.cjs") as {
  EOD_CROPS: string[];
  eodPacket(repo: string): {
    selection?: string; path: string; sha256: string; descriptorSha256?: string;
    captureRevision?: string; capturedAtHead: string | null;
    layoutFiles: Record<string, string>; sourceFiles?: Record<string, string>;
    plan: { required: boolean; changed: string[] };
  };
};
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function shadowRepo(overrides: Record<string, Buffer | string>): string {
  const root = mkdtempSync(join(tmpdir(), "eod-qualified-consumer-"));
  roots.push(root);
  const keys = Object.keys(overrides);
  function mirror(folder: string): void {
    mkdirSync(join(root, folder), { recursive: true });
    for (const name of readdirSync(join(REPO, folder))) {
      const file = folder ? folder + "/" + name : name;
      const source = join(REPO, file), target = join(root, file);
      if (Object.hasOwn(overrides, file)) writeFileSync(target, overrides[file]);
      else if (keys.some(key => key.startsWith(file + "/"))) mirror(file);
      else symlinkSync(source, target, statSync(source).isDirectory() ? "dir" : "file");
    }
  }
  mirror("");
  return root;
}

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
    expect(packet.capturedAtHead).toBe("753b4a90ebd31a1da76a9595bb2fedde912da042");
    expect(packet.captureRevision).toBe("options-ux-integration-20261109");
    const historical = JSON.parse(readFileSync(join(REPO, "terminal/docs/pr-crops/eod-heatmap-flowdesk-load-failure/operations/exposure-source-compatibility-20261105/revisions/ui-copy-integration-20261109/capture-execution.json"), "utf8"));
    expect(historical.branchHead).toBe("282ea2c40d839fecbe5ae5dc53de9c29a02850f6");
  });

  for (const file of ["terminal/components/flowdesk/FlowFreshnessReceipt.tsx", "terminal/components/flowdesk/InspectorPane.tsx",
    "terminal/components/gexdesk/GexSummaryBar.tsx", "terminal/lib/dte.ts",
    "terminal/e2e/exposure-partial-totals.spec.ts", "terminal/public/data/gex_fixture.json",
    "terminal/components/flowdesk/CommandResearch.module.css", "terminal/components/levels/levelsNavigation.ts",
    "terminal/components/workspaces/OptionsWorkspace.tsx", "terminal/public/data/flow_fixture.json",
    "terminal/app/api/flow/route.ts", "terminal/e2e/options-r1-w3a-flow-inspector.spec.ts"]) {
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
    expect(() => owner.eodPacket(root)).toThrow(/MISSING_PACKET_DECLARATION/);
  });
});

describe("paired Options integration proof", () => {
  it("refuses a mixed current family declaration", () => {
    const file = "terminal/docs/pr-crops/gex-levels-heatmap-load-failure/EVIDENCE.yml";
    const root = shadowRepo({ [file]: readFileSync(join(REPO, file), "utf8").replace("options-ux-integration-20261109", "options-integration-20261109") });
    expect(() => owner.eodPacket(root)).toThrow(/OPTIONS_INTEGRATION_ROOT/);
  });
  it("refuses a complete-image receipt with an incomplete frame matrix", () => {
    const selected = qualifiedOptionsExposurePacket(REPO, "eod", owner.EOD_CROPS);
    const execution = structuredClone(selected.execution!);
    execution.frames.pop();
    expect(() => requireIntegrationExecution(execution, "eod", owner.EOD_CROPS, "options-workspace")).toThrow(/INTEGRATION_FRAME_SET/);
  });
  it("refuses a current receipt without settled native-server proof", () => {
    const selected = qualifiedOptionsExposurePacket(REPO, "eod", owner.EOD_CROPS);
    const execution = structuredClone(selected.execution!);
    execution.nativeSupervisor!.serverReportedStopped = false;
    expect(() => requireIntegrationExecution(execution, "eod", owner.EOD_CROPS, "options-workspace")).toThrow(/INTEGRATION_NATIVE_SETTLEMENT/);
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

  it("rejects a predecessor identity attached to current capture bytes", () => {
    const selected = qualifiedOptionsExposurePacket(REPO, "eod", owner.EOD_CROPS);
    const execution = structuredClone(selected.execution!);
    execution.branchHead = "90f275f15b4d174f003fb5b1087823dce6ec865a";
    expect(() => requireIntegrationExecution(execution, "eod", owner.EOD_CROPS, "options-workspace"))
      .toThrow(/INTEGRATION_CAPTURE_IDENTITY/);
  });
  for (const family of ["eod-heatmap-flowdesk-load-failure", "gex-levels-heatmap-load-failure"]) {
    it("validates archived predecessor declarations independently for " + family, () => {
      const file = "terminal/docs/pr-crops/" + family + "/operations/exposure-source-compatibility-20261105/revisions/options-ux-integration-20261109/EVIDENCE.before.yml";
      const root = shadowRepo({ [file]: readFileSync(join(REPO, file), "utf8") + "\n" });
      expect(() => owner.eodPacket(root)).toThrow(/OPTIONS_INTEGRATION_PAYLOAD/);
    });
    it("retains the complete old Options descriptor for " + family, () => {
      const file = "terminal/docs/pr-crops/" + family + "/operations/exposure-source-compatibility-20261105/revisions/options-integration-20261109/native-packet.json";
      const root = shadowRepo({ [file]: readFileSync(join(REPO, file), "utf8") + "\n" });
      expect(() => owner.eodPacket(root)).toThrow(/OPTIONS_INTEGRATION_PACKET_DIGEST/);
    });
  }
  for (const change of ["missing", "duplicate", "unrelated", "skipped"]) it("refuses a wrong workspace browser identity set: " + change, () => {
    const base = join(REPO, "terminal/docs/verification/exposure-workspace-20261103");
    const historical = JSON.parse(readFileSync(join(base, "options-integration-20261109/qualification.json"), "utf8"));
    const current = JSON.parse(readFileSync(join(base, "options-ux-integration-20261109/qualification.json"), "utf8"));
    requireOptionsIntegrationBrowserCases(current, historical, "options-workspace");
    if (change === "missing") current.expectedPassed.pop();
    if (change === "duplicate") current.expectedPassed[1] = current.expectedPassed[0];
    if (change === "unrelated") current.expectedPassed[0] = "mobile|unrelated passing test";
    if (change === "skipped") current.expectedSkipped.push(current.expectedPassed.pop());
    expect(() => requireOptionsIntegrationBrowserCases(current, historical, "options-workspace")).toThrow(/OPTIONS_INTEGRATION_BROWSER_CASE_SET/);
  });
});
