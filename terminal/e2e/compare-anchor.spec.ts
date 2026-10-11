import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { isolateLayoutStore, useLang } from "./layoutStore";
import { isPhoneViewport } from "./phoneChrome";
import { expectTapTarget } from "./tapTarget";
import { openLayoutMenu } from "./terminalToolbar";

// E08 — anchored benchmark comparison, in the browser, at all three contract viewports.
//
// A comparison reaches the chart through the existing saved-workspace contract (`compare` +
// `compareCfg` on the chart widget), so every test seeds real `workspace_layout.v1` rows through
// `/api/layouts` (TERMINAL_E2E_FIXTURE's in-memory store) and loads them through the real menu.
// Tablet has no compare entry point of its own (the topbar is hidden at <=860px and the roller
// strip is phone-only), so a saved study is the one path every viewport shares.
//
// Test titles stay short: e2e/layoutStore.ts truncates its per-run store key at 110 characters, so
// a long title would drop the run nonce and reuse the previous run's saved rows.
//
// The anchor readout's values live in the chart canvas; the strip publishes the receipt the
// compare adapter actually drew from (`data-cmp-*`, including a deterministic digest).

test.setTimeout(120_000);

const ACT = { timeout: 20_000 };
const OUT = join(process.cwd(), "docs", "pr-crops", "e08-compare-anchor");
const CROPS = process.env.TERMINAL_CROPS === "1";
const HOST = "/terminal?symbol=AAPL";

type CfgSeed = Record<string, Record<string, unknown>>;
type Study = { compare: string[]; compareCfg: CfgSeed };

const cfg = (color: string, mode: "percent" | "price", extra: Record<string, unknown> = {}) =>
  ({ color, lineStyle: 0, lineWidth: 2, mode, ...extra });

// 2024-01-01 is a US market holiday: the pin must resolve to the NEXT host session and say so.
const PIN = "2024-01-01";
const PIN_EFFECTIVE = "2024-01-02";

const STUDIES: Record<string, Study> = {
  Pinned: {
    compare: ["SPY", "QQQ"],
    compareCfg: {
      SPY: cfg("#e8a33d", "percent", { anchor: PIN, anchorSrc: "date" }),
      QQQ: cfg("#9d86ff", "percent", { anchor: PIN, anchorSrc: "date" }),
    },
  },
  // Saved before E08: no anchor keys at all, one raw-price leg with a non-default style.
  Legacy: {
    compare: ["SPY", "QQQ"],
    compareCfg: {
      SPY: { color: "#19c2c2", lineStyle: 2, lineWidth: 3, mode: "price" },
      QQQ: { color: "#f06bd0", lineStyle: 1, lineWidth: 1, mode: "percent" },
    },
  },
  // A different quote currency (HKD) next to a like-for-like USD benchmark.
  Currency: {
    compare: ["0700.HK", "QQQ"],
    compareCfg: {
      "0700.HK": cfg("#e8a33d", "percent", { anchor: PIN, anchorSrc: "date" }),
      QQQ: cfg("#9d86ff", "percent", { anchor: PIN, anchorSrc: "date" }),
    },
  },
  // Pinned before the host's first bar (AAPL fixture history starts 2021-06-28), plus two legs
  // whose reads fail: one is not published (404), one errors (503).
  Faults: {
    compare: ["SPY", "NVDA", "MSFT"],
    compareCfg: {
      SPY: cfg("#e8a33d", "percent", { anchor: "2021-01-04", anchorSrc: "date" }),
      NVDA: cfg("#9d86ff", "percent", { anchor: "2021-01-04", anchorSrc: "date" }),
      MSFT: cfg("#19c2c2", "percent", { anchor: "2021-01-04", anchorSrc: "date" }),
    },
  },
  Crop: {
    compare: ["QQQ", "SPY", "0700.HK"],
    compareCfg: {
      QQQ: cfg("#9d86ff", "percent", { anchor: PIN, anchorSrc: "date" }),
      SPY: cfg("#e8a33d", "percent", { anchor: PIN, anchorSrc: "date" }),
      "0700.HK": cfg("#19c2c2", "percent", { anchor: PIN, anchorSrc: "date" }),
    },
  },
};

type OwnershipWindow = Window & { __mmChartOwnership?: () => { owned: { compare: number } } };
type AxisWindow = Window & { __mmChartAxisOpts?: () => { visibleRange: { from: number; to: number } | null } | null };

