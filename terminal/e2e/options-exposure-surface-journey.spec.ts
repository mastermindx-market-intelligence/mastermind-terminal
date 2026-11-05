import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { parseExposureChartRequest } from "../lib/exposureChartLink";
import { usRegularSessionWindow } from "../lib/usEquitySessionClock";
import producer from "../lib/__tests__/fixtures/exposure-projection.json";
import { exposureMapT } from "../components/exposure-map/exposureMapStrings";
import { exposureSurfaceT } from "../components/exposure-map/exposureSurfaceStrings";

// SYNTHETIC LOCAL — one coherent end-to-end Exposure Surface journey per project × language.
//
// Every market input below is synthetic loopback fixture data served through this file's own
// page.route handlers under the existing Playwright dev config; nothing touches provider,
// account, production or stored data, and the shared default fixtures stay untouched (they are
// deliberately incoherent for this journey, which is exactly why this spec serves its own book).
// The /api/flow handler returns byte-identical payloads on every read: the main-chart navigation
// re-resolves the request through the incumbent source cache and recomputes the exact value
// digest, so any byte drift between legs would honestly fail the reference as "changed".
//
// Fixture clocks freeze the browser at 2026-10-19T20:30:00Z via page.clock.install({ time })
// (never pauseAt — the charts need RAF). The projection's source session is 2026-10-19, observed
// 20:00Z, available 20:01Z, so every qualified projection clock gate passes against frozen now.

const SESSION = "2026-10-19";
const SPOT = 100;
const EXPIRIES = ["2026-10-23", "2026-10-30"] as const;
const STRIKES = [98, 103];
const SELECTED_STRIKE = 103;
const SELECTED_EXPIRY = "2026-10-30";
const OBSERVED_AT = `${SESSION}T20:00:00Z`;
const AVAILABLE_AT = `${SESSION}T20:01:00Z`;
const FIXED_NOW = `${SESSION}T20:30:00Z`;
const SOURCE_REF = "synthetic:options-exposure-surface-journey/v1";

// Gamma in usd_delta_per_1pct_spot per synthetic cell. Strike 103 nets +100M on Oct23 and
// +200M on Oct30 so the all-expiry strike net is +300M — a scoped Oct30 selection must show
// +200M/gross 400M and never the +300M aggregate. Strike 98 nets negative with declared gross.
const CELL_GAMMA: Record<string, Record<string, { net: number; gross: number }>> = {
  "98": { "2026-10-23": { net: -30e6, gross: 45e6 }, "2026-10-30": { net: -60e6, gross: 90e6 } },
  "103": { "2026-10-23": { net: 100e6, gross: 150e6 }, "2026-10-30": { net: 200e6, gross: 400e6 } },
};

type MetricDoc = Record<string, unknown>;
interface ProjectionDoc {
  schema: string;
  kind: string;
  root: string;
  source_snapshot_ref: string;
  input_sha256: string;
  security_id: string;
  position_basis: string;
  scale: string;
  rights_decision_ref: null;
  greek_provenance: Record<string, { source_ref: string; model_ref: string }>;
  clocks: Record<string, string | null>;
  population: Record<string, unknown>;
  metrics: Record<string, MetricDoc>;
  cell_count: number;
  cells_status: string;
  cells: { expiry: string; strike: number; economic_expiry_at: string; population_id: string;
    gamma: MetricDoc; vanna: MetricDoc; charm: MetricDoc; joint: MetricDoc }[];
}
interface GexEnvelope {
  schema: string; root: string; asof: string; spot_ref: number; convention: string;
  by_strike_full_n: number; by_strike: unknown[]; by_expiry: { exp: string }[];
  exposure_projection: ProjectionDoc;
}

