import { expect, test, type Page } from "@playwright/test";

const VALID_SAVED_WIDTHS = { extPct: 57.5, futureColumn: 67.25 };

async function measureGrid(page: Page) {
  return page.evaluate(() => {
    const header = document.querySelector<HTMLElement>(".wl-cols");
    const row = document.querySelector<HTMLElement>(".wl-row");
    if (!header || !row) return null;
    const tracks = (node: HTMLElement) => getComputedStyle(node).gridTemplateColumns
      .split(/\s+/).map((track) => Number.parseFloat(track));
    const leftEdges = (node: HTMLElement) =>
      Array.from(node.querySelectorAll<HTMLElement>("[data-watchlist-column]"))
        .map((cell) => cell.getBoundingClientRect().left);
    return {
      headerTracks: tracks(header),
      rowTracks: tracks(row),
      headerMin: Number.parseFloat(getComputedStyle(header).minWidth),
      rowMin: Number.parseFloat(getComputedStyle(row).minWidth),
      headingLeft: leftEdges(header),
      rowLeft: leftEdges(row),
    };
  });
}

test("malformed saved widths restore safely and allow normal resize/reload", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    if (sessionStorage.getItem("watchlist-colw-seeded")) return;
    sessionStorage.setItem("watchlist-colw-seeded", "1");
    localStorage.setItem("mm.setVersion", "1");
    localStorage.setItem("mm.set", JSON.stringify({
      tableView: true,
      cols: { last: true, changePct: true, change: false, volume: false, ext: true, extPct: true },
      disp: "symbol",
      logo: false,
      colW: { sym: "180", last: -12, changePct: 0, ext: 43, extPct: 57.5, futureColumn: 67.25, volume: false },
    }));
  });

  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(localStorage.getItem("mm.set") || "{}").colW,
  )).toEqual(VALID_SAVED_WIDTHS);

  if (testInfo.project.name !== "desktop") {
    // The same responsive shell restores settings at these widths, but hides its desktop rail.
    await expect(page.locator(".wl-cols")).toBeHidden();
    await expect.poll(() => page.evaluate(() =>
      document.documentElement.scrollWidth - window.innerWidth,
    )).toBeLessThanOrEqual(1);
    await page.reload();
    await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => page.evaluate(() =>
      JSON.parse(localStorage.getItem("mm.set") || "{}").colW,
    )).toEqual(VALID_SAVED_WIDTHS);
    await page.screenshot({ path: testInfo.outputPath(`restore-${testInfo.project.name}.png`), animations: "disabled" });
    return;
  }

  await expect(page.locator(".wl-cols")).toBeVisible();
  await expect(page.locator(".wl-row").first()).toBeVisible();
  const initial = await measureGrid(page);
  expect(initial).not.toBeNull();
  expect(initial!.headerTracks).toEqual([132, 82, 76, 82, 57.5, 18]);
  expect(initial!.rowTracks).toEqual(initial!.headerTracks);
  expect(initial!.headerMin).toBe(initial!.rowMin);
  expect(initial!.headerMin).toBeGreaterThan(initial!.headerTracks.reduce((sum, width) => sum + width, 0));
  expect(initial!.headingLeft.length).toBe(4);
  expect(initial!.headingLeft.every((x, i) => Math.abs(x - initial!.rowLeft[i]) <= 1)).toBe(true);

  const handle = page.locator(".wl-cols .wl-col .wl-rz").first();
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 36, y, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(localStorage.getItem("mm.set") || "{}").colW.sym as number,
  )).toBeGreaterThan(132);

  const savedWidth = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("mm.set") || "{}").colW.sym as number,
  );
  expect(savedWidth).toBeGreaterThanOrEqual(44);
  await page.reload();
  await expect(page.locator(".wl-row").first()).toBeVisible({ timeout: 60_000 });
  const restored = await measureGrid(page);
  expect(restored).not.toBeNull();
  expect(restored!.headerTracks).toEqual([savedWidth, 82, 76, 82, 57.5, 18]);
  expect(restored!.rowTracks).toEqual(restored!.headerTracks);
  expect(restored!.headingLeft.every((x, i) => Math.abs(x - restored!.rowLeft[i]) <= 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("resized-restored-desktop.png"), animations: "disabled" });
});
