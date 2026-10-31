import { mkdirSync } from "node:fs";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import type { Ack, ChartCommandTarget } from "../lib/chartBus";
import { useLang } from "./layoutStore";
import { e2eWatchlistOwner, isolateWatchlistStore, seedOwnerWatchlists } from "./watchlistStore";

// E20 x E16: the palette's review rows name the FROZEN review session's own neighbours and step
// the review through the same owner its bar buttons use — the position advances with the chart,
// the landing company is the itinerary's, and a null neighbour is the edge, never a substitute.
// The real shell, the real palette and the real frozen itinerary; deterministic feed/auth fixtures.


type ChartMirror = {
  origin_id: string;
  context_revision: number;
  session?: { symbol: string; tf: string; pane_id: number };
  acks?: Ack[];
};

async function mirroredTarget(page: Page, mirrors: ChartMirror[], symbol: string): Promise<ChartCommandTarget> {
  const identity = await page.evaluate(() => {
    const cfg = (window as unknown as {
      MM_BRAIN_CFG?: { getAiContext?: () => { origin_id: string; context_revision: number } | undefined };
    }).MM_BRAIN_CFG;
    const context = cfg?.getAiContext?.();
    if (!context) throw new Error("The real chart identity is absent");
    return { origin_id: context.origin_id, context_revision: context.context_revision };
  });
  await expect.poll(() => mirrors.at(-1), { timeout: 10_000 })
    .toMatchObject({ ...identity, session: { symbol } });
  const session = mirrors.at(-1)!.session!;
  return { schema: "chart.command_target.v1", ...identity,
    pane_id: session.pane_id, symbol: session.symbol, tf: session.tf };
}

async function commandEma(page: Page, target: ChartCommandTarget, seq: number) {
  await page.evaluate(({ target, seq }) => {
    const cfg = (window as unknown as { MM_BRAIN_CFG?: { onCommand?: (command: unknown) => void } }).MM_BRAIN_CFG;
    if (!cfg?.onCommand) throw new Error("The real Brain command callback is absent");
    cfg.onCommand({ on: true, v: 2, batch_id: "palette-review-target-roundtrip", seq, target,
      op: "chart.set_indicators", args: { indicators: [{ name: "ema", params: { len: 37 } }] } });
  }, { target, seq });
}

const indicatorState = (page: Page) => page.evaluate(() => ({
  indicators: JSON.parse(localStorage.getItem("mm.inds") || "[]"),
  parameters: JSON.parse(localStorage.getItem("mm.indParams") || "{}"),
}));

const LIST = "Review Mix";
// ZZZQ is in no manifest: the frozen review skips it by name, in both directions.
const ORDER = ["NVDA", "ZZZQ", "MSFT", "AAPL", "AMD"];
const SEED = {
  lists: { Default: [], [LIST]: ORDER.map((symbol) => ({ symbol, section: "" })) },
  active: LIST,
  meta: { Default: { sections: [], collapsed: [] }, [LIST]: { sections: [], collapsed: [] } },
};

const COPY = {
  en: {
    dialog: /^Actions$/,
    region: "Watchlist review",
    start: "Review this list",
    skipped: "Skipped ZZZQ (no market data).",
    edge: "No further item in this review",
    position: (n: number, t: number) => `${n} of ${t}`,
    searchNext: "next review",
    searchPrev: "previous review",
  },
  zh: {
    dialog: /^操作$/,
    region: "自选列表复盘",
    start: "逐个复盘此列表",
    skipped: "已跳过 ZZZQ（无行情数据）。",
    edge: "本次复盘没有更多项目",
    position: (n: number, t: number) => `第 ${n} / ${t} 个`,
    searchNext: "下一项",
    searchPrev: "上一项",
  },
} as const;

const CROP_DIR = "docs/pr-crops/e20-e16-palette-review-rows";
/** PR screenshots, written only when TERMINAL_CROPS is set (the same switch study-templates.spec.ts uses). */
async function crop(page: Page, name: string, testInfo: TestInfo, rows: Locator) {
  if (!process.env.TERMINAL_CROPS) return;
  mkdirSync(CROP_DIR, { recursive: true });
  // The review rows sit below the research rows; bring them into the shot.
  await rows.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  await page.screenshot({ path: `${CROP_DIR}/${testInfo.project.name}-${name}.png`, animations: "disabled" });
}

/** The chart's active security, read from the context owner Brain/linked panels consume. */
const chartSymbol = (page: Page) => page.evaluate(() => {
  const cfg = (window as unknown as { MM_BRAIN_CFG?: { getAiContext?: () => { active?: { id: string } } } }).MM_BRAIN_CFG;
  return cfg?.getAiContext?.().active?.id ?? null;
});
const wide = (page: Page) => (page.viewportSize()?.width ?? 0) > 860;
const isTouch = (testInfo: TestInfo) => testInfo.project.name !== "desktop";

