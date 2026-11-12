import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { isolateWatchlistStore } from "./watchlistStore";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

test.setTimeout(120_000);

const MANIFEST = {
  symbols: {
    NVDA: { name: "NVIDIA", zh: "英伟达", col: "#76b900", last: 175, chg: 1.2 },
    AAPL: { name: "Apple", zh: "苹果", col: "#8e8e93", last: 228.1, chg: -0.4 },
  },
};
const QUOTES = { quotes: { NVDA: { last: 180, chg: 2.5 }, AAPL: { last: 228, chg: 0 } } };

async function prepare(page: Page, testInfo: TestInfo, baseURL: string | undefined, zh = false) {
  await isolateWatchlistStore(page, testInfo, baseURL);
  await page.addInitScript((useZh) => {
    localStorage.setItem("mm.lang", useZh ? "zh" : "en");

  }, zh);
  await page.route("**/data/manifest.json", (route) => route.fulfill({ json: MANIFEST }));
  await page.route("**/api/quote**", (route) => route.fulfill({ json: QUOTES }));
  await page.route("**/api/portfolio-brief", (route) =>
    route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ tier: "free" }) }));
}

async function seedPosition(page: Page, draft: { ticker: string; shares: string; entryPrice: string }) {
  const response = await page.request.post("/api/portfolio", { data: { action: "create", entryCurrency: "USD", ...draft } });
  expect(response.ok(), `seeding ${draft.ticker} failed: ${response.status()}`).toBe(true);
  return (await response.json()).position as { id: string; ticker: string };
}

const section = (page: Page) => page.getByTestId("portfolio-targets");
const card = (page: Page, ticker: string) => section(page).locator(`[data-ticker='${ticker}']`).first();

test("a signed-in user sets a target on a held position and sees the gap computed", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  await seedPosition(page, { ticker: "NVDA", shares: "100", entryPrice: "200" });
  await page.goto("/portfolio");
  await page.locator("#portfolio-tab-targets").click();
  await expect(section(page)).toBeVisible({ timeout: 20_000 });
  await expect(section(page)).toContainText("Your targets vs. what you hold");
  await expect(page.getByTestId("targets-untargeted")).toContainText("NVDA");

  await page.getByLabel("Target weight for NVDA, percent").fill("80");
  await expect(card(page, "NVDA")).toHaveAttribute("data-status", "outside_band", { timeout: 15_000 });
  await expect(card(page, "NVDA")).toContainText("Outside your band");
  await expect(card(page, "NVDA")).toContainText("+20 pts");
  await expect(card(page, "NVDA")).toContainText("Saved");
});

test("editing the band changes a holding's status between inside and outside", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  await seedPosition(page, { ticker: "NVDA", shares: "100", entryPrice: "200" });
  await page.goto("/portfolio");
  await page.locator("#portfolio-tab-targets").click();
  await expect(section(page)).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("Target weight for NVDA, percent").fill("95");
  await expect(card(page, "NVDA")).toHaveAttribute("data-status", "within_band", { timeout: 15_000 });
  await expect(card(page, "NVDA")).toContainText("Inside your band");

  await page.getByLabel("Band for NVDA, percentage points").fill("4");
  await expect(card(page, "NVDA")).toHaveAttribute("data-status", "outside_band", { timeout: 15_000 });
  await expect(card(page, "NVDA")).toContainText("Outside your band");
});

test("clearing a target returns the holding to the untargeted list", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  await seedPosition(page, { ticker: "NVDA", shares: "100", entryPrice: "200" });
  await page.goto("/portfolio");
  await page.locator("#portfolio-tab-targets").click();
  await expect(section(page)).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("Target weight for NVDA, percent").fill("80");
  await expect(card(page, "NVDA")).toHaveAttribute("data-status", "outside_band", { timeout: 15_000 });
  await card(page, "NVDA").getByRole("button", { name: "Clear target" }).click();
  await expect(page.getByTestId("targets-untargeted")).toContainText("NVDA", { timeout: 15_000 });
  await expect(section(page).locator("[data-status='outside_band']")).toHaveCount(0);
});

