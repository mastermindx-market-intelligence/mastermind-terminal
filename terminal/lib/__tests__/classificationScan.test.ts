// E03 — the classification scan reader. `classification.producer.json` is the PRODUCER's own
// output (ingest/gen_classification_scan.py over tests/fixtures/classification, regenerated and
// drift-checked by tests/test_classification_scan_producer.py), so these tests pin that both
// halves of the contract agree, and then probe the reader's own rules with doctored copies.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLASSIFICATION_PRODUCER_REASONS,
  CLASSIFICATION_RECORD_MAX_AGE_DAYS,
  TAXONOMY_IDS,
  accountClassificationCoverage,
  classifyCurrency,
  classifyLabel,
  labelCellOf,
  listingHref,
  matchClassification,
  nextClassificationSource,
  parseClassificationPredicate,
  parseClassificationScan,
  readClassificationScanResponse,
  type ClassificationScanSource,
  type TaxonomyId,
} from "../classificationScan";

const FIXTURE = path.join(__dirname, "fixtures/screenerScan/classification.producer.json");
type RawRow = { sym: string; mkt: string; sec: string; lane: string | null; currency: Record<string, unknown>; class: Record<string, Record<string, unknown>> };
type RawDoc = Record<string, unknown> & { rows: RawRow[]; crosswalks: Record<string, unknown>; generation: number; generated_at: string; complete: boolean };
const raw = (): RawDoc => JSON.parse(readFileSync(FIXTURE, "utf8"));
// Ten hours after the fixture's generation (2026-10-11T02:00Z), two days after its universe date.
const NOW = Date.parse("2026-10-11T12:00:00Z");

function ready(doc: unknown = raw()): ClassificationScanSource {
  const r = parseClassificationScan(doc);
  if (!r.ok) throw new Error(`rejected: ${r.error}`);
  return { kind: "ready", scan: r.value };
}
const rowOf = (doc: RawDoc, sym: string): RawRow => {
  const r = doc.rows.find((x) => x.sym === sym);
  if (!r) throw new Error(`no fixture row ${sym}`);
  return r;
};
const cov = (s: ClassificationScanSource, sym: string, t: TaxonomyId) => classifyLabel(s, sym, t, NOW).coverage;

