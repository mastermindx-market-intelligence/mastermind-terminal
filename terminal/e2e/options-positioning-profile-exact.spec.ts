import { expect, test, type Locator, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { applyD08BPanelPresentation } from "./d08bPanelPresentation";
import gexFixture from "../public/data/gex_fixture.json";

/**
 * Local browser-test preparation for a spec in terminal/e2e.
 * Clone the incumbent SPY fixture; do not create an entitlement/auth/source seam.
 * If extracted into e2e/fixtures, adjust this import one directory upward.
 *
 * Only /api/flow?f=gex:SPY needs a narrow override. The existing Playwright
 * FLOW_FIXTURE=1 origin supplies moves and the optional secondary feeds.
 * The baseline asof is retained verbatim; no new clock or availability is added.
 * All profile values below are declared synthetic presentation inputs, not a
 * fresh provider observation, options valuation or trade recommendation.
 */
export const PROFILE_ROUTE = "/options?tab=positioning";
export const PROFILE_FEED = "gex:SPY";
export const PROFILE_SPOT = 750.1234567890123;
export const PROFILE_LOWER_CROSSING = 743.8734567890123;
export const PROFILE_UPPER_CROSSING = 756.3734567890123;
export const PROFILE_FAR_CROSSING = 774.2484567890123;
export const PROFILE_CALL_WALL = 790.2484567890123;
export const PROFILE_PUT_WALL = 709.9984567890123;
export const PROFILE_TINY_GAMMA_BN = 2 ** -36;

export type ProfileFixtureVariant =
  | "dense"
  | "sparse10"
  | "filtered"
  | "malformed"
  | "empty"
  | "absent";

const BASE = gexFixture.SPY;
if (BASE.root !== "SPY" || !Array.isArray(BASE.by_strike) || BASE.by_strike.length === 0
  || BASE.profile?.method !== "spot_grid_reprice" || BASE.profile.span_pct !== 25) {
  throw new Error("The incumbent SPY fixture changed; re-inspect before adapting this fixture");
}

const GRID = [
  PROFILE_SPOT * 0.75,
  PROFILE_SPOT - 120.125,
  PROFILE_SPOT - 60.125,
  PROFILE_SPOT - 24.125,
  PROFILE_LOWER_CROSSING,
  PROFILE_SPOT - 3.125,
  PROFILE_SPOT,
  PROFILE_SPOT + 3.125,
  PROFILE_UPPER_CROSSING,
  PROFILE_SPOT + 12.5,
  PROFILE_FAR_CROSSING,
  PROFILE_SPOT + 80.125,
  PROFILE_SPOT * 1.25,
];

const GAMMA_BN = [
  -1.2345678901234567,
  -0.75,
  -0.25,
  -(2 ** -20),
  0,
  PROFILE_TINY_GAMMA_BN,
  0.12345678901234566,
  0.25,
  0,
  -0.125,
  0,
  0.75,
  1.2345678901234567,
];

/** Preserve the ±25% endpoints and all three supplied crossing samples. */
const SPARSE_INDICES = [0, 2, 4, 5, 6, 7, 8, 9, 10, 12];

/**
 * Record<string, unknown> is intentional: malformed wire variants are NOT cast
 * into a valid GexPayload. Their parent envelope remains valid and nonempty.
 *
 * The incumbent finite-pair rule is index-based over min(array lengths), with
 * no sorting, coercion, interpolation or pairing of unmatched trailing values.
 */
export function profileGexFixture(
  variant: ProfileFixtureVariant = "dense",
  reverseCrossingTie = false,
): Record<string, unknown> {
  const book = structuredClone(BASE) as unknown as Record<string, unknown>;
  book.spot_ref = PROFILE_SPOT;
  book.call_wall = PROFILE_CALL_WALL;
  book.put_wall = PROFILE_PUT_WALL;
  const crossings = reverseCrossingTie
    ? [PROFILE_LOWER_CROSSING, PROFILE_UPPER_CROSSING, PROFILE_FAR_CROSSING]
    : [PROFILE_UPPER_CROSSING, PROFILE_LOWER_CROSSING, PROFILE_FAR_CROSSING];
  // The displayed flip and supplied headline level agree in each tie variant.
  book.gamma_flip = crossings[0];
  const profile: Record<string, unknown> = {
    method: BASE.profile.method,
    span_pct: BASE.profile.span_pct,
    grid: [...GRID],
    gamma_bn: [...GAMMA_BN],
    crossings,
  };
  if (variant === "sparse10") {
    profile.grid = SPARSE_INDICES.map(i => GRID[i]);
    profile.gamma_bn = SPARSE_INDICES.map(i => GAMMA_BN[i]);
  } else if (variant === "filtered") {
    // 16 paired positions: 13 finite pairs and three rejected pairs.
    // The 17th grid value is unpaired and must be ignored.
    // Use JSON-safe null/strings: JSON serializes NaN/Infinity to null.
    profile.grid = [...GRID, null, PROFILE_SPOT + 6, "753", PROFILE_SPOT + 99];
    profile.gamma_bn = [...GAMMA_BN, 7, "0.01", 0];
    profile.crossings = [crossings[0], "748", null, crossings[1], crossings[2]];
  } else if (variant === "malformed") {
    profile.grid = { supplied: [...GRID] }; // not an array: zero admitted pairs
  } else if (variant === "empty") {
    profile.grid = []; profile.gamma_bn = []; profile.crossings = [];
    book.gamma_flip = null;
  }
  book.profile = variant === "absent" ? null : profile;
  return book;
}

export const PROFILE_EXPECTED = {
  // Existing fixture clocks are retained. No availability timestamp is asserted.
  asof: "2026-07-10T20:15:00Z",
  method: "spot_grid_reprice",
  spanPct: "25",
  unit: "bn", // existing Gamma unit; do NOT multiply by 1e9 or 100
  referenceSpot: "750.1234567890123",
  callWall: "790.2484567890123",
  putWall: "709.9984567890123",
  crossingsInSourceOrder: [
    "756.3734567890123", "743.8734567890123", "774.2484567890123",
  ],
  nearestCrossing: "756.3734567890123",
  nearestCrossingWhenTieReversed: "743.8734567890123",
  tieDistance: 6.25,
  densePairs: 13,
  sparsePairs: 10,
  filteredPairs: 13,
  filteredPairedPositions: 16,
  filteredUnpairedGridValues: 1,
  malformedPairs: 0,
  emptyPairs: 0,
  negativeGamma: "-1.2345678901234567",
  zeroGamma: "0",
  tinyPositiveGamma: "1.4551915228366852e-11",
  tinyNegativeGamma: "-9.5367431640625e-7",
  zeroSpots: [
    "743.8734567890123", "756.3734567890123", "774.2484567890123",
  ],
  tinyPositiveSpot: "746.9984567890123",
  referenceGamma: "0.12345678901234566",
  chartGate: {
    dense: true, sparse10: false, filtered: true,
    malformed: false, empty: false, absent: false,
  },
  signSplit: false,
} as const;

async function capture(page: Page, target: Locator, name: string) {
  await target.scrollIntoViewIfNeeded();
  await expect.poll(() => target.evaluate(el => {
    const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1 && !!hit && (el === hit || el.contains(hit));
  })).toBe(true);
  const viewport = page.viewportSize();
  const observed = await target.evaluate(el => {
    const r = el.getBoundingClientRect();
    return { innerWidth, innerHeight, devicePixelRatio, cssZoom: getComputedStyle(document.documentElement).zoom,
      target: { tag: el.tagName, text: el.textContent?.slice(0, 140), left: r.left, top: r.top, width: r.width, height: r.height } };
  });
  await page.screenshot({ path: `test-results/${name}.png`, fullPage: false });
  expect(page.viewportSize()).toEqual(viewport);
  writeFileSync(`test-results/${name}-capture.json`, JSON.stringify({ schema: "d08b.viewport_capture.v1", viewport, fullPage: false, ...observed }, null, 2));
}

async function fit(panel: Locator) {
  const bad = await panel.evaluate(root => {
    const box = root.getBoundingClientRect(); let left = Math.max(0, box.left), right = Math.min(innerWidth, box.right);
    for (let parent = root.parentElement; parent; parent = parent.parentElement) {
      if (!/hidden|clip|auto|scroll/.test(getComputedStyle(parent).overflowX)) continue;
      const r = parent.getBoundingClientRect(); left = Math.max(left, r.left); right = Math.min(right, r.right);
    }
    const failures: string[] = [];
    for (const el of root.querySelectorAll("button,summary,table,th,td,p,dt,dd,h3,h4,span,strong,svg,svg text")) {
      if (!el.getClientRects().length) continue;
      const disclosure = el.closest("details:not([open])");
      if (disclosure && !disclosure.querySelector("summary")?.contains(el)) continue;
      const rects = [el.getBoundingClientRect()];
      for (const node of el.childNodes) if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
        const range = document.createRange(); range.selectNodeContents(node); rects.push(...range.getClientRects());
      }
      if (rects.some(r => r.width && (r.left < left - 1 || r.right > right + 1))) failures.push(`${el.tagName}: ${el.textContent?.slice(0, 60)}`);
    }
    return failures;
  });
  expect(bad).toEqual([]);
}

