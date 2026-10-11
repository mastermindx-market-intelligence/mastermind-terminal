import { expect, test, type Page, type Route } from "@playwright/test";
import { makeHeatmapT } from "@/lib/heatmapStrings";
import { expectTapTarget } from "./tapTarget";

/**
 * Failure-state truth on the Heatmap's flow layer, live quotes and search, from the user's side.
 *
 * The flow layer reads the flow index from /api/flow and then from the static /data copy.
 * Every failure used to collapse into "Flow data unavailable" — on the price layer too. Now:
 *   - a read that did not land renders a load error with a Retry that re-reads both sources;
 *   - both sources answering 404 is published absence, with nothing to retry;
 *   - the route refusing (403) with no public copy is an access answer, not a failure.
 * The live-quote overlay stops calling values "live" when the quote read did not land, and a
 * search that hides every tile says so instead of "No data available".
 */

test.setTimeout(90_000);

type Reply = "503" | "abort" | "404" | "403" | "pass";

const FLOW_PRIMARY = "flow:flow_idx";
const FLOW_STATIC = "/data/flow_idx.json";
const QUOTE = "/api/quote";

async function installReplies(page: Page, replies: Record<string, Reply>) {
  const keyOf = (url: URL) => (url.pathname === "/api/flow" ? `flow:${url.searchParams.get("f") ?? ""}` : url.pathname);
  await page.route(
    (url) => (replies[keyOf(url)] ?? "pass") !== "pass",
    async (route: Route) => {
      switch (replies[keyOf(new URL(route.request().url()))]) {
        case "503": return route.fulfill({ status: 503, json: { error: "feed unavailable" } });
        case "404": return route.fulfill({ status: 404, json: { error: "not published" } });
        case "403": return route.fulfill({ status: 403, json: { error: "forbidden" } });
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

async function openFlowLayer(page: Page, t: ReturnType<typeof makeHeatmapT>) {
  await page.goto("/discover?tab=heatmap");
  await expect(page.getByTestId("heatmap-breadth")).toContainText(/\(\d+%\)/, { timeout: 45_000 });
  await page.getByRole("button", { name: t("layerFlow"), exact: true }).first().click({ timeout: 20_000 });
}

test("a failed flow-index read is a load error with an in-place Retry, never missing flow data", async ({ page }, testInfo) => {
  const lang = testInfo.project.name === "tablet" ? "zh" : "en";
  const t = makeHeatmapT(lang);
  const replies: Record<string, Reply> = { [FLOW_PRIMARY]: "503", [FLOW_STATIC]: "abort" };
  await setLang(page, lang);
  await installReplies(page, replies);
  await openFlowLayer(page, t);

  const loadError = page.getByTestId("heatmap-flow-load-error");
  await expect(loadError).toBeVisible({ timeout: 20_000 });
  await expect(loadError).toContainText(t("flowLoadError"));
  await expect(page.getByText(t("noFlowData"))).toHaveCount(0); // the lie the bug told
  const retry = loadError.getByRole("button", { name: t("retry"), exact: true });
  await expect(retry).toBeVisible();
  if (testInfo.project.name !== "desktop") await expectTapTarget(retry, { height: 44 });
  await expectNoPageOverflow(page);

  // Retry into healthy sources: the same document recovers, with no reload.
  await page.evaluate(() => { (window as unknown as { __flowSameDocument?: boolean }).__flowSameDocument = true; });
  replies[FLOW_PRIMARY] = "pass";
  replies[FLOW_STATIC] = "pass";
  await retry.click({ timeout: 20_000 });
  await expect(loadError).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText(t("toneSoftNote"))).toBeVisible({ timeout: 20_000 });
  expect(await page.evaluate(() => (window as unknown as { __flowSameDocument?: boolean }).__flowSameDocument)).toBe(true);
});

test("missing flow data is shown only when both sources answered 404, with nothing to retry", async ({ page }, testInfo) => {
  const lang = testInfo.project.name === "tablet" ? "zh" : "en";
  const t = makeHeatmapT(lang);
  await setLang(page, lang);
  await installReplies(page, { [FLOW_PRIMARY]: "404", [FLOW_STATIC]: "404" });
  await openFlowLayer(page, t);

  // Asserted on what the user reads: a 404 said "Flow data unavailable" before this change too.
  await expect(page.getByText(t("noFlowData"))).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(t("flowLoadError"))).toHaveCount(0);
  await expect(page.getByRole("button", { name: t("retry"), exact: true })).toHaveCount(0);
  await expectNoPageOverflow(page);
});

test("a refused flow route with no public copy is an access answer, not a failure", async ({ page }, testInfo) => {
  const lang = testInfo.project.name === "tablet" ? "zh" : "en";
  const t = makeHeatmapT(lang);
  await setLang(page, lang);
  await installReplies(page, { [FLOW_PRIMARY]: "403", [FLOW_STATIC]: "404" });
  await openFlowLayer(page, t);

  await expect(page.getByText(t("flowAuth"))).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(t("flowLoadError"))).toHaveCount(0);
  await expect(page.getByText(t("noFlowData"))).toHaveCount(0);
  await expectNoPageOverflow(page);
});

test("live quotes that did not load are never called live", async ({ page }, testInfo) => {
  const lang = testInfo.project.name === "tablet" ? "zh" : "en";
  const t = makeHeatmapT(lang);
  await setLang(page, lang);
  await installReplies(page, { [QUOTE]: "503" });

  await page.goto("/discover?tab=heatmap");
  const note = page.getByTestId("heatmap-live-note");
  await expect(note).toHaveAttribute("data-state", "failed", { timeout: 45_000 });
  await expect(note).toContainText(t("liveFailed"));
  await expect(page.getByTestId("heatmap-breadth")).not.toContainText(t("liveNote").split("{n}")[0]);
  await expectNoPageOverflow(page);
});

test("a search that hides every tile says so and offers the way back", async ({ page }, testInfo) => {
  const lang = testInfo.project.name === "tablet" ? "zh" : "en";
  const t = makeHeatmapT(lang);
  await setLang(page, lang);

  await page.goto("/discover?tab=heatmap");
  await expect(page.getByTestId("heatmap-breadth")).toContainText(/\(\d+%\)/, { timeout: 45_000 });
  const search = page.getByRole("textbox", { name: t("searchPlaceholder") });
  await search.fill("zzzzq", { timeout: 20_000 });
  const noMatch = page.getByTestId("heatmap-no-match");
  await expect(noMatch).toBeVisible({ timeout: 20_000 });
  await expect(noMatch).toContainText(t("noMatch").replace("{q}", "zzzzq"));
  await expect(page.getByText(t("noData"), { exact: true })).toHaveCount(0); // the lie the bug told
  const clear = noMatch.getByRole("button", { name: t("clearSearch"), exact: true });
  if (testInfo.project.name !== "desktop") await expectTapTarget(clear, { height: 44 });
  await expectNoPageOverflow(page);

  await clear.click({ timeout: 20_000 });
  await expect(noMatch).toHaveCount(0, { timeout: 20_000 });
  await expect(search).toHaveValue("");
});
