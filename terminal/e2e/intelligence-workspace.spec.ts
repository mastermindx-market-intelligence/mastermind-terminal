import { expect, test, type Page } from "@playwright/test"

async function prepare(page: Page, lang: "en" | "zh" = "en", savedResearch = false) {
  await page.addInitScript(language => {
    localStorage.setItem("mm.lang", language)
    sessionStorage.removeItem("mm.intelligence.width.v1")
    ;(window as Window & { __iwReady?: boolean }).__iwReady = false
    window.addEventListener("mm:terminal-visual-ready", () => { (window as Window & { __iwReady?: boolean }).__iwReady = true }, { once: true })
  }, lang)
  const signals = Array.from({ length: 75 }, (_, index) => ({
    type: index % 3 === 0 ? "SELL" : "BUY", ts: `2026-08-${String(index % 27 + 1).padStart(2, "0")}`,
    known_ts: `2026-08-${String(index % 27 + 1).padStart(2, "0")}`, price: 100 + index,
    ...(index % 3 === 0 ? { basis: "structure_stop" } : { quality: "take", tier: "quality", score: 70 }),
  }))
  await page.route(/\/data\/COST\.slice\.json(?:\?.*)?$/, route => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    ticker: "COST", indicator: { signals, warnings: [], state: { position_hint: "long", last_signal: "BUY", last_scored_signal: "BUY", last_scored_ts: "2026-08-21", strong_bull: true, weeklyBull: true, above200: true } },
    backtest: { metrics: { win_rate: .6, profit_factor: 2.2, cagr: .12, n_trades: 25, max_dd: -.17, sharpe: 0, strat_total_return: .32, vs_buy_hold: { bh_total_return: .40, bh_max_dd: -.24 } } },
  }) }))
  await page.route(/\/data\/COST\.intel\.json(?:\?.*)?$/, route => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    ticker: "COST", asof: "2026-10-16", cards: { ai_judgment: { verdict: "Constructive", verdict_zh: "偏积极", gloss: "Evidence is improving." }, conviction: { score: 65, band: "Constructive", drivers: ["Durable demand", "Stable margins"], cautions: ["Valuation remains elevated"] } }, tape: { asof: "2026-10-16", stale: savedResearch, ai_lean: savedResearch ? { abstain: true, reason: "stale" } : { dir: "BULL" } },
  }) }))
  await page.route(/\/data\/COST\.backtest\.json(?:\?.*)?$/, route => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    ticker: "COST", status: "ok", as_of: "2026-10-16", equity: { t: ["2026-01-01", "2026-06-01", "2026-10-16"], v: [100, 106, 112] }, universe: { start: "2026-01-01", end: "2026-10-16" },
  }) }))
  await page.goto("/terminal?symbol=COST")
  await expect.poll(() => page.evaluate(() => Boolean((window as Window & { __iwReady?: boolean }).__iwReady)), { timeout: 30_000 }).toBe(true)
  const launcher = page.getByTestId("intelligence-launcher")
  await launcher.scrollIntoViewIfNeeded()
  await expect(launcher).toBeVisible()
  return launcher
}