async function measureContrast(panel: Locator) {
  return panel.evaluate(root => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d")!;
    const rgba = (color: string) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; };
    const background = (el: Element): number[] => {
      for (let node: Element | null = el; node; node = node.parentElement) {
        const c = rgba(getComputedStyle(node).backgroundColor); if (c[3] === 255) return c;
      }
      throw new Error("No opaque background found for contrast sample");
    };
    const luminance = (color: number[]) => color.slice(0, 3).map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (a: number[], b: number[]) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const texts = [...root.querySelectorAll("button,summary,p,th,td,dt,dd,h3,h4,span,strong,svg text")].filter(el => {
      const disclosure = el.closest("details:not([open])");
      const paintsText = [...el.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
      return paintsText && el.getClientRects().length && (!disclosure || disclosure.querySelector("summary")?.contains(el));
    });
    const text = texts.map(el => ({ text: el.textContent?.slice(0, 70), ratio: ratio(rgba(getComputedStyle(el)[el instanceof SVGElement ? "fill" : "color"]), background(el)) }));
    const marks = [...root.querySelectorAll("svg polyline,svg circle,svg line[stroke-dasharray]")].filter(el => el.getClientRects().length).map(el => ({
      shape: el.tagName, ratio: ratio(rgba(getComputedStyle(el)[el.tagName === "circle" ? "fill" : "stroke"]), background(el)),
    }));
    return { text, marks };
  });
}