describe("classificationScan — the producer's own document", () => {
  it("parses whole: v1 taxonomy table, no crosswalk, no malformed row", () => {
    const s = ready();
    if (s.kind !== "ready") throw new Error("not ready");
    expect(s.scan.universe.count).toBe(31);
    expect(s.scan.rows.size).toBe(s.scan.universe.count);
    expect([...s.scan.rows.values()].filter((r) => r.kind === "malformed")).toEqual([]);
    expect(Object.keys(s.scan.taxonomies).sort()).toEqual([...TAXONOMY_IDS].sort());
    // AC-E03-02: every taxonomy names its authority; no version is invented where none is published
    for (const id of TAXONOMY_IDS) {
      expect(s.scan.taxonomies[id].authority.length, id).toBeGreaterThan(0);
      expect(s.scan.taxonomies[id].version, id).toBeNull();
    }
    expect(s.scan.taxonomies.cn_profile_sector.unclassifiedSentinels).toEqual(["A-share"]);
  });

  it("classifies each listing under the taxonomy its owner record proves, and no other", () => {
    const s = ready();
    // A GICS label exists only where the owner record's label is in the GICS vocabulary…
    expect(cov(s, "NVDA", "gics_sector")).toEqual({ status: "evaluated", reason: "ok" });
    expect(cov(s, "COIN", "gics_sector")).toEqual({ status: "evaluated", reason: "ok" });
    // …a Yahoo-labelled US record carries no GICS label of its own: only the manifest's undated
    // reference snapshot, which is stale and never current (AC-E03-03).
    expect(cov(s, "AAPL", "gics_sector")).toEqual({ status: "stale", reason: "snapshot_undated" });
    expect(classifyLabel(s, "AAPL", "gics_sector", NOW).cell).toMatchObject({ label: "Information Technology", source: "manifest_gics", as_of: null });
    expect(cov(s, "AAPL", "yahoo_sector")).toEqual({ status: "evaluated", reason: "ok" });
    // A label both vocabularies share is ambiguous, so it is attributed to neither.
    expect(cov(s, "XOM", "yahoo_sector")).toEqual({ status: "unsupported", reason: "taxonomy_ambiguous" });
    expect(cov(s, "RELIANCE.NS", "gics_sector")).toEqual({ status: "unsupported", reason: "taxonomy_ambiguous" });
    // HK names are Yahoo-sourced; CN names carry the CN profile; neither is re-filed as GICS.
    expect(cov(s, "0700.HK", "yahoo_sector")).toEqual({ status: "evaluated", reason: "ok" });
    expect(cov(s, "0700.HK", "gics_sector")).toEqual({ status: "unsupported", reason: "taxonomy_not_supplied" });
    expect(cov(s, "000001.SZ", "cn_profile_sector")).toEqual({ status: "evaluated", reason: "ok" });
    expect(cov(s, "000001.SZ", "yahoo_sector")).toEqual({ status: "unsupported", reason: "taxonomy_not_supplied" });
    expect(cov(s, "688781.SS", "cn_profile_sector")).toEqual({ status: "unavailable", reason: "not_classified" });
    // ETFs, crypto, indices, rates, FX and futures are outside every sector taxonomy.
    for (const sym of ["SPY", "BTC-USD", "^GSPC", "^TNX", "EURUSD=X", "ES=F"]) {
      expect(cov(s, sym, "gics_sector"), sym).toEqual({ status: "unsupported", reason: "asset_class_not_covered" });
    }
  });

  it("marks an owner record older than the record clock stale/classification_aged (the intl lane)", () => {
    const s = ready();
    // 2330.TW / 005930.KS / 7203.T were last emitted 2026-07-14 — 89 days before NOW.
    expect(CLASSIFICATION_RECORD_MAX_AGE_DAYS).toBe(45);
    for (const sym of ["2330.TW", "005930.KS", "7203.T", "HSBA.L", "CBK.DE", "RY.TO", "SHOP.TO"]) {
      expect(cov(s, sym, "yahoo_sector"), sym).toEqual({ status: "stale", reason: "classification_aged" });
      expect(labelCellOf(classifyLabel(s, sym, "yahoo_sector", NOW)).known, sym).toBe(false);
    }
    // …and the same record is current on the day it was written.
    expect(classifyLabel(s, "2330.TW", "yahoo_sector", Date.parse("2026-07-20T00:00:00Z")).coverage)
      .toEqual({ status: "evaluated", reason: "ok" });
  });

  it("sums every taxonomy's coverage to the requested universe, with each producer reason reachable", () => {
    const s = ready();
    const ids = raw().rows.map((r) => r.sym);
    const seen = new Set<string>();
    for (const t of TAXONOMY_IDS) {
      const a = accountClassificationCoverage(ids, s, t, NOW);
      expect(a.total, t).toBe(31);
      expect(a.evaluated + a.stale + a.unsupported + a.unavailable, t).toBe(a.total);
      for (const st of ["stale", "unsupported", "unavailable"] as const) for (const r of Object.keys(a.byReason[st])) seen.add(r);
    }
    for (const sym of ids) { const c = classifyCurrency(s, sym); if (c.coverage.status !== "evaluated") seen.add(c.coverage.reason); }
    // label-side producer reasons the fixture exercises (not_processed needs an incomplete generation;
    // no_fund_record/record_unreadable/currency_missing/not_in_catalog/lane_unrecognized/
    // label_outside_vocabulary/record_undated are pinned by the producer's own pytest)
    for (const r of ["snapshot_undated", "taxonomy_ambiguous", "taxonomy_not_supplied", "asset_class_not_covered", "currency_not_applicable", "not_classified"]) {
      expect(seen.has(r), r).toBe(true);
    }
    const all = new Set<string>([...CLASSIFICATION_PRODUCER_REASONS.stale, ...CLASSIFICATION_PRODUCER_REASONS.unsupported, ...CLASSIFICATION_PRODUCER_REASONS.unavailable]);
    for (const r of seen) if (!["classification_aged"].includes(r)) expect(all.has(r), r).toBe(true);
  });
});

