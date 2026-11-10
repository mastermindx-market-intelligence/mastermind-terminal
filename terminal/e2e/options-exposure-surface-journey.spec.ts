import { expect, test, type Page, type Locator } from "@playwright/test";
import { fixtureUserId } from "../lib/watchlistsFixtureDb";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { parseExposureChartRequest, exposureChartFingerprint, exposureChartHref, exposureMapHref } from "../lib/exposureChartLink";
import { readExposureMap } from "../lib/exposureMap";
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

// Explicit local acceptance mode; inherited dark captures remain separate.
const LIGHT_ACCEPTANCE = process.env.TERMINAL_EXPOSURE_LIGHT_ACCEPTANCE === "1";
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

type MaPaint = { label: string; text: string; fontPx: number; serial: number; left: number; right: number; top: number; bottom: number };
async function readMaPaint(page: Page): Promise<MaPaint[]> {
  return page.evaluate(() => (window as unknown as { __readExposureMaPaint?: () => MaPaint[] }).__readExposureMaPaint?.() ?? []);
}
async function expectReadableMaPaint(page: Page, stage: string, afterSerial = 0) {
  await expect.poll(async () => (await readMaPaint(page)).filter(row => row.serial > afterSerial).length).toBe(4);
  const rows = await readMaPaint(page);
  await retainSyntheticJson(`synthetic-ma-paint-${stage}.json`, rows);
  const wrap = await page.getByTestId("exposure-map").locator(".chart-wrap").first().boundingBox();
  expect(wrap).not.toBeNull();
  for (const row of rows) {
    expect(row.fontPx, `${row.label} readable font`).toBeGreaterThanOrEqual(11);
    expect(row.left).toBeGreaterThanOrEqual(wrap!.x);
    expect(row.right).toBeLessThanOrEqual(wrap!.x + wrap!.width);
    expect(row.top).toBeGreaterThanOrEqual(wrap!.y + 44);
    expect(row.bottom).toBeLessThanOrEqual(wrap!.y + wrap!.height);
  }
  const sorted = rows.slice().sort((a, b) => a.top - b.top);
  for (let i = 1; i < sorted.length; i++) expect(sorted[i]!.top - sorted[i - 1]!.bottom).toBeGreaterThanOrEqual(2);
  const strip = await page.getByTestId("exposure-map").evaluate((map, labels) => labels.map(label => {
    const name = [...map.querySelectorAll("b")].find(b => b.textContent === label)!;
    const item = name.parentElement!, date = item.querySelector("time")!;
    const rect = item.getBoundingClientRect(), owner = item.parentElement!.getBoundingClientRect();
    return { label, text: item.textContent, date: date.textContent, font: parseFloat(getComputedStyle(item).fontSize),
      dateFont: parseFloat(getComputedStyle(date).fontSize), clipped: item.scrollWidth > item.clientWidth,
      left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, ownerLeft: owner.left, ownerRight: owner.right };
  }), rows.map(row => row.label));
  for (const item of strip) {
    expect(item.font).toBeGreaterThanOrEqual(11); expect(item.dateFont).toBeGreaterThanOrEqual(10);
    expect(item.text).toMatch(/\d+\.\d+/); expect(item.date).toBe("10-19"); expect(item.clipped).toBe(false);
    expect(item.left).toBeGreaterThanOrEqual(item.ownerLeft); expect(item.right).toBeLessThanOrEqual(item.ownerRight);
  }
  for (let i = 0; i < strip.length; i++) for (let j = i + 1; j < strip.length; j++) {
    const a = strip[i]!, b = strip[j]!;
    expect(Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
      * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))).toBe(0);
  }
  await retainSyntheticJson(`synthetic-ma-strip-${stage}.json`, strip);
  return Math.max(...rows.map(row => row.serial));
}
async function expectReferenceBadgeClear(page: Page, stage: string) {
  const badge = page.getByTestId("options-selected-reference-badge");
  await expect(badge).toBeVisible();
  await expect(badge).toContainText(SESSION);
  await expect(badge).toContainText("103.00");
  const b = (await badge.boundingBox())!;
  const wrap = (await page.locator(".chart-wrap").first().boundingBox())!;
  expect(b.x).toBeGreaterThanOrEqual(wrap.x);
  expect(b.x + b.width).toBeLessThanOrEqual(wrap.x + wrap.width + 0.1);
  expect(b.y).toBeGreaterThanOrEqual(wrap.y);
  expect(b.y + b.height).toBeLessThanOrEqual(wrap.y + wrap.height + 0.1);
  const readout = await page.locator(".chart-wrap").first().locator(".statusline").boundingBox();
  if (readout) expect(b.y, "complete dated badge clears the measured OHLC readout").toBeGreaterThanOrEqual(readout.y + readout.height);
  const control = page.locator(".chart-fs-float");
  const c = await control.isVisible() ? await control.boundingBox() : null;
  if (c) {
    expect(c.width).toBeGreaterThanOrEqual(40); expect(c.height).toBeGreaterThanOrEqual(40);
    const intersection = Math.max(0, Math.min(b.x + b.width, c.x + c.width) - Math.max(b.x, c.x))
      * Math.max(0, Math.min(b.y + b.height, c.y + c.height) - Math.max(b.y, c.y));
    expect(intersection, "complete dated badge clears the actual fullscreen control").toBe(0);
  }
  await retainSyntheticJson(`synthetic-reference-badge-${stage}.json`, { text: await badge.textContent(), badge: b, control: c, readout });
}

async function selectActualLight(page: Page, lang: "en" | "zh", stage: string, requested: "light" | "dark" = "light") {
  const before = await page.locator("html").getAttribute("data-theme");
  const topbar = page.locator("header.topbar");
  const host = await topbar.isVisible() ? topbar : page.locator(".mobilebar");
  await host.getByRole("button", { name: lang === "en" ? "Settings" : "设置", exact: true }).click({ timeout: 5_000 });
  await page.getByRole("tab", { name: lang === "en" ? "Preferences" : "偏好", exact: true }).click();
  const choice = page.getByRole("group", { name: lang === "en" ? "Appearance" : "外观", exact: true })
    .getByRole("button", { name: requested === "light" ? (lang === "en" ? "Light" : "浅色") : (lang === "en" ? "Dark" : "深色"), exact: true });
  await choice.click();
  await expect(choice).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: lang === "en" ? "Close" : "关闭", exact: true }).first().click();
  await expect(page.locator(".acs-overlay")).toBeHidden();
  const observed = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme,
    presentationOwner: document.documentElement.dataset.mmxSharedShell ?? null,
    chartAppearanceOwner: document.documentElement.dataset.terminalAppearance ?? null,
    researchAppearanceOwner: document.documentElement.dataset.researchAppearance ?? null,
    bodyBackground: getComputedStyle(document.body).backgroundColor,
    sourceRoot: document.querySelector('[data-testid="exposure-map"]')?.getAttribute("data-source-root") ?? null }));
  await retainSyntheticJson(`synthetic-light-control-${stage}.json`, { requested, before, ...observed });
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
      await selectActualLight(page, lang, "overview");
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
    const serial = await expectReadableMaPaint(page, "contract");
    if (page.viewportSize()?.width === 390) {
      const contract = page.viewportSize()!;
      await page.setViewportSize({ width: 320, height: contract.height });
      const narrowSerial = await expectReadableMaPaint(page, "narrow320", serial);
      await map.locator(".chart-wrap").first().evaluate(el => el.scrollIntoView({ block: "center" }));
      await screenshot("overview-narrow320");
      await page.setViewportSize(contract);
      await expectReadableMaPaint(page, "restored390", narrowSerial);
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
    if (LIGHT_ACCEPTANCE) {
      await selectActualLight(page, lang, "main-chart");
      await screenshot("main-chart-light-control");
      await expect(page.locator("html"), "the joined main-chart leg honors explicit Light intent").toHaveAttribute("data-theme", "light");
    }
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
    await expectReferenceBadgeClear(page, "contract");
    if (touch) {
      const fullscreen = page.locator(".chart-fs-float");
      const exerciseFullscreen = async (stage: string) => {
        await fullscreen.tap();
        await expect(page.locator(".app.fs")).toBeVisible();
        await expectReferenceBadgeClear(page, `${stage}-fullscreen`);
        await screenshot(`${stage}-fullscreen`);
        await fullscreen.tap();
        await expect(page.locator(".app.fs")).toHaveCount(0);
        await expectReferenceBadgeClear(page, `${stage}-exit`);
      };
      await exerciseFullscreen("chart-reference");
      if (page.viewportSize()?.width === 390) {
        const contract = page.viewportSize()!;
        await page.setViewportSize({ width: 320, height: contract.height });
        await expectReferenceBadgeClear(page, "narrow320");
        await screenshot("chart-reference-narrow320");
        await exerciseFullscreen("chart-reference-narrow320");
        await page.setViewportSize(contract);
        await expectReferenceBadgeClear(page, "restored390");
      }
    }
    expect(new URL(page.url()).hash).toBe(boundedHash);
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
  const theme = LIGHT_ACCEPTANCE ? "light" : lang === "en" ? "dark" : "light";
  test(`synthetic exposure surface journey ${lang}${LIGHT_ACCEPTANCE ? " light acceptance" : ""}`, async ({ page, baseURL }, info) => {
      test.setTimeout(90_000);
      const blockedExternal: { origin: string; path: string }[] = [];
      const localOrigin = new URL(baseURL!).origin;
      // Lowest-precedence browser fence. Explicit synthetic auth handlers below
      // fulfill their loopback requests; everything else stays on this exact server.
      await page.context().route("**/*", route => {
        const url = new URL(route.request().url());
        if (url.origin === localOrigin) return route.continue();
        blockedExternal.push({ origin: url.origin, path: url.pathname });
        return route.abort("blockedbyclient");
      });
      if (LIGHT_ACCEPTANCE) await page.emulateMedia({ colorScheme: "light" });
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      // Frozen browser clock (RAF still runs) + the incumbent no-SSE polling fallback.
      await page.context().addCookies([
        { name: "mm_e2e_rs30", value: "1", url: baseURL! },
      ]);
      // Read-only witness: trace the actual MA text paint without changing any
      // arguments, return values, pixels, layout or market data.
      await page.addInitScript(() => {
        const labels = ["SMA 5 · D", "EMA 21 · D", "SMA 55 · D", "SMA 34 · 5m"];
        const records = new Map<string, { canvas: HTMLCanvasElement; text: string; fontPx: number; serial: number;
          corners: { x: number; y: number }[] }>();
        let serial = 0;
        const original = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function (...args: Parameters<typeof original>) {
          original.apply(this, args);
          const [text, x, y] = args;
          const label = labels.find(label => text.startsWith(label));
          if (!label) return;
          const m = this.measureText(text), matrix = this.getTransform();
          const corners = [[x - m.actualBoundingBoxLeft, y - m.actualBoundingBoxAscent],
            [x + m.actualBoundingBoxRight, y - m.actualBoundingBoxAscent],
            [x - m.actualBoundingBoxLeft, y + m.actualBoundingBoxDescent],
            [x + m.actualBoundingBoxRight, y + m.actualBoundingBoxDescent]].map(([x, y]) =>
              ({ x: matrix.a * x! + matrix.c * y! + matrix.e, y: matrix.b * x! + matrix.d * y! + matrix.f }));
          records.set(label, { canvas: this.canvas, text, fontPx: Number(this.font.match(/([\d.]+)px/)?.[1]), serial: ++serial, corners });
        };
        (window as unknown as { __readExposureMaPaint: () => unknown[] }).__readExposureMaPaint = () =>
          [...records].filter(([, row]) => row.canvas.isConnected).map(([label, row]) => {
            const b = row.canvas.getBoundingClientRect(), sx = b.width / row.canvas.width, sy = b.height / row.canvas.height;
            return { label, text: row.text, fontPx: row.fontPx, serial: row.serial,
              left: b.left + Math.min(...row.corners.map(p => p.x)) * sx,
              right: b.left + Math.max(...row.corners.map(p => p.x)) * sx,
              top: b.top + Math.min(...row.corners.map(p => p.y)) * sy,
              bottom: b.top + Math.max(...row.corners.map(p => p.y)) * sy };
          });
      });
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
        const path = `test-results/synthetic-exposure-surface-${info.project.name}-${lang}${LIGHT_ACCEPTANCE ? "-light" : ""}-${stage}.png`;
        stages[stage] = path;
        actualThemes[stage] = await page.locator("html").getAttribute("data-theme");
        await page.screenshot({ path });
      };
      try {
        await runSurfaceJourney(page, lang, theme, screenshot, info.project.name !== "desktop", info.project.name === "desktop" && lang === "en");
      } finally {
        await retainSyntheticJson("synthetic-network-isolation.json", { localOrigin, blockedExternal,
          server_fence: LIGHT_ACCEPTANCE ? "launcher must provide unchanged loopback-only OS profile; see command/preflight receipt" : "fixture server + browser route fence",
          browser_zoom_200_percent: "NOT PROVED", cached_selection_latency_p95: "TARGET <100ms; NOT MEASURED" });
      }
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
          blocked_external_requests: blockedExternal,
          browser_zoom_200_percent: "NOT PROVED — no CSS zoom or DPR substitute",
          cached_selection_latency_p95: "TARGET <100ms; NOT MEASURED",
      });
    });
}


