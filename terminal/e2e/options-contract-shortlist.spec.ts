import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expectTapTarget } from "./tapTarget";

// E15 — exact-contract shortlist + side-by-side comparison on the Options
// Screener's Open-interest builds / Hot contracts lists.
//
// The two flow payloads are intercepted with contracts chosen to exercise the
// contract: an adjusted root (NVDA1) at the same strike as NVDA, a null
// midpoint, a malformed expiry (refused), a duplicated identity (refused), and
// a Hot list from a later session served as a stale copy. The last test leaves
// `/api/flow` un-intercepted so the entitled route (FLOW_FIXTURE=1 +
// TERMINAL_E2E_ENTITLEMENT=unlimited in playwright.config) supplies real rows.
//
// PR crops are opt-in: TERMINAL_CROPS=1 writes docs/pr-crops/e15-contract-shortlist/.

const OI_ASOF = "2026-07-04T20:00:00Z";
const HOT_ASOF = "2026-07-05T16:05:00Z";

const OI_PAYLOAD = {
  schema: "options_hub.oi_movers/v1",
  asof: OI_ASOF,
  movers: [
    { root: "NVDA", right: "C", exp: "2026-07-18", strike: 150, oi: 42180, oi_prev: 28340, d_oi: 13840, mid: 1.24 },
    { root: "SPY", right: "P", exp: "2026-07-11", strike: 530, oi: 38420, oi_prev: 50660, d_oi: -12240, mid: null },
    { root: "TSLA", right: "C", exp: "2026-08", strike: 300, oi: 28140, oi_prev: 17280, d_oi: 10860, mid: 3.81 },
    { root: "NVDA1", right: "C", exp: "2026-07-18", strike: 150, oi: 9100, oi_prev: 120, d_oi: 8980, mid: 3.1 },
    { root: "META", right: "C", exp: "2026-07-18", strike: 600, oi: 20000, oi_prev: 12000, d_oi: 8000, mid: 4.4 },
    { root: "META", right: "C", exp: "2026-07-18", strike: 600, oi: 19000, oi_prev: 12000, d_oi: 7000, mid: 4.5 },
    { root: "QQQ", right: "P", exp: "2026-07-25", strike: 465, oi: 15000, oi_prev: 9000, d_oi: 6000, mid: 2.05 },
  ],
};

const HOT_ROWS = {
  spy: { root: "SPY", right: "P", exp: "2026-07-11", strike: 545, premium: 22_140_000, vol: 48120, oi_prev: null, vol_gt_oi: null, close: 4.6 },
  aapl: { root: "AAPL", right: "C", exp: "2026-07-18", strike: 230, premium: 5_000_000, vol: 20000, oi_prev: 15000, vol_gt_oi: true, close: 2.5 },
  nvda: { root: "NVDA", right: "C", exp: "2026-07-18", strike: 150, premium: 1_300_000, vol: 10000, oi_prev: 42180, vol_gt_oi: false, close: 1.3 },
};

// `stale: true` is what /api/flow adds when it serves an older cached copy
// after a failed refresh.
const HOT_PAYLOAD = {
  schema: "options_hub.hot/v1",
  asof: HOT_ASOF,
  stale: true,
  by_premium: [HOT_ROWS.spy, HOT_ROWS.aapl, HOT_ROWS.nvda],
  by_volume: [HOT_ROWS.spy, HOT_ROWS.aapl, HOT_ROWS.nvda],
};

function key(root: string, right: string, exp: string, strike: number): string {
  return `=${encodeURIComponent(root)}|${right}|${exp}|=${strike}|?|?|?|?`;
}
const doiKey = (root: string, right: string, exp: string, strike: number) =>
  `doi@2026-07-04#${key(root, right, exp, strike)}`;
const hotKey = (root: string, right: string, exp: string, strike: number) =>
  `hot@2026-07-05#${key(root, right, exp, strike)}`;

const NVDA_DOI = doiKey("NVDA", "C", "2026-07-18", 150);
const NVDA1_DOI = doiKey("NVDA1", "C", "2026-07-18", 150);
const SPY_DOI = doiKey("SPY", "P", "2026-07-11", 530);
const NVDA_HOT = hotKey("NVDA", "C", "2026-07-18", 150);
const SPY_HOT = hotKey("SPY", "P", "2026-07-11", 545);
const AAPL_HOT = hotKey("AAPL", "C", "2026-07-18", 230);

