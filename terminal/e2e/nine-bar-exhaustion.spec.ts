import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { openIndicatorLibrary } from "./phoneChrome";
import { toggleToolbarReplay } from "./terminalToolbar";

const BRAIN_SCRIPT = "https://www.mastermind-x.com/mm_brain.js";
const SYMBOL = "NVDA";
const TERMINAL = `/terminal?symbol=${SYMBOL}`;
const ACT = { timeout: 30_000 } as const;

type Mode = { lang: "en" | "zh"; updown: "west" | "east" };

const MODE_VARIANTS: readonly Mode[] = [
  { lang: "en", updown: "west" },
  { lang: "zh", updown: "east" },
];

function settingsCopy(mode: Mode) {
  return mode.lang === "zh" ? {
    title: "九转衰竭",
    display: "显示方式",
    density: "标注密度",
    sustained: "持续趋势",
    requireFlip: "要求价格翻转",
    labelSize: "标签大小",
  } : {
    title: "Nine-Bar Exhaustion",
    display: "Display",
    density: "Annotation Density",
    sustained: "Sustained Trend",
    requireFlip: "Require Price Flip",
    labelSize: "Label Size",
  };
}

// The last 34 bars are deliberately deterministic:
//   8 flat @ 120 → falling 1..9 → 8 flat @ 100 → rising 1..9 on the final bar.
// The flats guarantee an equality reset, so both completed structures are independent and visible.
const closes: number[] = Array.from({ length: 166 }, (_, i) => 104 + Math.sin(i / 8) * 5 + i * 0.015);
closes.push(...Array(8).fill(120));
closes.push(...Array.from({ length: 9 }, (_, i) => 119 - i));
closes.push(...Array(8).fill(100));
closes.push(...Array.from({ length: 9 }, (_, i) => 101 + i));

// This is an equity fixture, so its daily clock must obey the same weekday/session contract as
// NVDA. Advancing through raw calendar days made the final synthetic bar land on Saturday; the
// production finality gate correctly treated that impossible US-equity session as unconfirmed.
const fixtureDates: string[] = [];
for (let cursor = new Date(Date.UTC(2025, 0, 2)); fixtureDates.length < closes.length; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
  const weekday = cursor.getUTCDay();
  if (weekday !== 0 && weekday !== 6) fixtureDates.push(cursor.toISOString().slice(0, 10));
}

const fixtureBars = closes.map((c, i) => {
  const previous = i ? closes[i - 1] : c;
  const o = previous + (c - previous) * 0.35;
  return [
    fixtureDates[i],
    o,
    Math.max(o, c) + 0.65,
    Math.min(o, c) - 0.65,
    c,
    100_000 + i * 113,
  ];
});
const finalDate = fixtureBars.at(-1)![0] as string;
const finalEpoch = Math.floor(Date.parse(`${finalDate}T00:00:00Z`) / 1000);

async function arm(page: Page, mode: Mode) {
  await page.route(BRAIN_SCRIPT, route => route.fulfill({
    contentType: "application/javascript",
    body: "window.MMBrain={mounted:true,open(){},close(){},toggle(){}};",
  }));
  await page.route(new RegExp(`/data/${SYMBOL}\\.json(?:\\?.*)?$`), route => route.fulfill({ json: {
    t: SYMBOL,
    o: 1,
    src: "nine-bar-browser-fixture",
    bar_quality: "real_ohlc",
    session_anchor: { basis: "feed", timezone: "America/New_York" },
    bars: fixtureBars,
  } }));
  await page.route(new RegExp(`/data/${SYMBOL}\\.slice\\.json(?:\\?.*)?$`), route => route.fulfill({ json: {
    indicator: { state: { position_hint: "flat" }, signals: [], early_dots: [], warnings: [] },
    backtest: { metrics: {} },
  } }));
  await page.addInitScript(({ lang, updown }) => {
    const seedKey = "mm.e2e.nine.seeded";
    if (localStorage.getItem(seedKey) !== "1") {
      localStorage.setItem("mm.inds", "[]");
      localStorage.setItem("mm.indParams", "{}");
      localStorage.setItem("mm.hidden", "[]");
      localStorage.setItem("mm.devTier", "pro");
      localStorage.setItem("mm.mastermindCandles.v1", "1");
      localStorage.setItem("mm.lang", lang);
      localStorage.setItem("mm.updown", updown);
      localStorage.setItem("mm.tf", JSON.stringify("D"));
      localStorage.setItem("mm.startTf", JSON.stringify("D"));
      localStorage.setItem(seedKey, "1");
    }
    const activeLang = localStorage.getItem("mm.lang") === "zh" ? "zh" : "en";
    const activeUpdown = localStorage.getItem("mm.updown") === "east" ? "east" : "west";
    const applyDocumentMode = () => {
      const root = document.documentElement;
      if (!root) return;
      root.setAttribute("data-lang", activeLang);
      root.setAttribute("lang", activeLang === "zh" ? "zh-CN" : "en");
      root.setAttribute("data-updown", activeUpdown);
    };
    applyDocumentMode();
    if (!document.documentElement) document.addEventListener("DOMContentLoaded", applyDocumentMode, { once: true });
    const host = window as Window & { __nineVisualReady?: boolean };
    host.__nineVisualReady = false;
    window.addEventListener("mm:terminal-visual-ready", () => { host.__nineVisualReady = true; });
  }, mode);
}

