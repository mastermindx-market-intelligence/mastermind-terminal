import { expect, test, type Locator, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { applyD08BPanelPresentation } from "./d08bPanelPresentation";
import gexFixture from "../public/data/gex_fixture.json";


/**
 * Focused Positioning / SignCard synthetic fixtures for a terminal/e2e spec.
 * Source inspected: Terminal5903c07acf867366659cec689e6547b08c00ee87.
 * No auth/fetch/cache/model owner is replaced. Only the gex:SPY feed is overridden.
 * A nonempty by_strike array retains the actual Positioning parent admission.
 *
 * Strike Greek and convention-curve values are USD mn per +1% spot. The GEX
 * headline uses bn, so this complete three-strike toy book supplies sum/1000.
 * The original SPY asof, root, schema, reference spot and convention are retained.
 * Unrelated profile/history/delta/expiry/level evidence is withheld rather than
 * being copied onto a different synthetic ladder.
 */
const SIGN_ROUTE = "/options?tab=positioning";
const SIGN_FEED = "gex:SPY";
const SIGN_WEIGHTS = [-1, -0.5, 0, 0.5, 1] as const;
type SignFixtureVariant =
  | "unknown-net-only"
  | "unknown-zero-sides"
  | "robust"
  | "fragile"
  | "put-only";

type RawStrike = { strike: number; gamma_net: number; gamma_call?: number; gamma_put?: number };
const BASE = gexFixture.SPY;
const ROWS: Record<SignFixtureVariant, RawStrike[]> = {
  "unknown-net-only": [
    { strike: 740, gamma_net: 80 },
    { strike: 750, gamma_net: 0 },
    { strike: 760, gamma_net: -20 },
  ],
  "unknown-zero-sides": [
    { strike: 740, gamma_net: 0, gamma_call: 0, gamma_put: 0 },
    { strike: 750, gamma_net: 0, gamma_call: 0, gamma_put: 0 },
    { strike: 760, gamma_net: 0, gamma_call: 0, gamma_put: 0 },
  ],
  robust: [
    { strike: 740, gamma_net: 100, gamma_call: 120, gamma_put: -20 },
    { strike: 750, gamma_net: 120, gamma_call: 160, gamma_put: -40 },
    { strike: 760, gamma_net: 80, gamma_call: 120, gamma_put: -40 },
  ],
  fragile: [
    { strike: 740, gamma_net: 20, gamma_call: 120, gamma_put: -100 },
    { strike: 750, gamma_net: 0, gamma_call: 160, gamma_put: -160 },
    { strike: 760, gamma_net: 20, gamma_call: 120, gamma_put: -100 },
  ],
  "put-only": [
    { strike: 740, gamma_net: -80, gamma_call: 0, gamma_put: -80 },
    { strike: 750, gamma_net: -100, gamma_call: 0, gamma_put: -100 },
    { strike: 760, gamma_net: -120, gamma_call: 0, gamma_put: -120 },
  ],
};

/**
 * Raw wire type is deliberate. Missing side columns in the net-only case must
 * stay missing; they are not cast into a fully qualified GexPayload/strike row.
 */
function signGexFixture(variant: SignFixtureVariant): Record<string, unknown> {
  const book = structuredClone(BASE) as unknown as Record<string, unknown>;
  const rows = structuredClone(ROWS[variant]);
  book.by_strike = rows;
  book.by_strike_full_n = rows.length;
  // Current MarketStructureBody reads by_strike, not by_strike_full.
  // If the incumbent fixture gains a full ladder, keep it coherent as well.
  if (Object.hasOwn(book, "by_strike_full")) book.by_strike_full = structuredClone(rows);
  book.net_gex_bn = rows.reduce((sum, row) => sum + row.gamma_net, 0) / 1000;
  book.profile = null;
  book.by_expiry = [];
  book.by_delta = [];
  book.call_wall = null; book.put_wall = null; book.gamma_flip = null;
  for (const key of ["max_pain", "magnet", "hvl"]) if (Object.hasOwn(book, key)) book[key] = null;
  delete book.history;
  delete book.coverage;
  return book;
}

/**
 * Constants for independent assertions, not values injected into the product.
 * For all variants: nStrikes=3, nStrikesFull=3, gammaKnown=3 and windowed=false.
 * The unknown net-only case intentionally demonstrates that nonzero reported
 * gamma_net does NOT supply the missing side-magnitude robustness basis.
 */
const SIGN_EXPECTED = {
  "unknown-net-only": {
    verdict: "unknown", gammaMn: 60, callAbsMn: 0, putAbsMn: 0,
    tilt: null, confidence: null, criticalWeight: null,
    naiveNetMn: 0, curveNetMn: [-0, -0, 0, 0, 0], criticalInRange: false,
  },
  "unknown-zero-sides": {
    verdict: "unknown", gammaMn: 0, callAbsMn: 0, putAbsMn: 0,
    tilt: null, confidence: null, criticalWeight: null,
    naiveNetMn: 0, curveNetMn: [-0, -0, 0, 0, 0], criticalInRange: false,
  },
  robust: {
    verdict: "robust", gammaMn: 300, callAbsMn: 400, putAbsMn: 100,
    tilt: 0.6, confidence: 0.6, criticalWeight: 0.25,
    naiveNetMn: 300, curveNetMn: [-500, -300, -100, 100, 300], criticalInRange: true,
  },
  fragile: {
    verdict: "fragile", gammaMn: 40, callAbsMn: 400, putAbsMn: 360,
    tilt: 0.05263157894736842, confidence: 0.05263157894736842, criticalWeight: 0.9,
    naiveNetMn: 40, curveNetMn: [-760, -560, -360, -160, 40], criticalInRange: true,
  },
  "put-only": {
    verdict: "robust", gammaMn: -300, callAbsMn: 0, putAbsMn: 300,
    tilt: -1, confidence: 1, criticalWeight: null,
    naiveNetMn: -300, curveNetMn: [-300, -300, -300, -300, -300], criticalInRange: false,
  },
} as const;


const BASELINE = process.env.D08B_SIGN_BASELINE === "1";
type Lang = "en" | "zh";

const COPY = {
  en: {
    title: "Sign robustness", tilt: "Gamma tilt", critical: "Flips at call weight", verdict: "Verdict",
    unknown: "Unknown", undetermined: "Not determined", robust: "Robust", fragile: "Fragile",
    noFlip: "No plausible weight flips it", oldUnknown: "No gamma",
    unknownNote: "These inputs do not establish the sign-sensitivity estimate; robustness and a flip weight are not determined.",
    robustNote: "Absolute Gamma tilt is at least 12.0%. Inspect the curve and flip weight to see whether another call-side weight reverses the estimated sign.",
    fragileNote: "Call and put gamma are close to balanced — a small change of convention would flip the regime read. Treat the sign as unresolved.",
    oldRobustNote: "The regime read survives the full range of conventions we consider plausible.",
    convention: "Convention", loadError: "Could not load",
    axis: ["−1 dealers short calls", "0 calls unsigned", "+1 dealers long calls"],
  },
  zh: {
    title: "符号稳健性", tilt: "伽马倾斜", critical: "翻转于看涨权重", verdict: "结论",
    unknown: "未知", undetermined: "未确定", robust: "稳健", fragile: "脆弱",
    noFlip: "任何合理权重都无法翻转", oldUnknown: "无伽马",
    unknownNote: "这些输入无法确定符号敏感性估计；稳健性与翻转权重均未确定。",
    robustNote: "Gamma 倾斜的绝对值不低于 12.0%。曲线与翻转权重显示其他看涨方权重是否会改变估计符号。",
    fragileNote: "看涨与看跌伽马接近平衡——约定的微小变化即可翻转该判断。应视符号为未定。",
    oldRobustNote: "该判断在我们认为合理的全部约定范围内均成立。",
    convention: "约定", loadError: "无法加载",
    axis: ["−1 做市商看涨空头", "0 看涨方无符号", "+1 做市商看涨多头"],
  },
} as const;

/** Same fixture/auth/stream arrangement as the verified Profile route spec. */
async function wire(page: Page, lang: Lang, book: () => Record<string, unknown>) {
  await page.clock.install({ time: new Date("2026-11-05T02:00:00Z") });
  await page.addInitScript(locale => {
    localStorage.setItem("mm.lang", locale);
    Reflect.deleteProperty(window, "EventSource");
  }, lang);
  await page.route(url => url.pathname === "/api/flow/stream", route => route.abort("failed"));
  await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === SIGN_FEED,
    route => route.fulfill({ json: book() }));
}