test("Intelligence keeps the watchlist accessible and docks to its moving edge", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop geometry")
  const launcher = await prepare(page)
  const chartBefore = await page.locator(".chart-body").boundingBox()
  const railBefore = await page.locator(".rail").boundingBox()
  await launcher.click()
  const workspace = page.getByTestId("intelligence-workspace")
  await expect(workspace).toHaveAttribute("data-mode", "docked")
  await expect(workspace).toHaveAttribute("data-phase", "open")
  await expect(workspace).not.toHaveAttribute("aria-modal", "true")
  await expect(launcher).toHaveAttribute("aria-expanded", "true")
  // The panel is clipped at the watchlist-facing edge throughout the motion.
  const coveredFrames = await page.evaluate(async () => {
    let covered = 0
    for (let frame = 0; frame < 22; frame++) {
      await new Promise(requestAnimationFrame)
      const rail = document.querySelector(".rail")!.getBoundingClientRect()
      const hit = document.elementFromPoint(rail.left + 2, rail.top + 130)
      if (hit && document.getElementById("intelligence-workspace")?.contains(hit)) covered++
    }
    return covered
  })
  expect(coveredFrames).toBe(0)
  await expect.poll(async () => {
    const rect = (await workspace.boundingBox())!
    return rect.x + rect.width
  }).toBeLessThanOrEqual(railBefore!.x - 7)
  const box = await workspace.boundingBox()
  expect(box!.x + box!.width).toBeLessThanOrEqual(railBefore!.x - 7)
  expect(box!.x).toBeGreaterThan(chartBefore!.x + 150)
  expect((await page.locator(".chart-body").boundingBox())!.width).toBeCloseTo(chartBefore!.width, 0)
  expect((await page.locator(".rail").boundingBox())!.x).toBeCloseTo(railBefore!.x, 0)
  const watchlists = page.getByRole("tab", { name: "Watchlists", exact: true })
  if (await watchlists.count()) await watchlists.click()
  await expect(workspace).toBeVisible()
  const resize = workspace.getByRole("separator")
  await resize.focus(); await resize.press("ArrowLeft")
  await expect.poll(async () => (await workspace.boundingBox())!.width).toBeGreaterThan(box!.width)
  const railResize = page.locator(".rail-resizer")
  if (await railResize.isVisible()) {
    const grip = (await railResize.boundingBox())!
    await page.mouse.move(grip.x + grip.width / 2, grip.y + Math.min(100, grip.height / 2))
    await page.mouse.down(); await page.mouse.move(grip.x - 50, grip.y + Math.min(100, grip.height / 2), { steps: 8 }); await page.mouse.up()
    await expect.poll(async () => {
      const panel = (await workspace.boundingBox())!, rail = (await page.locator(".rail").boundingBox())!
      return Math.abs(panel.x + panel.width - (rail.x - 8))
    }).toBeLessThan(2)
  }
  await page.screenshot({ path: testInfo.outputPath("intelligence-desktop-docked.png") })
  await workspace.getByRole("button", { name: "Close Intelligence workspace", exact: true }).click()
  await expect(workspace).toHaveCount(0)
  await launcher.click(); await expect(workspace).toHaveAttribute("data-phase", "open")
  await launcher.click(); await expect(workspace).toHaveCount(0)
})

