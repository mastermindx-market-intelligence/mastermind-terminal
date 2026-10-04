import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const REPO = join(__dirname, "../../..");
const CROP_DIR = join(__dirname, "../../docs/pr-crops/b-f12-10-api-keys");
const EVIDENCE = join(CROP_DIR, "EVIDENCE.yml");
const LAYOUT_FILES = [
  "terminal/components/settings/SectionDeveloper.tsx",
  "terminal/lib/apiKeyLabels.ts",
  "terminal/components/settings/SettingsPanel.tsx",
  "terminal/components/settings/icons.tsx",
];
const NEVER_ASSERTED = ["terminal/lib/i18n.tsx"];
const STATES = ["empty", "minted", "revoked"];
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

describe("B-F12-10 evidence lock is the sha256 of the layout sources", () => {
  it("no test file this packet adds imports a process spawner", () => {
    const libDir = join(__dirname);
    const settingsDir = join(__dirname, "../../components/settings/__tests__");
    const files = [
      ...readdirSync(libDir).filter((f) => /^(apiV1|apiKeys)/.test(f)).map((f) => join(libDir, f)),
      ...readdirSync(settingsDir).filter((f) => /SectionDeveloper/.test(f)).map((f) => join(settingsDir, f)),
      join(__dirname, "../../e2e/api-keys-settings.spec.ts"),
    ];
    for (const file of files) {
      if (!existsSync(file)) continue;
      if (!(file.endsWith(".ts") || file.endsWith(".tsx"))) continue;
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/\b(?:execFileSync|spawn|execSync)\b/);
    }
  });

  it("EVIDENCE.yml layoutFiles match the sha256 of the sources they name", () => {
    expect(existsSync(EVIDENCE), "EVIDENCE.yml missing").toBe(true);
    const yml = evidenceText();
    expect(capturedAtHead(yml)).toMatch(/^[0-9a-f]{40}$/);
    const recorded = layoutFileMap(yml);
    expect(Object.keys(recorded).sort()).toEqual([...LAYOUT_FILES].sort());
    for (const rel of LAYOUT_FILES) {
      expect(recorded[rel]).toBe(sha256Of(join(REPO, rel)));
    }
    for (const rel of NEVER_ASSERTED) {
      expect(Object.keys(recorded)).not.toContain(rel);
    }
  });

  it("dark-only EN/ZH × 1440/390 crops exist for empty, minted and revoked", () => {
    for (const viewport of VIEWPORTS) {
      for (const lang of LANGS) {
        for (const state of STATES) {
          const file = `${viewport}-${lang}-${state}.png`;
          expect(existsSync(join(CROP_DIR, file)), file).toBe(true);
        }
      }
    }
  });
});