async function boot(page: Page, testInfo: TestInfo, baseURL: string | undefined, lang: "en" | "zh") {
  const storeKey = await isolateWatchlistStore(page, testInfo, baseURL);
  await seedOwnerWatchlists(page, storeKey, SEED);
  await useLang(page, lang);
  await page.route("https://www.mastermind-x.com/mm_brain.js", (route) => route.fulfill({ contentType: "application/javascript", body: "window.MMBrain={mounted:true,open(){},close(){},toggle(){}};" }));
  await page.goto("/terminal?symbol=SPY");
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
  return { storeKey, owner: e2eWatchlistOwner(storeKey) };
}

/** Desktop starts from the list menu; at ≤860px (where the rail board is hidden) from the idle control. */
async function startReview(page: Page, lang: "en" | "zh") {
  if (wide(page)) {
    await expect(page.locator(".wl-select")).toContainText(LIST);
    await expect(page.locator(".wl-row")).toHaveCount(ORDER.length);
    await page.locator(".wl-select").click();
    const entry = page.getByTestId("wl-review-start");
    await expect(entry).toHaveText(COPY[lang].start);
    await entry.click();
  } else {
    const idle = page.getByTestId("wl-review-idle-start");
    await expect(idle).toContainText(LIST, { timeout: 30_000 });
    await idle.scrollIntoViewIfNeeded();
    await idle.click();
  }
  const region = page.getByRole("region", { name: COPY[lang].region });
  await expect(region).toBeVisible();
  return region;
}