describe("AC-E03-01 — two listings of one issuer stay two listings", () => {
  it("keeps Tencent's HKD and CNY counters, and Alibaba's NYSE and HKEX listings, apart", () => {
    const s = ready();
    if (s.kind !== "ready") throw new Error("not ready");
    const pairs: [string, string, string, string][] = [
      ["0700.HK", "HKD", "80700.HK", "CNY"],
      ["BABA", "USD", "9988.HK", "HKD"],
    ];
    for (const [a, ca, b, cb] of pairs) {
      expect(classifyCurrency(s, a).code, a).toBe(ca);
      expect(classifyCurrency(s, b).code, b).toBe(cb);
      const ra = s.scan.rows.get(a), rb = s.scan.rows.get(b);
      expect(ra?.sym).toBe(a);
      expect(rb?.sym).toBe(b);
      expect(listingHref(a)).not.toBe(listingHref(b));
    }
    expect(s.scan.rows.get("BABA")?.mkt).toBe("NYSE");
    expect(s.scan.rows.get("9988.HK")?.mkt).toBe("HKEX");
    // the CNY counter does not inherit the HKD line's Yahoo label
    expect(cov(s, "80700.HK", "yahoo_sector")).toEqual({ status: "unavailable", reason: "not_classified" });
    expect(cov(s, "0700.HK", "yahoo_sector")).toEqual({ status: "evaluated", reason: "ok" });
  });

  it("matches the listing id exactly — no case folding, no suffix stripping, no ticker inference", () => {
    const s = ready();
    expect(classifyCurrency(s, "0700.hk").coverage).toEqual({ status: "unavailable", reason: "not_in_scan" });
    expect(classifyCurrency(s, "0700").coverage).toEqual({ status: "unavailable", reason: "not_in_scan" });
    // a listing the scan does not carry has no currency, whatever its suffix says
    expect(classifyCurrency(s, "0005.HK")).toMatchObject({ code: null, coverage: { reason: "not_in_scan" } });
    expect(classifyCurrency({ kind: "absent" }, "0700.HK").coverage).toEqual({ status: "unavailable", reason: "scan_absent" });
    expect(classifyCurrency({ kind: "error", error: "x" }, "AAPL").coverage).toEqual({ status: "unavailable", reason: "scan_unavailable" });
  });

  it("keeps minor-unit quotes exact and indices/rates/FX/futures out of money", () => {
    const s = ready();
    expect(classifyCurrency(s, "HSBA.L").code).toBe("GBp");
    for (const sym of ["^GSPC", "^TNX", "EURUSD=X", "ES=F"]) {
      expect(classifyCurrency(s, sym).coverage, sym).toEqual({ status: "unsupported", reason: "currency_not_applicable" });
    }
    expect(classifyCurrency(s, "BTC-USD").cell).toMatchObject({ code: "USD", source: "crypto_catalog" });
  });

  it("links each row to exactly its own listing, encoded", () => {
    expect(listingHref("0700.HK")).toBe("/terminal?sym=0700.HK");
    expect(listingHref("80700.HK")).toBe("/terminal?sym=80700.HK");
    expect(listingHref("^GSPC")).toBe("/terminal?sym=%5EGSPC");
    expect(listingHref("EURUSD=X")).toBe("/terminal?sym=EURUSD%3DX");
    expect(listingHref("")).toBeNull();
    expect(listingHref(42)).toBeNull();
  });
});

describe("falsifier — no approved crosswalk, so none is applied", () => {
  it("rejects a document that ships a crosswalk instead of applying it", () => {
    const d = raw();
    d.crosswalks = { "yahoo_sector→gics_sector": { Technology: "Information Technology" } };
    expect(parseClassificationScan(d)).toEqual({ ok: false, error: "crosswalks_unsupported" });
    expect(readClassificationScanResponse(200, d)).toEqual({ kind: "error", error: "crosswalks_unsupported" });
  });

  it("refuses a Yahoo label filed under GICS — the row turns malformed, never relabelled", () => {
    const d = raw();
    rowOf(d, "ARM").class.gics_sector = { status: "evaluated", reason: "ok", label: "Technology", as_of: "2026-10-01", source: "fund_profile", reclassified_from: null };
    const s = ready(d);
    if (s.kind !== "ready") throw new Error("not ready");
    expect(s.scan.rows.get("ARM")).toMatchObject({ kind: "malformed", error: "gics_sector:label_not_in_taxonomy" });
    expect(cov(s, "ARM", "gics_sector")).toEqual({ status: "unavailable", reason: "malformed_row" });
    // the rest of the document still reads
    expect(cov(s, "NVDA", "gics_sector")).toEqual({ status: "evaluated", reason: "ok" });
  });

  it("refuses the CN profile's own 'A-share' sentinel as a label", () => {
    const d = raw();
    rowOf(d, "688781.SS").class.cn_profile_sector = { status: "evaluated", reason: "ok", label: "A-share", as_of: "2026-10-10", source: "fund_profile", reclassified_from: null };
    const s = ready(d);
    if (s.kind !== "ready") throw new Error("not ready");
    expect(s.scan.rows.get("688781.SS")).toMatchObject({ kind: "malformed", error: "cn_profile_sector:label_is_sentinel" });
  });

  it("a Yahoo 'Technology' never answers a GICS 'Information Technology' screen", () => {
    const s = ready();
    const p = { taxonomy: "gics_sector" as const, op: "in" as const, labels: ["Information Technology"] };
    // ARM is Yahoo Technology with no GICS label at all → unknown, never pass
    expect(matchClassification(classifyLabel(s, "ARM", "gics_sector", NOW), p)).toBe("unknown");
    expect(matchClassification(classifyLabel(s, "NVDA", "gics_sector", NOW), p)).toBe("pass");
    // AAPL's stale snapshot matches only with the explicit opt-in
    expect(matchClassification(classifyLabel(s, "AAPL", "gics_sector", NOW), p)).toBe("unknown");
    expect(matchClassification(classifyLabel(s, "AAPL", "gics_sector", NOW), { ...p, includeStale: true })).toBe("pass");
  });
});

