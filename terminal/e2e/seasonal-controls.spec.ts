import { expect, test, type Locator, type Page } from "@playwright/test";

// Synthetic daily-history fixture: presentation/interaction proof, not market evidence.
function history(firstYear = 2010) {
  const bars: Array<[string, number, number, number, number, number]> = [];
  let close = 100;
  for (let year = firstYear; year <= 2026; year++) {
    for (let month = 1; month <= (year === 2026 ? 9 : 12); month++) {
      const open = close;
      const gain = ((month * 7) % 13 - 4) / 100 + ((year % 5) - 2) / 150;
      close = open * (1 + gain);
      const prefix = `${year}-${String(month).padStart(2, "0")}`;
      bars.push([`${prefix}-02`, open, open * 1.01, open * 0.99, open, 1_000_000]);
      bars.push([`${prefix}-25`, open, Math.max(open, close) * 1.01, Math.min(open, close) * 0.99, close, 1_100_000]);
    }
  }
  return { symbol: "NVDA", bars };
}

async function openSeasonals(page: Page, lang: "en" | "zh", analysis = false, firstYear = 2010) {
  const theme = lang === "zh" && (!analysis || process.env.MMX_SHARED_SHELL === "1") ? "light" : "dark";
  await page.addInitScript(({ lang, theme }) => {
    localStorage.setItem("mm.lang", lang);
    localStorage.setItem("mmx.shell.theme", theme);
    localStorage.setItem("mm.seas.win", "10");
  }, { lang, theme });
  await page.route(/\/data\/NVDA\.json(?:\?.*)?$/, route =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(history(firstYear)) }));
  await page.goto(analysis ? "/analysis?symbol=NVDA&page=seasonals" : "/terminal?symbol=NVDA");
  await expect(page.locator(analysis ? ".analysis-shell" : ".workspace")).toBeVisible();
  const seasonal = page.locator(".fin-seas");
  await expect.poll(async () => {
    if (await seasonal.count()) return true;
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("mm:open-pane", { detail: "seasonals" })));
    return (await seasonal.count()) === 1;
  }, { timeout: 15_000 }).toBe(true);
  await expect(seasonal).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-lang", lang);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(seasonal.locator(".fin-seas-chartbox > svg")).toBeVisible();
  return seasonal;
}

async function visibleTarget(button: Locator) {
  await button.scrollIntoViewIfNeeded();
  const box = await button.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(await button.evaluate(el => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return top === el || el.contains(top);
  })).toBe(true);
}

async function noPageOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

