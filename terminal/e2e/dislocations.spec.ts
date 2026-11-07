import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { settled } from "./settle";

// PR evidence for `/dislocations` — crops under `docs/pr-crops/dislocations/`.
//
// OPT-IN (never part of `test:e2e:responsive`):
//
//   TERMINAL_E2E_PORT=3311 TERMINAL_CROPS=1 \
//     npx playwright test e2e/dislocations.spec.ts --workers=1 \
//       --project=desktop --project=mobile
//
// Fixture file selected by `mm_e2e_dislo` (see `lib/dislocations/source.ts`).

test.skip(!process.env.TERMINAL_CROPS, "Crop generator — set TERMINAL_CROPS=1 to write PR artifacts.");
test.setTimeout(120_000);

const OUT = join(process.cwd(), "docs", "pr-crops", "dislocations");
mkdirSync(OUT, { recursive: true });

const OK_EMPTY_EN = "No dislocations yet this session. The list fills as 5-minute bars close.";
const SOURCE_UNAVAILABLE_EN =
  "The dislocation feed isn't publishing yet. Nothing here is live.";
const CONFIRMED_ZH = "已确认";

type Scenario = {
  name: string;
  cookie: string;
  lang?: "en" | "zh";
};

const SCENARIOS: Scenario[] = [
  { name: "populated", cookie: "fresh", lang: "en" },
  { name: "populated-zh", cookie: "fresh", lang: "zh" },
  { name: "empty", cookie: "empty", lang: "en" },
  { name: "stale", cookie: "stale_pack", lang: "en" },
  { name: "unavailable", cookie: "no_episodes_key", lang: "en" },
];

async function openScenario(page: Page, baseURL: string | undefined, scenario: Scenario) {
  const origin = baseURL ?? "http://127.0.0.1:3108";
  await page.context().addCookies([{ name: "mm_e2e_dislo", value: scenario.cookie, url: origin }]);
  const lang = scenario.lang ?? "en";
  await page.addInitScript((l: string) => {
    window.localStorage.setItem("mm.lang", l);
    document.documentElement.setAttribute("data-lang", l);
    document.documentElement.setAttribute("lang", l === "zh" ? "zh-CN" : "en");
  }, lang);
  await page.goto("/dislocations");
  await expect(page.locator('[data-testid="dislo-status"]')).toBeVisible({ timeout: 60_000 });
  await settled({
    read: async () => {
      const rows = await page.locator("li[data-ticker]").count();
      const status = (await page.locator('[data-testid="dislo-status"]').innerText()).trim();
      const degraded = await page.locator('[data-testid="dislo-degraded"]').count();
      const stale = await page.locator('[data-testid="dislo-stale-warn"]').count();
      return JSON.stringify({ rows, status, degraded, stale });
    },
    ok: (v) => v.length > 2,
    same: (a, b) => a === b,
    message: "dislocations surface never settled",
  });
}

for (const scenario of SCENARIOS) {
  test(`dislocations — ${scenario.name}`, async ({ page, baseURL }, testInfo) => {
    const project = testInfo.project.name;
    const outPath = join(OUT, `${project}-${scenario.name}.png`);

    await openScenario(page, baseURL, scenario);

    switch (scenario.name) {
      case "populated": {
        await expect(page.locator("#dislo-confirmed, [id='dislo-confirmed']")).toBeVisible();
        await expect(page.getByRole("heading", { name: /Confirmed/ })).toBeVisible();
        const rows = await page.locator("li[data-ticker]").count();
        expect(rows).toBeGreaterThanOrEqual(3);
        break;
      }
      case "populated-zh": {
        await expect(page.locator("#dislo-confirmed")).toContainText(CONFIRMED_ZH);
        break;
      }
      case "empty": {
        await expect(page.locator('[data-testid="dislo-degraded"]')).toContainText(OK_EMPTY_EN);
        break;
      }
      case "stale": {
        await expect(page.locator('[data-testid="dislo-stale-warn"]')).toBeVisible();
        await expect(page.locator('[data-testid="dislo-stale-warn"]')).toContainText("feed is behind");
        break;
      }
      case "unavailable": {
        await expect(page.locator('[data-testid="dislo-degraded"]')).toContainText(SOURCE_UNAVAILABLE_EN);
        break;
      }
      default:
        break;
    }

    await page.screenshot({ path: outPath, fullPage: true });
  });
}