// Built from the existing qualified producer fixture recipe (same adaptation pattern as the
// surface selection unit tests): clone the template cell per strike × expiry, retarget the
// clocks to this synthetic session, and point every provenance source_ref at THIS capture —
// the strict v1 consumer refuses values whose provenance cites a different source snapshot.
function buildProjection(): ProjectionDoc {
  const doc = JSON.parse(JSON.stringify(producer)) as ProjectionDoc;
  const proto = doc.cells[0];
  if (!proto) throw new Error("producer fixture lost its template cell");
  doc.source_snapshot_ref = SOURCE_REF;
  // This digest identifies the declared synthetic input table, never a vendor store.
  doc.input_sha256 = createHash("sha256").update(JSON.stringify({ root: "SPY", session: SESSION, spot: SPOT, cells: CELL_GAMMA })).digest("hex");
  for (const key of ["gamma", "vanna", "charm"]) {
    const provenance = doc.greek_provenance[key];
    if (provenance) provenance.source_ref = SOURCE_REF;
  }
  doc.clocks = {
    ...doc.clocks,
    source_session: SESSION, oi_report_date: SESSION, oi_position_session: null,
    oi_available_at: `${SESSION}T12:00:00Z`, option_observed_at: OBSERVED_AT,
    underlying_observed_at: OBSERVED_AT, greeks_available_at: AVAILABLE_AT, available_at: AVAILABLE_AT,
    published_at: null, correction_ref: null,
  };
  doc.cells = EXPIRIES.flatMap((expiry) => STRIKES.map((strike) => {
    const gamma = CELL_GAMMA[String(strike)]?.[expiry];
    if (!gamma) throw new Error(`synthetic cell table lost ${strike} × ${expiry}`);
    return {
      ...JSON.parse(JSON.stringify(proto)),
      expiry, strike, economic_expiry_at: `${expiry}T20:00:00Z`,
      gamma: { ...proto.gamma, net: gamma.net, gross: gamma.gross, known_net: gamma.net, known_gross: gamma.gross,
        call: (gamma.gross + gamma.net) / 2, put: (gamma.net - gamma.gross) / 2 },
    };
  }));
  doc.cell_count = doc.cells.length;
  doc.cells_status = "complete";
  // Book aggregates recompute from the cells above so no declared total contradicts them.
  const aggregate = (metric: "gamma" | "vanna" | "charm"): MetricDoc => {
    const rows = doc.cells.map((cell) => cell[metric]);
    const sum = (key: string) => rows.reduce((total, row) => total + (typeof row[key] === "number" ? row[key] as number : 0), 0);
    return {
      ...rows[0],
      received: rows.length * 2, qualified: rows.length * 2, missing: 0, expected: null,
      status: "complete_observed",
      net: sum("net"), gross: sum("gross"), known_net: sum("known_net"), known_gross: sum("known_gross"),
      call: sum("call"), put: sum("put"),
    };
  };
  doc.metrics = { gamma: aggregate("gamma"), vanna: aggregate("vanna"), charm: aggregate("charm") };
  doc.population = {
    ...doc.population,
    received_contracts: doc.cells.length * 2, received_rows: doc.cells.length * 2,
    oi_received_contracts: doc.cells.length * 2, observed_contracts: doc.cells.length * 2,
  };
  return doc;
}

const projection = buildProjection();

const envelope: GexEnvelope = {
  schema: "options_hub.gex/v1", root: "SPY", asof: `${SESSION}T20:15:00Z`, spot_ref: SPOT,
  convention: "+call/-put assumed dealer inventory", by_strike_full_n: STRIKES.length,
  by_strike: [], by_expiry: EXPIRIES.map((exp) => ({ exp })), exposure_projection: projection,
};

// Whole-dollar net gamma per matrix cell mirrors the projection cells.
const matrixFixture = {
  schema: "options_structure.matrix/v1", root: "SPY", asof: `${SESSION}T20:16:00Z`,
  _build_meta: { asof_date: SESSION },
  strikes: STRIKES, expiries: [...EXPIRIES],
  cells: EXPIRIES.flatMap((expiry) => STRIKES.map((strike) => ({
    strike, expiry, gex: CELL_GAMMA[String(strike)]![expiry]!.net,
  }))),
};

const datesFixture = { schema: "options_hub.gex_dates/v1", root: "SPY", dates: [SESSION], latest: SESSION };
const stateFixture = {
  schema: "options_structure.gex_state/v1", root: "SPY", asof: SESSION, spot: SPOT,
  gamma_regime: "RANGE", stability_pct: 68, net_gex_bn: (projection.metrics.gamma.net as number) / 1e9,
  call_wall: 104, put_wall: 97, gamma_flip: 99, magnet: 103,
};
const movesFixture = {
  schema: "options_hub.moves/v1", root: "SPY", asof: SESSION, spot_ref: SPOT,
  expected_move: { pct: 1.96, band_mult: 1.96, horizon_days: 1 },
};

// Intraday 5m bars follow the existing fixture convention: display epochs from
// SESSION T09:30:00Z, closed bars through 15:55 display, latest close exactly SPOT.
function buildIntraday(tf: string) {
  const interval = tf === "30m" ? 1800 : tf === "2h" ? 7200 : 300;
  const count = Math.ceil(23_400 / interval);
  const start = Date.parse(`${SESSION}T09:30:00Z`) / 1000;
  const closes = Array.from({ length: count }, (_, i) =>
    i === count - 1 ? SPOT : SPOT - (count - 1 - i) * (interval / 300) * 0.02 + Math.sin(i * 0.7) * 0.1);
  const bars = closes.map((close, i) => {
    const open = i === 0 ? close - 0.04 : closes[i - 1]!;
    return [start + i * interval, open, Math.max(open, close) + 0.12, Math.min(open, close) - 0.12, close, 600_000 + i * 1100];
  });
  return { t: "SPY", tf, bars, source: "fixture",
    source_evidence: { assembly_clock: { assembled_at: FIXED_NOW, cache_state: "fresh" } } };
}

