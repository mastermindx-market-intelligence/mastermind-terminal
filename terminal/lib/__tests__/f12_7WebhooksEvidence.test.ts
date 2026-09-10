import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const REPO = join(__dirname, "../../..");
const CROP_DIR = join(__dirname, "../../docs/pr-crops/b-f12-7-webhooks");
const EVIDENCE = join(CROP_DIR, "EVIDENCE.yml");
// Asserted set: packet-local files ONLY. terminal/lib/i18n.tsx is the repo-wide
// bilingual lexicon that every UI packet extends — asserting its sha256 inside
// terminal-unit (which feeds the required `terminal` check) would turn master
// red for the next unrelated packet that adds a LEX key. It is recorded in
// EVIDENCE.yml under informationalFiles (asserted: false) instead.
// webhookUrl.ts IS asserted: its returned code selects which copy the four
// *-ssrf.png crops depict, so the lock would otherwise go stale in silence on
// the one state it exists to prove.
const LAYOUT_FILES = [
  "terminal/components/settings/SectionWebhooks.tsx",
  "terminal/lib/webhookLabels.ts",
  "terminal/lib/webhookUrl.ts",
  "terminal/components/settings/SettingsPanel.tsx",
  "terminal/components/settings/icons.tsx",
];
const NEVER_ASSERTED = ["terminal/lib/i18n.tsx"];
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

/**
 * Every test file this packet adds, discovered from disk rather than listed by
 * hand — a hard-coded list goes stale the moment a later round adds a suite,
 * and the round-3 review's complaint was exactly that the ban constrained one
 * self-referential file. Anything matching webhook*.test.ts or
 * f12_7Webhooks*.test.ts under lib/__tests__, plus the packet's e2e spec.
 */
function packetTestFiles(): string[] {
  const libDir = join(__dirname);
  const settingsDir = join(__dirname, "../../components/settings/__tests__");
  const local = readdirSync(libDir)
    .filter((f) => /^(webhook|f12_7Webhooks).*\.test\.tsx?$/.test(f))
    .sort()
    .map((f) => join(libDir, f));
  const settings = readdirSync(settingsDir)
    .filter((f) => /^(webhook|f12_7Webhooks|SectionWebhooks).*\.test\.tsx?$/.test(f))
    .sort()
    .map((f) => join(settingsDir, f));
  return [...local, ...settings, join(__dirname, "../../e2e/webhooks-settings.spec.ts")];
}

describe("B-F12-7 evidence lock is the sha256 of the layout sources", () => {
  it("no test file this packet adds imports a process spawner", () => {
    const files = packetTestFiles();
    // Exact packet test-file count at this head: 13 lib/__tests__ files matching
    // webhook*|f12_7Webhooks*, plus SectionWebhooks.test.tsx (globbed from
    // components/settings/__tests__), plus the e2e spec = 15. An equality keeps
    // a broken glob from passing vacuously and keeps this file from being
    // omitted from the scan.
    expect(files.length).toBe(15);
    expect(files.some((abs) => abs.endsWith("components/settings/__tests__/SectionWebhooks.test.tsx"))).toBe(true);
    for (const abs of files) {
      expect(existsSync(abs), `${abs} is expected to exist`).toBe(true);
      const src = readFileSync(abs, "utf8");
      // Needles are assembled at runtime so this file's own source does not
      // contain the banned import strings as contiguous text.
      const bareChildProcess = ["child", "process"].join("_");
      const nodeChildProcess = ["node", bareChildProcess].join(":");
      expect(src.includes(nodeChildProcess), `${abs} imports ${nodeChildProcess}`).toBe(false);
      expect(src.includes(bareChildProcess), `${abs} imports ${bareChildProcess}`).toBe(false);
      expect(/\bexecFileSync\b|\bspawnSync\b|\bexecSync\b/.test(src), `${abs} shells out`).toBe(false);
    }
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

  it("asserts packet-local files only — never a repo-wide shared file", () => {
    const recorded = layoutFileMap(evidenceText());
    for (const rel of NEVER_ASSERTED) {
      expect(
        Object.keys(recorded),
        `${rel} is shared by every UI packet; asserting it here reddens master for unrelated work`,
      ).not.toContain(rel);
    }
    // Every asserted row must be one this packet owns.
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
    for (const rel of NEVER_ASSERTED) {
      expect(text, `${rel} should stay recorded for provenance`).toContain(rel);
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

  it("desktop failed-state crops exist in EN and ZH", () => {
    expect(existsSync(join(CROP_DIR, "desktop-en-failed.png"))).toBe(true);
    expect(existsSync(join(CROP_DIR, "desktop-zh-failed.png"))).toBe(true);
  });

  it("theme is dark-only", () => {
    expect(evidenceText()).toMatch(/^theme: dark$/m);
    expect(evidenceText()).not.toMatch(/theme: light/);
  });
});
