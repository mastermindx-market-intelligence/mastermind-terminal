import { expect, type Page } from "@playwright/test";
import { archivedMembers, sectorFixture } from "../fixtures/sector-company-v3";

// Options R1 W1 — the Sector Central holding → Exposure journey on synthetic sources, shared
// by the journey spec and the crop packet so both exercise one fixture. It exercises product
// behavior (origin envelope, stepping, return), not provider qualification.
export const SESSION = "2026-10-19";
export const SECTOR_URL = "/discover?tab=sectors&sector=xlk&group=semiconductors";
export const HASH_A = "sha256:a1b2c3d4e5f60718", HASH_B = "sha256:ffffffffffffffff";
export const DEFAULT_SPOTS: Record<string, number> = { MPWR: 1355.47, MCHP: 75.53, MU: 1071.88, NXPI: 235.44, TXN: 272.62, ADI: 385.23 };
export type JourneyLang = "en" | "zh";

export async function prepareSectorJourney(page: Page, options: { hash?: () => string; absent?: string[]; lang?: JourneyLang; spots?: Record<string, number> } = {}) {
  const hash = options.hash ?? (() => HASH_A), absent = new Set(options.absent ?? []), spots = { ...DEFAULT_SPOTS, ...options.spots };
  await page.addInitScript(lang => { localStorage.setItem("mm.lang", lang); Reflect.deleteProperty(window, "EventSource"); }, options.lang ?? "en");
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
export async function exposureHrefFor(page: Page, ticker: string) {
  await page.goto(SECTOR_URL);
  const root = page.getByTestId("sector-intelligence");
  await root.locator(`[data-company-choice="${ticker}"]`).click();
  const link = root.getByTestId("sector-company-inspector").getByTestId("sector-open-exposure");
  await expect(link).toHaveAttribute("href", /[?&]origin=/);
  const href = (await link.getAttribute("href"))!;
  const origin = JSON.parse(decodeURIComponent(new URLSearchParams(href.slice(href.indexOf("?") + 1)).get("origin")!)) as Record<string, unknown>;
  return { href, origin };
}
export const originStrip = (page: Page) => page.getByTestId("exposure-origin-strip");