async function wire(page: Page, lang: "en" | "zh", book: () => Record<string, unknown>, status: () => number = () => 200) {
  await page.clock.install({ time: new Date("2026-11-05T02:00:00Z") });
  await page.addInitScript(locale => { localStorage.setItem("mm.lang", locale); Reflect.deleteProperty(window, "EventSource"); }, lang);
  await page.route(url => url.pathname === "/api/flow/stream", route => route.abort("failed"));
  await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === PROFILE_FEED, route => status() === 200
    ? route.fulfill({ json: book() })
    : route.fulfill({ status: status(), json: { error: "profile test source unavailable" } }));
}

async function enter(page: Page, lang: "en" | "zh", book: () => Record<string, unknown> = () => profileGexFixture()) {
  await wire(page, lang, book);
  await page.goto(PROFILE_ROUTE);
  const panel = page.getByTestId("positioning-profile-panel");
  await expect(panel).toBeVisible({ timeout: 30_000 });
  return panel;
}

function controls(panel: Locator, lang: "en" | "zh") {
  const group = panel.getByTestId("profile-view-controls");
  return {
    chart: group.getByRole("button", { name: lang === "en" ? "Chart" : "图表", exact: true }),
    exact: group.getByRole("button", { name: lang === "en" ? "Exact profile values" : "精确曲线数值", exact: true }),
  };
}

async function openSource(panel: Locator) {
  const source = panel.getByTestId("profile-source");
  if (await source.getAttribute("open") === null) {
    await source.locator("summary").focus(); await panel.page().keyboard.press("Enter");
  }
  await expect(source).toHaveAttribute("open", "");
  return source;
}

