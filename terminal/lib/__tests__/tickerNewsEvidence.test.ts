// Git-free evidence lock for the ticker-news capture packet.
// The lock is EVIDENCE.yml: layoutFiles holds the sha256 of the sources the
// crops depend on, crops the sha256 and capture cell of each committed crop.
// e2e/ticker-news.spec.ts writes crops only when TERMINAL_CROPS=1, and then
// deletes docs/pr-crops/ticker-news first, EVIDENCE.yml included. After a
// capture run restore it with `git checkout HEAD -- docs/pr-crops/ticker-news/EVIDENCE.yml`
// and copy in only the rows for crops that run produced.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO = join(__dirname, "../../..");
const CROP_DIR = join(__dirname, "../../docs/pr-crops/ticker-news");
const EVIDENCE = join(CROP_DIR, "EVIDENCE.yml");
const LOCKED_FILES = [
  "terminal/components/news/TickerNewsPanel.tsx",
  "terminal/components/news/TickerNewsPanel.module.css",
  "terminal/components/TerminalShell.tsx",
];
const VIEWPORTS: Record<string, string> = { desktop: "1440x900", tablet: "820x1180", mobile: "390x844" };
// The crops e2e/ticker-news.spec.ts writes: the live-feed matrix on all three
// viewports, the unavailable state on desktop and mobile.
const SPEC_CROPS = [
  ...["desktop", "tablet", "mobile"].flatMap((size) => ["en", "zh"].map((lang) => `${size}-${lang}-dark.png`)),
  ...["desktop", "mobile"].flatMap((size) => ["en", "zh"].map((lang) => `unavailable-${size}-${lang}-dark.png`)),
];

interface CropRow {
  file: string;
  viewport: string;
  lang: string;
  state: string;
  sha256: string;
}

function evidenceText(): string {
  return readFileSync(EVIDENCE, "utf8");
}

function section(text: string, key: string): string {
  const match = new RegExp(`^${key}:\\n((?:  .*\\n?)*)`, "m").exec(text);
  return match ? match[1] : "";
}

function items(block: string): Record<string, string>[] {
  return block
    .split(/^  - /m)
    .slice(1)
    .map((item) =>
      Object.fromEntries(
        item
          .split("\n")
          .map((line) => /^\s*([a-zA-Z0-9]+): (.+)$/.exec(line))
          .filter((m): m is RegExpExecArray => m !== null)
          .map((m) => [m[1], m[2].trim()]),
      ),
    );
}

function layoutFiles(): Record<string, string> {
  return Object.fromEntries(items(section(evidenceText(), "layoutFiles")).map((row) => [row.path, row.sha256]));
}

function crops(): CropRow[] {
  return items(section(evidenceText(), "crops")) as unknown as CropRow[];
}

function sha256Of(abs: string): string {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

describe("ticker-news evidence lock is EVIDENCE.yml", () => {
  it("EVIDENCE.yml records a sha256 for every locked source", () => {
    const recorded = layoutFiles();
    expect(Object.keys(recorded).sort()).toEqual([...LOCKED_FILES].sort());
    for (const rel of LOCKED_FILES) {
      expect(recorded[rel] ?? "", `layoutFiles is missing ${rel}`).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("each layoutFiles sha256 matches the file on disk", () => {
    for (const [rel, expected] of Object.entries(layoutFiles())) {
      const abs = join(REPO, rel);
      expect(existsSync(abs), `${rel} is recorded in layoutFiles but absent from the tree`).toBe(true);
      expect(sha256Of(abs), `${rel} changed without a recapture`).toBe(expected);
    }
  });

  it("every crop is non-empty, has a crops row and matches its recorded sha256", () => {
    const rows = crops();
    const onDisk = readdirSync(CROP_DIR).filter((name) => name.endsWith(".png")).sort();
    expect(onDisk, "every crop needs a crops row and every row a crop").toEqual(rows.map((row) => row.file).sort());
    expect(onDisk, "the packet holds exactly the crops the spec writes").toEqual([...SPEC_CROPS].sort());
    for (const row of rows) {
      const abs = join(CROP_DIR, row.file);
      expect(row.sha256, `${row.file} has no sha256`).toMatch(/^[0-9a-f]{64}$/);
      expect(statSync(abs).size, `${row.file} is empty`).toBeGreaterThan(0);
      expect(sha256Of(abs), `${row.file} differs from its crops row`).toBe(row.sha256);
    }
  });

  it("declares the capture head and each crop's viewport, language and state", () => {
    expect(evidenceText()).toMatch(/^capturedAtHead: [0-9a-f]{40}$/m);
    for (const row of crops()) {
      const cell = /^(unavailable-)?(desktop|tablet|mobile)-(en|zh)-dark\.png$/.exec(row.file);
      expect(cell, `${row.file} is not a crop name the spec writes`).not.toBeNull();
      const [, unavailable, size, lang] = cell as RegExpExecArray;
      expect(row.viewport, `${row.file} viewport`).toBe(VIEWPORTS[size]);
      expect(row.lang, `${row.file} lang`).toBe(lang);
      expect(row.state, `${row.file} state`).toBe(unavailable ? "unavailable" : "live-feed");
    }
  });
});
