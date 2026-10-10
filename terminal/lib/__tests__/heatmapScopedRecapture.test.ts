import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { updateHeatmapEvidence } = require("../../e2e/tools/capture_gex_levels_heatmap_load_failure.cjs");
const heatmap = "terminal/components/heatmap/HeatmapView.tsx";
const other = "terminal/components/gexdesk/GexDeskView.tsx";
const oldHash = "a".repeat(64);
const newHash = "b".repeat(64);
const otherHash = "c".repeat(64);
const files = ["heatmap-unavailable", "heatmap-retried", "heatmap-absent"].flatMap((state) =>
  [1440, 820, 390].flatMap((width) => [`${state}-${width}.png`, `${state}-${width}-zh.png`]),
);
const previous = [
  "# capturedAtHead: original-head",
  "layoutFiles:",
  `  ${heatmap}: "${oldHash}"`,
  `  ${other}: "${otherHash}"`,
  "theme: dark",
  "harness:",
  ...files.map((file) => `  ${file}: { fixture: original }`),
  "files:",
  ...files.map((file) => `  - ${file}`),
  "  - gex-ladder-absent-1440.png",
  "",
].join("\n");
const receipt = () => ({
  files: [...files],
  layoutFiles: { [heatmap]: newHash, [other]: otherHash },
  cropHashes: Object.fromEntries(files.map((file) => [file, "d".repeat(64)])),
  capturedAtHead: "f".repeat(40),
  capturedAt: "2026-10-10T06:40:00.000Z",
});

describe("Heatmap-only recapture preserves the evidence authority of other boards", () => {
  it("updates only the affected layout hash and appends exact crop provenance", () => {
    const updated = updateHeatmapEvidence(previous, receipt());
    expect(updated.split("scopedRecaptures:\n")[0]).toBe(previous.replace(oldHash, newHash));
    expect(updated).toContain("# capturedAtHead: original-head");
    expect(updated).toContain(`    capturedAtHead: ${"f".repeat(40)}`);
    for (const file of files) expect(updated).toContain(`      ${file}: "${"d".repeat(64)}"`);
  });

  it("refuses a missing capture, duplicate capture, or unrelated board capture", () => {
    for (const captured of [files.slice(1), [...files, files[0]], [...files, "gex-ladder-absent-1440.png"]]) {
      expect(() => updateHeatmapEvidence(previous, { ...receipt(), files: captured })).toThrow(/all 18/);
    }
  });

  it("refuses changed or omitted sources outside HeatmapView", () => {
    expect(() => updateHeatmapEvidence(previous, {
      ...receipt(), layoutFiles: { [heatmap]: newHash, [other]: newHash },
    })).toThrow(/outside HeatmapView/);
    expect(() => updateHeatmapEvidence(previous, {
      ...receipt(), layoutFiles: { [heatmap]: newHash },
    })).toThrow(/layout source set/);
  });

  it("refuses missing or malformed crop hashes", () => {
    const absent = receipt();
    delete absent.cropHashes[files[0]];
    expect(() => updateHeatmapEvidence(previous, absent)).toThrow(/crop hash/);
    expect(() => updateHeatmapEvidence(previous, {
      ...receipt(), cropHashes: { ...receipt().cropHashes, [files[0]]: "invalid" },
    })).toThrow(/crop hash/);
  });

  it("refuses a crop omitted from the inherited file list or harness", () => {
    expect(() => updateHeatmapEvidence(previous.replace(`  - ${files[0]}\n`, ""), receipt())).toThrow(/inherited/);
    expect(() => updateHeatmapEvidence(previous.replace(`  ${files[0]}: { fixture: original }\n`, ""), receipt())).toThrow(/inherited/);
  });

  it("refuses duplicate layout rows rather than selecting one silently", () => {
    expect(() => updateHeatmapEvidence(previous.replace("theme: dark", `  ${heatmap}: "${oldHash}"\ntheme: dark`), receipt())).toThrow(/duplicate/);
  });

  it("refuses absent section markers and malformed inherited rows", () => {
    for (const marker of ["layoutFiles:\n", "files:\n"]) {
      expect(() => updateHeatmapEvidence(previous.replace(marker, ""), receipt())).toThrow(/inherited/);
    }
    expect(() => updateHeatmapEvidence(previous.replace(otherHash, "invalid"), receipt())).toThrow(/inherited/);
  });
});
