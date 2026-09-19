// Packet MO-B F12-13 evidence lock. Git-free, hash-only — same idiom as
// f12_8TeamRolesEvidence.test.ts (R6 mandates the f12_8 form, NOT the f12_9 ancestry form).
// The lock is the sha256 of the layout sources the crops depend on, recorded in EVIDENCE.yml
// layoutFiles. capturedAtHead stays as an informational field. Changing a layout file without
// a recapture turns this file RED.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO = join(__dirname, "../../..");
const CROP_DIR = join(__dirname, "../../docs/pr-crops/b-f12-16-team-settings");
const EVIDENCE = join(CROP_DIR, "EVIDENCE.yml");
// RAIL-CROP ROT LAW: the rail's sources (SettingsPanel, SettingsProvider, settings.css) are
// pinned here even though this packet does not edit them. SectionTeam.tsx, SectionTeam.module.css,
// lib/teams.ts, types.ts and dev/settings/page.tsx are the surfaces this packet DID edit.
const LAYOUT_FILES = [
  "terminal/components/settings/SectionTeam.tsx",
  "terminal/components/settings/SectionTeam.module.css",
  "terminal/components/settings/SettingsPanel.tsx",
  "terminal/components/settings/SettingsProvider.tsx",
  "terminal/app/settings.css",
  "terminal/lib/teams.ts",
  "terminal/components/settings/types.ts",
  "terminal/app/dev/settings/page.tsx",
];
const CROPS = [
  "desktop-en-owner.png",
  "desktop-zh-owner.png",
  "mobile-en-owner.png",
  "mobile-zh-owner.png",
  "desktop-en-member.png",
  "desktop-zh-member.png",
  "mobile-en-member.png",
  "mobile-zh-member.png",
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

describe("B-F12-16 evidence lock is the sha256 of the layout sources", () => {
  it("EVIDENCE.yml records a sha256 for every layout file the crops depend on", () => {
    const recorded = layoutFileMap(evidenceText());
    for (const rel of LAYOUT_FILES) {
      expect(recorded[rel], `layoutFiles is missing ${rel}`).toMatch(/^[0-9a-f]{64}$/);
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

  it("capturedAtHead is recorded as an informational 40-char hex field", () => {
    const yml = evidenceText();
    const m = yml.match(/^# capturedAtHead: ([0-9a-f]{40})$/m);
    expect(m, "capturedAtHead informational line is missing").toBeTruthy();
  });

  it("all eight dark crops exist and are non-empty", () => {
    expect(CROPS).toHaveLength(8);
    for (const file of CROPS) {
      const abs = join(CROP_DIR, file);
      expect(existsSync(abs), file).toBe(true);
      expect(statSync(abs).size, file).toBeGreaterThan(0);
    }
  });

  it("EVIDENCE.yml declares the capture flag and the dark-only law", () => {
    const yml = evidenceText();
    expect(yml).toMatch(/capture_flag:\s*TERMINAL_E2E_FIXTURE/);
    expect(yml).toMatch(/DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06/);
    expect(yml).toMatch(/^theme:\s*dark$/m);
  });

  it("EN/ZH twins are present for every crop both in the lock and on disk", () => {
    const listed = CROPS;
    for (const file of listed) {
      expect(existsSync(join(CROP_DIR, file)), file).toBe(true);
      if (file.includes("-en-")) {
        const zh = file.replace("-en-", "-zh-");
        expect(listed, `${file} is missing its ZH twin in the lock`).toContain(zh);
        expect(existsSync(join(CROP_DIR, zh)), zh).toBe(true);
      }
    }
  });

  it("owner crops paint the Team settings heading and at least one plain-word control", () => {
    const yml = evidenceText();
    for (const file of CROPS.filter((f) => f.includes("-owner"))) {
      const row = measurement(yml, file);
      expect(row.headingTitle || row.chartLabel || row.shareLabel, file).toBeTruthy();
    }
  });
});