if (LIGHT_ACCEPTANCE) for (const lang of ["en", "zh"] as const) {
  test(`synthetic direct terminal light intent ${lang}`, async ({ page, baseURL }, info) => {
    test.setTimeout(90_000);
    const localOrigin = new URL(baseURL!).origin;
    const blockedExternal: { origin: string; path: string }[] = [];
    await page.context().route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin === localOrigin) return route.continue();
      blockedExternal.push({ origin: url.origin, path: url.pathname });
      return route.abort("blockedbyclient");
    });
    await page.context().addCookies([{ name: "mm_e2e_rs30", value: "1", url: baseURL! }]);
    await page.emulateMedia({ colorScheme: "light" });
    await page.clock.install({ time: new Date(FIXED_NOW) });
    await page.addInitScript(locale => { localStorage.setItem("mm.lang", locale); Reflect.deleteProperty(window, "EventSource"); }, lang);
    await installSyntheticRoutes(page);
    expectFixtureInvariants();
    try {
      // One direct route and one unchanged synthetic owner. This does NOT use the
      // Options route's different fixture actor as evidence of a preference defect.
      await page.goto("/terminal?symbol=SPY");
      await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 30_000 });
      const beforeUrl = page.url();
      const readFinancialView = () => page.evaluate(() => {
        const owner = window as unknown as { __mmChartAxisOpts?: () => { timeframe: string; contextProof: { priceRows: unknown[] }; priceVisibleRange: unknown; appearanceSettings: unknown };
          __s7Renderer?: { receipt: unknown; canvas: Element | null } };
        if (!owner.__s7Renderer) owner.__s7Renderer = { receipt: owner.__mmChartAxisOpts, canvas: document.querySelector(".chart-wrap canvas") };
        const native = owner.__mmChartAxisOpts?.();
        // Engine row styles may repaint; retain every non-style field as financial evidence.
        const rows = native?.contextProof.priceRows.map(row => Object.fromEntries(Object.entries(row as Record<string, unknown>)
          .filter(([key]) => !["color", "borderColor", "wickColor"].includes(key))));
        return native ? { timeframe: native.timeframe, priceRows: rows, priceVisibleRange: native.priceVisibleRange,
          storedSettings: native.appearanceSettings, sameRenderer: owner.__s7Renderer.receipt === owner.__mmChartAxisOpts,
          sameCanvas: owner.__s7Renderer.canvas === document.querySelector(".chart-wrap canvas") } : null;
      });
      const beforeFinancial = await readFinancialView();
      await selectActualLight(page, lang, "direct-terminal");
      expect(page.url()).toBe(beforeUrl);
      await page.screenshot({ path: `test-results/synthetic-direct-terminal-${info.project.name}-${lang}-light-intent.png` });
      await retainSyntheticJson("synthetic-direct-terminal-identity.json", {
        declared_fixture_owner: "e2e-user-default", fixture_store_cookie: "default", account_switches: 0,
        entry_and_after_url: beforeUrl, source_snapshot_ref: SOURCE_REF, session: SESSION, spot: SPOT,
        compiler: "installed Nextdev --webpack", typography: "fallback fonts — NOT full visual/typography acceptance",
        actual_theme: await page.locator("html").getAttribute("data-theme"),
      });
      await expect(page.locator("html"), "stable-owner Terminal honors actual explicit Light intent").toHaveAttribute("data-theme", "light");
      await expect(page.locator("html")).toHaveAttribute("data-terminal-appearance", "1");
      await expect(page.locator("html")).not.toHaveAttribute("data-mmx-shared-shell", "1");
      const readPaint = () => page.evaluate(() => {
        const body = getComputedStyle(document.body), root = getComputedStyle(document.documentElement);
        const header = document.querySelector<HTMLElement>(".statusline");
        const wrap = document.querySelector<HTMLElement>(".chart-wrap")!, bounds = wrap.getBoundingClientRect();
        const rgba = (value: string) => { const n = value.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0]; return [n[0]!, n[1]!, n[2]!, n[3] ?? 1]; };
        const over = (base: number[], color: number[]) => base.map((v, i) => v * (1 - color[3]!) + color[i]! * color[3]!);
        const ancestors: HTMLElement[] = []; for (let n: HTMLElement | null = wrap; n; n = n.parentElement) ancestors.unshift(n);
        let material = [0, 0, 0]; for (const n of ancestors) material = over(material, rgba(getComputedStyle(n).backgroundColor));
        const canvases = [...wrap.querySelectorAll<HTMLCanvasElement>("canvas")].map(canvas => ({ canvas, rect: canvas.getBoundingClientRect(), ctx: canvas.getContext("2d"), z: parseFloat(getComputedStyle(canvas).zIndex) || 0 }))
          .sort((a, b) => a.z - b.z);
        const colors = new Map<string, number>();
        // Read the actual layered canvas pixels composited over the painted DOM
        // material. Transparent canvas is not opaque axis ink or a made-up background.
        for (let row = 0; row < 7; row++) for (let col = 0; col < 9; col++) {
          const x = bounds.left + 20 + col * Math.max(1, bounds.width - 100) / 9;
          const y = bounds.top + bounds.height * (.24 + row * .045);
          let pixel = material.slice();
          for (const layer of canvases) {
            if (!layer.ctx || x < layer.rect.left || x >= layer.rect.right || y < layer.rect.top || y >= layer.rect.bottom) continue;
            const px = Math.floor((x - layer.rect.left) * layer.canvas.width / layer.rect.width), py = Math.floor((y - layer.rect.top) * layer.canvas.height / layer.rect.height);
            const d = layer.ctx.getImageData(px, py, 1, 1).data;
            pixel = over(pixel, [d[0]!, d[1]!, d[2]!, d[3]! / 255]);
          }
          const key = pixel.map(Math.round).join(","); colors.set(key, (colors.get(key) ?? 0) + 1);
        }
        const dominant = [...colors].sort((a, b) => b[1] - a[1])[0]?.[0].split(",").map(Number) ?? null;
        const legends = [...wrap.querySelectorAll<HTMLElement>(".lg-row")].filter(row => row.getBoundingClientRect().width > 0 && row.getBoundingClientRect().height > 0)
          .map(row => { const name = row.querySelector<HTMLElement>(".lg-name")!;
            return { label: name.textContent, ink: rgba(getComputedStyle(name).color).slice(0, 3), background: over(dominant ?? material, rgba(getComputedStyle(row).backgroundColor)) }; });
        return { canvasDominantRgb: dominant, legends, bodyBackground: body.backgroundColor, bodyForeground: body.color,
          headerForeground: header ? getComputedStyle(header).color : null,
          chartAxis: root.getPropertyValue("--chart-axis-text").trim(), chartGrid: root.getPropertyValue("--chart-grid").trim(),
          up: root.getPropertyValue("--up").trim(), down: root.getPropertyValue("--down").trim(),
          sharedShellMarker: document.documentElement.dataset.mmxSharedShell ?? null };
      });
      const paint = await readPaint();
      const rgb = paint.bodyBackground.match(/[\d.]+/g)!.slice(0, 3).map(Number);
      expect(Math.min(...rgb), "Light must paint a light material, not only change an attribute").toBeGreaterThan(200);
      await retainSyntheticJson("synthetic-direct-terminal-light-paint.json", paint);
      expect(paint.canvasDominantRgb, "inspect actual native canvas background, not only outer chrome").not.toBeNull();
      const linear = (value: number) => value / 255 <= .04045 ? value / 255 / 12.92 : ((value / 255 + .055) / 1.055) ** 2.4;
      const luminance = (rgb: number[]) => .2126 * linear(rgb[0]!) + .7152 * linear(rgb[1]!) + .0722 * linear(rgb[2]!);
      const ink = paint.headerForeground!.match(/[\d.]+/g)!.slice(0, 3).map(Number);
      const bg = luminance(paint.canvasDominantRgb!), fg = luminance(ink);
      const contrast = (Math.max(bg, fg) + .05) / (Math.min(bg, fg) + .05);
      await retainSyntheticJson("synthetic-native-readout-contrast.json", { foreground: ink, actual_canvas_background: paint.canvasDominantRgb, contrast });
      expect(Math.min(...paint.canvasDominantRgb!), "Light must paint the actual chart light").toBeGreaterThan(200);
      expect(contrast, "native readout is legible against its actual painted canvas").toBeGreaterThanOrEqual(4.5);
      for (const label of paint.legends) {
        const a = luminance(label.ink), b = luminance(label.background);
        expect((Math.max(a, b) + .05) / (Math.min(a, b) + .05), `${label.label} legible on its composited row`).toBeGreaterThanOrEqual(4.5);
      }
      const afterFinancial = await readFinancialView();
      expect(afterFinancial).toEqual(beforeFinancial);
      await retainSyntheticJson("synthetic-theme-financial-invariants.json", { before: beforeFinancial, after: afterFinancial });
      if (info.project.name === "mobile") {
        const contract = page.viewportSize()!;
        await page.setViewportSize({ width: 320, height: contract.height });
        await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        await page.screenshot({ path: `test-results/synthetic-direct-terminal-mobile-${lang}-light-320.png` });
        await page.setViewportSize(contract);
      }
      if (info.project.name === "desktop" && lang === "en") {
        const host = page.locator("header.topbar");
        await host.getByRole("button", { name: "Settings", exact: true }).click();
        await page.getByRole("tab", { name: "Preferences", exact: true }).click();
        await page.getByRole("group", { name: "Appearance", exact: true }).getByRole("button", { name: "Auto", exact: true }).click();
        await page.getByRole("button", { name: "Close", exact: true }).first().click();
        await expect(page.locator(".acs-overlay")).toBeHidden();
        await page.emulateMedia({ colorScheme: "dark" });
        await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
        await expect.poll(async () => (await readPaint()).canvasDominantRgb).toEqual([19, 23, 34]);
        const darkPaint = await readPaint();
        await page.emulateMedia({ colorScheme: "light" });
        await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
        await selectActualLight(page, lang, "direct-explicit-after-auto");
        await page.emulateMedia({ colorScheme: "dark" });
        await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
        await retainSyntheticJson("synthetic-direct-terminal-auto.json", { auto_media_dark: "dark", darkPaint, auto_media_light: "light", explicit_light_after_dark_media: "light", owner: "e2e-user-default" });
        // Save a nondefault dark frame through the real settings controls, then
        // prove changing appearance preserves that saved choice and native view.
        await page.locator(".cfb-gear").first().click();
        await page.locator(".qsg-menu .qsg-item").last().click();
        const dialog = page.locator("dialog.sm-backdrop");
        await expect(dialog).toBeVisible();
        await dialog.locator('[data-settings-tab="canvas"]').click();
        await dialog.getByLabel("Background colors (1)", { exact: true }).fill("#101521");
        await dialog.locator(".sm-ok").click();
        await expect(dialog).toHaveCount(0);
        await selectActualLight(page, lang, "saved-custom-dark-before", "dark");
        const saved = await readFinancialView();
        await selectActualLight(page, lang, "saved-custom-dark-light");
        const customPaint = await readPaint();
        const customAfter = await readFinancialView();
        expect(customAfter).toEqual(saved);
        expect(customPaint.canvasDominantRgb).toEqual([16, 21, 33]);
        const customInk = customPaint.headerForeground!.match(/[\d.]+/g)!.slice(0, 3).map(Number);
        const customBg = luminance(customPaint.canvasDominantRgb!), customFg = luminance(customInk);
        expect((Math.max(customBg, customFg) + .05) / (Math.min(customBg, customFg) + .05)).toBeGreaterThanOrEqual(4.5);
        expect(customPaint.legends.length).toBeGreaterThan(0);
        for (const label of customPaint.legends) {
          const a = luminance(label.ink), b = luminance(label.background);
          expect((Math.max(a, b) + .05) / (Math.min(a, b) + .05), `${label.label} remains legible on saved custom frame`).toBeGreaterThanOrEqual(4.5);
        }
        await retainSyntheticJson("synthetic-custom-frame-invariants.json", { saved, after: customAfter, paint: customPaint });
        await page.screenshot({ path: "test-results/synthetic-direct-terminal-desktop-en-custom-dark-frame-light.png" });
      }
    } finally {
      await retainSyntheticJson("synthetic-network-isolation.json", { localOrigin, blockedExternal,
        external_io_fence: "unchanged launcher loopback-only.sb; command receipt required",
        browser_zoom_200_percent: "NOT PROVED", cached_selection_latency_p95: "TARGET <100ms; NOT MEASURED" });
    }
  });
}


