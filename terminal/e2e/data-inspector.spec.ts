import { expect, test, type Download, type Locator, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { isPhoneViewport } from "./phoneChrome";
import { useLang } from "./layoutStore";
import { toggleToolbarReplay } from "./terminalToolbar";
import { expectTapTarget } from "./tapTarget";

// ── E10 Time-aware Data Inspector ────────────────────────────────────────────────────────────────
// A deterministic two-session 5-minute fixture: every bar has its own time key, so two bars on the
// same date (10:00 and 10:05) must stay individually addressable through sorting, the virtual
// window, a round trip to the chart, the comparison and the CSV. The falsifier this suite carries:
// selection or export that follows a ROW NUMBER instead of the bar time names different bars once
// the order flips — the "after sort" assertions below then fail.

const SESSIONS = [8, 9];                       // Thu 2026-10-08, Fri 2026-10-09
const PER_SESSION = 78;                        // 09:30 … 15:55
const TOTAL = SESSIONS.length * PER_SESSION;
const at = (day: number, h: number, m: number) => Date.UTC(2026, 9, day, h, m) / 1000;
const closeOf = (day: number, i: number) => Math.round((150 + (day - 8) * 10 + i * 0.25) * 100) / 100;

function fixtureBars(): number[][] {
  const out: number[][] = [];
  for (const day of SESSIONS) {
    for (let i = 0; i < PER_SESSION; i++) {
      const c = closeOf(day, i);
      const o = Math.round((c - 0.1) * 100) / 100;
      out.push([at(day, 9, 30) + i * 300, o, Math.round((c + 0.3) * 100) / 100, Math.round((o - 0.3) * 100) / 100, c, 10_000 + i * 100]);
    }
  }
  return out;
}

/** The dev-only chart probes this suite reads (shapes trimmed to the fields used). */
type AxisProbe = { timeframe: string; rowCount: number; contextProof: { priceRows: { time: string | number }[] } };
type PaneSyncProbe = {
  panes: { id: number; logical: { from: number; to: number } | null }[];
  focus: { id: number; status: string; time: string | number; tf: string; index: number | null } | null;
};
type Probes = { __mmChartAxisOpts?: () => AxisProbe; __mmPaneSync?: () => PaneSyncProbe };
const axisProbe = (page: Page) => page.evaluate(() => (window as unknown as Probes).__mmChartAxisOpts?.() ?? null);

const TEN = at(9, 10, 0);
const TEN_05 = at(9, 10, 5);
const NINE_55 = at(9, 9, 55);
const TEN_10 = at(9, 10, 10);

async function seedIntraday(page: Page) {
  const bars = fixtureBars();
  await page.route("**/api/intraday?**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("sym") !== "NVDA" || url.searchParams.get("tf") !== "5m") return route.continue();
    await route.fulfill({ json: { t: "NVDA", tf: "5m", source: "data-inspector-e2e", session_date: "2026-10-09", bars } });
  });
  // No live packet may append a bar the fixture does not hold.
  await page.route("**/api/quote?**", (route) => route.fulfill({ json: { quotes: {} } }));
  await page.addInitScript(() => {
    localStorage.setItem("mm.startTf", JSON.stringify("5m"));
    localStorage.setItem("mm.inds", JSON.stringify(["ema", "vol"]));
    localStorage.removeItem("mm.ws");
  });
}

async function openChart(page: Page, rows: number | null, tf: string) {
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => {
    const p = await axisProbe(page);
    return p ? `${p.timeframe}:${p.rowCount}` : null;
  }, { timeout: 20_000 }).toMatch(rows == null ? new RegExp(`^${tf}:\\d+$`) : new RegExp(`^${tf}:${rows}$`));
}

/**
 * The chart's context menu (z-index 8) can open across a lightweight-charts pane-resize strip
 * (9px, z-index 50) — with Bar Replay's rail shifting the chart down, "Table view" lands on it.
 * Pre-existing and outside E10; a user simply clicks another part of the row, so do the same:
 * Playwright's trial click proves the chosen point really receives the click.
 */
async function clickUnobstructed(target: Locator) {
  await expect(target).toBeVisible();
  const box = (await target.boundingBox())!;
  for (const y of [box.height / 2, 5, box.height - 5]) {
    const position = { x: Math.min(48, box.width / 2), y };
    try { await target.click({ position, trial: true, timeout: 1_500 }); } catch { continue; }
    await target.click({ position });
    return;
  }
  await target.click();
}

