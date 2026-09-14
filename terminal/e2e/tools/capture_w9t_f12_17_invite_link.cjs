#!/usr/bin/env node
/**
 * W9T_F12_17 / MO-PAID-081 — team invitation link + the dated "no email delivery" line.
 *
 * Dark only (DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06), EN and ZH, 1440 and 390.
 * Two surfaces are captured:
 *
 *   1. Settings ▸ Team — the real SectionTeam mounted by the production-gated /dev/settings
 *      harness, before and after an invitation is created. The create call is answered at the
 *      network layer with the shape app/api/teams/invitations/route.ts really returns, so the
 *      pixels depict the real component rendering the real answer (the harness has no database).
 *   2. /invite — the public page a copied link opens, in the state a visitor with no session
 *      reaches, and in the joined state after the accept call is answered the same way.
 *
 * TERMINAL_E2E_FIXTURE=1 keeps the Next.js dev indicator out of the frames.
 *
 * From terminal/:
 *   node e2e/tools/capture_w9t_f12_17_invite_link.cjs
 *
 * Writes PNGs + EVIDENCE.yml under docs/pr-crops/w9t-f12-17-invite-link-honesty/.
 */
"use strict";

const { spawn, execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { chromium } = require("@playwright/test");

const ROOT = join(__dirname, "..", "..");
const REPO = join(ROOT, "..");
const OUT = join(ROOT, "docs", "pr-crops", "w9t-f12-17-invite-link-honesty");
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
const PORT = Number(process.env.TERMINAL_CROP_PORT || 3541);
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

// The invitation link the harness answers with. app.mastermind-x.com is the real production host,
// so the crop shows a link a person could actually open.
const TOKEN = "9f2c41ba7d194e6a9c035b71ee0a4d229f2c41ba7d194e6a9c035b71ee0a4d22";
const LINK = `https://app.mastermind-x.com/invite?token=${TOKEN}`;
const INVITED_EMAIL = "friend@example.com";

// The copy these frames must show. Duplicated here on purpose: the capture fails loudly if the
// shipped strings move, instead of quietly recording whatever the panel happens to say.
const COPY = {
  en: {
    deliveryLine: "We do not send invitation emails: this server has no email delivery set up. Last checked on 13 September 2026.",
    inviteGroup: "Invite someone",
    createButton: "Create invitation link",
    copyButton: "Copy link",
    sendLine: "Send this link to them yourself. It works for 14 days and can be used once.",
    linkLabel: `Invitation link for ${INVITED_EMAIL}`,
    signIn: "Sign in to accept this invitation.",
    signInReturn: "After you sign in, open this invitation link again to join the team.",
    joined: "You have joined the team.",
    pageTitle: "Team invitation",
  },
  zh: {
    deliveryLine: "我们不会发送邀请邮件：此服务器尚未设置邮件发送功能。最近核查于 2026年9月13日。",
    inviteGroup: "邀请成员",
    createButton: "创建邀请链接",
    copyButton: "复制链接",
    sendLine: "请自行把这个链接发送给对方。链接 14 天内有效，且只能使用一次。",
    linkLabel: `${INVITED_EMAIL} 的邀请链接`,
    signIn: "请登录后接受此邀请。",
    signInReturn: "登录之后，请再次打开这个邀请链接来加入团队。",
    joined: "你已加入该团队。",
    pageTitle: "团队邀请",
  },
};

mkdirSync(OUT, { recursive: true });

function currentGitHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
}

function sha256File(rel) {
  return createHash("sha256").update(readFileSync(join(REPO, rel))).digest("hex");
}

function layoutFilesBlock() {
  return LAYOUT_FILES.map((rel) => `  ${rel}: "${sha256File(rel)}"`);
}