if (LIGHT_ACCEPTANCE) test("synthetic light chart control contrast", async ({ page, baseURL }, info) => {
  test.skip(info.project.name !== "tablet", "one discriminating local control/hover case");
  test.setTimeout(90_000);
  const origin = new URL(baseURL!).origin;
  await page.context().route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort("blockedbyclient"));
  await page.context().addCookies([{ name: "mm_e2e_rs30", value: "1", url: baseURL! }]);
  await page.addInitScript(() => { localStorage.setItem("mm.lang", "en"); Reflect.deleteProperty(window, "EventSource"); });
  await page.clock.install({ time: new Date(FIXED_NOW) });
  await installSyntheticRoutes(page);
  await page.goto("/terminal?symbol=SPY");
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 30_000 });
  await selectActualLight(page, "en", "control-contrast");
  const contrastOf = async (selector: string) => page.locator(selector).evaluate(el => {
    const c = getComputedStyle(el), rgb = (s: string) => s.match(/[\d.]+/g)!.slice(0,3).map(Number);
    const lin = (n: number) => n/255 <= .04045 ? n/255/12.92 : ((n/255+.055)/1.055)**2.4;
    const lum = (s: string) => rgb(s).reduce((a,n,i) => a+lin(n)*[.2126,.7152,.0722][i]!,0);
    const a=lum(c.color), b=lum(c.backgroundColor);
    return { foreground:c.color, background:c.backgroundColor, contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05) };
  });
  const button = page.locator(".chart-fs-float");
  await expect(button).toBeVisible();
  const ordinary = await contrastOf(".chart-fs-float"); expect(ordinary.contrast).toBeGreaterThanOrEqual(3);
  await button.tap(); await expect(page.locator(".app.fs")).toBeVisible();
  const expanded = await contrastOf(".chart-fs-float"); expect(expanded.contrast).toBeGreaterThanOrEqual(3);
  const wrap = await page.locator(".chart-wrap").first().boundingBox();
  await page.mouse.move(wrap!.x+wrap!.width*.45,wrap!.y+wrap!.height*.25);
  const hover = page.locator(".mm-hovertag"); await expect(hover).toBeVisible();
  const hoverPaint = await contrastOf(".mm-hovertag"); expect(hoverPaint.contrast).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path:"test-results/synthetic-light-tablet-controls-hover.png" });
  await button.tap(); await expect(page.locator(".app.fs")).toHaveCount(0);
  await retainSyntheticJson("synthetic-light-control-contrast.json", { ordinary,expanded,hoverPaint,compiler:"Nextdev webpack under unchanged loopback guard",typography:"fallback; not full visual acceptance" });
});


