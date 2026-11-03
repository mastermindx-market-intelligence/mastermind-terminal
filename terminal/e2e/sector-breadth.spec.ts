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
    const compare = board.getByLabel(language === "en" ? "Compare closes" : "收盘比较");
    await compare.selectOption("1");
    await board.locator('[data-readout="expand"]').click();
    await expect(page).toHaveURL(/sectorBreadthWindow=1/);
    await expect(page).toHaveURL(/sectorBreadthSort=expand/);
    await page.reload();
    await expect(compare).toHaveValue("1");
    await expect(board.getByLabel(language === "en" ? "Display order" : "排序")).toHaveValue("expand");
    await compare.selectOption("5");
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
    await energy.focus();
    await energy.press("Enter");
    await expect(energy).toBeFocused();
    await expect(energy).toHaveAttribute("aria-expanded","true");
    await expect(page).toHaveURL(/sector=xle/);
    await board.getByTestId("sector-discovery-selection").getByRole("button").click();
    await expect(page.getByTestId("sector-intelligence")).toHaveAttribute("data-sector-workspace","detail");
    await page.getByTestId("sector-detail-return").click();
    await expect(board.getByLabel(language === "en" ? "Display order" : "排序")).toHaveValue("expand");
    await expect(board.getByRole("searchbox")).toHaveValue("XLE");
    await expect(board.getByTestId("sector-discovery-selection").getByRole("button")).toBeFocused();
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
  await expect(board).toContainText("501/503 stocks matched");
  await expect(board.locator("[data-sector-choice]").first()).toHaveAttribute("data-sector-choice","xlp");
  await expect(board.locator('[data-readout="strong"]')).toContainText("97.0%");
  expect(Object.values(replay.series.sectors).reduce((n, sector) => n + sector.eligible, 0)).toBe(503);
  expect(Object.values(replay.series.sectors).reduce((n, sector) => n + sector.matched, 0)).toBe(501);
  await expect(board.locator('[data-sector-choice="xlf"]').locator("xpath=ancestor::tr")).toContainText("73 / 75");
  const evidence = board.getByTestId("sector-discovery-selection");
  await expect(evidence).toContainText("No confirmed overtake in this window.");
  await board.locator('[data-sector-choice="xlu"]').click();
  expect(await evidence.locator("ol time").evaluateAll(items => items.map(el => el.getAttribute("datetime")))).toEqual(replay.series.dates);
  await expect(evidence.getByRole("heading",{name:"Breadth overtakes"})).toBeVisible();
  await evidence.locator("summary").click();
  await expect(evidence.getByRole("table")).toContainText("XLU");
  expect(await board.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await evidence.screenshot({path:info.outputPath("historical-detail-" + info.project.name + ".png")});
  const peerDates = await evidence.getByRole("table").locator("thead time").evaluateAll(items => items.map(el => el.getAttribute("datetime")));
  expect(peerDates).toEqual([replay.series.dates[0],replay.series.dates[4],replay.series.dates[5]]);
  await evidence.locator("summary").click();
  await board.locator('[data-sector-choice="xlu"]').click();
  await expect(evidence).toHaveCount(0);
  const size = page.viewportSize()!;
  await board.evaluate(el => { window.scrollTo(0,0); el.closest('[data-testid="sector-intelligence"]')!.scrollTo(0,0); });
  if (size.width === 390) {
    const first = await board.locator("[data-sector-choice]").first().boundingBox();
    expect(first!.y).toBeGreaterThanOrEqual(0);
    expect(first!.y + first!.height).toBeLessThanOrEqual(size.height);
  }
  await board.getByRole("heading", {name:"Breadth leadership", exact:true}).scrollIntoViewIfNeeded();
  const screenshot = info.outputPath("historical-replay-" + info.project.name + ".png");
  await page.screenshot({path:screenshot});
  await info.attach("Historical replay on the Terminal route",{path:screenshot,contentType:"image/png"});
});
