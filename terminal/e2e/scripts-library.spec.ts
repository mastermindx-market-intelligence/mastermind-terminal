import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { openIndicatorLibrary } from "./phoneChrome";
import { renderAsGuest, useLang } from "./layoutStore";
import { expectTapTarget } from "./tapTarget";

// C6/C7 at the surface the user actually sees: the Indicator Library's "My Scripts" list.
//
// The fixture store (lib/scriptsFixtureDb.ts) seeds TWO accounts and applies the real
// `saved_scripts` RLS predicate (owner OR is_public), so the foreign PUBLIC script is genuinely
// readable by this user — which is what makes "it does not appear in My Scripts" a statement about
// the application's owner filter rather than about an empty table.

const RUN_NONCE = `${process.env.TEST_WORKER_INDEX ?? "0"}${Math.random().toString(36).slice(2, 8)}`;
const DEFAULT_BASE = "http://127.0.0.1:3108";

const MINE = "My Momentum";
const FOREIGN = "Someone Else's Public Script";

async function isolate(page: Page, testInfo: TestInfo, baseURL?: string) {
  const key = `${testInfo.project.name}-${testInfo.title}-${testInfo.retry}-${RUN_NONCE}`
    .toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 110);
  await page.context().addCookies([{ name: "mm_e2e_scripts", value: key, url: baseURL ?? DEFAULT_BASE }]);
  return key;
}

const injectScriptFault = (page: Page, on: boolean, baseURL?: string) =>
  page.context().addCookies([{ name: "mm_e2e_script_fault", value: on ? "1" : "", url: baseURL ?? DEFAULT_BASE }]);

async function openMyScripts(page: Page) {
  await openIndicatorLibrary(page);
  const modal = page.locator(".im, .indicators-modal, [role='dialog']").first();
  await expect(modal).toBeVisible({ timeout: 20_000 });
  await modal.getByRole("button", { name: /My Scripts|我的脚本/ }).first().click();
  return modal;
}

/** The outage line, in zh — the state C7 added. `scriptsUnavailable` ships as an EN/ZH LEX tuple. */
const ZH_OUTAGE = "无法加载你的脚本";

const gotoTerminal = async (page: Page) => {
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".chart-wrap, .chart-host, canvas").first()).toBeVisible({ timeout: 45_000 });
};

test.describe("My Scripts", () => {
  test("shows the owner's scripts and never another account's public one", async ({ page, baseURL }, testInfo) => {
    await isolate(page, testInfo, baseURL);
    await gotoTerminal(page);
    const modal = await openMyScripts(page);

    await expect(modal.getByText(MINE, { exact: false })).toBeVisible();
    await expect(modal.getByText(FOREIGN, { exact: false })).toHaveCount(0);
    await expect(modal.locator('[data-scripts-status="unavailable"]')).toHaveCount(0);
  });

  test("a storage outage says so and keeps a Retry, instead of 'no custom scripts yet'", async ({ page, baseURL }, testInfo) => {
    await isolate(page, testInfo, baseURL);
    await injectScriptFault(page, true, baseURL);
    await gotoTerminal(page);
    const modal = await openMyScripts(page);

    await expect(modal.locator('[data-scripts-status="unavailable"]')).toBeVisible();
    await expect(modal.locator('[data-scripts-status="empty"]')).toHaveCount(0);

    // Retry heals, and the library was never actually empty.
    await injectScriptFault(page, false, baseURL);
    await modal.locator("[data-scripts-retry]").click();
    await expect(modal.getByText(MINE, { exact: false })).toBeVisible();
    await expect(modal.locator('[data-scripts-status="unavailable"]')).toHaveCount(0);
  });

  // The repo's verification law: a UI change is not done until zh is checked, and neither language
  // may leak into the other's view. Deterministic where a screenshot is not.
  test("the outage line renders in zh, with no English leaking through", async ({ page, baseURL }, testInfo) => {
    await isolate(page, testInfo, baseURL);
    await useLang(page, "zh");
    await injectScriptFault(page, true, baseURL);
    await gotoTerminal(page);
    const modal = await openMyScripts(page);

    const outage = modal.locator('[data-scripts-status="unavailable"]');
    await expect(outage).toContainText(ZH_OUTAGE);
    await expect(outage).not.toContainText(/[A-Za-z]{4,}/);
    await expect(modal.locator("[data-scripts-retry]")).toHaveText("重试");
  });
});

