import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

// E2 visual-evidence generator — the crops committed under `docs/pr-crops/e2-pref-delivery/`.
//
// OPT-IN. It writes into the repo, so it must never run as part of `test:e2e:responsive`:
//
//   TERMINAL_E2E_PORT=3190 TERMINAL_CROPS=1 \
//     npx playwright test e2e/preference-delivery-crops.spec.ts --project=desktop --project=tablet --project=mobile
//
// Every shot is the real settings panel driven through the real UI. The fixture server has no
// reachable Supabase, so the delivery lane genuinely fails — which is the state the old
// fire-and-forget write could not express at all, and therefore the state worth photographing.
// The Terminal has no light mode (see acsAppearNote), so the light/dark pair collapses to dark;
// EN and zh are both captured because the note is new user-facing copy.

test.skip(!process.env.TERMINAL_CROPS, "Crop generator — set TERMINAL_CROPS=1 to write PR artifacts.");
test.setTimeout(120_000);

const OUT = join(process.cwd(), "docs", "pr-crops", "e2-pref-delivery");
mkdirSync(OUT, { recursive: true });

const MARKET = { en: "Canada", zh: "加拿大" } as const;
const TAB = { en: "Terminal", zh: "终端" } as const;

async function openSettings(page: Page, lang: "en" | "zh") {
  await page.addInitScript((l) => {
    try { localStorage.setItem("mm.lang", l); } catch { /* blocked */ }
  }, lang);
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
  await page.locator('button[aria-label="Settings"]:visible, button[aria-label="设置"]:visible').first().click();
  await expect(page.locator(".acs-card")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("tab", { name: TAB[lang], exact: true }).click();
}

for (const lang of ["en", "zh"] as const) {
  test(`settings delivery states — ${lang}`, async ({ page, baseURL }, testInfo) => {
    await page.context().addCookies([{
      name: "mm_e2e_wl",
      value: `crop-${lang}-${testInfo.project.name}`,
      url: baseURL ?? "http://127.0.0.1:3108",
    }]);
    await openSettings(page, lang);
    const card = page.locator(".acs-card");
    const shot = (name: string) => card.screenshot({
      path: join(OUT, `${testInfo.project.name}-${lang}-${name}.png`),
    });

    // 1. Untouched: the lane says nothing at all.
    await expect(page.locator(".acs-msg.show")).toHaveCount(0);
    await shot("1-untouched");

    // 2. Edited: the control repaints immediately and the note reports the ACCOUNT's answer.
    await page.locator(".acs-body").getByRole("button", { name: MARKET[lang], exact: false }).first().click();
    await expect(page.locator(".acs-msg.show")).toBeVisible({ timeout: 15_000 });
    await shot("2-delivery-failed");
  });
}
