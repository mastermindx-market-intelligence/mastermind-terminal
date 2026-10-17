import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type Evidence = {
  sourceHead: string;
  implementationFiles: Record<string, string>;
  capture: {
    viewports: Record<"desktop" | "tablet" | "mobile", string>;
    languages: string[];
    directionModes: string[];
    cases: string[];
  };
  browserResults: {
    expected: number;
    unexpected: number;
    skipped: number;
    flaky: number;
    reportSha256: string;
  };
  crops: Record<string, { sha256: string; bytes: number; width: number; height: number }>;
  scope: { data: string; deployment: string; alerts: string };
};

const terminalRoot = process.cwd();
const repoRoot = join(terminalRoot, "..");
const evidenceDir = join(terminalRoot, "docs/pr-crops/nine-bar-exhaustion");
const evidence = JSON.parse(readFileSync(join(evidenceDir, "EVIDENCE.json"), "utf8")) as Evidence;

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function pngDimensions(path: string): { width: number; height: number } {
  const png = readFileSync(path);
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

describe("Nine-Bar Exhaustion browser evidence", () => {
  it("binds the exact implementation and acceptance source bytes", () => {
    expect(evidence.sourceHead).toMatch(/^[0-9a-f]{40}$/);
    expect(Object.keys(evidence.implementationFiles).length).toBeGreaterThanOrEqual(12);
    for (const [relativePath, expected] of Object.entries(evidence.implementationFiles)) {
      expect(sha256(join(repoRoot, relativePath)), relativePath).toBe(expected);
    }
  });

  it("records a clean six-case browser report with no retries hidden as success", () => {
    const reportPath = join(evidenceDir, "browser-report.json");
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
      stats: { expected: number; unexpected: number; skipped: number; flaky: number };
    };
    expect(sha256(reportPath)).toBe(evidence.browserResults.reportSha256);
    expect(report.stats).toMatchObject({ expected: 6, unexpected: 0, skipped: 0, flaky: 0 });
    expect(evidence.browserResults).toMatchObject({ expected: 6, unexpected: 0, skipped: 0, flaky: 0 });
    expect(evidence.capture.cases).toEqual([
      "desktop/en/west", "desktop/zh/east",
      "tablet/en/west", "tablet/zh/east",
      "mobile/en/west", "mobile/zh/east",
    ]);
  });

  it("locks eighteen substantive responsive screenshots across language, direction, and lifecycle states", () => {
    expect(Object.keys(evidence.crops)).toHaveLength(18);
    const expectedDimensions = {
      desktop: { width: 1440, height: 900 },
      tablet: { width: 820, height: 1180 },
      mobile: { width: 390, height: 844 },
    } as const;
    for (const [name, receipt] of Object.entries(evidence.crops)) {
      expect(name).toMatch(/^(desktop|tablet|mobile)-(en-west|zh-east)-(tooltip|replay|persisted)\.png$/);
      const path = join(evidenceDir, name);
      expect(sha256(path), name).toBe(receipt.sha256);
      expect(readFileSync(path).byteLength, name).toBe(receipt.bytes);
      expect(receipt.bytes, `${name}: substantive capture`).toBeGreaterThan(50_000);
      const viewport = name.split("-", 1)[0] as keyof typeof expectedDimensions;
      expect(pngDimensions(path), name).toEqual(expectedDimensions[viewport]);
      expect({ width: receipt.width, height: receipt.height }, name).toEqual(expectedDimensions[viewport]);
    }
  });

  it("states the local-fixture and non-deployment limits explicitly", () => {
    expect(evidence.scope.data).toContain("not a live-provider freshness claim");
    expect(evidence.scope.deployment).toContain("not production deployment evidence");
    expect(evidence.scope.alerts).toContain("covered separately");
    expect(evidence.capture.languages).toEqual(["en", "zh"]);
    expect(evidence.capture.directionModes).toEqual(["west", "east"]);
  });
});
