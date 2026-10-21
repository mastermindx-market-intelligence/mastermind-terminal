import { expect, test, type Page } from "@playwright/test";
import { archivedMembers, sectorFixture } from "./fixtures/sector-company-v3";

// Options R1 W1A — one continuous journey: Sector Central holding → Exposure → main
// chart → back to the exact holding. Synthetic sources; this exercises product
// behavior (origin envelope, stepping, return), not provider qualification.
test.setTimeout(120_000);
const SESSION = "2026-10-19";
const SECTOR_URL = "/discover?tab=sectors&sector=xlk&group=semiconductors";
const HASH_A = "sha256:a1b2c3d4e5f60718", HASH_B = "sha256:ffffffffffffffff";
const spots: Record<string, number> = { MPWR: 1355.47, MCHP: 75.53, MU: 1071.88, NXPI: 235.44, TXN: 272.62, ADI: 385.23 };

async function prepare(page: Page, options: { hash?: () => string; absent?: string[] } = {}) {
  const hash = options.hash ?? (() => HASH_A), absent = new Set(options.absent ?? []);
  await page.addInitScript(() => { localStorage.setItem("mm.lang", "en"); Reflect.deleteProperty(window, "EventSource"); });
  await page.route("**/api/sector-intelligence?**", route => {
    const source = new URL(route.request().url()).searchParams.get("source");
    if (source !== "confluence") return sectorFixture(route);
    return route.fulfill({ json: { data: { ok: true, as_of: "2026-09-23", sectors: [], subsectors: [{ key: "semiconductors", label: "Semiconductors",
      n_members: 14, n_priced: 14, entry: { tier: "T1" }, regime: { state: "EXTENDED" }, members: archivedMembers }] },
      receipt: { source, path: "/marketdata/subsector_confluence.json", status: "ready", asOf: "2026-09-23", observedAt: "2026-09-26T10:00:00Z", stale: false, contentHash: hash() } } });
  });
  await page.route(url => url.pathname === "/api/flow", async route => {
    const feed = new URL(route.request().url()).searchParams.get("f") ?? "";
    const [kind, root] = feed.split(":");
    if (absent.has(root) && (kind === "gex" || kind === "gex_at" || kind === "matrix")) return route.fulfill({ status: 404, json: { error: "absent" } });
    if (kind === "gex_dates" && spots[root]) return route.fulfill({ json: { root, dates: [SESSION], latest: SESSION } });
    if (kind === "gexstate_index") return route.fulfill({ json: { asof: SESSION, rows: {} } });
    if (kind === "quad") return route.fulfill({ json: { asof: SESSION, min_history_days: 20, pctile_window_days: 252, rows: [] } });
    if (kind === "moves" && spots[root]) return route.fulfill({ json: { schema: "options_hub.moves/v1", root, asof: SESSION, spot_ref: spots[root], expected_move: { pct: 1.96, band_mult: 1.96, horizon_days: 1 } } });
    if (!spots[root] || !["gex", "matrix"].includes(kind)) return route.continue();
    const spot = spots[root], step = spot > 500 ? 10 : 1;
    const strikes = Array.from({ length: 29 }, (_, i) => Math.round(spot / step) * step + (i - 14) * step);
    const rows = strikes.map((strike, i) => {
      const call = 20 + 620 * Math.exp(-((i - 18) ** 2) / 16), put = -(15 + 550 * Math.exp(-((i - 9) ** 2) / 12));
      return { strike, gamma_call: call, gamma_put: put, gamma_net: call + put, vanna_net: (call + put) * .32, charm_net: (put - call) * .09, delta_net: call * .7 };
    });
    if (kind === "gex") return route.fulfill({ json: { schema: "options_hub.gex/v1", root, asof: `${SESSION}T20:15:00Z`, spot_ref: spot,
      convention: "+call/-put assumed dealer inventory", by_strike_full_n: strikes.length, by_strike: rows, by_expiry: [{ exp: SESSION }, { exp: "2026-10-23" }],
      exposure_projection: { schema: "options_hub.exposure_projection/v2", root, clocks: { source_session: null }, cells_status: "source_unqualified", cells: [] } } });
    return route.fulfill({ json: { schema: "options_structure.matrix/v1", root, asof: `${SESSION}T20:16:00Z`, _build_meta: { asof_date: SESSION }, strikes, expiries: [SESSION, "2026-10-23"],
      cells: rows.flatMap(row => [{ strike: row.strike, expiry: SESSION, gex: row.gamma_net * .65e6 }, { strike: row.strike, expiry: "2026-10-23", gex: row.gamma_net * .35e6 }]) } });
  });
  await page.route(url => url.pathname === "/api/intraday", route => {
    const url = new URL(route.request().url()), root = url.searchParams.get("sym") ?? "MU", spot = spots[root] ?? spots.MU;
    const interval = url.searchParams.get("tf") === "30m" ? 1800 : url.searchParams.get("tf") === "2h" ? 7200 : 300;
    const bars = Array.from({ length: Math.ceil(23400 / interval) }, (_, i) => {
      const close = spot - 2.5 + i * .035 + Math.sin(i * .25) * 1.15, open = close - Math.cos(i * .4) * .3;
      return [Date.parse(`${SESSION}T09:30:00Z`) / 1000 + i * interval, open, Math.max(open, close) + .25, Math.min(open, close) - .3, close, 600000 + i * 1100];
    });
    return route.fulfill({ json: { t: root, tf: url.searchParams.get("tf"), bars, source: "fixture" } });
  });
}