const strip = (page: Page) => page.locator("[data-cmp-study]");
const chip = (page: Page, sym: string) => page.locator(`[data-cmp-leg="${sym}"]`);
const detail = (page: Page, sym: string) => page.locator(`[data-cmp-leg-detail="${sym}"]`);
const drawnCompare = (page: Page) =>
  page.evaluate(() => (window as unknown as OwnershipWindow).__mmChartOwnership?.().owned.compare ?? -1);
const visibleFrom = (page: Page) =>
  page.evaluate(() => (window as unknown as AxisWindow).__mmChartAxisOpts?.()?.visibleRange?.from ?? null);

async function gotoHost(page: Page) {
  await page.goto(HOST);
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 45_000 });
}

/** Save the live workspace once through the real menu, then write each study as its own
 *  `workspace_layout.v1` row (a CREATE through the revision-fenced `save_workspace` op) whose chart
 *  widget carries the study's `compare` + `compareCfg`. Reloads so the menu lists every row. */
async function seedStudies(page: Page, names: (keyof typeof STUDIES)[]) {
  const menu = await openLayoutMenu(page);
  await menu.locator("[data-layout-save] input").fill("E08 seed");
  await menu.locator("[data-layout-save-btn]").click(ACT);
  await expect(menu.locator('[data-layout-feedback="saved"]')).toBeVisible(ACT);
  const studies = Object.fromEntries(names.map((n) => [n, STUDIES[n]]));
  const statuses = await page.evaluate(async (byName) => {
    type Widget = { type: string; config: Record<string, unknown> };
    const list = await fetch("/api/layouts", { headers: { Accept: "application/json" } });
    const rows = (await list.json()).layouts as { name: string; config: { widgets: Widget[] } }[];
    const seed = rows.find((r) => r.name === "E08 seed");
    if (!seed) return { seed: 0 };
    const out: Record<string, number | string> = {};
    for (const [name, study] of Object.entries(byName)) {
      const envelope = JSON.parse(JSON.stringify(seed.config)) as { widgets: Widget[] };
      const chart = envelope.widgets.find((w) => w.type === "chart")!;
      chart.config.compare = study.compare;
      chart.config.compareCfg = study.compareCfg;
      // Every study is read on the daily timeframe, whatever this device's default is.
      if (Array.isArray(chart.config.panes)) chart.config.paneTfs = (chart.config.panes as unknown[]).map(() => "D");
      if ("tf" in chart.config) chart.config.tf = "D";
      const r = await fetch("/api/layouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "save_workspace", name, envelope, expectedRevision: null }),
      });
      out[name] = r.status === 200 ? 200 : `${r.status} ${(await r.text()).slice(0, 300)}`;
    }
    return out;
  }, studies);
  expect(statuses).toEqual(Object.fromEntries(names.map((n) => [n, 200])));
  await page.reload();
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 45_000 });
}

async function loadStudy(page: Page, name: string) {
  const menu = await openLayoutMenu(page);
  await menu.locator(`[data-layout-row="${name}"]`).click(ACT);
  await expect(strip(page)).toBeVisible(ACT);
}

async function readyDigest(page: Page): Promise<string> {
  await expect(strip(page)).toHaveAttribute("data-cmp-study", "ready", ACT);
  const digest = await strip(page).getAttribute("data-cmp-digest");
  expect(digest).toMatch(/^[0-9a-f]{8}$/);
  return digest!;
}

async function openDetails(page: Page): Promise<Locator> {
  const toggle = page.locator("[data-cmp-toggle]");
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true", ACT);
  const panel = page.locator("[data-cmp-panel]");
  await expect(panel).toBeVisible(ACT);
  return panel;
}

/** At <=860px the workspace floats a fullscreen control over the top-right of the chart column;
 *  no strip control may sit under it (it would swallow the tap). */
async function expectClearOfFullscreenFloat(page: Page, selectors: string[]) {
  const float = page.locator(".chart-fs-float");
  await expect(float).toBeVisible(ACT);
  const f = (await float.boundingBox())!;
  for (const sel of selectors) {
    const b = await page.locator(sel).boundingBox();
    expect(b, `${sel} has no box`).not.toBeNull();
    const overlaps = b!.x < f.x + f.width && f.x < b!.x + b!.width && b!.y < f.y + f.height && f.y < b!.y + b!.height;
    expect(overlaps, `${sel} sits under the floating fullscreen control`).toBe(false);
  }
}