async function load(page: Page, variant: SignFixtureVariant, initial = false) {
  const [response] = await Promise.all([
    page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === "/api/flow" && url.searchParams.get("f") === SIGN_FEED;
    }),
    initial ? page.goto(SIGN_ROUTE) : page.reload(),
  ]);
  expect(response.ok()).toBe(true);
  const received = await response.json() as Record<string, unknown>;
  expect(received.root).toBe("SPY");
  expect(received.asof).toBe(BASE.asof);
  expect(received.convention).toBe(BASE.convention);
  const rows = received.by_strike as RawStrike[];
  expect(rows).toHaveLength(3);
  expect(rows.reduce((sum, row) => sum + row.gamma_net, 0)).toBe(SIGN_EXPECTED[variant].gammaMn);
  expect(received.net_gex_bn).toBe(SIGN_EXPECTED[variant].gammaMn / 1000);
  expect(received.profile).toBeNull();
  return received;
}

function cardFor(page: Page, lang: Lang) {
  return page.getByText(COPY[lang].title, { exact: true }).first().locator("xpath=ancestor::section[1]");
}

/** Bounded hit-tested viewport evidence, never an oversized element screenshot. */
async function capture(page: Page, target: Locator, name: string, context: Record<string, unknown> = {}) {
  await target.scrollIntoViewIfNeeded();
  await expect.poll(() => target.evaluate(el => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1
      && !!hit && (el === hit || el.contains(hit));
  })).toBe(true);
  const viewport = page.viewportSize();
  const observed = await target.evaluate(el => {
    const r = el.getBoundingClientRect();
    return {
      innerWidth, innerHeight, devicePixelRatio,
      cssZoom: getComputedStyle(document.documentElement).zoom,
      target: {
        tag: el.tagName, text: el.textContent?.slice(0, 180),
        left: r.left, top: r.top, width: r.width, height: r.height,
      },
    };
  });
  await page.screenshot({ path: "test-results/" + name + ".png", fullPage: false });
  expect(page.viewportSize()).toEqual(viewport);
  writeFileSync("test-results/" + name + "-capture.json", JSON.stringify({
    schema: "d08b.viewport_capture.v1", viewport, fullPage: false, ...observed, ...context,
  }, null, 2));
}

