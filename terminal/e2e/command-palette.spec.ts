import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { expectTapTarget } from "./tapTarget";

// E20 chart command palette: a search → action → return journey through the shell's own
// handlers, in English and Chinese, at desktop, tablet and phone widths. Also proves the
// guards: a chart change while choosing runs nothing on the first confirmation, typing ">" in a
// text field or another dialog never opens the palette, and an unavailable action explains
// itself instead of pretending to succeed.

type Lang = "en" | "zh";

const TEXT = {
  en: {
    dialog: /^Actions$/,
    statements: "statem",
    back: "back to chart",
    next: "next symbol",
    prev: "previous symbol",
    changed: "The chart changed to",
    undoReason: "Not available: No drawing change to undo",
    undo: "undo drawing",
    targetPrefix: "Acting on",
  },
  zh: {
    dialog: /^操作$/,
    statements: "报表",
    back: "返回图表",
    next: "下一个",
    prev: "上一个",
    changed: "图表已切换为",
    undoReason: "不可用：没有可撤销的绘图更改",
    undo: "撤销绘图",
    targetPrefix: "当前对象",
  },
} as const;

const isTouch = (testInfo: TestInfo) => testInfo.project.name !== "desktop";

async function openTerminal(page: Page, lang: Lang) {
  await page.addInitScript((language) => {
    localStorage.setItem("mm.lang", language);
    const ready = window as Window & { __mmChartHubReady?: boolean };
    ready.__mmChartHubReady = false;
    window.addEventListener("mm:terminal-visual-ready", () => {
      ready.__mmChartHubReady = true;
    }, { once: true });
  }, lang);
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 20_000 });
  await expect.poll(
    () => page.evaluate(() => Boolean((window as Window & { __mmChartHubReady?: boolean }).__mmChartHubReady)),
    { message: "the interactive Terminal should finish hydrating", timeout: 20_000 },
  ).toBe(true);
}

