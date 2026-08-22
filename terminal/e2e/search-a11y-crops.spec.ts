import { test, expect, type Page, type TestInfo } from "./fixtures";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

// D1+D6 visual-evidence generator — the crops committed under `docs/pr-crops/d1-search-truth/`.
//
// OPT-IN, following the e2e/portfolio-crops.spec.ts precedent. It writes into the repo, so it must
// never run as part of `test:e2e:responsive`:
//
//   TERMINAL_E2E_PORT=3191 TERMINAL_CROPS=1 \
//     npx playwright test e2e/search-a11y-crops.spec.ts --workers=1
//
// What the shots have to show, per finding:
//   D1 — the placeholder names only what search implements, in BOTH languages, and a company-name
//        query genuinely resolves to its ticker.
//   D6 — the highlighted row and the machine-readable active option are the SAME row, and the Add
//        control still renders beside the option rather than inside it.

test.skip(!process.env.TERMINAL_CROPS, "Crop generator — set TERMINAL_CROPS=1 to write PR artifacts.");
test.setTimeout(120_000);

const OUT = join(process.cwd(), "docs", "pr-crops", "d1-search-truth");
mkdirSync(OUT, { recursive: true });

async function openSearch(page: Page, testInfo: TestInfo, lang: "en" | "zh") {
  await page.addInitScript((l) => {
    window.localStorage.setItem("mm.lang", l as string);
    document.documentElement.setAttribute("data-lang", l as string);
  }, lang);
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
  if (testInfo.project.name === "desktop") await page.locator(".pair").first().click();
  else await page.locator(".m-symbar").click();
  const input = page.locator(".sh input");
  await expect(input).toBeVisible({ timeout: 20_000 });
  return input;
}

/** The search surface each viewport presents — the frame the crop should capture. */
function surface(page: Page, testInfo: TestInfo) {
  if (testInfo.project.name === "desktop") return page.locator(".smodal");
  if (testInfo.project.name === "mobile") return page.locator(".msheet-search");
  return page.locator(".smodal-hub, .smodal").first();
}

for (const lang of ["en", "zh"] as const) {
  test(`search placeholder + active option — ${lang}`, async ({ page }, testInfo) => {
    const input = await openSearch(page, testInfo, lang);

    // 1. The empty field, showing the placeholder promise itself.
    await expect(surface(page, testInfo)).toBeVisible();
    await page.screenshot({ path: join(OUT, `${testInfo.project.name}-${lang}-placeholder.png`) });

    // 2. A COMPANY-NAME query — the promise the copy still makes — with the active option
    //    highlighted. The crop is the evidence that the visible highlight and aria-activedescendant
    //    land on the same row.
    await input.click();
    await page.keyboard.type("Apple");
    await expect(page.locator('.sres [role="option"]').first()).toBeVisible({ timeout: 20_000 });
    const active = await input.getAttribute("aria-activedescendant");
    expect(active).toBeTruthy();
    await expect(page.locator(`[id="${active}"]`)).toHaveAttribute("aria-selected", "true");
    await page.screenshot({ path: join(OUT, `${testInfo.project.name}-${lang}-name-query.png`) });
  });
}