test("baseline: incumbent Sign labels known net Gamma absent and guarantees a crossing regime", async ({ page }, info) => {
  test.skip(!BASELINE || info.project.name !== "desktop", "Opt-in original-source defect capture only.");
  test.setTimeout(90_000);
  let variant: SignFixtureVariant = "unknown-net-only";
  await wire(page, "en", () => signGexFixture(variant));
  const received = await load(page, variant, true);
  const card = cardFor(page, "en");
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card.getByText(COPY.en.oldUnknown, { exact: true })).toBeVisible();
  await expect(card.getByText(COPY.en.noFlip, { exact: true })).toBeVisible();
  await expect(card).toContainText(COPY.en.oldRobustNote);
  await expect(card).toContainText(BASE.convention);
  const line = card.locator("svg polyline");
  // A rendered horizontal stroke has a zero-height SVG geometry bounding box.
  // Observe its visible viewport, retained element and finite points instead.
  await expect(card.locator("svg:has(> polyline)")).toBeVisible();
  await expect(line).toHaveCount(1);
  const unknownPoints = (await line.getAttribute("points"))!.trim().split(/\s+/).map(p => p.split(",").map(Number));
  expect(unknownPoints).toHaveLength(5);
  expect(Math.max(...unknownPoints.map(p => p[1])) - Math.min(...unknownPoints.map(p => p[1]))).toBeLessThan(0.001);
  await capture(page, card, "d08b-sign-before-net-only", {
    phase: "original-source baseline", fixtureVariant: variant,
    reportedGammaMn: 60, falseUnknown: COPY.en.oldUnknown,
    falseCritical: COPY.en.noFlip, falseRobustGuarantee: COPY.en.oldRobustNote,
  });

  variant = "robust";
  await load(page, variant);
  await expect(card.getByText(COPY.en.robust, { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(card.getByText("0.25", { exact: true })).toBeVisible();
  await expect(card).toContainText(COPY.en.oldRobustNote);
  const robustPoints = (await line.getAttribute("points"))!.trim().split(/\s+/).map(p => p.split(",").map(Number));
  expect(robustPoints).toHaveLength(5);
  const zeroY = await card.locator("svg:has(> polyline) > line").first().getAttribute("y1");
  expect(robustPoints[0][1]).toBeGreaterThan(Number(zeroY));
  expect(robustPoints[4][1]).toBeLessThan(Number(zeroY));
  await capture(page, card, "d08b-sign-before-robust-crossing", {
    phase: "original-source baseline", fixtureVariant: variant,
    knownCriticalWeight: 0.25, crossesWithinPlausibleRange: true,
    falseRobustGuarantee: COPY.en.oldRobustNote,
  });
  writeFileSync("test-results/d08b-sign-before-observations.json", JSON.stringify({
    schema: "d08b.sign_baseline.v1",
    source: { root: received.root, asof: received.asof, convention: received.convention, reportedGammaMn: 60 },
    unknown: { points: unknownPoints, wrongVerdict: COPY.en.oldUnknown, wrongCritical: COPY.en.noFlip },
    robust: { criticalWeight: 0.25, points: robustPoints, wrongGuarantee: COPY.en.oldRobustNote },
    acceptance: "Demonstrates incumbent defects; this is not a final-product pass.",
  }, null, 2));
});


function statValue(card: Locator, label: string) {
  return card.getByTestId("sign-sensitivity-values").locator(":scope > div")
    .filter({ hasText: label }).locator(":scope > span").last();
}

/** Horizontal clipping/text-bound checks borrowed from the actual Profile route spec. */
async function fit(card: Locator) {
  const failures = await card.evaluate(root => {
    const r = root.getBoundingClientRect();
    let left = Math.max(0, r.left), right = Math.min(innerWidth, r.right);
    for (let parent = root.parentElement; parent; parent = parent.parentElement) {
      if (!/hidden|clip|auto|scroll/.test(getComputedStyle(parent).overflowX)) continue;
      const bounds = parent.getBoundingClientRect();
      left = Math.max(left, bounds.left); right = Math.min(right, bounds.right);
    }
    const failures: string[] = [];
    for (const el of root.querySelectorAll("input,button,p,h3,h4,span,strong,svg,svg text")) {
      if (!el.getClientRects().length) continue;
      const rects = [el.getBoundingClientRect()];
      for (const node of el.childNodes) if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
        const range = document.createRange(); range.selectNodeContents(node);
        rects.push(...range.getClientRects());
      }
      if (rects.some(rect => rect.width && (rect.left < left - 1 || rect.right > right + 1))) {
        failures.push(el.tagName + ": " + el.textContent?.slice(0, 100));
      }
    }
    return failures;
  });
  expect(failures).toEqual([]);
}

/** Bounded direct-style contrast checks; not complete accessibility certification. */
async function sampleContrast(card: Locator) {
  const result = await card.evaluate(root => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d")!;
    const rgba = (color: string) => {
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data];
    };
    const background = (element: Element): number[] => {
      for (let node: Element | null = element; node; node = node.parentElement) {
        const c = rgba(getComputedStyle(node).backgroundColor); if (c[3] === 255) return c;
      }
      throw new Error("No opaque background for a Sign contrast sample");
    };
    const lum = (c: number[]) => c.slice(0, 3).map(v => v / 255)
      .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
      .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (a: number[], b: number[]) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    const text = [...root.querySelectorAll("button,p,div,h3,h4,span,strong,svg text")].filter(el =>
      el.getClientRects().length && [...el.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()),
    ).map(el => {
      const style = getComputedStyle(el), color = style[el instanceof SVGElement ? "fill" : "color"], bg = background(el);
      return {
        tag: el.tagName, testId: el.getAttribute("data-testid"),
        text: [...el.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join("").trim(),
        color, backgroundRgba: bg, fontSize: style.fontSize, fontWeight: style.fontWeight,
        opacity: style.opacity, ratio: ratio(rgba(color), bg),
      };
    });
    // A constant curve may have a zero-height polyline bounding box. Its SVG
    // viewport is the visibility surface; retain the stroke in the diagnostic.
    const marks = [...root.querySelectorAll("svg polyline,svg circle,svg line")].filter(el => el.closest("svg")?.getClientRects().length)
      .map(el => {
        const style = getComputedStyle(el), color = style[el.tagName === "circle" ? "fill" : "stroke"], bg = background(el);
        return { shape: el.tagName, color, backgroundRgba: bg, opacity: style.opacity, ratio: ratio(rgba(color), bg) };
      });
    return {
      schema: "d08b.sign_contrast_samples.v1", text, marks,
      textBelow4_5: text.filter(item => item.ratio < 4.5), marksBelow3: marks.filter(item => item.ratio < 3),
      limitation: "Direct painted text and SVG mark styles against nearest opaque background. Gradients, alpha compositing and ancestor opacity are not certified. Zero-axis line is included and reported separately by shape.",
    };
  });
  expect(result.textBelow4_5).toEqual([]);
  expect(result.marksBelow3).toEqual([]);
  return result;
}

