import { expect, test, type Locator } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { techLabFixture } from "../lib/__tests__/fixtures/techLab";

// The shipped shell is dark. This optional light-token specimen checks component
// contrast without adding a second theme preference or changing the product shell.
const LIGHT_SPECIMEN = `:root {
  --bg:#f5f7fa; --panel:#ffffff; --panel-2:#eef2f7; --panel-3:#e1e7ef;
  --text:#172231; --text-2:#465467; --muted:#607086;
  --line:#d8e0ea; --line-3:#b7c6d8; --hairline:#d8e0ea;
  --brand:#2563eb; --brand-2:#245bd1; --up:#087a55; --down:#bb3450;
}`;

for (const lang of ["en", "zh"] as const) {
  for (const theme of ["dark", "light-specimen"] as const) {
    test(`Lab ranking and drilldown · ${lang} · ${theme}`, async ({ page }, info) => {
      await page.addInitScript(({ lang }) => {
        localStorage.setItem("mm.lang", lang);
        localStorage.setItem("mm.updown", lang === "zh" ? "east" : "west");
      }, { lang });
      await page.route("**/mm_brain.js", route => route.fulfill({ contentType: "application/javascript", body: "" }));
      await page.route("**/data/EL.intel.json", route => route.fulfill({ json: techLabFixture() }));
      await page.goto("/analysis?symbol=EL&page=lab");
      const lab = page.getByTestId("lab-workspace");
      const zh = lang === "zh";
      await expect(lab.getByRole("heading", { name: zh ? "活跃形态" : "Active setups", exact: true })).toBeVisible({ timeout: 25_000 });
      await expect(lab.getByTestId("lab-data-through")).toHaveText(zh ? "2026年10月15日" : "Oct 15, 2026");
      const rows = lab.locator("li[data-setup-id]");
      await expect(rows).toHaveCount(3);
      await expect(rows.first()).toHaveAttribute("data-setup-id", "strongest");
      await expect(lab).not.toContainText("Firing now");
      await expect(lab.locator('[data-setup-id="valuation_pctile"]')).toHaveCount(0);
      await expect(lab.locator('[data-setup-id="inactive"]')).toHaveCount(0);
      if (theme === "light-specimen") await page.addStyleTag({ content: LIGHT_SPECIMEN });
      const dir = path.join(process.cwd(), "docs/pr-crops/terminal-lab-active-setups");
      const capture = async (state: string, region?: Locator) => {
        if (!process.env.LAB_CAPTURE) return;
        mkdirSync(dir, { recursive: true });
        await (region ?? page).screenshot({ path: path.join(dir, `${info.project.name}-${lang}-${theme}-${state}.png`) });
      };
      if (info.project.name === "mobile") {
        await expect(lab.getByRole("searchbox")).not.toBeVisible();
        await expect(rows.first()).toBeInViewport({ ratio: 0.5 });
      }
      await capture("ranked");
      await lab.getByRole("button", { name: zh ? /^低于基准/ : /^Below baseline/ }).click();
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toHaveAttribute("data-setup-id", "weak");
      await expect(rows.first()).toContainText(zh ? "-4.0 个百分点" : "-4.0 pp");
      await lab.getByRole("button", { name: zh ? /^有历史比较/ : /^With history/ }).click();
      if (info.project.name === "mobile") {
        await lab.getByRole("button", { name: zh ? "筛选与排序形态" : "Filter & sort setups", exact: true }).click();
      }
      await lab.getByLabel(zh ? "排序" : "Sort", { exact: true }).selectOption("recent");
      await expect(rows.first()).toHaveAttribute("data-setup-id", "tied");
      await lab.getByLabel(zh ? "方向" : "Direction", { exact: true }).selectOption("-1");
      await expect(rows).toHaveCount(1);
      const disclosure = rows.first().locator("button");
      await disclosure.press("Enter");
      await expect(disclosure).toHaveAttribute("aria-expanded", "true");
      const detail = rows.first().getByRole("region");
      await expect(detail).toContainText("48.0%");
      await expect(detail).toContainText("38.0%");
      await expect(detail.getByRole("link")).toHaveAttribute("href", "/terminal?symbol=EL");
      await expect(detail).toContainText(zh ? "2026年10月12日" : "Oct 12, 2026");
      await expect(detail).toContainText(zh ? "并非盘中实时提醒" : "not an intraday alert");
      await capture("detail", detail);
      await lab.getByLabel(zh ? "方向" : "Direction", { exact: true }).selectOption("all");
      await lab.getByRole("button", { name: zh ? /^无可用比较/ : /^No comparison/ }).click();
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toHaveAttribute("data-setup-id", "insufficient");
      await rows.first().locator("button").click();
      await expect(rows.first().getByRole("region")).toContainText(zh ? "尚未提供" : "has not supplied");
      await lab.getByRole("button", { name: zh ? /^全部研究/ : /^All research/ }).click();
      await expect(rows).toHaveCount(9);
      await expect(lab.locator('[data-setup-id="valuation_pctile"]')).toContainText(zh ? "背景指标" : "Context");
      const search = lab.getByRole("searchbox");
      await search.fill("no-such-condition");
      await expect(rows).toHaveCount(0);
      await lab.getByRole("button", { name: zh ? "清除筛选" : "Clear filters", exact: true }).click();
      await expect(rows).toHaveCount(9);
      const width = await lab.evaluate(el => ({ content: el.scrollWidth, available: el.clientWidth, document: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
      expect(width.content).toBeLessThanOrEqual(width.available + 1);
      expect(width.document).toBeLessThanOrEqual(width.viewport + 1);
      await expect(lab.getByRole("link", { name: zh ? "查看价格图表" : "View price chart", exact: true })).toHaveAttribute("href", "/terminal?symbol=EL");
    });
  }
}

test("Lab discloses unknown source-bar freshness on legacy snapshots", async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem("mm.lang", "en"); });
  await page.route("**/mm_brain.js", route => route.fulfill({ contentType: "application/javascript", body: "" }));
  const legacy = techLabFixture();
  delete (legacy.tech.events as Partial<typeof legacy.tech.events>).data_through;
  await page.route("**/data/EL.intel.json", route => route.fulfill({ json: legacy }));
  await page.goto("/analysis?symbol=EL&page=lab");
  const lab = page.getByTestId("lab-workspace");
  await expect(lab.getByTestId("lab-data-through")).toHaveText("Not reported", { timeout: 25_000 });
  await lab.locator('[data-setup-id="strongest"] button').first().click();
  await expect(lab.locator('[data-setup-id="strongest"]').getByRole("region")).toContainText("Recency cannot be verified.");
});

