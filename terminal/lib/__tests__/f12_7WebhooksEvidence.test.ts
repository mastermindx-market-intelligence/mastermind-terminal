import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = join(__dirname, "../../..");
const CROP_DIR = join(__dirname, "../../docs/pr-crops/b-f12-7-webhooks");
const EVIDENCE = join(CROP_DIR, "EVIDENCE.yml");
const LAYOUT_FILES = [
  "terminal/components/settings/SectionWebhooks.tsx",
  "terminal/lib/webhookLabels.ts",
  "terminal/components/settings/SettingsPanel.tsx",
  "terminal/components/settings/icons.tsx",
  "terminal/lib/i18n.tsx",
];
const STATES = ["empty", "populated", "secret", "ssrf"];
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

describe("B-F12-7 evidence lock is the sha256 of the layout sources", () => {
  it("does not import a process spawner", () => {
    const src = readFileSync(join(__dirname, "f12_7WebhooksEvidence.test.ts"), "utf8");
    expect(src).not.toContain("node:child_process");
    expect(src).not.toContain('from "child_process"');
  });

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

  it("EN/ZH twins exist for every state and viewport (16 files)", () => {
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
    expect(listed).toHaveLength(16);
  });

  it("theme is dark-only", () => {
    expect(evidenceText()).toMatch(/^theme: dark$/m);
    expect(evidenceText()).not.toMatch(/theme: light/);
  });
});
