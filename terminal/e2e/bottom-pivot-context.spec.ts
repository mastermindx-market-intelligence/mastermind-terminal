import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import fixture from "../lib/__tests__/fixtures/bottom-pivot/context.json";

type Fixture = typeof fixture;
const FIXED_TIME = "2026-11-05T22:00:00Z";
const fresh = (): Fixture => structuredClone(fixture);
const cardOn = (page: Page) => page.getByTestId("bottom-pivot-context");

async function prepare(page: Page, body: unknown = fresh(), status = 200) {
  await page.clock.setFixedTime(new Date(FIXED_TIME));
  let requests = 0;
  await page.route(/\/api\/nw\?f=bottom_sensors$/, async route => {
    requests += 1;
    await route.fulfill({ status, json: body });
  });
  await page.goto("/analysis?symbol=AAPL&page=technicals");
  await expect(cardOn(page)).toBeVisible({ timeout: 45_000 });
  expect(requests).toBe(0);
  return () => requests;
}
async function renderVariant(page: Page, lang: "en" | "zh", theme: "dark") {
  // Existing fixture styling seam, not a new production theme or auth control.
  await page.evaluate(({ lang, theme }) => {
    localStorage.setItem("mm.lang", lang);
    document.documentElement.setAttribute("data-lang", lang);
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    window.dispatchEvent(new CustomEvent("mm:lang"));
    document.documentElement.setAttribute("data-theme", theme);
  }, { lang, theme });
  await expect(cardOn(page).getByRole("heading")).toHaveText(lang === "zh" ? "底部转折证据" : "Bottom-pivot evidence");
}
async function capture(page: Page, info: TestInfo, variant: string) {
  const name = `${info.project.name}-${variant}`;
  const card = cardOn(page);
  if ((page.viewportSize()?.width ?? 0) > 600) await card.screenshot({ path: info.outputPath(`${name}-card.png`) });
  await page.screenshot({ path: info.outputPath(`${name}-viewport.png`) });
  const geometry = await card.evaluate(el => {
    const r = el.getBoundingClientRect();
    return { width: r.width, height: r.height, background: getComputedStyle(el).backgroundColor,
      theme: document.documentElement.getAttribute("data-theme"), lang: document.documentElement.getAttribute("data-lang"),
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  expect(geometry.documentOverflow).toBeLessThanOrEqual(1);
  const footer = card.locator("p").last();
  await footer.evaluate(el => el.scrollIntoView({ block: "center" }));
  const isFooterUncovered = () => footer.evaluate(el => {
    const r = el.getBoundingClientRect();
    const front = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return front === el || (front !== null && el.contains(front));
  });
  // The incumbent .fin-body uses native smooth scrolling: assert the settled
  // frontmost element, not an intermediate animation frame. No CSS is overridden.
  await expect.poll(isFooterUncovered, { timeout: 5_000 }).toBe(true);
  const footerUncovered = await isFooterUncovered();
  await page.screenshot({ path: info.outputPath(`${name}-footer-viewport.png`) });
  await writeFile(info.outputPath(`${name}-receipt.json`), JSON.stringify({ fixture: true, production: false,
    route: "/analysis?symbol=AAPL&page=technicals", viewport: page.viewportSize(), variant, geometry,
    fixedClock: FIXED_TIME, footerUncovered, themePolicy: "native-dark-only: DEC-TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06", source: "Python-composer fixture from Macro PR10785; browser route intercepted", requestsOnStartup: 0 }, null, 2));
}

// The active Terminal design ruling forbids invented page-local light CSS.
const theme = "dark";
for (const lang of ["en", "zh"] as const) {
    test(`daily pivot on demand ${theme} ${lang}`, async ({ page }, info) => {
      const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
      const requests = await prepare(page);
      await renderVariant(page, lang, theme);
      const card = cardOn(page), toggle = card.locator("button[aria-expanded]");
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await toggle.focus(); await page.keyboard.press("Enter");
      await expect(card).toHaveAttribute("data-state", "evidence");
      await expect(toggle).toBeFocused();
      await expect(card.locator('[data-field="coiled_fire"]')).toHaveAttribute("data-evidence-state", "observed");
      await expect(card.locator('[data-field="above200"] dd')).toHaveText(lang === "zh" ? "否" : "No");
      expect(requests()).toBe(1);
      const focus = await toggle.evaluate(el => ({ style: getComputedStyle(el).outlineStyle, width: getComputedStyle(el).outlineWidth }));
      expect(focus.style).not.toBe("none"); expect(Number.parseFloat(focus.width)).toBeGreaterThanOrEqual(2);
      const order = await card.evaluate(el => ({
        caveat: el.querySelector('[data-testid="pivot-authority-limit"]')!.getBoundingClientRect().top,
        facts: el.querySelector('[data-field]')!.getBoundingClientRect().top,
      }));
      expect(order.caveat).toBeLessThan(order.facts);
      await capture(page, info, `${theme}-${lang}-observed`);
      await card.locator("summary").click();
      await expect(card.locator("[data-source-field]")).toHaveCount(13);
      await expect(card.locator("[data-source-field]").first()).toBeVisible();
      await toggle.click(); await expect(card).toHaveAttribute("data-state", "closed");
      expect(requests()).toBe(1); expect(errors).toEqual([]);
    });
}

test("stale original dates are not refreshed by a fresh envelope", async ({ page }, info) => {
  const raw = fresh();
  for (const row of raw.rows[0].pivot_context.evidence) Object.assign(row, { as_of: "2026-10-20", available_at: "2026-10-20T20:00:00Z" });
  await prepare(page, raw); await cardOn(page).locator("button[aria-expanded]").click();
  await expect(cardOn(page)).toHaveAttribute("data-state", "evidence");
  await expect(cardOn(page).locator('[data-field="coiled_fire"]')).toHaveAttribute("data-evidence-state", "stale");
  await expect(cardOn(page)).toContainText("No usable observations");
  await capture(page, info, "stale-source");
});

test("partial and conflicting evidence never becomes an all-clear", async ({ page }, info) => {
  const raw = fresh();
  Object.assign(raw.rows[0].pivot_context.evidence.find(row => row.field === "knife_score")!, { state: "conflict", value: null });
  Object.assign(raw.rows[0].pivot_context.evidence.find(row => row.field === "above200")!, { state: "missing", value: null });
  await prepare(page, raw); await cardOn(page).locator("button[aria-expanded]").click();
  await expect(cardOn(page)).toContainText("Partial evidence");
  await expect(cardOn(page).locator('[data-field="knife_score"] dd')).toHaveText("Conflicting records");
  await expect(cardOn(page).locator('[data-field="above200"] dd')).toHaveText("Missing");
  await capture(page, info, "partial-conflict");
});

test("historical issuance is visibly not current evidence", async ({ page }, info) => {
  const raw = fresh(); raw.rows[0].pivot_context.evidence_mode = "as_issued";
  await prepare(page, raw); await cardOn(page).locator("button[aria-expanded]").click();
  await expect(cardOn(page)).toContainText("Historical as-issued reading");
  await expect(cardOn(page)).not.toContainText("Current-snapshot reading");
  await capture(page, info, "historical");
});

for (const [status, state] of [[401, "signIn"], [403, "entitled"], [503, "failed"]] as const) {
  test(`source refusal ${status} has no invented evidence`, async ({ page }, info) => {
    const requests = await prepare(page, { error: "synthetic refusal" }, status);
    await cardOn(page).locator("button[aria-expanded]").click();
    await expect(cardOn(page)).toHaveAttribute("data-state", state);
    await expect(cardOn(page).locator("[data-field]")).toHaveCount(0);
    if (status !== 503) await expect(cardOn(page).getByRole("button", { name: "Refresh evidence" })).toHaveCount(0);
    expect(requests()).toBe(1); await capture(page, info, `refusal-${status}`);
  });
}
