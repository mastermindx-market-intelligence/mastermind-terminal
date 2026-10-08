import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { sectorFixture } from "./fixtures/sector-company-v3";

// An explicit local evidence path allows this same journey to qualify real owner
// bytes. The default fixture is synthetic and is never production/source proof.
const supplied = process.env.FINVIZ_PROOF_PAYLOAD;
const synthetic = {
  source: "finviz-themes", map_type: "themes", asof: "2026-10-07", generated_utc: "2026-10-07 19:59", size_basis: "count", n_tiles: 2, n_members: 3,
  sectors: [{ key: "Artificial Intelligence", en: "Artificial Intelligence", zh: "人工智能" }],
  timeframes: ["1D", "1W", "MTD", "1M", "3M", "6M", "YTD", "1Y"].map(key => ({ key, available: true })),
  tiles: [{ t: "aicompute", name: "Compute", sector: "Artificial Intelligence", size: 2, perf: { "1D": 1, "1W": 2, "1M": 3 }, members: [{ t: "NVDA", perf: { "1D": 1 } }, { t: "AMD", perf: { "1D": null } }] },
    { t: "aicloud", name: "Cloud", sector: "Artificial Intelligence", size: 2, perf: { "1D": -1, "1W": 4, "1M": 5 }, members: [{ t: "NVDA", perf: { "1D": 1 } }, { t: "MSFT", perf: { "1D": -1 } }] }],
};
const payload = supplied ? JSON.parse(readFileSync(supplied, "utf8")) as typeof synthetic : synthetic;
const hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
const url = "/discover?tab=sectors&sectorWorkspace=discover&sectorSource=finviz&sectorTheme=light";
test.setTimeout(90000);

