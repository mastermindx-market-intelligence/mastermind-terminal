// Git-free evidence lock for the GEX desk, Levels and Heatmap failure-state packet.
// The lock is the sha256 of the layout sources the crops depend on, recorded in
// EVIDENCE.yml layoutFiles. capturedAtHead stays informational.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { qualifiedOptionsExposurePacket } from "./helpers/optionsExposureEvidence";

const REPO = join(__dirname, "../../..");
const CROP_DIR = join(__dirname, "../../docs/pr-crops/gex-levels-heatmap-load-failure");
const OPERATION = join(CROP_DIR, "operations", "exposure-source-compatibility-20261105");
const HISTORICAL_EVIDENCE = join(OPERATION, "EVIDENCE.before.yml");
// The sources e2e/tools/capture_gex_levels_heatmap_load_failure.cjs stamps (its LAYOUT_FILES).
// The script's STATES; every state is cropped at each width, in English and Chinese.
const STATES = [
  "gex-ladder-unavailable",
  "gex-ladder-retried",
  "gex-ladder-absent",
  "gex-rail-unavailable",
  "gex-pick-absent",
  "gex-rail-retried",
  "gex-state-refresh-failed",
  "gex-live-refresh-failed",
  "gex-live-retried",
  "levels-unavailable",
  "levels-retried",
  "levels-absent",
  "levels-refresh-failed",
  "heatmap-unavailable",
  "heatmap-retried",
  "heatmap-absent",
  "heatmap-persisted-refresh-failed",
  "heatmap-persisted-refresh-refused",
  "heatmap-persisted-retried",
];
const PERSISTED_STATES = STATES.filter((state) => state.startsWith("heatmap-persisted-"));
const WIDTHS = [1440, 820, 390];
const CROPS = STATES.flatMap((state) =>
  WIDTHS.flatMap((width) => [`${state}-${width}.png`, `${state}-${width}-zh.png`]),
);

const selected = qualifiedOptionsExposurePacket(REPO, "gex", CROPS);
const CURRENT_CROP_DIR = selected.cropDir;
const EVIDENCE = selected.evidence;
const LAYOUT_FILES = selected.layout;

function evidenceText(): string {
  return readFileSync(EVIDENCE, "utf8");
}

function historicalEvidenceText(): string {
  return readFileSync(HISTORICAL_EVIDENCE, "utf8");
}

function layoutFileMap(yml: string): Record<string, string> {
  const marker = "layoutFiles:\n";
  const at = yml.indexOf(marker);
  if (at < 0) throw new Error("EVIDENCE.yml is missing layoutFiles");
  const map: Record<string, string> = {};
  for (const line of yml.slice(at + marker.length).split("\n")) {
    if (!line.startsWith("  ")) break;
    const match = line.match(/^  (\S+): "?([0-9a-f]{64})"?$/);
    if (!match) throw new Error(`layoutFiles row is not path: sha256: ${line}`);
    map[match[1]] = match[2];
  }
  if (Object.keys(map).length === 0) throw new Error("EVIDENCE.yml layoutFiles is empty");
  return map;
}

function harnessRow(yml: string, file: string): string | undefined {
  return yml.split("\n").find((line) => line.startsWith(`  ${file}: `));
}

function receiptSection(yml: string, key: string): string {
  const marker = "\n" + key + ":\n";
  const parts = yml.split(marker);
  if (parts.length !== 2) throw new Error("Expected one evidence receipt: " + key);
  const lines = (key + ":\n" + parts[1]).split("\n");
  const end = lines.findIndex((line, index) => index > 0 && /^[A-Za-z][\w-]*:/.test(line));
  return (end < 0 ? lines : lines.slice(0, end)).join("\n");
}

