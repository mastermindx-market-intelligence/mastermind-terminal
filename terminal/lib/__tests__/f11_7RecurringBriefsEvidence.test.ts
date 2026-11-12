import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readInboxPacket, regularBytes } from "../../e2e/tools/briefs_inbox_capture_contract.cjs";
import scope from "../../docs/briefs-explicit-language/RECURRING_INBOX_SCOPE_2026-11-11.json";

const REPO = join(__dirname, "../../..");
const CROP_DIR = join(__dirname, "../../docs/pr-crops/b-f11-7-recurring-briefs");
const EVIDENCE = join(CROP_DIR, "EVIDENCE.yml");
const LAYOUT_FILES = [
  "terminal/components/briefs/BriefsInbox.tsx",
  "terminal/components/briefs/BriefSubscribeControls.tsx",
  "terminal/components/briefs/briefs.module.css",
  "terminal/lib/briefs.ts",
  "terminal/components/alerts/AlertsCockpit.tsx",
];
const CROPS = [
  "list-1440.png",
  "list-1440-zh.png",
  "list-390.png",
  "list-390-zh.png",
  "empty-1440.png",
  "empty-1440-zh.png",
  "empty-390.png",
  "empty-390-zh.png",
  "subscribe-1440.png",
  "subscribe-1440-zh.png",
  "subscribe-390.png",
  "subscribe-390-zh.png",
];

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
    const m = line.match(/^  (\S+): "?([0-9a-f]{64})"?$/);
    if (!m) throw new Error(`layoutFiles row is not path: sha256: ${line}`);
    map[m[1]] = m[2];
  }
  if (Object.keys(map).length === 0) throw new Error("EVIDENCE.yml layoutFiles is empty");
  return map;
}

describe("B-F11-7 current inbox proof and preserved historical subscription packet", () => {
  it("no packet test file imports a process spawner", () => {
    const libDir = join(__dirname);
    const files = readdirSync(libDir)
      .filter((f) => /^(briefs|briefSubscriptions|BriefsInbox|f11_7RecurringBriefs).*\.test\.tsx?$/.test(f))
      .map((f) => join(libDir, f));
    expect(files.length).toBeGreaterThan(0);
    for (const abs of files) {
      const src = readFileSync(abs, "utf8");
      const bareChildProcess = ["child", "process"].join("_");
      const nodeChildProcess = ["node", bareChildProcess].join(":");
      expect(src.includes(nodeChildProcess), `${abs} imports ${nodeChildProcess}`).toBe(false);
      expect(src.includes(bareChildProcess), `${abs} imports ${bareChildProcess}`).toBe(false);
    }
  });

  it("the historical manifest retains its original layout bindings", () => {
    const recorded = layoutFileMap(evidenceText());
    for (const rel of LAYOUT_FILES) {
      expect(recorded[rel], `layoutFiles is missing ${rel}`).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("preserves all original mixed-packet bytes with an explicit historical scope", () => {
    expect(scope.producerActivation).toBe(false);
    expect(scope.productionAcceptance).toBe(false);
    expect(scope.historical.directory).toBe("terminal/docs/pr-crops/b-f11-7-recurring-briefs");
    expect(scope.historical.files.map(row => row.file).sort()).toEqual(["EVIDENCE.yml", ...CROPS].sort());
    for (const row of scope.historical.files) {
      const bytes = regularBytes(join(CROP_DIR, row.file));
      expect(createHash("sha256").update(bytes).digest("hex"), row.file).toBe(row.sha256);
    }
  });

  it("requires an independently qualified current eight-view inbox packet", () => {
    const packet = readInboxPacket(REPO);
    expect(packet.schema).toBe(scope.current.schema);
    expect(packet.cases).toHaveLength(8);
    expect(packet.cases.every((row: { kind: string }) => row.kind === "list" || row.kind === "empty")).toBe(true);
  });

  it("all twelve historical dark crops exist and are non-empty", () => {
    expect(CROPS).toHaveLength(12);
    for (const file of CROPS) {
      const abs = join(CROP_DIR, file);
      expect(existsSync(abs), file).toBe(true);
      expect(statSync(abs).size, file).toBeGreaterThan(0);
    }
  });

  it("the historical manifest declares its capture flag and dark-only scope", () => {
    const yml = evidenceText();
    expect(yml).toMatch(/capture_flag:\s*TERMINAL_E2E_FIXTURE/);
    expect(yml).toMatch(/DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06/);
    expect(yml).toMatch(/^theme:\s*dark$/m);
    expect(yml).toMatch(/capturedAtHead is informational\. The lock is layoutFiles\./);
  });
});