test("closing the underlying position surfaces its target as orphaned, not deleted", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  const nvda = await seedPosition(page, { ticker: "NVDA", shares: "100", entryPrice: "200" });
  await seedPosition(page, { ticker: "AAPL", shares: "10", entryPrice: "200" });
  await page.goto("/portfolio");
  await page.locator("#portfolio-tab-targets").click();
  await expect(section(page)).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("Target weight for NVDA, percent").fill("80");
  await expect(card(page, "NVDA")).toHaveAttribute("data-status", "outside_band", { timeout: 15_000 });

  const closed = await page.request.post("/api/portfolio", { data: { action: "close", id: nvda.id } });
  expect(closed.ok()).toBe(true);
  await page.reload();
  await page.locator("#portfolio-tab-targets").click();
  await expect(page.getByTestId("targets-orphaned")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("targets-orphaned")).toContainText("NVDA");
  await expect(page.getByTestId("targets-orphaned")).toContainText("Targets on positions you no longer hold");
  await expect(section(page).locator("[data-ticker='NVDA'][data-status='outside_band']")).toHaveCount(0);
});

test("EN/ZH toggle renders the section title and status labels in the selected language", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  await seedPosition(page, { ticker: "NVDA", shares: "100", entryPrice: "200" });
  await page.goto("/portfolio");
  await page.locator("#portfolio-tab-targets").click();
  await expect(section(page)).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("Target weight for NVDA, percent").fill("80");
  await expect(card(page, "NVDA")).toContainText("Outside your band", { timeout: 15_000 });
  await expect(section(page)).toContainText("Your targets vs. what you hold");

  await page.evaluate(() => {
    localStorage.setItem("mm.lang", "zh");
    document.documentElement.setAttribute("data-lang", "zh");
    document.documentElement.setAttribute("lang", "zh-CN");
    window.dispatchEvent(new CustomEvent("mm:lang"));
  });

  await expect(section(page)).toContainText("你的目标权重与实际持仓", { timeout: 15_000 });
  await expect(card(page, "NVDA")).toContainText("超出容忍区间");
  await expect(section(page)).not.toContainText("Your targets vs. what you hold");
  await expect(card(page, "NVDA")).not.toContainText("Outside your band");
});

// Round 2, ruling R1 (BLOCKER): the round-1 case seeded NVDA *and* AAPL and closed only NVDA, so
// the open book was never actually empty. Closing the LAST holding is the case that used to hide
// the whole section and make a saved target vanish with no disclosure.
test("closing the LAST holding keeps its target on screen as orphaned, with the empty-book sentence", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  const nvda = await seedPosition(page, { ticker: "NVDA", shares: "100", entryPrice: "200" });
  await page.goto("/portfolio");
  await page.locator("#portfolio-tab-targets").click();
  await expect(section(page)).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("Target weight for NVDA, percent").fill("80");
  await expect(card(page, "NVDA")).toHaveAttribute("data-status", "outside_band", { timeout: 15_000 });

  const closed = await page.request.post("/api/portfolio", { data: { action: "close", id: nvda.id } });
  expect(closed.ok()).toBe(true);
  await page.reload();
  await page.locator("#portfolio-tab-targets").click();

  // The whole section must still be mounted with ZERO open positions.
  await expect(section(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("targets-orphaned")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("targets-orphaned")).toContainText("NVDA");
  await expect(page.getByTestId("targets-orphaned")).toContainText("Targets on positions you no longer hold");
  await expect(page.getByTestId("targets-orphaned")).toContainText("The target is kept, not deleted");
  await expect(page.getByTestId("targets-orphaned")).toContainText("±5 pts");
  await expect(page.getByTestId("targets-empty"))
    .toContainText("Add a position with a share count and entry price to start setting targets.");
});