for (const lang of ["en", "zh"] as const) {
  test(`${lang} year picker preserves selection and keyboard return`, async ({ page }, testInfo) => {
    if (testInfo.project.name === "mobile") await page.setViewportSize({ width: 320, height: 568 });
    const seasonal = await openSeasonals(page, lang);
    const trigger = seasonal.locator(".fin-seas-yearpop-trig");
    await trigger.scrollIntoViewIfNeeded();
    await trigger.focus();
    await page.keyboard.press("Enter");
    const popup = seasonal.locator(".fin-seas-yearpop");
    await expect(popup).toBeVisible();
    const first = popup.locator("button").first();
    await first.focus();
    await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-${lang}-years.png`) });
    console.info("seasonal picker geometry", JSON.stringify({
      trigger: await trigger.boundingBox(), popup: await popup.boundingBox(), item: await first.boundingBox(),
    }));
    await page.keyboard.press("Escape");
    await expect(popup).toHaveCount(0);
    await expect(seasonal).toBeVisible();
    await expect(trigger).toBeFocused();
    await visibleTarget(trigger);
    await page.keyboard.press("Enter");
    await expect(popup).toHaveAttribute("role", "group");
    await expect(popup).toHaveAttribute("aria-label", lang === "zh" ? "切换年份" : "Toggle years");
    await expect(trigger).toHaveAttribute("aria-controls", await popup.getAttribute("id") || "");
    await page.keyboard.press("Tab");
    await expect(first).toBeFocused();
    const before = await first.getAttribute("aria-pressed");
    await page.keyboard.press("Space");
    await expect(first).toHaveAttribute("aria-pressed", before === "true" ? "false" : "true");
    await expect(first).toBeFocused();
    const second = popup.locator("button").nth(1);
    await page.keyboard.press("Tab");
    await expect(second).toBeFocused();
    const beforeSecond = await second.getAttribute("aria-pressed");
    await page.keyboard.press("Enter");
    await expect(second).toHaveAttribute("aria-pressed", beforeSecond === "true" ? "false" : "true");
    await visibleTarget(second);
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(first).toHaveAttribute("aria-pressed", before === "true" ? "false" : "true");
    await expect(second).toHaveAttribute("aria-pressed", beforeSecond === "true" ? "false" : "true");
    const all = seasonal.locator(".fin-seas-legend-acts").getByRole("button", { name: lang === "zh" ? "全部" : "All", exact: true });
    await popup.locator("button").last().focus();
    await page.keyboard.press("Tab");
    await expect(all).toBeFocused();
    await expect(popup).toHaveCount(0);
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(popup).toBeVisible();
    await all.click();
    await expect(popup).toHaveCount(0);
    await expect(all).toBeFocused();
    await visibleTarget(all);
    await expect(trigger).toContainText(lang === "zh" ? "17 年中的 17 年" : "17 of 17 years");
    const none = seasonal.locator(".fin-seas-legend-acts").getByRole("button", { name: lang === "zh" ? "清空" : "None", exact: true });
    await none.focus();
    await page.keyboard.press("Enter");
    await expect(seasonal.locator(".fin-seas-emptytxt")).toBeVisible();
    await visibleTarget(none);
    await all.click();
    await expect(seasonal.locator(".fin-seas-emptytxt")).toHaveCount(0);
    await noPageOverflow(page);
    await trigger.focus();
    await page.keyboard.press("Enter");
    const rect = await popup.boundingBox();
    const viewport = page.viewportSize()!;
    expect(rect!.x).toBeGreaterThanOrEqual(0);
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(viewport.width + 1);
    await popup.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-${lang}-years-final.png`) });
    if (testInfo.project.name === "mobile") {
      await page.setViewportSize({ width: 568, height: 320 });
      await trigger.focus();
      for (let i = 0; i < 17; i++) await page.keyboard.press("Tab");
      const last = popup.locator("button").last();
      await expect(last).toBeFocused();
      await visibleTarget(last);
      const shortBox = await popup.boundingBox();
      expect(shortBox!.y).toBeGreaterThanOrEqual(0);
      expect(shortBox!.y + shortBox!.height).toBeLessThanOrEqual((await page.locator(".fin-local-tabs-mobile").boundingBox())!.y);
      // The anchor can leave the visible pane while the open picker remains usable.
      await trigger.evaluate(el => el.closest(".fin-body")!.scrollTo({ top: 0, behavior: "instant" }));
      await expect.poll(async () => {
        const box = await popup.boundingBox();
        const body = await page.locator(".fin-body").boundingBox();
        const tabs = await page.locator(".fin-local-tabs-mobile").boundingBox();
        return !!box && !!body && !!tabs && box.y >= body.y && box.y + box.height <= tabs.y;
      }).toBe(true);
      await visibleTarget(last);
      await page.screenshot({ path: testInfo.outputPath(`${lang}-years-short.png`) });
    }
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await expect(seasonal).toBeVisible();
    if (testInfo.project.name !== "desktop") {
      await page.keyboard.press("Escape");
      await expect(seasonal).toHaveCount(0);
      await expect(page.locator(".workspace")).toBeVisible();
    }
    if (testInfo.project.name === "mobile") {
      await page.setViewportSize({ width: 320, height: 568 });
      const standalone = await openSeasonals(page, lang, true);
      const standaloneTrigger = standalone.locator(".fin-seas-yearpop-trig");
      await standaloneTrigger.scrollIntoViewIfNeeded();
      await standaloneTrigger.focus();
      await page.keyboard.press("Enter");
      await page.keyboard.press("Tab");
      await expect(standalone.locator(".fin-seas-yearpop button").first()).toBeFocused();
      await visibleTarget(standalone.locator(".fin-seas-yearpop button").first());
      await noPageOverflow(page);
      await page.keyboard.press("Escape");
      await expect(standaloneTrigger).toBeFocused();
      await expect(standalone).toBeVisible();
      await expect(page).toHaveURL(/\/analysis\?.*page=seasonals/);
    }
  });


  test(`${lang} inline year toggles remain reachable in the scrolling legend`, async ({ page }, testInfo) => {
    if (testInfo.project.name === "mobile") await page.setViewportSize({ width: 320, height: 568 });
    const seasonal = await openSeasonals(page, lang, false, 2016);
    await expect(seasonal.locator(".fin-seas-yearpop-trig")).toHaveCount(0);
    const years = seasonal.locator(".fin-seas-legend-years button");
    await expect(years).toHaveCount(11);
    await years.first().scrollIntoViewIfNeeded();
    await years.first().focus();
    for (let i = 1; i < 11; i++) await page.keyboard.press("Tab");
    const last = years.last();
    await expect(last).toBeFocused();
    await visibleTarget(last);
    await expect(last).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Space");
    await expect(last).toHaveAttribute("aria-pressed", "false");
    await expect(seasonal.locator(".fin-seas-curline")).toHaveCount(0);
    await page.keyboard.press("Space");
    await expect(last).toHaveAttribute("aria-pressed", "true");
    await expect(seasonal.locator(".fin-seas-curline")).toHaveCount(1);
    await noPageOverflow(page);
    await seasonal.locator(".fin-seas-legend").screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-${lang}-inline-years.png`) });
  });

  test(`${lang} best months sort works with native keyboard controls`, async ({ page }, testInfo) => {
    if (testInfo.project.name === "mobile") await page.setViewportSize({ width: 320, height: 568 });
    const seasonal = await openSeasonals(page, lang);
    const panel = seasonal.locator(".fin-adv-panel").filter({
      has: page.locator(".fin-adv-panel-t").getByText(lang === "zh" ? "最佳月份" : "Best months", { exact: true }),
    });
    await panel.scrollIntoViewIfNeeded();
    const table = panel.locator("table");
    await expect(table.locator("tbody tr")).toHaveCount(12);
    await panel.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-${lang}-months.png`) });
    const initial = await table.locator("tbody tr").evaluateAll(rows => rows.map(row => ({
      month: row.querySelector("td")!.childNodes[0].textContent!.trim(),
      mean: Number.parseFloat(row.querySelectorAll("td")[1].textContent!.replace("−", "-")),
      wr: Number.parseFloat(row.querySelector(".fin-adv-wrtxt")!.textContent!),
    })));
    const avg = table.getByRole("button", { name: lang === "zh" ? "平均" : "Avg", exact: true });
    const month = table.getByRole("button", { name: lang === "zh" ? "月" : "Mo", exact: true });
    const win = table.getByRole("button", { name: lang === "zh" ? "胜率" : "Win rate", exact: true });
    await expect(avg).toBeVisible();
    await month.focus();
    await page.keyboard.press("Tab");
    await expect(avg).toBeFocused();
    await visibleTarget(avg);
    await page.keyboard.press("Enter");
    await expect(avg.locator("..")).toHaveAttribute("aria-sort", "descending");
    await expect(avg).toBeFocused();
    const order = () => table.locator("tbody tr td:first-child").evaluateAll(cells => cells.map(cell => cell.childNodes[0].textContent!.trim()));
    expect(await order()).toEqual([...initial].sort((a, b) => b.mean - a.mean).map(row => row.month));
    await page.keyboard.press("Tab");
    await expect(win).toBeFocused();
    await page.keyboard.press("Space");
    await expect(win.locator("..")).toHaveAttribute("aria-sort", "descending");
    expect(await order()).toEqual([...initial].sort((a, b) => b.wr - a.wr).map(row => row.month));
    await month.focus();
    await page.keyboard.press("Enter");
    await expect(month.locator("..")).toHaveAttribute("aria-sort", "ascending");
    expect(await order()).toEqual(initial.map(row => row.month));
    await expect(month).toBeFocused();
    expect(await month.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe("none");
    await visibleTarget(month);
    await noPageOverflow(page);
    await panel.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-${lang}-months-final.png`) });
  });
}
