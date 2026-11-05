import { expect, test, type Locator, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { exposureMapT } from "../components/exposure-map/exposureMapStrings";
import { reportedGammaBook } from "../lib/__tests__/fixtures/reportedGammaBooks";
import { prepareSectorJourney } from "./helpers/optionsR1Journey";
import { applyD08BPanelPresentation } from "./d08bPanelPresentation";


/**
 * Browser-only synthetic sources, derived from the existing observed-v2 fixture
 * family at Terminal 8d47a4557762e5d1d7e07617255b105cbc8a51a5.
 *
 * Intended import location is terminal/e2e/<spec>.ts. If moved to e2e/fixtures,
 * adjust the reportedGammaBooks import one directory upward.
 * This preserves the actual wire/admission path; no ready-made comparison model
 * is injected. Receipt fields remain synthetic fixture declarations, not provider
 * capture/authentication evidence. The legacy net_gex_bn=9.9 is an existing
 * decoy; the comparison must be derived from the exposure projection.
 */
export const CHANGE_CURRENT_SESSION = "2026-10-19" as const;
export const CHANGE_PREVIOUS_SESSION = "2026-10-16" as const;
export const CHANGE_UNIT_USD = 1 / 4096; // exactly 0.000244140625 in IEEE-754
export const CHANGE_SCALE = CHANGE_UNIT_USD / 10000;
export const CHANGE_ORIGIN_MS = Date.parse("2026-10-20T12:00:00Z");

type GammaBook = ReturnType<typeof reportedGammaBook>;
type GammaSummary = {
  received: number;
  qualified: number;
  missing: number;
  status: string;
  net: number | null;
  gross: number | null;
  known_net: number | null;
  known_gross: number | null;
  call: number | null;
  put: number | null;
  qualified_population_id: string;
  exclusions: Record<string, number>;
};
type MutableProjection = GammaBook["exposure_projection"] & {
  population: { id: string };
  population_ids: string[];
  metrics: { gamma: GammaSummary };
};

function missingCall(book: GammaBook, strike: number) {
  const p = book.exposure_projection as MutableProjection;
  const cell = p.cells.find(row => row[1] === strike);
  if (!cell) throw new Error("Expected source cell " + strike);
  const gamma = cell[3][0];
  const call = gamma[10], put = gamma[11];
  if (typeof call !== "number" || typeof put !== "number" || gamma[2] !== 2 || gamma[3] !== 0) {
    throw new Error("Fixture qualification edit requires two finite source sides");
  }
  const expiry = p.expiry_terms[cell[0]][0];
  p.contract_identity.contract_keys = p.contract_identity.contract_keys.filter(
    key => !(key[0] === expiry && key[1] === String(strike) && key[2] === "C"),
  );
  // The call remains in observed_contract_keys. Null is a missing qualification,
  // not a membership removal and not a reported zero.
  gamma[2] = 1; gamma[3] = 1; gamma[4] = 1; // partial
  gamma[5] = null; gamma[6] = null;
  gamma[7] = put; gamma[8] = Math.abs(put);
  gamma[10] = null;
  gamma[12] = { contract_identity_scope_unknown: 1 };
  const summary = p.metrics.gamma;
  summary.qualified -= 1; summary.missing += 1;
  summary.net = null; summary.gross = null; summary.status = "partial";
  summary.known_net = summary.known_net! - call;
  summary.known_gross = summary.known_gross! - Math.abs(call);
  summary.call = null;
  summary.exclusions.contract_identity_scope_unknown =
    (summary.exclusions.contract_identity_scope_unknown ?? 0) + 1;
}

function fixtureDigest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/**
 * Keep the declared population lookup IDs aligned with these synthetic member
 * sets after a membership/qualification edit. These are fixture IDs only; this
 * does not seal or authenticate a native provider receipt.
 */
function refreshPopulationIds(book: GammaBook) {
  const p = book.exposure_projection as MutableProjection;
  const observed = p.contract_identity.observed_contract_keys;
  const allQualified: string[][] = [];
  p.population.id = fixtureDigest(observed);
  for (const cell of p.cells) {
    const expiry = p.expiry_terms[cell[0]][0];
    const members = observed.filter(key => key[0] === expiry && key[1] === String(cell[1]));
    const gamma = cell[3][0];
    const qualified = members.filter(key => gamma[key[2] === "C" ? 10 : 11] !== null);
    allQualified.push(...qualified);
    cell[2] = p.population_ids.push(fixtureDigest(members)) - 1;
    gamma[9] = p.population_ids.push(fixtureDigest(qualified)) - 1;
  }
  p.metrics.gamma.qualified_population_id = fixtureDigest(allQualified);
}

export type ChangeFixtureVariant = "precision" | "population";

/** All-expiry lens required for the population variant's common cohort. */
export function changeSourcePair(variant: ChangeFixtureVariant = "precision") {
  const current = reportedGammaBook(CHANGE_CURRENT_SESSION, CHANGE_SCALE);
  const previous = reportedGammaBook(CHANGE_PREVIOUS_SESSION, CHANGE_SCALE * 2);
  if (variant === "population") {
    // Same transformation as the incumbent reportedGammaPriorWithoutOctober23.
    // The 40 prior October-22 members and 40 current October-23 members are
    // separate exact identities. Neither side substitutes a neighboring expiry.
    const p = previous.exposure_projection;
    const old = p.expiry_terms[0][0];
    p.expiry_terms[0][0] = "2026-10-22";
    for (const keys of [p.contract_identity.contract_keys, p.contract_identity.observed_contract_keys]) {
      for (const key of keys) if (key[0] === old) key[0] = "2026-10-22";
    }
    missingCall(current, 101);  // finite prior -> null current: qualification lost
    missingCall(previous, 104); // null prior -> finite current: qualification gained
    refreshPopulationIds(current);
    refreshPopulationIds(previous);
  }
  return { current, previous };
}

/**
 * Fulfill these keys through the real /api/flow?f=... requests. Register these
 * narrow overrides after the ordinary Options source/auth fixture. Leave other
 * feeds with their incumbent fixture handler; do not fabricate empty successes.
 */
export function changeFlowPayloads(variant: ChangeFixtureVariant = "precision") {
  const pair = changeSourcePair(variant);
  return {
    "gex:SPY": pair.current,
    "gex_at:SPY:2026-10-19": pair.current,
    "gex_at:SPY:2026-10-16": pair.previous,
    "gex_dates:SPY": {
      root: "SPY",
      dates: [CHANGE_CURRENT_SESSION, CHANGE_PREVIOUS_SESSION],
      latest: CHANGE_CURRENT_SESSION,
    },
  };
}

/**
 * Expected values are constants for comparison/assertions, never source payload.
 * u is small enough for the incumbent compact formatter to print a signed $0,
 * while the exact view must retain the finite decimal. Direction stays "flat":
 * the incumbent display tolerance is |signed change| < $0.5.
 *
 * "more" is the incumbent count beyond the top eight, including an appended
 * selected row. It therefore remains 52/32 when the ninth focus row is appended;
 * this fixture does not redefine the view model's counting semantics.
 */
export const CHANGE_EXPECTED = {
  precision: {
    previousObserved: 120, currentObserved: 120,
    previousQualified: 119, currentQualified: 119,
    matchedQualified: 119,
    previousOnlyReported: 0, currentOnlyReported: 0,
    qualificationLost: 0, qualificationGained: 0, unavailableEither: 1,
    aggregate: {
      contracts: 119,
      previousNetUsd: 0.00048828125,
      currentNetUsd: 0.000244140625,
      signedChangeUsd: -0.000244140625,
      netMagnitudeChangeUsd: -0.000244140625,
      previousGrossUsd: 0.05810546875,
      currentGrossUsd: 0.029052734375,
      grossChangeUsd: -0.029052734375,
    },
    totalStrikes: 60,
    topStrikes: [159, 100, 101, 102, 103, 104, 105, 106],
    focusStrike: 107,
    focusedRows: [159, 100, 101, 102, 103, 104, 105, 106, 107],
    more: 52,
    zeroRow: {
      strike: 107, contracts: 2, previousNetUsd: 0, currentNetUsd: 0,
      signedChangeUsd: 0, netMagnitudeChangeUsd: 0,
      grossChangeUsd: -0.00048828125,
    },
  },
  population: {
    previousObserved: 120, currentObserved: 120,
    previousQualified: 118, currentQualified: 118,
    matchedQualified: 77,
    previousOnlyReported: 40, currentOnlyReported: 40,
    qualificationLost: 1, qualificationGained: 1, unavailableEither: 3,
    aggregate: {
      contracts: 77,
      previousNetUsd: -0.00048828125,
      currentNetUsd: -0.000244140625,
      signedChangeUsd: 0.000244140625,
      netMagnitudeChangeUsd: -0.000244140625,
      previousGrossUsd: 0.03759765625,
      currentGrossUsd: 0.018798828125,
      grossChangeUsd: -0.018798828125,
    },
    totalStrikes: 40,
    topStrikes: [101, 104, 159, 102, 105, 107, 108, 110],
    focusStrike: 111,
    focusedRows: [101, 104, 159, 102, 105, 107, 108, 110, 111],
    more: 32,
    zeroRow: {
      strike: 111, contracts: 2, previousNetUsd: 0, currentNetUsd: 0,
      signedChangeUsd: 0, netMagnitudeChangeUsd: 0,
      grossChangeUsd: -0.00048828125,
    },
    unmatchedFocusStrike: 100,
  },
} as const;


type Book = ReturnType<typeof reportedGammaBook>;
async function enter(page: Page, lang: "en" | "zh", books?: { current: () => Book; previous: () => Book; status?: () => number }) {
  await page.clock.install({ time: new Date(CHANGE_ORIGIN_MS) });
  await prepareSectorJourney(page, { lang, spots: { SPY: 100 } });
  await page.route(url => url.pathname === "/api/flow/stream", route => route.abort("failed"));
  await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === "gex:SPY",
    route => books?.status?.() === 403 ? route.fulfill({ status: 403, json: { error: "controlled access loss" } })
      : route.fulfill({ json: books?.current() ?? reportedGammaBook("2026-10-19") }));
  await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === "gex_dates:SPY",
    route => route.fulfill({ json: { root: "SPY", dates: ["2026-10-19", "2026-10-16"], latest: "2026-10-19" } }));
  await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === "gex_at:SPY:2026-10-16",
    route => route.fulfill({ json: books?.previous() ?? reportedGammaBook("2026-10-16", 2) }));
  await page.goto("/options?tab=prism&symbol=SPY&view=chart");
  const map = page.getByTestId("exposure-map");
  await expect(map).toHaveAttribute("data-chart-ready", "true", { timeout: 30_000 });
  await map.getByRole("button", { name: exposureMapT(lang)("changes"), exact: true }).click();
  const panel = map.getByTestId("exposure-change-inspector");
  await expect(panel).toBeVisible({ timeout: 30_000 });
  return panel;
}

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

