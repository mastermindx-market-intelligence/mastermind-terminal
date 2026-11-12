import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createDefaultTapeView, encodeTapeView } from "../lib/optionsTapeView";

const fixture = JSON.parse(readFileSync(path.join(process.cwd(), "public/data/flow_fixture.json"), "utf8"));
const base = fixture.feed.events[0];
const feed = { ...fixture.feed, events: [
  { ...base, id: "view-nvda-high", premium: 2_000_000 },
  { ...base, id: "view-nvda-low", premium: 1_200_000 },
  { ...base, id: "view-nvda-small", premium: 100_000 },
  { ...base, id: "view-other-root", root: "SPY", premium: 4_000_000 },
  { ...base, id: "view-other-mny", mny_bucket: "near_otm", premium: 3_000_000 },
  { ...base, id: "view-other-side", side: "~sell", premium: 5_000_000 },
] };

for (const lang of ["en", "zh"] as const) {
  test(`Tape link restores the exact filtered order and supports manual copy (${lang})`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.addInitScript((locale) => {
      localStorage.setItem("mm.lang", locale);
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
        writeText: async () => { throw new DOMException("clipboard unavailable", "NotAllowedError"); },
      } });
    }, lang);
    await page.route(/\/api\/flow\/stream\?f=feed$/, (route) => route.fulfill({
      headers: { "content-type": "text/event-stream", "cache-control": "no-store" },
      body: `retry: 60000\n\ndata: ${JSON.stringify(feed)}\n\n`,
    }));
    await page.goto("/options?tab=tape&unrelated=discard-me");
    const bar = page.locator(".flow-filter-bar");
    const exporter = bar.locator('[data-options-export="tape-csv-v1"]');
    await expect(exporter).toContainText("6");
    await bar.getByRole("button", { name: lang === "zh" ? "预设视图 ▾" : "Presets ▾" }).click();
    // The existing preset carries the inferred side filter into the shared view.
    await bar.locator(".menu-row").first().click();
    await bar.getByRole("button", { name: lang === "zh" ? "8–30天" : "8–30d", exact: true }).click();
    await bar.getByRole("button", { name: lang === "zh" ? "平值" : "ATM", exact: true }).click();
    await bar.locator("input").fill("nvda");
    await expect(exporter).toContainText("2");
    const premium = page.locator("table.scr th").filter({ hasText: lang === "zh" ? "权利金" : "Prem" }).last();
    await premium.click();
    await premium.click();
    await expect(premium).toHaveText(/↑/);
    const before = await page.locator("table.scr tbody tr").filter({ has: page.locator("td") }).allTextContents();
    await bar.locator('[data-options-tape-view="share"]').click();
    const panel = page.locator("#options-tape-view-link");
    await expect(panel).toContainText(lang === "zh" ? "不保存数据快照" : "does not save a snapshot");
    await panel.getByRole("button", { name: lang === "zh" ? "复制链接" : "Copy link", exact: true }).click();
    await expect(panel.getByRole("status")).toHaveText(lang === "zh" ? "请选择链接并手动复制。" : "Select the link and copy it manually.");
    const link = await panel.locator("input").inputValue();
    await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (text: string) => { document.documentElement.dataset.copiedTapeView = text; },
    } }));
    await panel.getByRole("button", { name: lang === "zh" ? "复制链接" : "Copy link", exact: true }).click();
    await expect(panel.getByRole("status")).toHaveText(lang === "zh" ? "链接已复制" : "Link copied");
    expect(await page.evaluate(() => document.documentElement.dataset.copiedTapeView)).toBe(link);
    const url = new URL(link);
    expect([...url.searchParams.keys()]).toEqual(["tab", "tapeView"]);
    const state = JSON.parse(url.searchParams.get("tapeView")!);
    expect(state).toMatchObject({ minPrem: 1_000_000, dteBuckets: ["8_30d"], mnyBuckets: ["atm"],
      tapeTickerSearch: "NVDA", sideFilter: "~buy", sortKey: "premium", sortDir: 1 });
    const bounds = await panel.evaluate((el) => ({ left: el.getBoundingClientRect().left,
      right: el.getBoundingClientRect().right, width: window.innerWidth,
      doc: document.documentElement.scrollWidth }));
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(bounds.width + 1);
    expect(bounds.doc).toBeLessThanOrEqual(bounds.width + 1);
    if (process.env.OPTIONS_TAPE_VIEW_EVIDENCE === "1") {
      const dir = path.join(process.cwd(), "../docs/pr-crops/options-tape-view");
      mkdirSync(dir, { recursive: true });
      // Terminal's current surface is dark-only; retain the actual product state.
      await page.screenshot({ path: path.join(dir, `${testInfo.project.name}-${lang}-dark-share.png`) });
    }
    await page.goto(link);
    await expect(exporter).toContainText("2");
    await expect(bar.locator("select")).toHaveValue("1000000");
    await expect(bar.locator("input")).toHaveValue("NVDA");
    await expect(premium).toHaveText(/↑/);
    await expect.poll(() => page.locator("table.scr tbody tr").filter({ has: page.locator("td") }).allTextContents()).toEqual(before);
    // Explicit Reset remains the ordinary way to leave the restored view.
    await bar.getByRole("button", { name: lang === "zh" ? "重置" : "Reset", exact: true }).click();
    await expect(exporter).toContainText("6");
  });
}

