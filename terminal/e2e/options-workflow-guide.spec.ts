import { expect, test } from "./fixtures";
import { mkdirSync } from "node:fs";
import path from "node:path";

const EVIDENCE = process.env.OPTIONS_WORKFLOW_EVIDENCE === "1";
const EVIDENCE_DIR = path.join(process.cwd(), "..", "docs", "pr-crops", "options-workflow-guide");
const MANIFEST = {
  symbols: {
    SPY: { name: "SPDR S&P 500 ETF", last: 701.25, regimeBull: true },
    QQQ: { name: "Invesco QQQ", last: 620.4, regimeBull: true },
  },
};

test.beforeAll(() => {
  if (EVIDENCE) mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test("the options workflow navigates tape, structure, plan, and alert setup without claiming completion", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const zh = testInfo.project.name === "tablet";
  const locale = zh ? "zh" : "en";

  await page.addInitScript((lang) => {
    if (!sessionStorage.getItem("options-workflow-test-ready")) {
      localStorage.removeItem("mm.optionsWorkflow.v1");
      sessionStorage.setItem("options-workflow-test-ready", "1");
    }
    localStorage.setItem("mm.lang", lang);
    document.documentElement.setAttribute("data-lang", lang);
    document.documentElement.setAttribute("lang", lang === "zh" ? "zh-CN" : "en");
  }, locale);
  await page.route("**/data/manifest.json", (route) => route.fulfill({ json: MANIFEST }));
  let alertPosts = 0;
  await page.route("**/api/alerts", (route) => {
    if (route.request().method() === "POST") alertPosts += 1;
    return route.fulfill({ json: { alerts: [] } });
  });

  const progressText = (count: number) => zh ? `已查看 ${count}/4` : `${count}/4 viewed`;

  await page.goto("/options?tab=tape");
  const launcher = page.locator('[data-options-workflow-guide="launcher"]');
  await expect(launcher).toBeVisible({ timeout: 15_000 });
  await expect(launcher.locator(".options-workflow-progress")).toHaveText(progressText(1));

  await launcher.click();
  const dialog = page.locator('[data-options-workflow-guide="dialog"]');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-options-workflow-stage]')).toHaveCount(4);
  await expect(dialog).toContainText(zh ? "从盘口到提醒设置" : "From tape to alert setup");
  await expect(dialog).toContainText(zh ? "本设备标记为已查看" : "marks it viewed on this device");
  await expect(dialog).toContainText(zh ? "本流程不会自动创建提醒" : "Nothing is created by this guide");
  await expect(dialog).toContainText(zh ? "数据过期或缺失时" : "fail closed on stale or missing evidence");
  await expect(dialog).not.toContainText(zh ? "From tape to alert setup" : "从盘口到提醒设置");
  await expect(dialog).not.toContainText(zh ? "live desk" : "实时工作台");
  await expect(dialog).not.toContainText(zh ? "Live Flow" : "实时资金流");
  const close = dialog.getByRole("button", { name: zh ? "关闭期权工作流程" : "Close options workflow" });
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(launcher).toBeFocused();
  await launcher.click();

  const containment = await page.evaluate(() => {
    const box = document.querySelector<HTMLElement>('[data-options-workflow-guide="dialog"]')?.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      left: box?.left ?? -1,
      right: box?.right ?? Infinity,
      top: box?.top ?? -1,
      bottom: box?.bottom ?? Infinity,
    };
  });
  expect(containment.documentWidth).toBeLessThanOrEqual(containment.viewportWidth + 1);
  expect(containment.left).toBeGreaterThanOrEqual(0);
  expect(containment.right).toBeLessThanOrEqual(containment.viewportWidth + 1);
  expect(containment.top).toBeGreaterThanOrEqual(0);
  expect(containment.bottom).toBeLessThanOrEqual(containment.viewportHeight + 1);

  const guideShot = `${testInfo.project.name}-${locale}-workflow.png`;
  await page.screenshot({ path: testInfo.outputPath(guideShot), fullPage: false });
  if (EVIDENCE) await page.screenshot({ path: path.join(EVIDENCE_DIR, guideShot), fullPage: false });
  await dialog.locator('[data-options-workflow-stage="structure"] button').click();
  await expect(page).toHaveURL(/\/options\?tab=gex$/);
  await expect(page.locator("#wtab-gex")).toHaveAttribute("aria-selected", "true");
  await expect(launcher.locator(".options-workflow-progress")).toHaveText(progressText(2));

  await launcher.click();
  await dialog.locator('[data-options-workflow-stage="plan"] button').click();
  await expect(page).toHaveURL(/\/options\?tab=prophet$/);
  await expect(page.locator("#prophet-lane-macro")).toHaveAttribute("aria-selected", "true", { timeout: 15_000 });
  await expect(launcher.locator(".options-workflow-progress")).toHaveText(progressText(3));

  await launcher.click();
  await dialog.locator('[data-options-workflow-stage="alert"] button').click();
  await expect(page).toHaveURL(/\/alerts$/);
  await expect(page.locator(".alert-form > select").first()).toHaveValue("options");
  await expect(page.locator('select:has(option[value="opt_gamma_flip"])')).toHaveValue("opt_gamma_flip");
  await expect(page.locator('.alert-form select:has(option[value="SPY"])')).toHaveValue("SPY");
  await expect(page.locator(".opt-preview-txt")).toContainText(zh ? "gamma 翻转位" : "gamma flip");
  expect(alertPosts).toBe(0);

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("mm.optionsWorkflow.v1") || "null"));
  expect(stored).toEqual({ version: 1, visited: ["tape", "structure", "plan", "alert"] });

  const alertShot = `${testInfo.project.name}-${locale}-alert-handoff.png`;
  await page.screenshot({ path: testInfo.outputPath(alertShot), fullPage: false });
  if (EVIDENCE) await page.screenshot({ path: path.join(EVIDENCE_DIR, alertShot), fullPage: false });

  await page.goBack();
  await expect(page).toHaveURL(/\/options\?tab=prophet$/);
  await expect(launcher.locator(".options-workflow-progress")).toHaveText(progressText(4));
});

