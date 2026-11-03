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
  await page.addInitScript((language) => localStorage.setItem("mm.lang", language), lang);
  await page.goto("/options?tab=gex&view=strike");

  const ladder = page.locator('[data-tut="gex-ladder"]');
  await expect(ladder.locator("[data-spot-row]")).toBeVisible();
  await expect.poll(() => wholeRows(ladder)).toBeGreaterThanOrEqual(phone ? 4 : 8);
  const pane = page.locator(".obs-gexdesk-left");
  const paneBox = await pane.boundingBox();
  expect(paneBox!.x + paneBox!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);

  const state = page.locator("#gex-state");
  if (info.project.name === "desktop") {
    await expect(state.getByText(t("stateTitle"), { exact: true })).toBeInViewport({ ratio: 1 });
  }
  const sectionNav = page.getByRole("navigation", { name: t("deskSections") });
  await sectionNav.getByRole("button", { name: t("stateTitle") }).focus();
  await page.keyboard.press("Enter");
  await expect(state).toBeFocused();
  await expect(state.getByText(t("stateTitle"), { exact: true })).toBeInViewport({ ratio: 1 });
  const stateHeights = await state.evaluate((rail) => [rail, rail.querySelector(".obs-gex-state")!].map(
    (el) => el.scrollHeight - el.clientHeight,
  ));
  expect(Math.max(...stateHeights)).toBeLessThanOrEqual(1);

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
  await expect(page.locator("#gex-history")).toBeFocused();
  const picker = page.getByRole("combobox", { name: t("sessionPickerAria") });
  await expect(picker.locator('option[value=""]')).toHaveText(t("sessionLive"));
  await picker.selectOption("2026-07-02");
  await expect(pane).toBeFocused();
  await expect(page.getByTestId("gex-archived-chip")).toContainText("2026-07-02");
  await expect(page.locator(".obs-gex-state")).toHaveCount(0);
});

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
