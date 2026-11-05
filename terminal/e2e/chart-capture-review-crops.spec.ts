import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { normalizeDrawings } from "../lib/drawings";
import { isPhoneViewport } from "./phoneChrome";

// Visual evidence for the review capture (E19) — the crops committed under
// `docs/pr-crops/e19-chart-capture-review/`.
//
// OPT-IN, following the e2e/admin-log-crops.spec.ts precedent. It writes into the repo, so it must
// never run as part of `test:e2e:responsive`:
//
//   TERMINAL_E2E_PORT=3299 TERMINAL_CROPS=1 \
//     npx playwright test e2e/chart-capture-review-crops.spec.ts --project=desktop --project=tablet --project=mobile --workers=1
//
// Each viewport writes the open review in EN and ZH, and the saved image itself, so the strip's
// glyphs can be read at the size the file is actually written.

test.skip(!process.env.TERMINAL_CROPS, "Crop generator — set TERMINAL_CROPS=1 to write PR artifacts.");
test.setTimeout(120_000);

const OUT = join(process.cwd(), "docs", "pr-crops", "e19-chart-capture-review");
mkdirSync(OUT, { recursive: true });

const DRAWINGS = [
  { id: "e19-crop-note", kind: "text", source: "user", points: [{ t: "2026-06-15", p: 204 }], color: "#4d82ff", text: "Private note", fontSize: 16 },
  { id: "e19-crop-line", kind: "hline", source: "user", points: [{ t: "2026-06-12", p: 198 }], color: "#26c281", width: 2, dash: "solid" },
];

async function open(page: Page, lang: "en" | "zh") {
  await page.route("**/api/drawings**", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify(route.request().method() === "GET"
      ? { drawings: normalizeDrawings(DRAWINGS), revision: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", schemaVersion: 1 }
      : { ok: true, operationId: route.request().postDataJSON().operationId, revision: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", idempotentReplay: false, superseded: false,
          count: route.request().postDataJSON().drawings.length, schemaVersion: 1 }),
  }));
  await page.addInitScript((language) => {
    localStorage.setItem("mm.lang", language);
    localStorage.setItem("theme", "dark");
    localStorage.setItem("theme_auto", "0");
    (window as unknown as { __cropReady: boolean }).__cropReady = false;
    window.addEventListener("mm:terminal-visual-ready", () => { (window as unknown as { __cropReady: boolean }).__cropReady = true; }, { once: true });
  }, lang);
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __cropReady: boolean }).__cropReady), { timeout: 20_000 }).toBe(true);
  // Let late data (quotes, studies) land so the review describes a settled chart.
  await page.waitForTimeout(1500);
}

async function openReview(page: Page) {
  const dialog = page.getByTestId("chart-capture-dialog");
  if (isPhoneViewport(page)) {
    await page.getByTestId("roller-more").click();
    await page.getByTestId("hub-tile-capture").click();
  } else {
    await expect.poll(async () => {
      if (await dialog.isVisible()) return true;
      try {
        const direct = page.locator('[data-toolbar-action="snapshot"] > button');
        if (await direct.isVisible()) {
          await direct.click({ timeout: 2_000 });
          await page.locator('[data-snapshot-action="review"]').click({ timeout: 2_000 });
        } else {
          const menu = page.locator(".toolbar-overflow-pop.show");
          if (!(await menu.isVisible())) await page.getByTestId("toolbar-more").click({ timeout: 2_000 });
          const back = menu.locator(".toolbar-overflow-back");
          if (await back.isVisible()) await back.click({ timeout: 2_000 });
          await menu.locator('[data-toolbar-menu-action="snapshot"]').click({ timeout: 2_000 });
          await menu.locator('[data-toolbar-menu-action="snapshot-review"]').click({ timeout: 2_000 });
        }
      } catch { /* toolbar remeasured — retry */ }
      return dialog.isVisible();
    }, { timeout: 25_000 }).toBe(true);
  }
  await expect(dialog).toHaveAttribute("data-capture-state", "ready", { timeout: 20_000 });
  await expect.poll(() => dialog.getByTestId("chart-capture-preview").evaluate((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0)).toBe(true);
  return dialog;
}

for (const lang of ["en", "zh"] as const) {
  test(`review capture crops — ${lang}`, async ({ page }, testInfo) => {
    const project = testInfo.project.name;
    await open(page, lang);
    const dialog = await openReview(page);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: join(OUT, `${project}-${lang}-review.png`), animations: "disabled" });

    // The file the viewer actually saves, written beside the crops.
    const downloadPromise = page.waitForEvent("download");
    await dialog.getByTestId("chart-capture-save-image").click();
    const download = await downloadPromise;
    writeFileSync(join(OUT, `${project}-${lang}-saved.png`), readFileSync((await download.path())!));

    if (lang === "en") {
      // The withheld state, driven through the dev-only seam.
      await page.evaluate(() => {
        let flip = false;
        (window as unknown as { __mmCaptureMidHook?: () => void }).__mmCaptureMidHook = () => {
          flip = !flip;
          window.dispatchEvent(new CustomEvent("mm:chart-jump", { detail: { sym: "NVDA", ts: flip ? "2026-01-02" : "2026-06-12" } }));
        };
      });
      await dialog.getByTestId("chart-capture-again").click();
      await expect(dialog).toHaveAttribute("data-capture-state", "withheld", { timeout: 20_000 });
      await page.mouse.move(0, 0);
      await page.screenshot({ path: join(OUT, `${project}-${lang}-withheld.png`), animations: "disabled" });
    }
  });
}
