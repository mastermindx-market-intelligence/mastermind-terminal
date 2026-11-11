import { expect, test } from "@playwright/test";
import { HASH_A, HASH_B, exposureHrefFor, originStrip as strip, prepareSectorJourney as prepare } from "./helpers/optionsR1Journey";
import { makeGexT } from "@/components/gexdesk/gexStrings";
import { exposureMapT } from "@/components/exposure-map/exposureMapStrings";

// Options R1 W1A — one continuous journey: Sector Central holding → Exposure → main
// chart → back to the exact holding. Synthetic sources; this exercises product
// behavior (origin envelope, stepping, return), not provider qualification.
test.setTimeout(120_000);


test("a holding opens its exposure with a bounded sector origin and returns to the exact selection", async ({ page }) => {
  await prepare(page);
  const { href, origin } = await exposureHrefFor(page, "MU");
  expect(href).toMatch(/^\/options\?tab=prism&symbol=MU&view=chart&origin=/);
  expect(origin).toMatchObject({ v: 1, kind: "sector", sector: "xlk", group: "semiconductors", company: "MU", index: 2, count: 14, sort: "source", query: "", asOf: "2026-09-23", contentHash: HASH_A, method: "incumbent_rs_63_21/v1", benchmark: "SPY" });
  expect(String(origin.returnHref)).toMatch(/^\/discover\?tab=sectors&/);
  expect(String(origin.returnHref)).toContain("sectorCompany=MU");
  await expect(page.getByTestId("sector-company-inspector").getByTestId("sector-open-exposure")).toHaveText(/Open options exposure/);
  await page.getByTestId("sector-company-inspector").getByTestId("sector-open-exposure").click();
  await expect(page).toHaveURL(/\/options\?tab=prism&symbol=MU&view=chart&origin=/);
  await expect(strip(page)).toHaveAttribute("data-state", "exact", { timeout: 30_000 });
  await expect(strip(page)).toContainText("From Sector Central");
  await expect(strip(page)).toContainText("Semiconductors");
  await expect(strip(page)).toContainText("3 of 14");
  await expect(strip(page)).toContainText("as of 2026-09-23");
  await expect(strip(page)).toContainText("relative to SPY");
  await expect(page.getByTestId("exposure-map")).toHaveAttribute("data-source-root", "MU");
  const back = strip(page).getByTestId("exposure-origin-back");
  expect(await back.getAttribute("href")).toBe(origin.returnHref);
  await back.click();
  await expect(page).toHaveURL(/\/discover\?tab=sectors&.*sectorCompany=MU/);
  const inspector = page.getByTestId("sector-company-inspector");
  await expect(inspector.getByRole("heading", { name: "MU", exact: true })).toBeVisible();
  await expect(page.locator('[data-company-choice="MU"]')).toBeFocused({ timeout: 15_000 });
});

test("a deep link survives reload and steps the same cohort through Back and Forward", async ({ page }) => {
  await prepare(page);
  const { href } = await exposureHrefFor(page, "MU");
  await page.goto(href);
  await expect(strip(page)).toHaveAttribute("data-state", "exact", { timeout: 30_000 });
  await expect(strip(page)).toContainText("3 of 14");
  await page.reload();
  await expect(strip(page)).toHaveAttribute("data-state", "exact", { timeout: 30_000 });
  await expect(strip(page)).toContainText("3 of 14");
  await expect(strip(page).getByTestId("exposure-origin-prev")).toHaveText(/MCHP/);
  await expect(strip(page).getByTestId("exposure-origin-next")).toHaveText(/NXPI/);
  await strip(page).getByTestId("exposure-origin-next").click();
  await expect(page).toHaveURL(/symbol=NXPI/);
  await expect(strip(page)).toContainText("4 of 14", { timeout: 30_000 });
  await expect(strip(page).getByTestId("exposure-origin-back")).toHaveAttribute("href", /sectorCompany=NXPI/);
  await expect(page.getByTestId("exposure-map")).toHaveAttribute("data-source-root", "NXPI");
  await page.goBack();
  await expect(page).toHaveURL(/symbol=MU/);
  await expect(strip(page)).toContainText("3 of 14", { timeout: 30_000 });
  await expect(page.getByTestId("exposure-map")).toHaveAttribute("data-source-root", "MU");
  await page.goForward();
  await expect(page).toHaveURL(/symbol=NXPI/);
  await expect(strip(page)).toContainText("4 of 14", { timeout: 30_000 });
  await strip(page).getByTestId("exposure-origin-prev").click();
  await expect(strip(page)).toContainText("3 of 14", { timeout: 30_000 });
  await expect(page).toHaveURL(/symbol=MU/);
});

