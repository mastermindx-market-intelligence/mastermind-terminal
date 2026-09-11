// B-F12-B5-3b evidence lock: sha256 of the account-completeness layout
// sources recorded in EVIDENCE.yml. capturedAtHead is informational and
// must name the code commit the pixels depict.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = join(__dirname, "../../..");
const CROP_DIR = join(__dirname, "../../docs/pr-crops/b-f12-b5-3-account-completeness");
const EVIDENCE = join(CROP_DIR, "EVIDENCE.yml");
const LAYOUT_FILES = [
  "terminal/components/settings/SectionAccount.tsx",
  "terminal/lib/teamSummary.ts",
  "terminal/lib/i18n.tsx",
  "terminal/components/settings/SettingsPanel.tsx",
  "terminal/components/settings/SettingsProvider.tsx",
];
const CROP_FILES = [
  "desktop-en-overview.png",
  "desktop-zh-overview.png",
  "desktop-en-password.png",
  "desktop-zh-password.png",
  "mobile-en-overview.png",
  "mobile-zh-overview.png",
  "mobile-en-password.png",
  "mobile-zh-password.png",
];

function evidenceText(): string {
  return readFileSync(EVIDENCE, "utf8");
}

function capturedAtHead(yml: string): string {
  const m = yml.match(/^(?:# )?capturedAtHead: ([0-9a-f]{40})$/m);
  if (!m) throw new Error("EVIDENCE.yml is missing a 40-char capturedAtHead");
  return m[1];
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

function sha256Of(abs: string): string {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function measurement(yml: string, file: string): Record<string, string> {
  const re = new RegExp(`^  ${escapeRegExp(file)}: \\{(.+)\\}$`, "m");
  const m = yml.match(re);
  if (!m) throw new Error(`EVIDENCE.yml is missing measurements for ${file}`);
  const fields: Record<string, string> = {};
  for (const part of m[1].split(",")) {
    const kv = part.trim().match(/^(\w+): (.+)$/);
    if (!kv) continue;
    fields[kv[1]] = kv[2].replace(/^"|"$/g, "");
  }
  return fields;
}

describe("B-F12-B5-3b evidence lock", () => {
  it("capturedAtHead remains recorded as an informational field", () => {
    expect(capturedAtHead(evidenceText())).toMatch(/^[0-9a-f]{40}$/);
  });

  it("layout file sha256 matches EVIDENCE.yml (RED when a layout file changes without a recapture)", () => {
    const recorded = layoutFileMap(evidenceText());
    for (const rel of LAYOUT_FILES) {
      expect(recorded[rel], `layoutFiles is missing ${rel}`).toMatch(/^[0-9a-f]{64}$/);
    }
    for (const [rel, expected] of Object.entries(recorded)) {
      const abs = join(REPO, rel);
      expect(existsSync(abs), `${rel} is recorded in layoutFiles but absent from the tree`).toBe(true);
      expect(sha256Of(abs), `${rel} changed without a recapture`).toBe(expected);
    }
  });

  it("EN/ZH twins are present for every crop", () => {
    for (const file of CROP_FILES) {
      expect(existsSync(join(CROP_DIR, file)), file).toBe(true);
    }
  });

  it("ZH team-line measurements use 你, never 您", () => {
    const yml = evidenceText();
    for (const file of ["desktop-zh-overview.png", "desktop-zh-password.png", "mobile-zh-overview.png", "mobile-zh-password.png"]) {
      const row = measurement(yml, file);
      expect(row.teamLine, file).toContain("你");
      expect(row.teamLine, file).not.toContain("您");
    }
  });

  it("discloses the capture-time /api/teams route stub as the fixture source of the team line", () => {
    const yml = evidenceText();
    expect(yml).toMatch(/capture_b_f12_b5_3_account_completeness\.cjs:125-133/);
    expect(yml).toMatch(/api\/teams/);
  });
});
