import { expect, test, type Locator, type Page } from "@playwright/test";
import { makeGexT } from "@/components/gexdesk/gexStrings";
import { expectTapTarget } from "./tapTarget";

// Exposure / GEX desk: the "How to Read" drawer toggle and the ladder's 0DTE quick lens are the
// only direct way to reach their actions. On phone widths and coarse pointers each must present a
// 44×44 hit area that still runs its ORIGINAL callback exactly once; on a fine-pointer desktop the
// compact sizing must not change.
//
// Both controls are found by role + visible label, never by the `.obs-gex-mobile-target`
// presentation hook, so reverting the fix fails here on geometry instead of on a missing selector.

const t = makeGexT("en");
const FLOOR = 44;

// The drawer's seven concept cards — the help contents the fix must not touch.
const GUIDE_CARDS = [
  ["guideGexTerm", "guideGexBody"],
  ["guideCallWallTerm", "guideCallWallBody"],
  ["guidePutSupportTerm", "guidePutSupportBody"],
  ["guideMagnetTerm", "guideMagnetBody"],
  ["guideFlipTerm", "guideFlipBody"],
  ["guideRegimeTerm", "guideRegimeBody"],
  ["guideDealerSignTerm", "guideDealerSignBody"],
] as const;

type ClickLogWindow = Window & { __mmGexUtilityClicks?: string[] };

function ladder(page: Page): Locator {
  return page.locator('[data-tut="gex-ladder"]');
}

function guideToggle(page: Page): Locator {
  return page.getByRole("button", { name: new RegExp(`^(${escape(t("guideToggleOpen"))}|${escape(t("guideToggleClose"))})$`) });
}

function zeroDteChip(page: Page): Locator {
  return ladder(page).getByRole("button", { name: t("expiry0Dte"), exact: true });
}

function lensTrigger(page: Page): Locator {
  return ladder(page).getByRole("button", { name: t("expiryLensAria"), exact: true });
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function openExposure(page: Page): Promise<void> {
  await page.goto("/options?tab=gex");
  // Precondition: the mounted desk, not a skeleton — both utilities exist exactly once and the
  // 0DTE lens is actually selectable in this fixture, so a dead tap cannot read as "no-op OK".
  await expect(guideToggle(page)).toHaveCount(1, { timeout: 20_000 });
  await expect(zeroDteChip(page)).toHaveCount(1, { timeout: 20_000 });
  await expect(guideToggle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(zeroDteChip(page)).toHaveAttribute("aria-pressed", "false");
  await expect(zeroDteChip(page)).toHaveAttribute("aria-disabled", "false");
  await expect(lensTrigger(page)).toContainText(t("expiryDropdownLabel"));
}

type ProbePoint = "center" | "top-left" | "top-right" | "bottom-left" | "bottom-right";

/**
 * Viewport points for the center and four corners of the control. Chromium hit-tests the
 * ROUNDED box, so each corner is inset past its own border radius (to its 45° arc point plus
 * 2px) — still well outside the original ~20px label box, but inside the shape a finger hits.
 */
async function probePoints(target: Locator): Promise<Record<ProbePoint, { x: number; y: number }>> {
  await target.scrollIntoViewIfNeeded({ timeout: 10_000 });
  return target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const inset = (radius: string) => Math.ceil((parseFloat(radius) || 0) * (1 - Math.SQRT1_2)) + 2;
    const tl = inset(cs.borderTopLeftRadius);
    const tr = inset(cs.borderTopRightRadius);
    const bl = inset(cs.borderBottomLeftRadius);
    const br = inset(cs.borderBottomRightRadius);
    return {
      center: { x: r.left + r.width / 2, y: r.top + r.height / 2 },
      "top-left": { x: r.left + tl, y: r.top + tl },
      "top-right": { x: r.right - tr, y: r.top + tr },
      "bottom-left": { x: r.left + bl, y: r.bottom - bl },
      "bottom-right": { x: r.right - br, y: r.bottom - br },
    };
  });
}

/** Center and all four corners of the box must hit-test to the control itself. */
async function expectWholeBoxHits(target: Locator): Promise<void> {
  const points = await probePoints(target);
  const misses = await target.evaluate((el, pts) => Object.entries(pts)
    .filter(([, p]) => {
      const hit = document.elementFromPoint(p.x, p.y);
      return !hit || !el.contains(hit);
    })
    .map(([name]) => name), points);
  expect(misses, `${target} hit-test misses`).toEqual([]);
}

/** The enlarged box must not intersect any sibling in its own control row. */
async function expectNoSiblingOverlap(target: Locator): Promise<void> {
  const overlaps = await target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return Array.from(el.parentElement?.children ?? [])
      .filter((c) => c !== el)
      .filter((c) => {
        const b = c.getBoundingClientRect();
        return b.width > 0 && b.height > 0
          && b.left < r.right - 0.5 && b.right > r.left + 0.5
          && b.top < r.bottom - 0.5 && b.bottom > r.top + 0.5;
      })
      .map((c) => (c.textContent || c.tagName).replace(/\s+/g, " ").trim().slice(0, 40));
  });
  expect(overlaps, `${target} overlaps a sibling`).toEqual([]);
}