async function routeFlow(page: Page) {
  await page.route(/\/api\/flow\?f=oi$/, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(OI_PAYLOAD) }),
  );
  await page.route(/\/api\/flow\?f=hot$/, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(HOT_PAYLOAD) }),
  );
}

async function setLang(page: Page, lang: "en" | "zh") {
  await page.addInitScript((l: string) => {
    window.localStorage.setItem("mm.lang", l);
  }, lang);
}

/** The visible screener table's rows, cell text joined — population AND order. */
async function screenerRows(page: Page): Promise<string[]> {
  return page.locator("table.scr tbody tr").evaluateAll((trs) =>
    trs.map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => (td.textContent ?? "").trim()).join("|")),
  );
}

const pinBtn = (page: Page, pinKey: string): Locator => page.locator(`[data-contract-pin="${pinKey}"]`);
const tray = (page: Page): Locator => page.locator("[data-contract-shortlist]");
const trayPin = (page: Page, pinKey: string): Locator => tray(page).locator(`li[data-pin-key="${pinKey}"]`);
const fieldRow = (page: Page, field: string): Locator => tray(page).locator(`tr[data-field="${field}"]`);

async function openPreset(page: Page, name: string) {
  await page.getByRole("button", { name, exact: true }).click();
}

/** True when the pin button and its row's ticker text sit on one line. */
async function pinSharesTickerLine(btn: Locator): Promise<boolean> {
  return btn.evaluate((b) => {
    const text = Array.from(b.parentElement!.childNodes).find((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim());
    if (!text) return false;
    const range = document.createRange();
    range.selectNodeContents(text);
    const t = range.getBoundingClientRect();
    const r = b.getBoundingClientRect();
    const mid = t.top + t.height / 2;
    return mid > r.top && mid < r.bottom && r.right <= t.left + 1;
  });
}

/** How many pixels of the screener table's card are clipped away (0 = whole card shown). */
async function clippedTableHeight(page: Page): Promise<number> {
  return page.locator("table.scr").evaluate((t) => {
    const card = t.closest(".obs-card") as HTMLElement;
    return card.scrollHeight - card.clientHeight;
  });
}

async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test("pins exact contracts, compares only what the source supplied, and leaves the screener untouched", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const touch = testInfo.project.name !== "desktop";
  await routeFlow(page);
  await setLang(page, "en");
  await page.goto("/options?tab=screener");

  await openPreset(page, "ΔOI Builds");
  await expect(page.locator("table.scr tbody tr")).toHaveCount(7);
  const doiOrder = await screenerRows(page);
  expect(doiOrder.map((r) => r.split("|")[0])).toEqual(["NVDA", "SPY", "TSLA", "NVDA1", "META", "META", "QQQ"]);
  await expect(tray(page)).toContainText("Pin up to four contracts");

  // Refusals: an incomplete expiry and a duplicated identity can't be pinned,
  // and the refusal never fires the row's own navigation.
  const tslaRefused = page.locator('[data-contract-pin-refused="exp"]');
  await expect(tslaRefused).toHaveCount(1);
  await expect(page.locator('[data-contract-pin-refused="ambiguous"]')).toHaveCount(2);
  await expect(tslaRefused).toHaveAttribute("aria-disabled", "true");
  await tslaRefused.click({ force: true });
  await expect(tray(page).getByRole("status")).toHaveText("Can't pin: the expiry date is incomplete.");
  await expect(page.locator("table.scr")).toBeVisible();
  expect(await screenerRows(page)).toEqual(doiOrder);

  // NVDA and the adjusted NVDA1 at the same strike stay two contracts.
  await pinBtn(page, NVDA_DOI).click();
  await pinBtn(page, NVDA1_DOI).click();
  await expect(pinBtn(page, NVDA_DOI)).toHaveAttribute("aria-pressed", "true");
  await expect(pinBtn(page, NVDA1_DOI)).toHaveAttribute("aria-pressed", "true");
  expect(await screenerRows(page)).toEqual(doiOrder);
  await expect(tray(page)).toContainText("2 of 4 pinned");
  await expect(trayPin(page, NVDA_DOI)).toContainText("NVDA 2026-07-18 150 Call");
  await expect(trayPin(page, NVDA1_DOI)).toContainText("NVDA1 2026-07-18 150 Call");

  const compare = tray(page).getByRole("button", { name: "Compare", exact: true });
  await compare.click();
  const panel = tray(page).locator("[data-like-for-like]");
  await expect(panel).toHaveAttribute("data-like-for-like", "yes");
  await expect(panel).toContainText("Same list and same session (2026-07-04)");
  await expect(panel).toContainText("Nothing here is a live or executable quote.");
  await expect(panel).toContainText("A root ending in a digit is usually an adjusted contract.");
  await expect(panel.locator("thead")).toContainText("Root ends in a digit");

  // Executable rows stay empty although both contracts carry a midpoint.
  for (const f of ["bid_ask", "spread", "quote_size"]) {
    const row = fieldRow(page, f);
    await expect(row).toHaveAttribute("data-basis", "executable_quote");
    await expect(row.locator('td[data-cell-state="not_supplied"]')).toHaveCount(2);
    await expect(row.locator("td")).toHaveText([
      "Not supplied: no live quote in this source",
      "Not supplied: no live quote in this source",
    ]);
  }
  const mid = fieldRow(page, "mid");
  await expect(mid).toHaveAttribute("data-basis", "reference_mark");
  await expect(mid.locator("th")).toContainText("Reference mark, not executable");
  await expect(mid.locator("td").nth(0)).toContainText("$1.24");
  await expect(mid.locator("td").nth(0)).toContainText("End-of-day bid/ask midpoint, 2026-07-04 close");
  await expect(mid.locator("td").nth(1)).toContainText("$3.10");
  await expect(fieldRow(page, "close").locator("td").nth(0)).toHaveText("Not carried by this list");
  for (const f of ["multiplier", "deliverable", "settlement", "exercise_style"]) {
    await expect(fieldRow(page, f).locator("td")).toHaveText([
      "Not supplied, not assumed standard",
      "Not supplied, not assumed standard",
    ]);
  }

  // The open comparison never squeezes the originating table: its card keeps
  // every row and the results region scrolls instead.
  expect(await clippedTableHeight(page)).toBeLessThanOrEqual(1);

  // An incumbent sort, then pin/unpin inside the sorted view: the order the
  // sort produced is untouched by the shortlist.
  await page.locator("table.scr thead th", { hasText: "Mid" }).click();
  const sorted = await screenerRows(page);
  expect(sorted).not.toEqual(doiOrder);
  await pinBtn(page, SPY_DOI).click();
  await expect(fieldRow(page, "mid").locator("td").nth(2)).toHaveAttribute("data-cell-state", "missing");
  await expect(fieldRow(page, "mid").locator("td").nth(2)).toContainText("Missing in this row (left blank)");
  await pinBtn(page, NVDA1_DOI).click();
  await expect(pinBtn(page, NVDA1_DOI)).toHaveAttribute("aria-pressed", "false");
  expect(await screenerRows(page)).toEqual(sorted);

  // A different list, a later session, and a stale copy: visibly not like-for-like.
  await openPreset(page, "Hot Contracts");
  await expect(page.locator("table.scr tbody tr")).toHaveCount(3);
  const hotOrder = await screenerRows(page);
  await pinBtn(page, NVDA_HOT).click();
  await pinBtn(page, SPY_HOT).click();
  expect(await screenerRows(page)).toEqual(hotOrder);
  await expect(tray(page)).toContainText("4 of 4 pinned");
  await expect(panel).toHaveAttribute("data-like-for-like", "no");
  const warnings = panel.locator("[data-compare-warnings]");
  await expect(warnings).toContainText("different sessions (2026-07-04, 2026-07-05)");
  await expect(warnings).toContainText("different lists");
  await expect(warnings).toContainText("older cached copy");
  await expect(panel).toContainText("The same contract is pinned from two lists");
  await expect(panel.locator(`th[data-pin-col="${NVDA_HOT}"]`)).toContainText("Older copy");
  const close = fieldRow(page, "close").locator("td");
  await expect(close.nth(2)).toContainText("$1.30");
  await expect(close.nth(2)).toContainText("Last trade, 2026-07-05 close");
  const oi = fieldRow(page, "oi").locator("td");
  await expect(oi.nth(0)).toContainText("Report dated 2026-07-04");
  await expect(oi.nth(2)).toContainText("Report dated 2026-07-05");
  await expect(oi.nth(3)).toHaveAttribute("data-cell-state", "missing");
  await expect(fieldRow(page, "vol_above_oi").locator("td").nth(3)).toHaveAttribute("data-cell-state", "missing");

  // Full: a fifth contract is refused, nothing is replaced silently.
  await expect(pinBtn(page, AAPL_HOT)).toHaveAttribute("aria-disabled", "true");
  await pinBtn(page, AAPL_HOT).click({ force: true });
  await expect(tray(page).getByRole("status")).toHaveText("The shortlist is full (four). Remove one to add another.");
  await expect(tray(page)).toContainText("4 of 4 pinned");
  expect(await screenerRows(page)).toEqual(hotOrder);

  if (touch) {
    await expectTapTarget(pinBtn(page, NVDA_HOT), { width: 44, height: 44 });
    await expectTapTarget(tray(page).getByRole("button", { name: "Hide comparison", exact: true }), { height: 44 });
    await expectTapTarget(tray(page).getByRole("button", { name: "Clear", exact: true }), { height: 44 });
    await expectTapTarget(trayPin(page, NVDA_DOI).getByRole("button", { name: "Show in list", exact: true }), { height: 44 });
    await expectTapTarget(trayPin(page, NVDA_DOI).getByRole("button", { name: /^Remove / }), { width: 44, height: 44 });
  }
  // The pin shares the ticker's line instead of stacking over it.
  expect(await pinSharesTickerLine(pinBtn(page, NVDA_HOT))).toBe(true);
  await expectNoPageOverflow(page);

  // "Show in list" returns to the originating table with its incumbent order
  // and focuses the pinned row's control.
  await trayPin(page, NVDA_DOI).getByRole("button", { name: "Show in list", exact: true }).click();
  await expect(page.locator("table.scr tbody tr")).toHaveCount(7);
  expect(await screenerRows(page)).toEqual(doiOrder);
  await expect(pinBtn(page, NVDA_DOI)).toBeFocused();

  // A row hidden by the index filter is reported; the filter is left alone.
  const spyChip = page.locator(".scr-belt").getByRole("button", { name: "SPY", exact: true });
  await spyChip.click();
  await trayPin(page, NVDA_DOI).getByRole("button", { name: "Show in list", exact: true }).click();
  await expect(tray(page).getByRole("status")).toHaveText(
    "NVDA 2026-07-18 150 Call is in the list but hidden by the current index filter. The filter was left as it is.",
  );
  await expect(spyChip).toHaveAttribute("aria-pressed", "true");
  await spyChip.click();

  // Remove and clear.
  await trayPin(page, NVDA_HOT).getByRole("button", { name: /^Remove / }).click();
  await expect(tray(page)).toContainText("3 of 4 pinned");
  await expect(pinBtn(page, NVDA_DOI)).toHaveAttribute("aria-pressed", "true");
  await tray(page).getByRole("button", { name: "Clear", exact: true }).click();
  await expect(tray(page)).toContainText("0 of 4 pinned");
  await expect(tray(page).getByRole("button", { name: "Compare", exact: true })).toBeDisabled();
  expect(await screenerRows(page)).toEqual(doiOrder);
});

