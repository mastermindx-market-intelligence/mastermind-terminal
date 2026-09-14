// W9T_F12_17 (MO-PAID-081): the invitation-link evidence lock. Same shape as the
// other locks in this folder: layoutFiles carry the sha256 of every source file
// the crops depend on, so editing one of them without a recapture turns this RED.
// Tests never shell out to git, so capturedAtHead stays informational here.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = join(__dirname, "../../..");
const CROP_DIR = join(__dirname, "../../docs/pr-crops/w9t-f12-17-invite-link-honesty");
const EVIDENCE = join(CROP_DIR, "EVIDENCE.yml");
const LAYOUT_FILES = [
  "terminal/components/settings/SectionTeam.tsx",
  "terminal/components/settings/SectionTeam.module.css",
  "terminal/lib/i18n.tsx",
  "terminal/lib/teams.ts",
  "terminal/app/api/teams/invitations/route.ts",
  "terminal/app/invite/page.tsx",
  "terminal/app/invite/InviteAccept.tsx",
  "terminal/app/invite/invite.module.css",
  "terminal/app/settings.css",
];
const FORM_FILES = [
  "desktop-en-team-invite-form.png",
  "desktop-zh-team-invite-form.png",
  "mobile-en-team-invite-form.png",
  "mobile-zh-team-invite-form.png",
];
const LINK_FILES = [
  "desktop-en-team-invite-link.png",
  "desktop-zh-team-invite-link.png",
  "mobile-en-team-invite-link.png",
  "mobile-zh-team-invite-link.png",
];
const SIGNIN_FILES = [
  "desktop-en-invite-signin.png",
  "desktop-zh-invite-signin.png",
  "mobile-en-invite-signin.png",
  "mobile-zh-invite-signin.png",
];
const JOINED_FILES = [
  "desktop-en-invite-joined.png",
  "desktop-zh-invite-joined.png",
  "mobile-en-invite-joined.png",
  "mobile-zh-invite-joined.png",
];
const ALL_FILES = [...FORM_FILES, ...LINK_FILES, ...SIGNIN_FILES, ...JOINED_FILES];
const DELIVERY_EN =
  "We do not send invitation emails: this server has no email delivery set up. Last checked on 13 September 2026.";
const DELIVERY_ZH = "我们不会发送邀请邮件：此服务器尚未设置邮件发送功能。最近核查于 2026年9月13日。";

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

describe("W9T_F12_17 evidence lock is the sha256 of the invitation layout sources", () => {
  it("capturedAtHead remains recorded as an informational field", () => {
    expect(evidenceText()).toMatch(/^capturedAtHead: [0-9a-f]{40}$/m);
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

  it("every crop has its language twin on disk and in the lock", () => {
    const yml = evidenceText();
    for (const file of ALL_FILES) {
      expect(yml, `${file} is not listed in EVIDENCE.yml`).toContain(`  - ${file}`);
      expect(existsSync(join(CROP_DIR, file)), file).toBe(true);
      if (file.includes("-en-")) {
        const zh = file.replace("-en-", "-zh-");
        expect(ALL_FILES, `${file} is missing its ZH twin in the lock`).toContain(zh);
        expect(existsSync(join(CROP_DIR, zh)), zh).toBe(true);
      }
    }
  });

  it("the form crops print the dated no-email line and offer the create control in both languages", () => {
    const yml = evidenceText();
    for (const file of FORM_FILES) {
      const row = measurement(yml, file);
      expect(row.deliveryLine, file).toBe(file.includes("-zh-") ? DELIVERY_ZH : DELIVERY_EN);
      expect(row.formPresent, file).toBe("true");
      expect(row.linkPresent, file).toBe("false");
      expect(row.tokenInVisibleText, file).toBe("false");
      expect(Number(row.horizontalOverflow), file).toBe(0);
      if (file.includes("-zh-")) {
        expect(row.createButtonText, file).toBe("创建邀请链接");
        expect(row.roleOptions, file).toContain("成员");
      } else {
        expect(row.createButtonText, file).toBe("Create invitation link");
        expect(row.roleOptions, file).toContain("Member");
      }
    }
  });

  it("the link crops show a read-only invitation link, a copy control and the send-yourself line", () => {
    const yml = evidenceText();
    for (const file of LINK_FILES) {
      const row = measurement(yml, file);
      expect(row.deliveryLine, file).toBe(file.includes("-zh-") ? DELIVERY_ZH : DELIVERY_EN);
      expect(row.linkPresent, file).toBe("true");
      expect(row.linkReadOnly, file).toBe("true");
      expect(row.linkValue, file).toMatch(/^https:\/\/app\.mastermind-x\.com\/invite\?token=[0-9a-f]{64}$/);
      expect(row.tokenInVisibleText, file).toBe("false");
      expect(Number(row.horizontalOverflow), file).toBe(0);
      if (file.includes("-zh-")) {
        expect(row.copyButtonText, file).toBe("复制链接");
        expect(row.sendLine, file).toContain("14");
        expect(row.linkLabel, file).toContain("的邀请链接");
      } else {
        expect(row.copyButtonText, file).toBe("Copy link");
        expect(row.sendLine, file).toContain("14 days");
        expect(row.linkLabel, file).toContain("Invitation link for");
      }
    }
  });

  it("the accept-page crops name the sign-in step and the joined state in both languages", () => {
    const yml = evidenceText();
    for (const file of SIGNIN_FILES) {
      const row = measurement(yml, file);
      expect(row.phase, file).toBe("signed-out");
      expect(row.signInHref, file).toBe("/terminal?signin=1");
      expect(row.tokenInVisibleText, file).toBe("false");
      expect(Number(row.horizontalOverflow), file).toBe(0);
      if (file.includes("-zh-")) {
        expect(row.pageTitle, file).toBe("团队邀请");
        expect(row.signInSentence, file).toBe("请登录后接受此邀请。");
      } else {
        expect(row.pageTitle, file).toBe("Team invitation");
        expect(row.signInSentence, file).toBe("Sign in to accept this invitation.");
      }
    }
    for (const file of JOINED_FILES) {
      const row = measurement(yml, file);
      expect(row.phase, file).toBe("joined");
      expect(row.tokenInVisibleText, file).toBe("false");
      if (file.includes("-zh-")) {
        expect(row.noteText, file).toBe("你已加入该团队。");
      } else {
        expect(row.noteText, file).toBe("You have joined the team.");
      }
    }
  });

  it("the lock records the dark-only theme, both languages and both widths", () => {
    const yml = evidenceText();
    expect(yml).toMatch(/^theme: dark$/m);
    expect(yml).toMatch(/^languages: \[en, zh\]$/m);
    expect(yml).toContain("1440x900");
    expect(yml).toContain("390x844");
  });
});