/** Desktop opens with the ">" key; touch layouts open from the button in the top bar. */
async function openPalette(page: Page, testInfo: TestInfo, lang: Lang, via: "key" | "button" = "key") {
  if (isTouch(testInfo)) {
    const trigger = page.locator("[data-command-palette-trigger=mobile]");
    await expect(trigger).toBeVisible();
    await trigger.click();
  } else if (via === "button") {
    await page.locator("[data-command-palette-trigger=desktop]").click();
  } else {
    await page.keyboard.press(">");
  }
  const dialog = page.getByRole("dialog", { name: TEXT[lang].dialog });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function search(page: Page, testInfo: TestInfo, query: string) {
  const box = page.locator("[data-command-palette] input[role=combobox]");
  // The phone sheet focuses itself, not the field, so the keyboard does not cover the list.
  if (isTouch(testInfo)) await box.click();
  await expect(box).toBeFocused();
  await box.fill(query);
}

/** Desktop confirms with Enter; touch taps the row, as a person would. */
async function runAction(page: Page, testInfo: TestInfo, id: string) {
  const row = page.locator(`[data-command-palette] [data-action-id='${id}']`);
  await expect(row).toBeVisible();
  if (isTouch(testInfo)) await row.click();
  else {
    await expect(row).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
  }
}

/** The cross-route active-symbol cursor the shell writes for every symbol change. */
function activeCursor(page: Page) {
  return page.evaluate(() => localStorage.getItem("mm.activeSymbol"));
}

function shownSymbol(page: Page, testInfo: TestInfo) {
  return page.locator(isTouch(testInfo) ? ".m-sym b" : ".pair b").first();
}

for (const lang of ["en", "zh"] as const) {
  test.describe(`chart command palette (${lang})`, () => {
    test("research: search, open, and return to the chart", async ({ page }, testInfo) => {
      await openTerminal(page, lang);
      const dialog = await openPalette(page, testInfo, lang);
      await expect(dialog.locator("[data-palette-target]")).toContainText(TEXT[lang].targetPrefix);
      await expect(dialog.locator("[data-palette-target]")).toContainText("NVDA");
      await search(page, testInfo, TEXT[lang].statements);
      await runAction(page, testInfo, "research:statements");
      await expect(dialog).toBeHidden();

      if (isTouch(testInfo)) {
        // Touch layouts open research where the menu's Analysis link does, with its own way back.
        await expect(page).toHaveURL(/\/analysis\?symbol=NVDA&page=statements$/);
        const back = page.locator(".analysis-context-back");
        await expect(back).toBeVisible();
        await back.click();
        await expect(page).toHaveURL(/\/terminal\?symbol=NVDA/);
        await expect(page.locator(".chart-wrap canvas").first()).toBeVisible();
        return;
      }

      // Wide layouts open the research pane in place, exactly as its own page switch does.
      const pane = page.locator(".fin-pane");
      await expect(pane).toBeVisible();
      await expect(pane.locator("[data-fin-local=statements][aria-selected=true]")).toBeVisible();
      const reopened = await openPalette(page, testInfo, lang, "button");
      await expect(reopened.locator("[data-palette-target]")).toContainText("NVDA");
      await search(page, testInfo, TEXT[lang].back);
      await runAction(page, testInfo, "research:close");
      await expect(pane).toHaveCount(0);
      await expect(page).not.toHaveURL(/[?&]pane=/);
      await expect(page.locator(".chart-wrap canvas").first()).toBeVisible();
    });

    test("watchlist: next symbol, then back with previous symbol", async ({ page }, testInfo) => {
      await openTerminal(page, lang);
      const dialog = await openPalette(page, testInfo, lang);
      await search(page, testInfo, TEXT[lang].next);
      const nextRow = dialog.locator("[data-action-id='watchlist:next']");
      const target = (await nextRow.innerText()).split("\n").pop() ?? "";
      const next = /NVDA\s*→\s*([A-Z0-9.^-]+)/.exec(target)?.[1];
      expect(next, `the row names its destination (${target})`).toBeTruthy();
      await runAction(page, testInfo, "watchlist:next");
      await expect(dialog).toBeHidden();
      await expect(shownSymbol(page, testInfo)).toHaveText(next!);
      await expect.poll(() => activeCursor(page)).toBe(next);

      const back = await openPalette(page, testInfo, lang);
      await expect(back.locator("[data-palette-target]")).toContainText(next!);
      await search(page, testInfo, TEXT[lang].prev);
      await runAction(page, testInfo, "watchlist:previous");
      await expect(shownSymbol(page, testInfo)).toHaveText("NVDA");
      await expect.poll(() => activeCursor(page)).toBe("NVDA");
    });

    test("a chart change while choosing runs nothing until confirmed again", async ({ page }, testInfo) => {
      await openTerminal(page, lang);
      const dialog = await openPalette(page, testInfo, lang);
      await search(page, testInfo, TEXT[lang].next);
      await expect(dialog.locator("[data-palette-target]")).not.toContainText("· W");
      // The chart's own timeframe seam (the intraday "Back to Daily" overlay uses it) changes
      // the chart underneath the open palette.
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("mm:set-tf", { detail: { tf: "W" } })));
      await expect(page.locator("[data-command-palette]")).toHaveAttribute("data-stale", "1");
      await expect(dialog.locator("[data-palette-target]")).toContainText("· W");

      const row = dialog.locator("[data-action-id='watchlist:next']");
      // Desktop confirms with Enter, touch taps the row: either way the first confirmation only explains.
      const confirm = () => (isTouch(testInfo) ? row.click() : page.keyboard.press("Enter"));
      await confirm();
      await expect(dialog).toBeVisible();
      await expect(dialog.locator("[data-palette-notice]")).toContainText(TEXT[lang].changed);
      await expect(shownSymbol(page, testInfo)).toHaveText("NVDA");

      // The second confirmation runs on the chart the notice named.
      await confirm();
      await expect(dialog).toBeHidden();
      await expect(shownSymbol(page, testInfo)).not.toHaveText("NVDA");
    });

    test("an unavailable action explains itself and does not run", async ({ page }, testInfo) => {
      await openTerminal(page, lang);
      const dialog = await openPalette(page, testInfo, lang);
      await search(page, testInfo, TEXT[lang].undo);
      const row = dialog.locator("[data-action-id='drawings:undo']");
      await expect(row).toHaveAttribute("aria-disabled", "true");
      // A disabled row stays reachable so its reason can be read; confirming it only explains.
      if (isTouch(testInfo)) await row.click({ force: true });
      else {
        await expect(row).toHaveAttribute("aria-selected", "true");
        await page.keyboard.press("Enter");
      }
      await expect(dialog).toBeVisible();
      await expect(dialog.locator("[data-palette-notice]")).toHaveText(TEXT[lang].undoReason);
      if (isTouch(testInfo)) {
        await expectTapTarget(row, { height: 44 });
        await expectTapTarget(page.locator("[data-command-palette] input[role=combobox]"), { height: 40 });
      }
    });
  });
}

test("typing \">\" in a text field or another dialog never opens the palette", async ({ page }, testInfo) => {
  await openTerminal(page, "en");
  // Symbol search is the established text field and modal on every layout.
  if (isTouch(testInfo)) {
    await page.locator(".m-symbar").click();
    await page.locator("input[role=combobox]:visible").first().click();
  } else await page.keyboard.press("Control+k");
  const field = page.locator("input:focus");
  await expect(field).toHaveCount(1);
  await page.keyboard.type("a>b");
  await expect(field).toHaveValue(/a>b$/);
  await expect(page.locator("[data-command-palette]")).toHaveCount(0);
  await page.keyboard.press("Escape");

  // IME composition of ">" (for example a full-width bracket being composed) never opens it.
  await page.evaluate(() => {
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: ">", isComposing: true, bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: ">", keyCode: 229, bubbles: true }));
  });
  await expect(page.locator("[data-command-palette]")).toHaveCount(0);

  // Control: the same ">" without composition, outside any field, does open it.
  await page.evaluate(() => {
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: ">", bubbles: true, cancelable: true }));
  });
  await expect(page.locator("[data-command-palette]")).toHaveCount(1);

  if (isTouch(testInfo)) {
    await expectTapTarget(page.locator("[data-command-palette-trigger=mobile]"), { width: 40, height: 40 });
  }
});
