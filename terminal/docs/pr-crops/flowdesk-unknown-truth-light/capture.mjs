/**
 * Flow Desk unknown-truth crops in the Shared Shell LIGHT theme.
 *
 *   cd terminal && node docs/pr-crops/flowdesk-unknown-truth-light/capture.mjs
 *
 * The legacy Terminal shell is dark-only. The only light presentation of the Flow Desk is
 * the Shared Shell beta (MMX_SHARED_SHELL=1), which applies `data-theme="light"` from the
 * viewer's stored choice (localStorage `mmx.shell.theme`) and redefines the tokens under
 * `:root[data-mmx-shared-shell="1"][data-theme="light"]`. This runner starts `next dev`
 * with that flag and the fixture identity, scripts only the flow-feed transport, and crops
 * the unknown-truth states the dark packet does not show in light:
 *   unavailable       — the stream is refused and the poll answers 503: load error, the
 *                       watchlist says the feed did not load, no flow gauge;
 *   absent-after-data — a frame, then a named `status: absent` event: the held cards stay
 *                       and a status note says the latest read found nothing published;
 *   loading           — both feed routes held: the skeleton, no flow gauge;
 *   na-score          — the fixture feed with flowScore withheld on alternate events: an
 *                       unscored card draws the no-reading ring (track on var(--hairline)),
 *                       next to a scored card.
 * The feed is the fixture server's own; nothing here is market data or provider evidence.
 * Writes PNGs + EVIDENCE.yml next to this file.
 */
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const OUT = dirname(fileURLToPath(import.meta.url));
const ROOT = join(OUT, "..", "..", "..");
const REPO = join(ROOT, "..");
const PORT = Number(process.env.TERMINAL_CROP_PORT || 3566);
const BASE = `http://127.0.0.1:${PORT}`;
const URL_DESK = "/options?tab=desk";
const VIEWPORTS = { 1440: { width: 1440, height: 900 }, 390: { width: 390, height: 844 } };
const LAYOUT_FILES = [
  "terminal/app/globals.css",
  "terminal/app/observatory.css",
  "terminal/components/chrome/shared-shell/shared-shell.css",
  "terminal/components/flowdesk/FeedPane.tsx",
  "terminal/components/flowdesk/FlowCard.tsx",
  "terminal/components/flowdesk/FlowDeskView.tsx",
  "terminal/components/flowdesk/WatchlistRail.tsx",
  "terminal/components/ui/RingGauge.tsx",
  "terminal/lib/flowdeskStrings.ts",
];
const STATES = ["unavailable", "absent-after-data", "loading", "na-score"];
const isStream = (url) => url.pathname === "/api/flow/stream" && url.searchParams.get("f") === "feed";
const isPoll = (url) => url.pathname === "/api/flow" && url.searchParams.get("f") === "feed";
const SSE = { "Content-Type": "text/event-stream", "Cache-Control": "no-store" };

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const crops = [];
const failures = [];

function startServer() {
  const env = {
    ...process.env,
    ANALYSIS_LOCAL_PREVIEW: "1",
    ADMIN_DEV: "1",
    TERMINAL_E2E_FIXTURE: "1",
    TERMINAL_E2E_EMAIL: "responsive@example.com",
    TERMINAL_E2E_ENTITLEMENT: "unlimited",
    RATE_LIMIT_MAX: "100000",
    FLOW_FIXTURE: "1",
    MMX_SHARED_SHELL: "1",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-anon-key",
  };
  const child = spawn("npm", ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(PORT)], {
    cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"], detached: true,
  });
  child.stdout.on("data", (buf) => { if (/Ready|error/i.test(String(buf))) process.stdout.write(`[dev] ${buf}`); });
  child.stderr.on("data", (buf) => process.stderr.write(`[dev:err] ${buf}`));
  return child;
}

function stopServer(child) {
  if (!child?.pid) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch { try { child.kill("SIGTERM"); } catch { /* gone */ } }
}

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = "not tried";
  while (Date.now() < deadline) {
    try {
      const page = await fetch(`${BASE}${URL_DESK}`, { redirect: "manual" });
      const feed = await fetch(`${BASE}/api/flow?f=feed`);
      last = `page ${page.status}, feed ${feed.status}`;
      if (page.status === 200 && feed.status === 200) return await feed.json();
    } catch (err) {
      last = err.cause?.code || err.message;
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  throw new Error(`dev server on ${PORT} never answered (${last})`);
}

async function newPage(browser, width, lang) {
  const context = await browser.newContext({
    baseURL: BASE, viewport: VIEWPORTS[width], hasTouch: width !== 1440,
    locale: lang === "zh" ? "zh-CN" : "en-US", colorScheme: "light",
  });
  await context.addInitScript((l) => {
    localStorage.setItem("mm.lang", l);
    localStorage.setItem("mmx.shell.theme", "light");
    localStorage.setItem("flowdesk.tutorial.seen", "1");
    document.documentElement.setAttribute("data-lang", l);
  }, lang);
  await context.addCookies([{ name: "mm_e2e_rs30", value: "1", url: BASE }]);
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);
  return { context, page };
}

