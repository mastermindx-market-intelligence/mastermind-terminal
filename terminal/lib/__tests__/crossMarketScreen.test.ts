// E03 — the cross-market screening rules, run over the PRODUCER's own document and the exact
// manifest rows it was built from (tests/fixtures/classification, see PROVENANCE.json there).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyLabel, parseClassificationScan, type ClassificationScanSource, type TaxonomyId } from "../classificationScan";
import {
  NO_EXCLUSIONS,
  UNCLASSIFIED,
  classPredicateOf,
  compareMoney,
  effectiveTaxonomy,
  formatFloor,
  formatMoney,
  labelStanding,
  matchMoneyFloor,
  moneyCurrency,
  reconcileFilters,
  resolveCurrencyScope,
  resolveLabel,
  sanitizeCrossMarketFields,
  screenClassification,
  screenCrossMarket,
  sectorDisplay,
  type CrossMarketFilters,
  type ExclusionCounts,
  type MoneyCurrency,
  type ReconcileProbe,
} from "../crossMarketScreen";
import { marketOf } from "../markets";

type MRow = { sym: string; mkt?: string; sec?: string; gics?: string; mcap?: number; last?: number; vol?: number };
const MANIFEST: { symbols: Record<string, Omit<MRow, "sym">> } = JSON.parse(
  readFileSync(path.join(__dirname, "../../../tests/fixtures/classification/manifest.json"), "utf8"),
);
const ROWS: MRow[] = Object.entries(MANIFEST.symbols).map(([sym, r]) => ({ sym, ...r }));
const PRODUCER = JSON.parse(readFileSync(path.join(__dirname, "fixtures/screenerScan/classification.producer.json"), "utf8"));
const NOW = Date.parse("2026-10-11T12:00:00Z");

function scanOf(doc: unknown = PRODUCER): ClassificationScanSource {
  const r = parseClassificationScan(doc);
  if (!r.ok) throw new Error(r.error);
  return { kind: "ready", scan: r.value };
}
const S = scanOf();
const row = (sym: string): MRow => { const r = ROWS.find((x) => x.sym === sym); if (!r) throw new Error(sym); return r; };
const inMarket = (m: string) => ROWS.filter((r) => m === "all" || marketOf(r.sym, r) === m);
const dv = (r: MRow) => (r.last ?? 0) * (r.vol ?? 0);

const probe = (s: ClassificationScanSource): ReconcileProbe<MRow> => ({
  currency: (r) => moneyCurrency(s, r.sym),
  mcap: (r) => r.mcap ?? null,
  label: (r, t) => resolveLabel(s, r, t, NOW),
});
const BASE: CrossMarketFilters = { market: "all", sector: "all", taxonomy: null, classStale: false, ccy: "auto", liq: 0, mcap: 0 };

/** Run a screen the way ScreenerView does and return the admitted symbols plus the counts. */
function screen(s: ClassificationScanSource, f: CrossMarketFilters) {
  const pop = inMarket(f.market);
  const tax = effectiveTaxonomy(f);
  const pred = classPredicateOf(f);
  const scope = resolveCurrencyScope(f.ccy, pop.map((r) => moneyCurrency(s, r.sym)), f.market === "all" ? "USD" : null);
  const excl: ExclusionCounts = { ...NO_EXCLUSIONS };
  const out: string[] = [];
  for (const r of pop) {
    if (f.mcap > 0 && !(r.mcap != null && r.mcap >= f.mcap)) continue;
    const cls = tax ? resolveLabel(s, r, tax, NOW) : null;
    const x = screenCrossMarket(cls, pred, { v: dv(r), cur: moneyCurrency(s, r.sym) }, f.liq, scope.code);
    if (x === null) out.push(r.sym);
    else if (x !== "fail") excl[x] += 1;
  }
  return { out, excl, scope };
}

