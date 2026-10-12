/**
 * heatmapCapitalization.test.ts — deterministic A15 real-cap tests.
 *
 * Distinguishes legacy SizingMode "cap" (price×volume proxy) from the new
 * "marketCap" mode (finite positive source mcap in USD). Exercises the ACTUAL
 * modules: terminal/lib/heatmapCapitalization.ts and Treemap's exported
 * treemapTileValue + HeatmapView's buildTiles.
 *
 * These fixtures are synthetic — not live market data.
 */

import { describe, it, expect } from "vitest";
import {
  MARKET_CAP_SOURCE,
  classifyMarketCap,
  hasUsableMarketCap,
  marketCapSizingValue,
  legacyCapProxyValue,
  capCoverage,
  partitionMarketCapTiles,
} from "@/lib/heatmapCapitalization";
import { treemapTileValue } from "@/components/heatmap/Treemap";
import { buildTiles } from "@/components/heatmap/HeatmapView";
import type { HeatmapTile } from "@/components/heatmap/types";
import type { ManifestPayload } from "@/components/heatmap/types";

// ─── helpers ─────────────────────────────────────────────────────────────────

function tile(partial: Partial<HeatmapTile> & { ticker: string }): HeatmapTile {
  return {
    name: partial.ticker,
    sector: "Other",
    price: 100,
    chg1d: 0,
    vol: 1000,
    hasFlow: false,
    ...partial,
  };
}

// ─── classifyMarketCap ───────────────────────────────────────────────────────

describe("classifyMarketCap", () => {
  it("accepts finite positive USD values", () => {
    expect(classifyMarketCap(1)).toEqual({ status: "ok", value: 1 });
    expect(classifyMarketCap(3.5e12)).toEqual({ status: "ok", value: 3.5e12 });
  });

  it("marks absent keys as missing (no fabricated value)", () => {
    expect(classifyMarketCap(undefined).status).toBe("missing");
    expect(classifyMarketCap(null).status).toBe("missing");
  });

  it("marks zero/negative/NaN/Infinity/non-number as invalid — never floored positive", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "1e12", {}, []]) {
      const c = classifyMarketCap(bad);
      expect(c.status).toBe("invalid");
      expect(c.value).toBeUndefined();
    }
  });

  it("hasUsableMarketCap agrees with classify status", () => {
    expect(hasUsableMarketCap(500)).toBe(true);
    expect(hasUsableMarketCap(0)).toBe(false);
    expect(hasUsableMarketCap(undefined)).toBe(false);
    expect(hasUsableMarketCap(Number.NaN)).toBe(false);
  });
});

// ─── marketCap sizing vs legacy cap proxy ────────────────────────────────────

