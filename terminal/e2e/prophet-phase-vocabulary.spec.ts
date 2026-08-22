/**
 * Prophet `phase="overtime"` on the real surface — the vocabulary and the silence.
 *
 * `overtime` used to be labelled "Overtime / 超时", which reads as a live plan that
 * simply ran long. That is not the state the enum reaches: under Prophet's closure
 * contract the reachable open state is the stale / no-closing-print case. The label is
 * now "Window Elapsed / 窗口已到期" (macro Q2 ruling), and a stale-frame row publishes
 * recommended_action=null — so the desk must show NO action chip rather than reaching
 * for a local Trim / Wait / Hold.
 *
 * Unlike the origination spec next door, the expected words ARE literals here. That
 * disclosure's copy is producer data and asserting it from the fixture is what keeps the
 * two repos from drifting; this copy is the Terminal's own, and the ruling is exactly a
 * ruling about which words. A test reading them back out of the string table it is meant
 * to be policing would pass on any rename, which is the failure this spec exists to catch.
 *
 * Run with PROPHET_EVIDENCE=1 to also write the PR crops to
 * docs/pr-crops/prophet-phase-vocabulary/.
 */

import { expect, test, type Locator, type Page } from "./fixtures";
import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const FIXTURE_FILE = path.join(process.cwd(), "test-fixtures", "prophet_stale_frame_fixture.json");
const CROP_DIR = path.join(process.cwd(), "..", "docs", "pr-crops", "prophet-phase-vocabulary");
const EVIDENCE = process.env.PROPHET_EVIDENCE === "1";

/** The stale-frame row and the fresh control, by ticker. */
const STALE = "LRN";
const FRESH = "BA";

const COPY = {
  en: {
    label: "Window Elapsed",
    retired: "Overtime",
    freshPhase: "Triggered",
    actionLabel: "Recommended action",
    freshAction: "Hold",
    why: "The declared plan window elapsed. The close or current price frame is unavailable or awaiting reconciliation.",
  },
  zh: {
    label: "窗口已到期",
    retired: "超时",
    freshPhase: "已触发",
    actionLabel: "建议操作",
    freshAction: "持有",
    why: "计划声明的窗口已到期。收盘或现价数据帧不可用或尚待对账。",
  },
} as const;

let fixture: unknown;

test.beforeAll(async () => {
  fixture = JSON.parse(await readFile(FIXTURE_FILE, "utf8"));
  if (EVIDENCE) mkdirSync(CROP_DIR, { recursive: true });
});

/** The card for one ticker in the signal stream. */
function card(page: Page, asset: string): Locator {
  return page.locator(".obs-prophet-signal").filter({ hasText: asset }).first();
}

/** The CENTER column — the detail panel for whichever plan is selected. */
function panel(page: Page): Locator {
  return page.locator(".obs-prophet-analysis");
}

/** The RIGHT column — management confidence, where the action chip lives. */
function confidence(page: Page): Locator {
  return page.locator(".obs-prophet-confidence").first();
}

async function openProphet(page: Page, lang: "en" | "zh"): Promise<void> {
  // Predicate rather than a glob: the `?` in `/api/flow?f=…` is ambiguous in URL globs.
  await page.route(
    (url) => url.pathname === "/api/flow" && url.searchParams.get("f") === "prophet_idx",
    async (route) => { await route.fulfill({ json: fixture }); },
  );
  await page.goto("/options?tab=prophet");
  await expect(card(page, STALE)).toBeVisible({ timeout: 20_000 });
  if (lang === "zh") {
    // The house switch: LangProvider re-reads the attribute on every `mm:lang`.
    await page.evaluate(() => {
      window.localStorage.setItem("mm.lang", "zh");
      document.documentElement.setAttribute("data-lang", "zh");
      window.dispatchEvent(new CustomEvent("mm:lang"));
    });
  }
}

/** Select a plan and wait for the panel to actually be showing it. */
async function openPlan(page: Page, asset: string): Promise<void> {
  await card(page, asset).click();
  await expect(panel(page).getByText(asset, { exact: true }).first()).toBeVisible();
}

for (const lang of ["en", "zh"] as const) {
  const copy = COPY[lang];

  test(`Prophet calls a stale-frame plan Window Elapsed and instructs nothing (${lang})`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await openProphet(page, lang);
    await openPlan(page, STALE);

    // 1. All three surfaces that draw a phase say the same new word.
    await expect(card(page, STALE)).toContainText(copy.label);
    await expect(panel(page)).toContainText(copy.label);
    await expect(confidence(page)).toContainText(copy.label);

    // 2. And none of them says the retired one. Scoped to the desk rather than the
    //    document so unrelated chrome can never mask a leak (or fake one).
    const desk = page.locator(".obs-prophet");
    await expect(desk).not.toContainText(copy.retired);

    // 3. The meaning is stated, not left to the label. It rides as the chip's accessible
    //    name — a title= would trip the translated-strings guard.
    await expect(panel(page).getByLabel(copy.why)).toBeVisible();

    // 4. THE SILENCE. recommended_action is null on this row, so no action chip renders
    //    and no local verb is substituted for it.
    await expect(confidence(page)).not.toContainText(copy.actionLabel);
    await expect(confidence(page)).not.toContainText(copy.freshAction);

    if (EVIDENCE) {
      const shot = await page.locator(".obs-prophet").screenshot();
      await testInfo.attach(`prophet-window-elapsed-${lang}`, { body: shot, contentType: "image/png" });
      const { writeFile } = await import("node:fs/promises");
      await writeFile(
        path.join(CROP_DIR, `window-elapsed-${lang}-${testInfo.project.name}.png`),
        shot,
      );
    }
  });

  test(`a fresh plan on the same desk is unchanged (${lang})`, async ({ page }) => {
    test.setTimeout(60_000);
    await openProphet(page, lang);
    await openPlan(page, FRESH);

    await expect(card(page, FRESH)).toContainText(copy.freshPhase);
    await expect(panel(page)).toContainText(copy.freshPhase);
    // Its action chip is exactly where it always was — the suppression above is the
    // stale row's contract, not a desk-wide change.
    await expect(confidence(page)).toContainText(copy.actionLabel);
    await expect(confidence(page)).toContainText(copy.freshAction);
  });
}
