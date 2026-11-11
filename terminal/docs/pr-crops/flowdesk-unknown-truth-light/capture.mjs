/**
 * Flow Desk unknown-truth crops, light and dark.
 *
 *   cd terminal && node docs/pr-crops/flowdesk-unknown-truth-light/capture.mjs                 # light
 *   cd terminal && CROP_THEME=dark node docs/pr-crops/flowdesk-unknown-truth-light/capture.mjs # dark
 *
 * Light: the only light presentation of the Flow Desk is the Shared Shell beta
 * (MMX_SHARED_SHELL=1), which applies `data-theme="light"` from the viewer's stored choice
 * (localStorage `mmx.shell.theme`) and redefines the tokens under
 * `:root[data-mmx-shared-shell="1"][data-theme="light"]`. Crops land next to this file.
 * Dark: the default Terminal shell (no Shared Shell flag, `<html data-theme="dark">`), the
 * presentation a viewer gets today. Crops land in ../flowdesk-unknown-truth-dark/.
 *
 * Each run starts `next dev` with the fixture identity, scripts only the flow-feed transport,
 * and crops the unknown-truth states:
 *   unavailable       — the stream is refused and the poll answers 503: load error, the
 *                       toolbar names the held state (no count, no coverage claim), the
 *                       watchlist says the feed did not load, the left rail has no gauge;
 *   absent-first      — a named `status: absent` event before any frame: the toolbar says
 *                       no feed is published, the list carries the absent note;
 *   absent-after-data — a frame, then a named `status: absent` event: the held cards stay
 *                       and a status note says the latest read found nothing published;
 *   loading           — both feed routes held: the skeleton, the toolbar says the feed is
 *                       loading, the left rail has no gauge;
 *   na-score          — the fixture feed with flowScore withheld on alternate events: an
 *                       unscored card draws the no-reading ring (track on var(--hairline)),
 *                       next to a scored card;
 *   gauge-partial     — the fixture feed with the first print's premium withheld: the session
 *                       gauge is unavailable and names how many prints are missing;
 *   gauge-empty       — a published feed with no prints: "0" signals (a reading), and the
 *                       gauge is unavailable with its reason instead of $0 and 50/50.
 * The feed is the fixture server's own; nothing here is market data or provider evidence.
 *
 * capturedAtHead: CAPTURE_HEAD names the commit an uncommitted tree builds on (no git is run);
 * otherwise `git rev-parse HEAD`. It is informational; the lock is layoutFiles.
 */
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const HERE = dirname(fileURLToPath(import.meta.url));
const THEME = process.env.CROP_THEME === "dark" ? "dark" : "light";
const OUT = THEME === "dark" ? join(HERE, "..", "flowdesk-unknown-truth-dark") : HERE;
const ROOT = join(HERE, "..", "..", "..");
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
  "terminal/components/flowdesk/FlowGauge.tsx",
  "terminal/components/flowdesk/PrintInspector.tsx",
  "terminal/components/flowdesk/WatchlistRail.tsx",
  "terminal/components/ui/RingGauge.tsx",
  "terminal/lib/flowPrintInspector.ts",
  "terminal/lib/flowdeskStrings.ts",
];
const STATES = ["unavailable", "absent-first", "absent-after-data", "loading", "na-score", "gauge-partial", "gauge-empty"];
const HELD_STATE = { unavailable: "unavailable", "absent-first": "absent", loading: "loading" };
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
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-anon-key",
  };
  if (THEME === "light") env.MMX_SHARED_SHELL = "1";
  else delete env.MMX_SHARED_SHELL;
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
    locale: lang === "zh" ? "zh-CN" : "en-US", colorScheme: THEME,
  });
  await context.addInitScript(([l, theme]) => {
    localStorage.setItem("mm.lang", l);
    localStorage.setItem("mmx.shell.theme", theme);
    localStorage.setItem("flowdesk.tutorial.seen", "1");
    document.documentElement.setAttribute("data-lang", l);
  }, [lang, THEME]);
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

/** A crop is only evidence for its theme if the document really is that presentation. */
async function presentation(page) {
  return page.evaluate(() => ({
    theme: document.documentElement.dataset.theme ?? null,
    sharedShell: document.documentElement.dataset.mmxSharedShell ?? null,
    bg: getComputedStyle(document.body).backgroundColor,
  }));
}

