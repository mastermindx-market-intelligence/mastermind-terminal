import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { dataRows, moveSelect, openPanel, openScreener, prepare, routeManifest, secondDevice } from "./smartScreensFixture";

// Visual evidence for E04 smart screens — the crops committed under `docs/pr-crops/e04-smart-screens/`.
//
// OPT-IN, following the e2e/admin-log-crops.spec.ts precedent. It writes into the repo, so it must
// never run as part of `test:e2e:responsive`:
//
//   TERMINAL_E2E_PORT=47140 TERMINAL_CROPS=1 \
//     npx playwright test e2e/smart-screens-crops.spec.ts --workers=1
//
// Terminal is dark-only (no `[data-theme]` branch in globals.css), so the language pair is the axis
// that matters: every panel string comes from lib/smartScreenLex.ts tuples.

test.skip(!process.env.TERMINAL_CROPS, "Crop generator — set TERMINAL_CROPS=1 to write PR artifacts.");
test.setTimeout(150_000);

const OUT = join(process.cwd(), "docs", "pr-crops", "e04-smart-screens");
mkdirSync(OUT, { recursive: true });

/**
 * Screenshot the whole panel. On desktop the panel body is its own bounded scroll box (56vh, so the
 * table stays in view), so `focus` is scrolled to the top of THAT box first — never by restyling the
 * panel, which would crop a layout the product does not ship.
 */
async function shoot(page: Page, target: Locator, path: string, focus?: Locator) {
  await page.mouse.move(0, 0);
  if (focus) {
    await focus.evaluate((el) => {
      const root = el.closest("[data-smart-screens]");
      for (let box = el.parentElement; box && box !== root; box = box.parentElement) {
        if (box.scrollHeight > box.clientHeight && getComputedStyle(box).overflowY === "auto") {
          box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - 8;
          return;
        }
      }
    });
  }
  await target.scrollIntoViewIfNeeded();
  await target.screenshot({ path, animations: "disabled" });
}

for (const lang of ["en", "zh"] as const) {
  test(`smart screens crops (${lang})`, async ({ page, browser, baseURL }, testInfo) => {
    const zh = lang === "zh";
    const vp = testInfo.project.name;
    const key = `e04-crops-${vp}-${lang}-${Date.now()}`;
    await prepare(page.context(), baseURL!, key, zh);
    await routeManifest(page, () => "g1");

    // ── 1. save a screen on the 10-09 scan and mark it reviewed ──
    await openScreener(page, 5);
    await moveSelect(page).selectOption("up3");
    await expect(dataRows(page)).toHaveCount(4);
    const p = await openPanel(page);
    await expect(p).toHaveAttribute("data-ss-status", "ready");
    await p.locator("[data-ss-name-input]").fill(zh ? "动量筛选" : "Momentum");
    await p.locator("[data-ss-save-button]").click();
    await expect(p.locator("[data-ss-screen]")).toHaveAttribute("data-ss-rev", "1");
    await p.locator("[data-ss-review]").click();
    await expect(p.locator("[data-ss-reviewed]")).toHaveAttribute("data-ss-reviewed", "2026-10-09");
    await shoot(page, p, join(OUT, `${vp}-${lang}-saved.png`));

    // ── 2. on a second device with the 10-10 scan: reopen the screen and review what entered and left ──
    const b = await secondDevice(browser, page, !!testInfo.project.use.hasTouch, baseURL!, key, zh);
    try {
      const pageB = b.page;
      let failPuts = false;
      await routeManifest(pageB, () => "g2");
      await pageB.route("**/api/smart-screens", (route) =>
        failPuts && route.request().method() === "PUT" ? route.abort("failed") : route.fallback());
      await openScreener(pageB, 5);
      const pb = await openPanel(pageB);
      const screen = pb.locator("[data-ss-screen]");
      await screen.locator("[data-ss-open]").click();
      await expect(dataRows(pageB)).toHaveCount(3);
      await screen.locator("[data-ss-changes]").click();
      await expect(screen.locator("[data-ss-diff]")).toHaveAttribute("data-ss-diff", "ok");
      await shoot(pageB, pb, join(OUT, `${vp}-${lang}-changes.png`), screen.locator("[data-ss-diff]"));
      // Explain-why for one name, from the same retained conditions and current value.
      await screen.locator("[data-ss-explain-input]").fill("BBB");
      await screen.locator("[data-ss-explain-button]").click();
      await expect(screen.locator("[data-ss-explained]")).toHaveAttribute("data-ss-explained", "fail");
      await shoot(pageB, pb, join(OUT, `${vp}-${lang}-explain.png`), screen.locator('[data-ss-group="exited"]'));

      // ── 3. a save the account never acknowledged stays pending, with its reason and a retry ──
      failPuts = true;
      await pb.locator("[data-ss-name-input]").fill(zh ? "未保存的筛选" : "Unsaved draft");
      await pb.locator("[data-ss-save-button]").click();
      await expect(pb.locator("[data-ss-pending]")).toHaveAttribute("data-ss-pending", "failed");
      await screen.locator("[data-ss-changes]").click(); // fold the review so the pending item is in frame
      await shoot(pageB, pb, join(OUT, `${vp}-${lang}-save-failed.png`));
    } finally {
      await b.context.close();
    }
  });
}