test("Chinese copy keeps the reference-mark and unknown-term wording", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await routeFlow(page);
  await setLang(page, "zh");
  await page.goto("/options?tab=screener");
  await openPreset(page, "持仓增长");
  await expect(page.locator("table.scr tbody tr")).toHaveCount(7);
  const before = await screenerRows(page);

  await pinBtn(page, NVDA_DOI).click();
  await pinBtn(page, NVDA1_DOI).click();
  await expect(tray(page)).toContainText("已固定 2/4");
  await expect(trayPin(page, NVDA1_DOI)).toContainText("NVDA1 2026-07-18 150 认购");
  await tray(page).getByRole("button", { name: "对比", exact: true }).click();
  await expect(fieldRow(page, "mid").locator("th")).toContainText("参考价，不可成交");
  await expect(fieldRow(page, "bid_ask").locator("td").first()).toHaveText("未提供：该数据源没有实时报价");
  await expect(fieldRow(page, "multiplier").locator("td").first()).toHaveText("未提供，不假定为标准");
  await expect(tray(page)).toContainText("以数字结尾的代码通常为调整后合约");
  await expect(fieldRow(page, "mid").locator("td").first()).toContainText("2026-07-04 收盘买卖中间价");
  expect(await screenerRows(page)).toEqual(before);
  if (testInfo.project.name !== "desktop") {
    await expectTapTarget(pinBtn(page, NVDA_DOI), { width: 44, height: 44 });
    await expectTapTarget(tray(page).getByRole("button", { name: "收起对比", exact: true }), { height: 44 });
  }
  await expectNoPageOverflow(page);
});

