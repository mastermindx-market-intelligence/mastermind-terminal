import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = join(__dirname, "../../..");
const CROP_DIR = join(__dirname, "../../docs/pr-crops/b-f12-9-team-ownership-transfer");
const EVIDENCE = join(CROP_DIR, "EVIDENCE.yml");
const LAYOUT_FILES = [
  "terminal/components/settings/SectionTeam.tsx",
  "terminal/components/settings/SectionTeam.module.css",
  "terminal/components/settings/SettingsPanel.tsx",
  "terminal/app/settings.css",
  "terminal/lib/i18n.tsx",
];
const BUTTON_FILES = [
  "desktop-en-transfer-button.png",
  "desktop-zh-transfer-button.png",
  "mobile-en-transfer-button.png",
  "mobile-zh-transfer-button.png",
];
const CONFIRM_FILES = [
  "desktop-en-transfer-confirm.png",
  "desktop-zh-transfer-confirm.png",
  "mobile-en-transfer-confirm.png",
  "mobile-zh-transfer-confirm.png",
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

describe("B-F12-9 evidence lock is the sha256 of the layout sources", () => {
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

  it("button crops record the transfer control; confirm crops record the consequence sentence", () => {
    const yml = evidenceText();
    for (const file of BUTTON_FILES) {
      expect(existsSync(join(CROP_DIR, file)), file).toBe(true);
      const row = measurement(yml, file);
      expect(row.transferButtonText, file).toBeTruthy();
    }
    for (const file of CONFIRM_FILES) {
      expect(existsSync(join(CROP_DIR, file)), file).toBe(true);
      const row = measurement(yml, file);
      expect(row.dialogPresent, file).toBe("true");
      expect(row.consequenceText, file).toBeTruthy();
      if (file.includes("-zh-")) {
        expect(row.consequenceText, file).toMatch(/[一-鿿]/);
      } else {
        expect(row.consequenceText, file).toMatch(/^You will become an administrator/);
      }
    }
  });

  it("EN/ZH twins are present for every crop both in the lock and on disk", () => {
    const listed = [...BUTTON_FILES, ...CONFIRM_FILES];
    for (const file of listed) {
      expect(existsSync(join(CROP_DIR, file)), file).toBe(true);
      if (file.includes("-en-")) {
        const zh = file.replace("-en-", "-zh-");
        expect(listed, `${file} is missing its ZH twin in the lock`).toContain(zh);
        expect(existsSync(join(CROP_DIR, zh)), zh).toBe(true);
      }
    }
  });
});