function startServer() {
  const env = {
    ...process.env,
    ANALYSIS_LOCAL_PREVIEW: "1",
    ADMIN_DEV: "1",
    TERMINAL_E2E_FIXTURE: "1",
    TERMINAL_E2E_EMAIL: "responsive@example.com",
    TERMINAL_E2E_ENTITLEMENT: "unlimited",
    RATE_LIMIT_MAX: "100000",
    HUB_REALTIME_QUOTES: "1",
    FLOW_FIXTURE: "1",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-anon-key",
  };
  const child = spawn("npm", ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(PORT)], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  child.stdout.on("data", (buf) => {
    const line = String(buf);
    if (/Ready|compiled|error|Error/i.test(line)) process.stdout.write(`[dev] ${line}`);
  });
  child.stderr.on("data", (buf) => process.stderr.write(`[dev:err] ${buf}`));
  return child;
}

function stopServer(child) {
  if (!child || !child.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try { child.kill("SIGTERM"); } catch { /* already gone */ }
  }
}

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = "not tried";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/dev/settings?s=team`, { redirect: "manual" });
      last = String(res.status);
      if (res.status >= 200 && res.status < 500) return;
    } catch (err) {
      last = err.cause?.code || err.message;
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  throw new Error(`dev server on ${PORT} never answered (${last})`);
}

async function stripDevOverlay(page) {
  await page.evaluate(() => {
    document.querySelectorAll("nextjs-portal").forEach((el) => el.remove());
  });
}

async function assertNoNextIndicator(page, file) {
  await page.waitForTimeout(400);
  await stripDevOverlay(page);
  const n = await page.locator("[data-nextjs-dev-tools-button]").count();
  if (n > 0) {
    throw new Error(`${file}: Next.js N overlay still mounted (${n}); TERMINAL_E2E_FIXTURE gate failed`);
  }
}

async function newPage(browser, lang, viewport) {
  const context = await browser.newContext({
    viewport: VIEWPORTS[viewport],
    hasTouch: viewport === "mobile",
    locale: lang === "zh" ? "zh-CN" : "en-US",
    colorScheme: "dark",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);
  await page.addInitScript((l) => {
    localStorage.setItem("mm.lang", l);
    localStorage.setItem("theme", "dark");
    localStorage.setItem("theme_auto", "0");
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.setAttribute("lang", l === "zh" ? "zh-CN" : "en");
  }, lang);
  return { context, page };
}

/** Answer the invitations route the way route.ts really does, at the network layer. */
async function stubInvitations(page, { accept } = {}) {
  await page.route("**/api/teams/invitations**", async (route) => {
    const method = route.request().method();
    if (method === "POST") {
      const body = JSON.parse(route.request().postData() || "{}");
      if (body.action === "accept") {
        return route.fulfill({
          status: accept ? 200 : 410,
          contentType: "application/json",
          body: JSON.stringify(
            accept
              ? { ok: true, teamId: "team-desk", role: "member", message: COPY.en.joined, messageZh: COPY.zh.joined }
              : { error: "EXPIRED", message: "This invitation has expired. Ask the team owner to send a new one.", messageZh: "该邀请已过期。请让团队所有者重新发送一份。" },
          ),
        });
      }
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          invite: { id: "inv-9", email: INVITED_EMAIL, role: "member", expiresAt: null, acceptedAt: null },
          token: TOKEN,
          inviteUrl: LINK,
          acceptWith: { action: "accept" },
          delivery: {
            code: "no_email_delivery",
            sent: false,
            checkedAt: "2026-09-13",
            message: `${COPY.en.deliveryLine} Copy the invitation link and send it to them yourself — it works for 14 days and can be used once.`,
            messageZh: `${COPY.zh.deliveryLine}请复制邀请链接自行发送给对方——该链接 14 天内有效，且只能使用一次。`,
          },
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ invites: [], callerRole: "owner", truncated: false }),
    });
  });
}

/** A signed-in session for /invite, answered where supabase-js asks for it. */
async function stubSession(page) {
  await page.route("**/auth/v1/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/auth/v1/user")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "8f2c41ba-7d19-4e6a-9c03-5b71ee0a4d22",
          aud: "authenticated",
          role: "authenticated",
          email: "invited@example.com",
          app_metadata: { provider: "email", providers: ["email"] },
          user_metadata: {},
          created_at: "2026-02-14T09:12:00.000Z",
        }),
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
}

async function openTeam(page, lang) {
  await page.goto(`${BASE}/dev/settings?s=team&lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.locator(".acs-overlay.open .acs-card").waitFor({ state: "visible", timeout: 45_000 });
  await page.locator('[data-testid="team-invite-form"], [data-testid="team-invite-link"]').first()
    .waitFor({ state: "visible", timeout: 20_000 });
  await stripDevOverlay(page);
}