/** The phone opens it from the Analysis hub; wider layouts from the chart's context menu. */
async function openInspector(page: Page): Promise<Locator> {
  if (isPhoneViewport(page)) {
    await page.getByTestId("roller-more").click();
    const hub = page.getByRole("dialog", { name: /Analysis hub|分析中心/ });
    await expect(hub).toBeVisible();
    await hub.getByTestId("hub-tile-dataTable").click();
  } else {
    const chart = page.locator(".chart-wrap").first();
    const bounds = await chart.boundingBox();
    expect(bounds).not.toBeNull();
    await chart.click({ button: "right", position: { x: Math.min(100, bounds!.width * 0.25), y: Math.min(180, bounds!.height * 0.4) } });
    await clickUnobstructed(page.locator('.ctx-menu [data-a="tableview"]'));
  }
  const inspector = page.locator("[data-data-inspector]");
  await expect(inspector).toBeVisible({ timeout: 20_000 });
  return inspector;
}

/** Nothing (the shell's floating fullscreen control, a menu) sits on top of this control. */
async function expectUncovered(target: Locator) {
  await expect(target).toBeVisible();
  const covered = await target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const points = [[r.left + r.width / 2, r.top + r.height / 2], [r.right - 3, r.top + r.height / 2], [r.left + 3, r.top + r.height / 2]];
    return points
      .map(([x, y]) => document.elementFromPoint(x, y))
      .filter((hit) => !hit || !(hit === el || el.contains(hit)))
      .map((hit) => (hit ? `${hit.tagName}.${hit.className}` : "nothing"));
  });
  expect(covered, "elements covering the control").toEqual([]);
}

/** At ≤860px the shell page-scrolls and the grid keeps a fixed height below the panels. */
const pageScrolls = (page: Page) => (page.viewportSize()?.width ?? 1440) <= 860;

/**
 * Evidence crop. A full-page capture re-emulates the viewport and drops touch emulation mid-shot
 * (the rows re-render at mouse height), so page-scrolled layouts are framed in the real viewport
 * instead: the comparison at the top, the grid scrolled so the selected rows sit just below it.
 * Framing only — the identity assertions run before this, on the layout the user gets.
 */
async function captureCrop(page: Page, inspector: Locator, path: string) {
  if (pageScrolls(page)) {
    await inspector.getByRole("grid").evaluate((grid) => {
      const picked = [...grid.querySelectorAll<HTMLElement>('[role="row"][aria-selected="true"]')];
      if (!picked.length) return;
      const first = Math.min(...picked.map((r) => Number(r.getAttribute("aria-rowindex")) - 2));
      grid.scrollTop = Math.max(0, (first - 1) * picked[0].offsetHeight);
    });
    await inspector.locator("section[data-diff]").evaluate((el) => {
      el.querySelector("table")?.parentElement?.scrollTo({ left: 0 });
      el.scrollIntoView({ block: "start" });
    });
    await expect(inspector.locator('[role="row"][aria-selected="true"]').first()).toBeInViewport();
  }
  await page.mouse.move(0, 0);
  await page.screenshot({ path, animations: "disabled" });
}

const row = (inspector: Locator, time: number | string) => inspector.locator(`[role="row"][data-row-key="${time}"]`);

/** Touch projects select rows with a real tap; desktop with a click. */
async function press(target: Locator, touch: boolean) {
  if (touch) await target.tap();
  else await target.click();
}
const isTouch = (info: TestInfo) => Boolean(info.project.use.hasTouch);

async function jump(inspector: Locator, value: string, label = "Go to time") {
  await inspector.getByLabel(label, { exact: true }).fill(value);
  await inspector.getByRole("button", { name: /^(Go|前往)$/ }).click();
}

async function readCsv(download: Download) {
  const path = await download.path();
  expect(path).not.toBeNull();
  const text = readFileSync(path!, "utf8");
  expect(text.charCodeAt(0), "the export opens with a UTF-8 BOM").toBe(0xfeff);
  const lines = text.slice(1).split("\n");
  const meta: Record<string, string> = {};
  for (const line of lines.filter((l) => l.startsWith("# "))) {
    const m = /^# ([a-z_]+): (.*)$/.exec(line);
    expect(m, line).not.toBeNull();
    meta[m![1]] = m![2];
  }
  const body = lines.filter((l) => l && !l.startsWith("#"));
  return { meta, header: body[0].split(","), rows: body.slice(1).map((l) => l.split(",")) };
}

