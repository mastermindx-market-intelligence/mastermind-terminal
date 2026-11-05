import { expect, test, type Page, type Route } from "@playwright/test";
import { makeEodT } from "@/components/eodcontext/eodStrings";
import { expectTapTarget } from "./tapTarget";

/**
 * Failure-state truth on the GEX desk's EOD structure belt, from the user's side.
 *
 * The belt reads the off-exchange panel (`darkpool`), the OI-confirmation store (`oiconf`)
 * and two per-root stores (`moves:<root>`, `vol:<root>`). A read that did not land used to
 * reach the belt as the same null as an unpublished store, so a 5xx said "Off-exchange panel
 * unavailable — hasn't published yet" and every failed cell said "not published". Only a 404
 * may say that now. A failed read renders a load error (or, beside cells that did land, a
 * partial error) with a Retry that re-reads in place.
 *
 * The SSE stream is refused for the whole test, as in options-gex-load-failure.spec.ts: the
 * belt's classified reads are what is under test.
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

async function expectNoPageOverflow(page: Page) {
  const doc = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(doc.scroll).toBeLessThanOrEqual(doc.client + 1);
}

test("failed belt reads are load errors with an in-place Retry, never unpublished stores", async ({ page }, testInfo) => {
  const lang = testInfo.project.name === "tablet" ? "zh" : "en";
  const t = makeEodT(lang);
  const replies: Record<string, Reply> = {
    darkpool: "503",
    oiconf: "abort",
    "moves:SPY": "503",
    "vol:SPY": "abort",
  };
  await setLang(page, lang);
  await installFlowReplies(page, replies);

  await page.goto("/options?tab=gex");

  // The off-exchange panel: a failed read, not a panel that has not published.
  const dpError = page.getByTestId("eod-darkpool-load-error");
  await expect(dpError).toBeVisible({ timeout: 45_000 });
  await expect(dpError).toContainText(t("dpLoadError"));
  await expect(page.getByText(t("dpUnavailable"))).toHaveCount(0); // the lie the bug told
  const dpRetry = dpError.getByRole("button", { name: t("retry"), exact: true });
  await expect(dpRetry).toBeVisible({ timeout: 20_000 });
  if (testInfo.project.name !== "desktop") await expectTapTarget(dpRetry, { height: 44 });

  // The structure cells: the ladder cells landed, the failed stores say "could not load".
  const partial = page.getByTestId("eod-structure-partial-error");
  await expect(partial).toBeVisible({ timeout: 20_000 });
  await expect(partial).toContainText(t("beltPartialError"));
  for (const key of ["expMove", "ivPct", "oiConf"]) {
    const cell = page.getByTestId(`eod-cell-${key}`);
    await expect(cell).toContainText(t("cellLoadFailedNote"));
    await expect(cell).not.toContainText(t("cellAbsentNote"));
  }
  const structureRetry = partial.getByRole("button", { name: t("retry"), exact: true });
  await expect(structureRetry).toBeVisible();
  if (testInfo.project.name !== "desktop") await expectTapTarget(structureRetry, { height: 44 });
  await expectNoPageOverflow(page);

  // Retry into healthy stores: the same document recovers, with no reload.
  await page.evaluate(() => { (window as unknown as { __eodSameDocument?: boolean }).__eodSameDocument = true; });
  for (const key of Object.keys(replies)) replies[key] = "fixture";
  await dpRetry.click({ timeout: 20_000 });
  await structureRetry.click({ timeout: 20_000 });
  await expect(dpError).toHaveCount(0, { timeout: 20_000 });
  await expect(partial).toHaveCount(0, { timeout: 20_000 });
  for (const key of ["expMove", "ivPct", "oiConf"]) {
    await expect(page.getByTestId(`eod-cell-${key}`)).not.toContainText(t("cellLoadFailedNote"));
  }
  expect(await page.evaluate(() => (window as unknown as { __eodSameDocument?: boolean }).__eodSameDocument)).toBe(true);
});

test("an unpublished store is shown only on a 404, with nothing to retry", async ({ page }, testInfo) => {
  const lang = testInfo.project.name === "tablet" ? "zh" : "en";
  const t = makeEodT(lang);
  await setLang(page, lang);
  await installFlowReplies(page, { darkpool: "404", oiconf: "404" });

  // Asserted on what the user reads, not on test ids: a 404 said "not published" before this
  // change too, and this test must pass against that code for the same reason it passes now.
  await page.goto("/options?tab=gex");
  await expect(page.getByText(t("dpUnavailable"))).toBeVisible({ timeout: 45_000 });
  const structure = page.getByRole("region", { name: t("beltAria"), exact: true });
  await expect(structure).toContainText(t("cellAbsentNote"), { timeout: 20_000 });
  await expect(structure).not.toContainText(t("cellLoadFailedNote"));
  await expect(page.getByText(t("dpLoadError"))).toHaveCount(0);
  await expect(page.getByText(t("beltPartialError"))).toHaveCount(0);
  await expect(page.getByText(t("beltLoadError"))).toHaveCount(0);
  await expect(page.getByRole("button", { name: t("retry"), exact: true })).toHaveCount(0);
  await expectNoPageOverflow(page);
});