describe("fixture markets", () => {
  it("places every fixture listing in the market its venue names", () => {
    const by = (m: string) => inMarket(m).map((r) => r.sym).sort();
    expect(by("hk")).toEqual(["0700.HK", "80700.HK", "9988.HK"]);
    expect(by("cn")).toEqual(["000001.SZ", "600519.SS", "688781.SS"]);
    expect(by("ca")).toEqual(["RY.TO", "SHOP.TO"]);
    expect(by("crypto")).toEqual(["BTC-USD"]);
    expect(by("intl")).toEqual(["005930.KS", "2330.TW", "7203.T", "CBK.DE", "HSBA.L", "RELIANCE.NS"]);
  });
});

describe("AC-E03-02/03 — a displayed industry always names its taxonomy; stale never passes as current", () => {
  it("falls back to the manifest's GICS snapshot only as stale, and only under GICS", () => {
    const absent: ClassificationScanSource = { kind: "absent" };
    const c = resolveLabel(absent, row("XOM"), "gics_sector", NOW);
    expect(c.coverage).toEqual({ status: "stale", reason: "snapshot_undated" });
    expect(c.cell).toMatchObject({ label: "Energy", source: "manifest_gics", as_of: null });
    expect(resolveLabel(absent, row("XOM"), "yahoo_sector", NOW).coverage).toEqual({ status: "unavailable", reason: "scan_absent" });
    // a manifest string outside the GICS vocabulary is not a GICS label
    expect(resolveLabel(absent, { sym: "X", gics: "Technology" }, "gics_sector", NOW).coverage.reason).toBe("scan_absent");
  });

  it("shows each listing's own label with its taxonomy, first current then stale, never a blend", () => {
    expect(sectorDisplay(S, row("NVDA"), null, NOW)).toMatchObject({ kind: "label", taxonomy: "gics_sector", label: "Information Technology", stale: false, asOf: "2026-10-01" });
    // AAPL's GICS is only the undated snapshot; its current label is Yahoo's — shown as Yahoo
    expect(sectorDisplay(S, row("AAPL"), null, NOW)).toMatchObject({ kind: "label", taxonomy: "yahoo_sector", label: "Technology", stale: false });
    expect(sectorDisplay(S, row("AAPL"), "gics_sector", NOW)).toMatchObject({ kind: "label", taxonomy: "gics_sector", label: "Information Technology", stale: true, reason: "snapshot_undated", asOf: null });
    expect(sectorDisplay(S, row("0700.HK"), null, NOW)).toMatchObject({ taxonomy: "yahoo_sector", label: "Communication Services", stale: false });
    expect(sectorDisplay(S, row("000001.SZ"), null, NOW)).toMatchObject({ taxonomy: "cn_profile_sector", label: "Financial Services", stale: false });
    // the intl lane stopped refreshing: its labels show with their date and a stale marker
    expect(sectorDisplay(S, row("2330.TW"), null, NOW)).toMatchObject({ taxonomy: "yahoo_sector", label: "Technology", stale: true, reason: "classification_aged", asOf: "2026-07-14" });
    // XOM: Yahoo's "Energy" is ambiguous, so the only label is the stale GICS snapshot
    expect(sectorDisplay(S, row("XOM"), null, NOW)).toMatchObject({ taxonomy: "gics_sector", label: "Energy", stale: true });
    expect(sectorDisplay(S, row("XOM"), "yahoo_sector", NOW)).toEqual({ kind: "unclassified", taxonomy: "yahoo_sector", reason: "taxonomy_ambiguous", rawLabel: "Energy" });
    expect(sectorDisplay(S, row("BABA"), null, NOW)).toMatchObject({ kind: "unclassified", reason: "not_classified" });
    expect(sectorDisplay(S, row("SPY"), null, NOW)).toEqual({ kind: "not_applicable", reason: "asset_class_not_covered" });
    expect(sectorDisplay({ kind: "error", error: "x" }, row("0700.HK"), null, NOW)).toEqual({ kind: "unavailable", reason: "scan_unavailable" });
  });

  it("counts current / stale / unclassified as disjoint populations of a taxonomy", () => {
    const tally = (t: TaxonomyId, m: string) => {
      const c = { current: 0, stale: 0, unclassified: 0 };
      for (const r of inMarket(m)) c[labelStanding(resolveLabel(S, r, t, NOW))] += 1;
      return c;
    };
    expect(tally("gics_sector", "us")).toEqual({ current: 2, stale: 5, unclassified: 9 });
    expect(tally("yahoo_sector", "hk")).toEqual({ current: 2, stale: 0, unclassified: 1 });
    expect(tally("yahoo_sector", "intl")).toEqual({ current: 0, stale: 5, unclassified: 1 });
    expect(tally("cn_profile_sector", "cn")).toEqual({ current: 2, stale: 0, unclassified: 1 });
  });

  it("screens a GICS label: current passes, a stale snapshot is counted out, a Yahoo label never answers", () => {
    const f = { ...BASE, market: "us", taxonomy: "gics_sector" as const, sector: "Information Technology" };
    const r = screen(S, f);
    expect(r.out).toEqual(["NVDA"]);
    // AAPL matches only by its stale snapshot; ARM/BABA/MSTR/TSM carry no GICS label and
    // SPY/indices/rates/FX/futures sit outside GICS (9 in all); COIN (Financials) and the other
    // stale snapshots simply do not match
    expect(r.excl.stale).toBe(1);
    expect(r.excl.unclassified).toBe(9);
    const opted = screen(S, { ...f, classStale: true });
    expect(opted.out.sort()).toEqual(["AAPL", "NVDA"]);
    expect(opted.excl.stale).toBe(0);
    const unc = screen(S, { ...f, sector: UNCLASSIFIED });
    expect(unc.out).toContain("ARM");
    expect(unc.out).not.toContain("AAPL"); // a stale label is a label, not "unclassified"
    expect(unc.out).not.toContain("NVDA");
    expect(screenClassification(classifyLabel(S, "PFE", "gics_sector", NOW), classPredicateOf(f)!)).toBe("fail");
  });
});

