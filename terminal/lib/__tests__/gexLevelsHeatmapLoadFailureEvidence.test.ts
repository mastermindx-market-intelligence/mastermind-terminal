// Git-free evidence lock for the GEX desk, Levels and Heatmap failure-state packet.
// The lock is the sha256 of the layout sources the crops depend on, recorded in
// EVIDENCE.yml layoutFiles. capturedAtHead stays informational.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO = join(__dirname, "../../..");
const CROP_DIR = join(__dirname, "../../docs/pr-crops/gex-levels-heatmap-load-failure");
const EVIDENCE = join(CROP_DIR, "EVIDENCE.yml");
// The sources e2e/tools/capture_gex_levels_heatmap_load_failure.cjs stamps (its LAYOUT_FILES).
const LAYOUT_FILES = [
  "terminal/app/globals.css",
  "terminal/components/gexdesk/ExposureWorkspace.module.css",
  "terminal/components/gexdesk/GexDeskView.tsx",
  "terminal/components/gexdesk/HeatSeekerCard.tsx",
  "terminal/components/gexdesk/MarketStateCard.tsx",
  "terminal/components/gexdesk/StrikeLadder.tsx",
  "terminal/components/gexdesk/gexStrings.ts",
  "terminal/components/heatmap/HeatmapView.tsx",
  "terminal/components/levels/LevelsView.tsx",
  "terminal/components/levels/levelsLabels.ts",
  "terminal/lib/dataCache.ts",
  "terminal/lib/heatmapStrings.ts",
];
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

function evidenceText(): string {
  return readFileSync(EVIDENCE, "utf8");
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
      const abs = join(CROP_DIR, file);
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
  it("validates the archived-refresh operation capture without replacing historical packet crops", () => {
    const evidence = evidenceText();
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
    const yml = evidenceText();
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
    const yml = evidenceText();
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

  it("binds the Paper hierarchy recapture to current sources and immutable operation crops", () => {
    const receipt = receiptSection(evidenceText(), "exposureHierarchyRecapture");
    const folder = "operations/exposure-1243-paper-hierarchy-fit-20261104";
    expect(receipt).toContain(`  outputDir: "${folder}"`);
    expect(receipt).toContain("  actualCases: 54");
    expect(receipt).toContain("  failedCases: 0");
    expect(receipt).toContain("  sourceStableAcrossCapture: true");
    expect(receipt).toContain('  packetRootCrops: "preserved at original committed bytes"');
    for (const rel of [...LAYOUT_FILES, "terminal/lib/exposureOrigin.ts", "terminal/lib/sectorDepthReturn.ts"]) {
      expect(receipt).toContain(`    ${rel}: "${sha256Of(join(REPO, rel))}"`);
    }
    const harness = "terminal/e2e/tools/capture_gex_levels_heatmap_load_failure.cjs";
    expect(receipt).toContain(`  captureHarnessSha256: "${sha256Of(join(REPO, harness))}"`);
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

});
