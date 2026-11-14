import { readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { FUNDAMENTAL_FIELD_IDS } from "../lib/fundamentalScan";
import { projectFundamental } from "../lib/fundamentalScanProducer";
import { SCREENER_SCAN_SCHEMA } from "../lib/screenerScan";
import { fundDoc, JUNCO_ANNUAL, SEPCO_ANNUAL } from "../lib/__tests__/fixtures/fundamentalScan/fundDoc";

/** Deterministic research world. Fundamentals are projected by the shipped producer from
 * hand-checkable statements; the evidence drawer reads those same company documents. */
export async function installDiscoverResearchWorld(page: Page) {
  const now = new Date("2026-10-11T12:00:00Z"), generation = now.getTime() / 1000;
  await page.clock.setFixedTime(now);
  const symbols = ["AAA", "BBB", "CCC", "DDD", "EEE"];
  const manifest = { as_of: "2026-10-09", symbols: Object.fromEntries(symbols.map((sym, i) => [sym, {
    name: `${sym} Research Company`, sec: "Equities", mkt: "NASDAQ", last: 50 + i, chg: 4,
    vol: 2_000_000, hi52: 80, lo52: 30, mcap: 2e9,
    verdict: ["REBUY", "BUY", "SELL", "RECLAIM", null][i],
    vts: ["2026-08-01", "2026-10-09", null, "2026-10-12", null][i], regimeBull: i !== 2,
    wr: .6, pf: 1.8, cagr: .14,
  }])) };
  await page.route("**/data/manifest.json**", route => route.fulfill({ json: manifest }));
  await page.route("**/data/coverage.json**", route => route.fulfill({ status: 404, json: { error: "not found" } }));
  const classification = JSON.parse(readFileSync(path.join(__dirname, "../lib/__tests__/fixtures/screenerScan/classification.producer.json"), "utf8"));
  const listing = classification.rows.find((row: { sym: string }) => row.sym === "AAPL");
  if (!listing) throw new Error("classification producer fixture must include AAPL");
  classification.rows = symbols.map((sym, i) => ({ ...structuredClone(listing), sym, currency: { ...listing.currency, code: i === 1 ? "HKD" : "USD" } }));
  classification.universe.count = symbols.length;
  await page.route("**/data/scan/classification.json**", route => route.fulfill({ json: classification }));
  const company: Record<string, Record<string, unknown>> = {
    AAA: fundDoc("AAA", { pe: 25.5, annual: SEPCO_ANNUAL }),
    BBB: fundDoc("BBB", { pe: 14, annual: JUNCO_ANNUAL }),
  };
  const fundamental = {
    schema: SCREENER_SCAN_SCHEMA, family: "fundamental", family_version: 1, generation,
    generated_at: now.toISOString().replace(/\.\d{3}Z$/, "Z"), complete: true,
    universe: { source: "manifest", as_of: manifest.as_of, count: symbols.length }, fields: [...FUNDAMENTAL_FIELD_IDS],
    rows: symbols.map(sym => company[sym] ? { sym, ...projectFundamental(sym, company[sym]).observation } : { sym, status: "unavailable", reason: "fund_absent" }),
  };
  await page.route("**/data/scan/fundamental.json**", route => route.fulfill({ json: fundamental }));
  await page.route(/\/data\/[^/?]+\.fund\.json/, route => {
    const sym = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop()!.replace(/\.fund\.json$/, ""));
    return company[sym] ? route.fulfill({ json: company[sym] }) : route.fulfill({ status: 404, json: { error: "not found" } });
  });
  await page.route("**/data/scan/technical.json**", route => route.fulfill({ status: 503, json: { error: "fixture unavailable" } }));
  const quoteRequests: string[][] = [];
  await page.route("**/api/quote?**", route => {
    const syms = new URL(route.request().url()).searchParams.get("syms")!.split(","); quoteRequests.push(syms);
    return route.fulfill({ json: { quotes: Object.fromEntries(syms.map(sym => [sym, { regularPrice: 77, regularChg: 1.25, basis: "DELAYED_15M", live: false, ts: generation - 900 }])) } });
  });
  await page.route("**/api/ext-quote?**", route => route.fulfill({ json: { quotes: {} } }));
  return { quoteRequests };
}