type KnownVariant = "robust" | "fragile" | "put-only";
async function assertCurve(card: Locator, variant: KnownVariant) {
  const measure = card.getByTestId("sign-sensitivity-measure");
  const svg = measure.locator("svg");
  await expect(svg).toBeVisible();
  await expect(svg.locator("polyline")).toHaveCount(1);
  await expect.poll(() => measure.evaluate(el => {
    const chart = el.querySelector("svg");
    return !!chart && el.clientWidth > 0 && Math.abs(el.getBoundingClientRect().width - chart.getBoundingClientRect().width) <= 1;
  })).toBe(true);
  const geometry = await svg.evaluate(el => ({
    width: Number(el.getAttribute("width")),
    height: Number(el.getAttribute("height")),
    viewBox: el.getAttribute("viewBox"),
    points: (el.querySelector("polyline")!.getAttribute("points") ?? "").trim().split(/\s+/).map(point => point.split(",").map(Number)),
    stroke: el.querySelector("polyline")!.getAttribute("stroke"),
    zeroY: Number(el.querySelector("line")!.getAttribute("y1")),
    markers: [...el.querySelectorAll("circle")].map(circle => ({
      x: Number(circle.getAttribute("cx")), y: Number(circle.getAttribute("cy")),
    })),
  }));
  expect(geometry.height).toBe(56);
  expect(geometry.viewBox).toBe("0 0 " + geometry.width + " 56");
  expect(geometry.points).toHaveLength(SIGN_WEIGHTS.length);
  expect(geometry.points.every(point => point.length === 2 && point.every(Number.isFinite))).toBe(true);
  expect(geometry.stroke).toBe(variant === "fragile" ? "var(--sign-warning, var(--warn))" : "var(--brand-2)");
  const model = SIGN_EXPECTED[variant], xs = geometry.points.map(p => p[0]), ys = geometry.points.map(p => p[1]);
  expect(geometry.zeroY).toBeCloseTo(variant === "robust" ? 22.5 : variant === "fragile" ? 8.2 : 6, 6);
  const expectedYs = variant === "put-only" ? [50, 50, 50, 50, 50] : [50, 39, 28, 17, 6];
  for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
  for (let i = 0; i < ys.length; i++) {
    expect(ys[i]).toBeCloseTo(expectedYs[i], 6);
    expect(ys[i]).toBeGreaterThanOrEqual(0); expect(ys[i]).toBeLessThanOrEqual(56);
    if (model.curveNetMn[i] < 0) expect(ys[i]).toBeGreaterThan(geometry.zeroY);
    else if (model.curveNetMn[i] > 0) expect(ys[i]).toBeLessThan(geometry.zeroY);
    else expect(Math.abs(ys[i] - geometry.zeroY)).toBeLessThan(0.01);
  }
  if (variant === "put-only") {
    expect(geometry.markers).toHaveLength(1);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.01);
  } else {
    expect(geometry.markers).toHaveLength(2);
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeLessThan(ys[i - 1]);
    const fraction = (model.criticalWeight! + 1) / 2;
    expect(Math.abs(geometry.markers[0].x - (xs[0] + fraction * (xs[4] - xs[0])))).toBeLessThan(0.01);
    expect(Math.abs(geometry.markers[0].y - geometry.zeroY)).toBeLessThan(0.01);
  }
  const current = geometry.markers[geometry.markers.length - 1];
  expect(Math.abs(current.x - xs[4])).toBeLessThan(0.01);
  expect(Math.abs(current.y - ys[4])).toBeLessThan(0.01);
  return geometry;
}

