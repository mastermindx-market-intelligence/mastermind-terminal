import { expect, test, type Locator, type Page } from "@playwright/test";

// Dossier mode (?shell=app&dossier=1) is the installable apps' symbol sheet: the native host draws
// its own chart and stacks this page underneath it, so TerminalShell renders the detail rail and no
// chart workspace. The rail's "Open full analysis" therefore mounts MegaPane mode="overlay" — a
// position:fixed; inset:0; z-index:90 layer whose header back button is the ONLY visible way back
// to the dossier. The iPhone and iPad sheets load this page, and the tablet/mobile projects reach it
// by URL, so at ≤860px that button must be a real touch target: ≥44×44, topmost at every edge of
// its box, and clear of the notch / rounded corners. Desktop keeps the classic compact pill.

const DOSSIER_URL = "/terminal?symbol=NVDA&shell=app&dossier=1";
const TOUCH_MIN = 44;

async function openDossierOverlay(page: Page, touch: boolean): Promise<Locator> {
  await page.goto(DOSSIER_URL);
  await expect(page.locator('[data-dossier="1"]')).toHaveCount(1, { timeout: 45_000 });
  // The bridge installs on hydration even without a chart; before that the button has no handler.
  await page.waitForFunction(() => (window as Window & { __mmShell?: { version?: number } }).__mmShell?.version === 1,
    undefined, { timeout: 45_000 });
  await expect(page.locator(".workspace")).toHaveCount(0);

  const open = page.locator(".sa-btn-group .btn-primary");
  await open.scrollIntoViewIfNeeded({ timeout: 20_000 });
  if (touch) await open.tap({ timeout: 20_000 });
  else await open.click({ timeout: 20_000 });

  const pane = page.locator(".fin-pane");
  await expect(pane).toBeVisible({ timeout: 20_000 });
  // The overlay variant specifically — not the chart-hosted workspace pane, which has its own spec.
  await expect(pane).not.toHaveClass(/fin-pane--workspace/);
  await expect(pane).toHaveAttribute("role", "dialog");
  return pane;
}

/** What actually receives a tap at each probe point across the button's box — the stacking truth.
 *  Probes sit 2px inside the top/bottom edge on the vertical centre line and inside the left/right
 *  edge on the horizontal centre line (pill corners are clipped by border-radius, so not those). */
async function hitTestAcross(page: Page, target: Locator) {
  const box = await target.boundingBox();
  expect(box, "hit-test target must be laid out").not.toBeNull();
  const { x, y, width: w, height: h } = box!;
  const points = [
    { at: "centre", x: x + w / 2, y: y + h / 2 },
    { at: "top", x: x + w / 2, y: y + 2 },
    { at: "bottom", x: x + w / 2, y: y + h - 2 },
    { at: "left", x: x + 2, y: y + h / 2 },
    { at: "right", x: x + w - 2, y: y + h / 2 },
  ];
  return page.evaluate((pts) => pts.map(({ at, x: px, y: py }) => {
    const button = document.elementFromPoint(px, py)?.closest("button");
    return {
      at,
      isBack: Boolean(button?.classList.contains("fin-head-back") && button.closest(".fin-pane")),
      label: button?.textContent?.trim() ?? null,
    };
  }), points);
}

async function measureBack(page: Page, back: Locator) {
  const box = (await back.boundingBox())!;
  const head = await back.evaluate((el) => {
    const s = getComputedStyle(el.closest(".fin-head")!);
    return { padTop: parseFloat(s.paddingTop), padLeft: parseFloat(s.paddingLeft), padRight: parseFloat(s.paddingRight) };
  });
  return { box, head, viewport: page.viewportSize()! };
}

for (const { lang, label } of [
  { lang: "en", label: "Back to chart" },
  { lang: "zh", label: "返回图表" },
] as const) {
  test(`touch layouts get a full-size back button in the dossier overlay (${lang})`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "desktop", "≤860px touch target; desktop has its own case below");
    test.setTimeout(120_000);
    await page.addInitScript((l) => { localStorage.setItem("mm.lang", l); }, lang);

    const pane = await openDossierOverlay(page, true);
    const viewport = page.viewportSize()!;
    // The overlay covers the whole sheet, so its header is the only exit.
    expect(await pane.boundingBox()).toEqual({ x: 0, y: 0, width: viewport.width, height: viewport.height });

    const back = pane.getByRole("button", { name: label, exact: true });
    await expect(back).toBeVisible({ timeout: 20_000 });
    const { box } = await measureBack(page, back);
    expect(box.height, "back button height").toBeGreaterThanOrEqual(TOUCH_MIN);
    expect(box.width, "back button width").toBeGreaterThanOrEqual(TOUCH_MIN);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    for (const hit of await hitTestAcross(page, back)) {
      expect(hit.isBack, `tap at the button's ${hit.at} must land on the overlay's back button`).toBe(true);
      expect(hit.label).toBe(label);
    }

    // Safe areas: a notched / rounded-corner device pushes the exit clear of the insets. The sheet
    // is emulated through Chromium's own safe-area override, so env(safe-area-inset-*) is real here.
    const cdp = await page.context().newCDPSession(page);
    const insets = { top: 47, left: 21, right: 21, bottom: 34 };
    await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets });
    await expect.poll(async () => (await back.boundingBox())!.y, { message: "the back button clears the top inset" })
      .toBeGreaterThanOrEqual(insets.top);
    const inset = await measureBack(page, back);
    expect(inset.box.x, "the back button clears the left inset").toBeGreaterThanOrEqual(insets.left);
    expect(inset.head.padRight, "the header keeps the right inset clear").toBeGreaterThanOrEqual(insets.right);
    expect(inset.box.height).toBeGreaterThanOrEqual(TOUCH_MIN);
    expect(inset.box.width).toBeGreaterThanOrEqual(TOUCH_MIN);
    for (const hit of await hitTestAcross(page, back)) {
      expect(hit.isBack, `inset tap at the button's ${hit.at} must land on the back button`).toBe(true);
    }
    await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: {} });

    // The exit works: the overlay closes and the dossier is back, still chart-free.
    await back.tap({ timeout: 20_000 });
    await expect(page.locator(".fin-pane")).toHaveCount(0, { timeout: 20_000 });
    await expect(page.locator('[data-dossier="1"] .detail-board')).toBeVisible();
    await expect(page.locator(".workspace")).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).searchParams.get("pane")).toBeNull();
  });
}

test("desktop keeps the compact overlay back button", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop-only contract");
  const pane = await openDossierOverlay(page, false);
  const back = pane.getByRole("button", { name: "Back to chart", exact: true });
  await expect(back).toBeVisible({ timeout: 20_000 });

  // The ≤860px touch rule must not leak above the breakpoint: the base pill and header stand.
  const style = await back.evaluate((el) => {
    const b = getComputedStyle(el);
    const h = getComputedStyle(el.closest(".fin-head")!);
    return {
      fontSize: b.fontSize, padding: b.padding, minHeight: b.minHeight,
      headPadding: h.padding,
    };
  });
  expect(style).toEqual({ fontSize: "12px", padding: "6px 11px", minHeight: "auto", headPadding: "12px 16px" });
  expect((await back.boundingBox())!.height).toBeLessThan(TOUCH_MIN);

  await back.click({ timeout: 20_000 });
  await expect(page.locator(".fin-pane")).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('[data-dossier="1"] .detail-board')).toBeVisible();
});
