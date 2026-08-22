import { expect, test, type Page } from "./fixtures";

// Operator report (2026-08-05, 000001.SS): switching to a symbol with no daily history left the
// PREVIOUS symbol's candles, volume and studies on the chart under the new symbol's badge — and the
// live-quote poll then spliced the new symbol's price onto those bars, printing one giant candle
// (3,878 on top of a ~17 CNY series) with the scale blown out to 0–4400 and a +1881% status line.
// A dead-ended fetch must leave the pane EMPTY. The symbol below is synthetic on purpose: any real
// ticker could gain a fixture later and silently turn this guard vacuous.
const NO_DATA_SYM = "NOSUCH.TEST";

type PaneState = { rowCount: number | null; tag: string | null; emptyShown: boolean; emptyMsg: string; backToDaily: boolean };

async function paneState(page: Page): Promise<PaneState> {
  return page.evaluate(() => {
    const w = window as Window & { __mmChartAxisOpts?: () => { rowCount?: number } | null };
    const tag = document.querySelector<HTMLElement>(".mm-ptag");
    const empty = document.querySelector<HTMLElement>(".chart-empty");
    const btn = document.querySelector<HTMLElement>(".chart-empty .ce-btn");
    return {
      rowCount: w.__mmChartAxisOpts?.()?.rowCount ?? null,
      tag: tag && tag.style.display !== "none" ? tag.textContent : null,
      emptyShown: !!empty && empty.style.display !== "none",
      emptyMsg: document.querySelector(".chart-empty .ce-msg")?.textContent ?? "",
      backToDaily: !!btn && btn.style.display !== "none",
    };
  });
}

// The in-place switch the watchlist and search use — a reload would mount a fresh panel and
// could not reproduce the defect, which is entirely about state surviving a symbol change.
const pick = (page: Page, sym: string) =>
  page.evaluate((s) => window.dispatchEvent(new CustomEvent("mm:embedded-symbol", { detail: { symbol: s } })), sym);

test("a symbol with no daily history empties the pane instead of keeping the last one's chart", async ({ page }) => {
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 45_000 });
  await expect.poll(async () => (await paneState(page)).rowCount ?? 0, { timeout: 45_000 }).toBeGreaterThan(50);
  const loaded = await paneState(page);
  expect(loaded.tag).toContain("NVDA");

  await pick(page, NO_DATA_SYM);
  await expect.poll(async () => (await paneState(page)).rowCount, { timeout: 30_000 }).toBe(0);
  const dead = await paneState(page);
  expect(dead.tag).toBeNull();                       // no last-price badge over a chart that isn't there
  expect(dead.emptyShown).toBe(true);
  expect(dead.emptyMsg).toContain(NO_DATA_SYM);
  expect(dead.backToDaily).toBe(false);              // already on daily — that CTA belongs to the intraday dead-end

  // …and the pane recovers completely on the next symbol that does have data.
  await pick(page, "AAPL");
  await expect.poll(async () => (await paneState(page)).rowCount ?? 0, { timeout: 45_000 }).toBeGreaterThan(50);
  const back = await paneState(page);
  expect(back.tag).toContain("AAPL");
  expect(back.emptyShown).toBe(false);
});
