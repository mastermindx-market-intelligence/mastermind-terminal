import { expect, test, type Page, type Route } from "@playwright/test";
import { expectTapTarget } from "./tapTarget";

/**
 * Failure-state truth on the Volatility tab, from the user's side.
 *
 * A failed /api/flow read used to reach the tab as the same null as a missing object, so a
 * 5xx or a refused request rendered the coverage gap ("{sym} isn't in this nightly build").
 * Only a 404 may say that now. A read that did not land renders the load error with a Retry
 * that re-reads in place, and the spread panel's own aggregate-trend read follows the same
 * law without taking the snapshot down with it.
 */

test.setTimeout(90_000);

/** One answer per f-param; "fixture" lets the request through to the fixture server. */
type Reply = "503" | "abort" | "404" | "fixture";

const COPY = {
  en: {
    errorLoad: "Could not load volatility data",
    emptyTitle: "No volatility snapshot for this name yet",
    notInBuild: (sym: string) => `${sym} isn't in this nightly build`,
    retry: "Retry",
    statsTitle: "Volatility snapshot",
    spreadTitle: "IV − realized-vol spread · history",
    spreadError: "Could not load the spread history",
    spreadAbsent: "No IV − realized-vol spread history for this name",
    spreadLoading: "Loading spread history",
  },
  zh: {
    errorLoad: "无法加载波动率数据",
    emptyTitle: "该品种暂无波动率快照",
    notInBuild: (sym: string) => `本次夜间构建中没有 ${sym}`,
    retry: "重试",
    statsTitle: "波动率概览",
    spreadTitle: "IV − 已实现波动率差值 · 历史",
    spreadError: "无法加载差值历史",
    spreadAbsent: "该品种暂无IV − 已实现波动率差值历史",
    spreadLoading: "加载差值历史中",
  },
};

async function installFlowReplies(page: Page, replies: Record<string, Reply>) {
  await page.route(
    (url) => url.pathname === "/api/flow" && (replies[url.searchParams.get("f") ?? ""] ?? "fixture") !== "fixture",
    async (route: Route) => {
      switch (replies[new URL(route.request().url()).searchParams.get("f") ?? ""]) {
        case "503": return route.fulfill({ status: 503, json: { error: "feed unavailable" } });
        case "404": return route.fulfill({ status: 404, json: { error: "not published" } });
        case "abort": return route.abort("failed");
        default: return route.fallback();
      }
    },
  );
}

async function setLang(page: Page, lang: "en" | "zh") {
  await page.addInitScript((l) => {
    localStorage.setItem("mm.lang", l);
    document.documentElement.setAttribute("data-lang", l);
  }, lang);
}

async function commitRoot(page: Page, root: string) {
  const input = page.locator('input[list="vol-roots"]');
  await input.fill(root, { timeout: 20_000 });
  await input.press("Enter", { timeout: 20_000 });
}

async function expectNoPageOverflow(page: Page) {
  const doc = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(doc.scroll).toBeLessThanOrEqual(doc.client + 1);
}

test("a failed volatility read is a load error with an in-place Retry, never a coverage gap", async ({ page }, testInfo) => {
  const lang = testInfo.project.name === "tablet" ? "zh" : "en";
  const copy = COPY[lang];
  const replies: Record<string, Reply> = { "vol:SPY": "503" };
  await setLang(page, lang);
  await installFlowReplies(page, replies);

  await page.goto("/options?tab=volatility");
  await expect(page.getByText(copy.errorLoad).first()).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText(copy.emptyTitle)).toHaveCount(0); // the lie the bug told
  await expect(page.getByText(copy.notInBuild("SPY"))).toHaveCount(0);
  const retry = page.getByRole("button", { name: copy.retry, exact: true });
  await expect(retry).toBeVisible({ timeout: 20_000 });
  if (testInfo.project.name !== "desktop") await expectTapTarget(retry, { height: 44 });
  await expectNoPageOverflow(page);

  // Retry into a healthy store: the same document recovers, with no reload.
  await page.evaluate(() => { (window as unknown as { __volSameDocument?: boolean }).__volSameDocument = true; });
  replies["vol:SPY"] = "fixture";
  await retry.click({ timeout: 20_000 });
  await expect(page.getByTestId("term-expiry-select")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(copy.errorLoad)).toHaveCount(0, { timeout: 20_000 });
  await expect(retry).toHaveCount(0, { timeout: 20_000 });
  expect(await page.evaluate(() => (window as unknown as { __volSameDocument?: boolean }).__volSameDocument)).toBe(true);

  // A refused request is the same fact by a different route.
  replies["vol:QQQ"] = "abort";
  await commitRoot(page, "QQQ");
  await expect(page.getByText(copy.errorLoad).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(copy.notInBuild("QQQ"))).toHaveCount(0);
  await expect(retry).toBeVisible({ timeout: 20_000 });

  // Only a 404 is the coverage gap, and there is nothing to retry.
  replies["vol:DIA"] = "404";
  await commitRoot(page, "DIA");
  await expect(page.getByText(copy.emptyTitle)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(copy.notInBuild("DIA"))).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(copy.errorLoad)).toHaveCount(0, { timeout: 20_000 });
  await expect(retry).toHaveCount(0, { timeout: 20_000 });
  await expectNoPageOverflow(page);
});

test("a failed spread-history read keeps the snapshot and never calls the history unpublished", async ({ page }, testInfo) => {
  const lang = testInfo.project.name === "tablet" ? "zh" : "en";
  const copy = COPY[lang];
  const replies: Record<string, Reply> = { "agg:SPY": "503" };
  await setLang(page, lang);
  await installFlowReplies(page, replies);

  await page.goto("/options?tab=volatility");
  const spread = page.locator(".fin-card").filter({ hasText: copy.spreadTitle }).first();
  await expect(spread).toContainText(copy.spreadError, { timeout: 45_000 });
  await expect(spread).not.toContainText(copy.spreadAbsent);
  await expect(page.getByTestId("term-expiry-select")).toBeVisible({ timeout: 20_000 });
  const retry = spread.getByRole("button", { name: copy.retry, exact: true });
  await expect(retry).toBeVisible({ timeout: 20_000 });
  if (testInfo.project.name !== "desktop") await expectTapTarget(retry, { height: 44 });

  // Retry re-reads only the spread store: the snapshot card is the same element afterwards.
  const stats = page.locator("section.fin-card").filter({ hasText: copy.statsTitle }).first();
  await stats.evaluate((el) => { (el as HTMLElement).dataset.e2eKept = "1"; });
  replies["agg:SPY"] = "fixture";
  await retry.click({ timeout: 20_000 });
  await expect(spread.locator('svg[role="img"]')).toHaveCount(1, { timeout: 20_000 });
  await expect(spread).not.toContainText(copy.spreadError);
  await expect(spread).not.toContainText(copy.spreadLoading);
  await expect(page.locator('section.fin-card[data-e2e-kept="1"]')).toHaveCount(1);

  // A 404 is the one answer that may call the history unpublished.
  replies["agg:QQQ"] = "404";
  await commitRoot(page, "QQQ");
  await expect(spread).toContainText(copy.spreadAbsent, { timeout: 20_000 });
  await expect(spread).not.toContainText(copy.spreadError);
  await expect(spread.getByRole("button", { name: copy.retry, exact: true })).toHaveCount(0);
  await expectNoPageOverflow(page);
});
