// Review MAJOR (PR #539 round 2): EVIDENCE.yml recorded capturedAtHead as
// origin/master (e95059832…) while the crops were produced from the F12-5
// working tree that became e73e5bdc8. Review standard (c) and REQUIRED 4
// require the evidence record to name a SHA whose account layout files match
// this HEAD — so a recapture taken before the code commit (script writes
// git rev-parse HEAD, which was still master) cannot silently ship again.
//
// Review MINOR: overview rows reported confirmClass/confirmBg of a control
// whose .acs-form is display:none until .acs-row.editing. Overview
// measurements must not describe that hidden confirm.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = join(__dirname, "../../..");
const EVIDENCE = join(__dirname, "../../docs/pr-crops/b-f12-5-account-polish/EVIDENCE.yml");
const LAYOUT_FILES = [
  "terminal/components/settings/SectionAccount.tsx",
  "terminal/app/settings.css",
];
const OVERVIEW_FILES = [
  "desktop-en-overview.png",
  "desktop-zh-overview.png",
  "mobile-en-overview.png",
  "mobile-zh-overview.png",
];
const DELETE_FORM_FILES = [
  "desktop-en-delete-form.png",
  "desktop-zh-delete-form.png",
  "mobile-en-delete-form.png",
  "mobile-zh-delete-form.png",
];

function evidenceText(): string {
  return readFileSync(EVIDENCE, "utf8");
}

function capturedAtHead(yml: string): string {
  const m = yml.match(/^# capturedAtHead: ([0-9a-f]{40})$/m);
  if (!m) throw new Error("EVIDENCE.yml is missing a 40-char capturedAtHead");
  return m[1];
}

function measurement(yml: string, file: string): Record<string, string> {
  const re = new RegExp(`^  ${file.replace(/[.]/g, "\\.")}: \\{(.+)\\}$`, "m");
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

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).trim();
}

describe("B-F12-5 evidence record names the code head that produced the crops", () => {
  it("capturedAtHead is an ancestor of HEAD whose account layout files match this HEAD", () => {
    const sha = capturedAtHead(evidenceText());
    // merge-base --is-ancestor exits 1 when sha is not an ancestor.
    git(["merge-base", "--is-ancestor", sha, "HEAD"]);
    const diff = git(["diff", sha, "HEAD", "--", ...LAYOUT_FILES]);
    expect(diff, `account layout files differ between capturedAtHead ${sha} and HEAD`).toBe("");
  });

  it("overview measurements do not report the hidden delete confirm", () => {
    const yml = evidenceText();
    for (const file of OVERVIEW_FILES) {
      const row = measurement(yml, file);
      expect(row.confirmClass, file).toBe("");
      expect(row.confirmBg, file).toBe("");
    }
  });

  it("delete-form measurements still record the visible danger confirm", () => {
    const yml = evidenceText();
    for (const file of DELETE_FORM_FILES) {
      const row = measurement(yml, file);
      expect(row.confirmClass, file).toMatch(/\bbtn-danger\b/);
      expect(row.confirmBg, file).not.toBe("");
      expect(row.confirmBg, file).not.toBe("rgb(41, 98, 255)");
      expect(row.confirmBg, file).not.toBe("rgb(77, 130, 255)");
    }
  });
});