if (LIGHT_ACCEPTANCE) for (const lang of ["en", "zh"] as const) test(`synthetic light return boundary ${lang}`, async ({ page, baseURL }, info) => {
  test.setTimeout(90_000);
  const origin = new URL(baseURL!).origin;
  await page.context().route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort("blockedbyclient"));
  await page.context().addCookies([{ name: "mm_e2e_rs30", value: "1", url: baseURL! }]);
  await page.addInitScript(locale => { localStorage.setItem("mm.lang", locale); Reflect.deleteProperty(window, "EventSource"); }, lang);
  await page.clock.install({ time: new Date(FIXED_NOW) });
  await installSyntheticRoutes(page);
  // Reuse the same source-derived request through the incumbent public reader.
  // This boundary case adds no new Surface/geometry/performance claims.
  const lens = { kind: "one" as const, exp: SELECTED_EXPIRY }, shock = { spotPercent: 0, ivPoints: 0, calendarDays: 0 };
  const read = readExposureMap(envelope, "SPY", null, lens, "gamma", SESSION, Date.parse(FIXED_NOW), shock);
  const fingerprint = await exposureChartFingerprint("SPY", read, lens, "gamma", shock);
  const request = { v: 1 as const, root: "SPY", session: SESSION, strike: SELECTED_STRIKE, archived: false, metric: "gamma" as const, lens, shock, fingerprint };
  await page.goto(exposureChartHref(request)!);
  const mt = exposureMapT(lang), reference = page.getByTestId("exposure-chart-reference");
  await expect(reference).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await selectActualLight(page, lang, "return-entry-chart");
  await reference.getByRole("link", { name: mt("returnToExposure"), exact: true }).click();
  await expect(page.getByTestId("exposure-return-check")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  expect(parseExposureChartRequest(new URL(page.url()).hash)).toEqual(request);
  const themeBefore = await page.locator("html").getAttribute("data-theme");
  // A hard navigation plus deliberately unavailable synthetic auth cannot prove
  // saved-account persistence. The phone inspector is a real modal: dismiss it
  // before opening Settings, then re-open the exact strike after Light applies.
  const phoneInspector = (page.viewportSize()?.width ?? 0) <= 640;
  if (phoneInspector) {
    await page.keyboard.press("Escape");
    await expect(page.locator(".msheet-scrim")).toHaveCount(0);
  }
  await selectActualLight(page, lang, "returned-map");
  if (phoneInspector) await page.getByTestId("exposure-map").getByRole("rowheader", { name: new RegExp(`^${SELECTED_STRIKE}(?:◆)?$`) }).getByRole("button").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const map = page.getByTestId("exposure-map"), inspector = page.getByTestId("exposure-node-inspector");
  await expect(map).toHaveAttribute("data-source-session", SESSION);
  await expect(map.getByLabel(mt("scope"), { exact: true })).toHaveValue(SELECTED_EXPIRY);
  await expect(inspector).toContainText("+200M"); await expect(inspector).toContainText("400M");
  await inspector.scrollIntoViewIfNeeded();
  await page.screenshot({ path:`test-results/synthetic-light-return-${info.project.name}-${lang}.png` });
  if (info.project.name === "mobile") {
    await page.setViewportSize({ width: 320, height: 844 });
    await expect(inspector).toContainText("+200M"); await inspector.scrollIntoViewIfNeeded();
    await page.screenshot({ path:`test-results/synthetic-light-return-mobile-${lang}-320.png` });
  }
  await retainSyntheticJson("synthetic-light-return-boundary.json", { request, sameSourceFingerprint: true, themeBeforeExplicitIntent: themeBefore,
    themeAfter: await page.locator("html").getAttribute("data-theme"), viewport: page.viewportSize(),
    accountPreferencePersistence: "NOT PROVED — synthetic auth unavailable401; explicit Light reapplied via actual control",
    typography: "fallback — not full visual acceptance" });
});


if (LIGHT_ACCEPTANCE) for (const lang of ["en", "zh"] as const) test(`synthetic light surface signed ink ${lang}`, async ({ page, baseURL }, info) => {
  test.skip(info.project.name !== "mobile", "one narrow signed-value contrast check per language");
  test.setTimeout(90_000);
  const origin = new URL(baseURL!).origin;
  await page.context().route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort("blockedbyclient"));
  await page.context().addCookies([{ name: "mm_e2e_rs30", value: "1", url: baseURL! }]);
  await page.addInitScript(locale => { localStorage.setItem("mm.lang", locale); Reflect.deleteProperty(window, "EventSource"); }, lang);
  await page.clock.install({ time: new Date(FIXED_NOW) });
  await installSyntheticRoutes(page); await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/options?tab=prism&symbol=SPY&view=chart");
  const map=page.getByTestId("exposure-map"), mt=exposureMapT(lang);
  await expect(map).toHaveAttribute("data-chart-ready", "true", { timeout: 30_000 });
  await selectActualLight(page,lang,"surface-signed-ink");
  await map.getByRole("button",{name:mt("surfaceTab"),exact:true}).click();
  const surface=map.locator('section[data-surface-status="ready"]');
  const values=[];
  for(const strike of [103,98]) {
    const cell=surface.locator(`[data-surface-cell][data-strike="${strike}"][data-expiry="${SELECTED_EXPIRY}"]`);
    await cell.locator('polygon[class*="faceTop"]').tap();
    const inspector=surface.getByTestId("surface-inspector"), hero=inspector.locator("strong").first();
    await expect(inspector.locator("h3")).toContainText(`${strike} ×`);
    await expect(hero).toHaveText(strike===103?"+200M":"−60M");
    await expect(cell).toHaveAttribute("role","button");
    const paint=await hero.evaluate(el=>{
      const c=getComputedStyle(el),bg=getComputedStyle(el.closest("aside")!).backgroundColor;
      const rgb=(s:string)=>s.match(/[\d.]+/g)!.slice(0,3).map(Number),lin=(n:number)=>n/255<=.04045?n/255/12.92:((n/255+.055)/1.055)**2.4;
      const lum=(s:string)=>rgb(s).reduce((a,n,i)=>a+lin(n)*[.2126,.7152,.0722][i]!,0),a=lum(c.color),b=lum(bg);
      return{text:el.textContent,foreground:c.color,background:bg,fontSize:c.fontSize,contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
    });
    expect(paint.contrast).toBeGreaterThanOrEqual(3); values.push({strike,expiry:SELECTED_EXPIRY,metric:"gamma",mode:"net",...paint});
    await inspector.scrollIntoViewIfNeeded();
    await page.screenshot({path:`test-results/synthetic-light-signed-${lang}-${strike}-320.png`});
  }
  await retainSyntheticJson("synthetic-light-signed-ink.json",{source:SOURCE_REF,session:SESSION,values,nonColor:"explicit + and minus signs, strike/expiry/metric text and button semantics retained; prism palette unchanged",typography:"fallback — not full visual acceptance"});
});