async function assertState(page: Page, lang: Lang, variant: SignFixtureVariant) {
  const copy = COPY[lang], expected = SIGN_EXPECTED[variant], card = cardFor(page, lang);
  const values = card.getByTestId("sign-sensitivity-values");
  await expect(values).toBeVisible({ timeout: 30_000 });
  await expect(values).toHaveAttribute("data-verdict", expected.verdict);
  await expect(card).toContainText(copy.convention + ": " + BASE.convention);
  await expect(page.locator('input[list="msc-roots"]')).toHaveValue("SPY");
  await expect(page.locator('input[list="msc-roots"]').locator("xpath=../..")).toContainText("2026-07-10");
  const measure = card.getByTestId("sign-sensitivity-measure");
  await expect(measure).toHaveCount(1);
  expect(await measure.evaluate(el => el.isConnected && el.clientWidth > 0)).toBe(true);
  const note = card.getByTestId("sign-sensitivity-note");
  await expect(note).toBeVisible();
  for (const label of [copy.tilt, copy.critical, copy.verdict]) await expect(values.getByText(label, { exact: true })).toBeVisible();
  await expect(card).not.toContainText(copy.oldUnknown);
  await expect(note).not.toContainText(copy.oldRobustNote);
  if (expected.verdict === "unknown") {
    await expect(statValue(card, copy.verdict)).toHaveText(copy.unknown);
    await expect(statValue(card, copy.tilt)).toHaveText("—");
    await expect(statValue(card, copy.critical)).toHaveText(copy.undetermined);
    await expect(note).toHaveText(copy.unknownNote);
    await expect(card).not.toContainText(copy.noFlip);
    await expect(measure.locator("svg")).toHaveCount(0);
    await expect(card.getByTestId("sign-sensitivity-axis")).toHaveCount(0);
    return { card, geometry: null };
  }
  const fragile = variant === "fragile";
  await expect(statValue(card, copy.verdict)).toHaveText(fragile ? copy.fragile : copy.robust);
  await expect(statValue(card, copy.tilt)).toHaveText(fragile ? "5.3%" : variant === "put-only" ? "−100.0%" : "60.0%");
  await expect(statValue(card, copy.critical)).toHaveText(fragile ? "0.90" : variant === "put-only" ? copy.noFlip : "0.25");
  await expect(note).toHaveText(fragile ? copy.fragileNote : copy.robustNote);
  if (!fragile) await expect(note).toContainText("12.0%");
  await expect(card).not.toContainText(copy.undetermined);
  await expect(card.getByTestId("sign-sensitivity-axis").locator(":scope > span")).toHaveText([...copy.axis]);
  return { card, geometry: await assertCurve(card, variant as KnownVariant) };
}

