import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = join(__dirname, "../../..");
const CROP_DIR = join(__dirname, "../../docs/pr-crops/terminal-visual-intelligence");
const EVIDENCE = join(CROP_DIR, "EVIDENCE.yml");

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function mapSection(text: string, name: string): Record<string, string> {
  const marker = `${name}:\n`;
  const start = text.indexOf(marker);
  if (start < 0) throw new Error(`missing ${name}`);
  const out: Record<string, string> = {};
  for (const line of text.slice(start + marker.length).split("\n")) {
    if (!line.startsWith("  ")) break;
    const match = line.match(/^  (\S+): "([0-9a-f]{64})"$/);
    if (!match) throw new Error(`invalid ${name} row: ${line}`);
    out[match[1]] = match[2];
  }
  return out;
}

function pngDimensions(path: string): [number, number] {
  const bytes = readFileSync(path);
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

describe("Terminal Visual Intelligence browser evidence", () => {
  const text = readFileSync(EVIDENCE, "utf8");

  it("locks the source files that determine the captured chart-context surface", () => {
    const recorded = mapSection(text, "layoutFiles");
    expect(Object.keys(recorded).length).toBeGreaterThanOrEqual(9);
    for (const [relative, expected] of Object.entries(recorded)) {
      const absolute = join(REPO, relative);
      expect(existsSync(absolute), relative).toBe(true);
      expect(sha256(absolute), `${relative} changed without a recapture`).toBe(expected);
    }
  });

  it("locks six real EN/ZH responsive browser crops", () => {
    const recorded = mapSection(text, "cropFiles");
    expect(Object.keys(recorded).sort()).toEqual([
      "desktop-context-zh.png", "desktop-context.png",
      "mobile-context-zh.png", "mobile-context.png",
      "tablet-context-zh.png", "tablet-context.png",
    ]);
    const expectedSize: Record<string, [number, number]> = {
      desktop: [1440, 900], tablet: [820, 1180], mobile: [390, 844],
    };
    for (const [file, expectedHash] of Object.entries(recorded)) {
      const absolute = join(CROP_DIR, file);
      expect(existsSync(absolute), file).toBe(true);
      expect(readFileSync(absolute).byteLength, `${file} is not a substantive crop`).toBeGreaterThan(50_000);
      expect(sha256(absolute), `${file} changed without updating evidence`).toBe(expectedHash);
      const viewport = file.split("-")[0];
      expect(pngDimensions(absolute), file).toEqual(expectedSize[viewport]);
    }
  });

  it("binds the actual complete bilingual responsive report and its named mobile crosshair case", () => {
    expect(text).toContain("theme: dark");
    expect(text).toContain("languages: [en, zh]");
    // Historical unit totals stay historical. Current unit/CI qualification is
    // independent; this reader verifies the actual visual browser run itself.
    expect(text).toContain("browserReportPath: browser-report.json");
    const reportPath = join(CROP_DIR, "browser-report.json");
    expect(existsSync(reportPath), "retained actual Playwright JSON report").toBe(true);
    const reportHashes = mapSection(text, "browserReportHashes");
    expect(sha256(reportPath)).toBe(reportHashes.visualReport);
    expect(reportHashes.mobileCrosshairReport).toBe(reportHashes.visualReport);
    type Case = { projectName: string; expectedStatus: string; status: string;
      results: { status: string; retry: number; errors?: unknown[]; error?: unknown }[] };
    type Suite = { suites?: Suite[]; specs?: { title: string; file: string; tests: Case[] }[] };
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
      errors: unknown[]; stats: { expected: number; unexpected: number; skipped: number; flaky: number; duration: number; startTime: string };
      suites: Suite[];
    };
    expect(report.errors).toEqual([]);
    expect(report.stats).toMatchObject({ expected: 30, unexpected: 0, skipped: 0, flaky: 0 });
    expect(report.stats.duration).toBeGreaterThan(0);
    expect(Number.isFinite(Date.parse(report.stats.startTime))).toBe(true);
    const cases: { title: string; file: string; test: Case }[] = [];
    const collect = (suite: Suite) => {
      for (const spec of suite.specs ?? []) for (const test of spec.tests) cases.push({ title: spec.title, file: spec.file, test });
      for (const child of suite.suites ?? []) collect(child);
    };
    report.suites.forEach(collect);
    const expectedTitles = [
      "saved startup timeframe hydrates chart context without stale SSR attributes",
      "default context explains plotted bars, toggles original overlays, and persists choices",
      "classic candles retain descriptive context without pretending to paint them",
      "historical crosshair inspection stays on the selected bar without relabeling current calendar knowledge",
      "real candle colors stay attached to price after chart-layer settings overwrite base series data",
      "context can be restored through the existing chart settings without a new preference owner",
      "table and CSV expose the same actual 3D bars and numeric context as the plotted chart",
      "replay consumer excludes current-calendar events and future numeric rows across viewport sizes",
      "an unavailable calendar and a delayed outgoing symbol never become fabricated event context",
      "Chinese context uses text alongside regional colors and remains keyboard dismissible",
    ];
    expect(cases).toHaveLength(30);
    expect([...new Set(cases.map(({ test }) => test.projectName))].sort()).toEqual(["desktop", "mobile", "tablet"]);
    for (const project of ["desktop", "tablet", "mobile"]) {
      const projectCases = cases.filter(({ test }) => test.projectName === project);
      expect(projectCases.map(({ title }) => title).sort(), project).toEqual([...expectedTitles].sort());
    }
    for (const { file, test } of cases) {
      expect(file).toBe("visual-intelligence.spec.ts");
      expect(test.expectedStatus).toBe("passed");
      expect(test.status).toBe("expected");
      expect(test.results).toHaveLength(1);
      expect(test.results[0]).toMatchObject({ status: "passed", retry: 0 });
      expect(test.results[0].errors ?? []).toEqual([]);
      expect(test.results[0].error).toBeUndefined();
    }
    const mobileCrosshair = cases.filter(({ title, test }) => test.projectName === "mobile" && title === expectedTitles[3]);
    expect(mobileCrosshair).toHaveLength(1);
    expect(mobileCrosshair[0].test.results[0].status).toBe("passed");
  });
});