describe("AC-E03-04 — money is compared only within one listing currency", () => {
  it("resolves the scope: USD for all markets, the market's own currency otherwise", () => {
    const sc = (m: string) => resolveCurrencyScope("auto", inMarket(m).map((r) => moneyCurrency(S, r.sym)), m === "all" ? "USD" : null);
    expect(sc("all").code).toBe("USD");
    expect(sc("hk")).toMatchObject({ code: "HKD", auto: true, codes: [{ code: "HKD", n: 2 }, { code: "CNY", n: 1 }] });
    expect(sc("cn").code).toBe("CNY");
    expect(sc("ca").code).toBe("CAD");
    expect(sc("intl").code).toBe("EUR"); // six currencies, one listing each → ties by code
    expect(resolveCurrencyScope("JPY", [], null)).toEqual({ code: "JPY", auto: false, codes: [] });
    expect(resolveCurrencyScope("auto", [{ kind: "unknown", reason: "scan_absent" }], "USD").code).toBeNull();
  });

  it("never lets a local-currency magnitude pass a USD floor", () => {
    const hkd: MoneyCurrency = { kind: "code", code: "HKD" };
    // 0700.HK trades ~HKD 8.7B a day — numerically far above a $5M floor, and still not compared
    expect(matchMoneyFloor(8.7e9, hkd, 5e6, "USD")).toBe("other_currency");
    expect(matchMoneyFloor(8.7e9, hkd, 5e6, "HKD")).toBe("pass");
    expect(matchMoneyFloor(1e6, hkd, 5e6, "HKD")).toBe("below");
    expect(matchMoneyFloor(1e9, { kind: "unknown", reason: "not_in_scan" }, 5e6, "USD")).toBe("currency_unknown");
    expect(matchMoneyFloor(1e9, { kind: "not_money", reason: "currency_not_applicable" }, 5e6, "USD")).toBe("not_money");
    expect(matchMoneyFloor(null, { kind: "code", code: "USD" }, 5e6, "USD")).toBe("value_missing");
    expect(matchMoneyFloor(1e9, { kind: "code", code: "USD" }, 5e6, null)).toBe("other_currency");
  });

  it("applies a USD floor across all markets and counts every listing it could not compare", () => {
    const r = screen(S, { ...BASE, liq: 5e6 });
    for (const s of r.out) expect(moneyCurrency(S, s), s).toEqual({ kind: "code", code: "USD" });
    expect(r.out).toContain("NVDA");
    expect(r.out).not.toContain("0700.HK");
    expect(r.excl.otherCurrency).toBe(14); // HKD×2, CNY×4, CAD×2, JPY, TWD, KRW, GBp, EUR, INR
    expect(r.excl.notMoney).toBe(4);       // ^GSPC, ^TNX, EURUSD=X, ES=F
    expect(r.excl.currencyUnknown).toBe(0);
    // the same floor in HK screens HKD listings and counts the CNY counter out by name
    const hk = screen(S, { ...BASE, market: "hk", liq: 5e6 });
    expect(hk.scope.code).toBe("HKD");
    expect(hk.out.sort()).toEqual(["0700.HK", "9988.HK"]);
    expect(hk.excl.otherCurrency).toBe(1);
  });

  it("with no scan, a floor admits nothing and says why — never a silent USD comparison", () => {
    const absent: ClassificationScanSource = { kind: "absent" };
    const r = screen(absent, { ...BASE, liq: 5e6 });
    expect(r.scope.code).toBeNull();
    expect(r.out).toEqual([]);
    expect(r.excl.currencyUnknown).toBe(31);
  });

  it("sorts the scope currency first, other currencies as their own blocks, unknown last", () => {
    const usd = (v: number) => ({ v, cur: { kind: "code", code: "USD" } as MoneyCurrency });
    const hkd = (v: number) => ({ v, cur: { kind: "code", code: "HKD" } as MoneyCurrency });
    const unk = { v: 9e12, cur: { kind: "unknown", reason: "x" } as MoneyCurrency };
    const items = [hkd(9e9), unk, usd(1e6), usd(5e6), hkd(1e3)];
    const desc = [...items].sort((a, b) => compareMoney(a, b, "USD", -1));
    expect(desc).toEqual([usd(5e6), usd(1e6), hkd(9e9), hkd(1e3), unk]);
    const asc = [...items].sort((a, b) => compareMoney(a, b, "USD", 1));
    expect(asc).toEqual([usd(1e6), usd(5e6), hkd(1e3), hkd(9e9), unk]);
  });

  it("labels every money value with its unit", () => {
    expect(formatMoney(1.2e9, { kind: "code", code: "USD" })).toBe("$1.20B");
    expect(formatMoney(1.2e9, { kind: "code", code: "HKD" })).toBe("HKD 1.20B");
    expect(formatMoney(3.4e6, { kind: "code", code: "GBp" })).toBe("GBp 3.4M");
    expect(formatMoney(1.2e9, { kind: "unknown", reason: "x" })).toBe("? 1.20B");
    expect(formatMoney(1.2e9, { kind: "not_money", reason: "currency_not_applicable" })).toBe("—");
    expect(formatFloor(5e6, "USD")).toBe("$5M");
    expect(formatFloor(5e6, "HKD")).toBe("HKD 5M");
    expect(formatFloor(1e9, null)).toBe("? 1B");
  });
});