/** The address Sector Central mints for a holding: the only way an origin is created. */
async function exposureHrefFor(page: Page, ticker: string) {
  await page.goto(SECTOR_URL);
  const root = page.getByTestId("sector-intelligence");
  await root.locator(`[data-company-choice="${ticker}"]`).click();
  const link = root.getByTestId("sector-company-inspector").getByTestId("sector-open-exposure");
  await expect(link).toHaveText(/Open options exposure/);
  const href = (await link.getAttribute("href"))!;
  const origin = JSON.parse(decodeURIComponent(new URLSearchParams(href.slice(href.indexOf("?") + 1)).get("origin")!)) as Record<string, unknown>;
  return { href, origin };
}
const strip = (page: Page) => page.getByTestId("exposure-origin-strip");

test("a holding opens its exposure with a bounded sector origin and returns to the exact selection", async ({ page }) => {
  await prepare(page);
  const { href, origin } = await exposureHrefFor(page, "MU");
  expect(href).toMatch(/^\/options\?tab=prism&symbol=MU&view=chart&origin=/);
  expect(origin).toMatchObject({ v: 1, kind: "sector", sector: "xlk", group: "semiconductors", company: "MU", index: 2, count: 14, sort: "source", query: "", asOf: "2026-09-23", contentHash: HASH_A, method: "incumbent_rs_63_21/v1", benchmark: "SPY" });
  expect(String(origin.returnHref)).toMatch(/^\/discover\?tab=sectors&/);
  expect(String(origin.returnHref)).toContain("sectorCompany=MU");
  await page.getByTestId("sector-company-inspector").getByTestId("sector-open-exposure").click();
  await expect(page).toHaveURL(/\/options\?tab=prism&symbol=MU&view=chart&origin=/);
  await expect(strip(page)).toHaveAttribute("data-state", "exact", { timeout: 30_000 });
  await expect(strip(page)).toContainText("From Sector Central");
  await expect(strip(page)).toContainText("Semiconductors");
  await expect(strip(page)).toContainText("3 of 14");
  await expect(strip(page)).toContainText("as of 2026-09-23");
  await expect(strip(page)).toContainText("relative to SPY");
  await expect(page.getByTestId("exposure-map")).toHaveAttribute("data-source-root", "MU");
  const back = strip(page).getByTestId("exposure-origin-back");
  expect(await back.getAttribute("href")).toBe(origin.returnHref);
  await back.click();
  await expect(page).toHaveURL(/\/discover\?tab=sectors&.*sectorCompany=MU/);
  const inspector = page.getByTestId("sector-company-inspector");
  await expect(inspector.getByRole("heading", { name: "MU", exact: true })).toBeVisible();
  await expect(page.locator('[data-company-choice="MU"]')).toBeFocused({ timeout: 15_000 });
});