test("a changed sector roster pauses stepping but keeps the way back", async ({ page }) => {
  let hash = HASH_A;
  await prepare(page, { hash: () => hash });
  const { href, origin } = await exposureHrefFor(page, "MU");
  hash = HASH_B;
  await page.goto(href);
  await expect(strip(page)).toHaveAttribute("data-state", "changed", { timeout: 30_000 });
  await expect(strip(page)).toContainText("The sector roster changed since you left.");
  await expect(strip(page).getByTestId("exposure-origin-prev")).toBeDisabled();
  await expect(strip(page).getByTestId("exposure-origin-next")).toBeDisabled();
  await expect(strip(page).getByTestId("exposure-origin-back")).toHaveAttribute("href", String(origin.returnHref));
});

test("an absent options source keeps the origin and the return address", async ({ page }) => {
  await prepare(page, { absent: ["ADI"] });
  const { href, origin } = await exposureHrefFor(page, "ADI");
  await page.goto(href);
  await expect(strip(page)).toHaveAttribute("data-state", "exact", { timeout: 30_000 });
  await expect(strip(page)).toContainText("6 of 14");
  await expect(page.getByTestId("exposure-map")).toHaveAttribute("data-source-root", "ADI");
  await expect(page.getByTestId("exposure-map")).toHaveAttribute("data-source-session", "");
  await expect(strip(page).getByTestId("exposure-origin-back")).toHaveAttribute("href", String(origin.returnHref));
});

test("an unsupported origin schema is ignored without touching the exposure view", async ({ page }) => {
  await prepare(page);
  const { href } = await exposureHrefFor(page, "MU");
  expect(href).toContain("%22v%22%3A1");
  await page.goto(href.replace("%22v%22%3A1", "%22v%22%3A2"));
  await expect(page.getByTestId("exposure-map")).toHaveAttribute("data-source-root", "MU", { timeout: 30_000 });
  await expect(page.getByTestId("exposure-map")).toHaveAttribute("data-chart-ready", "true", { timeout: 30_000 });
  await expect(strip(page)).toHaveCount(0);
});