/** The theme's rise, fall and plain cell colours, resolved inside the inspector. */
async function toneColours(inspector: Locator) {
  return inspector.evaluate((root) => {
    const resolve = (token: string) => {
      const probe = document.createElement("span");
      probe.style.color = `var(${token})`;
      root.appendChild(probe);
      const colour = getComputedStyle(probe).color;
      probe.remove();
      return colour;
    };
    return { up: resolve("--up"), down: resolve("--down"), plain: resolve("--text-2") };
  });
}

async function focusProbe(page: Page) {
  return page.evaluate(() => {
    const probe = (window as unknown as Probes).__mmPaneSync?.();
    const focus = probe?.focus;
    if (!probe || !focus) return null;
    const pane = probe.panes.find((p) => p.id === focus.id);
    const index = focus.index;
    const inView = pane?.logical && index != null ? index >= pane.logical.from && index <= pane.logical.to : false;
    return { status: focus.status, time: focus.time, tf: focus.tf, index, inView };
  });
}

test.describe("Data Inspector on a same-date intraday fixture", () => {
  test.beforeEach(async ({ page }) => {
    await seedIntraday(page);
    await openChart(page, TOTAL, "5m");
  });

  test("two same-date bars keep their identity through sort, comparison, return to chart and export", { tag: "@e10" }, async ({ page }, testInfo) => {
    test.slow();
    const inspector = await openInspector(page);
    await expect(inspector).toHaveAttribute("data-row-count", String(TOTAL), { timeout: 20_000 });
    await expect(inspector).toHaveAttribute("data-generation", "NVDA|5m");
    await expect(inspector.getByText("Exchange clock: New York", { exact: true })).toBeVisible();
    // The chart's floating fullscreen control (tablet/phone) must not sit over the table's controls.
    await expectUncovered(inspector.getByRole("button", { name: "Back to chart", exact: true }));
    await expectUncovered(inspector.getByRole("button", { name: "Go", exact: true }));

    // AC-E10-01: the two bars are addressable by time and visibly different rows.
    await jump(inspector, "2026-10-09T10:00");
    await expect(row(inspector, TEN)).toHaveAttribute("data-focused", "");
    await expect(row(inspector, TEN)).toContainText("2026-10-09 10:00");
    await expect(row(inspector, TEN_05)).toContainText("2026-10-09 10:05");
    await press(row(inspector, TEN), isTouch(testInfo));
    await press(row(inspector, TEN_05), isTouch(testInfo));
    await expect(inspector.getByText("2 selected", { exact: true })).toBeVisible();
    for (const t of [TEN, TEN_05]) await expect(row(inspector, t)).toHaveAttribute("aria-selected", "true");
    for (const t of [NINE_55, TEN_10]) await expect(row(inspector, t)).toHaveAttribute("aria-selected", "false");
    if (testInfo.project.name !== "desktop") {
      await expectTapTarget(inspector.getByRole("button", { name: "Compare", exact: true }), { height: 44 });
      await expectTapTarget(row(inspector, TEN), { height: 44 });
    }

    // AC-E10-02: flipping the order (and with it every virtual row position) keeps the same bars.
    const grid = inspector.getByRole("grid");
    await inspector.getByRole("button", { name: "Oldest first", exact: true }).click();
    await expect(grid).toHaveAttribute("data-sort", "asc");
    await expect(inspector.getByText("2 selected", { exact: true })).toBeVisible();
    await jump(inspector, "2026-10-09T10:00");
    for (const t of [TEN, TEN_05]) await expect(row(inspector, t)).toHaveAttribute("aria-selected", "true");
    for (const t of [NINE_55, TEN_10]) await expect(row(inspector, t)).toHaveAttribute("aria-selected", "false");
    const [y10, y1005] = await Promise.all([row(inspector, TEN).boundingBox(), row(inspector, TEN_05).boundingBox()]);
    expect(y10!.y, "oldest first puts 10:00 above 10:05").toBeLessThan(y1005!.y);

    // AC-E10-04: the comparison reads the same prices and study values the rows show.
    await inspector.getByRole("button", { name: "Compare", exact: true }).click();
    const diff = inspector.locator("section[data-diff]");
    await expect(diff).toBeVisible();
    await expect(diff.locator(`[data-diff-earlier="${TEN}"]`)).toHaveText("2026-10-09 10:00");
    await expect(diff.locator(`[data-diff-later="${TEN_05}"]`)).toHaveText("2026-10-09 10:05");
    const close = diff.locator('tr[data-diff-field="close"] td');
    await expect(close.nth(0)).toHaveText(closeOf(9, 6).toFixed(2));
    await expect(close.nth(1)).toHaveText(closeOf(9, 7).toFixed(2));
    await expect(close.nth(2)).toHaveText("+0.25");
    // A rise keeps the theme's rise colour; the comparison's grey cell colour must not override it.
    const tone = await toneColours(inspector);
    expect(tone.up, "the theme's rise and fall colours differ").not.toBe(tone.down);
    await expect(close.nth(2)).toHaveCSS("color", tone.up);
    await expect(close.nth(0)).toHaveCSS("color", tone.plain);
    const studyKeys = await inspector.locator(".ctv-th[data-column-key]").evaluateAll((els) => els.map((el) => el.getAttribute("data-column-key")!));
    expect(studyKeys).toContain("ema");
    const headerIndex = await inspector.locator('.ctv-thead [role="columnheader"]').evaluateAll(
      (els) => els.findIndex((el) => el.getAttribute("data-column-key") === "ema"));
    const shown = await Promise.all([TEN, TEN_05].map((t) => row(inspector, t).locator('[role="gridcell"]').nth(headerIndex).innerText()));
    expect(shown.every((v) => /\d/.test(v)), `EMA cells ${shown}`).toBe(true);
    const emaDiff = diff.locator('tr[data-diff-field="ema"] td');
    await expect(emaDiff.nth(0)).toHaveText(shown[0]);
    await expect(emaDiff.nth(1)).toHaveText(shown[1]);
    await expect(diff.getByText("1 bar apart · later minus earlier", { exact: true })).toBeVisible();
    // A narrow screen scrolls the numbers sideways; the field name stays readable beside them.
    const laterPct = diff.locator('tr[data-diff-field="close"] td').nth(3);
    await laterPct.scrollIntoViewIfNeeded();
    await expect(laterPct).toBeInViewport();
    await expect(diff.locator('tr[data-diff-field="close"] th')).toBeInViewport();
    // Opening the comparison takes height from the grid; the compared rows stay in the grid's view
    // (at ≤860px the page itself scrolls, so bring the grid up first).
    const paged = pageScrolls(page);
    if (paged) await row(inspector, TEN_05).scrollIntoViewIfNeeded();
    for (const t of [TEN, TEN_05]) await expect(row(inspector, t)).toBeInViewport();

    mkdirSync("docs/pr-crops/data-inspector", { recursive: true });
    await captureCrop(page, inspector, `docs/pr-crops/data-inspector/${testInfo.project.name}-inspector.png`);

    // AC-E10-05: exactly the two selected bars, oldest first, with their metadata.
    await expect(inspector.locator("[data-export-scope]")).toHaveAttribute("data-export-scope", "selected");
    await expect(inspector.getByText("Exports 2 selected rows", { exact: true })).toBeVisible();
    const pending = page.waitForEvent("download");
    await inspector.getByRole("button", { name: "Download data", exact: true }).click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe("NVDA_5m_selection.csv");
    const csv = await readCsv(download);
    expect(csv.meta).toMatchObject({
      symbol: "NVDA", timeframe: "5m", scope: `selected rows (2 of ${TOTAL})`, order: "oldest first",
      replay: "off", as_of: "2026-10-09 15:55", missing_value: "empty cell = no value at this bar",
    });
    expect(csv.meta.time_basis).toContain("America/New_York");
    expect(csv.header.slice(0, 9)).toEqual(["time", "time_label", "open", "high", "low", "close", "change", "change_pct", "volume"]);
    expect(csv.rows.map((r) => r[0])).toEqual([String(TEN), String(TEN_05)]);
    expect(csv.rows.map((r) => r[1])).toEqual(["2026-10-09 10:00", "2026-10-09 10:05"]);
    expect(csv.rows.map((r) => Number(r[5]))).toEqual([closeOf(9, 6), closeOf(9, 7)]);
    const emaCol = csv.header.indexOf(await inspector.locator('.ctv-th[data-column-key="ema"]').evaluate((el) => el.firstChild?.textContent ?? ""));
    expect(emaCol).toBeGreaterThan(8);
    csv.rows.forEach((r, i) => expect(Number(r[emaCol]).toFixed(4)).toBe(shown[i].replace(/,/g, "")));

    // Return to the chart and back: the selection, order and comparison inputs survive the remount.
    await inspector.getByRole("button", { name: "Back to chart", exact: true }).click();
    await expect(page.locator("[data-data-inspector]")).toHaveCount(0);
    await expect(page.locator(".chart-wrap canvas").first()).toBeVisible();
    const again = await openInspector(page);
    await expect(again.getByText("2 selected", { exact: true })).toBeVisible();
    await expect(again.getByRole("grid")).toHaveAttribute("data-sort", "asc");
    await again.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(again.getByText("None selected", { exact: true })).toBeVisible();
    await expect(again.getByText(`Exports all ${TOTAL} rows`, { exact: true })).toBeVisible();

    // A rise and a fall keep their direction colour in the grid and in the comparison; the tables'
    // grey cell colour must not override it. Friday's 09:30 bar opens below Thursday's 15:55 close.
    const thuClose = at(8, 15, 55);
    const friOpen = at(9, 9, 30);
    await jump(again, "2026-10-08T15:55");
    const changeCell = (t: number) => row(again, t).getByRole("gridcell").filter({ hasText: "%)" });
    await expect(changeCell(thuClose)).toHaveCSS("color", tone.up);
    await expect(changeCell(friOpen)).toHaveCSS("color", tone.down);
    await press(row(again, thuClose), isTouch(testInfo));
    await press(row(again, friOpen), isTouch(testInfo));
    await again.getByRole("button", { name: "Compare", exact: true }).click();
    const fall = again.locator('section[data-diff] tr[data-diff-field="close"] td');
    await expect(fall.nth(2)).toHaveText("-9.25");
    await expect(fall.nth(2)).toHaveCSS("color", tone.down);
    await expect(fall.nth(0)).toHaveCSS("color", tone.plain);
  });

  test("Show on chart lands on the exact bar and a missing time is explained, not substituted", { tag: "@e10" }, async ({ page }, testInfo) => {
    test.slow();
    let inspector = await openInspector(page);

    // AC-E10-03 (missing): 10:02 is not on a 5-minute axis — no neighbour is selected or focused.
    await jump(inspector, "2026-10-09T10:02");
    const missing = inspector.locator('[data-notice="missing"]');
    await expect(missing).toContainText("No bar at 2026-10-09 10:02. Nothing was substituted.");
    await expect(inspector.locator("[role=row][data-focused]")).toHaveCount(0);
    await expect(inspector.getByText("None selected", { exact: true })).toBeVisible();
    await expect(missing.getByRole("button", { name: "Earlier bar: 2026-10-09 10:00", exact: true })).toBeVisible();
    await missing.getByRole("button", { name: "Later bar: 2026-10-09 10:05", exact: true }).click();
    await expect(row(inspector, TEN_05)).toHaveAttribute("data-focused", "");
    await expect(missing).toHaveCount(0);
    // A Saturday has no later plotted bar; the earlier side is Friday's last bar.
    await jump(inspector, "2026-10-10T10:00");
    await expect(missing).toContainText("No bar at 2026-10-10 10:00. Nothing was substituted.");
    await expect(missing.getByRole("button", { name: "Earlier bar: 2026-10-09 15:55", exact: true })).toBeVisible();
    await expect(missing.getByText("No plotted bar on that side", { exact: true })).toBeVisible();

    // AC-E10-03 (exact): one bar on the previous session, far from the restored latest view.
    const target = at(8, 11, 30);
    await jump(inspector, "2026-10-08T11:30");
    await press(row(inspector, target), isTouch(testInfo));
    await expect(inspector.getByText("1 selected", { exact: true })).toBeVisible();
    await inspector.getByRole("button", { name: "Show on chart", exact: true }).click();
    await expect(page.locator("[data-data-inspector]")).toHaveCount(0);
    await expect.poll(() => focusProbe(page), { timeout: 20_000 }).toEqual({ status: "exact", time: target, tf: "5m", index: 24, inView: true });
    await expect(page.locator(".undo-toast").filter({ hasText: "Chart moved to 2026-10-08 11:30." })).toBeVisible();
    // The pane's own late view restore must not push the bar back out of view.
    await page.waitForTimeout(1_500);
    expect(await focusProbe(page)).toMatchObject({ status: "exact", index: 24, inView: true });

    // The selection is still that bar when the table comes back.
    inspector = await openInspector(page);
    await expect(inspector.getByText("1 selected", { exact: true })).toBeVisible();
    await jump(inspector, "2026-10-08T11:30");
    await expect(row(inspector, target)).toHaveAttribute("aria-selected", "true");
  });

  test("keyboard selects, extends, clears and returns to the chart", { tag: "@e10" }, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "keyboard path; touch paths run in the other cases");
    const inspector = await openInspector(page);
    const grid = inspector.getByRole("grid");
    await grid.focus();
    await page.keyboard.press("Home");
    const last = at(9, 15, 55);
    await expect(row(inspector, last)).toHaveAttribute("data-focused", "");
    await page.keyboard.press("Space");
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press("Shift+ArrowDown");
    await expect(inspector.getByText("3 selected", { exact: true })).toBeVisible();
    for (const t of [last, at(9, 15, 50), at(9, 15, 45)]) await expect(row(inspector, t)).toHaveAttribute("aria-selected", "true");
    await expect(row(inspector, at(9, 15, 40))).toHaveAttribute("aria-selected", "false");
    await page.keyboard.press("Escape");
    await expect(inspector.getByText("None selected", { exact: true })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-data-inspector]")).toHaveCount(0);
    await expect.poll(() => focusProbe(page), { timeout: 20_000 }).toEqual({ status: "exact", time: at(9, 15, 45), tf: "5m", index: TOTAL - 3, inView: true });
  });

  test("Chinese copy keeps the same exact rows", { tag: "@e10" }, async ({ page }, testInfo) => {
    test.slow();
    await useLang(page, "zh");
    await openChart(page, TOTAL, "5m");
    const inspector = await openInspector(page);
    await expect(inspector.getByText("交易所时钟：纽约", { exact: true })).toBeVisible();
    await jump(inspector, "2026-10-09T10:00", "跳转到时间");
    await press(row(inspector, TEN), isTouch(testInfo));
    await press(row(inspector, TEN_05), isTouch(testInfo));
    await expect(inspector.getByText("已选 2", { exact: true })).toBeVisible();
    await inspector.getByRole("button", { name: "比较", exact: true }).click();
    await expect(inspector.locator("section[data-diff]")).toBeVisible();
    await jump(inspector, "2026-10-09T10:02", "跳转到时间");
    await expect(inspector.locator('[data-notice="missing"]')).toContainText("2026-10-09 10:02 没有K线，未替换为其他K线。");
    await expect(inspector.locator("section[data-diff]").getByText("相隔 1 根K线 · 较晚减较早", { exact: true })).toBeVisible();
    const paged = pageScrolls(page);
    if (paged) await row(inspector, TEN_05).scrollIntoViewIfNeeded();
    for (const t of [TEN, TEN_05]) await expect(row(inspector, t)).toBeInViewport();
    await captureCrop(page, inspector, `docs/pr-crops/data-inspector/${testInfo.project.name}-inspector-zh.png`);
  });
});

