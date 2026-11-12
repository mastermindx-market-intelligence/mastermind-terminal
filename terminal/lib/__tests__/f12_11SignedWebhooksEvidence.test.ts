import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = join(__dirname, "../../..");
const CROP_DIR = join(__dirname, "../../docs/pr-crops/b-f12-11-signed-webhooks");
const EVIDENCE = join(CROP_DIR, "EVIDENCE.yml");
// Asserted set: packet-local files ONLY. terminal/lib/i18n.tsx is the repo-wide bilingual
// lexicon every UI packet extends — asserting its sha256 inside terminal-unit (which feeds the
// required `terminal` check) would turn master red for the next unrelated packet that adds a LEX
// key. It is recorded in EVIDENCE.yml under informationalFiles (asserted: false) instead.
const LAYOUT_FILES = [
  "terminal/components/settings/SectionWebhooks.tsx",
  "terminal/lib/webhookLabels.ts",
];
const NEVER_asserted = ["terminal/lib/i18n.tsx"];
const STATES = ["populated", "rotated"];
const LANGS = ["en", "zh"];
const VIEWPORTS = ["desktop", "mobile"];

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

describe("B-F12-11 evidence lock is the sha256 of the layout sources", () => {
  it("capturedAtHead remains recorded as an informational field", () => {
    expect(capturedAtHead(evidenceText())).toMatch(/^[0-9a-f]{40}$/);
  });

  it("layout file sha256 matches EVIDENCE.yml", () => {
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

  it("asserts packet-local files only — never a repo-wide shared file", () => {
    const recorded = layoutFileMap(evidenceText());
    for (const rel of NEVER_asserted) {
      expect(
        Object.keys(recorded),
        `${rel} is shared by every UI packet; asserting it here reddens master for unrelated work`,
      ).not.toContain(rel);
    }
    for (const rel of Object.keys(recorded)) {
      expect(LAYOUT_FILES, `${rel} is asserted but is not a packet-local layout file`).toContain(rel);
    }
  });

  it("the shared lexicon is still recorded, marked asserted: false", () => {
    const yml = evidenceText();
    const at = yml.indexOf("informationalFiles:\n");
    expect(at, "EVIDENCE.yml is missing informationalFiles").toBeGreaterThan(-1);
    const rows: string[] = [];
    for (const line of yml.slice(at + "informationalFiles:\n".length).split("\n")) {
      if (!line.startsWith("  ")) break;
      rows.push(line);
    }
    const text = rows.join("\n");
    expect(text).toMatch(/^ {2}asserted: false$/m);
    for (const rel of NEVER_asserted) {
      expect(text, `${rel} should stay recorded for provenance`).toContain(rel);
    }
  });

  it("EN/ZH twins exist for every state and viewport (8 files)", () => {
    const listed: string[] = [];
    for (const viewport of VIEWPORTS) {
      for (const lang of LANGS) {
        for (const state of STATES) {
          const file = `${viewport}-${lang}-${state}.png`;
          listed.push(file);
          expect(existsSync(join(CROP_DIR, file)), file).toBe(true);
        }
      }
    }
    expect(listed).toHaveLength(8);
  });

  it("theme is dark-only", () => {
    expect(evidenceText()).toMatch(/^theme: dark$/m);
    expect(evidenceText()).not.toMatch(/theme: light/);
  });
});