test("Intelligence tabs, performance and paged activity work at every supported width", async ({ page }, testInfo) => {
  const launcher = await prepare(page)
  await launcher.click()
  const workspace = page.getByTestId("intelligence-workspace")
  await expect(workspace).toHaveAttribute("data-phase", "open")
  await expect(workspace.getByRole("heading", { name: "Intelligence", exact: true })).toBeVisible()
  await expect(workspace.getByTestId("workspace-oracle-entry-availability")).toBeVisible()
  await expect(workspace.getByTestId("workspace-oracle")).toHaveCount(0)
  await expect(workspace.getByTestId("workspace-research")).toHaveCount(0)
  const firstGlance = workspace.getByTestId("workspace-summary")
  await expect(firstGlance.getByText("Historical signals are not current entry calls.")).toBeVisible()
  await expect(firstGlance.locator('[data-evidence-source="oracle"]')).toBeVisible()
  await expect(firstGlance.locator('[data-evidence-source="research"]')).toBeVisible()
  await expect(firstGlance.getByRole("button", { name: /Historical backtest/ })).toContainText("25")
  const researchRow = workspace.getByRole("button", { name: /Research setup/ })
  await expect(researchRow).toBeVisible()
  await researchRow.click()
  await expect(workspace).toContainText("Valuation remains elevated")
  await workspace.getByRole("tab", { name: "Summary", exact: true }).click()
  expect(await workspace.getByRole("tab").evaluateAll(tabs => tabs.every(tab => {
    const target = tab.getAttribute("aria-controls")
    return target && document.getElementById(target)?.getAttribute("role") === "tabpanel"
  }))).toBe(true)
  const summary = workspace.getByRole("tab", { name: "Summary", exact: true })
  await summary.focus(); await summary.press("ArrowRight")
  await expect(workspace.getByRole("tab", { name: "Oracle", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(workspace.getByTestId("workspace-equity-curve")).toBeVisible()
  await workspace.getByRole("tab", { name: "Research", exact: true }).click()
  await expect(workspace).toContainText("Valuation remains elevated")
  await expect(workspace).toContainText("Company-state evidence is not published")
  await workspace.getByRole("tab", { name: "Activity", exact: true }).click()
  await expect(workspace.locator(".sd-sigrow")).toHaveCount(30)
  await workspace.getByRole("button", { name: /Show more ·/ }).click()
  await expect(workspace.locator(".sd-sigrow")).toHaveCount(60)
  await workspace.getByRole("button", { name: "Exits", exact: true }).click()
  await expect(workspace.locator(".sd-sigrow")).toHaveCount(25)
  await expect(workspace.locator(".sd-sig-badge").first()).toHaveText("STOP")
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-intelligence-activity.png`) })
  expect(await workspace.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  if (testInfo.project.name === "mobile") {
    const chips = workspace.getByRole("group", { name: "Filter activity" })
    expect(await chips.evaluate(element => getComputedStyle(element).flexWrap)).toBe("nowrap")
    expect(await chips.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
    await workspace.getByRole("button", { name: "Not entered", exact: true }).click()
    await expect(workspace.getByText("No matching events.")).toBeVisible()
  }
  if (testInfo.project.name !== "desktop") {
    await expect(workspace).toHaveAttribute("data-mode", "sheet")
    await expect(workspace).toHaveAttribute("aria-modal", "true")
    const box = (await workspace.boundingBox())!
    expect(box.x).toBe(0); expect(box.width).toBe(page.viewportSize()!.width)
    expect(box.y + box.height).toBeCloseTo(page.viewportSize()!.height, 0)
  }
  await workspace.getByRole("tab", { name: "Activity", exact: true }).press("Escape")
  await expect(workspace).toHaveCount(0)
  await expect(launcher).toBeFocused()
  await launcher.click(); await expect(workspace).toHaveAttribute("data-phase", "open")
  if (testInfo.project.name === "mobile") {
    const handle = workspace.getByTestId("intelligence-sheet-handle")
    // Wait for the animated handle to settle before taking manual pointer coordinates.
    await handle.hover()
    const grip = (await handle.boundingBox())!
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
    await page.mouse.down()
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 + 130, { steps: 8 })
    await page.mouse.up()
    await expect(workspace).toHaveCount(0)
    await expect(launcher).toBeFocused()
  }
})

test("Oracle keeps isolated equity observations visible without joining missing sessions", async ({ page }, info) => {
  const launcher = await prepare(page)
  await page.route(/\/data\/COST\.backtest\.json(?:\?.*)?$/, route => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    ticker: "COST", status: "ok", as_of: "2026-10-16",
    equity: { t: ["2026-01-01", "2026-03-01", "2026-06-01", "2026-08-01", "2026-10-16"], v: [100, null, 106, null, 112] },
  }) }))
  await launcher.click()
  const workspace = page.getByTestId("intelligence-workspace")
  await workspace.getByRole("tab", { name: "Oracle", exact: true }).click()
  const curve = workspace.getByTestId("workspace-equity-curve")
  await expect(curve).toBeVisible()
  await expect(curve.locator("polyline.fin-line")).toHaveCount(3)
  const observations = curve.locator("circle.fin-node")
  await expect(observations).toHaveCount(3)
  for (const observation of await observations.all()) await expect(observation).toBeVisible()
  expect(await curve.locator("polyline.fin-line").evaluateAll(lines => lines.every(line =>
    line.getAttribute("points")!.trim().split(/\s+/).length === 1))).toBe(true)
  await curve.screenshot({ path: info.outputPath("isolated-equity-observations.png") })
})

test("Intelligence reduced motion and breakpoint changes retain usable focus", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "One cross-breakpoint case")
  await page.emulateMedia({ reducedMotion: "reduce" })
  const launcher = await prepare(page); await launcher.click()
  const workspace = page.getByTestId("intelligence-workspace")
  await expect(workspace).toHaveAttribute("data-mode", "docked")
  expect(await workspace.evaluate(element => getComputedStyle(element).transitionDuration)).toBe("0s")
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(workspace).toHaveAttribute("data-mode", "sheet")
  await expect(workspace.getByRole("tab", { name: "Summary", exact: true })).toBeFocused()
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(workspace).toHaveAttribute("data-mode", "docked")
  await workspace.getByRole("button", { name: "Close Intelligence workspace", exact: true }).click()
  await expect(workspace).toHaveCount(0)
})

for (const lang of ["en", "zh"] as const) {
  test(`Research abstention, dated history and backtest risk remain distinct (${lang})`, async ({ page }, info) => {
    const zh = lang === "zh"
    const launcher = await prepare(page, lang, true)
    await launcher.click()
    const workspace = page.getByTestId("intelligence-workspace")
    await expect(workspace.getByTestId("workspace-oracle-entry-availability")).toHaveAttribute("data-status", "UNAVAILABLE_DATA")
    const setup = workspace.getByRole("button", { name: zh ? /研究机会状态/ : /Research setup/ })
    await expect(setup).toContainText(zh ? "暂无当前判断" : "No current reading")
    await expect(workspace.getByTestId("workspace-equity-curve")).toHaveCount(0)
    await workspace.screenshot({ path: info.outputPath(`summary-${lang}.png`) })
    await setup.click()
    await expect(workspace.getByTestId("workspace-research").getByRole("heading", { name: zh ? "暂无当前判断" : "No current reading" })).toBeVisible()
    await expect(workspace.getByTestId("workspace-research").getByRole("img")).toHaveCount(0)
    if (zh) {
      const original = workspace.getByTestId("research-original")
      await expect(original.locator("summary")).toContainText("1条注意事项")
      const caution = original.getByText("Valuation remains elevated", { exact: true })
      await expect(caution).toBeHidden()
      await original.locator("summary").click()
      await expect(caution).toBeVisible()
    }
    await workspace.getByText(zh ? "研究笔记" : "Research notes", { exact: true }).click()
    await expect(workspace.getByTestId("workspace-research").getByText(zh ? "偏积极" : "Constructive", { exact: true })).toBeVisible()
    await workspace.getByRole("tab", { name: zh ? "神谕" : "Oracle", exact: true }).click()
    const risk = workspace.locator("details").filter({ has: page.locator("summary", { hasText: zh ? "风险与基准对比" : "Risk measures" }) })
    await risk.locator("summary").click()
    await expect(risk).toContainText("0.00")
    await expect(risk).toContainText("17.0%")
    await expect(risk.getByRole("row", { name: zh ? /总收益/ : /Total return/ })).toContainText("40.0%")
    await expect(workspace.getByTestId("workspace-equity-curve")).toBeVisible()
    await workspace.screenshot({ path: info.outputPath(`oracle-${lang}.png`) })
  })
}


for (const lang of ["en", "zh"] as const) {
  test(`R6 compact evidence and searchable history preserve source meaning (${lang})`, async ({ page }, info) => {
    const zh = lang === "zh"
    const launcher = await prepare(page, lang, true)
    await launcher.click()
    const workspace = page.getByTestId("intelligence-workspace")
    await expect(workspace).toHaveAttribute("data-phase", "open")
    const overview = workspace.getByTestId("stock-evidence-overview")
    await expect(overview).toBeVisible()
    const qualification = overview.getByTestId("workspace-oracle-entry-availability")
    await expect(qualification).toHaveAttribute("data-status", "UNAVAILABLE_DATA")
    expect((await qualification.boundingBox())!.height).toBeLessThan(150)
    await expect(overview.locator('[data-evidence-source="oracle"]')).toBeVisible()
    await expect(overview.locator('[data-evidence-source="research"]')).toContainText(zh ? "暂无当前判断" : "No current reading")
    await expect(overview.getByTestId("recent-observation")).toHaveCount(3)
    await workspace.screenshot({ path: info.outputPath(`r6-summary-${lang}.png`) })
    await overview.getByRole("button", { name: zh ? "来源与时效" : "Sources & freshness", exact: true }).click()
    const sources = overview.getByTestId("evidence-source-inspector")
    await expect(sources).toBeVisible()
    await expect(sources).toContainText(zh ? "研究日期" : "Research date")
    await expect(sources.getByRole("button", { name: zh ? "刷新研究" : "Refresh research", exact: true })).toBeEnabled()
    await overview.screenshot({ path: info.outputPath(`r6-overview-sources-${lang}.png`) })
    await overview.getByRole("button", { name: zh ? "来源与时效" : "Sources & freshness", exact: true }).click()
    await workspace.getByRole("tab", { name: zh ? "动态" : "Activity", exact: true }).click()
    const search = workspace.getByRole("searchbox", { name: zh ? "搜索动态" : "Search activity", exact: true })
    await search.fill(zh ? "止损" : "stop")
    await expect(workspace.locator(".sd-sigrow")).toHaveCount(25)
    await expect(workspace.getByTestId("activity-count-all")).toHaveText("25")
    await expect(workspace.getByTestId("activity-count-exits")).toHaveText("25")
    await expect(workspace.getByTestId("activity-count-entries")).toHaveText("0")
    await workspace.getByRole("combobox", { name: zh ? "动态排序" : "Sort activity", exact: true }).selectOption("oldest")
    await expect(workspace.locator(".sd-sigrow .sd-sig-date").first()).toHaveText(zh ? "2026年8月1日" : "Aug 1, 2026")
    await search.fill(".*")
    await expect(workspace.locator(".sd-sigrow")).toHaveCount(0)
    await expect(workspace.getByRole("button", { name: zh ? "清除搜索" : "Clear search", exact: true })).toBeVisible()
    await workspace.getByRole("button", { name: zh ? "清除搜索" : "Clear search", exact: true }).click()
    await expect(search).toHaveValue("")
    await expect(search).toBeFocused()
    await expect(workspace.locator(".sd-sigrow")).toHaveCount(30)
    await search.fill("100")
    await expect(workspace.locator(".sd-sigrow")).toHaveCount(1)
    await expect(workspace.locator(".sd-sig-price")).toHaveText("100.00")
    await search.fill(zh ? "止损" : "stop")
    await workspace.screenshot({ path: info.outputPath(`r6-search-${lang}.png`) })
    expect(await workspace.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await search.press("Escape")
    await expect(search).toHaveValue("")
    await expect(workspace).toBeVisible()
    await workspace.getByRole("tab", { name: zh ? "概览" : "Summary", exact: true }).click()
    const recent = workspace.getByTestId("recent-observation").first()
    const date = await recent.getAttribute("data-event-date")
    await page.evaluate(() => window.addEventListener("mm:chart-jump", event => {
      ;(window as Window & { __r6Jump?: { sym: string; ts: string } }).__r6Jump = (event as CustomEvent<{ sym: string; ts: string }>).detail
    }, { once: true }))
    await recent.click()
    await expect.poll(() => page.evaluate(() => (window as Window & { __r6Jump?: { sym: string; ts: string } }).__r6Jump)).toEqual({ sym: "COST", ts: date })
    if (info.project.name === "desktop") await expect(workspace).toBeVisible()
    else await expect(workspace).toHaveCount(0)
    await expect(page.locator(".chart-body")).toBeVisible()
  })
}


test("R6 search and ordering reset on real embedded symbol changes", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "One subject-change journey uses the existing embedded-symbol owner")
  const launcher = await prepare(page)
  await page.route(/\/data\/MSFT\.slice\.json(?:\?.*)?$/, route => route.fulfill({ json: {
    ticker: "MSFT", indicator: { signals: [{ type: "BUY", ts: "2026-10-28", known_ts: "2026-10-29", quality: "take", price: 123.45 }] },
  } }))
  await page.route(/\/data\/MSFT\.intel\.json(?:\?.*)?$/, route => route.fulfill({ status: 404, body: "" }))
  await launcher.click()
  const workspace = page.getByTestId("intelligence-workspace")
  await workspace.getByRole("tab", { name: "Activity", exact: true }).click()
  const search = workspace.getByRole("searchbox", { name: "Search activity", exact: true })
  await search.fill("stop")
  await workspace.getByRole("button", { name: "Exits", exact: true }).click()
  await workspace.getByRole("combobox", { name: "Sort activity", exact: true }).selectOption("oldest")
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("mm:embedded-symbol", { detail: { symbol: "MSFT" } })))
  await expect(workspace).toContainText("MSFT")
  await expect(search).toHaveValue("")
  await expect(workspace.getByRole("button", { name: "All", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(workspace.getByRole("combobox", { name: "Sort activity", exact: true })).toHaveValue("newest")
  await expect(workspace.locator(".sd-sigrow")).toHaveCount(1)
  await expect(workspace.locator(".sd-sig-price")).toHaveText("123.45")
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("mm:embedded-symbol", { detail: { symbol: "COST" } })))
  await expect(workspace).toContainText("COST")
  await expect(search).toHaveValue("")
  await expect(workspace.locator(".sd-sigrow")).toHaveCount(30)
})

test("R6 source inspector distinguishes absence, identity failure and recovered research", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "One source recovery journey")
  const launcher = await prepare(page)
  await launcher.click()
  const overview = page.getByTestId("stock-evidence-overview")
  await overview.getByRole("button", { name: "Sources & freshness", exact: true }).click()
  const refresh = overview.getByRole("button", { name: "Refresh research", exact: true })
  const card = overview.locator('[data-evidence-source="research"]')
  await page.route(/\/data\/COST\.intel\.json(?:\?.*)?$/, route => route.fulfill({ status: 404, body: "" }))
  await refresh.click()
  await expect(card).toHaveAttribute("data-state", "absent")
  await expect(card).toContainText("Not published")
  await page.route(/\/data\/COST\.intel\.json(?:\?.*)?$/, route => route.fulfill({ json: { ticker: "OTHER", cards: { ai_judgment: { verdict: "Mismatched source" } } } }))
  await refresh.click()
  await expect(card).toHaveAttribute("data-state", "unavailable")
  await expect(overview).not.toContainText("Mismatched source")
  await page.route(/\/data\/COST\.intel\.json(?:\?.*)?$/, route => route.fulfill({ json: { ticker: "COST", asof: "2026-10-16", cards: {}, tape: { asof: "2026-10-16", stale: true, ai_lean: { abstain: true } } } }))
  await refresh.click()
  await expect(card).toHaveAttribute("data-state", "ready")
  await expect(card).toContainText("No current reading")
  await expect(overview.getByTestId("workspace-oracle-entry-availability")).toHaveAttribute("data-status", "UNAVAILABLE_DATA")
})

for (const lang of ["en", "zh"] as const) {
  test(`R6 320px layout and light-token specimen retain readable controls (${lang})`, async ({ page }, info) => {
    test.skip(info.project.name !== "mobile", "Narrow and light component specimen, not a second product theme")
    await page.setViewportSize({ width: 320, height: 844 })
    const launcher = await prepare(page, lang, true)
    await launcher.click()
    const workspace = page.getByTestId("intelligence-workspace")
    const overview = page.getByTestId("stock-evidence-overview")
    await expect(workspace).toHaveAttribute("data-phase", "open")
    // Read both rectangles in the same frame; the sheet entrance moves the whole panel.
    expect(await overview.evaluate(root => {
      const oracle = root.querySelector('[data-evidence-source="oracle"]')!.getBoundingClientRect()
      const research = root.querySelector('[data-evidence-source="research"]')!.getBoundingClientRect()
      return research.y >= oracle.bottom
    })).toBe(true)
    expect(await workspace.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await workspace.screenshot({ path: info.outputPath(`r6-320-dark-${lang}.png`) })
    await page.addStyleTag({ content: `:root { --bg:#f5f7fa; --panel:#fff; --panel-2:#eef2f7; --text:#172231; --text-2:#465467; --muted:#607086; --line:#c8d2df; --brand:#2563eb; --warn:#795415; --buy:#087a55; --sell:#bb3450; --up:#087a55; --down:#bb3450; }` })
    await workspace.screenshot({ animations: "disabled", path: info.outputPath(`r6-320-light-specimen-${lang}.png`) })
    await workspace.getByRole("tab", { name: lang === "zh" ? "动态" : "Activity", exact: true }).click()
    await workspace.getByRole("searchbox").fill(lang === "zh" ? "止损" : "stop")
    await expect(workspace.locator(".sd-sigrow")).toHaveCount(25)
    await expect(workspace.getByRole("combobox")).toBeInViewport()
    expect(await workspace.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await workspace.screenshot({ animations: "disabled", path: info.outputPath(`r6-320-search-light-specimen-${lang}.png`) })
  })
}
