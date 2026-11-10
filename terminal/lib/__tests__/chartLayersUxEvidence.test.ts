// Git-free evidence lock for the chart-layers-ux-20260922 capture packet.
// The lock is EVIDENCE.json: fileSha256 holds the sha256 of the sources the
// crops depend on, cropSha256 the sha256 of each committed crop.
// e2e/chart-object-tree.spec.ts rewrites <project>-open.png and <project>-zh.png
// on every e2e run, so after a local e2e run restore them with
// `git checkout -- docs/pr-crops/chart-layers-ux-20260922` before `npm test`.
// CI runs vitest and e2e in separate jobs, so the vitest job never sees them.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO = join(__dirname, "../../..");
const CROP_DIR = join(__dirname, "../../docs/pr-crops/chart-layers-ux-20260922");
const EVIDENCE = join(CROP_DIR, "EVIDENCE.json");
const LOCKED_FILES = [
  "terminal/components/ChartObjectTree.tsx",
  "terminal/components/ChartObjectTree.module.css",
  "terminal/lib/__tests__/chartObjectTree.test.tsx",
  "terminal/e2e/chart-object-tree.spec.ts",
];
// The crops e2e/chart-object-tree.spec.ts writes. desktop-before.png has no producer.
const SPEC_CROPS = ["desktop", "tablet", "mobile"].flatMap((project) => [`${project}-open.png`, `${project}-zh.png`]);

interface Evidence {
  theme: string;
  fixture: boolean;
  viewports: Record<string, string>;
  languages: string[];
  fileSha256: Record<string, string>;
  cropSha256: Record<string, string>;
  recapture: { head: string; recapturedCrops: string[]; notRecaptured: Record<string, string> };
}

function evidence(): Evidence {
  return JSON.parse(readFileSync(EVIDENCE, "utf8")) as Evidence;
}

function sha256Of(abs: string): string {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

describe("chart-layers-ux-20260922 evidence lock is EVIDENCE.json", () => {
  it("EVIDENCE.json records a sha256 for every locked source", () => {
    const recorded = evidence().fileSha256;
    for (const rel of LOCKED_FILES) {
      expect(recorded[rel] ?? "", `fileSha256 is missing ${rel}`).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("each fileSha256 matches the file on disk", () => {
    for (const [rel, expected] of Object.entries(evidence().fileSha256)) {
      const abs = join(REPO, rel);
      expect(existsSync(abs), `${rel} is recorded in fileSha256 but absent from the tree`).toBe(true);
      expect(sha256Of(abs), `${rel} changed without a recapture`).toBe(expected);
    }
  });

  it("every crop is non-empty, listed in cropSha256 and matches its recorded sha256", () => {
    const recorded = evidence().cropSha256;
    const onDisk = readdirSync(CROP_DIR).filter((name) => name.endsWith(".png")).sort();
    expect(onDisk, "every crop needs a cropSha256 row and every row a crop").toEqual(Object.keys(recorded).sort());
    for (const name of [...SPEC_CROPS, "desktop-before.png"]) {
      expect(onDisk, `${name} is missing`).toContain(name);
    }
    for (const [name, expected] of Object.entries(recorded)) {
      const abs = join(CROP_DIR, name);
      expect(statSync(abs).size, `${name} is empty`).toBeGreaterThan(0);
      expect(sha256Of(abs), `${name} differs from its cropSha256 row`).toBe(expected);
    }
  });

  it("declares the dark-only theme, the fixture, both languages, the three viewports and the recaptured set", () => {
    const record = evidence();
    expect(record.theme).toBe("Terminal dark-only");
    expect(record.fixture).toBe(true);
    expect(record.languages).toEqual(["en", "zh"]);
    expect(record.viewports).toEqual({ desktop: "1440x900", tablet: "820x1180", mobile: "390x844" });
    expect(record.recapture.head).toMatch(/^[0-9a-f]{40}$/);
    expect([...record.recapture.recapturedCrops].sort()).toEqual([...SPEC_CROPS].sort());
    expect(Object.keys(record.recapture.notRecaptured)).toEqual(["desktop-before.png"]);
  });
});
