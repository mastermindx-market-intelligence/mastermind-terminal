import { expect, test, type Locator } from "@playwright/test";
import { makeGexT } from "@/components/gexdesk/gexStrings";

// IntersectionObserver clips against the shell, the desk and the table body. A row can
// have a nonzero box (or fit inside the document width) and still be entirely behind a panel.
async function wholeRows(ladder: Locator) {
  return ladder.locator("[data-strike]").evaluateAll((rows) =>
    new Promise<number>((resolve) => {
      if (rows.length === 0) return resolve(0);
      const observer = new IntersectionObserver((entries) => {
        observer.disconnect();
        resolve(entries.filter((entry) => entry.intersectionRatio >= 0.99).length);
      }, { threshold: 0.99 });
      rows.forEach((row) => observer.observe(row));
    }),
  );
}

test("Exposure opens on usable strikes and reaches Market State and history", async ({ page }, info) => {
  const phone = info.project.name === "mobile";
  const lang = info.project.name === "tablet" ? "zh" : "en";
  const t = makeGexT(lang);
  await page.addInitScript(({ language, theme }) => {
    localStorage.setItem("mm.lang", language);
    localStorage.setItem("theme", theme);
    localStorage.setItem("theme_auto", "0");
  }, { language: lang, theme: "dark" });
  await page.goto("/options?tab=gex&view=strike");

  const ladder = page.locator('[data-tut="gex-ladder"]');
  await expect(ladder.locator("[data-spot-row]")).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => wholeRows(ladder)).toBeGreaterThanOrEqual(phone ? 4 : 8);
  const pane = page.locator(".obs-gexdesk-left");
  const paneBox = await pane.boundingBox();
  expect(paneBox!.x + paneBox!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);

  const state = page.locator("#gex-state");
  if (info.project.name === "desktop") {
    await expect(state.getByText(t("stateTitle"), { exact: true })).toBeInViewport({ ratio: 1 });
  }
  await page.screenshot({ path: info.outputPath("exposure-entry.png"), fullPage: false });
  const levels = page.getByTestId("gex-snapshot-levels");
  await expect(levels).not.toHaveAttribute("open", "");
  await expect(levels.locator('[data-tut="gex-summary"]')).not.toBeVisible();
  expect(await levels.evaluate((el) => {
    const body = document.querySelector(".obs-gexdesk-body")!;
    const history = document.querySelector("#gex-history")!;
    return Boolean(body.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) &&
      Boolean(el.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);
  const strikeHeight = await ladder.locator(".obs-scroll").evaluate((el) => el.clientHeight);
  await levels.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(levels.locator('[data-tut="gex-summary"]')).toBeVisible();
  expect(await ladder.locator(".obs-scroll").evaluate((el) => el.clientHeight)).toBe(strikeHeight);
  await page.keyboard.press("Enter");
  await expect(levels).not.toHaveAttribute("open", "");

  const sectionNav = page.getByRole("navigation", { name: t("deskSections") });
  await sectionNav.getByRole("button", { name: t("stateTitle") }).focus();
  await page.keyboard.press("Enter");
  await expect(state).toBeFocused();
  await expect(state.getByText(t("stateTitle"), { exact: true })).toBeInViewport({ ratio: 1 });
  const stateHeights = await state.evaluate((rail) => [rail, rail.querySelector(".obs-gex-state")!].map(
    (el) => el.scrollHeight - el.clientHeight,
  ));
  expect(Math.max(...stateHeights)).toBeLessThanOrEqual(1);

  const stateDetails = state.getByTestId("gex-state-details");
  await expect(stateDetails).not.toHaveAttribute("open", "");
  await expect(state.locator(".obs-gex-state .obs-note")).toBeVisible();
  await expect(state.locator(".obs-gex-state .obs-note")).toContainText(t("passportIndex"));
  await expect(state.getByText(t("stateWhatIf"), { exact: true })).not.toBeVisible();
  await stateDetails.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(state.getByText(t("stateWhatIf"), { exact: true })).toBeVisible();
  await expect(stateDetails).toContainText(t("statePinProbTip"));
  await page.screenshot({ path: info.outputPath("market-state-details.png"), fullPage: false });
  const passport = state.locator(".obs-gex-state .obs-note");
  // Center the entire passport in the desk scroll owner; a nearest-edge scroll
  // can leave its rounded border a fractional pixel under the fixed footer.
  await passport.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await expect(passport).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: info.outputPath("market-state-passport.png"), fullPage: false });
  await stateDetails.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(stateDetails).not.toHaveAttribute("open", "");
  await expect(state.locator(".obs-gex-state .obs-note")).toBeVisible();

  const range = ladder.getByRole("group", { name: t("rangePresetAria") });
  await range.getByRole("button", { name: "±5%" }).click();
  const drawer = page.getByRole("button", { name: new RegExp(t("xdrawerTitle")) });
  const before = await ladder.locator(".obs-scroll").evaluate((el) => el.clientHeight);
  await drawer.click();
  await expect(drawer).toHaveAttribute("aria-expanded", "true");
  expect(await ladder.locator(".obs-scroll").evaluate((el) => el.clientHeight)).toBe(before);
  await drawer.click();
  await expect(range.getByRole("button", { name: "±5%" })).toHaveAttribute("aria-pressed", "true");

  await sectionNav.getByRole("button", { name: t("deskHistory") }).click();
  const history = page.locator("#gex-history");
  await expect(history).toBeFocused();
  const picker = page.getByRole("combobox", { name: t("sessionPickerAria") });
  await page.mouse.move(0, 0);
  await page.screenshot({ path: info.outputPath("history-controls.png"), fullPage: false });
  const historyBox = await history.locator(".obs-gex-history").boundingBox();
  expect(historyBox!.x + historyBox!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  await expect(picker).toBeInViewport({ ratio: 1 });
  await expect(picker.locator('option[value=""]')).toHaveText(t("sessionLive"));
  await picker.selectOption("2026-07-02");
  await expect(pane).toBeFocused();
  await expect(page.getByTestId("gex-archived-chip")).toContainText("2026-07-02");
  await expect(page.locator(".obs-gex-state")).toHaveCount(0);
});

// Protected-main compatibility: a deliberately re-opened archived book must await
// a new response, not merely display a 25-second cached result while revalidating
// invisibly. A changed source for the same date must be observable by the reader.
for (const lang of ["en", "zh"] as const) {
  test(`revisiting an archived Exposure book consumes its corrected source (${lang})`, async ({ page }) => {
    await page.addInitScript((locale) => localStorage.setItem("mm.lang", locale), lang);
    let datedReads = 0;
    await page.route((url) => url.pathname === "/api/flow" &&
      url.searchParams.get("f") === "gex_at:SPY:2026-07-02", async (route) => {
      datedReads += 1;
      const strike = datedReads === 1 ? 756 : 757;
      await route.fulfill({ json: {
        schema: "options_hub.gex/v1", root: "SPY", asof: "2026-07-02",
        spot_ref: 756, by_strike_full_n: 1,
        by_strike: [{ strike, gamma_net: 45, gamma_call: 55, gamma_put: -10 }],
        by_expiry: [],
      } });
    });
    await page.goto("/options?tab=gex&view=strike&symbol=SPY");
    const picker = page.getByRole("combobox", { name: makeGexT(lang)("sessionPickerAria") });
    await expect(picker).toBeVisible();
    await picker.selectOption("2026-07-02");
    await expect(page.getByTestId("gex-archived-chip")).toContainText("2026-07-02");
    await expect(page.locator('[data-tut="gex-ladder"] [data-strike="756"]')).toHaveCount(1);
    expect(datedReads).toBe(1);

    await picker.selectOption("");
    await expect(page.getByTestId("gex-archived-chip")).toHaveCount(0);
    await picker.selectOption("2026-07-02");
    await expect.poll(() => datedReads, { timeout: 15_000 }).toBe(2);
    await expect(page.locator('[data-tut="gex-ladder"] [data-strike="757"]')).toHaveCount(1);
    await expect(page.locator('[data-tut="gex-ladder"] [data-strike="756"]')).toHaveCount(0);
    await expect(page.getByTestId("gex-archived-chip")).toContainText("2026-07-02");
    // The archived pane must never advertise present-session Market State.
    await expect(page.locator(".obs-gex-state")).toHaveCount(0);
  });
}

test("a sparse GOOGL book keeps the page in place and identifies older history", async ({ page }) => {
  // Synthetic mismatched clocks reproduce the user's screen. Only one strike is published.
  await page.route((url) => url.pathname === "/api/flow/stream", (route) => route.abort());
  await page.route((url) => url.pathname === "/api/flow" && url.searchParams.get("f") === "gex:GOOGL",
    (route) => route.fulfill({ json: {
      schema: "options_hub.gex/v1", root: "GOOGL", asof: "2026-10-29", spot_ref: 280,
      by_strike: [{ strike: 280, gamma_net: -4, gamma_call: 2, gamma_put: -6 }],
      by_expiry: [], history: [
        { date: "2026-07-30", regime: "long", net_gex_bn: 0.2 },
        { date: "2026-07-31", regime: "long", net_gex_bn: 0.1 },
      ],
    } }),
  );
  await page.route((url) => url.pathname === "/api/flow" && url.searchParams.get("f") === "gexstate:GOOGL",
    (route) => route.fulfill({ json: {
      schema: "options_structure.gex_state/v1", root: "GOOGL", asof: "2026-11-02",
      gamma_regime: "CASCADE", stability_pct: null, net_gex_bn: -0.004,
    } }),
  );
  await page.goto("/options?tab=gex&view=strike&symbol=GOOGL");
  const desk = page.locator(".obs-gexdesk-body").locator("..");
  await expect(desk.locator("[data-strike]")).toHaveCount(1);
  await expect(page.getByRole("combobox", { name: "Ticker", exact: true })).toBeInViewport({ ratio: 1 });
  const scroll = await desk.evaluate((el) => [el.scrollTop, document.scrollingElement?.scrollTop ?? 0]);
  expect(scroll).toEqual([0, 0]);
  const state = page.locator("#gex-state");
  await expect(state.locator("time")).toHaveText("Regime as of 2026-11-02");
  await expect(state.locator('[data-score-state="unavailable"]')).toBeVisible();
  await page.getByRole("navigation", { name: "Exposure sections" }).getByRole("button", { name: "History" }).click();
  const history = page.locator(".obs-gex-history-readout");
  await expect(history).toContainText("2026-07-31");
  await expect(history.getByText(/^now$/i)).toHaveCount(0);
  await expect(history.getByRole("button", { name: "Load full ladder" })).toBeVisible();
});