describe("marketCap sizing is distinct from legacy price×volume cap", () => {
  const A = tile({ ticker: "AAA", price: 100, vol: 1000, mcap: 1e9 });
  const B_samePV_100xCap = tile({ ticker: "BBB", price: 100, vol: 1000, mcap: 100e9 });
  const C_sameCap_diffVol = tile({ ticker: "CCC", price: 100, vol: 999_999, mcap: 1e9 });

  it("same price-volume + 100x source cap → 100x area in marketCap mode", () => {
    const a = treemapTileValue(A, "marketCap", "price");
    const b = treemapTileValue(B_samePV_100xCap, "marketCap", "price");
    expect(a).toBe(1e9);
    expect(b).toBe(100e9);
    expect(b / a).toBe(100);
  });

  it("same cap / different volume → equal area in marketCap mode", () => {
    const a = treemapTileValue(A, "marketCap", "price");
    const c = treemapTileValue(C_sameCap_diffVol, "marketCap", "price");
    expect(c).toBe(a);
  });

  it("legacy cap unchanged: 100x source cap does NOT change legacy proxy area", () => {
    const a = treemapTileValue(A, "cap", "price");
    const b = treemapTileValue(B_samePV_100xCap, "cap", "price");
    expect(a).toBe(100 * 1000); // price×vol, floor 1
    expect(b).toBe(a); // mcap must not leak into legacy cap
  });

  it("legacy cap unchanged: different volume still scales legacy proxy", () => {
    const a = treemapTileValue(A, "cap", "price");
    const c = treemapTileValue(C_sameCap_diffVol, "cap", "price");
    expect(c).not.toBe(a);
    expect(c).toBe(100 * 999_999);
  });

  it("legacyCapProxyValue preserves the pre-A15 formula (floor 1, independent of mcap)", () => {
    expect(legacyCapProxyValue(100, 1000)).toBe(100_000);
    expect(legacyCapProxyValue(0, 0)).toBe(1);
    expect(legacyCapProxyValue(undefined, undefined)).toBe(1);
    // mcap is not an input — the proxy cannot be reinterpreted
    expect(legacyCapProxyValue(10, 10)).toBe(100);
  });

  it("marketCapSizingValue: missing/invalid → 0 (no arbitrary positive floor)", () => {
    expect(marketCapSizingValue(undefined)).toBe(0);
    expect(marketCapSizingValue(null)).toBe(0);
    expect(marketCapSizingValue(0)).toBe(0);
    expect(marketCapSizingValue(-5)).toBe(0);
    expect(marketCapSizingValue(Number.NaN)).toBe(0);
    expect(marketCapSizingValue(Number.POSITIVE_INFINITY)).toBe(0);
    // Treemap path: missing-cap tiles take zero area weight
    expect(treemapTileValue(tile({ ticker: "ZZZ", mcap: undefined }), "marketCap", "price")).toBe(0);
    expect(treemapTileValue(tile({ ticker: "ZZZ", mcap: 0 }), "marketCap", "price")).toBe(0);
    expect(treemapTileValue(tile({ ticker: "ZZZ", mcap: Number.NaN }), "marketCap", "price")).toBe(0);
  });

  it("legacy cap still floors at 1 even when mcap is absent (old saved views intact)", () => {
    const bare = tile({ ticker: "BBB", price: 0, vol: 0, mcap: undefined });
    expect(treemapTileValue(bare, "cap", "price")).toBe(1);
  });
});

// ─── named provenance + cached-reference limitation ──────────────────────────

describe("MARKET_CAP_SOURCE provenance", () => {
  it("names the Polygon reference-cache key and USD unit; as-of unknown", () => {
    expect(MARKET_CAP_SOURCE.referenceKey).toBe("market_cap_usd");
    expect(MARKET_CAP_SOURCE.manifestField).toBe("mcap");
    expect(MARKET_CAP_SOURCE.unit).toBe("USD");
    expect(MARKET_CAP_SOURCE.ingestModule).toBe("ingest/build_universe.py");
    expect(MARKET_CAP_SOURCE.cache).toBe("Polygon reference cache");
    expect(MARKET_CAP_SOURCE.financialAsOf).toBeNull();
    expect(MARKET_CAP_SOURCE.limitation).toBe("named cached-reference limitation");
    expect(MARKET_CAP_SOURCE.tileProvenance).toBe("polygon_ref_market_cap_usd");
  });
});

// ─── coverage + partition (disclosure, not fabricated area) ──────────────────

describe("capCoverage / partitionMarketCapTiles", () => {
  const tiles = [
    tile({ ticker: "OK1", mcap: 1e9 }),
    tile({ ticker: "OK2", mcap: 2e9 }),
    tile({ ticker: "MISS", mcap: undefined }),
    tile({ ticker: "ZERO", mcap: 0 }),
    tile({ ticker: "NAN", mcap: Number.NaN }),
    tile({ ticker: "INF", mcap: Number.POSITIVE_INFINITY }),
  ];

  it("counts usable / missing / invalid against the passed population", () => {
    const cov = capCoverage(tiles);
    expect(cov.total).toBe(6);
    expect(cov.withCap).toBe(2);
    expect(cov.missingCap).toBe(1);
    expect(cov.invalidCap).toBe(3);
    expect(cov.missingTickers).toEqual(["MISS"]);
    expect(cov.invalidTickers).toEqual(["ZERO", "NAN", "INF"]);
  });

  it("partition keeps missing/invalid visible but out of cap area", () => {
    const { usable, excluded } = partitionMarketCapTiles(tiles);
    expect(usable.map(t => t.ticker)).toEqual(["OK1", "OK2"]);
    expect(excluded.map(t => t.ticker).sort()).toEqual(["INF", "MISS", "NAN", "ZERO"]);
  });
});