async function startClickLog(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as ClickLogWindow;
    if (!w.__mmGexUtilityClicks) {
      document.addEventListener("click", (e) => {
        const btn = (e.target as Element | null)?.closest("button");
        w.__mmGexUtilityClicks?.push((btn?.textContent || "none").trim());
      }, true);
    }
    w.__mmGexUtilityClicks = [];
  });
}

async function clickLog(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as ClickLogWindow).__mmGexUtilityClicks ?? []);
}

async function expectNoPageOverflow(page: Page): Promise<void> {
  const width = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(width.scroll).toBeLessThanOrEqual(width.client + 1);
}

test("touch layouts give the GEX utilities a 44×44 hit area that runs each action once", async ({ page }, testInfo) => {
  test.skip(!["mobile", "tablet"].includes(testInfo.project.name), "touch-layout regression");
  test.setTimeout(90_000);

  await openExposure(page);

  // Which arm of `(max-width: 640px), (pointer: coarse)` carries each project: the phone by width,
  // the 820px tablet ONLY by its coarse pointer — so the tablet run is the coarse-pointer proof.
  const media = await page.evaluate(() => ({
    width: window.innerWidth,
    coarse: window.matchMedia("(pointer: coarse)").matches,
  }));
  if (testInfo.project.name === "tablet") {
    expect(media.width).toBeGreaterThan(640);
    expect(media.coarse).toBe(true);
  } else {
    expect(media.width).toBeLessThanOrEqual(640);
  }

  const guide = guideToggle(page);
  const zero = zeroDteChip(page);

  for (const target of [guide, zero]) {
    await target.scrollIntoViewIfNeeded({ timeout: 10_000 });
    await expectTapTarget(target, { width: FLOOR, height: FLOOR });
    await expectWholeBoxHits(target);
    await expectNoSiblingOverlap(target);
  }
  await expectNoPageOverflow(page);

  // A corner tap lands outside the original ~22px label box: only the enlarged area can take it.
  // It opens the drawer exactly once (one click), with the unchanged help contents.
  const g = (await probePoints(guide))["top-left"];
  await startClickLog(page);
  await page.touchscreen.tap(g.x, g.y);
  await expect(guide).toHaveAttribute("aria-expanded", "true");
  await expect(guide).toHaveText(t("guideToggleClose"));
  // The log captures before React's handler runs, so it records the pre-toggle label.
  expect(await clickLog(page)).toEqual([t("guideToggleOpen")]);
  // Scoped to the cards grid that follows the toggle's legend row — "Call Wall", "Put Support"
  // etc. also label the summary bar and the legend. Same seven cards, same order, same copy.
  const cards = guide.locator("xpath=../following-sibling::div[1]/div");
  await expect(cards).toHaveCount(GUIDE_CARDS.length);
  for (const [i, [termKey, bodyKey]] of GUIDE_CARDS.entries()) {
    await expect(cards.nth(i)).toBeVisible();
    await expect(cards.nth(i)).toContainText(t(termKey));
    await expect(cards.nth(i)).toContainText(t(bodyKey));
  }

  // The opposite corner selects the 0DTE lens exactly once; the lens trigger names it.
  const z = (await probePoints(zero))["bottom-right"];
  await startClickLog(page);
  await page.touchscreen.tap(z.x, z.y);
  await expect(zero).toHaveAttribute("aria-pressed", "true");
  await expect(lensTrigger(page)).toContainText(t("expiryLensZero"));
  expect(await clickLog(page)).toEqual([t("expiry0Dte")]);

  // A center tap runs the same original toggle back to All expirations.
  await startClickLog(page);
  await zero.tap({ timeout: 10_000 });
  await expect(zero).toHaveAttribute("aria-pressed", "false");
  await expect(lensTrigger(page)).toContainText(t("expiryDropdownLabel"));
  expect(await clickLog(page)).toEqual([t("expiry0Dte")]);

  await expectNoPageOverflow(page);
});

test("fine-pointer desktop keeps the compact GEX utility sizing and actions", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "fine-pointer regression");
  test.setTimeout(90_000);

  await openExposure(page);
  const media = await page.evaluate(() => ({
    width: window.innerWidth,
    fine: window.matchMedia("(pointer: fine)").matches,
  }));
  expect(media.width).toBeGreaterThan(640);
  expect(media.fine).toBe(true);

  const guide = guideToggle(page);
  const zero = zeroDteChip(page);
  for (const target of [guide, zero]) {
    const sizing = await target.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { minWidth: cs.minWidth, minHeight: cs.minHeight, height: el.getBoundingClientRect().height };
    });
    expect(sizing.minWidth, `${target} min-width`).not.toBe(`${FLOOR}px`);
    expect(sizing.minHeight, `${target} min-height`).not.toBe(`${FLOOR}px`);
    expect(Math.round(sizing.height), `${target} height`).toBeLessThan(FLOOR);
  }

  // Lens first: in the fixed-height desktop column an OPEN guide squeezes the ladder region, so
  // the chip is only reachable with the drawer closed (pre-existing desktop layout, unchanged here).
  await zero.click({ timeout: 10_000 });
  await expect(zero).toHaveAttribute("aria-pressed", "true");
  await expect(lensTrigger(page)).toContainText(t("expiryLensZero"));
  await guide.click({ timeout: 10_000 });
  await expect(guide).toHaveAttribute("aria-expanded", "true");
  await expect(guide).toHaveText(t("guideToggleClose"));
});
