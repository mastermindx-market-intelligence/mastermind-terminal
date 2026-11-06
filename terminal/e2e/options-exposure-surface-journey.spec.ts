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
