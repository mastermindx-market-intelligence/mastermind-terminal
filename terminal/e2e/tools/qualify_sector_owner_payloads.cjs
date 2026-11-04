/* Read-only consumer qualification against an immutable local copy of owner JSON.
 * Inputs are retrieved separately through the authorized GitHub source reader.
 * Usage (from terminal): node e2e/tools/qualify_sector_owner_payloads.cjs INPUT_DIR PORT
 * Local interception is not positive authenticated production transport.
 */
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), assert = require("node:assert/strict");
const { chromium, webkit, expect } = require("@playwright/test");
const dir = process.argv[2], port = process.argv[3] || "3157";
assert(dir && /^\d{4,5}$/.test(port));
const origin = `http://127.0.0.1:${port}`;
const provenance = JSON.parse(fs.readFileSync(path.join(dir, "provenance.json"), "utf8"));
const data = {};
for (const [key, entry] of Object.entries(provenance.files)) {
  const raw = fs.readFileSync(path.join(dir, key + ".json"));
  assert.equal(crypto.createHash("sha256").update(raw).digest("hex"), entry.sha256);
  data[key] = JSON.parse(raw);
}
const out = path.resolve("../docs/pr-crops/sector-intelligence-r4");
fs.mkdirSync(out, { recursive: true });
const report = { kind: "immutable-owner-payload-browser-qualification", sourceRevision: provenance.ref,
  upstreamBodiesAltered: false, transport: "local gateway interception", authenticatedProduction: false,
  independentHumanReview: false, checks: [], screenshots: [], errors: [] };
function check(name, passed, details) { report.checks.push({ name, passed: !!passed, details }); assert(passed, name); }
const format = (n, suffix) => typeof n !== "number" || !Number.isFinite(n) ? "—"
  : `${n > 0 ? "+" : ""}${n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}${suffix}`;
let browser;
(async () => {
  for (const [engine, width, height, lang, theme] of [["chromium", 1440, 900, "en", "light"], ["webkit", 390, 844, "zh", "dark"]]) {
    browser = await ({ chromium, webkit }[engine]).launch();
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
    await context.addInitScript(lang => localStorage.setItem("mm.lang", lang), lang);
    const page = await context.newPage(); page.on("pageerror", error => report.errors.push(error.message));
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === "/api/sector-intelligence") {
        const key = url.searchParams.get("source"), entry = provenance.files[key];
        return route.fulfill({ status: 200, json: { data: data[key], receipt: { source: key,
          path: entry.path.replace(/^site/, ""), status: "ready", asOf: entry.asOf,
          observedAt: new Date().toISOString(), contentHash: entry.sha256, stale: false } } });
      }
      if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 200, json: {} });
      return route.continue();
    });
    await page.goto(`${origin}/discover?tab=sectors&group=semiconductors&sectorTheme=${theme}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    const root = page.getByTestId("sector-intelligence");
    await root.getByText("62.9%", { exact: true }).waitFor({ timeout: 15000 });
    check(engine + ": capitalization from actual full cohort", (await root.innerText()).includes("62.9%"));
    check(engine + ": sector as-of retained", (await root.innerText()).includes(provenance.files.sector.asOf));
    await root.getByRole("button", { name: lang === "en" ? "Browse company groups" : "浏览公司分组", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("[data-group-choice]")).toHaveCount(30);
    check(engine + ": 76 groups, bounded first 30", (await dialog.innerText()).includes("76"));
    await dialog.getByRole("searchbox").fill("semiconductors");
    await expect(dialog.locator('[data-group-choice="semiconductors"]')).toHaveCount(1);
    await dialog.locator('[data-group-choice="semiconductors"]').click();
    // Current owner order differs from the Sep-23 design example. Use the actual
    // full-cohort affordance rather than assume MU belongs to the first six.
    await root.getByRole("button", { name: lang === "en" ? "Show all companies" : "显示全部公司", exact: true }).click();
    await expect(root.locator("[data-company-choice]")).toHaveCount(14);
    await root.locator('[data-company-choice="MU"]').click();
    const inspector = root.getByTestId("sector-company-inspector");
    const mu = data.confluence.subsectors.find(row => row.key === "semiconductors").members.find(row => row.ticker === "MU");
    check(engine + ": exact company return", (await inspector.innerText()).includes(format(mu.ret_20d, "%")));
    check(engine + ": exact group-relative return", (await inspector.innerText()).includes(format(mu.vs_basket, "pp")));
    check(engine + ": existing Analysis route", await inspector.getByRole("link").getAttribute("href") === "/analysis?symbol=MU&page=overview");
    const themesTab = root.getByRole("tab", { name: lang === "en" ? "Themes & gaps" : "主题与缺口", exact: true });
    await themesTab.click();
    for (const row of data.themes.themes) {
      const name = lang === "zh" ? row.name_zh || row.name_en : row.name_en;
      await expect(root.getByRole("heading", { name, exact: true })).toBeVisible();
    }
    check(engine + ": all 18 exact native theme names", data.themes.themes.length === 18);
    check(engine + ": stale-input disclosure", (await root.innerText()).includes(lang === "en" ? "Some theme inputs are stale" : "部分主题输入已过期"));
    check(engine + ": independent theme source date", (await root.innerText()).includes(provenance.files.themes.asOf));
    const image = path.join(out, `native-${engine}-themes.png`);
    await page.screenshot({ path: image });
    report.screenshots.push({ name: path.basename(image), sha256: crypto.createHash("sha256").update(fs.readFileSync(image)).digest("hex") });
    await root.getByRole("tab", { name: lang === "en" ? "Companies & exposure" : "公司与敞口", exact: true }).click();
    await expect(root.getByTestId("sector-company-row")).toHaveCount(14);
    check(engine + ": native full company table", true);
    await page.goBack(); await expect(themesTab).toHaveAttribute("aria-selected", "true");
    check(engine + ": Back preserves view", true);
    const dimensions = await root.evaluate(element => ({ inner: element.scrollWidth - element.clientWidth,
      document: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
    check(engine + ": no horizontal overflow", dimensions.inner <= 1 && dimensions.document <= 1, dimensions);
    await context.close(); await browser.close(); browser = null;
  }
  check("zero browser page exceptions", report.errors.length === 0, report.errors); report.passed = true;
})().catch(error => { report.passed = false; report.error = error.stack; process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  fs.writeFileSync(path.join(out, "owner-browser-qualification-v2.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, failed: report.checks.filter(row => !row.passed), errors: report.errors, error: report.error }, null, 2));
});
