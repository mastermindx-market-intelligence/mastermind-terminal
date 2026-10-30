import { expect, test, type Page, type Route } from "@playwright/test";
import { makeFlowT } from "@/lib/flowdeskStrings";
import { expectTapTarget } from "./tapTarget";

/**
 * Failure-state truth on the Flow Desk's Chain Heat rail, from the user's side.
 *
 * The rail read `chainheat` through flowGet, which turns every outcome that is not data into
 * null, so a 5xx or a refused request left it on "Loading chain heat…" until the next 45 s
 * poll — and, under a lasting failure, for ever. A read that did not land now renders a
 * load error with a Retry that re-reads in place; only a 404 says nothing is published.
 */

test.setTimeout(90_000);

type Reply = "503" | "abort" | "404" | "fixture";

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
    localStorage.setItem("flowdesk.tutorial.seen", "1");
    document.documentElement.setAttribute("data-lang", l);
  }, lang);
}

async function expectNoPageOverflow(page: Page) {
  const doc = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(doc.scroll).toBeLessThanOrEqual(doc.client + 1);
}

for (const failure of ["503", "abort"] as const) {
  test(`a chain-heat read that ${failure === "503" ? "answers 5xx" : "is refused"} is a load error with Retry, never "loading"`, async ({ page }, testInfo) => {
    const lang = testInfo.project.name === "tablet" ? "zh" : "en";
    const t = makeFlowT(lang);
    const replies: Record<string, Reply> = { chainheat: failure };
    await setLang(page, lang);
    await installFlowReplies(page, replies);

    await page.goto("/options?tab=desk");
    const rail = page.locator('[data-tut="chain-heat"]');
    const loadError = rail.getByTestId("chainheat-load-error");
    await expect(loadError).toBeVisible({ timeout: 45_000 });
    await expect(loadError).toContainText(t("chainHeatError"));
    await expect(rail).not.toContainText(t("chainHeatLoading")); // the lie the bug told
    const retry = loadError.getByRole("button", { name: t("errRetry"), exact: true });
    await expect(retry).toBeVisible({ timeout: 20_000 });
    if (testInfo.project.name !== "desktop") await expectTapTarget(retry, { height: 44 });
    await expectNoPageOverflow(page);

    // Retry into a healthy store: the same document recovers, with no reload.
    await page.evaluate(() => { (window as unknown as { __chainSameDocument?: boolean }).__chainSameDocument = true; });
    replies.chainheat = "fixture";
    await retry.click({ timeout: 20_000 });
    await expect(loadError).toHaveCount(0, { timeout: 20_000 });
    await expect(rail.locator(".obs-fd-chain-row").first()).toBeVisible({ timeout: 20_000 });
    expect(await page.evaluate(() => (window as unknown as { __chainSameDocument?: boolean }).__chainSameDocument)).toBe(true);
  });
}

test("nothing published for the session is shown only on a 404, with nothing to retry", async ({ page }, testInfo) => {
  const lang = testInfo.project.name === "tablet" ? "zh" : "en";
  const t = makeFlowT(lang);
  await setLang(page, lang);
  await installFlowReplies(page, { chainheat: "404" });

  await page.goto("/options?tab=desk");
  const rail = page.locator('[data-tut="chain-heat"]');
  await expect(rail.getByText(t("chainHeatAbsent"))).toBeVisible({ timeout: 45_000 });
  await expect(rail).not.toContainText(t("chainHeatLoading"));
  await expect(rail.getByText(t("chainHeatError"))).toHaveCount(0);
  await expect(rail.getByRole("button", { name: t("errRetry"), exact: true })).toHaveCount(0);
  await expectNoPageOverflow(page);
});
