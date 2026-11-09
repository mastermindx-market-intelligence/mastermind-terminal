import { expect, test, type Page } from "@playwright/test";
import { useLang as selectLanguage } from "./layoutStore";

type Pane = { id: number; logical: { from: number; to: number } | null; link: unknown };
const probe = (page: Page) => page.evaluate(() => (window as unknown as { __mmPaneSync?: () => { panes: Pane[] } }).__mmPaneSync?.().panes ?? []);
const fingerprint = (pane: Pane) => `${pane.logical!.from.toFixed(3)}/${pane.logical!.to.toFixed(3)}`;
async function settle(page: Page) {
  let rows: Pane[] = []; let previous = "";
  await expect.poll(async () => {
    rows = await probe(page);
    if (rows.length !== 2 || rows.some(row => !row.logical)) return false;
    const next = rows.map(fingerprint).join(",");
    const same = previous === next; previous = next; return same;
  }, { timeout: 20_000, intervals: [150] }).toBe(true);
  return rows;
}
async function bodyFocus(page: Page) { await page.evaluate(() => (document.activeElement as HTMLElement)?.blur()); }
async function activate(page: Page, index: number) {
  await page.locator(".pane").nth(index).locator(".pane-hd").click();
  await expect(page.locator(".pane").nth(index)).toHaveClass(/\bon\b/);
  await bodyFocus(page);
}
async function invertState(page: Page, index: number) {
  const pane = page.locator(".pane").nth(index);
  await pane.locator(".cfb-gear").click();
  const value = await pane.locator('.qsg-item[aria-keyshortcuts="Alt+I"]').getAttribute("aria-pressed");
  await page.keyboard.press("Escape"); return value;
}
async function open(page: Page, lang: "en" | "zh") {
  await selectLanguage(page, lang);
  await page.addInitScript(() => {
    localStorage.removeItem("mm.chartSettings");
    localStorage.setItem("mm.ws", JSON.stringify({ panes: ["NVDA", "BTC-USD"], paneTfs: ["D", "D"], split: 2, activePane: 0, lockedVLine: null, sync: false,
      links: { v: 1, panes: [null, null, null, null], share: { A: { crosshair: true, window: true }, B: { crosshair: true, window: true }, C: { crosshair: true, window: true } } } }));
  });
  for (const [symbol, base] of [["NVDA", 80], ["BTC-USD", 40000]] as const) {
    const bars = Array.from({ length: 1200 }, (_, i) => {
      const date = new Date(Date.UTC(2023, 0, 1) + i * 86400000).toISOString().slice(0, 10);
      const close = base * (1 + 0.2 * Math.sin(i / 37) + i / 12000);
      return [date, close * .995, close * 1.01, close * .99, close, 1000000 + i];
    });
    await page.route(`**/data/${symbol}.json**`, route => route.fulfill({ json: { t: symbol, o: 1, src: "e2e-fixture", bar_quality: "real_ohlc", bars } }));
  }
  await page.route("**/api/quote?**", route => route.fulfill({ json: { quotes: {} } }));
  await page.goto("/terminal");
  await expect.poll(async () => (await probe(page)).length, { timeout: 45_000 }).toBe(2);
  const panes = await settle(page); expect(panes.map(pane => pane.link)).toEqual([null, null]);
}