test("options query prefill rejects a non-canonical root and never leaks across categories", async ({ page }) => {
  let alertPosts = 0;
  await page.route("**/data/manifest.json", (route) => route.fulfill({ json: MANIFEST }));
  await page.route("**/api/alerts", (route) => {
    if (route.request().method() === "POST") alertPosts += 1;
    return route.fulfill({ json: { alerts: [] } });
  });

  await page.goto("/alerts?cat=options&root=A_B&kind=opt_gamma_flip");
  const category = page.locator(".alert-form > select").first();
  await expect(category).toHaveValue("signal");
  await expect(page).toHaveURL(/\/alerts$/);

  await category.selectOption("options");
  await expect(page.locator('.alert-form select:has(option[value="SPY"])')).toHaveValue("SPY");
  await expect(page.locator('.alert-form option[value="A_B"]')).toHaveCount(0);
  await expect(page.locator(".opt-preview-txt")).toContainText("SPY");
  expect(alertPosts).toBe(0);

  await page.goto("/alerts?cat=signal&root=QQQ&kind=opt_gamma_flip");
  await expect(category).toHaveValue("signal");
  await expect(page).toHaveURL(/\/alerts$/);
  await category.selectOption("options");
  await expect(page.locator('.alert-form select:has(option[value="SPY"])')).toHaveValue("SPY");
  expect(alertPosts).toBe(0);
});

/**
 * The hand-over must survive an EXTRA MOUNT of the alerts view.
 *
 * `/alerts` renders through a lazy boundary, so the view can mount more than once around the
 * chunk resolving. The old prefill read the params in the mount effect, scheduled the state writes
 * in a `queueMicrotask` guarded by an `alive` flag, and stripped the params in the same pass — so
 * an unmount between the two cancelled the writes while the params were already gone, and the next
 * mount found nothing. The form then sat on its defaults with the URL looking perfectly correct,
 * which is what made it read as a flake rather than a bug.
 *
 * A direct navigation to the hand-over URL is the same contract the guide's button produces, and
 * re-entering /alerts a second time proves the capture is per-navigation, not once per page load.
 */
test("an options hand-over prefills the alert form, and a second hand-over still does", async ({ page }) => {
  await page.route("**/data/manifest.json", (route) => route.fulfill({ json: MANIFEST }));
  await page.route("**/api/alerts", (route) => route.fulfill({ json: { alerts: [] } }));

  await page.goto("/alerts?cat=options&root=SPY&kind=opt_gamma_flip");
  await expect(page.locator(".alert-form > select").first()).toHaveValue("options", { timeout: 30_000 });
  await expect(page.locator('select:has(option[value="opt_gamma_flip"])')).toHaveValue("opt_gamma_flip");
  await expect(page).toHaveURL(/\/alerts$/);              // the params are cleaned up after capture

  // Leave and come back with a DIFFERENT hand-over: the module is already evaluated, so a
  // one-shot capture flag would silently drop this one.
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 60_000 });
  await page.goto("/alerts?cat=options&root=QQQ&kind=opt_wall_touch");
  await expect(page.locator(".alert-form > select").first()).toHaveValue("options", { timeout: 30_000 });
  await expect(page.locator('select:has(option[value="opt_wall_touch"])')).toHaveValue("opt_wall_touch");
  await expect(page.locator('.alert-form select:has(option[value="QQQ"])')).toHaveValue("QQQ");

  // …and a plain visit afterwards is NOT re-prefilled from a stale capture.
  await page.goto("/alerts");
  await expect(page.locator(".alert-form > select").first()).toHaveValue("signal", { timeout: 30_000 });
});