// S8 capability probe only: the incumbent main-world fixture clock replaces
// Performance and Event timestamps. A read-only isolated world may expose the
// browser's native interaction timeline without changing the source/session clock.
if (process.env.TERMINAL_EXPOSURE_PAINT_PROBE === "1") test("synthetic cached Surface native paint cohort", async ({ page, baseURL, browser }, info) => {
  test.skip(info.project.name !== "desktop", "one bounded native-clock cohort, not a responsive benchmark");
  test.setTimeout(90_000);
  const origin = new URL(baseURL!).origin;
  await page.context().route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort("blockedbyclient"));
  await page.context().addCookies([{ name: "mm_e2e_rs30", value: "1", url: baseURL! }]);
  await page.addInitScript(() => { localStorage.setItem("mm.lang", "en"); Reflect.deleteProperty(window, "EventSource"); });
  await page.clock.install({ time: new Date(FIXED_NOW) });
  await installSyntheticRoutes(page);
  let sourceReads = 0;
  page.on("request", request => { if (new URL(request.url()).pathname === "/api/flow") sourceReads++; });
  await page.goto("/options?tab=prism&symbol=SPY&view=chart");
  const map = page.getByTestId("exposure-map"), mt = exposureMapT("en");
  await expect(map).toHaveAttribute("data-chart-ready", "true", { timeout: 30_000 });
  await map.getByRole("button", { name: mt("surfaceTab"), exact: true }).click();
  const surface = map.locator('section[data-surface-status="ready"]');
  await expect(surface).toHaveAttribute("data-surface-mode", "net");
  await expect(surface.locator("[data-surface-cell]")).toHaveCount(4);
  const mainClock = await page.evaluate(() => { performance.mark("s8-main-start"); performance.mark("s8-main-end"); return { measure: performance.measure("s8-main", "s8-main-start", "s8-main-end").duration, entryTypes: PerformanceObserver.supportedEntryTypes }; });
  const session = await page.context().newCDPSession(page);
  const tree = await session.send("Page.getFrameTree");
  const world = await session.send("Page.createIsolatedWorld", { frameId: tree.frameTree.frame.id, worldName: "s8-read-only-native-observer" });
  const evaluate = async <T,>(expression: string): Promise<T> => {
    const result = await session.send("Runtime.evaluate", { expression, contextId: world.executionContextId, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value as T;
  };
  const capability = await evaluate<Record<string, unknown>>(`(() => {
    const state = { inputs: [], matches: [], entries: [], sample: -1 }; globalThis.__s8 = state;
    const inspect = () => { const el=document.querySelector('[data-testid="surface-inspector"]'); return { heading:el?.querySelector('h3')?.textContent, value:el?.querySelector('strong')?.textContent, text:el?.textContent }; };
    for (const type of ['pointerdown','click','keydown']) document.addEventListener(type, event => {
      const cell=event.target.closest?.('[data-surface-cell]'); if(!cell)return;
      state.inputs.push({ sample:state.sample, type, now:performance.now(), timeStamp:event.timeStamp, strike:cell.dataset.strike, expiry:cell.dataset.expiry, trusted:event.isTrusted });
    }, true);
    const observer = new MutationObserver(() => state.matches.push({ sample:state.sample, now:performance.now(), ...inspect() }));
    observer.observe(document.querySelector('[data-testid="surface-inspector"]'), { subtree:true, childList:true, characterData:true });
    if (PerformanceObserver.supportedEntryTypes.includes('event')) {
      const events=new PerformanceObserver(list => { for(const entry of list.getEntries()) state.entries.push({name:entry.name,startTime:entry.startTime,duration:entry.duration,processingStart:entry.processingStart,processingEnd:entry.processingEnd,interactionId:entry.interactionId,deliveredAt:performance.now(),inspectorAtDelivery:inspect(),targetStrike:entry.target?.closest?.('[data-surface-cell]')?.dataset.strike,targetExpiry:entry.target?.closest?.('[data-surface-cell]')?.dataset.expiry}); });
      events.observe({type:'event',buffered:true,durationThreshold:16});
    }
    performance.mark('s8-native-start');
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => { performance.mark('s8-native-end'); const measure=performance.measure('s8-native','s8-native-start','s8-native-end'); resolve({nativeMeasure:measure.duration, supportedEntryTypes:PerformanceObserver.supportedEntryTypes, userAgent:navigator.userAgent, hardwareConcurrency:navigator.hardwareConcurrency, deviceMemory:navigator.deviceMemory, timeOrigin:performance.timeOrigin}); })));
  })()`);
  const readsBefore = sourceReads;
  for (let sample = 0; sample < 60; sample++) {
    const strike = sample % 2 === 0 ? 98 : 103;
    await evaluate(`globalThis.__s8.sample = ${sample}`);
    const cell = surface.locator(`[data-surface-cell][data-strike="${strike}"][data-expiry="${SELECTED_EXPIRY}"]`);
    await cell.locator('polygon[class*="faceTop"]').click();
    await expect(surface.getByTestId("surface-inspector").locator("h3")).toContainText(`${strike} × OCT 30`);
    await expect(surface.getByTestId("surface-inspector").locator("strong").first()).toHaveText(strike === 103 ? "+200M" : "−60M");
    // Drain native EventTiming between inputs. This is not a timing endpoint;
    // the entry itself owns presentation timing, and absent entries stay absent.
    await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 100))))");
  }
  // Screenshot completion proves the final matching frame exists, separately
  // from whether native EventTiming can bind every intermediate presentation.
  await surface.getByTestId("surface-inspector").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/synthetic-s8-final-matching-inspector.png" });
  const observation = await evaluate<Record<string, unknown>>("({ ...globalThis.__s8, screenshotCompletedAt:performance.now() })");
  expect(sourceReads).toBe(readsBefore);
  await expect(map).toHaveAttribute("data-source-root", "SPY");
  await expect(map).toHaveAttribute("data-source-session", SESSION);
  await retainSyntheticJson("synthetic-s8-native-paint-cohort.json", { sourceCommit: "d9a4cda46f25904ef2a7fb30058b8f170686f584 plus probe only", compiler: "Nextdev webpack; fallback fonts; isolated synthetic loopback", browser: browser.version(), viewport: page.viewportSize(), source: SOURCE_REF, sourceSha256:createHash("sha256").update(JSON.stringify(envelope)).digest("hex"), sourceSize:4, session:SESSION, expiry:SELECTED_EXPIRY, metric:"gamma", mode:"net", sourceReadsBefore:readsBefore, sourceReadsAfter:sourceReads, returnToCell:103, mainClock, capability, observation, cohort:60, quantization:"Native EventTiming duration rounded to 8ms; threshold16ms; retain all inputs, including absent entries", result:"RAW COHORT — adjudicate matching DOM before presentation, missing entries and rounding; no production equivalence" });
  await session.detach();
});

if (LIGHT_ACCEPTANCE) for (const lang of ["en", "zh"] as const) test(`synthetic light Map signed text ${lang}`, async ({ page, baseURL }, info) => {
  test.skip(info.project.name !== "desktop", "one focused ENZH text-contrast check; responsive journey evidence reused");
  test.setTimeout(90_000);
  const origin = new URL(baseURL!).origin;
  await page.context().route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort("blockedbyclient"));
  await page.context().addCookies([{ name: "mm_e2e_rs30", value: "1", url: baseURL! }]);
  await page.addInitScript(locale => { localStorage.setItem("mm.lang", locale); Reflect.deleteProperty(window, "EventSource"); }, lang);
  await page.clock.install({ time: new Date(FIXED_NOW) });
  await installSyntheticRoutes(page);
  await page.goto("/options?tab=prism&symbol=SPY&view=chart");
  const map=page.getByTestId("exposure-map"), mt=exposureMapT(lang);
  await expect(map).toHaveAttribute("data-chart-ready", "true", {timeout:30_000});
  await selectActualLight(page,lang,"map-small-signed-text");
  await map.getByLabel(mt("scope"),{exact:true}).selectOption(SELECTED_EXPIRY);
  const inspector=map.getByTestId("exposure-node-inspector");
  const signed=inspector.locator('b[data-sign]'); await expect(signed).toHaveCount(2);
  await expect(signed).toContainText(["+200M", "-60M"]);
  const momentum=map.getByTestId("exposure-divergence").locator('strong[data-sign]');
  await expect(momentum.first()).toBeVisible();
  const paint = async (selector: string) => map.locator(selector).evaluateAll(elements=>elements.map(el=>{
    const rgb=(s:string)=>s.match(/[\d.]+/g)!.slice(0,3).map(Number),lin=(n:number)=>n/255<=.04045?n/255/12.92:((n/255+.055)/1.055)**2.4;
    const lum=(s:string)=>rgb(s).reduce((a,n,i)=>a+lin(n)*[.2126,.7152,.0722][i]!,0);
    let parent:Element|null=el,bg="";
    while(parent){const c=getComputedStyle(parent).backgroundColor;if(c!=="rgba(0, 0, 0, 0)"&&c!=="transparent"){bg=c;break;}parent=parent.parentElement;}
    const css=getComputedStyle(el),a=lum(css.color),b=lum(bg);
    return{text:el.textContent,sign:el.getAttribute("data-sign"),foreground:css.color,background:bg,fontSize:css.fontSize,contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
  }));
  const values=await paint('[data-testid="exposure-node-inspector"] b[data-sign]');
  const bias=await paint('[data-testid="exposure-divergence"] strong[data-sign]');
  const kpi=await paint('[class*="leaders"] strong[data-sign]');expect(kpi).toHaveLength(1);
  await inspector.scrollIntoViewIfNeeded();
  await page.screenshot({path:`test-results/synthetic-light-map-signed-${lang}.png`});
  await retainSyntheticJson("synthetic-light-map-signed-text.json", {source:SOURCE_REF,session:SESSION,expiry:SELECTED_EXPIRY,metric:"gamma",values,kpi,momentum:bias,nonColor:"explicit signed numbers and unchanged bullish/bearish words; exposure face/swatch palette unchanged",typography:"fallback; no full typography/production acceptance"});
  await map.locator('[class*="leaders"]').screenshot({path:`test-results/synthetic-light-topnet-${lang}.png`});
  for(const row of [...values,...bias,...kpi]) expect(row.contrast,`${row.text}: ${row.foreground} on ${row.background}`).toBeGreaterThanOrEqual(4.5);
});

const ACCESS_ACCEPTANCE = process.env.TERMINAL_EXPOSURE_ACCESS_ACCEPTANCE === "1";
async function prepareAccessFixture(page: Page, baseURL: string, lang: "en" | "zh", entryRoute = "/options?tab=prism&symbol=SPY&view=chart") {
  const origin = new URL(baseURL).origin;
  await page.context().route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort("blockedbyclient"));
  await page.context().addCookies([{ name:"mm_e2e_rs30", value:"1", url:baseURL }]);
  await page.addInitScript(locale => { localStorage.setItem("mm.lang",locale);Reflect.deleteProperty(window,"EventSource"); },lang);
  await page.clock.install({time:new Date(FIXED_NOW)});
  await installSyntheticRoutes(page);
  await page.goto(entryRoute);
  await expect(page.getByTestId("exposure-map")).toHaveAttribute("data-chart-ready","true",{timeout:30_000});
}
async function tabToActual(page: Page, target: Locator) {
  for(let n=0;n<160;n++) {
    if(await target.evaluate(el=>el===document.activeElement))return n;
    await page.keyboard.press("Tab");
  }
  throw new Error("Target not reached in160 actual Tab presses");
}
async function actualFocusPaint(target: Locator) {
  return target.evaluate(el=>{
    const css=getComputedStyle(el),face=el.querySelector("polygon"),b=el.getBoundingClientRect();
    return {active:document.activeElement===el,focusVisible:el.matches(":focus-visible"),tag:el.tagName,text:el.textContent?.slice(0,180),label:el.getAttribute("aria-label"),outline:css.outlineStyle,outlineWidth:css.outlineWidth,outlineColor:css.outlineColor,faceStroke:face?getComputedStyle(face).stroke:null,faceStrokeWidth:face?getComputedStyle(face).strokeWidth:null,bounds:{x:b.x,y:b.y,width:b.width,height:b.height}};
  });
}