test("the main chart carries the origin and Return to Exposure brings it back", async ({ page }) => {
  await prepare(page);
  const { href, origin } = await exposureHrefFor(page, "MU");
  await page.goto(href);
  const map = page.getByTestId("exposure-map");
  await expect(map).toHaveAttribute("data-chart-ready", "true", { timeout: 30_000 });
  await expect(strip(page)).toHaveAttribute("data-state", "exact", { timeout: 30_000 });
  await map.getByRole("button", { name: /Largest covered net node/ }).click();
  await page.getByTestId("exposure-node-inspector").getByRole("button", { name: "Open on main chart", exact: true }).click();
  await expect(page).toHaveURL(/\/terminal\?symbol=MU&origin=.*#exposure=/, { timeout: 30_000 });
  const reference = page.getByTestId("exposure-chart-reference");
  await expect(reference).toBeVisible({ timeout: 30_000 });
  await expect(reference.getByTestId("exposure-reference-sector")).toHaveAttribute("href", String(origin.returnHref));
  const returnLink = reference.getByRole("link", { name: "Return to Exposure", exact: true });
  expect(await returnLink.getAttribute("href")).toMatch(/^\/options\?tab=prism&symbol=MU&view=chart&origin=.*#exposure=/);
  await returnLink.click();
  await expect(page).toHaveURL(/\/options\?tab=prism&symbol=MU&view=chart&origin=/);
  await expect(strip(page)).toHaveAttribute("data-state", "exact", { timeout: 30_000 });
  await expect(strip(page)).toContainText("3 of 14");
});


// Cross-feature composition: Sector-origin navigation must not carry an archived
// MU book into NXPI, while Back and a deliberate revisit must consume fresh
// corrected bytes for MU. This is a fixture-only non-merge integration proof.
for (const lang of ["en", "zh"] as const) {
  test(`archived Exposure replay and sector cohort navigation stay source-bound (${lang})`, async ({ page }) => {
    await prepare(page, { lang });
    const archivedDate = "2026-10-16";
    let archiveReads = 0;
    // Keep the existing Sector Central fixture and override only the dated MU
    // archive feeds. A source correction affects the same key on its second read.
    await page.route((url) => url.pathname === "/api/flow" &&
      new URL(url).searchParams.get("f") === "gex_dates:MU", route =>
        route.fulfill({ json: { root: "MU", latest: "2026-10-19", dates: ["2026-10-19", archivedDate] } }));
    await page.route((url) => url.pathname === "/api/flow" &&
      new URL(url).searchParams.get("f") === `gex_at:MU:${archivedDate}`, route => {
        archiveReads++;
        const strike = archiveReads === 1 ? 1070 : 1080;
        return route.fulfill({ json: {
          schema: "options_hub.gex/v1", root: "MU", asof: archivedDate,
          spot_ref: 1071.88, by_strike_full_n: 1,
          by_strike: [{ strike, gamma_net: 50, gamma_call: 60, gamma_put: -10 }],
          by_expiry: [{ exp: "2026-10-23", gamma_net: 50 }],
        } });
      });

    const { href } = await exposureHrefFor(page, "MU");
    await page.goto(href);
    const map = page.getByTestId("exposure-map");
    const origin = strip(page);
    await expect(origin).toHaveAttribute("data-state", "exact", { timeout: 30_000 });
    await expect(map).toHaveAttribute("data-source-root", "MU");
    // Use the same visible exact-values panel on desktop and phone. The
    // ranked-node inspector is intentionally a sheet on compact screens.
    await map.getByRole("button", { name: exposureMapT(lang)("exactValues"), exact: true }).click();
    const stored = map.getByTestId("exposure-stored-snapshots");
    await stored.locator("summary").click();
    const picker = stored.getByRole("combobox", { name: makeGexT(lang)("sessionPickerAria") });
    await expect(picker).toBeVisible();
    await picker.selectOption(archivedDate);
    await expect(map).toHaveAttribute("data-source-session", archivedDate, { timeout: 20_000 });
    await expect(map.locator('[class*="archiveNotice"]')).toContainText(archivedDate);
    // The visible node, not only the request counter, must be source-correct.
    await expect(map.getByRole("button", { name: "1070", exact: true })).toBeVisible();
    expect(archiveReads).toBe(1);

    await origin.getByTestId("exposure-origin-next").click();
    await expect(page).toHaveURL(/symbol=NXPI/);
    await expect(map).toHaveAttribute("data-source-root", "NXPI");
    await expect(map.locator('[class*="archiveNotice"]')).toHaveCount(0);
    await expect(origin).toHaveAttribute("data-state", "exact");
    await expect(origin.getByTestId("exposure-origin-back")).toHaveAttribute("href", /sectorCompany=NXPI/);

    await page.goBack();
    await expect(page).toHaveURL(/symbol=MU/);
    await expect(map).toHaveAttribute("data-source-root", "MU");
    await expect(map.locator('[class*="archiveNotice"]')).toHaveCount(0);
    await expect(origin).toHaveAttribute("data-state", "exact");
    if (await stored.getAttribute("open") === null) await stored.locator("summary").click();
    await picker.selectOption(archivedDate);
    await expect.poll(() => archiveReads, { timeout: 15_000 }).toBe(2);
    await expect(map).toHaveAttribute("data-source-session", archivedDate);
    await expect(map.getByRole("button", { name: "1080", exact: true })).toBeVisible();
    await expect(map.getByRole("button", { name: "1070", exact: true })).toHaveCount(0);
    await expect(origin.getByTestId("exposure-origin-back")).toHaveAttribute("href", /sectorCompany=MU/);
    await origin.getByTestId("exposure-origin-back").click();
    await expect(page).toHaveURL(/\/discover\?tab=sectors&.*sectorCompany=MU/);
  });
}