/** Desktop opens with the ">" key; touch layouts open from the button in the mobile nav. */
async function openPalette(page: Page, testInfo: TestInfo, lang: "en" | "zh") {
  if (isTouch(testInfo)) {
    const trigger = page.locator("[data-command-palette-trigger=mobile]");
    await expect(trigger).toBeVisible();
    await trigger.click();
  } else {
    await page.keyboard.press(">");
  }
  const dialog = page.getByRole("dialog", { name: COPY[lang].dialog });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function search(page: Page, testInfo: TestInfo, query: string) {
  const box = page.locator("[data-command-palette] input[role=combobox]");
  // The phone sheet focuses itself, not the field, so the keyboard does not cover the list.
  if (isTouch(testInfo)) await box.click();
  await expect(box).toBeFocused();
  await box.fill(query);
}

/** Desktop confirms with Enter; touch taps the row, as a person would. */
async function runAction(page: Page, testInfo: TestInfo, id: string) {
  const row = page.locator(`[data-command-palette] [data-action-id='${id}']`);
  await expect(row).toBeVisible();
  if (isTouch(testInfo)) await row.click();
  else {
    await expect(row).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
  }
}

for (const lang of ["en", "zh"] as const) {
  test(`${lang}: the palette's review rows name the frozen neighbours and step the review itself`, async ({ page, baseURL }, testInfo) => {
    test.setTimeout(180_000);
    const c = COPY[lang];
    const mirrors: ChartMirror[] = [];
    await page.route("**/api/brain/chart/state", async route => {
      mirrors.push(route.request().postDataJSON());
      await route.fulfill({ json: { ok: true } });
    });
    await boot(page, testInfo, baseURL, lang);
    const region = await startReview(page, lang);
    const current = region.getByTestId("wl-review-current");

    // The frozen session starts at NVDA; the chart follows it, as the bar's own start does.
    await expect(current).toHaveText("NVDA");
    await expect(region.getByTestId("wl-review-position")).toHaveText(c.position(1, 5));
    await expect.poll(() => chartSymbol(page)).toBe("NVDA");
    const firstTarget = await mirroredTarget(page, mirrors, "NVDA");

    // The rows name the session's own frozen neighbours: next is MSFT (ZZZQ skipped by name),
    // and at the first stop the previous row is the edge — never the live list's neighbour.
    const dialog = await openPalette(page, testInfo, lang);
    const nextRow = dialog.locator("[data-action-id='review:next']");
    await expect(nextRow).toContainText("MSFT");
    await expect(nextRow).not.toHaveAttribute("aria-disabled", "true");
    const prevRow = dialog.locator("[data-action-id='review:previous']");
    await expect(prevRow).toHaveAttribute("aria-disabled", "true");
    await expect(prevRow).toContainText(c.edge);
    await crop(page, `rows-first-stop-${lang}`, testInfo, prevRow);

    // Running "next review" steps the review itself: same company, same skip notice, same chart
    // move as the bar's own Next button (the assertions watchlist-review.spec.ts uses for it).
    await search(page, testInfo, c.searchNext);
    await runAction(page, testInfo, "review:next");
    await expect(dialog).toBeHidden();
    await expect(current).toHaveText("MSFT");
    await expect(region.getByTestId("wl-review-notice")).toHaveText(c.skipped);
    await expect(region.getByTestId("wl-review-position")).toHaveText(c.position(3, 5));
    await expect.poll(() => chartSymbol(page)).toBe("MSFT");


    const nextTarget = await mirroredTarget(page, mirrors, "MSFT");
    expect(nextTarget.origin_id).toBe(firstTarget.origin_id);
    expect(nextTarget.context_revision).toBeGreaterThan(firstTarget.context_revision);

    // Returning through the new palette route must never revive an earlier AI target.
    const back = await openPalette(page, testInfo, lang);
    await search(page, testInfo, c.searchPrev);
    await runAction(page, testInfo, "review:previous");
    await expect(back).toBeHidden();
    await expect(current).toHaveText("NVDA");
    await expect(region.getByTestId("wl-review-position")).toHaveText(c.position(1, 5));
    await expect.poll(() => chartSymbol(page)).toBe("NVDA");
    const returnedTarget = await mirroredTarget(page, mirrors, "NVDA");
    expect(returnedTarget.origin_id).toBe(firstTarget.origin_id);
    expect(returnedTarget.context_revision).toBeGreaterThan(nextTarget.context_revision);
    const beforeStale = await indicatorState(page);
    await commandEma(page, firstTarget, 1);
    await expect.poll(() => mirrors.flatMap(row => row.acks || []).find(ack => ack.seq === 1), { timeout: 10_000 })
      .toMatchObject({ ok: false, error: "command_target_revision_mismatch" });
    expect(await indicatorState(page)).toEqual(beforeStale);

    // A fresh target must still apply through the real host and return its generated receipt.
    const freshTarget = await mirroredTarget(page, mirrors, "NVDA");
    await commandEma(page, freshTarget, 2);
    await expect.poll(() => mirrors.flatMap(row => row.acks || []).find(ack => ack.seq === 2), { timeout: 10_000 })
      .toMatchObject({ ok: true, application: { schema: "chart.command_application.v1",
        predecessor: freshTarget, successor: { ...freshTarget, context_revision: freshTarget.context_revision + 1 } } });
    await expect.poll(() => indicatorState(page)).toMatchObject({
      indicators: ["ema"], parameters: { ema: { len: 37 } },
    });

    const forward = await openPalette(page, testInfo, lang);
    await search(page, testInfo, c.searchNext);
    await runAction(page, testInfo, "review:next");
    await expect(forward).toBeHidden();
    await expect(current).toHaveText("MSFT");
    await expect(region.getByTestId("wl-review-position")).toHaveText(c.position(3, 5));

    // Walk to the end of the frozen itinerary through the palette.
    for (const [symbol, place] of [["AAPL", 4], ["AMD", 5]] as const) {
      const reopened = await openPalette(page, testInfo, lang);
      await expect(reopened.locator("[data-action-id='review:next']")).toContainText(symbol);
      await search(page, testInfo, c.searchNext);
      await runAction(page, testInfo, "review:next");
      await expect(reopened).toBeHidden();
      await expect(current).toHaveText(symbol);
      await expect(region.getByTestId("wl-review-position")).toHaveText(c.position(place, 5));
    }
    await expect.poll(() => chartSymbol(page)).toBe("AMD");

    // At the last stop the next row reads the edge explanation; previous still names AAPL and runs.
    const last = await openPalette(page, testInfo, lang);
    await expect(last.locator("[data-action-id='review:next']")).toHaveAttribute("aria-disabled", "true");
    await expect(last.locator("[data-action-id='review:next']")).toContainText(c.edge);
    await expect(last.locator("[data-action-id='review:previous']")).toContainText("AAPL");
    await crop(page, `rows-last-stop-${lang}`, testInfo, last.locator("[data-action-id='review:previous']"));
    await search(page, testInfo, c.searchPrev);
    await runAction(page, testInfo, "review:previous");
    await expect(last).toBeHidden();
    await expect(current).toHaveText("AAPL");
    await expect(region.getByTestId("wl-review-position")).toHaveText(c.position(4, 5));
    await expect.poll(() => chartSymbol(page)).toBe("AAPL");
    await testInfo.attach("palette-review-chart-receipts", { body: JSON.stringify(mirrors), contentType: "application/json" });
  });
}