// ─── buildTiles: mcap propagation + provenance + prune vs scoped universe ────

describe("buildTiles propagates source mcap + provenance; prune ≠ breadth base", () => {
  function manifestOf(symbols: ManifestPayload["symbols"]): ManifestPayload {
    return {
      as_of: "2026-01-01",
      source: "macro-multimarket",
      symbols,
    };
  }

  it("retains finite positive mcap and writes named provenance onto the tile", () => {
    const man = manifestOf({
      NVDA: { name: "NVIDIA", sec: "Equities", last: 100, chg: 1.2, vol: 1e7, mcap: 3e12 },
      CASH: { name: "No Cap Co", sec: "Equities", last: 10, chg: 0, vol: 1e5 },
      ZERO: { name: "Zero Cap", sec: "Equities", last: 5, chg: 0, vol: 1e5, mcap: 0 },
    });
    const { tiles } = buildTiles(man, null);
    const nvda = tiles.find(t => t.ticker === "NVDA")!;
    const cash = tiles.find(t => t.ticker === "CASH")!;
    const zero = tiles.find(t => t.ticker === "ZERO")!;

    expect(nvda.mcap).toBe(3e12);
    expect(nvda.mcapSource).toBe(MARKET_CAP_SOURCE.tileProvenance);
    // missing key stays missing (undefined) — not coerced to 0
    expect(cash.mcap).toBeUndefined();
    expect(cash.mcapSource).toBeUndefined();
    // invalid key retained raw so coverage can disclose it as invalid
    expect(zero.mcap).toBe(0);
    expect(zero.mcapSource).toBe(MARKET_CAP_SOURCE.tileProvenance);

    const cov = capCoverage(tiles);
    expect(cov.withCap).toBe(1);
    expect(cov.missingCap).toBe(1);
    expect(cov.invalidCap).toBe(1);
  });

  it("render pruning to ~500 does not rewrite original scoped universe / coverage base", () => {
    const symbols: ManifestPayload["symbols"] = {};
    // 600 US plain tickers → exceeds MAX_TILES=500
    for (let i = 0; i < 600; i++) {
      const tk = `TK${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + i % 26)}`;
      const rec: ManifestPayload["symbols"][string] = {
        name: `Name ${tk}`,
        sec: "Equities",
        last: 10 + (i % 50),
        chg: (i % 7) - 3,
        vol: 1000 + i,
      };
      if (i % 3 === 0) rec.mcap = 1e9 * (i + 1); // 200 with cap
      else if (i % 3 === 1) rec.mcap = 0;       // invalid
      // else missing
      symbols[tk] = rec;
    }
    const man = manifestOf(symbols);
    const { tiles, scopedTiles, pruned } = buildTiles(man, null);

    expect(pruned).toBe(true);
    expect(scopedTiles.length).toBe(600);
    expect(tiles.length).toBe(500);
    // Coverage base = original scoped universe, NOT the render subset
    const covRendered = capCoverage(tiles);
    const covScoped = capCoverage(scopedTiles);
    expect(covScoped.total).toBe(600);
    expect(covRendered.total).toBe(500);
    expect(covScoped.withCap).toBe(200);
    expect(covScoped.invalidCap).toBe(200);
    expect(covScoped.missingCap).toBe(200);
  });

  it("breadth population comes from scopedTiles, not the pruned render set", () => {
    const symbols: ManifestPayload["symbols"] = {};
    for (let i = 0; i < 520; i++) {
      const tk = `BR${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + i % 26)}`;
      symbols[tk] = {
        name: `Breadth ${tk}`,
        sec: "Equities",
        last: 20,
        chg: i % 2 === 0 ? 1 : -1, // all 520 are advancers or decliners
        vol: 500,
        mcap: 1e8,
      };
    }
    const { tiles, scopedTiles } = buildTiles(manifestOf(symbols), null);
    expect(scopedTiles.length).toBe(520);
    expect(tiles.length).toBe(500);
    // Scoped universe retains every valid-priced name for the breadth denominator
    expect(scopedTiles.filter(t => t.chg1d > 0).length + scopedTiles.filter(t => t.chg1d < 0).length)
      .toBe(520);
  });
});