async function settle(page) {
  await page.evaluate(() => document.querySelectorAll("nextjs-portal").forEach((el) => el.remove()));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(300);
}

/** The crop is only light evidence if the document really is the light Shared Shell. */
async function presentation(page) {
  return page.evaluate(() => ({
    theme: document.documentElement.dataset.theme ?? null,
    sharedShell: document.documentElement.dataset.mmxSharedShell ?? null,
    bg: getComputedStyle(document.body).backgroundColor,
  }));
}

async function shoot(page, file, meta, how) {
  try {
    const pres = await presentation(page);
    if (pres.theme !== "light" || pres.sharedShell !== "1") throw new Error(`not the light Shared Shell: ${JSON.stringify(pres)}`);
    await settle(page);
    const path = join(OUT, file);
    await how(path);
    crops.push({ file, ...meta, theme: pres.theme, sharedShell: pres.sharedShell, sha256: sha256(readFileSync(path)) });
    process.stdout.write(`capture ${file} … ok\n`);
  } catch (err) {
    failures.push(`${file}: ${err.message.split("\n")[0]}`);
    process.stdout.write(`capture ${file} … FAILED ${err.message.split("\n")[0]}\n`);
  }
}

const viewportShot = (page) => (path) => page.screenshot({ path, animations: "disabled" });
const elementShot = (locator) => async (path) => {
  await locator.scrollIntoViewIfNeeded();
  await locator.screenshot({ path, animations: "disabled" });
};

async function scriptTransport(page, state, feed, naFeed, held) {
  if (state === "unavailable") {
    await page.route(isStream, (route) => route.abort("failed"));
    await page.route(isPoll, (route) => route.fulfill({ status: 503, json: { error: "feed unavailable" } }));
  } else if (state === "absent-after-data") {
    const body = `retry: 3600000\n\ndata: ${JSON.stringify(feed)}\n\nevent: status\ndata: {"status":"absent"}\n\n`;
    await page.route(isStream, (route) => route.fulfill({ status: 200, headers: SSE, body }));
  } else if (state === "loading") {
    await page.route((url) => isStream(url) || isPoll(url), (route) => { held.push(route); });
  } else {
    const body = `retry: 3600000\n\ndata: ${JSON.stringify(naFeed)}\n\n`;
    await page.route(isStream, (route) => route.fulfill({ status: 200, headers: SSE, body }));
  }
}