// Daily owner file: complete date-keyed sessions ending on SESSION at close SPOT, with the
// preceding history wandering 99–101 so every printed MA reads around 100 (never a stale
// 75x fallback level from an un-intercepted owner file).
const dailyFixture = (() => {
  const end = Date.parse(`${SESSION}T00:00:00Z`);
  const bars: [string, number, number, number, number, number][] = [];
  for (let back = 320; back >= 0; back--) {
    const day = new Date(end - back * 86_400_000);
    // Use the actual bar owner's exchange calendar; weekdays alone include holidays
    // that closedDailyBars correctly refuses, silently withholding all daily MAs.
    if (!usRegularSessionWindow(day.getTime() / 1000)) continue;
    const close = back === 0 ? SPOT : SPOT + Math.sin(back / 9) * 0.8;
    const open = close - Math.cos(back / 5) * 0.2;
    const date = day.toISOString().slice(0, 10);
    const intraday = date === SESSION ? buildIntraday("5m").bars : null;
    bars.push(intraday
      ? [date, intraday[0]![1]!, Math.max(...intraday.map(b => b[2]!)), Math.min(...intraday.map(b => b[3]!)), SPOT, intraday.reduce((v, b) => v + b[5]!, 0)]
      : [date, open, Math.max(open, close) + 0.3, Math.min(open, close) - 0.3, close, 4_200_000 + back * 1500]);
  }
  return { symbol: "SPY", t: "SPY", bars };
})();

// The desk's own 30s polling fallback republishes each read as a NEW source object, which
// invalidates a held selection by design. These fixtures never vary, so the journey simply has
// to complete inside one 30s poll window per leg — every wait below is expect-driven, no sleeps.
async function installSyntheticRoutes(page: Page) {
  // This synthetic member has no auth service/session. Settings intent stays
  // local; no account read/write or provider request reaches an external host.
  await page.route(url => url.hostname === "127.0.0.1" && url.port === "54321", route =>
    route.fulfill({ status: 401, json: { error: "synthetic local fixture has no auth session" } }));
  const day = dailyFixture.bars.at(-1)!;
  const previousClose = dailyFixture.bars.at(-2)![4];
  const quote = { sym: "SPY", last: SPOT, close: SPOT, prevClose: previousClose,
    chg: (SPOT / previousClose - 1) * 100, regularPrice: SPOT, regularChg: (SPOT / previousClose - 1) * 100,
    open: day[1], high: day[2], low: day[3], vol: day[5], amount: null,
    source: "fixture", market: "us", basis: "EOD", live: false,
    ts: Date.parse(OBSERVED_AT) / 1000, asOfMs: Date.parse(OBSERVED_AT),
    regularSessionDate: SESSION, regularSession: "closed" };
  await page.route(url => url.pathname === "/api/quote", route => {
    const url = new URL(route.request().url());
    const single = url.searchParams.get("sym");
    if (single) return route.fulfill({ json: { sym: single, quote: single === "SPY" ? quote : null } });
    const symbols = (url.searchParams.get("syms") ?? "").split(",").filter(Boolean);
    return route.fulfill({ json: { quotes: Object.fromEntries(symbols.map(sym => [sym, sym === "SPY" ? quote : null])) } });
  });
  await page.route(url => url.pathname === "/api/ext-quote", route => route.fulfill({ json: { quotes: {} } }));
  await page.route(url => url.pathname === "/data/manifest.json", async route => {
    const response = await route.fetch();
    const manifest = await response.json();
    // Preserve the universe and descriptive metadata; SPY's numeric market
    // owner is this declared local series, never the shared 728.99 snapshot.
    const previous = manifest.symbols.SPY;
    manifest.symbols.SPY = { name: previous.name, sec: previous.sec, col: previous.col,
      last: SPOT, chg: quote.chg, open: day[1], high: day[2], low: day[3], vol: day[5] };
    await route.fulfill({ response, json: manifest });
  });
  await page.route((url) => url.pathname === "/api/flow/stream", (route) => route.abort("failed"));
  await page.route((url) => url.pathname === "/api/flow", async (route) => {
    const feed = new URL(route.request().url()).searchParams.get("f") ?? "";
    if (feed === "gex:SPY") return route.fulfill({ json: envelope });
    if (feed === "gex_dates:SPY") return route.fulfill({ json: datesFixture });
    if (feed === "gexstate:SPY") return route.fulfill({ json: stateFixture });
    if (feed === "matrix:SPY") return route.fulfill({ json: matrixFixture });
    if (feed === "moves:SPY") return route.fulfill({ json: movesFixture });
    // The dated plane holds no earlier synthetic session: a published absence, so the surface
    // honestly reports the change column as unavailable instead of inventing a prior.
    if (feed.startsWith("gex_at:")) return route.fulfill({ status: 404, json: { error: "synthetic fixture stores no archived session" } });
    return route.continue();
  });
  await page.route((url) => url.pathname === "/api/intraday", (route) => {
    const tf = new URL(route.request().url()).searchParams.get("tf") ?? "5m";
    return route.fulfill({ json: buildIntraday(tf) });
  });
  await page.route((url) => url.pathname === "/data/SPY.json", (route) => route.fulfill({ json: dailyFixture }));
}