async function expectSelectedHeadingExposed(page: Page, inspector: Locator, stage: string) {
  const paint=await inspector.locator("h3").evaluate(el=>{
    const b=el.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2,hit=document.elementFromPoint(x,y);
    const obstacles=[...document.querySelectorAll<HTMLElement>("body *")].flatMap(node=>{
      const css=getComputedStyle(node);if((css.position!=="fixed"&&css.position!=="sticky")||css.pointerEvents==="none"||node.contains(el)||!node.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}))return[];
      const r=node.getBoundingClientRect();return r.width>0&&r.height>0&&r.left<=x&&r.right>=x&&r.top>=0&&r.top<=b.bottom?[{tag:node.tagName,className:node.className,top:r.top,bottom:r.bottom}]:[];
    });
    return{text:el.textContent,top:b.top,bottom:b.bottom,left:b.left,right:b.right,viewportHeight:innerHeight,hitIsHeading:hit===el||!!hit&&el.contains(hit),hit:hit?{tag:hit.tagName,className:hit.getAttribute("class")}:null,topObstacles:obstacles,obstacleBottom:Math.max(0,...obstacles.map(r=>r.bottom))};
  });
  await retainSyntheticJson(`synthetic-s9-heading-${stage}.json`,paint);
  expect(paint.top,"selected heading clears actual sticky/fixed chrome bounds").toBeGreaterThanOrEqual(paint.obstacleBottom);
  expect(paint.bottom).toBeLessThanOrEqual(paint.viewportHeight);
  expect(paint.hitIsHeading,"selected identity is actually hit-visible").toBe(true);
}

if(ACCESS_ACCEPTANCE)test("synthetic S9 native resize capability",async({page,baseURL},info)=>{
  test.skip(info.project.name!=="desktop","one same-browser capability observation");test.setTimeout(90_000);
  await prepareAccessFixture(page,baseURL!,"en");
  const session=await page.context().newCDPSession(page);
  const read=async()=>({metrics:await session.send("Page.getLayoutMetrics"),text:await page.getByTestId("exposure-map").locator("h2").evaluate(el=>{
    const r=document.createRange();r.selectNodeContents(el);const b=r.getBoundingClientRect(),s=getComputedStyle(el);
    return{fontSize:s.fontSize,lineHeight:s.lineHeight,width:b.width,height:b.height,innerWidth,outerWidth,dpr:devicePixelRatio,visualScale:visualViewport?.scale,rootZoom:getComputedStyle(document.documentElement).zoom,transform:s.transform,scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth};
  })});
  const before=await read();
  for(let n=0;n<5;n++)await page.keyboard.press("Meta+Equal");
  const shortcut=await read();
  await page.keyboard.press("Meta+Digit0");
  await session.send("Emulation.setEmulatedOSTextScale",{scale:2});
  const osText=await read();
  await page.screenshot({path:"test-results/synthetic-s9-os-text-scale2.png"});
  await retainSyntheticJson("synthetic-s9-resize-capability.json",{before,shortcut,osText,measuredTextHeightRatio:osText.text.height/before.text.height,measuredTextWidthRatio:osText.text.width/before.text.width,mechanism:"Installed native CDP Emulation.setEmulatedOSTextScale(scale2), not CSSzoom/DPR/pinch",qualification:"Only actual200% glyph enlargement would qualify controlled OS-text emulation. Browserzoom remains separate; command success alone proves neither.",compiler:"NextdevWebpack/fallback fonts/same loopback guard"});
  await session.detach();
});

if(ACCESS_ACCEPTANCE)for(const lang of ["en","zh"]as const)for(const theme of ["dark","light"]as const)test(`synthetic S9 keyboard return ${lang} ${theme}`,async({page,baseURL},info)=>{
  test.skip(info.project.name!=="desktop","representative keyboard path; accepted responsive captures reused");test.setTimeout(90_000);
  await prepareAccessFixture(page,baseURL!,lang);
  if(theme==="light")await selectActualLight(page,lang,"s9-entry");
  const mt=exposureMapT(lang),st=exposureSurfaceT(lang),map=page.getByTestId("exposure-map");
  const surfaceTab=map.getByRole("button",{name:mt("surfaceTab"),exact:true});
  await tabToActual(page,surfaceTab);await page.keyboard.press("Enter");
  const surface=map.locator('section[data-surface-status="ready"]');
  const negative=surface.locator(`[data-surface-cell][data-strike="98"][data-expiry="${SELECTED_EXPIRY}"]`);
  await tabToActual(page,negative);await page.keyboard.press("Enter");
  await expect(surface.getByTestId("surface-inspector").locator("strong").first()).toHaveText("−60M");
  await page.keyboard.press("Space");
  await page.keyboard.press("Shift+Tab");await page.keyboard.press("Tab");await expect(negative).toBeFocused();
  const negativeFocus=await actualFocusPaint(negative);expect(negativeFocus.focusVisible).toBe(true);expect(Number.parseFloat(negativeFocus.faceStrokeWidth!)).toBeGreaterThanOrEqual(2);
  const selected=surface.locator(`[data-surface-cell][data-strike="103"][data-expiry="${SELECTED_EXPIRY}"]`);
  await tabToActual(page,selected);await page.keyboard.press("Enter");
  await expect(surface.getByTestId("surface-inspector").locator("strong").first()).toHaveText("+200M");
  const selectedFocus=await actualFocusPaint(selected);
  await page.screenshot({path:`test-results/synthetic-s9-keyboard-cell-${lang}-${theme}.png`});
  const pin=surface.getByRole("button",{name:st("pinCell",{cell:`103 × ${shortCellDate(lang,SELECTED_EXPIRY)}`}),exact:true});
  await tabToActual(page,pin);await page.keyboard.press("Enter");
  const inspector=page.getByTestId("exposure-node-inspector");
  await expect(map.getByLabel(mt("scope"),{exact:true})).toHaveValue(SELECTED_EXPIRY);await expect(inspector).toContainText("+200M");
  const open=inspector.getByRole("button",{name:mt("openOnMainChart"),exact:true});
  await tabToActual(page,open);await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/terminal\?.*#exposure=/);
  const request=parseExposureChartRequest(new URL(page.url()).hash);
  expect(request).toMatchObject({root:"SPY",session:SESSION,strike:103,metric:"gamma",lens:{kind:"one",exp:SELECTED_EXPIRY}});
  const reference=page.getByTestId("exposure-chart-reference");await expect(reference).toHaveAttribute("data-state","ready",{timeout:30_000});
  if(theme==="light")await selectActualLight(page,lang,"s9-mainchart");
  const back=reference.getByRole("link",{name:mt("returnToExposure"),exact:true});await tabToActual(page,back);
  const backFocus=await actualFocusPaint(back);expect(backFocus.focusVisible).toBe(true);expect(Number.parseFloat(backFocus.outlineWidth)).toBeGreaterThanOrEqual(2);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("exposure-return-check")).toHaveAttribute("data-state","ready",{timeout:30_000});
  await expect(inspector).toContainText("+200M");expect(parseExposureChartRequest(new URL(page.url()).hash)).toEqual(request);
  const restoredFocus=await actualFocusPaint(inspector.locator("h3"));
  await retainSyntheticJson("synthetic-s9-keyboard-return.json",{lang,theme,request,negativeFocus,selectedFocus,backFocus,restoredFocus,themeAfterHardReturn:await page.locator("html").getAttribute("data-theme"),accountPersistence:"Unproved under synthetic401; no theme persistence claim"});
  await page.screenshot({path:`test-results/synthetic-s9-keyboard-return-${lang}-${theme}.png`});
  await expectSelectedHeadingExposed(page,inspector,"return");
  expect(restoredFocus.active,"validated return must focus matching inspector heading, not body").toBe(true);
  expect(restoredFocus.focusVisible).toBe(true);
  await page.keyboard.press("Escape");
  const row=map.getByRole("rowheader",{name:/^103(?:◆)?$/}).getByRole("button");await expect(row).toBeFocused();
  if(theme==="light") {
    // Synthetic auth cannot hydrate a saved theme across this hard navigation.
    // Apply explicit Light intent via the real control, then reach the exact row
    // again through real Tab/Enter; do not force focus or claim persistence.
    await selectActualLight(page,lang,"s9-return-explicit-light");
    await tabToActual(page,row);
  }
  await page.keyboard.press("Enter");await expect(inspector.locator("h3")).toBeFocused();
  await expectSelectedHeadingExposed(page,inspector,"final");
  const finalFocus=await actualFocusPaint(inspector.locator("h3"));expect(finalFocus.focusVisible).toBe(true);
  expect(Number.parseFloat(finalFocus.outlineWidth)).toBeGreaterThanOrEqual(2);
  await expect(page.locator("html")).toHaveAttribute("data-theme",theme);
  await page.screenshot({path:`test-results/synthetic-s9-keyboard-final-${lang}-${theme}.png`});
  await retainSyntheticJson("synthetic-s9-keyboard-final.json",{lang,theme,request,finalFocus,actualKeys:["Tab","Shift+Tab","Enter","Space","Escape"],selectedRowRecoveredOnEscape:true,sourceSession:await map.getAttribute("data-source-session"),scope:await map.getByLabel(mt("scope"),{exact:true}).inputValue(),metric:await map.getByRole("group",{name:mt("metric"),exact:true}).locator('[aria-pressed="true"]').textContent(),themeAfterExplicitIntent:await page.locator("html").getAttribute("data-theme"),accountPersistence:"Unproved under synthetic401"});
});

