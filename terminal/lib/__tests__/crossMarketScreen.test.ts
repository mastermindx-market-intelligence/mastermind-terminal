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
  floorState,
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
  smartScreenHandover,
  type CrossMarketFilters,
  type ExclusionCounts,
  type MoneyCurrency,
  type ReconcileProbe,
} from "../crossMarketScreen";
import { marketOf } from "../markets";
import { DEFAULT_SCREENER_FILTERS, compileFilters, type ScreenerFilters } from "../smartScreen/predicate";

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

/** Run a screen the way ScreenerView does and return the admitted symbols plus the counts.
 *  The floor filters only when floorState says it is APPLIED (read, scoped, its own currency). */
function screen(s: ClassificationScanSource, f: CrossMarketFilters) {
  const pop = inMarket(f.market);
  const tax = effectiveTaxonomy(f);
  const pred = classPredicateOf(f);
  const scope = resolveCurrencyScope(f.ccy, pop.map((r) => moneyCurrency(s, r.sym)), f.market === "all" ? "USD" : null);
  const floor = floorState(f.liq, f.liqCcy, scope.code, s.kind === "ready");
  const liq = floor.kind === "applied" ? f.liq : 0;
  const excl: ExclusionCounts = { ...NO_EXCLUSIONS };
  const out: string[] = [];
  for (const r of pop) {
    if (f.mcap > 0 && !(r.mcap != null && r.mcap >= f.mcap)) continue;
    const cls = tax ? resolveLabel(s, r, tax, NOW) : null;
    const x = screenCrossMarket(cls, pred, { v: dv(r), cur: moneyCurrency(s, r.sym) }, liq, scope.code);
    if (x === null) out.push(r.sym);
    else if (x !== "fail") excl[x] += 1;
  }
  return { out, excl, scope, floor };
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

  it("counts current / stale / unclassified / not read as disjoint populations of a taxonomy", () => {
    const tally = (t: TaxonomyId, m: string, s: ClassificationScanSource = S) => {
      const c = { current: 0, stale: 0, unclassified: 0, unavailable: 0 };
      for (const r of inMarket(m)) c[labelStanding(resolveLabel(s, r, t, NOW))] += 1;
      return c;
    };
    expect(tally("gics_sector", "us")).toEqual({ current: 2, stale: 5, unclassified: 9, unavailable: 0 });
    expect(tally("yahoo_sector", "hk")).toEqual({ current: 2, stale: 0, unclassified: 1, unavailable: 0 });
    expect(tally("yahoo_sector", "intl")).toEqual({ current: 0, stale: 5, unclassified: 1, unavailable: 0 });
    expect(tally("cn_profile_sector", "cn")).toEqual({ current: 2, stale: 0, unclassified: 1, unavailable: 0 });
    // without a read nothing is "unclassified": every listing's label is unknown
    expect(tally("yahoo_sector", "hk", { kind: "absent" })).toEqual({ current: 0, stale: 0, unclassified: 0, unavailable: 3 });
    expect(tally("yahoo_sector", "hk", { kind: "error", error: "http_500" })).toEqual({ current: 0, stale: 0, unclassified: 0, unavailable: 3 });
    // under GICS an absent scan still reads the manifest snapshot (stale); the rest are not read
    const g = tally("gics_sector", "us", { kind: "absent" });
    expect(g.current).toBe(0);
    expect(g.unclassified).toBe(0);
    expect(g.stale + g.unavailable).toBe(16);
  });

  it("a failed or absent read never answers the Unclassified predicate (failure-state truth)", () => {
    const pred = { taxonomy: "yahoo_sector" as const, op: "unclassified" as const };
    for (const src of [{ kind: "absent" } as ClassificationScanSource, { kind: "error", error: "network" } as ClassificationScanSource]) {
      const c = resolveLabel(src, row("0700.HK"), "yahoo_sector", NOW);
      expect(labelStanding(c), src.kind).toBe("unavailable");
      expect(screenClassification(c, pred), src.kind).toBe("unread_excluded");
      const r = screen(src, { ...BASE, market: "hk", taxonomy: "yahoo_sector", sector: UNCLASSIFIED });
      expect(r.out, src.kind).toEqual([]);
      expect(r.excl.unread, src.kind).toBe(3);
      expect(r.excl.unclassified, src.kind).toBe(0);
    }
    // a listing a READY scan does not carry was not read either — unknown, not unclassified
    const missing = resolveLabel(S, { sym: "ZZZZ.HK" }, "yahoo_sector", NOW);
    expect(labelStanding(missing)).toBe("unavailable");
    expect(screenClassification(missing, pred)).toBe("unread_excluded");
    // while a read that found no label still is unclassified
    expect(screen(S, { ...BASE, market: "hk", taxonomy: "yahoo_sector", sector: UNCLASSIFIED }).out).toEqual(["80700.HK"]);
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

  it("with no scan, a floor is kept but not applied — never a silent USD comparison", () => {
    const absent: ClassificationScanSource = { kind: "absent" };
    const r = screen(absent, { ...BASE, liq: 5e6, liqCcy: "USD" });
    expect(r.scope.code).toBeNull();
    expect(r.floor).toEqual({ kind: "unread", setIn: "USD" });
    expect(r.out.length).toBe(31); // nothing excluded on a currency nobody read
    expect(r.excl).toEqual(NO_EXCLUSIONS);
    // screenCrossMarket itself never compares against an unknown scope
    expect(screenCrossMarket(null, null, { v: 1e9, cur: moneyCurrency(absent, "NVDA") }, 5e6, null)).toBe("currencyUnknown");
  });

  it("names why a floor is or is not applied", () => {
    expect(floorState(0, "USD", "USD", true)).toEqual({ kind: "none" });
    expect(floorState(5e6, "USD", "USD", true)).toEqual({ kind: "applied", code: "USD" });
    expect(floorState(5e6, null, "HKD", true)).toEqual({ kind: "applied", code: "HKD" }); // unbound takes the scope
    expect(floorState(5e6, "USD", "USD", false)).toEqual({ kind: "unread", setIn: "USD" });
    expect(floorState(5e6, "USD", null, true)).toEqual({ kind: "no_scope", setIn: "USD" });
    expect(floorState(5e6, "USD", "HKD", true)).toEqual({ kind: "other_currency", setIn: "USD", scope: "HKD" });
    // a USD floor is never applied as HKD: the HK screen with a USD-set floor filters nothing
    const r = screen(S, { ...BASE, market: "hk", liq: 5e6, liqCcy: "USD" });
    expect(r.floor.kind).toBe("other_currency");
    expect(r.out.length).toBe(3);
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
  // the options ScreenerView passes: USD preferred for all markets; currencies read only when ready
  const go = (f: CrossMarketFilters, m: string, s = S) =>
    reconcileFilters({ ...f, market: m }, inMarket(m), probe(s), { preferred: m === "all" ? "USD" : null, readable: s.kind === "ready" });

  it("keeps every filter that still has a population in the new market", () => {
    const f = { ...BASE, taxonomy: "yahoo_sector" as const, sector: "Consumer Cyclical", ccy: "HKD", liq: 5e6, liqCcy: "HKD" };
    const r = go(f, "hk");
    expect(r.cleared).toEqual([]);
    expect(r.next).toEqual({ ...f, market: "hk" });
    expect(screen(S, r.next).out).toEqual(["9988.HK"]);
  });

  it("clears a floor by name when the scope currency changes — USD 5M is never re-read as HKD 5M", () => {
    const usd = { ...BASE, liq: 5e6, liqCcy: "USD" };
    const r = go(usd, "hk");
    expect(r.cleared).toEqual([{ field: "liq", value: "$5M", reason: "currency_changed", from: "USD", to: "HKD" }]);
    expect(r.next).toMatchObject({ market: "hk", liq: 0, liqCcy: null });
    // an explicit currency change inside one market is the same move
    const hkd = { ...BASE, market: "hk", liq: 5e6, liqCcy: "HKD" };
    const c = reconcileFilters({ ...hkd, ccy: "CNY" }, inMarket("hk"), probe(S), { preferred: null, readable: true });
    expect(c.cleared).toEqual([{ field: "liq", value: "HKD 5M", reason: "currency_changed", from: "HKD", to: "CNY" }]);
    expect(c.next).toMatchObject({ ccy: "CNY", liq: 0, liqCcy: null });
    // a floor in the scope's own currency is kept (a fixed point)
    expect(go(hkd, "hk")).toEqual({ next: hkd, cleared: [] });
    // an unbound floor (set before any currency was read) binds to the scope it first applies in
    const bound = go({ ...BASE, liq: 5e6 }, "hk");
    expect(bound.cleared).toEqual([]);
    expect(bound.next.liqCcy).toBe("HKD");
  });

  it("clears nothing it could not read: an absent or failed scan keeps currency, floor and label", () => {
    const f = { ...BASE, ccy: "USD", liq: 5e6, liqCcy: "USD", taxonomy: "yahoo_sector" as const, sector: "Technology" };
    for (const src of [{ kind: "absent" } as ClassificationScanSource, { kind: "error", error: "timeout" } as ClassificationScanSource]) {
      const r = go(f, "hk", src);
      expect(r.cleared, src.kind).toEqual([]);
      expect(r.next, src.kind).toEqual({ ...f, market: "hk" });
      expect(screen(src, r.next).floor, src.kind).toEqual({ kind: "unread", setIn: "USD" });
    }
    // the market-cap floor is manifest data, read either way
    expect(go({ ...BASE, mcap: 1e10 }, "hk", { kind: "absent" }).cleared).toEqual([{ field: "mcap", value: "10000000000", reason: "mcap_not_covered" }]);
  });

  it("keeps a taxonomy and label while any listing's record was not read", () => {
    const f = { ...BASE, market: "cn", taxonomy: "gics_sector" as const, sector: "Energy" };
    const opts = { preferred: null, readable: true };
    expect(reconcileFilters(f, inMarket("cn"), probe(S), opts).cleared.map((c) => c.field)).toEqual(["taxonomy"]);
    // one CN listing the scan does not carry: GICS may yet be on it, so nothing is cleared
    expect(reconcileFilters(f, [...inMarket("cn"), { sym: "ZZZZ.SS" }], probe(S), opts).cleared).toEqual([]);
  });

  it("clears an explicit currency, a market-cap floor and an absent label — each named", () => {
    const f = { ...BASE, ccy: "USD", mcap: 1e10, taxonomy: "yahoo_sector" as const, sector: "Technology" };
    const r = go(f, "hk");
    expect(r.cleared).toEqual([
      { field: "mcap", value: "10000000000", reason: "mcap_not_covered" },
      { field: "ccy", value: "USD", reason: "currency_not_in_market" },
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

  it("clears a traded-value floor only where a read found no listing currency at all", () => {
    expect(go({ ...BASE, liq: 5e6, liqCcy: "USD" }, "crypto").cleared).toEqual([]);
    const none = reconcileFilters({ ...BASE, liq: 5e6, liqCcy: "USD" }, [{ sym: "ZZZZ" }], probe(S), { preferred: "USD", readable: true });
    expect(none.cleared).toEqual([{ field: "liq", value: "$5M", reason: "currency_unavailable" }]);
  });

  it("is not an input to a language change: the stored state is canonical, so nothing clears", () => {
    // the same state reconciled against the same market is a fixed point
    const f = { ...BASE, market: "hk", taxonomy: "yahoo_sector" as const, sector: "Communication Services", liq: 1e6, liqCcy: "HKD" };
    expect(go(f, "hk")).toEqual({ next: f, cleared: [] });
  });
});

describe("stored presets", () => {
  it("reads a legacy sector preset as GICS and drops unknown cross-market values to neutral", () => {
    expect(sanitizeCrossMarketFields({ sector: "Energy" })).toEqual({ sector: "Energy", taxonomy: "gics_sector", classStale: false, ccy: "auto", liqCcy: null });
    expect(sanitizeCrossMarketFields({})).toEqual({ sector: "all", taxonomy: null, classStale: false, ccy: "auto", liqCcy: null });
    expect(sanitizeCrossMarketFields({ sector: "all", taxonomy: "naics", ccy: "usd", classStale: "yes" }))
      .toEqual({ sector: "all", taxonomy: null, classStale: false, ccy: "auto", liqCcy: null });
    expect(sanitizeCrossMarketFields({ sector: "Technology", taxonomy: "yahoo_sector", ccy: "GBp", classStale: true }))
      .toEqual({ sector: "Technology", taxonomy: "yahoo_sector", classStale: true, ccy: "GBp", liqCcy: null });
  });

  it("remembers the currency a stored floor was set in; a legacy floor was set in USD", () => {
    expect(sanitizeCrossMarketFields({ liq: 5e6 }).liqCcy).toBe("USD"); // saved before floors carried a currency
    expect(sanitizeCrossMarketFields({ liq: 5e6, liqCcy: "HKD" }).liqCcy).toBe("HKD");
    expect(sanitizeCrossMarketFields({ liq: 5e6, liqCcy: "hkd" }).liqCcy).toBeNull();
    expect(sanitizeCrossMarketFields({ liq: 5e6, liqCcy: null }).liqCcy).toBeNull();
    expect(sanitizeCrossMarketFields({ liq: 0, liqCcy: "HKD" }).liqCcy).toBeNull();
  });

  it("builds no predicate for an unset label, and the unclassified op for the sentinel", () => {
    expect(classPredicateOf({ taxonomy: "gics_sector", sector: "all" })).toBeNull();
    expect(classPredicateOf({ taxonomy: null, sector: "all" })).toBeNull();
    expect(classPredicateOf({ taxonomy: "yahoo_sector", sector: UNCLASSIFIED })).toEqual({ taxonomy: "yahoo_sector", op: "unclassified" });
    expect(classPredicateOf({ taxonomy: null, sector: "Energy", classStale: true })).toEqual({ taxonomy: "gics_sector", op: "in", labels: ["Energy"], includeStale: true });
  });
});

describe("E04 smart screens — the bar is handed over only in a sense their grammar holds", () => {
  // Smart screens store a GICS sector and one traded-value number shown as US dollars.
  const ctx = { prefsEnabled: null, showAllMarkets: false };
  type Bar = ScreenerFilters & CrossMarketFilters;
  const bar = (f: Partial<CrossMarketFilters>): Bar => ({ ...DEFAULT_SCREENER_FILTERS, ...BASE, ...f } as Bar);
  const handover = (f: Bar, s = S) => {
    const { scope, floor } = screen(s, f);
    return smartScreenHandover(f, floor, scope);
  };

  it("hands a GICS sector over unchanged, and a USD floor over a USD-only population", () => {
    const gics = bar({ taxonomy: "gics_sector", sector: "Energy" });
    const a = handover(gics);
    expect(a.gap).toBeNull();
    expect(a.filters).toBe(gics);
    expect(compileFilters(a.filters, ctx).ok).toBe(true);
    const usFloor = bar({ market: "us", liq: 5e6, liqCcy: "USD" });
    expect(screen(S, usFloor).scope.codes.map((c) => c.code)).toEqual(["USD"]);
    const b = handover(usFloor);
    expect(b.gap).toBeNull();
    expect(compileFilters(b.filters, ctx).ok).toBe(true);
  });

  it("refuses what the grammar would misfile: a Yahoo label as GICS, unclassified, a local-currency floor", () => {
    const cases: [Bar, string][] = [
      [bar({ taxonomy: "yahoo_sector", sector: "Technology" }), "non_gics_taxonomy"],
      [bar({ taxonomy: "cn_profile_sector", sector: "Energy" }), "non_gics_taxonomy"],
      [bar({ taxonomy: "gics_sector", sector: UNCLASSIFIED }), "unclassified"],
      [bar({ market: "hk", liq: 5e6, liqCcy: "HKD" }), "floor_not_usd"],
      // all markets: a USD floor applies to USD listings only, the grammar would compare HKD as $
      [bar({ liq: 5e6, liqCcy: "USD" }), "floor_mixed_currency"],
    ];
    for (const [f, gap] of cases) {
      const out = handover(f);
      expect(out.gap, gap).toBe(gap);
      expect(compileFilters(out.filters, ctx).ok, gap).toBe(false); // Save refuses
      expect({ ...out.filters, sector: f.sector }, gap).toEqual(f); // only the hand-over changes
    }
  });

  it("refuses a floor that is set but not applied for want of a read", () => {
    const f = bar({ market: "us", liq: 5e6, liqCcy: "USD" });
    for (const src of [{ kind: "absent" } as ClassificationScanSource, { kind: "error", error: "timeout" } as ClassificationScanSource]) {
      expect(handover(f, src).gap, src.kind).toBe("floor_inactive");
    }
  });

  it("reads an opened screen in its own vocabulary: its floor is US dollars, cleared by name elsewhere", () => {
    // what decompileToFilters hands back: no taxonomy, no floor currency
    const open = (f: Partial<ScreenerFilters>) => {
      const next = { ...DEFAULT_SCREENER_FILTERS, ...f };
      const merged = { ...BASE, ...next, ...sanitizeCrossMarketFields(next) };
      return reconcileFilters(merged, inMarket(merged.market), probe(S), { preferred: merged.market === "all" ? "USD" : null, readable: true });
    };
    const hk = open({ market: "hk", liq: 5e6 });
    expect(hk.cleared).toEqual([{ field: "liq", value: "$5M", reason: "currency_changed", from: "USD", to: "HKD" }]);
    expect(hk.next).toMatchObject({ liq: 0, liqCcy: null });
    const us = open({ market: "us", liq: 5e6, sector: "Energy" });
    expect(us.cleared).toEqual([]);
    expect(us.next).toMatchObject({ liq: 5e6, liqCcy: "USD", taxonomy: "gics_sector", sector: "Energy" });
  });
});
