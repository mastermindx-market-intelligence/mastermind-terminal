import { expect, test, type Page, type Route } from "@playwright/test";
import { makeHeatmapT } from "@/lib/heatmapStrings";
import { expectTapTarget } from "./tapTarget";

/**
 * Failure-state truth on the Heatmap, from the user's side.
 *
 * The board reads the price manifest from /api/flow and then from the static /data copy.
 * Both failures used to collapse into "No data available" — an empty market. Only when
 * every source proved absence (404) may the canvas say that now. A read that did not land
 * renders the load error with a Retry that re-reads both sources in place.
 */

test.setTimeout(90_000);

type Reply = "503" | "abort" | "404" | "pass";

const PRIMARY = "flow:manifest";
const STATIC = "/data/manifest.json";

async function installManifestReplies(page: Page, replies: Record<string, Reply>) {
  const keyOf = (url: URL) => (url.pathname === "/api/flow" ? `flow:${url.searchParams.get("f") ?? ""}` : url.pathname);
  await page.route(
    (url) => (replies[keyOf(url)] ?? "pass") !== "pass",
    async (route: Route) => {
      switch (replies[keyOf(new URL(route.request().url()))]) {
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

test("a failed manifest read is a load error with an in-place Retry, never an empty market", async ({ page }, testInfo) => {
  const lang = testInfo.project.name === "tablet" ? "zh" : "en";
  const t = makeHeatmapT(lang);
  const replies: Record<string, Reply> = { [PRIMARY]: "503", [STATIC]: "abort" };
  await setLang(page, lang);
  await installManifestReplies(page, replies);

  await page.goto("/discover?tab=heatmap");
  const loadError = page.getByTestId("heatmap-load-error");
  await expect(loadError).toBeVisible({ timeout: 45_000 });
  await expect(loadError).toContainText(t("loadErrorTitle"));
  await expect(page.getByText(t("noData"), { exact: true })).toHaveCount(0); // the lie the bug told
  // An unread universe has no breadth reading — not "0 / 0 (0%)".
  await expect(page.getByTestId("heatmap-breadth")).not.toContainText("(0%)");
  const retry = loadError.getByRole("button", { name: t("retry"), exact: true });
  await expect(retry).toBeVisible({ timeout: 20_000 });
  if (testInfo.project.name !== "desktop") await expectTapTarget(retry, { height: 44 });
  await expectNoPageOverflow(page);

  // Retry into healthy sources: the same document recovers, with no reload.
  await page.evaluate(() => { (window as unknown as { __heatmapSameDocument?: boolean }).__heatmapSameDocument = true; });
  replies[PRIMARY] = "pass";
  replies[STATIC] = "pass";
  await retry.click({ timeout: 20_000 });
  await expect(loadError).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByTestId("heatmap-breadth")).toContainText(/\(\d+%\)/, { timeout: 20_000 });
  await expect(page.getByText(t("noData"), { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __heatmapSameDocument?: boolean }).__heatmapSameDocument)).toBe(true);
});

test("the empty market is shown only when every manifest source proved absence", async ({ page }, testInfo) => {
  const lang = testInfo.project.name === "tablet" ? "zh" : "en";
  const t = makeHeatmapT(lang);
  await setLang(page, lang);
  await installManifestReplies(page, { [PRIMARY]: "404", [STATIC]: "404" });

  await page.goto("/discover?tab=heatmap");
  await expect(page.getByText(t("noData"), { exact: true })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId("heatmap-load-error")).toHaveCount(0);
  await expect(page.getByRole("button", { name: t("retry"), exact: true })).toHaveCount(0);
  await expectNoPageOverflow(page);
});