if(ACCESS_ACCEPTANCE)test("synthetic S9 builtin appearance zoom capability",async({page,baseURL,browser},info)=>{
  test.skip(info.project.name!=="desktop","one built-in UI capability attempt through existing isolated launcher");test.setTimeout(90_000);
  await prepareAccessFixture(page,baseURL!,"en");
  const session=await page.context().newCDPSession(page);
  const measure=async()=>({metrics:await session.send("Page.getLayoutMetrics"),glyph:await page.getByTestId("exposure-map").locator("h2").evaluate(el=>{
    const r=document.createRange();r.selectNodeContents(el);const b=r.getBoundingClientRect();return{fontSize:getComputedStyle(el).fontSize,x:b.x,y:b.y,height:b.height,width:b.width,innerWidth,outerWidth,dpr:devicePixelRatio};
  })});
  const before=await measure();
  const beforePng=await page.screenshot({path:"test-results/synthetic-s9-builtin-zoom-before.png"});
  const beforeRaster={width:beforePng.readUInt32BE(16),height:beforePng.readUInt32BE(20)};
  let rasterWitness:Record<string,unknown>|null=null;
  let originalLabel:string|null=null,changed=false,restored=false,gap:string|null=null,after:Awaited<ReturnType<typeof measure>>|null=null;
  const blocked:string[]=[];page.on("requestfailed",request=>{if(new URL(request.url()).origin!==new URL(baseURL!).origin)blocked.push(`${new URL(request.url()).protocol} ${request.failure()?.errorText}`);});
  const control=()=>page.locator("select").filter({has:page.locator("option").filter({hasText:/^200%$/})});
  try{
    try{await page.goto("chrome://settings/appearance");}catch(error){gap=`Built-in appearance navigation unavailable: ${String(error)}`;}
    if(!gap){
      await expect(page.locator("settings-ui")).toBeVisible({timeout:5_000});
      const zoom=control();
      if(await zoom.count()!==1||!await zoom.isVisible())gap="No single visible built-in Page zoom select with a200% option in this isolated context";
      else{
        originalLabel=(await zoom.locator("option:checked").textContent())?.trim()??null;
        if(!originalLabel)gap="Built-in Page zoom original selection could not be read; no setting changed";
        else{
          await zoom.selectOption({label:"200%"});changed=true;
          await expect(zoom.locator("option:checked")).toHaveText("200%");
          await page.goto("/options?tab=prism&symbol=SPY&view=chart");
          await expect(page.getByTestId("exposure-map")).toHaveAttribute("data-chart-ready","true",{timeout:30_000});
          after=await measure();
          const afterPng=await page.screenshot({path:"test-results/synthetic-s9-builtin-zoom200-fixture.png"});
          const afterRaster={width:afterPng.readUInt32BE(16),height:afterPng.readUInt32BE(20)};
          const beforeTextRangePx=before.glyph.height*beforeRaster.width/before.metrics.cssVisualViewport.clientWidth;
          const afterTextRangePx=after.glyph.height*afterRaster.width/after.metrics.cssVisualViewport.clientWidth;
          const viewportRatio=before.metrics.cssVisualViewport.clientWidth/after.metrics.cssVisualViewport.clientWidth;
          const rasterTextRatio=afterTextRangePx/beforeTextRangePx;
          const fixedPhysicalRaster=beforeRaster.width===afterRaster.width&&beforeRaster.height===afterRaster.height;
          const qualified200=Math.abs((after.metrics.cssVisualViewport.zoom??0)-2)<.01&&Math.abs(viewportRatio-2)<.05&&Math.abs(rasterTextRatio-2)<.05&&fixedPhysicalRaster;
          rasterWitness={beforeRaster,afterRaster,beforeTextRangePx,afterTextRangePx,viewportRatio,rasterTextRatio,fixedPhysicalRaster,qualified200,note:"CSS font-size/range may remain CSSpx; native UIzoom + actual raster-space text and CSS viewport at fixed physical dimensions jointly establish the effect. DPR alone is never used as zoom proof."};
          if(!qualified200)gap="Built-in200% selected, but the fixed-physical-window nativezoom/text/reflow witness did not jointly establish effective200%";
        }
      }
    }
    if(gap){await page.screenshot({path:"test-results/synthetic-s9-builtin-zoom-gap.png"});}
  }finally{
    if(changed&&originalLabel){
      await page.goto("chrome://settings/appearance");await control().selectOption({label:originalLabel});
      await expect(control().locator("option:checked")).toHaveText(originalLabel);restored=true;
    }
    await retainSyntheticJson("synthetic-s9-builtin-zoom-capability.json",{before,after,beforeRaster,rasterWitness,originalLabel,changed,restored,gap,blocked,browserVersion:browser.version(),browserFlavor:process.env.TERMINAL_EXPOSURE_BROWSER_FLAVOR??"incumbent default headless-shell",mechanism:"Actual built-in appearance Page zoom control only; same installed browser/launcher/context guard. No private API/preferences file/CSS/DPR/pinch substitute.",scope:"Only native zoom plus actual fixture glyph/layout enlargement would qualify200%. No setting change if UI unavailable."});
    if (!page.isClosed()) await session.detach();
  }
});

if(ACCESS_ACCEPTANCE)test("synthetic S9 phone inspector keyboard trap",async({page,baseURL},info)=>{
  test.skip(info.project.name!=="mobile","one affected390 ENLight MobileSheet smoke");test.setTimeout(90_000);
  // Source-qualified exact-expiry route: native select-key behavior is OUT OF
  // SCOPE. This uses the same public reader/digest as the chart-return contract.
  const lens={kind:"one" as const,exp:SELECTED_EXPIRY},shock={spotPercent:0,ivPoints:0,calendarDays:0};
  const read=readExposureMap(envelope,"SPY",null,lens,"gamma",SESSION,Date.parse(FIXED_NOW),shock);
  const request={v:1 as const,root:"SPY",session:SESSION,strike:103,archived:false,metric:"gamma" as const,lens,shock,fingerprint:await exposureChartFingerprint("SPY",read,lens,"gamma",shock)};
  await prepareAccessFixture(page,baseURL!,"en",exposureMapHref(request)!);
  const map=page.getByTestId("exposure-map"),mt=exposureMapT("en"),scope=map.getByLabel(mt("scope"),{exact:true});
  await expect(page.getByTestId("exposure-return-check")).toHaveAttribute("data-state","ready",{timeout:30_000});
  await expect(scope).toHaveValue(SELECTED_EXPIRY);
  const row=map.getByRole("rowheader",{name:/^103(?:◆)?$/}).getByRole("button");
  const sheet=page.locator(".msheet"),heading=page.getByTestId("exposure-node-inspector").locator("h3");
  await expect(sheet).toBeVisible();await expect(heading).toBeFocused();
  await page.keyboard.press("Escape");await expect(sheet).toHaveCount(0);await expect(row).toBeFocused();
  await selectActualLight(page,"en","s9-phone-entry");
  await tabToActual(page,row);await page.keyboard.press("Enter");
  await expect(sheet).toBeVisible();await expect(heading).toBeFocused();
  await expect(heading).toContainText("103");await expect(page.getByTestId("exposure-node-inspector")).toContainText("+200M");
  const focus=await actualFocusPaint(heading);expect(focus.focusVisible).toBe(true);expect(Number.parseFloat(focus.outlineWidth)).toBeGreaterThanOrEqual(2);
  const visibility=await heading.evaluate(el=>{const r=el.getBoundingClientRect(),h=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{top:r.top,bottom:r.bottom,viewportHeight:innerHeight,hit:h===el||!!h&&el.contains(h)};});
  expect(visibility.top).toBeGreaterThanOrEqual(0);expect(visibility.bottom).toBeLessThanOrEqual(visibility.viewportHeight);expect(visibility.hit).toBe(true);
  const confined=[];
  for(const key of ["Tab","Tab","Shift+Tab","Shift+Tab","Shift+Tab","Tab"]){
    await page.keyboard.press(key);const active=await sheet.evaluate(el=>({inside:!!document.activeElement&&el.contains(document.activeElement),tag:document.activeElement?.tagName,text:document.activeElement?.textContent?.slice(0,80)}));expect(active.inside).toBe(true);confined.push({key,...active});
  }
  await page.screenshot({path:"test-results/synthetic-s9-phone-trap-en-light390.png"});
  await page.keyboard.press("Escape");await expect(sheet).toHaveCount(0);await expect(row).toBeFocused();
  const rowFocus=await actualFocusPaint(row);expect(rowFocus.focusVisible).toBe(true);
  await retainSyntheticJson("synthetic-s9-phone-trap.json",{source:SOURCE_REF,session:SESSION,expiry:SELECTED_EXPIRY,metric:"gamma",strike:103,nativeExpiryKeyboard:"OUT OF SCOPE — source-qualified exact-expiry route",request,theme:await page.locator("html").getAttribute("data-theme"),focus,visibility,confined,rowFocus});
});