/** Serve a quote-currency variant the fixture tree does not publish: QQQ's bars re-labelled as a
 *  Hong Kong listing (the venue, not the numbers, is what this asserts about). */
async function routeHkListing(page: Page) {
  await page.route("**/data/0700.HK.json", async (route) => {
    const upstream = await route.fetch({ url: route.request().url().replace("0700.HK.json", "QQQ.json") });
    const doc = await upstream.json();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...doc, src: "yahoo" }) });
  });
}

test.describe("anchored benchmark comparison (E08)", () => {
  test("pinned study: anchor + basis named, keyboard pins, scroll-proof, exact restore", async ({ page, baseURL }, testInfo) => {
    await isolateLayoutStore(page, testInfo, baseURL);
    await useLang(page, "en");
    await gotoHost(page);
    await seedStudies(page, ["Pinned", "Legacy"]);

    await loadStudy(page, "Pinned");
    const digest = await readyDigest(page);
    // AC-E08-01: every drawn line names its exact effective anchor and its return basis.
    await expect(strip(page)).toHaveAttribute("data-cmp-policy", `date:${PIN}`);
    for (const sym of ["SPY", "QQQ"]) {
      await expect(chip(page, sym)).toHaveAttribute("data-cmp-status", "drawn");
      await expect(chip(page, sym)).toHaveAttribute("data-cmp-anchor", PIN_EFFECTIVE);
      await expect(chip(page, sym)).toHaveAttribute("data-cmp-basis", "price");
      await expect(chip(page, sym)).toContainText(`${PIN_EFFECTIVE} · Price return`);
    }
    await expect.poll(() => drawnCompare(page), ACT).toBe(2);

    // Keyboard: the disclosure opens from the keyboard and Tab moves into the policy controls.
    const panel = await openDetails(page);
    await page.keyboard.press("Tab");
    await expect(page.locator("[data-cmp-auto]")).toBeFocused();
    await expect(panel.locator("[data-cmp-summary]")).toHaveText(`Pinned ${PIN}`);
    // The holiday pin is disclosed as a rule, never silently re-dated.
    await expect(detail(page, "SPY")).toContainText(`Anchor ${PIN_EFFECTIVE} · next session after ${PIN}`);
    await expect(detail(page, "SPY")).toContainText("Price return · polygon · USD");
    await expect(panel.locator("[data-cmp-host]")).toContainText("Price return · polygon · USD");
    // Same currency + same basis: a like-for-like spread is shown.
    await expect(detail(page, "SPY").locator("[data-cmp-spread]")).toHaveAttribute("data-cmp-spread", "comparable");
    await expect(detail(page, "SPY").locator("[data-cmp-stat]")).toContainText(`since ${PIN_EFFECTIVE}`);

    if (testInfo.project.name !== "desktop") {
      const controls = ["[data-cmp-toggle]", "[data-cmp-auto]", "[data-cmp-pin]", "[data-cmp-pin-window]", "[data-cmp-date]"];
      for (const control of controls) await expectTapTarget(page.locator(control), { height: 44 });
      await expectClearOfFullscreenFloat(page, controls);
    }

    // AC-E08-04: "Pin visible start" captures the window start ONCE; zooming/scrolling afterwards
    // must move the chart's visible range and must NOT move the pinned anchor.
    await page.locator("[data-cmp-pin-window]").click(ACT);
    await expect(strip(page)).toHaveAttribute("data-cmp-policy", /^window:\d{4}-\d{2}-\d{2}$/, ACT);
    const windowPolicy = (await strip(page).getAttribute("data-cmp-policy"))!;
    await readyDigest(page);
    const windowAnchor = await chip(page, "SPY").getAttribute("data-cmp-anchor");
    expect(windowAnchor).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const fromBefore = await visibleFrom(page);
    expect(fromBefore).not.toBeNull();
    const canvas = page.locator(".chart-wrap").first();
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.45);
    for (let i = 0; i < 3; i += 1) await page.mouse.wheel(0, 500);
    await expect.poll(() => visibleFrom(page), ACT).not.toBe(fromBefore);
    await page.waitForTimeout(400);
    await expect(strip(page)).toHaveAttribute("data-cmp-policy", windowPolicy);
    await expect(chip(page, "SPY")).toHaveAttribute("data-cmp-anchor", windowAnchor!);
    await expect(chip(page, "QQQ")).toHaveAttribute("data-cmp-anchor", windowAnchor!);

    // Keyboard date pin: type a date, Enter commits it.
    const date = page.locator("[data-cmp-date]");
    await date.focus();
    await date.fill("2023-03-01");
    await page.keyboard.press("Enter");
    await expect(strip(page)).toHaveAttribute("data-cmp-policy", "date:2023-03-01", ACT);
    await readyDigest(page);
    await expect(chip(page, "QQQ")).toHaveAttribute("data-cmp-anchor", "2023-03-01");
    await expect(detail(page, "QQQ")).toContainText("Anchor 2023-03-01 · exact session");

    // Escape closes the disclosure and hands focus back to its toggle.
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-cmp-panel]")).toHaveCount(0);
    await expect(page.locator("[data-cmp-toggle]")).toBeFocused();

    // AC-E08-05: a layout saved before E08 keeps its modes and style and gets a disclosed default.
    await loadStudy(page, "Legacy");
    await readyDigest(page);
    await expect(strip(page)).toHaveAttribute("data-cmp-policy", "auto");
    await expect(chip(page, "SPY")).toContainText("raw scale");
    await expect(chip(page, "QQQ")).toHaveAttribute("data-cmp-anchor", "2021-06-28");
    const legacyPanel = await openDetails(page);
    await expect(legacyPanel.locator("[data-cmp-summary]")).toHaveText("Auto · each line starts at its first session in common with AAPL");
    await expect(detail(page, "QQQ")).toContainText("first common session (auto)");
    await expect(detail(page, "SPY")).toContainText("Raw price on its own scale · not rebased");
    await page.keyboard.press("Escape");
    // Re-saving the legacy study writes back exactly what it held: no anchor was silently added.
    const menu = await openLayoutMenu(page);
    await menu.locator("[data-layout-save] input").fill("Legacy resaved");
    await menu.locator("[data-layout-save-btn]").click(ACT);
    await expect(menu.locator('[data-layout-feedback="saved"]')).toBeVisible(ACT);
    const resaved = await page.evaluate(async () => {
      const r = await fetch("/api/layouts", { headers: { Accept: "application/json" } });
      const rows = (await r.json()).layouts as { name: string; config: { widgets: { type: string; config: Record<string, unknown> }[] } }[];
      return rows.find((x) => x.name === "Legacy resaved")?.config.widgets.find((w) => w.type === "chart")?.config.compareCfg ?? null;
    });
    expect(resaved).toEqual(STUDIES.Legacy.compareCfg);

    // AC-E08-06: the saved study restores the identical values (same input revision ⇒ same digest),
    // both after loading another study and after a full reload.
    await loadStudy(page, "Pinned");
    expect(await readyDigest(page)).toBe(digest);
    await page.reload();
    await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 45_000 });
    await loadStudy(page, "Pinned");
    expect(await readyDigest(page)).toBe(digest);
    await expect(chip(page, "SPY")).toHaveAttribute("data-cmp-anchor", PIN_EFFECTIVE);
  });

  test("falsifier: a later-loading leg never moves the anchor", async ({ page, browser, baseURL }, testInfo) => {
    await isolateLayoutStore(page, testInfo, baseURL);
    await useLang(page, "en");
    await gotoHost(page);
    await seedStudies(page, ["Pinned"]);
    await loadStudy(page, "Pinned");
    const reference = await readyDigest(page);
    const referenceAnchors = await Promise.all(["SPY", "QQQ"].map((s) => chip(page, s).getAttribute("data-cmp-anchor")));

    // Fresh contexts: no memory or IndexedDB copy, so each ordering really goes to the network.
    for (const late of ["QQQ", "SPY"]) {
      const context = await browser.newContext({
        baseURL,
        viewport: page.viewportSize(),
        hasTouch: testInfo.project.use.hasTouch ?? false,
      });
      const fresh = await context.newPage();
      await isolateLayoutStore(fresh, testInfo, baseURL);
      await useLang(fresh, "en");
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      await fresh.route(`**/data/${late}.json`, async (route) => { await held; await route.continue(); });
      await gotoHost(fresh);
      await loadStudy(fresh, "Pinned");
      // While one leg is still in flight nothing is drawn and the readout says so — no partial
      // study whose anchor could depend on which document arrived first.
      await expect(strip(fresh)).toHaveAttribute("data-cmp-study", "computing", ACT);
      await fresh.waitForTimeout(1_500);
      await expect(strip(fresh)).toHaveAttribute("data-cmp-study", "computing");
      expect(await drawnCompare(fresh)).toBe(0);
      release();
      expect(await readyDigest(fresh)).toBe(reference);
      expect(await Promise.all(["SPY", "QQQ"].map((s) => chip(fresh, s).getAttribute("data-cmp-anchor")))).toEqual(referenceAnchors);
      await expect.poll(() => drawnCompare(fresh), ACT).toBe(2);
      await context.close();
    }
  });

  test("withheld, missing and incompatible legs are disclosed", async ({ page, baseURL }, testInfo) => {
    await isolateLayoutStore(page, testInfo, baseURL);
    await useLang(page, "en");
    await routeHkListing(page);
    await gotoHost(page);
    await seedStudies(page, ["Currency", "Faults"]);

    // AC-E08-03: HKD next to USD is drawn on its anchor but never presented as outperformance.
    await loadStudy(page, "Currency");
    await readyDigest(page);
    await expect(chip(page, "0700.HK")).toHaveAttribute("data-cmp-status", "drawn");
    await expect(chip(page, "0700.HK")).toHaveAttribute("data-cmp-basis", "adjusted");
    const panel = await openDetails(page);
    await expect(detail(page, "0700.HK").locator("[data-cmp-spread]")).toHaveAttribute("data-cmp-spread", "withheld");
    await expect(detail(page, "0700.HK")).toContainText("No outperformance shown · HKD vs USD, no converted basis");
    await expect(detail(page, "0700.HK")).not.toContainText("Spread ");
    await expect(detail(page, "QQQ").locator("[data-cmp-spread]")).toHaveAttribute("data-cmp-spread", "comparable");
    await expect(panel).toContainText("Sessions without an observation are left blank, never filled.");
    await page.keyboard.press("Escape");

    // AC-E08-02 + failure truth: a pin before the host's history is withheld; an unpublished leg
    // and a failed read are each named for what they are — and nothing is drawn for any of them.
    // (NVDA and MSFT were never read in this context, so the faults reach the network.)
    await page.route("**/data/NVDA.json", (route) => route.fulfill({ status: 404, body: "" }));
    await page.route("**/data/MSFT.json", (route) => route.fulfill({ status: 503, body: "" }));
    await loadStudy(page, "Faults");
    await readyDigest(page);
    await expect(chip(page, "SPY")).toHaveAttribute("data-cmp-status", "withheld");
    await expect(chip(page, "NVDA")).toHaveAttribute("data-cmp-status", "absent");
    await expect(chip(page, "MSFT")).toHaveAttribute("data-cmp-status", "unavailable");
    for (const sym of ["SPY", "NVDA", "MSFT"]) await expect(chip(page, sym)).toContainText("not drawn");
    await expect.poll(() => drawnCompare(page), ACT).toBe(0);
    await openDetails(page);
    await expect(detail(page, "SPY")).toContainText("Not drawn · the anchor precedes AAPL's history");
    await expect(detail(page, "NVDA")).toContainText("Not drawn · no price history published");
    await expect(detail(page, "MSFT")).toContainText("Not drawn · price history could not be loaded");
  });

  for (const lang of ["en", "zh"] as const) {
    test(`readout crops (${lang}, dark)`, async ({ page, baseURL }, testInfo) => {
      test.skip(!CROPS, "Crops are captured on request (TERMINAL_CROPS=1).");
      await isolateLayoutStore(page, testInfo, baseURL);
      await useLang(page, lang);
      await routeHkListing(page);
      await gotoHost(page);
      await seedStudies(page, ["Crop"]);
      await loadStudy(page, "Crop");
      await readyDigest(page);
      mkdirSync(OUT, { recursive: true });
      await page.mouse.move(0, 0);
      await page.screenshot({ path: join(OUT, `${testInfo.project.name}-${lang}-dark-closed.png`), animations: "disabled" });
      const panel = await openDetails(page);
      await expect(panel).toContainText(lang === "zh" ? "锚点 2024-01-02" : "Anchor 2024-01-02");
      if (isPhoneViewport(page)) await expect(panel).toBeInViewport();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      await page.mouse.move(0, 0);
      await page.screenshot({ path: join(OUT, `${testInfo.project.name}-${lang}-dark.png`), animations: "disabled" });
    });
  }
});