async function controlSizes(panel: Locator) {
  const small = await panel.locator("button:visible,summary:visible").evaluateAll(elements => elements.filter(el => {
    const r = el.getBoundingClientRect(); return r.width < 44 || r.height < 44;
  }).map(el => ({ text: el.textContent, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })));
  expect(small).toEqual([]);
}

test("baseline: current Positioning profile at320px and sparse source", async ({ page }, info) => {
  test.skip(process.env.D08B_PROFILE_BASELINE !== "1" || info.project.name !== "desktop", "Opt-in before-change observation only.");
  await page.setViewportSize({ width: 320, height: 844 });
  let variant: ProfileFixtureVariant = "dense";
  await wire(page, "en", () => profileGexFixture(variant));
  await page.goto(PROFILE_ROUTE);
  const title = page.getByText("Exposure profile", { exact: true }).first();
  await expect(title).toBeVisible({ timeout: 30_000 });
  const card = title.locator("xpath=ancestor::section[1]");
  await title.scrollIntoViewIfNeeded();
  await expect(card.getByRole("img", { name: "Exposure profile", exact: true })).toBeVisible();
  const bounds = await card.evaluate(el => {
    const box = (node: Element) => { const r = node.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };
    return { viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.scrollWidth,
      card: box(el), svg: box(el.querySelector("svg[role=img]")!), text: el.textContent };
  });
  writeFileSync("test-results/d08b-profile-before-320-bounds.json", JSON.stringify(bounds, null, 2));
  await capture(page, title, "d08b-profile-before-320");
  variant = "sparse10";
  await page.reload(); await expect(title).toBeVisible({ timeout: 30_000 });
  await expect(card.locator("svg[role=img]")).toHaveCount(0);
  writeFileSync("test-results/d08b-profile-before-sparse-text.json", JSON.stringify({ text: await card.textContent() }, null, 2));
  await capture(page, title, "d08b-profile-before-sparse");
});

function visibleRows(panel: Locator) { return panel.locator("[data-row]:visible"); }
function visibleRow(panel: Locator, row: number) { return panel.locator('[data-row="' + row + '"]:visible'); }
function signed(v: number) { return v > 0 ? `+${String(v)}` : String(v); }

async function exactSamples(panel: Locator, book: Record<string, unknown>) {
  const profile = book.profile as { grid: unknown[]; gamma_bn: unknown[] };
  const expected = profile.grid.slice(0, profile.gamma_bn.length).flatMap((x, i) => {
    const y = profile.gamma_bn[i];
    return typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y)
      ? [{ spot: String(x), gamma: signed(y) }] : [];
  });
  await expect(visibleRows(panel)).toHaveCount(expected.length);
  for (const [i, values] of expected.entries()) for (const [field, value] of Object.entries(values)) {
    const cell = visibleRow(panel, i).locator('[data-field="' + field + '"]');
    await expect(cell).toHaveText(value);
    expect(await cell.evaluate(el => {
      const r = document.createRange(); r.selectNodeContents(el);
      return new Set([...r.getClientRects()].filter(x => x.width > 0).map(x => Math.round(x.top))).size;
    })).toBe(1);
  }
  // An investigation table/card does not turn hypothetical samples into contracts.
  await expect(panel.locator("[data-row]:visible").getByRole("button")).toHaveCount(0);
  await expect(panel.locator("[data-row]:visible").getByRole("link")).toHaveCount(0);
}

