/* Supplemental integration test. The existing Shared Shell loopback test harness supplies
 * its own signed test identity; this module never reads credentials or reaches a live site.
 * Raw Macro artifacts are immutable external inputs, never runtime fixtures. */
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { expect } = require("@playwright/test");
const BLOBS = {
  history: "7893fd4855ec3dc35aaf85b2380cced272c11bde",
  sector: "c7f42913f28c309f9367ff512ea8c941c77ef551",
};
function owner(file, hash) {
  const bytes = fs.readFileSync(file);
  const blob = crypto
    .createHash("sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
  if (blob !== hash) throw Error("Owner artifact mismatch");
  return JSON.parse(bytes);
}
exports.qualify = async function ({
  context,
  origin,
  files,
  out,
  composition,
}) {
  if (new URL(origin).hostname !== "127.0.0.1")
    throw Error("Local test origin required");
  const data = {
    history: owner(files.history, BLOBS.history),
    sector: owner(files.sector, BLOBS.sector),
  };
  const day = data.history.meta.asOf;
  if (day !== data.sector.as_of) throw Error("Reference dates differ");
  const xle = data.history.sectors.find((s) => s.ticker === "XLE"),
    members = data.history.baskets;
  fs.mkdirSync(out, { recursive: true });
  const report = {
    kind: "LOCAL_BETA_TERMINAL_COMPOSITION",
    production: false,
    authentication: "incumbent loopback fixture",
    marketData:
      "unmodified pinned Macro JSON returned at browser test boundary",
    composition,
    blobs: BLOBS,
    date: day,
    sectorCount: data.history.sectors.length,
    basketCount: members.length,
    cells: [],
  };
  for (const entry of ["terminal", "beta"])
    for (const [w, h, lang, theme] of [
      [1440, 900, "en", "dark"],
      [820, 1180, "en", "light"],
      [390, 844, "zh", "light"],
      [320, 740, "en", "dark"],
    ]) {
      const ctx = await context(theme, lang, true);
      try {
        const page = await ctx.newPage();
        await page.setViewportSize({ width: w, height: h });
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        let denied = false;
        await page.route("**/api/sector-intelligence?**", (route) => {
          const key = new URL(route.request().url()).searchParams.get("source");
          if (!Object.hasOwn(data, key)) return route.fallback();
          return route.fulfill({
            status: denied ? 403 : 200,
            json: {
              data: denied ? null : data[key],
              receipt: {
                source: key,
                status: denied ? "access" : "ready",
                asOf: day,
                stale: true,
                contentHash: BLOBS[key],
              },
            },
          });
        });
        const url = entry === "beta" ? "/sectors?" : "/discover?tab=sectors&";
        await page.goto(
          origin +
            url +
            `sector=xle&sectorWorkspace=detail&sectorView=history&sectorTheme=${theme}`,
          { waitUntil: "domcontentloaded" },
        );
        const lens = page.getByTestId("sector-cycle-lens");
        await expect(lens).toBeVisible({ timeout: 60000 });
        await expect(lens).toContainText(xle.now.pos.toFixed(1));
        await expect(lens.getByTestId("cycle-observation")).toContainText(
          "+12.9%",
        );
        await expect(lens.getByTestId("cycle-observation")).toContainText(
          "+19.8%",
        );
        await expect(
          lens.getByRole("complementary").getByRole("button"),
        ).toHaveCount(data.history.sectors.length);
        await lens.scrollIntoViewIfNeeded();
        await lens.getByRole("heading", { level: 2 }).scrollIntoViewIfNeeded();
        await page.screenshot({
          path: path.join(out, `${entry}-${w}-${lang}-cycle.png`),
        });
        const themes = lens.getByTestId("cycle-basket-compare");
        await themes.locator("summary").first().click();
        const picks = themes.getByRole("combobox");
        await expect(picks.nth(0).locator("option")).toHaveCount(
          1 + members.length,
        );
        await picks.nth(0).selectOption("b-ai_infra");
        await picks.nth(1).selectOption("b-reshoring");
        await expect(themes.getByRole("table")).toContainText("-20.6%");
        await expect(themes.getByRole("table")).toContainText("-3.0%");
        await expect(picks.nth(1).locator('[value="b-ai_infra"]')).toHaveCount(
          0,
        );
        if (w === 1440 || w === 390)
          await themes.screenshot({
            path: path.join(out, `${entry}-${w}-${lang}-themes.png`),
          });
        await lens.getByRole("button", { name: /XLK/ }).click();
        await expect(page).toHaveURL(/sector=xlk/);
        await page.goBack();
        await expect(lens).toContainText("71.5");
        const bounds = await lens.evaluate((e) => ({
          root: e.scrollWidth - e.clientWidth,
          page: document.documentElement.scrollWidth - innerWidth,
        }));
        if (bounds.root > 1 || bounds.page > 1)
          throw Error("Horizontal overflow " + JSON.stringify(bounds));
        denied = true;
        await page
          .getByRole("button", {
            name: lang === "zh" ? "刷新" : "Refresh",
            exact: true,
          })
          .click();
        await expect(lens).toHaveCount(0);
        await expect(page.getByRole("tabpanel")).not.toContainText("71.5");
        if (errors.length) throw Error(errors.join("\n"));
        report.cells.push({
          entry,
          w,
          h,
          lang,
          theme,
          bounds,
          sectorReturn: true,
          sourceReadMatched: true,
          themeCompare: true,
          accessClear: true,
        });
      } finally {
        await ctx.close();
      }
    }
  const guest = await context("dark", "en", false);
  try {
    const pg = await guest.newPage();
    await pg.goto(
      origin + "/sectors?sector=xle&sectorWorkspace=detail&sectorView=history",
    );
    await expect(pg.getByTestId("sector-cycle-lens")).toHaveCount(0);
    report.guestHidesData = true;
  } finally {
    await guest.close();
  }
  fs.writeFileSync(
    path.join(out, "receipt.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  return report;
};