test("unsupported Tape links withhold results until explicit recovery", async ({ page }) => {
  await page.goto(`/options?tab=tape&tapeView=${encodeURIComponent('{"v":99}')}`);
  const invalid = page.locator('[data-options-tape-view="invalid"]');
  await expect(invalid).toBeVisible();
  await expect(page.locator("table.scr")).toHaveCount(0);
  await expect(page.locator('[data-options-export="tape-csv-v1"]')).toHaveCount(0);
  await invalid.getByRole("button").click();
  await expect(invalid).toHaveCount(0);
  await expect(page.locator('[data-options-tape-view="share"]')).toBeVisible();
  expect(new URL(page.url()).searchParams.has("tapeView")).toBe(false);
});


test("client navigation restores a different shared view without resetting unrelated edits", async ({ page }) => {
  const viewUrl = (search: string) => `/options?${new URLSearchParams({ tab: 'tape', tapeView: encodeTapeView({ ...createDefaultTapeView(), tapeTickerSearch: search }) })}`;
  const nvda = viewUrl('NVDA');
  const spy = viewUrl('SPY');
  await page.goto(nvda);
  const search = page.locator('.flow-filter-bar > input');
  await expect(search).toHaveValue('NVDA');
  await search.fill('QQQ');
  await page.evaluate(() => {
    const url = new URL(location.href); url.searchParams.set('unrelated', 'keep-local-edit');
    history.replaceState(null, '', url);
  });
  await expect(search).toHaveValue('QQQ');
  await page.evaluate((url) => history.pushState(null, '', url), spy);
  await expect(search).toHaveValue('SPY');
  await page.goBack();
  await expect(search).toHaveValue('NVDA');
  await page.goForward();
  await expect(search).toHaveValue('SPY');
  await page.evaluate(() => history.pushState(null, '', '/options?tab=tape&tapeView=invalid'));
  await expect(page.locator('[data-options-tape-view="invalid"]')).toBeVisible();
  await expect(page.locator('table.scr')).toHaveCount(0);
  await page.goBack();
  await expect(search).toHaveValue('SPY');
});


test("Tape search waits for hydration before accepting edits", async ({ page }) => {
  const view = encodeTapeView({ ...createDefaultTapeView(), tapeTickerSearch: "NVDA" });
  let releaseScripts!: () => void;
  const scriptGate = new Promise<void>((resolve) => { releaseScripts = resolve; });
  await page.route(/\/_next\/static\/.*\.js(?:\?|$)/, async (route) => {
    await scriptGate;
    await route.continue();
  });
  try {
    await page.goto(`/options?${new URLSearchParams({ tab: "tape", tapeView: view })}`, { waitUntil: "commit" });
    const search = page.locator(".flow-filter-bar > input");
    await expect(search).toHaveValue("NVDA");
    await expect(search).toBeDisabled();
    releaseScripts();
    await expect(search).toBeEnabled();
    await search.fill("QQQ");
    await page.evaluate(() => {
      const url = new URL(location.href);
      url.searchParams.set("unrelated", "keep-local-edit");
      history.replaceState(null, "", url);
    });
    await expect(search).toHaveValue("QQQ");
  } finally {
    releaseScripts();
    await page.unrouteAll({ behavior: "wait" });
  }
});