for (const lang of ["en", "zh"] as const) {
  test("Sign " + lang + ": unknown basis, tilt verdicts and valid put-only no crossing", async ({ page }, info) => {
    test.skip(BASELINE, "Final-state cases are excluded from original-source defect capture.");
    test.setTimeout(90_000); // Five genuine reloads plus bounded screenshot evidence.
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    let variant: SignFixtureVariant = "unknown-net-only";
    await wire(page, lang, () => signGexFixture(variant));
    const observations: unknown[] = [];
    for (const next of ["unknown-net-only", "unknown-zero-sides", "robust", "fragile", "put-only"] as const) {
      variant = next;
      const received = await load(page, variant, next === "unknown-net-only");
      const { card, geometry } = await assertState(page, lang, variant);
      await fit(card);
      observations.push({
        fixtureVariant: variant, sourceAsOf: received.asof, convention: received.convention,
        reportedGammaMn: SIGN_EXPECTED[variant].gammaMn, modelVerdict: SIGN_EXPECTED[variant].verdict,
        note: await card.getByTestId("sign-sensitivity-note").textContent(), geometry,
        ordinaryDarkContrast: await sampleContrast(card),
      });
      if (variant === "unknown-net-only" || variant === "robust" || variant === "fragile") {
        const points = geometry ? await card.getByTestId("sign-sensitivity-measure").locator("polyline").getAttribute("points") : null;
        for (const presentation of ["dark", "light-tokens"] as const) {
          await applyD08BPanelPresentation(card, presentation);
          await assertState(page, lang, variant); await fit(card);
          if (points !== null) await expect(card.getByTestId("sign-sensitivity-measure").locator("polyline")).toHaveAttribute("points", points);
          const name = "d08b-sign-" + info.project.name + "-" + lang + "-" + variant + "-" + presentation;
          writeFileSync("test-results/" + name + "-contrast.json", JSON.stringify(await sampleContrast(card), null, 2));
          await capture(page, card, name, {
            fixtureVariant: variant, language: lang, project: info.project.name,
            presentation: presentation === "light-tokens" ? "controlled panel light tokens; not production theme activation" : "ordinary dark",
          });
        }
      } else if (variant === "put-only") {
        await capture(page, card, "d08b-sign-" + info.project.name + "-" + lang + "-put-only", {
          fixtureVariant: variant, language: lang, project: info.project.name,
          criticalWeight: null, modelVerdict: "robust", constantNegativeCurve: true,
        });
      }
    }

    if (info.project.name === "mobile") {
      await page.setViewportSize({ width: 320, height: 844 });
      for (const next of ["unknown-net-only", "put-only"] as const) {
        variant = next; await load(page, variant);
        const { card } = await assertState(page, lang, variant);
        await fit(card);
        const name = "d08b-sign-mobile-320-" + lang + "-" + variant;
        writeFileSync("test-results/" + name + "-contrast.json", JSON.stringify(await sampleContrast(card), null, 2));
        await capture(page, card, name, {
          fixtureVariant: variant, language: lang, project: info.project.name, presentation: "ordinary dark",
        });
        await expect(card.getByTestId("sign-sensitivity-note")).toBeInViewport({ ratio: 1 });
        for (const label of [COPY[lang].tilt, COPY[lang].critical, COPY[lang].verdict]) {
          await expect(card.getByTestId("sign-sensitivity-values").getByText(label, { exact: true })).toBeInViewport({ ratio: 1 });
        }
        const footer = card.getByTestId("sign-sensitivity-note").locator("..");
        await expect(footer).toContainText(COPY[lang].convention + ": " + BASE.convention);
        await expect(footer).toBeInViewport({ ratio: 1 });
        if (variant === "unknown-net-only") {
          const source = page.locator('input[list="msc-roots"]').locator("xpath=../..");
          await expect(source).toContainText("2026-07-10");
          await fit(source);
          const clock = source.locator("span").filter({ hasText: "2026-07-10" }).first();
          await expect(clock).toBeVisible();
          await fit(clock);
          // The existing header has a wider layout wrapper. Capture the actual
          // source control while keeping the date text checked and visible.
          await capture(page, page.locator('input[list="msc-roots"]'), "d08b-sign-mobile-320-" + lang + "-source", {
            language: lang, sourceAsOf: BASE.asof, sourceRoot: "SPY", sourceClockUnchanged: true,
          });
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
    writeFileSync("test-results/d08b-sign-" + info.project.name + "-" + lang + "-states.json", JSON.stringify({
      schema: "d08b.sign_states.v1", language: lang, project: info.project.name,
      sourceModelUnit: "USD mn per +1% spot", observations,
      contrastScope: "Sampled direct text >=4.5:1 and marks including zero line >=3:1; no complete accessibility certification.",
    }, null, 2));
    expect(errors).toEqual([]);
  });
}

test("Sign: mounted unknown measurement, real root loss and reload recovery", async ({ page }, info) => {
  test.skip(BASELINE || info.project.name !== "desktop", "One bounded actual-parent lifecycle journey.");
  test.setTimeout(90_000);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  // Install before navigation so even an incidental prefetch cannot cache a
  // successful QQQ source and turn this loss case into an SWR fallback.
  await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === "gex:QQQ",
    route => route.fulfill({ status: 403, json: { error: "test source access unavailable" } }));
  let variant: SignFixtureVariant = "unknown-net-only";
  await wire(page, "en", () => signGexFixture(variant));
  await load(page, variant, true);
  const { card } = await assertState(page, "en", variant);
  const measure = card.getByTestId("sign-sensitivity-measure");
  const attached = await measure.elementHandle();
  if (!attached) throw new Error("Unknown measurement wrapper was not attached");
  const originalWidth = await attached.evaluate(el => el.clientWidth);
  await page.setViewportSize({ width: 360, height: 844 });
  await expect.poll(() => attached.evaluate((el, oldWidth) =>
    el.isConnected && el === document.querySelector('[data-testid="sign-sensitivity-measure"]')
      && el.clientWidth > 0 && Math.abs(el.clientWidth - oldWidth) > 1, originalWidth),
  ).toBe(true);
  await assertState(page, "en", variant); await fit(card);
  await capture(page, card, "d08b-sign-unknown-resized-attached", {
    fixtureVariant: variant, presentation: "ordinary dark",
    lifecycle: "same unknown measurement element survives an actual viewport resize",
  });
  await attached.dispose();

  // The existing Positioning parent cannot replace its current source in place.
  // Reload is a real source read, not a made-up Retry or a same-element transition.
  variant = "robust"; await load(page, variant);
  await assertState(page, "en", variant); await fit(card);
  await capture(page, card, "d08b-sign-known-after-reload", {
    fixtureVariant: variant, lifecycle: "new source read after full page reload",
  });
  const input = page.locator('input[list="msc-roots"]');
  await input.fill("QQQ");
  const [failure] = await Promise.all([
    page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === "/api/flow" && url.searchParams.get("f") === "gex:QQQ";
    }),
    input.press("Enter"),
  ]);
  expect(failure.status()).toBe(403);
  await expect(page.getByTestId("sign-sensitivity-values")).toHaveCount(0);
  await expect(page.getByTestId("sign-sensitivity-measure")).toHaveCount(0);
  await expect(page.getByTestId("sign-sensitivity-note")).toHaveCount(0);
  await expect(page.locator("#msc-panel-body")).toHaveCount(0);
  await expect(page.getByText(COPY.en.loadError, { exact: true })).toBeVisible({ timeout: 30_000 });
  await capture(page, input, "d08b-sign-root-source-loss", {
    failedRoot: "QQQ", httpStatus: 403, priorCardWithdrawn: true,
  });

  variant = "unknown-net-only";
  await load(page, variant);
  await assertState(page, "en", variant); await fit(card);
  await expect(input).toHaveValue("SPY");
  await capture(page, card, "d08b-sign-source-recovered-unknown", {
    fixtureVariant: variant, recoveredRoot: "SPY", lifecycle: "full reload recovery; no in-place Retry claim",
  });
  expect(errors).toEqual([]);
});
