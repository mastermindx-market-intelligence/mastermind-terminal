import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { expectTapTarget } from "./tapTarget";

// E09 — independent chart link groups, proven in the real multi-chart Terminal.
//
// Groups ride on the one paneSync bus (`__mmPaneSync()` is its dev probe): each pane's `link` is
// what the bus applies, and each pane's `window` is the CALENDAR window it displays (epoch ms).
// Histories start on different dates on purpose, so "same window" can only mean "same dates".
// The per-pane chip (`[data-chart-link-chip]`) is presentation over that one plan.

const DAY = 86_400_000;
const END = "2026-06-30";
const CROPS = "docs/pr-crops/e09-chart-link-groups";

function businessDays(n: number): string[] {
  const out: string[] = [];
  const d = new Date(`${END}T00:00:00Z`);
  while (out.length < n) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.unshift(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
}
function everyDay(n: number): string[] {
  const end = Date.parse(`${END}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => new Date(end - (n - 1 - i) * DAY).toISOString().slice(0, 10));
}
function ohlc(times: string[], base: number) {
  return times.map((t, i) => {
    const c = base * (1 + 0.25 * Math.sin(i / 37) + i / (times.length * 8));
    return [t, +(c * 0.995).toFixed(4), +(c * 1.01).toFixed(4), +(c * 0.99).toFixed(4), +c.toFixed(4), 1_000_000 + i];
  });
}

const SYMS = ["NVDA", "BTC-USD", "ETH-USD", "AAPL"] as const;
const DEEP: Record<string, string[]> = {
  NVDA: businessDays(1200),
  "BTC-USD": everyDay(1400),
  "ETH-USD": businessDays(700),
  AAPL: businessDays(900),
};

type Link = { group: string; crosshair: boolean; window: boolean } | null;
type PaneState = { id: number; tf: string; logical: { from: number; to: number } | null; window: { from: number; to: number } | null; link: Link };
type Probe = { enabled: boolean; plan: string; epoch: number; panes: PaneState[] };

const probe = (page: Page): Promise<Probe> =>
  page.evaluate(() => (window as unknown as { __mmPaneSync?: () => Probe }).__mmPaneSync?.()
    ?? { enabled: false, plan: "none", epoch: -1, panes: [] });

const byId = (panes: PaneState[], id: number) => panes.find((p) => p.id === id)!;

async function routeFixtures(page: Page) {
  let base = 40;
  for (const [sym, times] of Object.entries(DEEP)) {
    const bars = ohlc(times, (base += 35));
    await page.route(`**/data/${sym}.json**`, (route) =>
      route.fulfill({ json: { t: sym, o: 1, src: "e2e-fixture", bar_quality: "real_ohlc", bars } }));
  }
  await page.route("**/api/quote?**", (route) => route.fulfill({ json: { quotes: {} } }));
}

type Seed = { paneTfs?: string[]; sync?: boolean; links?: unknown; lang?: "en" | "zh" };

/** Seed the saved multi-pane workspace ONCE per tab (a reload must read what the app wrote back). */
async function seedWorkspace(page: Page, seed: Seed) {
  await page.addInitScript((s) => {
    try {
      if (s.lang) localStorage.setItem("mm.lang", s.lang);
      if (sessionStorage.getItem("e09.seeded")) return;
      sessionStorage.setItem("e09.seeded", "1");
      localStorage.setItem("mm.ws", JSON.stringify({
        panes: s.syms, paneTfs: s.paneTfs ?? ["D", "D", "D", "D"], split: 4, activePane: 0, lockedVLine: null,
        ...(s.sync === undefined ? {} : { sync: s.sync }),
        ...(s.links === undefined ? {} : { links: s.links }),
      }));
    } catch { /* storage unavailable: the test then fails on the missing grid, loudly */ }
  }, { ...seed, syms: [...SYMS] });
}

const AB = { v: 1, panes: ["A", "A", "B", "B"], share: { A: { crosshair: true, window: true }, B: { crosshair: true, window: true }, C: { crosshair: true, window: true } } };

const fingerprint = (panes: PaneState[]) =>
  panes.map((p) => (p.logical ? `${p.logical.from.toFixed(3)}/${p.logical.to.toFixed(3)}` : "-")).join(",");

async function settle(page: Page, label = "viewport"): Promise<PaneState[]> {
  let panes: PaneState[] = [];
  let previous = "";
  await expect.poll(async () => {
    panes = (await probe(page)).panes;
    const now = fingerprint(panes);
    const steady = panes.length > 0 && now === previous;
    previous = now;
    return steady;
  }, { timeout: 20_000, intervals: [150], message: `${label} never stopped moving` }).toBe(true);
  return panes;
}

async function openSeeded(page: Page) {
  await page.goto("/terminal");
  await expect.poll(async () => (await probe(page)).panes.length, { timeout: 45_000 }).toBe(4);
  await expect.poll(async () => (await probe(page)).panes.every((p) => p.window != null), { timeout: 45_000 }).toBe(true);
  await expect(page.locator("[data-chart-link-chip='0']")).toBeVisible({ timeout: 20_000 });
  return settle(page, "initial grid");
}

async function dragPane(page: Page, index: number, dx: number) {
  const box = await page.locator(".chart-wrap").nth(index).boundingBox();
  expect(box).not.toBeNull();
  const y = box!.y + box!.height * 0.5;
  const x = box!.x + box!.width * 0.45;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 24 });
  await page.mouse.up();
}

function drift(a: PaneState, b: PaneState): number {
  return Math.max(Math.abs(a.window!.from - b.window!.from), Math.abs(a.window!.to - b.window!.to)) / DAY;
}

const paneSymbols = (page: Page) => page.locator(".pane").evaluateAll((els) =>
  els.map((el) => (el.querySelector(".pane-hd b")?.textContent ?? "").trim()));
const activePaneIndex = (page: Page) => page.locator(".pane").evaluateAll((els) => els.findIndex((el) => el.classList.contains("on")));

test.beforeEach(async ({ page }) => { await routeFixtures(page); });

test.describe("multi-chart journeys", () => {
  test("AC-E09-01/06: a restored layout links two charts as A and two as B; each group moves alone", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "Panning two VISIBLE panes needs more than the phone's one-column grid (<=860px hides panes 1-3).");
    await seedWorkspace(page, { sync: false, links: AB });
    const initial = await openSeeded(page);
    const before = await probe(page);
    expect(before.plan).toBe("groups");
    expect(initial.map((p) => p.link?.group ?? null)).toEqual(["A", "A", "B", "B"]);
    await expect(page.locator("[data-chart-link='0']")).toHaveAttribute("data-link-status", "active");

    await dragPane(page, 0, 240);
    const afterA = await settle(page, "group A pan");
    expect(drift(byId(afterA, 0), byId(afterA, 1)), "pane 1 follows pane 0 by calendar").toBeLessThan(2.5);
    expect(Math.abs(byId(afterA, 0).logical!.from - byId(afterA, 1).logical!.from), "…not by bar number").toBeGreaterThan(5);
    expect(fingerprint([byId(afterA, 2), byId(afterA, 3)]), "group B never moved").toBe(fingerprint([byId(initial, 2), byId(initial, 3)]));
    expect(byId(afterA, 0).window!.from).toBeLessThan(byId(initial, 0).window!.from - 30 * DAY);

    if (testInfo.project.name === "desktop") {
      await dragPane(page, 2, -200);
      const afterB = await settle(page, "group B pan");
      expect(drift(byId(afterB, 2), byId(afterB, 3))).toBeLessThan(2.5);
      expect(fingerprint([byId(afterB, 0), byId(afterB, 1)]), "group A never moved").toBe(fingerprint([byId(afterA, 0), byId(afterA, 1)]));
    }
  });

  test("AC-E09-02/04: the chip regroups and narrows sharing without touching symbols, the active pane or other groups", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Panes 1-3 are hidden behind the <=860px collapse; their chips are desktop controls.");
    await seedWorkspace(page, { sync: true });
    const initial = await openSeeded(page);
    expect(initial.map((p) => p.link?.group ?? null)).toEqual(["A", "A", "A", "A"]);   // legacy sync=true
    const symbols = await paneSymbols(page);
    const active = await activePaneIndex(page);
    const url = page.url();

    // Pane 3 → off, pane 2 → B: the chip lives inside a pane header but never activates that pane.
    await page.locator("[data-chart-link-chip='3']").click();
    const menu3 = page.locator("[data-chart-link-menu='3']");
    await expect(menu3).toBeVisible();
    await menu3.locator("[data-link-choice='off']").click();
    await expect(menu3.locator("[data-link-status-text]")).toHaveAttribute("data-link-status-text", "independent");
    await page.keyboard.press("Escape");
    await expect(menu3).toBeHidden();
    await expect(page.locator("[data-chart-link-chip='3']")).toBeFocused();

    await page.locator("[data-chart-link-chip='2']").click();
    await page.locator("[data-chart-link-menu='2'] [data-link-choice='B']").click();
    await expect(page.locator("[data-chart-link='2']")).toHaveAttribute("data-link-status", "alone");
    await page.locator("[data-chart-link-chip='2']").click();           // the chip toggles its menu closed

    await expect.poll(async () => (await probe(page)).panes.map((p) => p.link?.group ?? null)).toEqual(["A", "A", null, null]);
    expect(await paneSymbols(page)).toEqual(symbols);
    expect(await activePaneIndex(page)).toBe(active);
    expect(page.url()).toBe(url);

    // Group A shares crosshair only: a pan of pane 0 must leave pane 1's dates alone.
    await page.locator("[data-chart-link-chip='0']").click();
    await page.locator("[data-chart-link-menu='0'] [data-link-share='window']").uncheck();
    await expect.poll(async () => byId((await probe(page)).panes, 1).link).toEqual({ group: "A", crosshair: true, window: false });
    await page.keyboard.press("Escape");
    const narrowed = await settle(page);
    await dragPane(page, 0, 240);
    const panned = await settle(page, "crosshair-only pan");
    expect(byId(panned, 0).window!.from).toBeLessThan(byId(narrowed, 0).window!.from - 30 * DAY);
    expect(fingerprint([byId(panned, 1), byId(panned, 2), byId(panned, 3)])).toBe(fingerprint([byId(narrowed, 1), byId(narrowed, 2), byId(narrowed, 3)]));
    expect(await activePaneIndex(page)).toBe(active);
  });

  test("AC-E09-05: a mixed-timeframe group is refused explicitly while a same-timeframe group still links", async ({ page }, testInfo) => {
    await seedWorkspace(page, { paneTfs: ["D", "W", "D", "D"], sync: false, links: AB });
    await openSeeded(page);
    const chip0 = page.locator("[data-chart-link-chip='0']");
    await expect(chip0).toHaveAttribute("data-refused", "1");
    await expect(page.locator("[data-chart-link='0']")).toHaveAttribute("data-link-status", "mixed_timeframes");
    const panes = (await probe(page)).panes;
    expect([0, 1, 2, 3].map((i) => byId(panes, i).link?.group ?? null)).toEqual([null, null, "B", "B"]);

    await chip0.click();
    const status = page.locator("[data-chart-link-menu='0'] [data-link-status-text]");
    await expect(status).toHaveAttribute("data-link-status-text", "mixed_timeframes");
    await expect(status).toContainText("mixes timeframes (D, W)");
    if (testInfo.project.name === "desktop") {
      mkdirSync(CROPS, { recursive: true });
      await page.locator(".pane-grid").screenshot({ path: `${CROPS}/desktop-en-refused.png`, animations: "disabled" });
    }
  });

  test("AC-E09-05: legacy sync=false restores every chart independent, and the toolbar Sync still links all", async ({ page }, testInfo) => {
    await seedWorkspace(page, { sync: false });
    await openSeeded(page);
    const off = await probe(page);
    expect(off.enabled).toBe(false);
    expect(off.panes.every((p) => p.link == null)).toBe(true);
    await expect(page.locator("[data-chart-link-chip='0']")).toHaveAttribute("data-group", "off");
    if (testInfo.project.name === "mobile") return;   // the phone hides the chart toolbar row (R2.3): Sync is not a phone control

    const inline = page.locator('[data-toolbar-action="sync"]');
    const toggle = async () => {
      if (await inline.isVisible().catch(() => false)) { await inline.click(); return; }
      await page.getByTestId("toolbar-more").click();
      await page.locator('[data-toolbar-menu-action="sync"]').click();
    };
    await toggle();
    await expect.poll(async () => (await probe(page)).panes.map((p) => p.link?.group ?? null)).toEqual(["A", "A", "A", "A"]);
    await expect(page.locator("[data-chart-link-chip='0']")).toHaveAttribute("data-group", "A");
    await toggle();
    await expect.poll(async () => (await probe(page)).enabled).toBe(false);
  });

  test("AC-E09-06: custom groups survive a reload through the saved workspace; the saved boolean stays conservative", async ({ page }, testInfo) => {
    await seedWorkspace(page, { sync: true });
    await openSeeded(page);
    await page.locator("[data-chart-link-chip='0']").click();
    await page.locator("[data-chart-link-menu='0'] [data-link-choice='C']").click();
    await page.keyboard.press("Escape");
    if (testInfo.project.name === "desktop") {
      await page.locator("[data-chart-link-chip='1']").click();
      await page.locator("[data-chart-link-menu='1'] [data-link-choice='C']").click();
      await page.keyboard.press("Escape");
    }
    const want = testInfo.project.name === "desktop" ? ["C", "C", "A", "A"] : [null, "A", "A", "A"];
    await expect.poll(async () => (await probe(page)).panes.map((p) => p.link?.group ?? null)).toEqual(want);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("mm.ws") || "null"));
    expect(saved.sync, "a narrower grouping never saves as global sync").toBe(false);
    expect(saved.links.panes).toEqual(testInfo.project.name === "desktop" ? ["C", "C", "A", "A"] : ["C", "A", "A", "A"]);

    await page.reload();
    await expect.poll(async () => (await probe(page)).panes.length, { timeout: 45_000 }).toBe(4);
    await expect.poll(async () => (await probe(page)).panes.map((p) => p.link?.group ?? null), { timeout: 20_000 }).toEqual(want);
    await expect(page.locator("[data-chart-link-chip='0']")).toHaveAttribute("data-group", "C");
  });
});

test("phone + tablet: the pane-0 link chip and its menu are full-size touch targets inside the viewport", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "desktop", "Touch geometry is a coarse-pointer contract.");
  await seedWorkspace(page, { sync: false, links: AB });
  await openSeeded(page);
  expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
  const chip = page.locator("[data-chart-link-chip='0']");
  await expectTapTarget(chip, { width: 44, height: 44 });
  // The extended hit box must actually be on top where it reaches over the chart's top edge.
  const box = (await chip.boundingBox())!;
  const hit = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest("[data-chart-link-chip='0']"),
    { x: box.x + box.width / 2, y: box.y + box.height - 3 });
  expect(hit, "the chip's lower half is not covered by the chart").toBe(true);

  await chip.tap();
  const menu = page.locator("[data-chart-link-menu='0']");
  await expect(menu).toBeVisible();
  const mb = (await menu.boundingBox())!;
  const vw = page.viewportSize()!.width;
  expect(mb.x).toBeGreaterThanOrEqual(0);
  expect(mb.x + mb.width).toBeLessThanOrEqual(vw);
  for (const choice of ["off", "A", "B", "C"]) await expectTapTarget(menu.locator(`[data-link-choice='${choice}']`), { height: 44 });
  await expectTapTarget(menu.locator("label").first(), { height: 44 });
  await expectTapTarget(menu.getByRole("button", { name: "Close" }), { width: 44, height: 44 });
  await expect(menu.locator("[data-link-status-text]")).toHaveAttribute("data-link-status-text", "active");

  await menu.locator("[data-link-choice='off']").tap();
  await expect.poll(async () => byId((await probe(page)).panes, 0).link).toBeNull();
  await expect.poll(async () => byId((await probe(page)).panes, 1).link?.group ?? null).toBeNull();   // A is now alone → not linked
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

for (const lang of ["en", "zh"] as const) {
  test(`evidence: link menu open on a two-group grid (${lang}, dark)`, async ({ page }, testInfo) => {
    await seedWorkspace(page, { sync: false, links: AB, lang });
    await openSeeded(page);
    await page.mouse.move(1, 1);
    await page.locator("[data-chart-link-chip='0']").click();
    const menu = page.locator("[data-chart-link-menu='0']");
    await expect(menu).toBeVisible();
    await expect(menu.locator("strong")).toHaveText(lang === "zh" ? "联动图表 1" : "Link chart 1");
    await expect(menu.locator("[data-link-status-text]")).toContainText(lang === "zh" ? "已与" : "Linked with");
    await page.waitForTimeout(250);   // menu entrance animation (120ms) finished
    mkdirSync(CROPS, { recursive: true });
    await page.screenshot({ path: `${CROPS}/${testInfo.project.name}-${lang}-dark.png`, animations: "disabled" });
  });
}