test("baseline: existing change inspector phone presentation", async ({ page }, info) => {
  test.skip(process.env.D08B_CHANGE_BEFORE !== "1" || info.project.name !== "desktop", "Explicit before-change evidence only.");
  await page.setViewportSize({ width: 320, height: 844 });
  const panel = await enter(page, "zh");
  const table = panel.locator("table");
  await capture(page, table.locator("tbody tr").first().getByRole("button"), "d08b-change-before-320-zh");
  const bounds = await panel.evaluate(root => {
    const rect = (e: Element) => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width, height: r.height }; };
    return { viewport: innerWidth, panel: rect(root), table: rect(root.querySelector("table")!),
      buttons: [...root.querySelectorAll("button")].map(el => ({ text: el.textContent, ...rect(el) })),
      headers: [...root.querySelectorAll("th")].map(el => ({ text: el.textContent, ...rect(el) })) };
  });
  writeFileSync("test-results/d08b-change-before-320-zh-bounds.json", JSON.stringify(bounds, null, 2));
});


async function fit(panel: Locator) {
  const bad = await panel.evaluate(root => {
    const box = root.getBoundingClientRect(); let left = Math.max(0, box.left), right = Math.min(innerWidth, box.right);
    for (let parent = root.parentElement; parent; parent = parent.parentElement) {
      if (!/hidden|clip|auto|scroll/.test(getComputedStyle(parent).overflowX)) continue;
      const r = parent.getBoundingClientRect(); left = Math.max(left, r.left); right = Math.min(right, r.right);
    }
    const failures: string[] = [];
    for (const el of root.querySelectorAll("button,summary,table,th,td,p,dt,dd,h3,h4,span,strong")) {
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
    const texts = [...root.querySelectorAll("button,summary,p,th,td,dt,dd,h3,h4,span,strong")].filter(el => {
      const disclosure = el.closest("details:not([open])");
      return el.getClientRects().length && (!disclosure || disclosure.querySelector("summary")?.contains(el));
    });
    const text = texts.map(el => ({ text: el.textContent?.slice(0, 70), ratio: ratio(rgba(getComputedStyle(el)[el instanceof SVGElement ? "fill" : "color"]), background(el)) }));
    const marks = [...root.querySelectorAll("svg path,svg line[stroke-dasharray]")].filter(el => el.getClientRects().length).map(el => ({
      shape: el.tagName, ratio: ratio(rgba(getComputedStyle(el).stroke), background(el)),
    }));
    return { text, marks };
  });
}

function visibleRow(panel: Locator, strike: number) {
  return panel.locator('[data-strike="' + strike + '"]:visible');
}
function valueControls(panel: Locator, lang: "en" | "zh") {
  const group = panel.getByTestId("change-values-controls");
  return {
    compact: group.getByRole("button", { name: lang === "en" ? "Compact" : "紧凑", exact: true }),
    exact: group.getByRole("button", { name: lang === "en" ? "Exact USD" : "精确美元", exact: true }),
  };
}
async function exactRow(row: Locator, values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) {
    const cell = row.locator('[data-field="' + key + '"]');
    await expect(cell).toHaveText(value);
    // The precision fixture must retain its sign and full amount on one line.
    expect(await cell.evaluate(el => {
      const range = document.createRange(); range.selectNodeContents(el);
      return new Set([...range.getClientRects()].filter(r => r.width > 0).map(r => Math.round(r.top))).size;
    })).toBe(1);
  }
}
async function populationCounts(panel: Locator, counts: Record<string, number>) {
  const disclosure = panel.locator("details");
  if (!await disclosure.getAttribute("open").then(value => value !== null)) {
    await disclosure.locator("summary").focus();
    await panel.page().keyboard.press("Enter");
  }
  await expect(disclosure).toHaveAttribute("open", "");
  for (const [key, value] of Object.entries(counts)) await expect(panel.locator('[data-population="' + key + '"] strong')).toHaveText(String(value));
}
async function controlsFit(panel: Locator) {
  const small = await panel.locator("button:visible,summary:visible").evaluateAll(elements => elements.filter(el => {
    const r = el.getBoundingClientRect();
    const minimum = el.hasAttribute("data-strike-choice") ? 48 : 44;
    return r.width < minimum || r.height < minimum;
  }).map(el => {
    const r = el.getBoundingClientRect(), style = getComputedStyle(el);
    return { text: el.textContent, width: r.width, height: r.height, minWidth: style.minWidth, minHeight: style.minHeight };
  }));
  expect(small).toEqual([]);
}