// Retention is intentional; explicit removal must remain available after the holding is gone.
for (const surface of ["portfolio", "settings"] as const) {
  for (const lang of ["en", "zh"] as const) {
    test("orphan clear from " + surface + " persists after reload (" + lang + ")", async ({ page, baseURL }, testInfo) => {
      await prepare(page, testInfo, baseURL, lang === "zh");
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      const nvda = await seedPosition(page, { ticker: "NVDA", shares: "100", entryPrice: "200" });
      const saved = await page.request.post("/api/portfolio/targets", {
        data: { action: "set", ticker: "NVDA", targetWeightPct: 80, bandPct: 5 },
      });
      expect(saved.ok()).toBe(true);
      // Exercise both ways a target loses its holding, without changing the retention contract.
      const ended = await page.request.post("/api/portfolio", {
        data: { action: surface === "portfolio" ? "close" : "delete", id: nvda.id },
      });
      expect(ended.ok()).toBe(true);
      const beforeTargets = await page.request.get("/api/portfolio/targets");
      expect(beforeTargets.ok()).toBe(true);
      expect((await beforeTargets.json()).summary.orphaned).toEqual([
        expect.objectContaining({ ticker: "NVDA", targetWeightPct: 80, bandPct: 5 }),
      ]);
      const beforePositions = await page.request.get("/api/portfolio?view=positions");
      expect(beforePositions.ok()).toBe(true);
      const positions = (await beforePositions.json()).positions;

      const enterSurface = async () => {
        if (surface === "portfolio") {
          await page.locator("#portfolio-tab-targets").click();
        } else {
          await page.locator('button[aria-label="' + (lang === "en" ? "Settings" : "设置") + '"]:visible').first().click();
          await page.getByRole("tab", {
            name: lang === "en" ? "Portfolio targets" : "组合目标权重", exact: true,
          }).click();
        }
      };
      await page.goto(surface === "portfolio" ? "/portfolio" : "/terminal?symbol=NVDA");
      await enterSurface();
      const orphaned = page.getByTestId("targets-orphaned");
      const row = orphaned.locator('[data-ticker="NVDA"][data-status="orphaned"]');
      await expect(row).toBeVisible();
      await expect(row).toContainText("80%");
      await expect(row).toContainText(lang === "en" ? "±5 pts" : "±5 个百分点");
      await expect(row.locator("input")).toHaveCount(0);
      const clear = row.getByRole("button", { name: (lang === "en" ? "Clear target" : "清除目标") + ": NVDA", exact: true });
      await expect(clear).toBeEnabled();
      await clear.scrollIntoViewIfNeeded();
      const rect = await clear.boundingBox();
      expect(rect).not.toBeNull();
      expect(rect!.x).toBeGreaterThanOrEqual(0);
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
      expect(rect!.height).toBeGreaterThanOrEqual(testInfo.project.name === "mobile" ? 44 : 32);
      const captureDirectory = process.env.PORTFOLIO_ORPHAN_CAPTURE_DIRECTORY;
      if (captureDirectory) {
        await mkdir(captureDirectory, { recursive: true });
        await section(page).screenshot({
          path: join(captureDirectory, testInfo.project.name + "-" + surface + "-" + lang + ".png"),
          animations: "disabled",
        });
      }

      const clearing = page.waitForResponse(response =>
        new URL(response.url()).pathname === "/api/portfolio/targets" && response.request().method() === "POST");
      await clear.click();
      const cleared = await clearing;
      expect(cleared.request().postDataJSON()).toMatchObject({ action: "clear", ticker: "NVDA" });
      expect(cleared.ok()).toBe(true);
      expect(await cleared.json()).toMatchObject({ ok: true, clearedTicker: "NVDA" });
      await expect(row).toHaveCount(0);
      const empty = page.getByTestId(surface === "portfolio" ? "targets-empty" : "portfolio-targets-empty");
      await expect(empty).toBeVisible();
      const afterTargets = await page.request.get("/api/portfolio/targets");
      expect(afterTargets.ok()).toBe(true);
      expect((await afterTargets.json()).summary).toMatchObject({ orphaned: [], drifts: [], untargeted: [] });

      await page.reload();
      await enterSurface();
      await expect(empty).toBeVisible();
      await expect(page.getByTestId("targets-orphaned")).toHaveCount(0);
      const afterPositions = await page.request.get("/api/portfolio?view=positions");
      expect(afterPositions.ok()).toBe(true);
      expect((await afterPositions.json()).positions).toEqual(positions);
      expect(errors).toEqual([]);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
}

for (const surface of ["portfolio", "settings"] as const) {
  for (const lang of ["en", "zh"] as const) {
    test("target feedback is actionable and accessible on " + surface + " (" + lang + ")", async ({ page, baseURL }, testInfo) => {
      await prepare(page, testInfo, baseURL, lang === "zh");
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await seedPosition(page, { ticker: "NVDA", shares: "100", entryPrice: "200" });
      const saved = await page.request.post("/api/portfolio/targets", {
        data: { action: "set", ticker: "NVDA", targetWeightPct: 80, bandPct: 5 },
      });
      expect(saved.ok()).toBe(true);
      // Settings uses the established signed-in chart fixture. The non-chart
      // layout intentionally keeps its own guest identity in this fixture mode.
      await page.goto(surface === "settings" ? "/terminal?symbol=NVDA" : "/portfolio");
      if (surface === "portfolio") {
        await page.locator("#portfolio-tab-targets").click();
      } else {
        await page.locator('button[aria-label="' + (lang === "en" ? "Settings" : "设置") + '"]:visible').first().click();
        await page.getByRole("tab", {
          name: lang === "en" ? "Portfolio targets" : "组合目标权重", exact: true,
        }).click();
      }
      const scope = surface === "settings" ? page.getByRole("dialog") : page.getByRole("main");
      const row = scope.locator('article[data-ticker="NVDA"]');
      const target = row.getByLabel(lang === "en" ? "Target weight for NVDA, percent" : "NVDA 的目标权重，百分比");
      const band = row.getByLabel(lang === "en" ? "Band for NVDA, percentage points" : "NVDA 的容忍区间，百分点");
      await expect(target).toHaveValue("80");
      const refusal = page.waitForResponse(response =>
        new URL(response.url()).pathname === "/api/portfolio/targets" && response.request().method() === "POST");
      await target.fill("101");
      expect((await refusal).status()).toBe(400);
      const alert = row.getByRole("alert");
      await expect(alert).toHaveText(lang === "en"
        ? "A target has to be a number from 0 to 100."
        : "目标权重必须是 0 到 100 之间的数字。");
      await expect(target).toHaveValue("80");
      await expect(target).not.toHaveAttribute("aria-invalid", "true");
      const errorId = await alert.getAttribute("id");
      expect(errorId).toBeTruthy();
      await expect(target).toHaveAttribute("aria-describedby", errorId!);
      await expect(band).not.toHaveAttribute("aria-invalid", "true");

      const captureDirectory = process.env.PORTFOLIO_TARGET_FEEDBACK_CAPTURE_DIRECTORY;
      if (captureDirectory) {
        await mkdir(captureDirectory, { recursive: true });
        const originalTheme = await page.locator("html").getAttribute("data-theme");
        for (const theme of ["dark", "light"]) {
          await page.evaluate(value => document.documentElement.setAttribute("data-theme", value), theme);
          await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
          await row.screenshot({
            path: join(captureDirectory, testInfo.project.name + "-" + surface + "-" + lang + "-" + theme + ".png"),
            animations: "disabled",
          });
        }
        await page.evaluate(value => {
          if (value === null) document.documentElement.removeAttribute("data-theme");
          else document.documentElement.setAttribute("data-theme", value);
        }, originalTheme);
      }

      await band.fill("abc");
      await expect(alert).toHaveText(lang === "en"
        ? "Your band has to be a number from 0 to 50 points."
        : "容忍区间必须是 0 到 50 个百分点之间的数字。");
      await expect(band).toHaveAttribute("aria-invalid", "true");
      await expect(band).toHaveAttribute("aria-describedby", errorId!);
      await expect(band).toBeFocused();
      await expect(target).not.toHaveAttribute("aria-describedby", errorId!);
      await band.fill("7");
      await expect(alert).toHaveCount(0);
      await expect(band).not.toHaveAttribute("aria-invalid", "true");
      await expect(band).not.toHaveAttribute("aria-describedby", errorId!);
      await expect(row).toContainText(lang === "en" ? "Saved" : "已保存");
      await expect(band).toHaveValue("7");
      const canonical = await page.request.get("/api/portfolio/targets");
      expect(canonical.ok()).toBe(true);
      expect((await canonical.json()).summary.drifts).toEqual([
        expect.objectContaining({ ticker: "NVDA", targetWeightPct: 80, bandPct: 7 }),
      ]);
      expect(errors).toEqual([]);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
}
