// Review MAJOR (PR #539 round 3 / B-F12-5): the evidence lock used to name a commit
// and ask whether it was an ancestor of HEAD. The required CI shard checks
// out a single commit, so that named SHA is absent and the check is RED
// there while the same file is GREEN in a full-history worktree. A check
// that only passes with full history is not a CI test.
//
// The lock is now the sha256 of the team-roles layout sources the crops
// depend on, recorded in EVIDENCE.yml layoutFiles. capturedAtHead stays
// as an informational field. Changing a layout file without a recapture
// turns this file RED.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = join(__dirname, "../../..");
const CROP_DIR = join(__dirname, "../../docs/pr-crops/b-f12-8-team-roles");
const EVIDENCE = join(CROP_DIR, "EVIDENCE.yml");
// Round-4 ruling R4(f): icons.tsx belongs in the lock. This packet edited it (IconTeam), and
// SectionTeam.tsx imports Group / Msg / Row / SectionHead from it — the markup that structures
// every line of these crops — so an edit there moves these pixels. Without this row the lock
// would stay green through exactly the failure ruling R2 named.
const LAYOUT_FILES = [
  "terminal/components/settings/SectionTeam.tsx",
  "terminal/components/settings/SectionTeam.module.css",
  "terminal/components/settings/SettingsPanel.tsx",
  "terminal/components/settings/icons.tsx",
  "terminal/app/settings.css",
  "terminal/lib/i18n.tsx",
];
const TEAM_FILES = [
  "desktop-en-team.png",
  "desktop-zh-team.png",
  "mobile-en-team.png",
  "mobile-zh-team.png",
];
const CHANGE_FILES = [
  "desktop-en-change-role.png",
  "desktop-zh-change-role.png",
  "mobile-en-change-role.png",
  "mobile-zh-change-role.png",
];
// Round-4 ruling R3: the zero-team default state, which no crop depicted.
const NONE_FILES = [
  "desktop-en-no-team.png",
  "desktop-zh-no-team.png",
  "mobile-en-no-team.png",
  "mobile-zh-no-team.png",
];
const TRUNCATED_FILES = [
  "desktop-en-truncated.png",
  "desktop-zh-truncated.png",
  "mobile-en-truncated.png",
  "mobile-zh-truncated.png",
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

describe("B-F12-8 evidence lock is the sha256 of the layout sources", () => {
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

  it("change-role crops record a visible change-role control; every roster crop records a role badge", () => {
    const yml = evidenceText();
    for (const file of [...TEAM_FILES, ...CHANGE_FILES, ...TRUNCATED_FILES]) {
      const row = measurement(yml, file);
      expect(row.roleBadgeText, file).toBeTruthy();
      expect(row.roleBadgeText, file).not.toBe("");
    }
    for (const file of CHANGE_FILES) {
      const row = measurement(yml, file);
      expect(row.changeRolePresent, file).toBe("true");
      expect(row.removeClass, file).toMatch(/\bbtn-danger\b/);
    }
  });

  it("the change-role crops depict the confirm state, not a second copy of the roster crops", () => {
    // Round-4 ruling R4(b): these four used to differ from the four roster crops by a
    // scrollIntoView on an element already in view, so they carried no evidence the others did
    // not. They now open acsTeamRemoveAsk, in the crop's own language.
    const yml = evidenceText();
    for (const file of CHANGE_FILES) {
      const row = measurement(yml, file);
      expect(row.confirmText, file).toBeTruthy();
      if (file.includes("-zh-")) {
        expect(row.confirmText, file).toMatch(/[一-鿿]/);
      } else {
        expect(row.confirmText, file).toMatch(/^Remove this person from the team\?/);
      }
    }
    for (const file of TEAM_FILES) {
      expect(measurement(yml, file).confirmText, file).toBe("");
    }
  });

  it("a changeable row offers exactly one role option, never the one it already holds", () => {
    // Round-4 ruling R4(a). Each changeable row offers one option; the set across rows is both
    // options. Round-6 added unnamed member rows, so the label count is no longer two.
    const yml = evidenceText();
    for (const file of [...TEAM_FILES, ...CHANGE_FILES, ...TRUNCATED_FILES]) {
      const labels = measurement(yml, file).changeRoleLabels.split(" | ").filter(Boolean);
      expect(labels.length, `${file}: ${labels.join(" | ")}`).toBeGreaterThanOrEqual(2);
      expect(new Set(labels).size, `${file} offers the same option twice`).toBe(2);
    }
  });

  it("the zero-team default state is depicted in both languages at both widths", () => {
    // Round-4 ruling R3. The state has no roster row at all, so its evidence is the block and the
    // create-team control rather than a role badge. Round-6 ruling R9(7) adds the name label.
    const yml = evidenceText();
    for (const file of NONE_FILES) {
      expect(existsSync(join(CROP_DIR, file)), file).toBe(true);
      const row = measurement(yml, file);
      expect(row.noTeamPresent, file).toBe("true");
      expect(row.createLabel, file).toBeTruthy();
      expect(row.roleBadgeText, file).toBe("");
      if (file.includes("-zh-")) {
        expect(row.createLabel, file).toBe("创建团队");
        expect(row.nameLabel, file).toBe("团队名称");
      } else {
        expect(row.createLabel, file).toBe("Create team");
        expect(row.nameLabel, file).toBe("Team name");
      }
    }
  });

  it("roster crops measure role badges on the roster only, and name the invitations group separately", () => {
    // Round-6 ruling R4 / minor 6: pending invitations used to share team-role-badge, so
    // roleBadgeText started with Member. It now starts with Owner.
    const yml = evidenceText();
    for (const file of [...TEAM_FILES, ...CHANGE_FILES, ...TRUNCATED_FILES]) {
      const row = measurement(yml, file);
      expect(row.roleBadgeText, file).toMatch(/^(Owner|所有者) \|/);
      expect(row.inviteBadgeText, file).toBeTruthy();
      expect(row.unnamedRows, file).toBe("2");
      expect(row.ownerWhatPresent, file).toBe("true");
    }
  });

  it("the truncated roster names the cap in both languages at both widths", () => {
    const yml = evidenceText();
    for (const file of TRUNCATED_FILES) {
      expect(existsSync(join(CROP_DIR, file)), file).toBe(true);
      const row = measurement(yml, file);
      expect(row.truncatedText, file).toBeTruthy();
      // Round-7 review MAJOR: truncatedText from the DOM stayed green while the
      // sentence sat below the fold. truncatedInView is the body's visible rect.
      expect(row.truncatedInView, file).toBe("true");
      if (file.includes("-zh-")) {
        expect(row.truncatedText, file).toMatch(/仅显示前 \d+ 位成员/);
      } else {
        expect(row.truncatedText, file).toMatch(/^Showing the first \d+ people/);
      }
    }
  });

  it("EN/ZH twins are present for every crop both in the lock and on disk", () => {
    const listed = [...TEAM_FILES, ...CHANGE_FILES, ...NONE_FILES, ...TRUNCATED_FILES];
    for (const file of listed) {
      expect(existsSync(join(CROP_DIR, file)), file).toBe(true);
      if (file.includes("-en-")) {
        const zh = file.replace("-en-", "-zh-");
        expect(listed, `${file} is missing its ZH twin in the lock`).toContain(zh);
        expect(existsSync(join(CROP_DIR, zh)), zh).toBe(true);
      }
    }
  });

  it("measurement finds a row whose file key contains regex metacharacters", () => {
    const file = "a+b (1).png";
    const yml = `measurements:\n  ${file}: {roleBadgeText: "found", changeRolePresent: true}\n`;
    const row = measurement(yml, file);
    expect(row.roleBadgeText).toBe("found");
  });
});