for (const lang of ["en", "zh"] as const) {
  test(`${lang}: keyboard navigation belongs to the active chart and current control`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "This journey requires two visible panes; mounted tests cover inactive panes at all layouts.");
    test.setTimeout(90_000); await open(page, lang);
    await activate(page, 0);
    const initial = await settle(page);
    await page.keyboard.press("ArrowLeft"); const left = await settle(page);
    expect(left[0].logical!.from).toBeLessThan(initial[0].logical!.from);
    expect(fingerprint(left[1])).toBe(fingerprint(initial[1]));
    await page.keyboard.press("+"); const zoom = await settle(page);
    expect(zoom[0].logical!.to - zoom[0].logical!.from).toBeLessThan(left[0].logical!.to - left[0].logical!.from);
    expect(fingerprint(zoom[1])).toBe(fingerprint(initial[1]));
    await activate(page, 1); await page.keyboard.press("ArrowRight"); const right = await settle(page);
    expect(right[1].logical!.from).toBeGreaterThan(zoom[1].logical!.from);
    expect(fingerprint(right[0])).toBe(fingerprint(zoom[0]));
    await page.keyboard.press("-"); const wide = await settle(page);
    expect(wide[1].logical!.to - wide[1].logical!.from).toBeGreaterThan(right[1].logical!.to - right[1].logical!.from);
    expect(fingerprint(wide[0])).toBe(fingerprint(right[0]));
    await page.keyboard.press("Alt+i");
    expect(await invertState(page, 1)).toBe("true");
    expect(await invertState(page, 0)).toBe("false");

    const pane = page.locator(".pane").first();
    await pane.locator(".cfb-gear").click();
    const invert = pane.locator('.qsg-item[aria-keyshortcuts="Alt+I"]');
    await invert.focus(); await page.keyboard.press("Alt+i");
    await expect(invert).toHaveAttribute("aria-pressed", "false");
    await pane.locator(".qsg-menu .qsg-item").last().click();
    const settings = page.locator("dialog.sm-backdrop");
    await expect(settings).toBeVisible();
    const modalRange = (await settle(page)).map(fingerprint);
    await page.keyboard.press("A"); await page.keyboard.press("Control+k"); await page.keyboard.press("Alt+i");
    await expect(page.locator(".smodal")).toHaveCount(0);
    expect((await settle(page)).map(fingerprint)).toEqual(modalRange);
    await page.keyboard.press("Escape");
    await expect(settings).toHaveCount(0);

    // The account-settings modal is a different real keyboard owner.
    await page.locator(".avatar:visible").first().click();
    const account = page.locator(".acs-overlay.open");
    await expect(account).toBeVisible();
    await account.locator(".acs-nav-b").first().focus();
    await page.keyboard.press("A"); await page.keyboard.press("Control+k");
    await expect(page.locator(".smodal")).toHaveCount(0);
    await page.keyboard.press("Escape"); await expect(account).toHaveCount(0);
    await activate(page, 0);

    const beforeHandled = (await settle(page)).map(fingerprint);
    await page.evaluate(() => document.body.addEventListener("keydown", e => e.preventDefault(), { once: true }));
    await page.keyboard.press("ArrowLeft");
    expect((await settle(page)).map(fingerprint)).toEqual(beforeHandled);
    await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "A", isComposing: true, bubbles: true, cancelable: true })));
    await expect(page.locator(".smodal")).toHaveCount(0);

    // Exercise the browser's native modality selector, including a modeless dialog.
    await page.evaluate(() => { const d = document.createElement("dialog"); d.id = "keyboard-owner-fixture"; d.textContent = "Native modal fixture"; document.body.append(d); d.showModal(); });
    await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true })));
    expect((await settle(page)).map(fingerprint)).toEqual(beforeHandled);
    await page.evaluate(() => { const d = document.querySelector<HTMLDialogElement>("#keyboard-owner-fixture")!; d.close(); d.show(); (document.activeElement as HTMLElement)?.blur(); });
    await page.keyboard.press("ArrowLeft");
    const modeless = await settle(page); expect(modeless[0].logical!.from).toBeLessThan(Number(beforeHandled[0].split("/")[0]));
    await page.evaluate(() => document.querySelector("#keyboard-owner-fixture")!.remove());

    await bodyFocus(page); await page.keyboard.press("A");
    const search = page.locator(".smodal");
    await expect(search).toBeVisible();
    await expect(search.locator("input")).toHaveValue("A");
    await page.keyboard.press("Escape"); await expect(search).toHaveCount(0);
    const crop = info.outputPath(`active-chart-keyboard-${lang}.png`);
    await page.screenshot({ path: crop }); await info.attach("active-chart-keyboard", { path: crop, contentType: "image/png" });
  });
}