describe("AC-E03-05 — a market change keeps valid filters and clears incompatible ones by name", () => {
  const go = (f: CrossMarketFilters, m: string, s = S) => reconcileFilters({ ...f, market: m }, inMarket(m), probe(s));

  it("keeps every filter that still has a population in the new market", () => {
    const f = { ...BASE, taxonomy: "yahoo_sector" as const, sector: "Consumer Cyclical", liq: 5e6 };
    const r = go(f, "hk");
    expect(r.cleared).toEqual([]);
    expect(r.next).toEqual({ ...f, market: "hk" });
    expect(screen(S, r.next).out).toEqual(["9988.HK"]);
  });

  it("clears an explicit currency, a market-cap floor and an absent label — each named", () => {
    const f = { ...BASE, ccy: "USD", mcap: 1e10, taxonomy: "yahoo_sector" as const, sector: "Technology" };
    const r = go(f, "hk");
    expect(r.cleared).toEqual([
      { field: "ccy", value: "USD", reason: "currency_not_in_market" },
      { field: "mcap", value: "10000000000", reason: "mcap_not_covered" },
      { field: "sector", value: "Technology", reason: "label_not_present" },
    ]);
    expect(r.next).toMatchObject({ market: "hk", ccy: "auto", mcap: 0, taxonomy: "yahoo_sector", sector: "all" });
    // the reconciled screen is not a false empty population
    expect(screen(S, r.next).out.length).toBe(3);
  });

  it("clears a taxonomy the market carries no labels in", () => {
    const r = go({ ...BASE, taxonomy: "gics_sector", sector: "Energy", classStale: true }, "cn");
    expect(r.cleared).toEqual([{ field: "taxonomy", value: "gics_sector", reason: "taxonomy_not_covered" }]);
    expect(r.next).toMatchObject({ taxonomy: null, sector: "all", classStale: false });
    // a stale label still counts as present: the intl lane's aged Yahoo labels keep the taxonomy
    expect(go({ ...BASE, taxonomy: "yahoo_sector", sector: "Technology" }, "intl").cleared).toEqual([]);
  });

  it("clears a traded-value floor only where no listing currency is known at all", () => {
    expect(go({ ...BASE, liq: 5e6 }, "crypto").cleared).toEqual([]);
    const absent: ClassificationScanSource = { kind: "absent" };
    expect(go({ ...BASE, liq: 5e6 }, "hk", absent).cleared).toEqual([{ field: "liq", value: "5000000", reason: "currency_unavailable" }]);
  });

  it("is not an input to a language change: the stored state is canonical, so nothing clears", () => {
    // the same state reconciled against the same market is a fixed point
    const f = { ...BASE, market: "hk", taxonomy: "yahoo_sector" as const, sector: "Communication Services", liq: 1e6 };
    expect(go(f, "hk")).toEqual({ next: f, cleared: [] });
  });
});