async function gotoTerminal(page: Page) {
  await page.goto(TERMINAL);
  await expect(page.locator(".workspace")).toBeVisible(ACT);
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible(ACT);
  // The event can legitimately fire before a test listener during a hot dev-server navigation.
  // Witness the chart's own accepted price rows instead of sleeping on an incidental event edge.
  await expect.poll(() => page.evaluate(() => {
    const axis = (window as Window & {
      __mmChartAxisOpts?: () => { contextProof?: { priceRows?: unknown[] } } | null;
    }).__mmChartAxisOpts?.();
    return axis?.contextProof?.priceRows?.length ?? 0;
  }), ACT).toBeGreaterThanOrEqual(100);
}

const ninePrims = (page: Page) => page.locator('svg [data-ic-tip^="nine-tip-"]');
const risingPrims = (page: Page) => page.locator('svg [data-ic-tip*="|rising|"]');
const fallingPrims = (page: Page) => page.locator('svg [data-ic-tip*="|falling|"]');
const finalNine = (page: Page) => page.locator(`svg [data-ic-tip*="|rising|"][data-ic-tip*="${finalEpoch}"]`).first();

async function assertDirectionalToken(page: Page, target: Locator, token: "--up" | "--down") {
  await expect(target).toBeAttached(ACT);
  const actual = await target.evaluate((element) => {
    const text = element.querySelector("text") ?? element;
    return getComputedStyle(text).fill;
  });
  const expected = await page.evaluate((cssToken) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${cssToken})`;
    probe.style.position = "fixed";
    probe.style.left = "-10000px";
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);
  expect(actual).toBe(expected);
}

async function hoverOrTap(page: Page, target: Locator, project: string) {
  const box = await target.boundingBox();
  if (!box) throw new Error("nine-count primitive has no browser box");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  if (project === "mobile") await page.touchscreen.tap(x, y);
  else {
    await page.mouse.move(x - 45, y - 35);
    await page.mouse.move(x, y, { steps: 6 });
  }
  const tipId = await target.getAttribute("data-ic-tip");
  await expect(page.locator(".ic-tip")).toHaveAttribute("data-ic-tip-for", tipId!, ACT);
  await expect(page.locator(".ic-tip")).toBeVisible(ACT);
}

async function switchTimeframe(page: Page, tf: string) {
  await page.evaluate((value) => window.dispatchEvent(new CustomEvent("mm:set-tf", { detail: { tf: value } })), tf);
}

async function savedState(page: Page) {
  return page.evaluate(() => ({
    inds: JSON.parse(localStorage.getItem("mm.inds") || "[]"),
    params: JSON.parse(localStorage.getItem("mm.indParams") || "{}"),
  }));
}

async function screenshot(page: Page, testInfo: TestInfo, suffix: string) {
  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-${suffix}.png`),
    fullPage: false,
  });
}

