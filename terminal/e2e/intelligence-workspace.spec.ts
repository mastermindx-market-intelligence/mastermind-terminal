import { expect, test, type Page } from "@playwright/test"

async function prepare(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("mm.lang", "en")
    sessionStorage.removeItem("mm.intelligence.width.v1")
    ;(window as Window & { __iwReady?: boolean }).__iwReady = false
    window.addEventListener("mm:terminal-visual-ready", () => { (window as Window & { __iwReady?: boolean }).__iwReady = true }, { once: true })
  })
  const signals = Array.from({ length: 75 }, (_, index) => ({
    type: index % 3 === 0 ? "SELL" : "BUY", ts: `2026-08-${String(index % 27 + 1).padStart(2, "0")}`,
    known_ts: `2026-08-${String(index % 27 + 1).padStart(2, "0")}`, price: 100 + index,
    ...(index % 3 === 0 ? { basis: "structure_stop" } : { quality: "take", tier: "quality", score: 70 }),
  }))
  await page.route(/\/data\/COST\.slice\.json(?:\?.*)?$/, route => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    ticker: "COST", indicator: { signals, warnings: [], state: { position_hint: "long", last_signal: "BUY", last_scored_signal: "BUY", last_scored_ts: "2026-08-21", strong_bull: true, weeklyBull: true, above200: true } },
    backtest: { metrics: { win_rate: .6, profit_factor: 2.2, cagr: .12, n_trades: 25 } },
  }) }))
  await page.route(/\/data\/COST\.intel\.json(?:\?.*)?$/, route => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    ticker: "COST", asof: "2026-10-16", cards: { ai_judgment: { verdict: "Constructive", gloss: "Evidence is improving." }, conviction: { score: 65, band: "Constructive", drivers: ["Durable demand", "Stable margins"], cautions: ["Valuation remains elevated"] } }, tape: { ai_lean: { dir: "BULL" } },
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
  await expect(workspace).toContainText("Valuation remains elevated")
  await expect(workspace.getByRole("button", { name: "1 research caution", exact: false })).toBeVisible()
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
