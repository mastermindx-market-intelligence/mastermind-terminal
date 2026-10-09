import { expect, test, type Page, type Route } from "@playwright/test";
import { makeGexT } from "@/components/gexdesk/gexStrings";
import { expectTapTarget } from "./tapTarget";

/**
 * Failure-state truth on the GEX desk, from the user's side.
 *
 * A failed snapshot read used to reach the ladder as the same null as a missing one, so a
 * 5xx or a refused request said "No strike snapshot for this name yet". Only a 404 may say
 * that now. A read that did not land renders the load error with a Retry that re-reads in
 * place. The right rail's own reads (market state, the matrix behind the pick) follow the
 * same law without taking the ladder down with them.
 *
 * The SSE stream is refused for the whole test: its fixture producer would push the very
 * payload the injected /api/flow answer withholds, and the desk's classified read is what
 * is under test. The stream's polling fallback reads /api/flow, so it gets the same answers.
 */

test.setTimeout(90_000);

/** One answer per f-param; "fixture" lets the request through to the fixture server. */
type Reply = "503" | "abort" | "404" | "fixture";

async function installFlowReplies(page: Page, replies: Record<string, Reply>) {
  await page.route((url) => url.pathname === "/api/flow/stream", (route: Route) => route.abort("failed"));
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
  const input = page.locator('input[list="gex-roots"]');
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

test("a failed GEX snapshot read is a load error with an in-place Retry, never a coverage gap", async ({ page }, testInfo) => {
  const lang = testInfo.project.name === "tablet" ? "zh" : "en";
  const t = makeGexT(lang);
  const replies: Record<string, Reply> = { "gex:SPY": "503" };
  await setLang(page, lang);
  await installFlowReplies(page, replies);

  await page.goto("/options?tab=gex");
  const region = page.locator(".obs-gexdesk-ladder-region");
  const loadError = region.getByTestId("gex-load-error");
  await expect(loadError).toBeVisible({ timeout: 45_000 });
  await expect(loadError).toContainText(t("errorGex"));
  await expect(loadError).toContainText(t("gexLoadErrorWhy").replace("{sym}", "SPY"));
  await expect(page.getByText(t("gexNoSnapshot"))).toHaveCount(0); // the lie the bug told
  const retry = loadError.getByRole("button", { name: t("errorRetry"), exact: true });
  await expect(retry).toBeVisible({ timeout: 20_000 });
  if (testInfo.project.name !== "desktop") await expectTapTarget(retry, { height: 44 });
  await expectNoPageOverflow(page);

  // Retry into a healthy store: the same document recovers, with no reload.
  await page.evaluate(() => { (window as unknown as { __gexSameDocument?: boolean }).__gexSameDocument = true; });
  replies["gex:SPY"] = "fixture";
  await retry.click({ timeout: 20_000 });
  await expect(region.locator('[data-tut="gex-ladder"]')).toBeVisible({ timeout: 20_000 });
  await expect(region.locator('[data-tut="gex-flip"]')).toHaveCount(1, { timeout: 20_000 });
  await expect(loadError).toHaveCount(0, { timeout: 20_000 });
  expect(await page.evaluate(() => (window as unknown as { __gexSameDocument?: boolean }).__gexSameDocument)).toBe(true);

  // A refused request is the same fact by a different route.
  replies["gex:QQQ"] = "abort";
  await commitRoot(page, "QQQ");
  await expect(loadError).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(t("gexNoSnapshot"))).toHaveCount(0);
  await expect(loadError.getByRole("button", { name: t("errorRetry"), exact: true })).toBeVisible();

  // Only a 404 is the coverage gap, and the ladder offers nothing to retry.
  replies["gex:DIA"] = "404";
  await commitRoot(page, "DIA");
  await expect(region.getByText(t("gexNoSnapshot"))).toBeVisible({ timeout: 20_000 });
  await expect(region.getByText(t("gexNoSnapshotWhy").replace("{sym}", "DIA"))).toBeVisible();
  await expect(loadError).toHaveCount(0);
  await expect(region.getByRole("button", { name: t("errorRetry"), exact: true })).toHaveCount(0);
  await expectNoPageOverflow(page);
});

test("a failed market-state or matrix read stays in its card and never takes the ladder down", async ({ page }, testInfo) => {
  const lang = testInfo.project.name === "tablet" ? "zh" : "en";
  const t = makeGexT(lang);
  const replies: Record<string, Reply> = { "gexstate:SPY": "503", "matrix:SPY": "503" };
  await setLang(page, lang);
  await installFlowReplies(page, replies);

  await page.goto("/options?tab=gex");
  const region = page.locator(".obs-gexdesk-ladder-region");
  await expect(region.locator('[data-tut="gex-ladder"]')).toBeVisible({ timeout: 45_000 });
  await expect(region.getByTestId("gex-load-error")).toHaveCount(0);

  const stateError = page.getByTestId("gex-state-error");
  await expect(stateError).toBeVisible({ timeout: 20_000 });
  await expect(stateError).toContainText(t("stateErrorTitle"));
  const pickError = page.getByTestId("gex-heatseeker-error");
  await expect(pickError).toBeVisible({ timeout: 20_000 });
  await expect(pickError).toContainText(t("heatSeekerError"));
  await expect(page.getByText(t("heatSeekerNull"))).toHaveCount(0); // "no pick" is not known
  const stateRetry = stateError.getByRole("button", { name: t("errorRetry"), exact: true });
  const pickRetry = pickError.getByRole("button", { name: t("errorRetry"), exact: true });
  if (testInfo.project.name !== "desktop") {
    await expectTapTarget(stateRetry, { height: 44 });
    await expectTapTarget(pickRetry, { height: 44 });
  }
  await expectNoPageOverflow(page);

  // Each Retry re-reads only its own store; the ladder is the same element afterwards.
  await region.locator('[data-tut="gex-ladder"]').evaluate((el) => { (el as HTMLElement).dataset.e2eKept = "1"; });
  replies["gexstate:SPY"] = "fixture";
  await stateRetry.click({ timeout: 20_000 });
  await expect(stateError).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('[data-tut="gex-state-card"]')).not.toContainText(t("stateErrorTitle"));
  replies["matrix:SPY"] = "fixture";
  await pickRetry.click({ timeout: 20_000 });
  await expect(pickError).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('[data-tut="gex-ladder"][data-e2e-kept="1"]')).toHaveCount(1);
});