for (const lang of ["en", "zh"] as const) {
  test("Change " + lang + ": exact cohort values, source populations and keyboard presentation", async ({ page }, info) => {
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    const pair = changeSourcePair();
    const panel = await enter(page, lang, { current: () => pair.current, previous: () => pair.previous });
    const controls = valueControls(panel, lang);
    const initialSelection = await panel.locator("button[data-strike-choice][aria-pressed=true]:visible").evaluateAll(elements => elements.map(el => el.getAttribute("data-strike-choice")));
    for (const theme of ["dark", "light-tokens"] as const) {
      await applyD08BPanelPresentation(panel, theme);
      await controls.compact.focus(); await page.keyboard.press("Enter");
      await expect(controls.compact).toBeFocused();
      await expect(visibleRow(panel, 159).locator('[data-field="signedChangeUsd"]')).toHaveText("−$0");
      await fit(panel);
      await controls.exact.focus(); await page.keyboard.press("Enter");
      await expect(controls.exact).toBeFocused();
      await expect(controls.exact).toHaveAttribute("aria-pressed", "true");
      await expect(panel).toContainText("2026-10-16 → 2026-10-19");
      expect(await panel.locator("[data-strike]:visible").evaluateAll(elements => elements.map(el => Number(el.getAttribute("data-strike"))))).toEqual([...CHANGE_EXPECTED.precision.topStrikes]);
      await exactRow(visibleRow(panel, 159), {
        previousNetUsd: "$0.00048828125", currentNetUsd: "$0.000244140625",
        signedChangeUsd: "−$0.000244140625", netMagnitudeChangeUsd: "−$0.000244140625", grossChangeUsd: "−$0.000244140625",
      });
      await exactRow(visibleRow(panel, 100), {
        previousNetUsd: "$0", currentNetUsd: "$0", signedChangeUsd: "$0", netMagnitudeChangeUsd: "$0", grossChangeUsd: "−$0.00048828125",
      });
      for (const [key, value] of Object.entries({
        previousNetUsd: "$0.00048828125", currentNetUsd: "$0.000244140625",
        signedChangeUsd: "−$0.000244140625", netMagnitudeChangeUsd: "−$0.000244140625", grossChangeUsd: "−$0.029052734375",
      })) await expect(panel.getByTestId("change-aggregate-" + key)).toHaveText(value);
      expect(await panel.locator("button[data-strike-choice][aria-pressed=true]:visible").evaluateAll(elements => elements.map(el => el.getAttribute("data-strike-choice")))).toEqual(initialSelection);
      await populationCounts(panel, { matched: 119, previousOnly: 0, currentOnly: 0, qualificationLost: 0, qualificationGained: 0, previousObserved: 120, currentObserved: 120, unavailableEither: 1 });
      await fit(panel); await controlsFit(panel);
      const measured = await measureContrast(panel);
      writeFileSync("test-results/d08b-change-" + info.project.name + "-" + lang + "-" + theme + "-contrast.json", JSON.stringify(measured, null, 2));
      expect(measured.text.filter(item => item.ratio < 4.5)).toEqual([]);
      await capture(page, controls.exact, "d08b-change-" + info.project.name + "-" + lang + "-" + theme + "-controls");
      await capture(page, panel.locator('[data-population="unavailableEither"]'), "d08b-change-" + info.project.name + "-" + lang + "-" + theme + "-population");
      await capture(page, visibleRow(panel, 159).locator('[data-field="currentNetUsd"]'), "d08b-change-" + info.project.name + "-" + lang + "-" + theme + "-exact");
      await capture(page, visibleRow(panel, 106).getByRole("button"), "d08b-change-" + info.project.name + "-" + lang + "-" + theme + "-last");
    }
    await controls.compact.focus(); await page.keyboard.press("Enter");
    await expect(visibleRow(panel, 159).locator('[data-field="signedChangeUsd"]')).toHaveText("−$0");
    await expect(panel.getByTestId("change-outside-rank")).toContainText("52");
    expect(errors).toEqual([]);
  });
}