// A separate cold-navigation contract. The original journey deliberately applies
// Light on each leg; that does not establish persistence across a document load.
// This fixture has no live account service: it qualifies the incumbent local
// preference/identity consumer, never real-account or production persistence.
for (const lang of ["en", "zh"] as const) {
  test(`synthetic exposure saved theme cold return ${lang}`, async ({ page, baseURL }, info) => {
    test.setTimeout(90_000);
    const origin = new URL(baseURL!).origin;
    const outside: string[] = [];
    await page.context().route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin === origin) return route.continue();
      outside.push(`${url.origin}${url.pathname}`);
      return route.abort("blockedbyclient");
    });
    // Reuse options-shortlist-plan's opaque LOCAL session-cookie pattern and
    // the canonical fixture principal. Only this Node-owned auth fixture keeps
    // the acknowledged metadata between documents; no live account is used.
    const user = { id: fixtureUserId("default"), aud: "authenticated", role: "authenticated",
      email: "responsive@example.com", app_metadata: {}, created_at: "2026-10-19T00:00:00Z",
      user_metadata: { theme: "dark", theme_auto: "0", lang,
        prefs: { theme: "dark", themeAuto: "0", lang } } as Record<string, unknown> };
    const session = { access_token: "local-exposure-theme-fixture-only",
      refresh_token: "local-exposure-theme-fixture-only", token_type: "bearer",
      expires_in: 86_400, expires_at: Math.floor(Date.now() / 1000) + 86_400, user };
    await page.context().addCookies([
      { name: "mm_e2e_rs30", value: "1", url: baseURL! },
      { name: "sb-127-auth-token.0", value: "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url"), url: baseURL! },
    ]);
    // Opposite to the saved explicit Light choice: auto-mode fallback must not
    // make a lost preference appear to survive a cold document load.
    await page.emulateMedia({ colorScheme: "dark" });
    await page.clock.install({ time: new Date(FIXED_NOW) });
    await page.addInitScript(locale => {
      // Locale is part of the declared fixture. Theme is NEVER seeded here,
      // including after reload: only the reader's Settings action selects it.
      (window as unknown as { exposureColdDocumentId: string }).exposureColdDocumentId = crypto.randomUUID();
      localStorage.setItem("mm.lang", locale);
      Reflect.deleteProperty(window, "EventSource");
    }, lang);
    expectFixtureInvariants();
    await installSyntheticRoutes(page);
    let authReads = 0;
    const acknowledged: Record<string, unknown>[] = [];
    // Reuse the existing options-shortlist-plan in-memory SDK transport seam.
    // CSP correctly refuses a real loopback auth connection. This binding never
    // requests that connection and changes no policy, cookie guard or app code.
    await page.exposeBinding("exposureLocalAccountFixture", async (_source, method: string, body: string | null) => {
      if (method === "GET") authReads++;
      else if (method === "PUT") {
        const patch = JSON.parse(body || "{}").data as Record<string, unknown>;
        expect(Object.keys(patch).every(key => ["theme", "theme_auto", "lang", "prefs"].includes(key))).toBe(true);
        user.user_metadata = { ...user.user_metadata, ...patch };
        acknowledged.push(patch);
      } else throw new Error("Unexpected in-memory preference fixture operation");
      return user;
    });
    await page.addInitScript(() => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : input instanceof Request ? input.url : input.toString(), location.href);
        if (url.pathname.startsWith("/auth/v1/")) {
          if (url.origin !== "http://127.0.0.1:54321" || url.pathname !== "/auth/v1/user") throw new Error("Unexpected fixture Auth operation");
          const request = input instanceof Request ? input : null;
          const method = init?.method ?? request?.method ?? "GET";
          const body = typeof init?.body === "string" ? init.body : request ? await request.clone().text() : null;
          const fixture = window as unknown as { exposureLocalAccountFixture: (method: string, body: string | null) => Promise<unknown> };
          return new Response(JSON.stringify(await fixture.exposureLocalAccountFixture(method, body)), { headers: { "content-type": "application/json" } });
        }
        return originalFetch(input, init);
      };
    });
    const mt = exposureMapT(lang);
    const map = page.getByTestId("exposure-map");
    const inspector = page.getByTestId("exposure-node-inspector");
    const witness: Record<string, unknown>[] = [];
    const record = async (stage: string) => {
      const observed = await page.evaluate(() => ({
        theme: document.documentElement.dataset.theme,
        bodyBackground: getComputedStyle(document.body).backgroundColor,
        osPrefersDark: matchMedia("(prefers-color-scheme: dark)").matches,
        appearanceOwner: document.documentElement.dataset.terminalAppearance ?? null,
        documentId: (window as unknown as { exposureColdDocumentId: string }).exposureColdDocumentId,
      }));
      witness.push({ stage, ...observed });
      return observed;
    };
    const expectLight = async (stage: string) => {
      await expect(page.locator("html"), `saved Light intent survives ${stage}`)
        .toHaveAttribute("data-theme", "light");
      const observed = await record(stage);
      expect(observed.osPrefersDark, `explicit Light is independent of dark OS at ${stage}`).toBe(true);
      const rgb = observed.bodyBackground.match(/\d+/g)?.slice(0, 3).map(Number) ?? [];
      expect(rgb, `computed body background at ${stage}`).toHaveLength(3);
      expect(Math.min(...rgb), `Light body background at ${stage}`).toBeGreaterThan(200);
    };
    try {
      await page.goto("/options?tab=prism&symbol=SPY&view=chart");
      await expect(map).toHaveAttribute("data-source-session", SESSION);
      await expect(map).toHaveAttribute("data-chart-ready", "true", { timeout: 30_000 });
      await expect.poll(() => authReads, { message: "canonical fixture account actually loaded" }).toBeGreaterThan(0);
      await selectActualLight(page, lang, "s14-first-intent");
      await expect.poll(() => user.user_metadata.theme, { message: "Settings preference write acknowledged by local fixture" }).toBe("light");
      expect(user.user_metadata.theme_auto, "explicit Settings choice is acknowledged, not auto mode").toBe("0");
      await expectLight("initial Settings choice");
      await map.getByLabel(mt("scope"), { exact: true }).selectOption(SELECTED_EXPIRY);
      const leader = map.getByRole("button", {
        name: lang === "en" ? /Largest covered net node/ : /覆盖范围最大净节点/,
      });
      await expect(leader.locator("strong")).toContainText(String(SELECTED_STRIKE));
      await leader.click();
      await expect(inspector).toContainText("+200M");
      await inspector.getByRole("button", { name: mt("openOnMainChart"), exact: true }).click();
      await expect(page).toHaveURL(/\/terminal\?symbol=SPY#exposure=/);
      const request = parseExposureChartRequest(new URL(page.url()).hash);
      expect(request).toMatchObject({ root: "SPY", session: SESSION, strike: SELECTED_STRIKE,
        metric: "gamma", lens: { kind: "one", exp: SELECTED_EXPIRY } });
      const reference = page.getByTestId("exposure-chart-reference");
      await expect(reference).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
      await expectLight("main-chart handoff without another Settings action");
      const beforeMainReload = await record("before main reload");
      const beforeMainReads = authReads;
      const mainResponse = await page.reload();
      expect(mainResponse?.request().isNavigationRequest()).toBe(true);
      expect(mainResponse?.request().resourceType()).toBe("document");
      await expect.poll(() => authReads).toBeGreaterThan(beforeMainReads);
      await expect(reference).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
      expect(parseExposureChartRequest(new URL(page.url()).hash)).toEqual(request);
      await expectLight("main-chart document reload");
      expect((await record("reload witness")).documentId).not.toBe(beforeMainReload.documentId);
      await page.screenshot({ path: info.outputPath("saved-theme-main-reloaded.png") });
      await reference.getByRole("link", { name: mt("returnToExposure"), exact: true }).click();
      await expect(page.getByTestId("exposure-return-check")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
      await expect(map).toHaveAttribute("data-source-session", SESSION);
      await expect(map.getByLabel(mt("scope"), { exact: true })).toHaveValue(SELECTED_EXPIRY);
      await expect(inspector).toContainText("+200M");
      await expect(inspector).not.toContainText("+300M");
      await expectLight("exact investigation return");
      const beforeReturnReload = await record("before return reload");
      const beforeReturnReads = authReads;
      const returnResponse = await page.reload();
      expect(returnResponse?.request().isNavigationRequest()).toBe(true);
      expect(returnResponse?.request().resourceType()).toBe("document");
      await expect.poll(() => authReads).toBeGreaterThan(beforeReturnReads);
      await expect(page.getByTestId("exposure-return-check")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
      await expectLight("returned investigation document reload");
      expect((await record("return reload witness")).documentId).not.toBe(beforeReturnReload.documentId);
      await page.screenshot({ path: info.outputPath("saved-theme-return-reloaded.png") });
      // The explicit Dark control must remain usable after the retained Light
      // choice; neither this test nor the application rewrites custom settings.
      if (info.project.name === "mobile") {
        await inspector.getByRole("button", { name: mt("close"), exact: true }).click();
        await expect(page.locator(".msheet-scrim")).toHaveCount(0);
      }
      await selectActualLight(page, lang, "s14-dark-control", "dark");
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    } finally {
      await retainSyntheticJson("saved-theme-cold-return.json", {
        classification: "SYNTHETIC LOCAL — no live account or production claim",
        source: SOURCE_REF, session: SESSION, expiry: SELECTED_EXPIRY,
        sourceVersion: "existing coherent four-cell fixture", witness, blockedOutside: outside,
        authReads, acknowledgedMetadataWrites: acknowledged,
      });
    }
  });
}