describe("reader rules", () => {
  it("treats a consumer-only reason in the document as malformed at that row", () => {
    const d = raw();
    rowOf(d, "PFE").class.yahoo_sector = { status: "stale", reason: "classification_aged", label: "Healthcare", as_of: null, source: "fund_profile", reclassified_from: null };
    rowOf(d, "PG").currency = { status: "unavailable", reason: "scan_absent" };
    const s = ready(d);
    if (s.kind !== "ready") throw new Error("not ready");
    expect(s.scan.rows.get("PFE")).toMatchObject({ kind: "malformed", error: "yahoo_sector:reason_reserved" });
    expect(s.scan.rows.get("PG")).toMatchObject({ kind: "malformed", error: "currency_reason_reserved" });
    expect(s.scan.rows.size).toBe(31);
  });

  it("rejects a currency that is 'stale' and a stale label with no provenance", () => {
    const d = raw();
    rowOf(d, "SPY").currency = { status: "stale", reason: "snapshot_undated" };
    rowOf(d, "AAPL").class.gics_sector = { status: "stale", reason: "snapshot_undated", label: "Information Technology", as_of: null };
    const s = ready(d);
    if (s.kind !== "ready") throw new Error("not ready");
    expect(s.scan.rows.get("SPY")).toMatchObject({ kind: "malformed", error: "currency_status_invalid" });
    expect(s.scan.rows.get("AAPL")).toMatchObject({ kind: "malformed", error: "gics_sector:source_invalid" });
  });

  it("rejects a taxonomy table that is not exactly the v1 set, and complete with unprocessed rows", () => {
    const d = raw();
    (d.taxonomies as Record<string, unknown>).naics = (d.taxonomies as Record<string, unknown>).gics_sector;
    expect(parseClassificationScan(d)).toEqual({ ok: false, error: "taxonomies_invalid" });
    const e = raw();
    rowOf(e, "AAPL").class.yahoo_sector = { status: "unavailable", reason: "not_processed", label: null };
    expect(parseClassificationScan(e)).toEqual({ ok: false, error: "complete_with_not_processed" });
    e.complete = false;
    expect(parseClassificationScan(e).ok).toBe(true);
  });

  it("ages every evaluated label stale/generation_stale once the generation is over four days old", () => {
    const s = ready();
    const later = Date.parse("2026-10-16T00:00:00Z"); // 4.9 days after generation
    expect(classifyLabel(s, "NVDA", "gics_sector", later).coverage).toEqual({ status: "stale", reason: "generation_stale" });
    expect(classifyLabel(s, "0700.HK", "yahoo_sector", later).coverage).toEqual({ status: "stale", reason: "generation_stale" });
    // the currency is a listing attribute: it does not age with the generation
    expect(classifyCurrency(s, "0700.HK").code).toBe("HKD");
  });

  it("maps HTTP outcomes: 404 absent, 5xx error, valid ready", () => {
    expect(readClassificationScanResponse(404, null)).toEqual({ kind: "absent" });
    expect(readClassificationScanResponse(503, null)).toEqual({ kind: "error", error: "http_503" });
    expect(readClassificationScanResponse(200, raw()).kind).toBe("ready");
    expect(readClassificationScanResponse(200, { schema: "nope" }).kind).toBe("error");
  });

  it("keeps a good read on screen, flagged, when its refresh fails; never downgrades to older", () => {
    const held = ready();
    expect(nextClassificationSource(held, { kind: "error", error: "refresh_failed" }).source).toMatchObject({ kind: "ready", refreshFailed: true });
    expect(nextClassificationSource(held, { kind: "absent" }).source).toMatchObject({ kind: "ready", refreshFailed: true });
    expect(nextClassificationSource(null, { kind: "absent" }).source).toEqual({ kind: "absent" });
    const older = raw(); older.generation -= 86_400;
    const o = nextClassificationSource(held, ready(older));
    expect(o.decision?.adopt).toBe(false);
    expect(o.source.kind === "ready" && held.kind === "ready" && o.source.scan === held.scan).toBe(true);
    const newer = raw(); newer.generation += 86_400; newer.generated_at = "2026-10-12T02:00:00Z";
    const n = nextClassificationSource(held, ready(newer));
    expect(n.decision).toEqual({ adopt: true, reason: "newer_complete" });
  });
});