test("Bar Replay exports only the bars plotted up to the cursor (daily, date-only)", { tag: "@e10" }, async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Replay launch paths per device are covered by replay specs; the export contract is device-independent");
  test.slow();
  await openChart(page, null, "3D");
  const before = (await axisProbe(page))!;
  await toggleToolbarReplay(page);
  await expect.poll(async () => (await axisProbe(page))?.rowCount ?? Infinity, { timeout: 20_000 }).toBeLessThan(before.rowCount);
  const after = (await axisProbe(page))!;
  const cursorTime = String(after.contextProof.priceRows.at(-1)!.time);
  const inspector = await openInspector(page);
  await expect(inspector).toHaveAttribute("data-row-count", String(after.rowCount));
  await expect(inspector.getByText("Bar Replay is on: rows end at the replay cursor.", { exact: true })).toBeVisible();
  await expect(inspector.getByLabel("Go to date", { exact: true })).toHaveAttribute("type", "date");
  // Newest first: the top row is the cursor bar, never a later one.
  await expect(inspector.locator("[role=row][data-row-key]").first()).toHaveAttribute("data-row-key", cursorTime);
  const pending = page.waitForEvent("download");
  await inspector.getByRole("button", { name: "Download data", exact: true }).click();
  const csv = await readCsv(await pending);
  expect(csv.meta.replay).toBe("on; rows end at the replay cursor");
  expect(csv.meta.scope).toBe(`all plotted rows (${after.rowCount})`);
  expect(csv.meta.time_basis).toBe("trading session date; no time of day");
  expect(csv.rows.length).toBe(after.rowCount);
  expect(csv.rows[0][0]).toBe(cursorTime);
  expect(csv.rows.every((r) => r[0] <= cursorTime), "no row after the replay cursor").toBe(true);
  expect(csv.rows.some((r) => r[0] === String(before.contextProof.priceRows.at(-1)!.time))).toBe(false);
});
