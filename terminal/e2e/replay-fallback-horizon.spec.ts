import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { isPhoneViewport } from "./phoneChrome";
import { toggleToolbarReplay } from "./terminalToolbar";

// An answered, absent slice may use client Pine; a failed slice may not. Pine is
// evaluated on the full history, so Replay must cut its marks before nearest-bar
// snapping. Otherwise future BUY/CUT marks land on the last historical candle.
const ACT = { timeout: 20_000 } as const;
const FIXTURE_SHA = "9958c189fa1e967cdd509f533c047c046e78b093a654e24705ebe573a8948083";
const FIXTURE_ROWS = 1255;
const FIXTURE_LAST = "2026-06-26";
type BarRow = [string, number, number, number, number, number];
const rail = (page: Page) => page.locator("[data-replay-rail]");
const marks = (page: Page) => page.locator("[data-sig-layer] > g");
const lastSession = (page: Page) => page.evaluate(() => {
  const read = (window as unknown as {
    __mmLiveBarGeneration?: () => { lastBar: { time: unknown } | null }
  }).__mmLiveBarGeneration;
  const time = read?.().lastBar?.time;
  return typeof time === "string" ? time.slice(0, 10) : null;
});

async function openChart(page: Page, mode: "absent" | "unavailable"): Promise<BarRow[]> {
  const response = await page.request.get("/data/NVDA.json");
  expect(response.ok()).toBe(true);
  const bytes = await response.body();
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(FIXTURE_SHA);
  const rows = (JSON.parse(bytes.toString()) as { bars: BarRow[] }).bars;
  expect(rows).toHaveLength(FIXTURE_ROWS);
  expect(rows.at(-1)?.[0]).toBe(FIXTURE_LAST);
  await page.addInitScript(() => {
    localStorage.setItem("mm.inds", JSON.stringify(["_oracle"]));
    localStorage.setItem("mm.indHidden", "[]");
    localStorage.setItem("mm.mastermindCandles.v1", "1");
  });
  await page.route("**/api/quote?**", (route) => route.fulfill({ json: { quotes: {} } }));
  await page.route("**/data/NVDA.slice.json", (route) =>
    route.fulfill({ status: mode === "absent" ? 404 : 503, body: "" }));
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".chart-wrap").first()).toHaveAttribute("data-slice-state", mode, { timeout: 45_000 });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("mm:set-tf", { detail: { tf: "D" } })));
  await expect.poll(() => lastSession(page), { timeout: 45_000 }).toBe(FIXTURE_LAST);
  await expect(page.locator('[data-toolbar-action="replay"]')).toBeEnabled({ timeout: 45_000 });
  return rows;
}

async function atDate(page: Page, rows: BarRow[], date: string) {
  const idx = rows.findIndex((r) => r[0] === date);
  expect(idx).toBeGreaterThan(20);
  const slider = rail(page).locator('input[type="range"]');
  await slider.focus(ACT);
  let current = Number(await rail(page).getAttribute("data-replay-idx"));
  expect(Number.isInteger(current) && current >= 20 && current < rows.length).toBe(true);
  // Keep the current position when it is closer. Neighboring cutoff dates should
  // take one real keyboard step, not replay the whole route from the live tail.
  if (Math.abs(current - idx) > rows.length - 1 - idx) {
    await page.keyboard.press("End");
    current = rows.length - 1;
    await expect(rail(page)).toHaveAttribute("data-replay-idx", String(current), ACT);
  }
  const key = current > idx ? "ArrowLeft" : "ArrowRight";
  for (let i = 0; i < Math.abs(current - idx); i++) await page.keyboard.press(key);
  await expect(rail(page)).toHaveAttribute("data-replay-idx", String(idx), ACT);
  await expect.poll(() => lastSession(page), ACT).toBe(date);
}

for (const mode of ["absent", "unavailable"] as const) {
  test(`Replay fallback horizon over an ${mode} slice`, async ({ page }) => {
    test.skip(isPhoneViewport(page), "no phone entry point for Bar Replay (Analysis hub has no replay tile)");
    test.slow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const rows = await openChart(page, mode);
    // _oracle is the only active drawing study and this slice has no other stream.
    // The live count prevents the Replay assertions from passing on an empty chart.
    await expect(marks(page)).toHaveCount(mode === "absent" ? 81 : 0, ACT);
    if (mode === "unavailable") {
      await expect(page.locator(".statusline .mm", { hasText: "Golden Oracle" })).toContainText("Signals unavailable", ACT);
    }
    await toggleToolbarReplay(page);
    await expect(rail(page)).toBeVisible(ACT);
    await expect(rail(page)).toHaveAttribute("data-replay-total", String(rows.length), ACT);
    for (const [date, count] of [["2026-03-09", 75], ["2026-03-10", 75], ["2026-03-11", 76]] as const) {
      await atDate(page, rows, date);
      await expect(marks(page)).toHaveCount(mode === "absent" ? count : 0, ACT);
    }
    await toggleToolbarReplay(page);
    await expect(rail(page)).toHaveCount(0, ACT);
    await expect.poll(() => lastSession(page), ACT).toBe(FIXTURE_LAST);
    await expect(marks(page)).toHaveCount(mode === "absent" ? 81 : 0, ACT);
    expect(errors).toEqual([]);
  });
}
