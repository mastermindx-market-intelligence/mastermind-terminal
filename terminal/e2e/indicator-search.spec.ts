import { expect, test, type Page } from "@playwright/test";
import { isPhoneViewport, openIndicatorLibrary } from "./phoneChrome";
import { expectTapTarget } from "./tapTarget";

async function armTerminalVisualReady(page: Page) {
  await page.addInitScript(() => {
    const readyWindow = window as Window & { __mmSearchVisualReady?: boolean };
    readyWindow.__mmSearchVisualReady = false;
    window.addEventListener("mm:terminal-visual-ready", () => {
      readyWindow.__mmSearchVisualReady = true;
    }, { once: true });
  });
}

async function waitForTerminalVisualReady(page: Page) {
  await expect.poll(
    () => page.evaluate(() =>
      Boolean((window as Window & { __mmSearchVisualReady?: boolean }).__mmSearchVisualReady)),
    { message: "the interactive Terminal should finish hydrating", timeout: 15_000 },
  ).toBe(true);
}

test("Indicator Library search is ranked, responsive, and keyboard complete", async ({ page }, testInfo) => {
  await armTerminalVisualReady(page);
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".workspace")).toBeVisible();
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible();
  await waitForTerminalVisualReady(page);

  // The phone reaches the library through the roller strip's hub, not a toolbar button (R2.2).
  const trigger = page.locator(".indicator-library-trigger");
  await openIndicatorLibrary(page);

  const modal = page.locator(".imodal-library");
  const searchShell = modal.locator(".im-search-shell");
  const searchbox = modal.getByRole("searchbox", { name: "Search indicators" });
  const status = modal.getByRole("status");

  await expect(modal).toBeVisible({ timeout: 10_000 });
  await expect(searchbox).toBeVisible();

  const touchFirst = testInfo.project.name !== "desktop";
  if (touchFirst) {
    // Opening a browse-heavy sheet must not summon the soft keyboard. Search focuses on intent.
    await expect(searchbox).not.toBeFocused();
    await expect(modal).toBeFocused();
    await searchbox.click();
  }
  await expect(searchbox).toBeFocused();

  const focusPaint = await searchShell.evaluate((shell) => {
    const input = shell.querySelector("input");
    if (!input) throw new Error("missing Indicator Library searchbox");
    const inputStyle = getComputedStyle(input);
    const fieldStyle = getComputedStyle(shell.querySelector(".im-search") as Element);
    return {
      inputOutline: inputStyle.outlineStyle,
      inputOutlineWidth: inputStyle.outlineWidth,
      inputFontSize: Number.parseFloat(inputStyle.fontSize),
      fieldShadow: fieldStyle.boxShadow,
      fieldBorder: fieldStyle.borderColor,
    };
  });
  expect(focusPaint.inputOutline).toBe("none");
  expect(Number.parseFloat(focusPaint.inputOutlineWidth)).toBe(0);
  expect(focusPaint.fieldShadow).not.toBe("none");
  expect(focusPaint.fieldBorder).not.toBe("rgb(51, 55, 63)");
  if (touchFirst) expect(focusPaint.inputFontSize).toBeGreaterThanOrEqual(16);

  await searchbox.fill("TP1");
  await expect(status).toContainText(/result.*TP1/i);
  const rankedResults = modal.locator("[data-im-search-result]");
  await expect(rankedResults).toHaveCount(1);
  await expect(rankedResults.first()).toContainText("Trend Engine");

  const clear = modal.getByRole("button", { name: "Clear search" });
  await expect(clear).toBeVisible();
  if (touchFirst) {
    await expectTapTarget(clear, { width: 40, height: 40 });
  }

  await modal.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-indicator-search-ranked.png`),
  });

  // Enter activates the highest-ranked primary action without closing the command surface.
  if (!touchFirst) {
    await searchbox.press("Enter");
    await expect(rankedResults.first().locator("xpath=..")).toHaveClass(/\bon\b/);
    await expect(modal).toBeVisible();
  }

  await clear.click();
  await expect(searchbox).toHaveValue("");
  await expect(searchbox).toBeFocused();
  await expect(modal.getByText("All indicators", { exact: true }).first()).toBeVisible();

  // Whitespace is browse mode, not a zero-result query.
  await searchbox.fill("   ");
  await expect(modal.getByText("Search results", { exact: true })).toHaveCount(0);
  await expect(modal.getByText("All indicators", { exact: true }).first()).toBeVisible();

  await searchbox.fill("macd");
  await searchbox.fill("TP1");
  await expect(rankedResults).toHaveCount(1);
  await expect(rankedResults.first()).toContainText("Trend Engine");
  await expect(modal.getByText("MACD Engine", { exact: true })).toHaveCount(0);

  await searchbox.fill("zzzzzzzzzzz");
  await expect(modal.getByText("No indicators found", { exact: true })).toBeVisible();
  await expect(status).toContainText("0 results");

  if (!touchFirst) {
    await searchbox.fill("rsi");
    await expect(rankedResults.first()).toBeVisible();
    await searchbox.press("ArrowDown");
    await expect(rankedResults.first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rankedResults.nth(1)).toBeFocused();
    await page.keyboard.press("Home");
    await expect(rankedResults.first()).toBeFocused();

    // The dialog traps focus instead of letting a long result/action list escape into the chart.
    await modal.locator(".im-close").focus();
    await page.keyboard.press("Shift+Tab");
    await expect(modal.locator(":focus")).toHaveCount(1);
  }

  if (testInfo.project.name === "mobile") {
    await page.evaluate(() => {
      localStorage.setItem("mm.lang", "zh");
      document.documentElement.setAttribute("data-lang", "zh");
      document.documentElement.setAttribute("lang", "zh-CN");
      window.dispatchEvent(new CustomEvent("mm:lang"));
    });
    await expect(modal.getByRole("searchbox", { name: "搜索指标" })).toBeVisible();
    await modal.getByRole("searchbox", { name: "搜索指标" }).fill("止盈");
    await expect(modal.locator("[data-im-search-result]").first()).toContainText("Trend Engine");
    await modal.screenshot({
      path: testInfo.outputPath(`${testInfo.project.name}-indicator-search-zh.png`),
    });
  }

  const viewportFit = await modal.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      documentWidth: document.documentElement.scrollWidth,
    };
  });
  expect(viewportFit.left).toBeGreaterThanOrEqual(-1);
  expect(viewportFit.right).toBeLessThanOrEqual(viewportFit.viewportWidth + 1);
  expect(viewportFit.top).toBeGreaterThanOrEqual(-1);
  expect(viewportFit.bottom).toBeLessThanOrEqual(viewportFit.viewportHeight + 1);
  expect(viewportFit.documentWidth).toBeLessThanOrEqual(viewportFit.viewportWidth + 1);

  // Escape clears first and closes second; unmount restores focus to the invoking control.
  await page.keyboard.press("Escape");
  await expect(modal.locator(".im-search-input")).toHaveValue("");
  await expect(modal).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();
  // On the phone the invoking control is a hub tile that dismissed itself with the hub, so there
  // is no element left to restore focus to; the toolbar button is the invoker everywhere else.
  if (!isPhoneViewport(page)) await expect(trigger).toBeFocused();
});

test("Indicator Library honors reduced motion without losing focus treatment", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The same CSS contract is shared by every viewport.");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await armTerminalVisualReady(page);
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible();
  await waitForTerminalVisualReady(page);
  await page.getByRole("button", { name: "Indicators", exact: true }).click();

  const modal = page.locator(".imodal-library");
  await expect(modal).toBeVisible({ timeout: 10_000 });
  const searchbox = modal.locator(".im-search-input");
  await expect(searchbox).toBeFocused();
  await expect.poll(() => modal.evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  await expect.poll(() => searchbox.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("none");
  await expect.poll(() =>
    modal.locator(".im-search").evaluate((element) => getComputedStyle(element).boxShadow),
  ).not.toBe("none");
});