for (const mode of MODE_VARIANTS) {
  test(`Nine-Bar Exhaustion is discoverable, inspectable, replay-safe, responsive, and persistent [${mode.lang}/${mode.updown}]`, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const copy = settingsCopy(mode);
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await arm(page, mode);
  await gotoTerminal(page);

  // Discover and enable the real module through the Indicator Library at every viewport.
  await openIndicatorLibrary(page);
  const library = page.locator(".imodal-library");
  await expect(library).toBeVisible(ACT);
  const search = library.getByRole("searchbox", { name: mode.lang === "zh" ? "搜索指标" : "Search indicators" });
  await search.click();
  await search.fill(mode.lang === "zh" ? "神奇九转" : "Nine-Bar Exhaustion");
  const result = library.locator("[data-im-search-result]").filter({ hasText: copy.title }).first();
  const resultWrap = result.locator("xpath=..");
  await expect(result).toBeVisible(ACT);
  await expect(result).toHaveRole("switch");
  await expect(result).toContainText("9X");
  await result.click();
  await expect(result).toHaveAttribute("aria-checked", "true");

  // Open the module-scoped settings surface and change a representative value from each control family.
  await resultWrap.locator("button.imod-action.icon").click();
  const settings = page.locator(".ind-set");
  await expect(settings).toBeVisible(ACT);
  await expect(settings).toContainText(copy.title);
  await settings.locator(".is-row").filter({ hasText: copy.display }).locator("select").selectOption("completed");
  await settings.locator(".is-row").filter({ hasText: copy.density }).locator("select").selectOption("completion");
  await settings.locator(".is-row").filter({ hasText: copy.sustained }).locator("select").selectOption("single");
  const flip = settings.locator(".is-row").filter({ hasText: copy.requireFlip }).getByRole("switch");
  await expect(flip).toHaveAttribute("aria-checked", "false");
  const labelSize = settings.locator(".is-row").filter({ hasText: copy.labelSize }).locator('input[type="number"]');
  await labelSize.fill("13");
  await settings.locator(".ai").click();
  await expect(settings).toBeHidden();

  await expect.poll(() => savedState(page), ACT).toMatchObject({
    inds: ["trend"],
    params: { trend: {
      "nine.on": true,
      "nine.displayPolicy": "completed",
      "nine.density": "completion",
      "nine.cycleMode": "single",
      "nine.requireFlip": false,
      "nine.showMarkers": true,
      "nine.labelSize": 13,
    } },
  });

  // The real SVG contains both directional completions, with chart-preference-aware colors.
  await expect.poll(() => ninePrims(page).count(), ACT).toBeGreaterThanOrEqual(4);
  await expect(risingPrims(page).first()).toBeAttached(ACT);
  await expect(fallingPrims(page).first()).toBeAttached(ACT);
  await assertDirectionalToken(page, risingPrims(page).first(), "--down");
  await assertDirectionalToken(page, fallingPrims(page).first(), "--up");
  await expect(finalNine(page)).toBeAttached(ACT);

  // A completed count is inspectable and explicitly refuses to claim a guaranteed reversal.
  await hoverOrTap(page, finalNine(page), testInfo.project.name);
  const tooltip = page.locator(".ic-tip");
  if (mode.lang === "zh") {
    await expect(tooltip).toContainText("上涨九转完成");
    await expect(tooltip).toContainText("可能衰竭，并不保证反转");
    await expect(tooltip).toContainText("向前4根图表K线");
  } else {
    await expect(tooltip).toContainText("Rising nine completed");
    await expect(tooltip).toContainText("Possible exhaustion — not a guaranteed reversal");
    await expect(tooltip).toContainText("4 chart bars back");
  }
  await screenshot(page, testInfo, `${mode.lang}-${mode.updown}-tooltip`);

  // Replay removes the live-tail completion rather than reading future bars; leaving replay restores it.
  await toggleToolbarReplay(page);
  await expect(page.locator("[data-replay-rail]")).toBeVisible(ACT);
  await expect(finalNine(page)).toHaveCount(0, ACT);
  await screenshot(page, testInfo, `${mode.lang}-${mode.updown}-replay`);
  await toggleToolbarReplay(page);
  await expect(page.locator("[data-replay-rail]")).toHaveCount(0, ACT);
  await expect(finalNine(page)).toBeAttached(ACT);

  // Timeframe rebuild keeps the module/settings. Weekly has too few fixture bars for a visible 9;
  // returning to daily deterministically restores the exact source-bar completion.
  await switchTimeframe(page, "W");
  await expect(ninePrims(page)).toHaveCount(0, ACT);
  expect((await savedState(page)).params.trend["nine.on"]).toBe(true);
  await switchTimeframe(page, "D");
  await expect(finalNine(page)).toBeAttached(ACT);

  // Reload is the existing chart-layout persistence path for the active local workspace. The
  // canvas shell mounts before its saved study state and final timeframe rebuild, so witness those
  // product states in order instead of treating the first painted canvas as completion.
  await page.reload();
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible(ACT);
  await expect.poll(() => savedState(page), ACT).toMatchObject({
    inds: ["trend"],
    params: { trend: {
      "nine.on": true,
      "nine.displayPolicy": "completed",
      "nine.density": "completion",
      "nine.labelSize": 13,
    } },
  });
  await switchTimeframe(page, "D");
  await expect.poll(() => page.evaluate(() => {
    const axis = (window as Window & {
      __mmChartAxisOpts?: () => { contextProof?: { priceRows?: unknown[] } } | null;
    }).__mmChartAxisOpts?.();
    return axis?.contextProof?.priceRows?.length ?? 0;
  }), ACT).toBeGreaterThanOrEqual(100);
  await expect(finalNine(page)).toBeAttached(ACT);
  await screenshot(page, testInfo, `${mode.lang}-${mode.updown}-persisted`);

  const fit = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    updown: document.documentElement.getAttribute("data-updown"),
    lang: document.documentElement.getAttribute("data-lang"),
  }));
  expect(fit.documentWidth).toBeLessThanOrEqual(fit.viewportWidth + 1);
  expect(fit.updown).toBe(mode.updown);
  expect(fit.lang).toBe(mode.lang);
  expect(pageErrors).toEqual([]);
});
}