for (const lang of ["en", "zh"] as const) {
  test("Profile " + lang + ": exact modeled samples, source references and keyboard presentation", async ({ page }, info) => {
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    const book = profileGexFixture();
    const panel = await enter(page, lang, () => book), card = panel.locator("..");
    const view = controls(panel, lang);
    await expect.poll(async () => {
      const sizes = await panel.getByTestId("profile-measure").evaluate(el => ({ width: el.getBoundingClientRect().width, svg: el.querySelector("svg")?.getBoundingClientRect().width }));
      return !!sizes.svg && Math.abs(sizes.width - sizes.svg) <= 1;
    }).toBe(true);
    const points = await panel.locator("svg polyline").getAttribute("points");
    expect(points?.split(" ")).toHaveLength(13);

    for (const theme of ["dark", "light-tokens"] as const) {
      await applyD08BPanelPresentation(card, theme);
      await view.chart.focus(); await page.keyboard.press("Enter");
      await expect(view.chart).toBeFocused(); await expect(view.chart).toHaveAttribute("aria-pressed", "true");
      await expect(panel.locator("svg polyline")).toHaveAttribute("points", points!);
      await fit(card); await controlSizes(panel);
      const chartContrast = await measureContrast(card);
      writeFileSync(`test-results/d08b-profile-${info.project.name}-${lang}-${theme}-chart-contrast.json`, JSON.stringify(chartContrast, null, 2));
      expect(chartContrast.text.filter(item => item.ratio < 4.5)).toEqual([]);
      expect(chartContrast.marks.filter(item => item.ratio < 3)).toEqual([]);
      await capture(page, panel.locator("svg[role=img]"), `d08b-profile-${info.project.name}-${lang}-${theme}-chart`);

      await view.exact.focus(); await page.keyboard.press("Enter");
      await expect(view.exact).toBeFocused(); await expect(view.exact).toHaveAttribute("aria-pressed", "true");
      await exactSamples(panel, book);
      if (await panel.getByTestId("profile-exact-table").isVisible()) {
        await expect(panel.getByRole("table").getByRole("columnheader")).toHaveCount(2);
        await expect(panel.getByTestId("profile-exact-cards")).not.toBeVisible();
      } else {
        await expect(panel.getByTestId("profile-exact-cards")).toBeVisible();
        await expect(panel.getByRole("table")).toHaveCount(0);
      }
      await expect(page.locator('input[list="msc-roots"]')).toHaveValue("SPY");
      await expect(panel.getByTestId("profile-values-status")).toContainText("13");
      await fit(card); await controlSizes(panel);
      await capture(page, visibleRow(panel, 5).locator('[data-field="gamma"]'), `d08b-profile-${info.project.name}-${lang}-${theme}-exact`);

      await openSource(panel);
      for (const [key, value] of Object.entries({
        "profile-source-root": "SPY", "profile-source-asof": PROFILE_EXPECTED.asof,
        "profile-source-method": PROFILE_EXPECTED.method, "profile-source-span": "25%",
        "profile-reference-spot": PROFILE_EXPECTED.referenceSpot,
        "profile-reference-callWall": PROFILE_EXPECTED.callWall,
        "profile-reference-putWall": PROFILE_EXPECTED.putWall,
        "profile-reference-flip": PROFILE_EXPECTED.nearestCrossing,
      })) await expect(panel.getByTestId(key)).toHaveText(value);
      await expect(panel.getByTestId("profile-crossings").locator("li")).toHaveText([...PROFILE_EXPECTED.crossingsInSourceOrder]);
      await fit(card);
      const exactContrast = await measureContrast(card);
      writeFileSync(`test-results/d08b-profile-${info.project.name}-${lang}-${theme}-exact-contrast.json`, JSON.stringify(exactContrast, null, 2));
      expect(exactContrast.text.filter(item => item.ratio < 4.5)).toEqual([]);
      await capture(page, panel.getByTestId("profile-reference-flip"), `d08b-profile-${info.project.name}-${lang}-${theme}-source`);
      await view.chart.focus(); await page.keyboard.press("Enter");
      await expect(panel.locator("svg polyline")).toHaveAttribute("points", points!);
    }
    expect(errors).toEqual([]);
  });
}