function sha256Of(abs: string): string {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

describe("GEX, Levels and Heatmap load-failure evidence lock is the sha256 of the layout sources", () => {
  it("EVIDENCE.yml records a sha256 for every source the capture script stamps", () => {
    const recorded = layoutFileMap(evidenceText());
    for (const rel of LAYOUT_FILES) {
      expect(recorded[rel] ?? "", `layoutFiles is missing ${rel}`).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("each layoutFiles sha256 matches the file on disk", () => {
    const recorded = layoutFileMap(evidenceText());
    for (const [rel, expected] of Object.entries(recorded)) {
      const abs = join(REPO, rel);
      expect(existsSync(abs), `${rel} is recorded in layoutFiles but absent from the tree`).toBe(true);
      expect(sha256Of(abs), `${rel} changed without a recapture`).toBe(expected);
    }
  });

  it("all dark crops exist, are non-empty and are listed in EVIDENCE.yml files and harness", () => {
    expect(CROPS).toHaveLength(114);
    const yml = evidenceText();
    for (const file of CROPS) {
      const abs = join(CURRENT_CROP_DIR, file);
      expect(existsSync(abs), file).toBe(true);
      expect(statSync(abs).size, file).toBeGreaterThan(0);
      expect(yml, `files is missing ${file}`).toContain(`\n  - ${file}\n`);
      expect(harnessRow(yml, file), `harness is missing ${file}`).toBeDefined();
    }
  });

  it("no harness row repeats a key (a flow mapping with two `then:` loses the first step)", () => {
    const yml = evidenceText();
    for (const file of CROPS) {
      const row = harnessRow(yml, file) ?? "";
      expect(row.match(/, then: /g)?.length ?? 0, `${file} has more than one then:`).toBeLessThanOrEqual(1);
    }
  });

  it("the persisted heatmap crops record that the browser's own IndexedDB copy was aged, not mocked", () => {
    const yml = evidenceText();
    expect(yml).toMatch(/persisted: the heatmap-persisted-\* states age the browser's own IndexedDB record/);
    for (const state of PERSISTED_STATES) {
      for (const width of WIDTHS) {
        expect(harnessRow(yml, `${state}-${width}.png`) ?? "").toMatch(/written to IndexedDB and aged 6h/);
      }
    }
  });

  it("EVIDENCE.yml declares the capture flag, the dark-only and dev-indicator laws and the three viewports", () => {
    const yml = evidenceText();
    expect(yml).toMatch(/capture_flag:\s*TERMINAL_E2E_FIXTURE/);
    expect(yml).toMatch(/DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06/);
    expect(yml).toMatch(/DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR/);
    expect(yml).toMatch(/^theme:\s*dark$/m);
    expect(yml).toMatch(/capturedAtHead is informational\. The lock is layoutFiles\./);
    for (const [name, width, height] of [
      ["desktop", 1440, 900],
      ["tablet", 820, 1180],
      ["mobile", 390, 844],
    ] as const) {
      expect(yml).toMatch(new RegExp(`name:\\s*${name},\\s*width:\\s*${width},\\s*height:\\s*${height}`));
    }
  });
  if (selected.hasExposureHistory) {
  it("validates the archived-refresh operation capture without replacing historical packet crops", () => {
    const evidence = historicalEvidenceText();
    const separator = "\nexposureArchivedRefreshRecapture:\n";
    const index = evidence.indexOf(separator);
    expect(index).toBeGreaterThan(0);
    const receipt = receiptSection(evidence, "exposureArchivedRefreshRecapture");
    const folder = "operations/exposure-1243-archive-refresh-20261104";
    const sourcePath = "terminal/components/gexdesk/GexDeskView.tsx";
    expect(receipt).toContain(`  source: "${sourcePath}"`);
    expect(receipt).toContain(`  currentSourceSha256: "9e6d33630f56c9f5b99617d4f3cf7972e93f93c23f5fc077740a1985b938fc32"`);
    expect(receipt).toContain(`  outputDir: "${folder}"`);
    expect(receipt).toContain("  actualCases: 54");
    expect(receipt).toContain("  failedCases: 0");
    expect(receipt).toContain('  packetRootCrops: "preserved at original committed bytes"');
    let count = 0;
    const states = ["gex-ladder-unavailable", "gex-ladder-retried", "gex-ladder-absent", "gex-rail-unavailable", "gex-pick-absent", "gex-rail-retried", "gex-state-refresh-failed", "gex-live-refresh-failed", "gex-live-retried"];
    for (const state of states) {
      for (const width of [1440, 820, 390]) {
        for (const language of ["", "-zh"]) {
          const file = `${state}-${width}${language}.png`;
          const path = join(CROP_DIR, folder, file);
          expect(existsSync(path), file).toBe(true);
          expect(statSync(path).size, file).toBeGreaterThan(1000);
          expect(receipt).toContain(`    ${file}: "${sha256Of(path)}"`);
          count++;
        }
      }
    }
    expect(count).toBe(54);
  });

  it("validates the sector-origin operation recapture and links the previous GEX source", () => {
    const yml = historicalEvidenceText();
    const boundary = "\nexposureSectorOriginRecapture:\n";
    const at = yml.indexOf(boundary);
    expect(at).toBeGreaterThan(0);
    const receipt = receiptSection(yml, "exposureSectorOriginRecapture");
    const folder = "operations/exposure-1243-sector-origin-20261104";
    expect(receipt).toContain(`  outputDir: "${folder}"`);
    expect(receipt).toContain(`  previousGexSourceSha256: "9e6d33630f56c9f5b99617d4f3cf7972e93f93c23f5fc077740a1985b938fc32"`);
    // This receipt describes its frozen historical source, not today's component.
    const historicalSources = {
      "terminal/components/gexdesk/GexDeskView.tsx": "66d82e8c956b551caad27661082211c74e7aaadd4be71ae643ad2748374ba85c",
      "terminal/lib/exposureOrigin.ts": "9104d1eb713f7a39f8e84d22d0afb3f6a323ecd5da9545cc40437b466d1c2aaf",
      "terminal/lib/sectorDepthReturn.ts": "fd8ee3f188cb2be12e5bb9f5c62071c664fe2898df8f7fa93c429b6c0e14459b",
    };
    for (const [rel, sha] of Object.entries(historicalSources)) {
      expect(receipt).toContain(`    ${rel}: "${sha}"`);
    }
    expect(receipt).toContain("  actualCases: 54");
    expect(receipt).toContain("  failedCases: 0");
    expect(receipt).toContain('  packetRootCrops: "restored or unchanged from previous committed bytes"');
    const states = ["gex-ladder-unavailable", "gex-ladder-retried", "gex-ladder-absent", "gex-rail-unavailable", "gex-pick-absent", "gex-rail-retried", "gex-state-refresh-failed", "gex-live-refresh-failed", "gex-live-retried"];
    let checked = 0;
    for (const state of states) {
      for (const width of [1440, 820, 390]) {
        for (const language of ["", "-zh"]) {
          const file = `${state}-${width}${language}.png`;
          const path = join(CROP_DIR, folder, file);
          expect(existsSync(path), file).toBe(true);
          expect(statSync(path).size, file).toBeGreaterThan(1000);
          expect(receipt).toContain(`    ${file}: "${sha256Of(path)}"`);
          checked++;
        }
      }
    }
    expect(checked).toBe(54);
  });


  it("retains the two original root-crop receipts in portable immutable copies", () => {
    const yml = historicalEvidenceText();
    const folder = "operations/exposure-1243-root-history-20261104";
    const workspace = yml.split("\nexposureWorkspaceRecapture:\n")[1]?.split("\nexposureFilterRecapture:\n")[0];
    const filters = yml.split("\nexposureFilterRecapture:\n")[1]?.split("\nexposureArchivedRefreshRecapture:\n")[0];
    const receipt = receiptSection(yml, "exposureLegacyPacketRootPreservation");
    expect(workspace).toBeTruthy();
    expect(filters).toBeTruthy();
    expect(receipt).toBeTruthy();
    expect(receipt).toContain('  originalCaptureLocation: "packet-root"');
    expect(receipt).toContain(`  retainedCopyDir: "${folder}"`);
    expect(receipt).toContain("  copiedFiles: 54");
    expect(receipt).toContain("  sourceSections: [exposureWorkspaceRecapture, exposureFilterRecapture]");
    const states = ["gex-ladder-unavailable", "gex-ladder-retried", "gex-ladder-absent", "gex-rail-unavailable", "gex-pick-absent", "gex-rail-retried", "gex-state-refresh-failed", "gex-live-refresh-failed", "gex-live-retried"];
    let count = 0;
    for (const state of states) {
      for (const width of [1440, 820, 390]) {
        for (const lang of ["", "-zh"]) {
          const name = `${state}-${width}${lang}.png`;
          const path = join(CROP_DIR, folder, name);
          expect(existsSync(path), name).toBe(true);
          expect(statSync(path).size, name).toBeGreaterThan(1000);
          const sha = sha256Of(path);
          // Both historical receipts originally described exactly these bytes.
          expect(workspace).toContain(`    ${name}: "${sha}"`);
          expect(filters).toContain(`    ${name}: "${sha}"`);
          expect(receipt).toContain(`    ${name}: "${sha}"`);
          count++;
        }
      }
    }
    expect(count).toBe(54);
  });

  it("preserves the Paper hierarchy receipt and immutable operation crops", () => {
    const receipt = receiptSection(historicalEvidenceText(), "exposureHierarchyRecapture");
    const folder = "operations/exposure-1243-paper-hierarchy-fit-20261104";
    expect(receipt).toContain(`  outputDir: "${folder}"`);
    expect(receipt).toContain("  actualCases: 54");
    expect(receipt).toContain("  failedCases: 0");
    expect(receipt).toContain("  sourceStableAcrossCapture: true");
    expect(receipt).toContain('  packetRootCrops: "preserved at original committed bytes"');
    // Preserve the accepted Paper operation as history. The following test binds
    // the newer source gate to its own capture and exact current source bytes.
    const priorPath = join(CROP_DIR, "operations/exposure-1243-lab-source-gate-20261104/EVIDENCE.before.yml");
    expect(sha256Of(priorPath)).toBe("1d118e1e7722c92175e353b83957d8faad70baabccfd9620bebf3a753500ef0a");
    const prior = readFileSync(priorPath, "utf8");
    expect(receipt).toBe(receiptSection(prior, "exposureHierarchyRecapture"));
    const expected = STATES.filter((state) => state.startsWith("gex-"))
      .flatMap((state) => [1440, 820, 390].flatMap((width) =>
        [`${state}-${width}.png`, `${state}-${width}-zh.png`]));
    expect(expected).toHaveLength(54);
    expect(readdirSync(join(CROP_DIR, folder)).filter((name) => name.endsWith(".png")).sort())
      .toEqual([...expected].sort());
    for (const name of expected) {
      const file = join(CROP_DIR, folder, name);
      expect(statSync(file).size, name).toBeGreaterThan(1000);
      expect(receipt).toContain(`    ${name}: "${sha256Of(file)}"`);
    }
  });


  it("preserves the qualified Lab source gate against frozen historical sources and crops", () => {
    const record = receiptSection(historicalEvidenceText(), "labSourceGateRecapture20261104");
    const folder = "operations/exposure-1243-lab-source-gate-20261104";
    expect(record).toContain(`  outputDir: "${folder}/gate-fixed"`);
    expect(record).toContain("  actualCases: 54");
    expect(record).toContain("  failedCases: 0");
    expect(record).toContain("  sourceStableAcrossCapture: true");
    const receiptPath = join(CROP_DIR, folder, "capture-receipt.json");
    expect(record).toContain(`  captureReceiptSha256: "${sha256Of(receiptPath)}"`);
    const native = JSON.parse(readFileSync(receiptPath, "utf8"));
    expect(native.exit).toBe(0);
    expect(native.source_stable).toBe(true);
    expect(native.failed_frames).toEqual([]);
    const sourceMap = join(REPO, "terminal/docs/verification/exposure-workspace-20261103/integration-20261104/lab-source-gate-20261104/original/source-final.json");
    expect(sha256Of(sourceMap)).toBe("11d189c3259e81d5b95e9e7a68f14268921086a6e749a1be48b9e3fb39911b93");
    const historical = JSON.parse(readFileSync(sourceMap, "utf8")) as Record<string, string>;
    const historicalLayout = Object.keys(layoutFileMap(historicalEvidenceText()));
    for (const rel of [...historicalLayout,
      "terminal/components/researchlab/OptionsResearchLab.tsx",
      "terminal/components/options-companion/GexMarketMemory.tsx",
      "terminal/components/researchlab/ResearchReportedGammaPanel.tsx",
      "terminal/components/researchlab/researchReportedGamma.ts",
    ]) {
      const actual = historical[rel];
      expect(actual, rel).toMatch(/^[0-9a-f]{64}$/);
      expect(record).toContain(`    ${rel}: "${actual}"`);
      expect(native.source_sha256[rel]).toBe(actual);
    }
    const harness = "terminal/e2e/tools/capture_gex_levels_heatmap_load_failure.cjs";
    expect(record).toContain(`  currentCaptureHarnessSha256: "${historical[harness]}"`);
    expect(native.source_sha256[harness]).toBe(historical[harness]);
    const expected = CROPS.filter(name => name.startsWith("gex-"));
    expect(expected).toHaveLength(54);
    expect(Object.keys(native.image_sha256).sort()).toEqual([...expected].sort());
    expect(readdirSync(join(CROP_DIR, folder, "gate-fixed")).filter(name => name.endsWith(".png")).sort())
      .toEqual([...expected].sort());
    for (const name of expected) {
      const file = join(CROP_DIR, folder, "gate-fixed", name);
      expect(statSync(file).size, name).toBeGreaterThan(1000);
      expect(sha256Of(file), name).toBe(native.image_sha256[name]);
      expect(record).toContain(`    ${name}: "${sha256Of(file)}"`);
    }
  });

  }

  if (selected.profile === "exposure") {
  it("reconciles retained native capture with fresh boundary proof and preserves historical image sets", () => {
    const folder = "operations/exposure-source-compatibility-20261105";
    const rootEvidence = readFileSync(join(CROP_DIR, "EVIDENCE.yml"), "utf8");
    const record = receiptSection(rootEvidence, "exposureSourceCompatibility20261105");
    expect(record).toContain('  activeManifest: "' + folder + '/qualified-root/EVIDENCE.yml"');
    expect(record).toContain('  priorManifest: "' + folder + '/EVIDENCE.before.yml"');
    expect(sha256Of(HISTORICAL_EVIDENCE)).toBe("fdbbde228018ceaf5073624f4bbf8b7c517a7bb86f27c94d93423d6619a3434e");
    const protectedEvidence = join(OPERATION, "EVIDENCE.protected.yml");
    expect(sha256Of(protectedEvidence)).toBe("f802daa53147e8a771e01a6dd896c7991ab56a8ad3b520c9f7716726a7bbce34");
    expect(rootEvidence.endsWith(readFileSync(protectedEvidence, "utf8"))).toBe(true);

    const receiptPath = join(OPERATION, "capture-receipt.json");
    expect(record).toContain('  captureReceiptSha256: "' + sha256Of(receiptPath) + '"');
    const native = JSON.parse(readFileSync(receiptPath, "utf8"));
    expect(native.operation).toBe("exposure-source-compatibility-20261105");
    expect(native.protectedBase).toBe("11531481b0a540ee96bcd86df418fd1e42715363");
    expect(native.kind).toBe("gex");
    expect(native.exit).toBe(0);
    expect(native.expected).toBe(114);
    expect(native.successful_files).toBe(114);
    expect(native.source_stable).toBe(true);
    expect(native.failed_frames).toEqual([]);
    expect(native.native_manifest_sha256).toBe(sha256Of(EVIDENCE));
    expect(record).toContain('  activeManifestSha256: "' + sha256Of(EVIDENCE) + '"');
    expect(native.log_sha256).toBe(sha256Of(join(OPERATION, "capture.log")));
    const requiredSources = [...LAYOUT_FILES,
      "terminal/lib/idbJsonStore.ts",
      "terminal/components/researchlab/OptionsResearchLab.tsx",
      "terminal/components/options-companion/GexMarketMemory.tsx",
      "terminal/components/researchlab/ResearchReportedGammaPanel.tsx",
      "terminal/components/researchlab/researchReportedGamma.ts",
      "terminal/e2e/tools/capture_gex_levels_heatmap_load_failure.cjs",
    ];
    expect(Object.keys(native.source_sha256).sort()).toEqual([...requiredSources].sort());
    // The native scenes never enter Research Lab. Preserve their exact f12
    // source identity, then reconcile the one unexercised source transition.
    const capturedMapPath = join(REPO, "terminal/docs/verification/exposure-workspace-20261103/source-compatibility-20261105/original/browser-source-after.json");
    expect(sha256Of(capturedMapPath)).toBe("f1c54ada9ecc0da40ed379c8c622483f602915d9eaf2f7967258e5b9081bc6db");
    const captured = JSON.parse(readFileSync(capturedMapPath, "utf8")) as Record<string, string>;
    for (const rel of requiredSources) expect(native.source_sha256[rel], rel).toBe(captured[rel]);
    const restoredLab = "terminal/components/researchlab/OptionsResearchLab.tsx";
    const changed = requiredSources.filter(rel => native.source_sha256[rel] !== sha256Of(join(REPO, rel)));
    expect(changed).toEqual([restoredLab]);
    expect(native.source_sha256[restoredLab]).toBe("1b9bfeaa9ae3a9460fcecd812a98dcd8ef6591df0041d5dc4a53bde6dc2daf8b");
    expect(sha256Of(join(REPO, restoredLab))).toBe("365223a8182effc04fa956a8004062aa86c1426de8fc24eccebf6952e1571820");

    const boundaryDir = join(REPO, "terminal/docs/verification/exposure-workspace-20261103/boundary-compatibility-20261105");
    const qualification = JSON.parse(readFileSync(join(boundaryDir, "qualification.json"), "utf8"));
    expect(qualification.schema).toBe("options_lab_boundary_compatibility.v1");
    expect(qualification.capture_commit).toBe("f12ad44115d69b1bcd7cd453d69a689c9d6768a8");
    const boundarySources = [
      "terminal/components/gexdesk/GexDeskView.tsx",
      "terminal/components/researchlab/AdmittedOptionsResearchLab.tsx",
      restoredLab,
      "terminal/components/options-companion/GexMarketMemory.tsx",
      "terminal/components/researchlab/ResearchReportedGammaPanel.tsx",
      "terminal/components/researchlab/researchReportedGamma.ts",
      "terminal/lib/dataCache.ts", "terminal/lib/idbJsonStore.ts",
      "terminal/lib/flowClientCache.ts", "terminal/lib/optionsCompanion.ts",
      "terminal/lib/__tests__/researchLabSourceAvailability.test.tsx",
      "terminal/lib/__tests__/fixtures/reportedGammaBooks.ts",
      "terminal/lib/__tests__/fixtures/exposure-projection-observed-v2.json",
      "terminal/e2e/options-lab-source-state.spec.ts",
    ];
    expect(Object.keys(qualification.boundary_sources).sort()).toEqual([...boundarySources].sort());
    for (const mode of ["original", "preview"]) {
      const proof = qualification.browser[mode];
      const receiptFile = join(boundaryDir, mode, "browser-receipt.json");
      const mapFile = join(boundaryDir, mode, "browser-source-after.json");
      expect(sha256Of(receiptFile)).toBe(proof.receipt_sha256);
      expect(sha256Of(mapFile)).toBe(proof.source_map_sha256);
      const receipt = JSON.parse(readFileSync(receiptFile, "utf8"));
      const sourceMap = JSON.parse(readFileSync(mapFile, "utf8")) as Record<string, string>;
      expect(receipt.exit).toBe(0);
      expect(receipt.source_stable).toBe(true);
      expect(receipt.retries).toBe(0);
      expect(receipt.passed).toBe(mode === "original" ? 12 : 18);
      expect(receipt.source_map_sha256).toBe(proof.source_map_sha256);
      expect(receipt.log_sha256).toBe(sha256Of(join(boundaryDir, mode, "browser.log")));
      expect(receipt.command).toContain("e2e/options-lab-source-state.spec.ts");
      for (const rel of boundarySources) {
        expect(sourceMap[rel], mode + ": " + rel).toBe(sha256Of(join(REPO, rel)));
        expect(qualification.boundary_sources[rel], rel).toBe(sourceMap[rel]);
      }
    }
    expect(Object.keys(native.image_sha256).sort()).toEqual([...CROPS].sort());
    expect(readdirSync(CURRENT_CROP_DIR).filter(name => name.endsWith(".png")).sort()).toEqual([...CROPS].sort());

    expect(sha256Of(join(OPERATION, "prior-root-sha256.json"))).toBe("aa3b3b9e069939d15f5c885457942d535ee6c29079340071f5a64c755d64febf");
    expect(sha256Of(join(OPERATION, "protected-root-sha256.json"))).toBe("6c8f8f3e4aa200a20b1690a81d124da3e4d0cd7e800af1c24c04eabef5b7c0a1");
    const prior = JSON.parse(readFileSync(join(OPERATION, "prior-root-sha256.json"), "utf8")) as Record<string, string>;
    const protectedImages = JSON.parse(readFileSync(join(OPERATION, "protected-root-sha256.json"), "utf8")) as Record<string, string>;
    expect(Object.keys(prior).sort()).toEqual([...CROPS].sort());
    expect(Object.keys(protectedImages).sort()).toEqual([...CROPS].sort());
    for (const name of CROPS) {
      expect(sha256Of(join(CURRENT_CROP_DIR, name)), name).toBe(native.image_sha256[name]);
      expect(sha256Of(join(OPERATION, "prior-root", name)), name).toBe(prior[name]);
      expect(sha256Of(join(CROP_DIR, name)), name).toBe(protectedImages[name]);
    }
  });
  }

});
