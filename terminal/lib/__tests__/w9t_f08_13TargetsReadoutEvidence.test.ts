// Git-free evidence lock for the W9T-F08-13 Settings portfolio-targets packet.
// Its capture script writes EVIDENCE.yml as JSON (layoutFiles is an object), so
// this gate parses JSON. The lock is the sha256 of the layout sources the crops
// depend on; capturedAtHead stays informational.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO = join(__dirname, "../../..");
const CROP_DIR = join(__dirname, "../../docs/pr-crops/w9t-f08-13-targets-readout");
const EVIDENCE = join(CROP_DIR, "EVIDENCE.yml");
// The sources e2e/tools/capture_w9t_f08_13_targets.cjs stamps (its LAYOUT_FILES).
const LAYOUT_FILES = [
  "terminal/components/settings/SectionPortfolioTargets.tsx",
  "terminal/components/settings/SettingsPanel.tsx",
  "terminal/components/settings/SettingsProvider.tsx",
  "terminal/components/settings/icons.tsx",
  "terminal/lib/i18n.tsx",
];
const CROPS = ["empty", "populated"].flatMap((state) =>
  [390, 1440].flatMap((width) => [
    `PortfolioTargetsSettings-${state}-${width}-en.png`,
    `PortfolioTargetsSettings-${state}-${width}-zh.png`,
  ]),
);

type Evidence = {
  layoutFiles?: Record<string, string>;
  theme?: string;
  capture_flag?: string;
  viewports?: { name: string; width: number; height: number }[];
  files?: string[];
};

function evidence(): Evidence {
  return JSON.parse(readFileSync(EVIDENCE, "utf8")) as Evidence;
}

function layoutFileMap(ev: Evidence): Record<string, string> {
  const map = ev.layoutFiles;
  if (!map || Object.keys(map).length === 0) throw new Error("EVIDENCE.yml layoutFiles is empty");
  return map;
}

function sha256Of(abs: string): string {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

describe("W9T-F08-13 Settings targets evidence lock is the sha256 of the layout sources", () => {
  it("EVIDENCE.yml records a sha256 for every source the capture script stamps", () => {
    const recorded = layoutFileMap(evidence());
    for (const rel of LAYOUT_FILES) {
      expect(recorded[rel] ?? "", `layoutFiles is missing ${rel}`).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("each layoutFiles sha256 matches the file on disk", () => {
    const recorded = layoutFileMap(evidence());
    for (const [rel, expected] of Object.entries(recorded)) {
      const abs = join(REPO, rel);
      expect(existsSync(abs), `${rel} is recorded in layoutFiles but absent from the tree`).toBe(true);
      expect(sha256Of(abs), `${rel} changed without a recapture`).toBe(expected);
    }
  });

  it("all dark crops exist, are non-empty and are the files EVIDENCE.yml lists", () => {
    expect(CROPS).toHaveLength(8);
    for (const file of CROPS) {
      const abs = join(CROP_DIR, file);
      expect(existsSync(abs), file).toBe(true);
      expect(statSync(abs).size, file).toBeGreaterThan(0);
    }
    expect([...(evidence().files ?? [])].sort()).toEqual([...CROPS].sort());
  });

  it("EVIDENCE.yml declares the capture flag, the dark theme and the two viewports", () => {
    const ev = evidence();
    expect(ev.capture_flag).toBe("TERMINAL_E2E_FIXTURE");
    expect(ev.theme).toBe("dark");
    expect(ev.viewports).toEqual([
      { name: "desktop", width: 1440, height: 900 },
      { name: "mobile", width: 390, height: 844 },
    ]);
  });
});