test("real entitled screener rows compare without any new data request", async ({ page }) => {
  test.setTimeout(90_000);
  const loaded = new Set<string>();
  const during = new Set<string>();
  let pinning = false;
  page.on("request", (req) => {
    const u = new URL(req.url());
    if (!u.pathname.startsWith("/api/")) return;
    (pinning ? during : loaded).add(`${u.pathname}?f=${u.searchParams.get("f") ?? ""}`);
  });
  await setLang(page, "en");
  await page.goto("/options?tab=screener");
  await openPreset(page, "ΔOI Builds");
  const firstDoi = page.locator("table.scr tbody tr").first().locator("[data-contract-pin]");
  await expect(firstDoi).toBeVisible();
  expect([...loaded]).toEqual(expect.arrayContaining(["/api/flow?f=oi", "/api/flow?f=hot"]));

  pinning = true;
  await firstDoi.click();
  await openPreset(page, "Hot Contracts");
  await page.locator("table.scr tbody tr").first().locator("[data-contract-pin]").click();
  await tray(page).getByRole("button", { name: "Compare", exact: true }).click();
  const panel = tray(page).locator("[data-like-for-like]");
  await expect(panel).toHaveAttribute("data-like-for-like", "no");
  await expect(panel.locator("[data-compare-warnings]")).toContainText("different sessions (2026-07-04, 2026-07-05)");
  await expect(fieldRow(page, "mid").locator("td").first()).toContainText("$1.24");
  await expect(fieldRow(page, "close").locator("td").nth(1)).toContainText("$135.70");
  await expect(fieldRow(page, "bid_ask").locator('td[data-cell-state="not_supplied"]')).toHaveCount(2);
  await expect(fieldRow(page, "multiplier").locator('td[data-cell-state="not_supplied"]')).toHaveCount(2);
  // Pinning and comparing reuse the rows already on the page: no quote feed,
  // pricing engine or other endpoint the page had not already read is requested.
  expect([...during].filter((r) => !loaded.has(r))).toEqual([]);
});