// Fixture invariants asserted BEFORE any UI claim: one root, one session, one spot, and the
// exact synthetic cell identities the journey is about to select.
function expectFixtureInvariants() {
  expect(envelope.root).toBe("SPY");
  expect(envelope.asof.startsWith(SESSION)).toBe(true);
  expect(envelope.spot_ref).toBe(SPOT);
  expect(envelope.spot_ref).toBeGreaterThanOrEqual(99.5);
  expect(envelope.spot_ref).toBeLessThanOrEqual(100.5);
  expect(projection.clocks.source_session).toBe(SESSION);
  expect(projection.cells).toHaveLength(4);
  for (const cell of projection.cells) {
    expect(cell.expiry >= SESSION).toBe(true);
    expect(cell.gamma.unit).toBe("usd_delta_per_1pct_spot");
    expect(cell.gamma.missing).toBe(0);
    expect(cell.gamma.gross as number).toBeGreaterThanOrEqual(Math.abs(cell.gamma.net as number));
    expect((cell.gamma.call as number) + (cell.gamma.put as number)).toBe(cell.gamma.net);
    expect((cell.gamma.call as number) - (cell.gamma.put as number)).toBe(cell.gamma.gross);
  }
  const netOf = (strike: number, expiry: string) =>
    projection.cells.find((cell) => cell.strike === strike && cell.expiry === expiry)!.gamma.net as number;
  const grossOf = (strike: number, expiry: string) =>
    projection.cells.find((cell) => cell.strike === strike && cell.expiry === expiry)!.gamma.gross as number;
  expect(netOf(SELECTED_STRIKE, SELECTED_EXPIRY)).toBe(200e6);
  expect(grossOf(SELECTED_STRIKE, SELECTED_EXPIRY)).toBe(400e6);
  expect(netOf(SELECTED_STRIKE, "2026-10-23")).toBe(100e6);
  // The all-expiry strike net the UI must NOT present for the scoped Oct30 selection.
  expect(netOf(SELECTED_STRIKE, "2026-10-23") + netOf(SELECTED_STRIKE, SELECTED_EXPIRY)).toBe(300e6);
  expect(netOf(98, "2026-10-23")).toBe(-30e6);
  expect(netOf(98, SELECTED_EXPIRY)).toBe(-60e6);
  const intraday = buildIntraday("5m").bars;
  expect(intraday).toHaveLength(78);
  expect(intraday[0]![0]).toBe(Date.parse(`${SESSION}T09:30:00Z`) / 1000);
  expect(intraday.at(-1)![0]).toBe(Date.parse(`${SESSION}T15:55:00Z`) / 1000);
  expect(intraday.at(-1)![4]).toBe(SPOT);
  for (const bar of intraday) expect(Math.abs(bar[4] as number - SPOT)).toBeLessThanOrEqual(2);
  const daily = dailyFixture.bars;
  expect(daily.length).toBeGreaterThanOrEqual(60);
  expect(daily.at(-1)![0]).toBe(SESSION);
  expect(daily.at(-1)![4]).toBe(SPOT);
  for (const bar of daily) {
    expect(usRegularSessionWindow(Date.parse(`${bar[0]}T00:00:00Z`) / 1000)).not.toBeNull();
    expect(bar[4]).toBeGreaterThanOrEqual(99);
    expect(bar[4]).toBeLessThanOrEqual(101);
  }
  for (const doc of [matrixFixture, datesFixture, stateFixture, movesFixture]) expect(doc.root).toBe("SPY");
  expect(stateFixture.spot).toBe(SPOT);
  expect(movesFixture.spot_ref).toBe(SPOT);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// The surface's own short date, used verbatim in its Pin button label.
const shortCellDate = (lang: "en" | "zh", expiry: string) => {
  const month = Number(expiry.slice(5, 7)), day = Number(expiry.slice(8, 10));
  return lang === "zh" ? `${month}月${day}日` : `${MONTHS[month - 1]} ${day}`;
};

async function retainSyntheticJson(name: string, value: unknown) {
  const path = test.info().outputPath(name);
  await writeFile(path, JSON.stringify(value, null, 2));
  await test.info().attach(name, { contentType: "application/json", path });
}

async function runSurfaceJourney(page: Page, lang: "en" | "zh", theme: "dark" | "light",
  screenshot: (stage: string) => Promise<void>, touch: boolean, keyboard: boolean) {
  const mt = exposureMapT(lang);
  const st = exposureSurfaceT(lang);
  const cellLabel = `${SELECTED_STRIKE} × ${shortCellDate(lang, SELECTED_EXPIRY)}`;
  const inspector = page.getByTestId("exposure-node-inspector");
  const map = page.getByTestId("exposure-map");
  const scope = map.getByLabel(mt("scope"), { exact: true });
  const metricGroup = map.getByRole("group", { name: mt("metric"), exact: true });
  const pressedMetric = () => metricGroup.locator('button[aria-pressed="true"]');
  const netButton = map.getByRole("button", { name: mt("net"), exact: true });

  await test.step("overview: qualified book lands with a painted chart", async () => {
    await page.goto("/options?tab=prism&symbol=SPY&view=chart");
    await expect(map).toHaveAttribute("data-source-root", "SPY");
    await expect(map).toHaveAttribute("data-source-session", SESSION);
    await expect(map).toHaveAttribute("data-chart-ready", "true", { timeout: 30_000 });
    if (theme === "light") {
      // This route consumes the existing account preference owner, not the
      // Shared Shell cache key. Exercise its real control on the local fixture identity.
      const settingsHost = touch ? page.locator(".mobilebar") : page.getByRole("banner");
      await settingsHost.getByRole("button", { name: "设置", exact: true }).click({ timeout: 5000 });
      await page.getByRole("tab", { name: "偏好", exact: true }).click();
      await page.getByRole("group", { name: "外观", exact: true }).getByRole("button", { name: "浅色", exact: true }).click();
      await page.getByRole("button", { name: "关闭", exact: true }).first().click();
      await expect(page.locator(".acs-overlay")).toBeHidden();
    }
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(map.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 30_000 });
    if ((page.viewportSize()?.width ?? 0) <= 640) {
      // The compact nav deliberately omits its quality pill; the visible source
      // disclosure and qualified-contract count remain the mobile explanation.
      await expect(map.locator('[data-quality="qualified"]')).toBeAttached();
      await expect(map.getByRole("button", { name: `${mt("sourcesAndCoverage")} ↗`, exact: true })).toBeVisible();
      await expect(map.getByText(mt("qualifiedContracts"), { exact: true })).toBeVisible();
    } else {
      await expect(map.locator('[data-quality="qualified"]')).toBeVisible();
    }
    await expect(map).toContainText(`$${SPOT}`);
    await expect(map).toContainText(SESSION);
    // Keep the actual four-MA reference preset present; fixture errors must not
    // beautify the chart by causing the daily owner to withhold its inputs.
    for (const label of ["SMA 5 · D", "EMA 21 · D", "SMA 55 · D", "SMA 34 · 5m"]) {
      await expect(map.getByText(label, { exact: true })).toBeVisible();
    }
    await map.locator(".chart-wrap canvas").first().scrollIntoViewIfNeeded();
    await screenshot("overview");
  });

  await test.step("surface: select the 103 × Oct30 cell through the real field", async () => {
    await map.getByRole("button", { name: mt("surfaceTab"), exact: true }).click();
    const surface = map.locator('section[data-surface-status="ready"]');
    await expect(surface).toHaveAttribute("data-surface-identity", "provider_observed");
    await expect(surface.getByTestId("surface-field")).toBeVisible();
    await expect(surface.getByTestId("surface-pill")).toHaveText(cellLabel);
    await expect(surface.getByTestId("surface-window-line")).toContainText("±4%");
    const cell = surface.locator(`[data-surface-cell][data-strike="${SELECTED_STRIKE}"][data-expiry="${SELECTED_EXPIRY}"]`);
    await expect(cell).toHaveCount(1);
    const field = surface.getByTestId("surface-field");
    await expect(field.getByTestId("surface-focus-label")).toBeVisible();
    const geometry = await field.evaluate(svg => {
      const frame = svg.getBoundingClientRect();
      return { width: frame.width, height: frame.height, cells: [...svg.querySelectorAll<SVGGElement>("[data-surface-cell]")].map(group => {
        const rect = group.getBoundingClientRect();
        const face = group.querySelector('polygon[class*="faceTop"]');
        return { strike: group.dataset.strike, expiry: group.dataset.expiry,
          left: rect.left - frame.left, top: rect.top - frame.top,
          right: rect.right - frame.left, bottom: rect.bottom - frame.top,
          fill: face ? getComputedStyle(face).fill : null };
      }), primitives: [...svg.querySelectorAll<SVGGraphicsElement>("text, line, polygon, circle, rect")].map(element => {
        const rect = element.getBoundingClientRect();
        return { kind: element.tagName, text: element.textContent,
          left: rect.left - frame.left, top: rect.top - frame.top,
          right: rect.right - frame.left, bottom: rect.bottom - frame.top };
      }) };
    });
    await retainSyntheticJson("synthetic-surface-screen-geometry.json", geometry);
    for (const bounds of geometry.cells) {
      expect(bounds.left, `${bounds.strike}×${bounds.expiry} left inside measured SVG`).toBeGreaterThanOrEqual(0);
      expect(bounds.top, `${bounds.strike}×${bounds.expiry} top inside measured SVG`).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(geometry.width);
      expect(bounds.bottom).toBeLessThanOrEqual(geometry.height);
      expect(bounds.fill).not.toBe("rgb(0, 0, 0)");
      expect(bounds.fill).not.toBe("none");
    }
    for (const bounds of geometry.primitives) {
      const label = `${bounds.kind} ${bounds.text ?? ""}`;
      expect(bounds.left, `${label} left inside SVG`).toBeGreaterThanOrEqual(-0.1);
      expect(bounds.top, `${label} top inside SVG`).toBeGreaterThanOrEqual(-0.1);
      expect(bounds.right, `${label} right inside SVG`).toBeLessThanOrEqual(geometry.width + 0.1);
      expect(bounds.bottom, `${label} bottom inside SVG`).toBeLessThanOrEqual(geometry.height + 0.1);
    }
    expect(geometry.cells.find(c => c.strike === "103")?.fill).not.toBe(geometry.cells.find(c => c.strike === "98")?.fill);
    if (keyboard) {
      await surface.getByRole("button", { name: st("spotPlane"), exact: true }).focus();
      await page.keyboard.press("Tab");
      const first = field.locator('[data-surface-cell][data-strike="103"][data-expiry="2026-10-23"]');
      await expect(first).toBeFocused();
      await expect(first).toHaveAttribute("role", "button");
      await page.keyboard.press("Enter");
      await expect(surface.getByTestId("surface-pill")).toHaveText(`103 × ${shortCellDate(lang, "2026-10-23")}`);
      await page.keyboard.press("Tab");
      const negative = field.locator('[data-surface-cell][data-strike="98"][data-expiry="2026-10-23"]');
      await expect(negative).toBeFocused();
      const scroll = await page.evaluate(() => document.scrollingElement?.scrollTop);
      await page.keyboard.press("Space");
      await expect(surface.getByTestId("surface-pill")).toHaveText(`98 × ${shortCellDate(lang, "2026-10-23")}`);
      expect(await page.evaluate(() => document.scrollingElement?.scrollTop)).toBe(scroll);
      await screenshot("keyboard-cell");
    }
    // Select the visible painted face a user aims at; a tall group's rectangular
    // bounding-box centre can lie behind another prism despite a visible top.
    const paintedFace = cell.locator('polygon[class*="faceTop"]');
    if (touch) await paintedFace.tap(); else await paintedFace.click();
    const cellInspector = surface.getByTestId("surface-inspector");
    await expect(cellInspector).toContainText(`${SELECTED_STRIKE} × ${shortCellDate(lang, SELECTED_EXPIRY).toUpperCase()}`);
    await expect(cellInspector).toContainText("+200M");
    await expect(cellInspector).toContainText("400M");
    await expect(cellInspector).toContainText("+300M"); // the surface's own strike-net row shows the all-expiry net
    if (lang === "en" && page.viewportSize()?.width === 390) {
      const contractViewport = page.viewportSize()!;
      const contractWidth = (await field.boundingBox())!.width;
      await page.setViewportSize({ width: 320, height: contractViewport.height });
      await expect.poll(async () => (await field.boundingBox())?.width ?? Infinity).toBeLessThan(contractWidth);
      await expect(field.getByTestId("surface-focus-label")).toBeVisible();
      const narrow = await field.evaluate(svg => {
        const frame = svg.getBoundingClientRect();
        return { width: frame.width, height: frame.height,
          bounds: [...svg.querySelectorAll<SVGGraphicsElement>("text, line, polygon, circle, rect")].map(el => {
            const b = el.getBoundingClientRect();
            return { left: b.left - frame.left, top: b.top - frame.top, right: b.right - frame.left, bottom: b.bottom - frame.top };
          }), faces: [...svg.querySelectorAll<SVGGraphicsElement>('polygon[class*="faceTop"]')].map(el => {
            const b = el.getBoundingClientRect(); return { width: b.width, height: b.height };
          }) };
      });
      await retainSyntheticJson("synthetic-surface-320-geometry.json", narrow);
      for (const b of narrow.bounds) {
        expect(b.left).toBeGreaterThanOrEqual(-0.1); expect(b.top).toBeGreaterThanOrEqual(-0.1);
        expect(b.right).toBeLessThanOrEqual(narrow.width + 0.1); expect(b.bottom).toBeLessThanOrEqual(narrow.height + 0.1);
      }
      for (const face of narrow.faces) { expect(face.width).toBeGreaterThan(1); expect(face.height).toBeGreaterThan(1); }
      await paintedFace.tap();
      await field.evaluate(svg => svg.scrollIntoView({ block: "center" }));
      await screenshot("surface-narrow320");
      await page.setViewportSize(contractViewport);
      await expect.poll(async () => (await field.boundingBox())?.width ?? 0).toBe(contractWidth);
    }
    // Centre the actual field by ordinary document scrolling, so the fixed
    // shell footer cannot obscure its lower rows in visual evidence.
    await field.evaluate(svg => svg.scrollIntoView({ block: "center" }));
    await screenshot("surface-field");
    await cellInspector.scrollIntoViewIfNeeded();
    await screenshot("surface-cell");
  });

  await test.step("handoff: the cell's own expiry and Gamma, never the aggregate", async () => {
    if (lang === "en") {
      await map.getByRole("button", { name: st("openInExposure"), exact: true }).click();
    } else {
      await map.getByRole("button", { name: st("pinCell", { cell: cellLabel }), exact: true }).click();
    }
    await expect(scope).toHaveValue(SELECTED_EXPIRY);
    await expect(scope.locator("option:checked")).toHaveText(SELECTED_EXPIRY);
    await expect(pressedMetric()).toHaveText(mt("gamma"));
    await expect(netButton).toHaveAttribute("aria-pressed", "true");
    await expect(inspector).toContainText(`${mt("selected")} ${SELECTED_STRIKE}`);
    await expect(inspector).toContainText("+200M");
    await expect(inspector).toContainText("400M");
    // The scoped node view must not borrow the all-expiry strike net.
    await expect(inspector).not.toContainText("+300M");
    if (lang === "zh") {
      // The Surface Pin path lands pinned in this view.
      await expect(inspector.getByRole("button", { name: mt("unpin"), exact: true })).toHaveAttribute("aria-pressed", "true");
    } else {
      await inspector.getByRole("button", { name: mt("pin"), exact: true }).click();
      await expect(inspector.getByRole("button", { name: mt("unpin"), exact: true })).toHaveAttribute("aria-pressed", "true");
    }
    await screenshot("selected-node");
  });

  await test.step("main chart: the exact bounded request requalifies as ready", async () => {
    await inspector.getByRole("button", { name: mt("openOnMainChart"), exact: true }).click();
    await expect(page).toHaveURL(/\/terminal\?symbol=SPY#exposure=/);
    const request = parseExposureChartRequest(new URL(page.url()).hash);
    expect(request).not.toBeNull();
    expect(request).toMatchObject({
      v: 1, root: "SPY", session: SESSION, strike: SELECTED_STRIKE, archived: false, metric: "gamma",
      lens: { kind: "one", exp: SELECTED_EXPIRY }, shock: { spotPercent: 0, ivPoints: 0, calendarDays: 0 },
    });
    expect(Object.keys(request!).sort()).toEqual(["archived", "fingerprint", "lens", "metric", "root", "session", "shock", "strike", "v"]);
    expect(request!.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    const reference = page.getByTestId("exposure-chart-reference");
    await expect(reference).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
    await expect(reference).toHaveAttribute("data-chart-state", "offscreen");
    const readNativeOwner = () => page.evaluate(() => {
      const owner = window as unknown as { __mmChartAxisOpts?: () => {
        optionsPin: { price: number; color: string }; priceVisibleRange: { from: number; to: number };
        optionsPinViewport: { state: string; coordinate: number | null; paneHeight: number };
        timeframe: string; contextProof: { priceRows: unknown[] };
      } };
      return owner.__mmChartAxisOpts?.() ?? null;
    });
    const beforeReveal = await readNativeOwner();
    expect(beforeReveal?.optionsPin.price).toBe(SELECTED_STRIKE);
    expect(beforeReveal?.priceVisibleRange.to).toBeLessThan(SELECTED_STRIKE);
    expect(beforeReveal?.optionsPinViewport.state).toBe("offscreen");
    const boundedHash = new URL(page.url()).hash;
    await reference.getByRole("button", { name: mt("revealReference"), exact: true }).click();
    await expect(reference).toHaveAttribute("data-chart-state", "visible");
    const revealed = await readNativeOwner();
    expect(revealed?.optionsPinViewport.state).toBe("visible");
    expect(revealed?.optionsPinViewport.coordinate).toBeGreaterThanOrEqual(0);
    expect(revealed?.optionsPinViewport.coordinate).toBeLessThanOrEqual(revealed!.optionsPinViewport.paneHeight);
    expect(revealed?.timeframe).toBe(beforeReveal?.timeframe);
    expect(revealed?.contextProof.priceRows).toEqual(beforeReveal?.contextProof.priceRows);
    expect(new URL(page.url()).hash).toBe(boundedHash);
    // Witness real native paint, not just a price-line object or a ready card.
    // The existing dev hooks expose the real coordinate; read the actual canvas
    // pixels along that line after the explicit user action, without drawing.
    const paintedPixels = () => page.evaluate(() => {
      const owner = window as unknown as {
        __mmChartAxisOpts?: () => { optionsPin: { color: string }; optionsPinViewport: { coordinate: number } };
        __mmPriceLabels?: () => { pricePaneTop: number };
      };
      const axis = owner.__mmChartAxisOpts?.(), labels = owner.__mmPriceLabels?.();
      const wrap = document.querySelector<HTMLElement>(".chart-wrap");
      const hex = axis?.optionsPin.color.match(/^#([a-f0-9]{6})$/i)?.[1];
      if (!axis || !labels || !wrap || !hex) return 0;
      const rgb = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
      const frame = wrap.getBoundingClientRect();
      const screenY = frame.top + labels.pricePaneTop + axis.optionsPinViewport.coordinate;
      let hits = 0;
      for (const canvas of wrap.querySelectorAll("canvas")) {
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height || screenY < rect.top || screenY >= rect.bottom) continue;
        const ctx = canvas.getContext("2d"); if (!ctx) continue;
        const sx = canvas.width / rect.width, sy = canvas.height / rect.height;
        const x0 = Math.max(0, Math.floor((Math.max(rect.left, frame.left + frame.width * 0.3) - rect.left) * sx));
        const x1 = Math.min(canvas.width, Math.ceil((Math.min(rect.right, frame.left + frame.width * 0.7) - rect.left) * sx));
        const y0 = Math.max(0, Math.floor((screenY - rect.top - 2) * sy));
        const y1 = Math.min(canvas.height, Math.ceil((screenY - rect.top + 2) * sy));
        if (x1 <= x0 || y1 <= y0) continue;
        const pixels = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i + 3]! > 128 && rgb.every((v, c) => Math.abs(pixels[i + c]! - v) <= 8)) hits++;
        }
      }
      return hits;
    });
    await expect.poll(paintedPixels, { message: "dated 103 reference actually paints in the visible native chart" }).toBeGreaterThan(3);
    await retainSyntheticJson("synthetic-main-chart-reveal.json", { before: beforeReveal, after: revealed, matching_native_line_pixels: await paintedPixels() });
    await expect(reference).toContainText(`SPY ${SELECTED_STRIKE}`);
    // This records the existing real canvas owner, not a painted-line claim.
    // A ready card can still own an offscreen line; preserve that distinction.
    const chartState = await page.evaluate(() => {
      const owner = window as unknown as { __mmChartAxisOpts?: () => unknown };
      return owner.__mmChartAxisOpts?.() ?? null;
    });
    await retainSyntheticJson("synthetic-main-chart-owner.json", chartState);
    await expect(reference).toContainText(SESSION);
    await expect(reference).toContainText(SELECTED_EXPIRY);
    await expect(reference.getByRole("button", { name: mt("unpin"), exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30_000 });
    await screenshot("chart-reference");
  });

  await test.step("return: the same selection requalifies through the exact context", async () => {
    await page.getByTestId("exposure-chart-reference").getByRole("link", { name: mt("returnToExposure"), exact: true }).click();
    await expect(page).toHaveURL(/\/options\?tab=prism&symbol=SPY&view=chart#exposure=/);
    const returnCheck = page.getByTestId("exposure-return-check");
    await expect(returnCheck).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
    await expect(returnCheck).toContainText(mt("selectionRestored"));
    await expect(map).toHaveAttribute("data-source-root", "SPY");
    await expect(map).toHaveAttribute("data-source-session", SESSION);
    await expect(scope).toHaveValue(SELECTED_EXPIRY);
    await expect(pressedMetric()).toHaveText(mt("gamma"));
    await expect(netButton).toHaveAttribute("aria-pressed", "true");
    await expect(inspector).toContainText(`${mt("selected")} ${SELECTED_STRIKE}`);
    await expect(inspector).toContainText("+200M");
    await expect(inspector).toContainText("400M");
    await expect(inspector).not.toContainText("+300M");
    // Pin is intentionally per-view state in the map: the bounded return request carries no pin,
    // so neither language restores it — the selection, scope and exact values are what requalify.
    await expect(inspector.getByRole("button", { name: mt("pin"), exact: true })).toHaveAttribute("aria-pressed", "false");
    await screenshot("return");
  });
}

for (const lang of ["en", "zh"] as const) {
  const theme = lang === "en" ? "dark" : "light";
  test(`synthetic exposure surface journey ${lang}`, async ({ page, baseURL }, info) => {
      test.setTimeout(90_000);
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      // Frozen browser clock (RAF still runs) + the incumbent no-SSE polling fallback.
      await page.context().addCookies([
        { name: "mm_e2e_rs30", value: "1", url: baseURL! },
      ]);
      await page.clock.install({ time: new Date(FIXED_NOW) });
      await page.addInitScript((locale) => {
        localStorage.setItem("mm.lang", locale);
        // Theme is selected through the visible Settings preference control below.
        Reflect.deleteProperty(window, "EventSource");
      }, lang);
      expectFixtureInvariants();
      await installSyntheticRoutes(page);
      const stages: Record<string, string> = {};
      const actualThemes: Record<string, string | null> = {};
      const screenshot = async (stage: string) => {
        const path = `test-results/synthetic-exposure-surface-${info.project.name}-${lang}-${stage}.png`;
        stages[stage] = path;
        actualThemes[stage] = await page.locator("html").getAttribute("data-theme");
        await page.screenshot({ path });
      };
      await runSurfaceJourney(page, lang, theme, screenshot, info.project.name !== "desktop", info.project.name === "desktop" && lang === "en");
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      expect(pageErrors, "a synthetic journey must not trip page errors").toEqual([]);
      await retainSyntheticJson("synthetic-exposure-surface-context.json", {
          data_classification: "SYNTHETIC LOCAL",
          source_snapshot_ref: SOURCE_REF,
          root: "SPY", session: SESSION, spot: SPOT,
          clock_frozen_at: FIXED_NOW,
          lang, theme, project: info.project.name,
          viewport: page.viewportSize(),
          screenshots: stages,
          actual_theme_by_stage: actualThemes,
      });
    });
}
