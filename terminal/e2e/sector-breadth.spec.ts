import { expect, test } from "@playwright/test";
import { sectorFixture } from "./fixtures/sector-company-v3";
import replay from "./fixtures/sector-breadth-close-replay.json";

for (const language of ["en", "zh"] as const) {
  test("breadth rank, velocity, search and sector drilldown in " + language, async ({ page }, info) => {
    await page.addInitScript(lang => localStorage.setItem("mm.lang", lang), language);
    const ids = ["XLK", "XLU", "XLE"];
    const data = {
      sector: {as_of: "2026-10-30", sectors: ids.map((ticker, i) => ({ticker, id:ticker.toLowerCase(),
        name:["Technology","Utilities","Energy"][i], name_zh:["科技","公用事业","能源"][i]}))},
      heatmap: {asof:"2026-10-30", size_basis:"marketcap", n_tiles:0, tiles:[], sector_breadth_close:{
        schema:"sector_breadth_close.v1", basis:"current_cohort_daily_closes",
        dates:["2026-10-23","2026-10-26","2026-10-27","2026-10-28","2026-10-29","2026-10-30"],
        sectors:Object.fromEntries(ids.map((ticker,i) => {
          const advancing = [[4,5,5,6,6,7],[9,9,9,9,9,8],[4,4,4,5,5,8]][i];
          return [ticker,{eligible:10,matched:10,advancing,declining:advancing.map(n => 10-n)}];
        }))}},
    };
    await page.route("**/api/sector-intelligence?**", route => {
      const key = new URL(route.request().url()).searchParams.get("source");
      if (key !== "sector" && key !== "heatmap") return sectorFixture(route);
      return route.fulfill({json:{data:data[key], receipt:{source:key,status:"ready",asOf:"2026-10-30"}}});
    });
    await page.goto("/discover?tab=sectors&sectorWorkspace=breadth&sector=xlk&sectorTheme=" + (language === "zh" ? "light" : "dark"));
    const board = page.getByTestId("sector-discovery");
    await expect(board.getByRole("heading", {name:language === "en" ? "Breadth leadership" : "板块广度排名"})).toBeVisible();
    await expect(board.locator("[data-sector-choice]")).toHaveCount(3);
    await board.getByLabel(language === "en" ? "Compare closes" : "收盘比较").selectOption("5");
    const energy = board.locator('[data-sector-choice="xle"]');
    await expect(energy.locator("xpath=ancestor::tr")).toContainText("+8.0");
    await board.getByLabel(language === "en" ? "Display order" : "排序").selectOption("expand");
    await expect(board.locator("[data-sector-choice]").first()).toHaveAttribute("data-sector-choice","xle");
    const docOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(docOverflow).toBeLessThanOrEqual(1);
    await board.scrollIntoViewIfNeeded();
    await info.attach("breadth-board-" + language, {body:await page.screenshot(),contentType:"image/png"});
    await board.getByRole("searchbox").fill("XLE");
    await expect(board.locator("[data-sector-choice]")).toHaveCount(1);
    await energy.click();
    await expect(page).toHaveURL(/sector=xle/);
    await board.getByTestId("sector-discovery-selection").getByRole("button").click();
    await expect(page.getByTestId("sector-intelligence")).toHaveAttribute("data-sector-workspace","detail");
  });
}

test("historical producer replay ranks eleven sectors and exposes the six closes", async ({ page }, info) => {
  const asOf = replay.series.dates[5];
  await page.route("**/api/sector-intelligence?**", route => {
    const source = new URL(route.request().url()).searchParams.get("source");
    if (source !== "heatmap" && source !== "sector") return sectorFixture(route);
    const data = source === "sector" ? {as_of:asOf,sectors:replay.rows}
      : {asof:asOf,size_basis:"marketcap",n_tiles:0,tiles:[],sector_breadth_close:replay.series};
    return route.fulfill({json:{data,receipt:{source,status:"ready",asOf}}});
  });
  await page.goto("/discover?tab=sectors&sectorWorkspace=breadth&sector=xlk&group=semiconductors&sectorTheme=dark");
  const board = page.getByTestId("sector-discovery");
  await expect(board.locator("[data-sector-choice]")).toHaveCount(11);
  await expect(board).toContainText("11/11 sectors ranked");
  await expect(board.locator("[data-sector-choice]").first()).toHaveAttribute("data-sector-choice","xlp");
  await expect(board.getByLabel("All sectors").locator("div").first()).toContainText("100.0%");
  await expect(board.locator('[data-sector-choice="xlf"]').locator("xpath=ancestor::tr")).toContainText("73 / 75");
  await board.locator("summary").click();
  await expect(board.locator("ol time")).toHaveText(replay.series.dates);
  await board.locator("summary").click();
  await board.getByRole("heading", {name:"Breadth leadership", exact:true}).scrollIntoViewIfNeeded();
  const screenshot = info.outputPath("historical-replay-" + info.project.name + ".png");
  await page.screenshot({path:screenshot});
  await info.attach("Historical replay on the Terminal route",{path:screenshot,contentType:"image/png"});
});