function assertPresentation(pres) {
  if (THEME === "light") {
    if (pres.theme !== "light" || pres.sharedShell !== "1") throw new Error(`not the light Shared Shell: ${JSON.stringify(pres)}`);
  } else if (pres.theme !== "dark" || pres.sharedShell !== null) {
    throw new Error(`not the default dark Terminal shell: ${JSON.stringify(pres)}`);
  }
}

async function shoot(page, file, meta, how) {
  try {
    const pres = await presentation(page);
    assertPresentation(pres);
    await settle(page);
    const path = join(OUT, file);
    await how(path);
    crops.push({ file, ...meta, theme: pres.theme, sharedShell: pres.sharedShell ?? "absent", sha256: sha256(readFileSync(path)) });
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

async function scriptTransport(page, state, feeds, held) {
  const stream = (body) => page.route(isStream, (route) => route.fulfill({ status: 200, headers: SSE, body }));
  const frame = (feed) => `data: ${JSON.stringify(feed)}\n\n`;
  if (state === "unavailable") {
    await page.route(isStream, (route) => route.abort("failed"));
    await page.route(isPoll, (route) => route.fulfill({ status: 503, json: { error: "feed unavailable" } }));
  } else if (state === "absent-first") {
    await stream(`retry: 3600000\n\nevent: status\ndata: {"status":"absent"}\n\n`);
  } else if (state === "absent-after-data") {
    await stream(`retry: 3600000\n\n${frame(feeds.feed)}event: status\ndata: {"status":"absent"}\n\n`);
  } else if (state === "loading") {
    await page.route((url) => isStream(url) || isPoll(url), (route) => { held.push(route); });
  } else if (state === "na-score") {
    await stream(`retry: 3600000\n\n${frame(feeds.naFeed)}`);
  } else if (state === "gauge-partial") {
    await stream(`retry: 3600000\n\n${frame(feeds.partialFeed)}`);
  } else {
    await stream(`retry: 3600000\n\n${frame(feeds.emptyFeed)}`);
  }
}

async function assertHeldToolbar(page, state) {
  const count = page.locator(".obs-fd-count");
  const label = count.getByTestId("flowfeed-count-held");
  await label.waitFor({ state: "visible" });
  const held = await label.getAttribute("data-held-state");
  if (held !== HELD_STATE[state]) throw new Error(`toolbar held state ${held}, expected ${HELD_STATE[state]}`);
  if (/\d/.test((await count.textContent()) ?? "")) throw new Error("a count was drawn for a feed that never loaded");
  if (await page.getByTestId("flow-coverage").count()) throw new Error("a coverage claim was drawn with no feed");
}

async function captureState(browser, state, width, lang, feeds, checks) {
  const { context, page } = await newPage(browser, width, lang);
  const held = [];
  const tag = `${state}-${width}${lang === "zh" ? "-zh" : ""}`;
  const meta = (part) => ({ viewport: `${VIEWPORTS[width].width}x${VIEWPORTS[width].height}`, lang, state, part });
  try {
    await scriptTransport(page, state, feeds, held);
    await page.goto(URL_DESK);
    const left = page.locator(".obs-fd-left");
    const gaugeSlot = left.getByTestId("flow-gauge-slot");
    const gauge = page.locator('[data-tut="flow-gauge"]');
    if (state === "unavailable") {
      await page.getByTestId("flowfeed-load-error").waitFor({ state: "visible" });
      await left.getByTestId("watchlist-feed-unavailable").waitFor({ state: "visible" });
      if (await gaugeSlot.count()) throw new Error("a flow gauge drawn with no feed");
      await assertHeldToolbar(page, state);
    } else if (state === "absent-first") {
      await page.getByTestId("flowfeed-absent").waitFor({ state: "visible" });
      if (await gaugeSlot.count()) throw new Error("a flow gauge drawn with no feed");
      await assertHeldToolbar(page, state);
    } else if (state === "absent-after-data") {
      const note = page.getByTestId("flowfeed-refresh-absent");
      await note.waitFor({ state: "visible" });
      await page.locator(".obs-fc-card").first().waitFor({ state: "visible" });
      // The held note is its own full-width row of the feed list, not a card's cell.
      const row = await note.evaluate((el) => ({
        parentIsList: el.parentElement?.classList.contains("obs-fd-list") === true,
        gridColumnStart: getComputedStyle(el).gridColumnStart,
        gridColumnEnd: getComputedStyle(el).gridColumnEnd,
      }));
      if (!row.parentIsList || row.gridColumnStart !== "1" || row.gridColumnEnd !== "-1") {
        throw new Error(`held note is not a full-width list row: ${JSON.stringify(row)}`);
      }
      // The gauge beside it says its totals are the last read.
      await gauge.getByTestId("flow-gauge-held").waitFor({ state: "visible" });
    } else if (state === "loading") {
      await page.locator(".obs-fd-left .fin-skel").first().waitFor({ state: "visible" });
      if (await gaugeSlot.count()) throw new Error("a flow gauge drawn while the read is in flight");
      await assertHeldToolbar(page, state);
    } else if (state === "na-score") {
      await page.locator('.obs-fc-card [data-score-state="unavailable"]').first().waitFor({ state: "visible" });
    } else {
      await gauge.waitFor({ state: "visible" });
      const gs = await gauge.getAttribute("data-gauge-state");
      if (gs !== "unavailable") throw new Error(`gauge state ${gs}, expected unavailable`);
      const text = (await gauge.textContent()) ?? "";
      if (text.includes("$0") || text.includes("50%")) throw new Error("the gauge drew $0 or 50% for a missing component");
      await gauge.getByTestId("flow-gauge-reason").waitFor({ state: "visible" });
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    if (width === 1440) await shoot(page, `${tag}-context.png`, meta("viewport"), viewportShot(page));
    if (HELD_STATE[state]) {
      await shoot(page, `${tag}-toolbar.png`, meta(".obs-fd-toolbar held count"), elementShot(page.locator(".obs-fd-toolbar")));
    }
    if (state === "unavailable") {
      await shoot(page, `${tag}-load-error.png`, meta("flowfeed-load-error"), elementShot(page.getByTestId("flowfeed-load-error")));
      await shoot(page, `${tag}-watchlist.png`, meta("watchlist-feed-unavailable"), elementShot(left.getByTestId("watchlist-feed-unavailable")));
    } else if (state === "absent-first") {
      await shoot(page, `${tag}-note.png`, meta("flowfeed-absent"), elementShot(page.getByTestId("flowfeed-absent")));
    } else if (state === "absent-after-data") {
      await shoot(page, `${tag}-note.png`, meta("flowfeed-refresh-absent"), elementShot(page.getByTestId("flowfeed-refresh-absent")));
      await shoot(page, `${tag}-gauge.png`, meta('[data-tut="flow-gauge"] held, last-read totals'), elementShot(gauge));
    } else if (state === "loading") {
      await shoot(page, `${tag}-rail.png`, meta(".obs-fd-left skeleton"), elementShot(page.locator(".obs-fd-left .fin-skel").first()));
    } else if (state === "na-score") {
      const naCard = page.locator(".obs-fc-card").filter({ has: page.locator('[data-score-state="unavailable"]') }).first();
      const scored = page.locator(".obs-fc-card").filter({ hasNot: page.locator('[data-score-state="unavailable"]') }).first();
      await shoot(page, `${tag}-na-card.png`, meta("unscored .obs-fc-card"), elementShot(naCard));
      await shoot(page, `${tag}-scored-card.png`, meta("scored .obs-fc-card"), elementShot(scored));
      const stroke = await naCard.locator('[data-score-state="unavailable"] circle').first()
        .evaluate((el) => getComputedStyle(el).stroke);
      const hairline = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--hairline").trim());
      checks.push({ crop: tag, naTrackStroke: stroke, rootHairline: hairline });
    } else {
      await shoot(page, `${tag}-gauge.png`, meta('[data-tut="flow-gauge"] unavailable'), elementShot(gauge));
      if (state === "gauge-empty") {
        await shoot(page, `${tag}-toolbar.png`, meta(".obs-fd-toolbar published empty tape"), elementShot(page.locator(".obs-fd-toolbar")));
      }
    }
  } catch (err) {
    failures.push(`${tag}: ${err.message.split("\n")[0]}`);
    process.stdout.write(`state ${tag} … FAILED ${err.message.split("\n")[0]}\n`);
  } finally {
    for (const route of held) await route.abort("aborted").catch(() => {});
    await context.close();
  }
}

function capturedAtHead() {
  if (process.env.CAPTURE_HEAD) {
    if (!/^[0-9a-f]{40}$/.test(process.env.CAPTURE_HEAD)) throw new Error("CAPTURE_HEAD must be a 40-hex commit");
    return { head: process.env.CAPTURE_HEAD, source: "CAPTURE_HEAD (the commit this uncommitted tree builds on)" };
  }
  return { head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(), source: "git rev-parse HEAD" };
}

async function main() {
  const { head, source } = capturedAtHead();
  mkdirSync(OUT, { recursive: true });
  const server = startServer();
  const checks = [];
  try {
    const feed = await waitForServer(240_000);
    if (!Array.isArray(feed?.events) || feed.events.length < 2) throw new Error("fixture feed has fewer than two events");
    const feeds = {
      feed,
      // Alternate events lose their flowScore, so an unscored card sits beside a scored one.
      naFeed: { ...feed, events: feed.events.map((ev, i) => {
        if (i % 2 === 0) return ev;
        const copy = { ...ev };
        delete copy.flowScore;
        return copy;
      }) },
      // The first print's premium is withheld: the session totals would be incomplete.
      partialFeed: { ...feed, events: feed.events.map((ev, i) => (i === 0 ? { ...ev, premium: null } : ev)) },
      // A published tape with no prints yet.
      emptyFeed: { ...feed, events: [], unusual_names: [] },
    };
    const browser = await chromium.launch({ headless: true });
    try {
      for (const lang of ["en", "zh"]) {
        for (const width of [1440, 390]) {
          for (const state of STATES) await captureState(browser, state, width, lang, feeds, checks);
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
  const themeLine = THEME === "light"
    ? `theme: ${JSON.stringify("light — Shared Shell beta only (MMX_SHARED_SHELL=1, localStorage mmx.shell.theme=light).")}`
    : `theme: ${JSON.stringify("dark — the default Terminal shell (no MMX_SHARED_SHELL; <html data-theme=\"dark\">).")}`;
  const command = THEME === "light"
    ? "cd terminal && node docs/pr-crops/flowdesk-unknown-truth-light/capture.mjs"
    : "cd terminal && CROP_THEME=dark node docs/pr-crops/flowdesk-unknown-truth-light/capture.mjs";
  // Every free-text value is written as a JSON string (a valid YAML double-quoted
  // scalar), so a selector part such as [data-tut="flow-gauge"] keeps the file parseable.
  const q = (s) => JSON.stringify(String(s));
  const lines = [
    `capturedAtHead: ${head}`,
    `capturedAtHeadSource: ${q(source)}`,
    "# capturedAtHead is informational. The lock is layoutFiles.",
    `capturedAt: ${new Date().toISOString()}`,
    `command: ${q(command)}`,
    themeLine,
    `sources: ${q("the FLOW_FIXTURE dev server's own feed; only the /api/flow/stream and /api/flow?f=feed transport is scripted; na-score withholds flowScore on alternate events, gauge-partial withholds the first print's premium, gauge-empty publishes no prints. Not market data or provider evidence.")}`,
    "layoutFiles:", ...LAYOUT_FILES.flatMap((f) => [`  - path: ${f}`, `    sha256: ${sha256(readFileSync(join(REPO, f)))}`]),
    "naTrackChecks:", ...checks.flatMap((c) => [`  - crop: ${c.crop}`, `    naTrackStroke: ${q(c.naTrackStroke)}`, `    rootHairline: ${q(c.rootHairline)}`]),
    "crops:", ...crops.flatMap((c) => [`  - file: ${c.file}`, `    viewport: ${c.viewport}`, `    lang: ${c.lang}`, `    state: ${c.state}`,
      `    part: ${q(c.part)}`, `    htmlTheme: ${c.theme}`, `    sharedShell: ${q(c.sharedShell)}`, `    sha256: ${c.sha256}`]),
  ];
  writeFileSync(join(OUT, "EVIDENCE.yml"), lines.join("\n") + "\n");
  process.stdout.write(`wrote ${crops.length} ${THEME} crops + EVIDENCE.yml (head ${head})\n`);
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
