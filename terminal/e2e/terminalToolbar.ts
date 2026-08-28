import { expect, type Locator, type Page } from "@playwright/test";

async function openOverflow(page: Page) {
  const menu = page.locator(".toolbar-overflow-pop.show");
  if (!(await menu.isVisible())) await page.getByTestId("toolbar-more").click();
  await expect(menu).toBeVisible();
  // The menu REMEMBERS its drill view, so an already-open menu can be sitting inside Layouts (or
  // Detect, or Snapshot) where the root controls do not exist. Walk back to the root before
  // handing it out — otherwise a helper waits forever for a row that is one level up.
  const back = menu.locator(".toolbar-overflow-back");
  if (await back.isVisible()) await back.click();
  return menu;
}

export async function toggleToolbarReplay(page: Page) {
  const direct = page.locator('[data-toolbar-action="replay"]');
  if (await direct.isVisible()) {
    await direct.click();
    return;
  }
  const menu = await openOverflow(page);
  await menu.locator('[data-toolbar-menu-action="replay"]').click();
}

/**
 * WHICH menu holds a toolbar control is decided by useAdaptiveToolbar's MEASUREMENT, not by
 * viewport: it measures on mount and AGAIN after `document.fonts.ready`, so at 1440×900 the mode
 * legitimately flips from `full` to `overflow` after the first paint. Any helper that decides its
 * path once — by reading the mode, or by asking "is the button visible?" — races that second
 * measurement, and the race is won locally and lost on a loaded CI runner where the fonts promise
 * settles later. (Two consecutive equal readings of `data-toolbar-mode` are NOT enough for the same
 * reason: the attribute is stable right up until the remeasure lands.)
 *
 * So don't decide once. `viaToolbar` retries the whole open-and-act sequence until the thing it
 * wants is actually on screen, taking whichever entry point exists at that instant. Clicks are
 * allowed to fail: a control that vanished mid-click just means the next attempt takes the other
 * path.
 */
async function viaToolbar(page: Page, opts: {
  /** True iff the action has landed / the surface is open. Polled between attempts. */
  done: () => Promise<boolean>;
  /** The toolbar control itself — its visibility, not the mode attribute, picks the path. */
  control: Locator;
  /** Act on the always-visible toolbar control. */
  direct: () => Promise<void>;
  /** Act via the "More ▸ …" overflow menu, already walked back to its root. */
  overflow: (menu: Locator) => Promise<void>;
  what: string;
}) {
  await expect.poll(async () => {
    if (await opts.done()) return true;
    try {
      if (await opts.control.isVisible()) await opts.direct();
      else await opts.overflow(await openOverflow(page));
    } catch { /* the control moved mid-attempt — the next poll takes the other path */ }
    return opts.done();
  }, { timeout: 25_000, intervals: [150, 250, 400, 600, 1000, 1000], message: `could not reach ${opts.what}` }).toBe(true);
}

export async function chooseToolbarSplit(page: Page, count: 1 | 2 | 4) {
  const seg = page.locator('[data-toolbar-action="split"]').getByRole("button", { name: String(count), exact: true });
  await viaToolbar(page, {
    what: `split ${count}`,
    // The split control renders in BOTH menus, so ask the chart how many panes exist instead.
    done: async () => (await page.locator(".chart-wrap").count()) === count,
    control: seg,
    direct: () => seg.click({ timeout: 2_000 }),
    overflow: (menu) => menu.locator(".toolbar-overflow-group .seg")
      .getByRole("button", { name: String(count), exact: true })
      .click({ timeout: 2_000 }),
  });
}

/**
 * Open the Saved-Layouts menu and return its body, at any viewport.
 *
 * Desktop shows the toolbar popover; the tablet/phone toolbars collapse it into "More ▸ Layouts".
 * Both render the SAME `LayoutMenu`, which is the point — the two used to be hand-copied markup.
 */
export async function openLayoutMenu(page: Page) {
  const directPop = page.locator('[data-toolbar-action="layouts"] .pop.show');
  const overflowPop = page.locator(".toolbar-overflow-pop.show");
  const control = page.locator('[data-toolbar-action="layouts"] > button');
  await viaToolbar(page, {
    what: "the Saved Layouts menu",
    done: async () => (await directPop.locator("[data-layout-save]").isVisible())
      || (await overflowPop.locator("[data-layout-save]").isVisible()),
    control,
    direct: () => control.click({ timeout: 2_000 }),
    overflow: (menu) => menu.locator('[data-toolbar-menu-action="layouts"]').click({ timeout: 2_000 }),
  });
  return (await directPop.locator("[data-layout-save]").isVisible()) ? directPop : overflowPop;
}

/** Flip pane Sync (only rendered with more than one pane), at any viewport. */
export async function toggleToolbarSync(page: Page) {
  const control = page.locator('[data-toolbar-action="sync"]');
  const before = await page.locator('[data-toolbar-action="sync"]').getAttribute("data-sync-on").catch(() => null);
  await viaToolbar(page, {
    what: "the Sync toggle",
    done: async () => (await control.getAttribute("data-sync-on").catch(() => null)) !== before,
    control,
    direct: () => control.click({ timeout: 2_000 }),
    overflow: (menu) => menu.locator('[data-toolbar-menu-action="sync"]').click({ timeout: 2_000 }),
  });
}

export async function runToolbarDetector(page: Page, label: string) {
  const direct = page.locator('[data-toolbar-action="detect"]');
  if (await direct.isVisible()) {
    await direct.locator(":scope > button").click();
    await page.locator(".pop.show .menu-row").filter({ hasText: label }).click();
    return;
  }
  const menu = await openOverflow(page);
  await menu.locator('[data-toolbar-menu-action="detect"]').click();
  await menu.locator('[data-toolbar-menu-action^="detect-"]').filter({ hasText: label }).click();
}