test("Change: preserved selected strike, unmatched focus and access loss on the actual route", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "One parent-selection and source-loss journey; every layout is covered above.");
  const pair = changeSourcePair("population");
  let status = 200;
  const panel = await enter(page, "en", { current: () => pair.current, previous: () => pair.previous, status: () => status });
  const map = page.getByTestId("exposure-map");
  const controls = valueControls(panel, "en");
  await controls.exact.click();
  await populationCounts(panel, { matched: 77, previousOnly: 40, currentOnly: 40, qualificationLost: 1, qualificationGained: 1, previousObserved: 120, currentObserved: 120, unavailableEither: 3 });
  await expect(panel.getByTestId("change-aggregate-previousNetUsd")).toHaveText("−$0.00048828125");
  await expect(panel.getByTestId("change-aggregate-currentNetUsd")).toHaveText("−$0.000244140625");
  await expect(panel.getByTestId("change-aggregate-signedChangeUsd")).toHaveText("+$0.000244140625");
  await expect(panel.getByTestId("change-aggregate-netMagnitudeChangeUsd")).toHaveText("−$0.000244140625");
  await expect(panel.getByTestId("change-aggregate-grossChangeUsd")).toHaveText("−$0.018798828125");
  await exactRow(visibleRow(panel, 101), { previousNetUsd: "−$0.00048828125", currentNetUsd: "−$0.000244140625", signedChangeUsd: "+$0.000244140625", netMagnitudeChangeUsd: "−$0.000244140625", grossChangeUsd: "−$0.000244140625" });
  await capture(page, visibleRow(panel, 101).getByRole("button"), "d08b-change-distinct-signs");

  // Invoke the actual parent callback from this inspector.
  await visibleRow(panel, 104).getByRole("button").focus(); await page.keyboard.press("Enter");
  await expect(visibleRow(panel, 104).getByRole("button")).toHaveAttribute("aria-pressed", "true");
  await expect(map.getByTestId("exposure-node-inspector")).toBeVisible();
  await controls.compact.click(); await controls.exact.click();
  await expect(visibleRow(panel, 104).getByRole("button")).toHaveAttribute("aria-pressed", "true");

  // Select outside the ranked set using the incumbent full strike table.
  await map.getByRole("button", { name: "Exact values", exact: true }).click();
  await map.getByRole("button", { name: "111", exact: true }).click();
  await map.getByRole("button", { name: "Changes", exact: true }).click();
  await expect(panel).toBeVisible();
  await valueControls(panel, "en").exact.click();
  expect(await panel.locator("[data-strike]:visible").evaluateAll(elements => elements.map(el => Number(el.getAttribute("data-strike"))))).toEqual([...CHANGE_EXPECTED.population.focusedRows]);
  await expect(visibleRow(panel, 111).getByRole("button")).toHaveAttribute("aria-pressed", "true");
  await expect(panel.getByTestId("change-outside-rank")).toHaveText("32 strikes outside the ranked set");
  await capture(page, visibleRow(panel, 111).getByRole("button"), "d08b-change-appended-selected");

  await map.getByRole("button", { name: "Exact values", exact: true }).click();
  await map.getByRole("button", { name: "100", exact: true }).click();
  await map.getByRole("button", { name: "Changes", exact: true }).click();
  await expect(panel.getByTestId("change-focus-unavailable")).toHaveText("Selected strike 100 is outside this matched comparison.");
  await expect(panel.locator("button[data-strike-choice][aria-pressed=true]:visible")).toHaveCount(0);
  await capture(page, panel.getByTestId("change-focus-unavailable"), "d08b-change-unmatched-focus");

  status = 403; await page.clock.fastForward(30_001);
  await expect(panel).toHaveCount(0, { timeout: 20_000 });
  await expect(map).not.toContainText("0.000244140625");
  await expect(map.getByRole("button", { name: "Retry source read" })).toBeVisible();
  await capture(page, map.getByRole("button", { name: "Retry source read" }), "d08b-change-access-withdrawn");
});