async function captureState(browser, state, width, lang, feed, naFeed, checks) {
  const { context, page } = await newPage(browser, width, lang);
  const held = [];
  const tag = `${state}-${width}${lang === "zh" ? "-zh" : ""}`;
  const meta = (part) => ({ viewport: `${VIEWPORTS[width].width}x${VIEWPORTS[width].height}`, lang, state, part });
  try {
    await scriptTransport(page, state, feed, naFeed, held);
    await page.goto(URL_DESK);
    const left = page.locator(".obs-fd-left");
    const gauge = left.getByTestId("flow-gauge-slot");
    if (state === "unavailable") {
      await page.getByTestId("flowfeed-load-error").waitFor({ state: "visible" });
      await left.getByTestId("watchlist-feed-unavailable").waitFor({ state: "visible" });
      if (await gauge.count()) throw new Error("a flow gauge drawn with no feed");
    } else if (state === "absent-after-data") {
      await page.getByTestId("flowfeed-refresh-absent").waitFor({ state: "visible" });
      await page.locator(".obs-fc-card").first().waitFor({ state: "visible" });
    } else if (state === "loading") {
      await page.locator(".obs-fd-left .fin-skel").first().waitFor({ state: "visible" });
      if (await gauge.count()) throw new Error("a flow gauge drawn while the read is in flight");
    } else {
      await page.locator('.obs-fc-card [data-score-state="unavailable"]').first().waitFor({ state: "visible" });
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    if (width === 1440) await shoot(page, `${tag}-context.png`, meta("viewport"), viewportShot(page));
    if (state === "unavailable") {
      await shoot(page, `${tag}-load-error.png`, meta("flowfeed-load-error"), elementShot(page.getByTestId("flowfeed-load-error")));
      await shoot(page, `${tag}-watchlist.png`, meta("watchlist-feed-unavailable"), elementShot(left.getByTestId("watchlist-feed-unavailable")));
    } else if (state === "absent-after-data") {
      await shoot(page, `${tag}-note.png`, meta("flowfeed-refresh-absent"), elementShot(page.getByTestId("flowfeed-refresh-absent")));
    } else if (state === "loading") {
      await shoot(page, `${tag}-rail.png`, meta(".obs-fd-left skeleton"), elementShot(page.locator(".obs-fd-left .fin-skel").first()));
    } else {
      const naCard = page.locator(".obs-fc-card").filter({ has: page.locator('[data-score-state="unavailable"]') }).first();
      const scored = page.locator(".obs-fc-card").filter({ hasNot: page.locator('[data-score-state="unavailable"]') }).first();
      await shoot(page, `${tag}-na-card.png`, meta("unscored .obs-fc-card"), elementShot(naCard));
      await shoot(page, `${tag}-scored-card.png`, meta("scored .obs-fc-card"), elementShot(scored));
      const stroke = await naCard.locator('[data-score-state="unavailable"] circle').first()
        .evaluate((el) => getComputedStyle(el).stroke);
      const hairline = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--hairline").trim());
      checks.push({ crop: tag, naTrackStroke: stroke, rootHairline: hairline });
    }
  } catch (err) {
    failures.push(`${tag}: ${err.message.split("\n")[0]}`);
    process.stdout.write(`state ${tag} … FAILED ${err.message.split("\n")[0]}\n`);
  } finally {
    for (const route of held) await route.abort("aborted").catch(() => {});
    await context.close();
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const server = startServer();
  const checks = [];
  try {
    const feed = await waitForServer(240_000);
    if (!Array.isArray(feed?.events) || feed.events.length < 2) throw new Error("fixture feed has fewer than two events");
    // Alternate events lose their flowScore, so an unscored card sits beside a scored one.
    const naFeed = { ...feed, events: feed.events.map((ev, i) => {
      if (i % 2 === 0) return ev;
      const copy = { ...ev };
      delete copy.flowScore;
      return copy;
    }) };
    const browser = await chromium.launch({ headless: true });
    try {
      for (const lang of ["en", "zh"]) {
        for (const width of [1440, 390]) {
          for (const state of STATES) await captureState(browser, state, width, lang, feed, naFeed, checks);
        }
      }
    } finally {
      await browser.close();
    }
  } finally {
    stopServer(server);
  }
  if (failures.length) {
    process.stdout.write(`FAILED ${failures.length}:\n${failures.join("\n")}\n`);
    process.exitCode = 1;
    return;
  }
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  const lines = [
    `capturedAtHead: ${head}`,
    `capturedAt: ${new Date().toISOString()}`,
    `command: "cd terminal && node docs/pr-crops/flowdesk-unknown-truth-light/capture.mjs"`,
    `theme: light — Shared Shell beta only (MMX_SHARED_SHELL=1, localStorage mmx.shell.theme=light); the legacy Terminal shell is dark-only.`,
    `sources: the FLOW_FIXTURE dev server's own feed; only the /api/flow/stream and /api/flow?f=feed transport is scripted; na-score withholds flowScore on alternate events. Not market data or provider evidence.`,
    "layoutFiles:", ...LAYOUT_FILES.flatMap((f) => [`  - path: ${f}`, `    sha256: ${sha256(readFileSync(join(REPO, f)))}`]),
    "naTrackChecks:", ...checks.flatMap((c) => [`  - crop: ${c.crop}`, `    naTrackStroke: "${c.naTrackStroke}"`, `    rootHairline: "${c.rootHairline}"`]),
    "crops:", ...crops.flatMap((c) => [`  - file: ${c.file}`, `    viewport: ${c.viewport}`, `    lang: ${c.lang}`, `    state: ${c.state}`,
      `    part: "${c.part}"`, `    htmlTheme: ${c.theme}`, `    sharedShell: "${c.sharedShell}"`, `    sha256: ${c.sha256}`]),
  ];
  writeFileSync(join(OUT, "EVIDENCE.yml"), lines.join("\n") + "\n");
  process.stdout.write(`wrote ${crops.length} crops + EVIDENCE.yml (head ${head})\n`);
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