for (const lang of ["en", "zh"] as const) {
  test(`script rename and touch actions keep the whole task intact (${lang})`, async ({ page, baseURL }, info) => {
    test.setTimeout(90_000);
    // Exercise the real guest persistence owner. The account fixture intentionally supports
    // reads only, so its synthetic account cannot prove an authenticated save.
    await renderAsGuest(page, baseURL); await useLang(page, lang);
    await page.addInitScript(() => {
      if (localStorage.getItem("mm.guestScripts") === null) {
        localStorage.setItem("mm.guestScripts", JSON.stringify([{
          id: "guest-research-study", name: "My Momentum", source: "//@version=6\nindicator('x')\nplot(close)",
          lang: "pine", params: {}, updated_at: "2026-11-09T00:00:00Z",
        }]));
      }
    });
    await gotoTerminal(page);
    const modal = await openMyScripts(page);
    const row = modal.locator(".li-script").filter({ hasText: MINE });
    const rename = row.locator('.li-acts button:not(.del)');
    await rename.click();
    const input = modal.locator(".li-rename");
    const longName = lang === "zh" ? "长期动量研究与风险管理观察脚本——每日工作流程" : "Long-horizon momentum and risk management research workspace";
    await input.fill(longName);
    for (const signal of [{ isComposing: true }, { keyCode: 229 }]) {
      for (const key of ["Enter", "Escape"]) {
        expect(await input.evaluate((element, options) => element.dispatchEvent(new KeyboardEvent("keydown", {
          ...options, bubbles: true, cancelable: true,
        })), { key, ...signal })).toBe(true);
        await expect(input).toBeFocused(); await expect(input).toHaveValue(longName);
        await expect(modal).toBeVisible();
      }
    }
    await input.press("Escape");
    await expect(input).toHaveCount(0); await expect(rename).toBeFocused();
    await expect(row.locator(".li-nm")).toHaveText(MINE);
    await rename.click(); await input.fill(longName); await input.press("Enter");
    const saved = modal.locator(".li-script").filter({ hasText: longName });
    await expect(saved.locator(".li-nm")).toHaveText(longName);
    await expect(saved.locator(".li-acts button:not(.del)")).toBeFocused();

    if (info.project.use.hasTouch) {
      for (const action of await saved.locator(".li-acts button, .li-acts a").all()) {
        await expectTapTarget(action, { width: 44, height: 44 });
      }
      await expectTapTarget(modal.locator(".im-nav-item.on"), { height: 44 });
    }
    expect(await modal.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await modal.screenshot({ path: info.outputPath(`scripts-${info.project.name}-${lang}.png`) });

    // The existing async save removes this row from the current search. Focus remains usable.
    const search = modal.locator(".im-search-input");
    await search.fill(longName);
    await saved.locator(".li-acts button:not(.del)").click();
    const finalName = lang === "zh" ? "已确认的研究脚本" : "Confirmed research script";
    await input.fill(finalName); await input.press("Enter");
    await expect(saved).toHaveCount(0); await expect(search).toBeFocused();
    await search.fill("TP1");
    const moduleRow = modal.locator(".imod-row").first();
    await expect(moduleRow).toBeVisible();
    if (info.project.use.hasTouch) {
      for (const action of await moduleRow.locator(".imod-action").all()) {
        await expectTapTarget(action, { width: 44, height: 44 });
      }
    }
    expect(await modal.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await modal.screenshot({ path: info.outputPath(`study-actions-${info.project.name}-${lang}.png`) });
    // Render the same enabled actions with the existing light-theme token contract.
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    await modal.screenshot({ path: info.outputPath(`study-actions-${info.project.name}-${lang}-light.png`) });

    await page.reload(); await expect(page.locator(".mm-ptag")).toBeVisible();
    const refreshed = await openMyScripts(page);
    await expect(refreshed.locator(".li-nm").filter({ hasText: finalName })).toBeVisible();
    await expect(refreshed.locator(".li-nm").filter({ hasText: longName })).toHaveCount(0);
  });
}