test("Lab distinguishes no coverage and a wrong-ticker payload from an empty signal set", async ({ page }) => {
  await page.route("**/mm_brain.js", route => route.fulfill({ contentType: "application/javascript", body: "" }));
  await page.route("**/data/EL.intel.json", route => route.fulfill({ json: techLabFixture("NVDA") }));
  await page.goto("/analysis?symbol=EL&page=lab");
  const lab = page.getByTestId("lab-workspace");
  await expect(lab.getByRole("heading", { name: "This snapshot cannot be matched to EL" })).toBeVisible({ timeout: 25_000 });
  await expect(lab.locator("li[data-setup-id]")).toHaveCount(0);
  await expect(lab.getByRole("button", { name: /^Above baseline/ })).toHaveCount(0);
});

test("Lab keeps tiny signed lifts and exact-zero comparisons distinct", async ({ page }) => {
  const fixture = techLabFixture();
  Object.assign(fixture.tech.profiles.strongest, { wr_21d: 0.3801, base_wr: 0.38, edge_wr: 0.0001 });
  Object.assign(fixture.tech.profiles.tied, { wr_21d: 0.6499, base_wr: 0.65, edge_wr: -0.0001 });
  Object.assign(fixture.tech.profiles.weak, { wr_21d: 0.72, base_wr: 0.72, edge_wr: 0 });
  await page.addInitScript(() => localStorage.setItem("mm.lang", "en"));
  await page.route("**/mm_brain.js", route => route.fulfill({ contentType: "application/javascript", body: "" }));
  await page.route("**/data/EL.intel.json", route => route.fulfill({ json: fixture }));
  await page.goto("/analysis?symbol=EL&page=lab");
  const lab = page.getByTestId("lab-workspace");
  const rows = lab.locator("li[data-setup-id]");
  await expect(rows).toHaveCount(3, { timeout: 25_000 });
  await expect(lab.locator('[data-setup-id="strongest"]')).toContainText("+<0.1 pp");
  await expect(lab.locator('[data-setup-id="tied"]')).toContainText("-<0.1 pp");
  await expect(lab.locator('[data-setup-id="weak"]')).toContainText("At baseline");
  await expect(lab.getByRole("button", { name: /^Above baseline/ })).toContainText("1");
  await expect(lab.getByRole("button", { name: /^Below baseline/ })).toContainText("1");
  await lab.getByRole("button", { name: /^Above baseline/ }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute("data-setup-id", "strongest");
  await lab.getByRole("button", { name: /^Below baseline/ }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute("data-setup-id", "tied");
});