test("Profile: sparse samples, filtered wire, root-bound loss and reload recovery", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Source transition cases are exercised once.");
  let variant: ProfileFixtureVariant = "sparse10";
  await wire(page, "en", () => profileGexFixture(variant));
  await page.goto(PROFILE_ROUTE);
  const panel = page.getByTestId("positioning-profile-panel");
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByTestId("profile-empty")).toBeVisible();
  await expect(panel.locator("svg[role=img]")).toHaveCount(0);
  await expect(panel).not.toContainText("next nightly build");
  await controls(panel, "en").exact.click();
  await exactSamples(panel, profileGexFixture("sparse10"));
  await expect(visibleRows(panel)).toHaveCount(10);
  await capture(page, visibleRows(panel).last().locator('[data-field="gamma"]'), "d08b-profile-sparse-exact");

  variant = "filtered"; await page.reload();
  await expect(panel.locator("svg polyline")).toBeVisible({ timeout: 30_000 });
  await controls(panel, "en").exact.click(); await exactSamples(panel, profileGexFixture("filtered"));
  await openSource(panel);
  await expect(panel.getByTestId("profile-crossings").locator("li")).toHaveText([...PROFILE_EXPECTED.crossingsInSourceOrder]);
  await capture(page, visibleRow(panel, 5).locator('[data-field="gamma"]'), "d08b-profile-filtered-exact");

  variant = "absent"; await page.reload();
  await expect(panel.getByTestId("profile-empty")).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByTestId("profile-view-controls")).toHaveCount(0);
  await expect(panel.getByTestId("profile-source")).toHaveCount(0);
  await expect(panel).not.toContainText(PROFILE_EXPECTED.tinyPositiveGamma);
  await capture(page, panel.getByTestId("profile-empty"), "d08b-profile-source-absent");

  variant = "dense"; await page.reload();
  await expect(panel.locator("svg polyline")).toBeVisible({ timeout: 30_000 });
  await controls(panel, "en").exact.click(); await exactSamples(panel, profileGexFixture());
  // The existing parent has no polling or Retry. A new committed root actually re-reads.
  await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === "gex:QQQ", route => route.fulfill({ status: 403, json: { error: "test access unavailable" } }));
  const input = page.locator('input[list="msc-roots"]');
  await input.fill("QQQ"); await input.press("Enter");
  await expect(panel).toHaveCount(0);
  await expect(page.getByText("Could not load", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("body")).not.toContainText(PROFILE_EXPECTED.tinyPositiveGamma);
  await capture(page, input, "d08b-profile-root-access-loss");

  // Full reload resets the existing parent to SPY. This is not an in-place Retry claim.
  await page.reload(); await expect(panel).toBeVisible({ timeout: 30_000 });
  await expect(input).toHaveValue("SPY");
  await controls(panel, "en").exact.click(); await exactSamples(panel, profileGexFixture());
  await openSource(panel); await expect(panel.getByTestId("profile-source-asof")).toHaveText(PROFILE_EXPECTED.asof);
  await capture(page, panel.getByTestId("profile-source-asof"), "d08b-profile-reload-recovered");
});

test("Profile:320px, magnification and narrow-card keyboard alternative", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Extra widths are exercised once.");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const panel = await enter(page, "zh"), card = panel.locator("..");
  const view = controls(panel, "zh");
  await page.setViewportSize({ width: 320, height: 844 });
  await view.exact.click(); await exactSamples(panel, profileGexFixture());
  await fit(card); await controlSizes(panel);
  await capture(page, view.exact, "d08b-profile-320-zh-controls");
  await capture(page, visibleRow(panel, 5).locator('[data-field="gamma"]'), "d08b-profile-320-zh-precision");
  await capture(page, visibleRows(panel).last().locator('[data-field="gamma"]'), "d08b-profile-320-zh-last");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  await exactSamples(panel, profileGexFixture()); await fit(card); await controlSizes(panel);
  await capture(page, visibleRow(panel, 5).locator('[data-field="gamma"]'), "d08b-profile-css-200percent");

  await page.evaluate(() => { document.documentElement.style.zoom = "1"; });
  await card.evaluate(el => { const node = el as HTMLElement; node.style.width = "230px"; node.style.minWidth = "0"; });
  await applyD08BPanelPresentation(card, "light-tokens");
  await view.chart.click();
  const narrow = panel.getByTestId("profile-narrow-action");
  await expect(narrow).toBeVisible(); await fit(card);
  await capture(page, narrow, "d08b-profile-230-chart-alternative");
  await narrow.focus(); await page.keyboard.press("Enter");
  await expect(view.exact).toBeFocused();
  await exactSamples(panel, profileGexFixture()); await fit(card); await controlSizes(panel);
  await capture(page, visibleRow(panel, 5).locator('[data-field="gamma"]'), "d08b-profile-230-light-precision");
  await openSource(panel); await fit(card);
  await capture(page, panel.getByTestId("profile-reference-flip"), "d08b-profile-230-light-source");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