describe("stored presets", () => {
  it("reads a legacy sector preset as GICS and drops unknown cross-market values to neutral", () => {
    expect(sanitizeCrossMarketFields({ sector: "Energy" })).toEqual({ sector: "Energy", taxonomy: "gics_sector", classStale: false, ccy: "auto" });
    expect(sanitizeCrossMarketFields({})).toEqual({ sector: "all", taxonomy: null, classStale: false, ccy: "auto" });
    expect(sanitizeCrossMarketFields({ sector: "all", taxonomy: "naics", ccy: "usd", classStale: "yes" }))
      .toEqual({ sector: "all", taxonomy: null, classStale: false, ccy: "auto" });
    expect(sanitizeCrossMarketFields({ sector: "Technology", taxonomy: "yahoo_sector", ccy: "GBp", classStale: true }))
      .toEqual({ sector: "Technology", taxonomy: "yahoo_sector", classStale: true, ccy: "GBp" });
  });

  it("builds no predicate for an unset label, and the unclassified op for the sentinel", () => {
    expect(classPredicateOf({ taxonomy: "gics_sector", sector: "all" })).toBeNull();
    expect(classPredicateOf({ taxonomy: null, sector: "all" })).toBeNull();
    expect(classPredicateOf({ taxonomy: "yahoo_sector", sector: UNCLASSIFIED })).toEqual({ taxonomy: "yahoo_sector", op: "unclassified" });
    expect(classPredicateOf({ taxonomy: null, sector: "Energy", classStale: true })).toEqual({ taxonomy: "gics_sector", op: "in", labels: ["Energy"], includeStale: true });
  });
});