test.describe("PR crops", () => {
  test.skip(!process.env.TERMINAL_CROPS, "Crop generator — set TERMINAL_CROPS=1 to write PR artifacts.");
  const OUT = join(process.cwd(), "..", "docs", "pr-crops", "e15-contract-shortlist");

  for (const lang of ["en", "zh"] as const) {
    test(`crop ${lang}`, async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      mkdirSync(OUT, { recursive: true });
      await routeFlow(page);
      await setLang(page, lang);
      await page.goto("/options?tab=screener");
      await openPreset(page, lang === "zh" ? "持仓增长" : "ΔOI Builds");
      await expect(page.locator("table.scr tbody tr")).toHaveCount(7);
      await pinBtn(page, NVDA_DOI).click();
      await pinBtn(page, NVDA1_DOI).click();
      await pinBtn(page, SPY_DOI).click();
      await openPreset(page, lang === "zh" ? "热门合约" : "Hot Contracts");
      await pinBtn(page, NVDA_HOT).click();
      await tray(page).getByRole("button", { name: lang === "zh" ? "对比" : "Compare", exact: true }).click();
      await expect(tray(page).locator("[data-like-for-like]")).toBeVisible();
      await page.mouse.move(0, 0);
      const vp = testInfo.project.name;
      // What the user sees at the project's own viewport, with the shortlist at the top.
      await tray(page).evaluate((el) => el.scrollIntoView({ block: "start" }));
      await page.screenshot({ path: join(OUT, `${vp}-${lang}-dark-viewport.png`), animations: "disabled" });
      // Whole-element crops: at desktop/tablet the results region is an inner
      // scroller that clips anything below its fold, so the crops are taken at
      // the same WIDTH with a taller window. Layout depends on width only.
      const size = page.viewportSize()!;
      await page.setViewportSize({ width: size.width, height: 2400 });
      await page.mouse.move(0, 0);
      await tray(page).screenshot({ path: join(OUT, `${vp}-${lang}-dark-compare.png`), animations: "disabled" });
      await openPreset(page, lang === "zh" ? "持仓增长" : "ΔOI Builds");
      await page.locator("table.scr").scrollIntoViewIfNeeded();
      await page.mouse.move(0, 0);
      await page.locator("table.scr").locator("xpath=ancestor::div[contains(@class,'obs-card')][1]").screenshot({
        path: join(OUT, `${vp}-${lang}-dark-pinned-rows.png`),
        animations: "disabled",
      });
      await page.setViewportSize(size);
    });
  }
});