describe("predicates", () => {
  it("splits a taxonomy into three disjoint populations: current, stale-labelled, unclassified", () => {
    const s = ready();
    const syms = raw().rows.map((r) => r.sym);
    for (const t of TAXONOMY_IDS) {
      for (const sym of syms) {
        const c = classifyLabel(s, sym, t, NOW);
        const anyLabel = matchClassification(c, { taxonomy: t, op: "in", labels: [c.cell?.label ?? "∅"], includeStale: true }) === "pass";
        const current = labelCellOf(c).known;
        const uncl = matchClassification(c, { taxonomy: t, op: "unclassified" }) === "pass";
        // exactly one of: current label, stale label only, no label
        const stale = anyLabel && !current;
        expect([current, stale, uncl].filter(Boolean).length, `${t} ${sym}`).toBe(1);
      }
    }
  });

  it("a record that was not read is a fourth population: unknown under every predicate, never 'unclassified'", () => {
    const unclassified = (src: ClassificationScanSource, sym: string, t: TaxonomyId = "yahoo_sector") =>
      matchClassification(classifyLabel(src, sym, t, NOW), { taxonomy: t, op: "unclassified" });
    // a failed or absent read is not an empty result (failure-state truth)
    expect(unclassified({ kind: "absent" }, "0700.HK")).toBe("unknown");
    expect(unclassified({ kind: "error", error: "http_500" }, "0700.HK")).toBe("unknown");
    expect(unclassified(ready(), "NOT.A.ROW")).toBe("unknown"); // not_in_scan
    // the owner record could not be read, or the generation never reached the row
    const d = raw();
    rowOf(d, "80700.HK").class.yahoo_sector = { status: "unavailable", reason: "record_unreadable" };
    rowOf(d, "9988.HK").class.yahoo_sector = { status: "unavailable", reason: "not_processed", label: null };
    d.complete = false;
    const s = ready(d);
    expect(unclassified(s, "80700.HK")).toBe("unknown");
    expect(unclassified(s, "9988.HK")).toBe("unknown");
    // a READ that found no label is still the unclassified population
    expect(unclassified(ready(), "80700.HK")).toBe("pass");
    expect(unclassified(ready(), "0700.HK")).toBe("fail");
    // and a not-read record never answers a label predicate either
    expect(matchClassification(classifyLabel({ kind: "absent" }, "0700.HK", "yahoo_sector", NOW), { taxonomy: "yahoo_sector", op: "in", labels: ["Communication Services"] })).toBe("unknown");
  });

  it("validates a stored predicate and never widens one", () => {
    expect(parseClassificationPredicate({ taxonomy: "gics_sector", op: "in", labels: ["Energy"] }))
      .toEqual({ ok: true, value: { taxonomy: "gics_sector", op: "in", labels: ["Energy"] } });
    expect(parseClassificationPredicate({ taxonomy: "naics", op: "in", labels: ["x"] }).ok).toBe(false);
    expect(parseClassificationPredicate({ taxonomy: "gics_sector", op: "in", labels: [] }).ok).toBe(false);
    expect(parseClassificationPredicate({ taxonomy: "yahoo_sector", op: "unclassified" }))
      .toEqual({ ok: true, value: { taxonomy: "yahoo_sector", op: "unclassified" } });
    expect(parseClassificationPredicate({ taxonomy: "gics_sector", op: "in", labels: ["Energy"], includeStale: "yes" }).ok).toBe(false);
  });
});