function want(actual, expected, what, file) {
  if (actual !== expected) throw new Error(`${file}: ${what} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

async function measureTeam(page, kind) {
  return page.evaluate((k) => {
    const read = (sel) => {
      const el = document.querySelector(sel);
      return el ? (el.textContent || "").trim() : "";
    };
    const groupTitles = Array.from(document.querySelectorAll(".acs-group-t")).map((el) => (el.textContent || "").trim());
    const field = document.querySelector('[data-testid="team-invite-url"]');
    return {
      inviteGroupTitle: groupTitles.find((t) => t === "Invite someone" || t === "邀请成员") || "",
      pendingGroupTitle: groupTitles.find((t) => t === "Invitations not yet accepted" || t === "尚未接受的邀请") || "",
      deliveryLine: read('[data-testid="team-delivery"]'),
      formPresent: !!document.querySelector('[data-testid="team-invite-form"]'),
      createButtonText: read('[data-testid="team-invite-create"]'),
      emailLabel: read('label[for="acs-invite-email"]'),
      roleLabel: read('label[for="acs-invite-role"]'),
      roleOptions: Array.from(document.querySelectorAll('[data-testid="team-invite-role"] option')).map((o) => (o.textContent || "").trim()).join(" | "),
      linkPresent: !!document.querySelector('[data-testid="team-invite-link"]'),
      linkValue: field ? field.value : "",
      linkReadOnly: field ? field.readOnly : false,
      linkLabel: read('[data-testid="team-invite-link-label"]'),
      copyButtonText: read('[data-testid="team-invite-copy"]'),
      sendLine: read('[data-testid="team-invite-send"]'),
      tokenInVisibleText: k === "link" ? (document.body.innerText || "").includes("9f2c41ba7d194e6a9c035b71ee0a4d22") : false,
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  }, kind);
}

async function measureInvite(page) {
  return page.evaluate(() => {
    const read = (sel) => {
      const el = document.querySelector(sel);
      return el ? (el.textContent || "").trim() : "";
    };
    const link = document.querySelector('[data-testid="invite-signin-link"]');
    return {
      pageTitle: read("h1"),
      phase: document.querySelector('[data-testid="invite-card"]')?.getAttribute("data-phase") || "",
      noteText: read('[data-testid="invite-note"]'),
      signInText: read('[data-testid="invite-signin-link"]'),
      signInHref: link ? link.getAttribute("href") : "",
      returnLine: read('[data-testid="invite-return"]'),
      linkLifeLine: read('[data-testid="invite-link-life"]'),
      tokenInVisibleText: (document.body.innerText || "").includes("9f2c41ba7d194e6a9c035b71ee0a4d22"),
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

async function main() {
  const capturedAtHead = currentGitHead();
  const child = startServer();
  const files = [];
  const measurements = {};
  try {
    await waitForServer(180_000);
    const browser = await chromium.launch();
    try {
      const shots = [];
      for (const viewport of ["desktop", "mobile"]) {
        for (const lang of ["en", "zh"]) {
          shots.push({ surface: "team-form", viewport, lang, file: `${viewport}-${lang}-team-invite-form.png` });
          shots.push({ surface: "team-link", viewport, lang, file: `${viewport}-${lang}-team-invite-link.png` });
          shots.push({ surface: "invite-signin", viewport, lang, file: `${viewport}-${lang}-invite-signin.png` });
          shots.push({ surface: "invite-joined", viewport, lang, file: `${viewport}-${lang}-invite-joined.png` });
        }
      }

      for (const shot of shots) {
        process.stdout.write(`capture ${shot.file} … `);
        const { context, page } = await newPage(browser, shot.lang, shot.viewport);
        const expect = COPY[shot.lang];
        try {
          if (shot.surface === "team-form" || shot.surface === "team-link") {
            await stubInvitations(page);
            await openTeam(page, shot.lang);
            if (shot.surface === "team-link") {
              await page.fill('[data-testid="team-invite-email"]', INVITED_EMAIL);
              await page.click('[data-testid="team-invite-create"]');
              await page.locator('[data-testid="team-invite-link"]').waitFor({ state: "visible", timeout: 15_000 });
              await page.locator('[data-testid="team-invite-link"]').evaluate((el) => el.scrollIntoView({ block: "center", inline: "nearest" }));
              await page.waitForTimeout(200);
            } else {
              await page.locator('[data-testid="team-invite-form"]').evaluate((el) => el.scrollIntoView({ block: "center", inline: "nearest" }));
              await page.waitForTimeout(200);
            }
            const m = await measureTeam(page, shot.surface);
            measurements[shot.file] = m;
            want(m.inviteGroupTitle, expect.inviteGroup, "invite group title", shot.file);
            want(m.deliveryLine, expect.deliveryLine, "dated delivery line", shot.file);
            want(m.roleOptions, shot.lang === "zh" ? "成员 | 管理员" : "Member | Administrator", "role options", shot.file);
            if (m.tokenInVisibleText) throw new Error(`${shot.file}: the raw token is printed as prose`);
            if (shot.surface === "team-form") {
              want(m.formPresent, true, "invitation form", shot.file);
              want(m.createButtonText, expect.createButton, "create button", shot.file);
              want(m.linkPresent, false, "link block before create", shot.file);
            } else {
              want(m.linkPresent, true, "link block", shot.file);
              want(m.linkLabel, expect.linkLabel, "link label", shot.file);
              want(m.linkValue, LINK, "link value", shot.file);
              want(m.linkReadOnly, true, "link field read-only", shot.file);
              want(m.copyButtonText, expect.copyButton, "copy button", shot.file);
              want(m.sendLine, expect.sendLine, "send-it-yourself line", shot.file);
            }
            await assertNoNextIndicator(page, shot.file);
            await page.mouse.move(0, 0);
            await page.waitForTimeout(120);
            await page.locator(".acs-overlay.open").screenshot({ path: join(OUT, shot.file) });
          } else {
            if (shot.surface === "invite-joined") {
              await stubSession(page);
              await stubInvitations(page, { accept: true });
            }
            await page.goto(`${BASE}/invite?token=${TOKEN}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
            await page.locator('[data-testid="invite-card"]').waitFor({ state: "visible", timeout: 30_000 });
            if (shot.surface === "invite-joined") {
              await page.locator('[data-testid="invite-accept"]').waitFor({ state: "visible", timeout: 20_000 });
              await page.click('[data-testid="invite-accept"]');
              await page.locator('[data-testid="invite-open"]').waitFor({ state: "visible", timeout: 20_000 });
            } else {
              await page.locator('[data-testid="invite-signin-link"]').waitFor({ state: "visible", timeout: 30_000 });
            }
            await stripDevOverlay(page);
            await page.waitForTimeout(200);
            const m = await measureInvite(page);
            measurements[shot.file] = m;
            want(m.pageTitle, expect.pageTitle, "page heading", shot.file);
            want(m.linkLifeLine, shot.lang === "zh" ? "邀请链接 14 天内有效，且只能使用一次。" : "An invitation link works for 14 days and can be used once.", "link lifetime line", shot.file);
            if (m.tokenInVisibleText) throw new Error(`${shot.file}: the raw token is printed as prose`);
            if (shot.surface === "invite-joined") {
              want(m.phase, "joined", "phase", shot.file);
              want(m.noteText, expect.joined, "joined sentence", shot.file);
            } else {
              want(m.phase, "signed-out", "phase", shot.file);
              want(m.signInText, expect.signIn, "sign-in control", shot.file);
              want(m.signInHref, "/terminal?signin=1", "sign-in target", shot.file);
              want(m.returnLine, expect.signInReturn, "come-back line", shot.file);
            }
            await assertNoNextIndicator(page, shot.file);
            await page.mouse.move(0, 0);
            await page.waitForTimeout(120);
            await page.screenshot({ path: join(OUT, shot.file) });
          }
          files.push(shot.file);
          const overflow = measurements[shot.file].horizontalOverflow;
          console.log(`ok${overflow > 0 ? ` (horizontal overflow ${overflow}px)` : ""}`);
        } catch (err) {
          console.log(`FAIL ${err && err.message ? err.message : err}`);
          try {
            await page.screenshot({ path: join(OUT, `FAIL-${shot.file}`) });
          } catch { /* ignore */ }
          throw err;
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
  } finally {
    stopServer(child);
  }

  const measureKeys = [
    "inviteGroupTitle", "pendingGroupTitle", "deliveryLine", "formPresent", "createButtonText",
    "emailLabel", "roleLabel", "roleOptions", "linkPresent", "linkValue", "linkReadOnly",
    "linkLabel", "copyButtonText", "sendLine", "pageTitle", "phase", "noteText", "signInText",
    "signInHref", "returnLine", "linkLifeLine", "tokenInVisibleText", "horizontalOverflow",
  ];
  const evidence = [
    "# W9T_F12_17 / MO-PAID-081 — copyable invitation link + the dated no-email-delivery line",
    "# Terminal is dark-only: DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06",
    "# Seat ruling 2026-09-13: honest link-only. No mail provider is provisioned by this lane.",
    "# layoutFiles carry sha256 hashes of the files they name; proof of which code generated each crop.",
    "# Rebuild any crop and recompute its layoutFiles, or the evidence lock will fail and the PR will not land.",
    `# capturedAtHead: ${capturedAtHead}`,
    `capturedAtHead: ${capturedAtHead}`,
    `capturedAt: ${new Date().toISOString()}`,
    "layoutFiles:",
    ...layoutFilesBlock(),
    "theme: dark",
    "languages: [en, zh]",
    "viewports:",
    "  - 1440x900",
    "  - 390x844",
    "harness: /dev/settings?s=team&lang=<en|zh> (Settings ▸ Team) and /invite?token=<64 hex> (public accept page)",
    "network_stubs: POST/GET /api/teams/invitations answered with the shape app/api/teams/invitations/route.ts returns; /invite joined frames also answer GET <supabase>/auth/v1/user. The harness has no database, so the real component is driven by the real answer shape.",
    "capture_flag: TERMINAL_E2E_FIXTURE",
    "capture_flag_law: Set TERMINAL_E2E_FIXTURE=1 and next.config.ts sets devIndicators false, hiding the Next.js dev button overlay from crops.",
    "command: node terminal/e2e/tools/capture_w9t_f12_17_invite_link.cjs",
    "files:",
    ...files.map((f) => `  - ${f}`),
    "measurements:",
    ...Object.entries(measurements).map(([file, m]) => {
      const parts = measureKeys
        .filter((k) => m[k] !== undefined && m[k] !== "")
        .map((k) => `${k}: ${JSON.stringify(m[k])}`);
      return `  ${file}: { ${parts.join(", ")} }`;
    }),
    "",
  ].join("\n");
  writeFileSync(join(OUT, "EVIDENCE.yml"), evidence);
  console.log(`capturedAtHead ${capturedAtHead}`);
  console.log(`wrote ${files.length} crops + EVIDENCE.yml to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