async function prepare(page: Page, lang = "en", missing = false) {
  await page.addInitScript(language => localStorage.setItem("mm.lang", language), lang);
  await page.route("**/api/sector-intelligence?**", async route => {
    if (new URL(route.request().url()).searchParams.get("source") !== "finviz") return sectorFixture(route);
    const data = structuredClone(payload);
    if (missing) data.tiles[0].perf["1W"] = null as unknown as number;
    return route.fulfill({ json: { data, receipt: { source: "finviz", path: "/marketdata/themes_heatmap.json", status: "ready", asOf: payload.asof,
      observedAt: "2026-10-08T00:00:00Z", stale: false, contentHash: hash } } });
  });
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect(await page.getByTestId("finviz-discovery").evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
}

test("one inventory, hierarchy, company drill and browser history across all representations", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await prepare(page); await page.goto(url);
  const root = page.getByTestId("finviz-discovery");
  await expect(root.getByTestId("finviz-population")).toContainText(String(payload.n_tiles));
  await expect(root.getByTestId("finviz-group")).toHaveCount(payload.n_tiles);
  for (const mode of ["Matrix", "Table", "Clusters", "Bubbles", "Heatmap"]) {
    await root.getByRole("button", { name: mode, exact: true }).click();
    if (mode === "Bubbles") await expect(root.getByTestId("finviz-bubble-count")).toContainText(`${payload.n_tiles} plotted`);
    else await expect(root.getByTestId(mode === "Matrix" || mode === "Table" ? "finviz-row" : "finviz-group")).toHaveCount(payload.n_tiles);
  }
  await root.getByRole("combobox", { name: "Theme", exact: true }).selectOption("finviz:theme:Artificial Intelligence");
  const childCount = payload.tiles.filter(t => t.sector === "Artificial Intelligence").length;
  await expect(root.getByTestId("finviz-group")).toHaveCount(childCount);
  await root.getByTestId("finviz-group").filter({ hasText: "Compute" }).first().click();
  await expect(page).toHaveURL(/finvizSubtheme=finviz%3Asubtheme%3Aaicompute/);
  const inspector = root.getByTestId("finviz-inspector");
  await inspector.getByRole("button", { name: /^NVDA/ }).click();
  await expect(inspector.getByRole("link", { name: /Research company: NVDA/ })).toHaveAttribute("href", "/analysis?symbol=NVDA&page=overview");
  for (const mode of ["Bubbles", "Matrix", "Table", "Clusters", "Heatmap"]) {
    await root.getByRole("button", { name: mode, exact: true }).click();
    await expect(page).toHaveURL(/sectorCompany=NVDA/);
    if (["Table", "Matrix"].includes(mode)) await expect(root.getByTestId("finviz-row")).toHaveCount(childCount);
    if (["Clusters", "Heatmap"].includes(mode)) await expect(root.getByTestId("finviz-group")).toHaveCount(childCount);
    await noOverflow(page);
  }
  await page.goBack(); await expect(root.getByRole("button", { name: "Clusters", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.goForward(); await expect(root.getByRole("button", { name: "Heatmap", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.reload(); await expect(inspector).toContainText("Compute"); await expect(page).toHaveURL(/sectorCompany=NVDA/);
  await root.getByRole("button", { name: "Bubbles", exact: true }).click();
  await root.getByRole("combobox", { name: "X axis", exact: true }).selectOption("members");
  await root.getByRole("combobox", { name: "Bubble size", exact: true }).selectOption("equal");
  await page.reload(); await expect(root.getByRole("combobox", { name: "X axis", exact: true })).toHaveValue("members");
  await expect(root.getByRole("combobox", { name: "Bubble size", exact: true })).toHaveValue("equal");
  await root.getByLabel("Find a theme or ticker").fill("Compute");
  await expect(root.getByTestId("finviz-visible-count")).toContainText(`1 / ${payload.n_tiles}`);
  await page.screenshot({ path: info.outputPath("bubbles-en-light.png"), fullPage: false });
  expect(errors).toEqual([]);
});

test("null axes withhold one bubble without deleting inventory or roster", async ({ page }) => {
  await prepare(page, "en", true); await page.goto(url + "&finvizMode=bubbles&finvizTheme=finviz%3Atheme%3AArtificial%20Intelligence");
  const root = page.getByTestId("finviz-discovery");
  await expect(root.getByTestId("finviz-bubble-count")).toContainText("1 unavailable axes");
  await root.getByRole("button", { name: "Table", exact: true }).click();
  await expect(root.getByTestId("finviz-row")).toHaveCount(payload.tiles.filter(t => t.sector === "Artificial Intelligence").length);
  await root.getByRole("button", { name: "Compute", exact: true }).click();
  await expect(root.getByTestId("finviz-inspector").getByRole("button", { name: /^NVDA/ })).toBeVisible();
  await root.getByRole("button", { name: "Matrix", exact: true }).click();
  await expect(root.getByRole("button", { name: "Compute", exact: true })).toBeVisible();
});

test("Chinese dark view, keyboard selection and explicit removed identity", async ({ page }, info) => {
  await prepare(page, "zh"); await page.goto(url.replace("sectorTheme=light", "sectorTheme=dark") + "&finvizMode=table&finvizSubtheme=finviz%3Asubtheme%3Aremoved");
  const root = page.getByTestId("finviz-discovery");
  await expect(page.getByTestId("sector-intelligence")).toHaveAttribute("data-sector-theme", "dark");
  await expect(root.getByTestId("finviz-inspector")).toContainText("所选子主题已不在此版本中");
  await root.locator('[data-source-id="finviz:subtheme:aicompute"]').getByRole("button", { name: "Compute", exact: true }).focus(); await page.keyboard.press("Enter");
  await expect(root.getByTestId("finviz-inspector")).toContainText("Compute");
  await root.getByRole("button", { name: "矩阵", exact: true }).click();
  await noOverflow(page); await page.screenshot({ path: info.outputPath("matrix-zh-dark.png"), fullPage: false });
});

for (const [lang, appearance] of [["en", "dark"], ["zh", "light"]]) {
  test(`${lang} ${appearance} complementary art direction and representation parity`, async ({ page }, info) => {
    await prepare(page, lang);
    await page.goto(url.replace("sectorTheme=light", `sectorTheme=${appearance}`) + "&finvizTheme=finviz%3Atheme%3AArtificial%20Intelligence");
    const root = page.getByTestId("finviz-discovery");
    const count = payload.tiles.filter(t => t.sector === "Artificial Intelligence").length;
    await expect(root.getByTestId("finviz-group")).toHaveCount(count);
    await expect(page.getByTestId("sector-intelligence")).toHaveAttribute("data-sector-theme", appearance);
    for (const [mode, cn] of [["Heatmap", "热图"], ["Bubbles", "气泡"], ["Clusters", "分组"], ["Matrix", "矩阵"], ["Table", "表格"]]) {
      await root.getByRole("button", { name: lang === "zh" ? cn : mode, exact: true }).click();
      if (mode === "Bubbles") await expect(root.getByTestId("finviz-bubble-count")).toContainText(String(count));
      else await expect(root.getByTestId(mode === "Table" || mode === "Matrix" ? "finviz-row" : "finviz-group")).toHaveCount(count);
      await noOverflow(page);
      await root.getByTestId("finviz-inventory").evaluate(el => el.scrollIntoView({ block: "start" }));
      await page.screenshot({ path: info.outputPath(`${mode.toLowerCase()}-${lang}-${appearance}.png`) });
    }
  });
}
