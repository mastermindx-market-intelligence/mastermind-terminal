import { expect, test, type Page, type Route } from "@playwright/test";
import { levelsReadLabel } from "@/components/levels/levelsLabels";
import { expectTapTarget } from "./tapTarget";

/**
 * Failure-state truth on the Levels board, from the user's side.
 *
 * Any null used to render "No levels for this root yet", so a 5xx or a refused request read
 * as a root with no map. Only a 404 (or a published payload that carries no levels) may say
 * that now. A read that did not land renders the load error with a Retry that re-reads in
 * place.
 */

test.setTimeout(90_000);

/** One answer per f-param; "fixture" lets the request through to the fixture server. */
type Reply = "503" | "abort" | "404" | "fixture";

// The empty-root copy lives in the evidence-locked i18n table; repeated here as data.
const NO_LEVELS = { en: "No levels for this root yet", zh: "这个标的还没有档位" };

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
  const input = page.locator('input[list="levels-roots"]');
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

test("a failed levels read is a load error with an in-place Retry, never an empty root", async ({ page }, testInfo) => {
  const lang = testInfo.project.name === "tablet" ? "zh" : "en";
  const tr = (key: Parameters<typeof levelsReadLabel>[0]) => levelsReadLabel(key, lang);
  const replies: Record<string, Reply> = { "levels:SPY": "503" };
  await setLang(page, lang);
  await installFlowReplies(page, replies);

  await page.goto("/options?tab=levels");
  const loadError = page.getByTestId("levels-load-error");
  await expect(loadError).toBeVisible({ timeout: 45_000 });
  await expect(loadError).toContainText(tr("lvLoadError").replace("{ticker}", "SPY"));
  await expect(page.getByText(NO_LEVELS[lang])).toHaveCount(0); // the lie the bug told
  await expect(page.getByTestId("levels-rung")).toHaveCount(0);
  const retry = loadError.getByRole("button", { name: tr("lvRetry"), exact: true });
  await expect(retry).toBeVisible({ timeout: 20_000 });
  if (testInfo.project.name !== "desktop") await expectTapTarget(retry, { height: 44 });
  await expectNoPageOverflow(page);

  // Retry into a healthy store: the same document recovers, with no reload.
  await page.evaluate(() => { (window as unknown as { __levelsSameDocument?: boolean }).__levelsSameDocument = true; });
  replies["levels:SPY"] = "fixture";
  await retry.click({ timeout: 20_000 });
  await expect(page.getByTestId("levels-rung").first()).toBeVisible({ timeout: 20_000 });
  await expect(loadError).toHaveCount(0, { timeout: 20_000 });
  expect(await page.evaluate(() => (window as unknown as { __levelsSameDocument?: boolean }).__levelsSameDocument)).toBe(true);

  // A refused request is the same fact by a different route.
  replies["levels:QQQ"] = "abort";
  await commitRoot(page, "QQQ");
  await expect(loadError).toBeVisible({ timeout: 20_000 });
  await expect(loadError).toContainText(tr("lvLoadError").replace("{ticker}", "QQQ"));
  await expect(page.getByText(NO_LEVELS[lang])).toHaveCount(0);
  await expect(page.getByTestId("levels-rung")).toHaveCount(0);

  // Only a 404 is the empty root, and there is nothing to retry.
  replies["levels:IWM"] = "404";
  await commitRoot(page, "IWM");
  await expect(page.getByText(NO_LEVELS[lang])).toBeVisible({ timeout: 20_000 });
  await expect(loadError).toHaveCount(0);
  await expect(page.getByRole("button", { name: tr("lvRetry"), exact: true })).toHaveCount(0);
  await expectNoPageOverflow(page);
});