test("a deep link survives reload and steps the same cohort through Back and Forward", async ({ page }) => {
  await prepare(page);
  const { href } = await exposureHrefFor(page, "MU");
  await page.goto(href);
  await expect(strip(page)).toHaveAttribute("data-state", "exact", { timeout: 30_000 });
  await expect(strip(page)).toContainText("3 of 14");
  await page.reload();
  await expect(strip(page)).toHaveAttribute("data-state", "exact", { timeout: 30_000 });
  await expect(strip(page)).toContainText("3 of 14");
  await expect(strip(page).getByTestId("exposure-origin-prev")).toHaveText(/MCHP/);
  await expect(strip(page).getByTestId("exposure-origin-next")).toHaveText(/NXPI/);
  await strip(page).getByTestId("exposure-origin-next").click();
  await expect(page).toHaveURL(/symbol=NXPI/);
  await expect(strip(page)).toContainText("4 of 14", { timeout: 30_000 });
  await expect(strip(page).getByTestId("exposure-origin-back")).toHaveAttribute("href", /sectorCompany=NXPI/);
  await expect(page.getByTestId("exposure-map")).toHaveAttribute("data-source-root", "NXPI");
  await page.goBack();
  await expect(page).toHaveURL(/symbol=MU/);
  await expect(strip(page)).toContainText("3 of 14", { timeout: 30_000 });
  await expect(page.getByTestId("exposure-map")).toHaveAttribute("data-source-root", "MU");
  await page.goForward();
  await expect(page).toHaveURL(/symbol=NXPI/);
  await expect(strip(page)).toContainText("4 of 14", { timeout: 30_000 });
  await strip(page).getByTestId("exposure-origin-prev").click();
  await expect(strip(page)).toContainText("3 of 14", { timeout: 30_000 });
  await expect(page).toHaveURL(/symbol=MU/);
});

test("a changed sector roster pauses stepping but keeps the way back", async ({ page }) => {
  let hash = HASH_A;
  await prepare(page, { hash: () => hash });
  const { href, origin } = await exposureHrefFor(page, "MU");
  hash = HASH_B;
  await page.goto(href);
  await expect(strip(page)).toHaveAttribute("data-state", "changed", { timeout: 30_000 });
  await expect(strip(page)).toContainText("The sector roster changed since you left.");
  await expect(strip(page).getByTestId("exposure-origin-prev")).toBeDisabled();
  await expect(strip(page).getByTestId("exposure-origin-next")).toBeDisabled();
  await expect(strip(page).getByTestId("exposure-origin-back")).toHaveAttribute("href", String(origin.returnHref));
});

test("an absent options source keeps the origin and the return address", async ({ page }) => {
  await prepare(page, { absent: ["ADI"] });
  const { href, origin } = await exposureHrefFor(page, "ADI");
  await page.goto(href);
  await expect(strip(page)).toHaveAttribute("data-state", "exact", { timeout: 30_000 });
  await expect(strip(page)).toContainText("6 of 14");
  await expect(page.getByTestId("exposure-map")).toHaveAttribute("data-source-root", "ADI");
  await expect(page.getByTestId("exposure-map")).toHaveAttribute("data-source-session", "");
  await expect(strip(page).getByTestId("exposure-origin-back")).toHaveAttribute("href", String(origin.returnHref));
});

test("an unsupported origin schema is ignored without touching the exposure view", async ({ page }) => {
  await prepare(page);
  const { href } = await exposureHrefFor(page, "MU");
  expect(href).toContain("%22v%22%3A1");
  await page.goto(href.replace("%22v%22%3A1", "%22v%22%3A2"));
  await expect(page.getByTestId("exposure-map")).toHaveAttribute("data-source-root", "MU", { timeout: 30_000 });
  await expect(page.getByTestId("exposure-map")).toHaveAttribute("data-chart-ready", "true", { timeout: 30_000 });
  await expect(strip(page)).toHaveCount(0);
});

test("the main chart carries the origin and Return to Exposure brings it back", async ({ page }) => {
  await prepare(page);
  const { href, origin } = await exposureHrefFor(page, "MU");
  await page.goto(href);
  const map = page.getByTestId("exposure-map");
  await expect(map).toHaveAttribute("data-chart-ready", "true", { timeout: 30_000 });
  await expect(strip(page)).toHaveAttribute("data-state", "exact", { timeout: 30_000 });
  await map.getByRole("button", { name: /Largest covered net node/ }).click();
  await page.getByTestId("exposure-node-inspector").getByRole("button", { name: "Open on main chart", exact: true }).click();
  await expect(page).toHaveURL(/\/terminal\?symbol=MU&origin=.*#exposure=/, { timeout: 30_000 });
  const reference = page.getByTestId("exposure-chart-reference");
  await expect(reference).toBeVisible({ timeout: 30_000 });
  await expect(reference.getByTestId("exposure-reference-sector")).toHaveAttribute("href", String(origin.returnHref));
  const returnLink = reference.getByRole("link", { name: "Return to Exposure", exact: true });
  expect(await returnLink.getAttribute("href")).toMatch(/^\/options\?tab=prism&symbol=MU&view=chart&origin=.*#exposure=/);
  await returnLink.click();
  await expect(page).toHaveURL(/\/options\?tab=prism&symbol=MU&view=chart&origin=/);
  await expect(strip(page)).toHaveAttribute("data-state", "exact", { timeout: 30_000 });
  await expect(strip(page)).toContainText("3 of 14");
});
