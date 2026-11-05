import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const out = path.dirname(new URL(import.meta.url).pathname);
const proof = path.join(out, "qualified-v3");
fs.mkdirSync(proof, { recursive: false });
const require = createRequire(out + "/next-fixture/package.json");
const { chromium, expect } = require("@playwright/test");
const base = "http://127.0.0.1:3100", child = "http://127.0.0.1:31998";
const primary = ["/today", "/discover", "/analysis", "/monitor", "/research", "/portfolio"];
const markets = ["/us_stocks.html", "/china.html", "/hk.html", "/canada.html", "/intl.html"];
const browser = await chromium.launch({ headless: true });
const results = [];
let page;
try {
  for (const cell of [{ width: 1440, theme: "dark", lang: "en" }, { width: 390, theme: "light", lang: "zh" }]) {
    const { width, theme, lang } = cell;
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width === 390 });
    const errors = [], blocked = [], calls = [], states = [];
    page = await ctx.newPage();
    page.on("pageerror", e => errors.push(e.message));
    await ctx.addCookies([{ name: "fixtureTheme", value: theme, url: base }, { name: "fixtureLang", value: lang, url: base }]);
    await page.addInitScript(({ theme, lang }) => {
      localStorage.setItem("mmx.shell.theme", theme);
      localStorage.setItem("mmx.lang", lang);
    }, { theme, lang });
    await ctx.route("**/*", r => {
      const u = new URL(r.request().url());
      if (![base, child].includes(u.origin)) { blocked.push(u.origin + u.pathname); return r.abort(); }
      if (u.origin === child || !u.pathname.startsWith("/api/") || u.pathname === "/api/shared-shell/status") return r.continue();
      calls.push({ path: u.pathname, method: r.request().method() });
      return r.fulfill({ status: 503, contentType: "application/json", body: '{"state":"unavailable"}' });
    });
    const ready = () => expect(page.locator("main[data-shared-shell-phase]")).toHaveAttribute("data-shared-shell-phase", "ready", { timeout: 20000 });
    async function nav() {
      if (width === 390) {
        const menu = page.locator('button[aria-haspopup="dialog"][aria-controls]:visible');
        await expect(menu).toHaveCount(1);
        if (await menu.getAttribute("aria-expanded") !== "true") await menu.tap();
        return page.getByRole("dialog").locator(".m-nav");
      }
      return page.locator(".appnav:visible");
    }
    async function check(name, expectedPrimary = null, expectedMarket = null, current = "page", capture = true) {
      const n = await nav();
      await expect(n).toBeVisible();
      const rows = await n.locator("a[href]").evaluateAll(els => els.map(a => ({
        href: new URL(a.href).pathname, label: a.getAttribute("aria-label") || a.textContent.trim(),
        current: a.getAttribute("aria-current"), selected: a.classList.contains("on"),
      })));
      for (const href of [...primary, ...markets]) {
        const row = rows.find(r => r.href === href); expect(row, href).toBeTruthy(); expect(row.label.length).toBeGreaterThan(0);
        const selected = href === expectedPrimary || href === expectedMarket;
        expect(row.selected, href).toBe(selected);
        expect(row.current, href).toBe(selected ? href === expectedMarket ? "page" : current : null);
      }
      expect(await page.locator("html").getAttribute("data-theme")).toBe(theme);
      expect(await page.locator("html").getAttribute("data-lang")).toBe(lang);
      if (capture) await page.screenshot({ path: proof + `/${width}-${theme}-${lang}-${name}.png` });
      states.push({ name, url: page.url(), rows });
      if (width === 390) await page.keyboard.press("Escape");
    }
    const start = base + "/crypto.html?journey=p12t24#asset-lanes";
    await page.goto(start, { waitUntil: "networkidle" });
    await ready();
    await page.evaluate(() => window.__identityShell = document.querySelector('[data-shared-shell="beta"]'));
    const frame = page.frameLocator("[data-shared-shell-frame]");
    const receipt = await frame.locator("#universe-snapshot").innerText();
    expect(receipt).toContain("2026-10-31");
    await check("crypto", null, null, "page", false);
    const lane = frame.locator("a.asset-lane").first();
    expect(await lane.getAttribute("href")).toBe(base + "/vector.html");
    await lane.scrollIntoViewIfNeeded(); await lane.focus(); await lane.press("Enter");
    await expect(page).toHaveURL(base + "/vector.html"); await ready();
    const title = await page.frameLocator("[data-shared-shell-frame]").locator("h1").first().innerText();
    expect(title.length).toBeGreaterThan(0);
    await check("vector");
    await page.goBack(); await expect(page).toHaveURL(start); await ready();
    expect(await frame.locator("#universe-snapshot").innerText()).toBe(receipt);
    expect(await page.evaluate(() => window.__identityShell === document.querySelector('[data-shared-shell="beta"]'))).toBe(true);
    await check("back-crypto");
    let n = await nav(); await n.locator('a[href="/today"]').click();
    await expect(page).toHaveURL(base + "/today"); await check("today", "/today");
    n = await nav(); await n.locator('a[href="/china.html"]').click();
    await expect(page).toHaveURL(base + "/china.html"); await ready(); await check("china", null, "/china.html");
    expect(errors).toEqual([]); expect(blocked).toEqual([]);
    const coreJourneyHadNoOutsideRequests = true;
    await page.goto(base + "/learn.html", { waitUntil: "networkidle" });
    await check("research-location", "/research", null, "location");
    expect(errors).toEqual([]);
    // This additional family-location probe retains the legacy Learn font request, blocked locally.
    expect(blocked).toEqual(["https://fonts.googleapis.com/css2"]);
    expect(calls.every(c => c.method === "GET")).toBe(true);
    results.push({ ...cell, start, title, receipt, persistentShellOnCryptoVectorBack: true, states, coreJourneyHadNoOutsideRequests, errors, blocked, calls });
    await ctx.close();
  }
  fs.writeFileSync(proof + "/result.json", JSON.stringify({
    status: "PASS_SCOPED", source: "0d35b973168b99d37c402e51c00fe31ed33c241d", fixture: "Frozen actual Next parent, actual AppShell/route/LegacyPageHost and unchanged peer Macro bridge/public Crypto/Vector bytes", results,
    limits: ["Local representative owner fixture; not authenticated deployment", "No provider refresh, production, or full family product acceptance", "Vector chart loading is an inherited fixture limitation; this qualification covers navigation identity", "Additional Learn location probe attempts one Google Fonts CSS request, explicitly asserted and blocked; core Crypto/Vector/Back/Today/China had no outside requests"],
  }, null, 2));
  console.log(JSON.stringify({ status: "PASS_SCOPED", cells: results.length }));
} catch (e) {
  fs.writeFileSync(proof + "/failure.json", JSON.stringify({ error: String(e), url: page?.url(), body: await page?.locator("body").innerText() }, null, 2));
  await page?.screenshot({ path: proof + "/failure.png" }); throw e;
} finally { await browser.close(); }
