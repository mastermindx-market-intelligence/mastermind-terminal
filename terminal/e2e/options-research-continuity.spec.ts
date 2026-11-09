import { expect, test } from "@playwright/test";
import { exposureHrefFor, prepareSectorJourney } from "./helpers/optionsR1Journey";
import { CORRECTED_HASH, ResearchStore, SAVED_HASH, digest, routeResearch } from "./helpers/optionsR1Research";

// Options R1 W2C — "Save to research" from the chart reference, then the same revision reopened after a reload, from an
// independent browser context with its own storage, against a corrected source, after a revoked read and after an
// edited thesis. Synthetic fixtures on the local-preview owner: product proof of references and digests, not market,
// backtest or auth-provider proof. A viewport alone is never persistence proof; every reopen is a fresh read.
const MATCHES = "Matches the saved source", CORRECTED = "Source corrected since this revision";
test.setTimeout(300_000);

test("saved research keeps the Options references and reports each source's state on every reopen", async ({ page, context, browser }, testInfo) => {
  const store = new ResearchStore();
  await routeResearch(context, store);
  await prepareSectorJourney(page, { hash: () => SAVED_HASH });
  const { href } = await exposureHrefFor(page, "MU");
  await page.goto(href);
  const map = page.getByTestId("exposure-map");
  await expect(map).toHaveAttribute("data-chart-ready", "true", { timeout: 30_000 });
  await map.getByRole("button", { name: /Largest covered net node/ }).click();
  await page.getByTestId("exposure-node-inspector").getByRole("button", { name: "Open on main chart", exact: true }).click();
  await expect(page).toHaveURL(/\/terminal\?symbol=MU&origin=.*#exposure=/, { timeout: 30_000 });
  const reference = page.getByTestId("exposure-chart-reference");
  await expect(reference).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  const save = reference.getByTestId("exposure-reference-save");
  const saveHref = (await save.getAttribute("href"))!;
  expect(saveHref).toMatch(/^\/analysis\?view=investigations&symbol=MU&origin=.*#exposure=/);
  const request = JSON.parse(decodeURIComponent(saveHref.slice(saveHref.indexOf("#exposure=") + "#exposure=".length))) as { root: string; session: string; strike: number; fingerprint: string };
  await save.click();
  await expect(page).toHaveURL(/\/analysis\?view=investigations&symbol=MU/, { timeout: 30_000 });

  // The draft opens with both references already named; nothing is saved until the question is.
  const card = page.getByTestId("options-evidence");
  const requestItem = card.locator('[data-options-ref="exposure_chart_request"]'), originItem = card.locator('[data-options-ref="sector_origin"]');
  await expect(card.locator("[data-options-ref]")).toHaveCount(2);
  await expect(requestItem).toContainText(`${request.root}/${request.session}/${request.strike}/`);
  await expect(requestItem).toContainText(request.fingerprint);
  await expect(originItem).toContainText("xlk/semiconductors/MU");
  await expect(originItem).toContainText(digest(SAVED_HASH));
  expect(store.commands).toHaveLength(0);
  await page.getByLabel("Title", { exact: true }).fill("MU dealer positioning into expiry");
  await page.getByLabel("Research question", { exact: true }).fill("Does the largest covered net node hold through the next session?");
  await page.getByRole("button", { name: "Save research", exact: true }).click();
  await expect(page.getByText("Saved · Revision 1")).toBeVisible({ timeout: 30_000 });
  expect(store.commands).toHaveLength(1);
  const savedRefs = store.commands[0].manifest.evidence_refs;
  expect(savedRefs).toHaveLength(2);
  expect(savedRefs.find(ref => ref.object_type === "exposure_chart_request")).toMatchObject({ owner: "terminal.options_exposure", mode: "pinned", fingerprint: request.fingerprint });
  expect(savedRefs.find(ref => ref.object_type === "sector_origin")).toMatchObject({ owner: "terminal.options_exposure", mode: "pinned", object_id: "xlk/semiconductors/MU", version_ref: "exposure_origin.v1@2026-09-23", fingerprint: digest(SAVED_HASH) });
  const states = card.getByTestId("options-evidence-state");
  await expect(states).toHaveCount(2, { timeout: 30_000 });
  await expect(states.nth(0)).toHaveText(MATCHES); await expect(states.nth(1)).toHaveText(MATCHES);
  await expect(requestItem.getByRole("link", { name: "Open this exposure read →" })).toHaveAttribute("href", /^\/terminal\?symbol=MU#exposure=/);
  const revisionUrl = page.url();
  expect(revisionUrl).toMatch(/\/analysis\?view=investigations&investigation=[^&]+&revision=1$/);
  const id = new URL(revisionUrl).searchParams.get("investigation")!;
  const noOverflow = async (target: typeof page) => {
    const width = await target.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(width).toBeLessThanOrEqual(1);
  };
  await noOverflow(page);
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath(`research-saved-${testInfo.project.name}.png`), fullPage: true });

  // Reload: the same revision, re-read, not remembered.
  await page.reload();
  await expect(page.getByText("Saved · Revision 1")).toBeVisible({ timeout: 30_000 });
  await expect(states).toHaveCount(2, { timeout: 30_000 });
  for (const state of await states.all()) await expect(state).toHaveText(MATCHES);

  const { viewport, hasTouch, isMobile, baseURL, deviceScaleFactor, userAgent } = testInfo.project.use;
  const fresh = async (hash: string, access: "granted" | "revoked" = "granted") => {
    const other = await browser.newContext({ viewport: viewport ?? undefined, hasTouch, isMobile, baseURL, deviceScaleFactor, userAgent });
    await routeResearch(other, store, access);
    const otherPage = await other.newPage();
    await prepareSectorJourney(otherPage, { hash: () => hash });
    return { other, otherPage };
  };

  // An independent context with its own storage reopens the exact revision by address and reads the same states.
  {
    const { other, otherPage } = await fresh(SAVED_HASH);
    await otherPage.goto(revisionUrl);
    await expect(otherPage.getByText("Saved · Revision 1")).toBeVisible({ timeout: 30_000 });
    const otherStates = otherPage.getByTestId("options-evidence").getByTestId("options-evidence-state");
    await expect(otherStates).toHaveCount(2, { timeout: 30_000 });
    for (const state of await otherStates.all()) await expect(state).toHaveText(MATCHES);
    await noOverflow(otherPage);
    await other.close();
  }

  // A corrected source: the saved digest stays; the current one is shown beside it. The other reference still matches.
  {
    const { other, otherPage } = await fresh(CORRECTED_HASH);
    await otherPage.goto(revisionUrl);
    const otherCard = otherPage.getByTestId("options-evidence");
    const origin = otherCard.locator('[data-options-ref="sector_origin"]');
    await expect(origin.getByTestId("options-evidence-state")).toHaveText(CORRECTED, { timeout: 30_000 });
    await expect(origin).toContainText(digest(SAVED_HASH));
    await expect(origin).toContainText(digest(CORRECTED_HASH));
    await expect(otherCard.locator('[data-options-ref="exposure_chart_request"]').getByTestId("options-evidence-state")).toHaveText(MATCHES);
    expect(store.records.get(id)![0].manifest.evidence_refs).toEqual(savedRefs);
    await noOverflow(otherPage);
    await otherCard.scrollIntoViewIfNeeded();
    await otherPage.screenshot({ path: testInfo.outputPath(`research-corrected-${testInfo.project.name}.png`), fullPage: true });
    await other.close();
  }

  // A revoked read is refused with an explanation and a way back in; nothing saved is shown or changed.
  {
    const { other, otherPage } = await fresh(SAVED_HASH, "revoked");
    await otherPage.goto(revisionUrl);
    await expect(otherPage.getByText("Sign in again to open saved research.")).toBeVisible({ timeout: 30_000 });
    await expect(otherPage.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
    await expect(otherPage.getByTestId("options-evidence")).toHaveCount(0);
    expect(store.records.get(id)).toHaveLength(1);
    await other.close();
  }

  // An edited thesis is a new immutable revision that retains the same references and digests.
  await page.getByRole("button", { name: "Edit saved question", exact: true }).click();
  await page.getByLabel("Research question", { exact: true }).fill("Does the largest covered net node hold through the next two sessions?");
  await page.getByRole("button", { name: "Save research", exact: true }).click();
  await expect(page.getByText("Saved · Revision 2")).toBeVisible({ timeout: 30_000 });
  expect(store.commands).toHaveLength(2);
  expect(store.commands[1].expected_revision).toBe(1);
  expect(store.commands[1].manifest.evidence_refs).toEqual(savedRefs);
  await expect(states).toHaveCount(2, { timeout: 30_000 });
  for (const state of await states.all()) await expect(state).toHaveText(MATCHES);
  await page.getByRole("button", { name: "Previous revision", exact: true }).click();
  await expect(page.getByText("Saved · Revision 1")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("main")).toContainText("Does the largest covered net node hold through the next session?");
  await expect(states).toHaveCount(2, { timeout: 30_000 });
  await noOverflow(page);
});