test("Change: 320px, magnification, narrow pane and focus continuity", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Extra widths are exercised once.");
  const pair = changeSourcePair();
  await page.emulateMedia({ reducedMotion: "reduce" });
  const panel = await enter(page, "zh", { current: () => pair.current, previous: () => pair.previous });
  const controls = valueControls(panel, "zh");
  await controls.exact.click();
  const focused = visibleRow(panel, 159).getByRole("button");
  await focused.focus();
  // A real responsive resize must not leave keyboard focus in the hidden table.
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(visibleRow(panel, 159).getByRole("button")).toBeFocused();
  await expect(panel.getByTestId("change-values-table")).not.toBeVisible();
  await expect(panel.getByTestId("change-values-cards")).toBeVisible();
  await fit(panel); await controlsFit(panel);
  await capture(page, controls.exact, "d08b-change-320-zh-controls");
  await capture(page, visibleRow(panel, 159).locator('[data-field="currentNetUsd"]'), "d08b-change-320-zh-exact");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  await fit(panel); await controlsFit(panel);
  await capture(page, controls.exact, "d08b-change-css-200percent-controls");
  await capture(page, visibleRow(panel, 159).locator('[data-field="currentNetUsd"]'), "d08b-change-css-200percent-exact");

  await page.evaluate(() => { document.documentElement.style.zoom = "1"; });
  await panel.evaluate(el => { (el as HTMLElement).style.width = "230px"; });
  await applyD08BPanelPresentation(panel, "light-tokens");
  await fit(panel); await controlsFit(panel);
  await capture(page, controls.exact, "d08b-change-230-light-tokens-controls");
  await capture(page, visibleRow(panel, 159).locator('[data-field="currentNetUsd"]'), "d08b-change-230-light-tokens-exact");
  await populationCounts(panel, { matched: 119, previousObserved: 120, currentObserved: 120, unavailableEither: 1 });
  await fit(panel);
  await capture(page, panel.locator('[data-population="unavailableEither"]'), "d08b-change-230-light-tokens-population");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
