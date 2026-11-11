import { describe, expect, it } from "vitest";
import { DEFAULT_SECTOR_STATE, parseSectorState, type SectorState } from "@/lib/sectorIntelligence";
import { encodeSectorDepthReturn } from "@/lib/sectorDepthReturn";
import {
  NATIVE_SECTOR_ETFS, nativeSectorEtf, parseSectorPortfolioContext, sectorEtfHolding,
  sectorPortfolioCopy, sectorPortfolioHref, sectorPortfolioReturnHref,
} from "@/lib/sectorPortfolioContext";
import type { Position } from "@/lib/portfolio";

/** The cohort this lane admits is the closed v1 native sector-ETF identity set. */
const OPENERS = {
  discover: { ...DEFAULT_SECTOR_STATE },
  rotation: { ...DEFAULT_SECTOR_STATE, workspace: "rotation" as const, sector: "xle", rotationMode: "list" as const },
  breadth: { ...DEFAULT_SECTOR_STATE, workspace: "breadth" as const, sector: "xlv" },
};

let sequence = 0;
const lot = (ticker: string, over: Partial<Position> = {}): Position => {
  sequence += 1;
  return { id: `pos-${sequence}`, ticker, shares: 10, entryPrice: 100, entryCurrency: "USD",
    entryDate: null, notes: null, status: "open", createdAt: null, ...over };
};
const book = (over: { unreadable?: boolean; stale?: boolean } = {}) => ({
  unreadable: over.unreadable ?? false, stale: over.stale ?? false,
});

describe("the native sector-ETF identity", () => {
  it("admits exactly the eleven closed v1 wire identities", () => {
    expect([...NATIVE_SECTOR_ETFS]).toEqual(
      ["XLB", "XLC", "XLE", "XLF", "XLI", "XLK", "XLP", "XLRE", "XLU", "XLV", "XLY"]);
    for (const etf of NATIVE_SECTOR_ETFS) expect(nativeSectorEtf(etf)).toBe(etf);
  });

  it.each(["SPY", "QQQ", "NVDA", "AMD", "XLKK", "xlk", " XLK", "XLK ", "", null, undefined, 42, {}])(
    "refuses the foreign or malformed identity %s", value => {
      expect(nativeSectorEtf(value)).toBeNull();
    });
});

describe("the Portfolio address", () => {
  it("carries the one native identity and the incumbent's own bounded opener snapshot", () => {
    const href = sectorPortfolioHref("XLK", OPENERS.rotation)!;
    expect(href).not.toBeNull();
    const url = new URL(href, "https://mastermind.invalid");
    expect(url.pathname).toBe("/portfolio");
    expect(url.searchParams.getAll("sector")).toEqual(["XLK"]);
    expect(url.searchParams.get("sectorReturn")).toBe("sectorWorkspace=rotation&sectorRotationMode=list&sector=xle");
  });

  it("refuses a foreign identity, a missing opener and an opener the incumbent cannot capture", () => {
    expect(sectorPortfolioHref("SPY", OPENERS.discover)).toBeNull();
    expect(sectorPortfolioHref("XLK", null)).toBeNull();
    expect(sectorPortfolioHref("XLK", { ...DEFAULT_SECTOR_STATE, workspace: "detail" })).toBeNull();
    expect(sectorPortfolioHref("XLK", { ...DEFAULT_SECTOR_STATE, sourceFamily: "finviz" })).toBeNull();
    expect(sectorPortfolioHref("XLK", { ...DEFAULT_SECTOR_STATE, sourcesOpen: true })).toBeNull();
  });

  it("withholds the link when its full opener would lose filters", () => {
    const opener: SectorState = { ...DEFAULT_SECTOR_STATE, workspace: "rotation", sector: "xle",
      finvizTheme: "科".repeat(180), finvizSubtheme: "科".repeat(180), discoveryQuery: "科".repeat(60),
      companyTableQuery: "科".repeat(60), matrixIndustry: "科".repeat(120),
      rotationQuery: "科".repeat(60), query: "科".repeat(40) };
    expect(encodeSectorDepthReturn(opener)!.length).toBeGreaterThan(1024);
    expect(sectorPortfolioHref("XLE", opener)).toBeNull();
  });

  it("never carries a dossier value, an account identity or a book fact", () => {
    const href = sectorPortfolioHref("XLK", OPENERS.discover)!;
    expect(href).not.toMatch(/NVDA|AMD|bookKey|user|account|weight|position|target/i);
  });
});

describe("the admitted context", () => {
  it("reads back the identity and the decoded opener", () => {
    const href = sectorPortfolioHref("XLK", OPENERS.rotation)!;
    const context = parseSectorPortfolioContext(href);
    expect(context?.etf).toBe("XLK");
    expect(context?.opener).toEqual(OPENERS.rotation);
    expect(parseSectorPortfolioContext(`https://app.mastermind-x.com${href}`)?.etf).toBe("XLK");
  });

  it.each([
    ["a duplicated identity", "/portfolio?sector=XLK&sector=XLE&sectorReturn=sectorWorkspace%3Ddiscover"],
    ["a duplicated snapshot", "/portfolio?sector=XLK&sectorReturn=sectorWorkspace%3Ddiscover&sectorReturn=sectorWorkspace%3Drotation"],
    ["a foreign sector", "/portfolio?sector=SPY&sectorReturn=sectorWorkspace%3Ddiscover"],
    ["a malformed sector", "/portfolio?sector=xlk&sectorReturn=sectorWorkspace%3Ddiscover"],
    ["a missing sector", "/portfolio?sectorReturn=sectorWorkspace%3Ddiscover"],
    ["a missing snapshot", "/portfolio?sector=XLK"],
    ["an empty snapshot", "/portfolio?sector=XLK&sectorReturn="],
    ["a noncanonical snapshot", "/portfolio?sector=XLK&sectorReturn=sectorWorkspace%3Ddiscover%26next%3Dhttps%253A%252F%252Fexample.com"],
    ["a recursive snapshot", "/portfolio?sector=XLK&sectorReturn=sectorWorkspace%3Ddiscover%26sectorReturn%3DsectorWorkspace%3Ddiscover"],
    ["an oversized snapshot", `/portfolio?sector=XLK&sectorReturn=${"x".repeat(8193)}`],
    ["a path-shaped snapshot", "/portfolio?sector=XLK&sectorReturn=%2Fdiscover%3FsectorWorkspace%3Ddiscover"],
    ["an external snapshot", "/portfolio?sector=XLK&sectorReturn=https%3A%2F%2Fexample.com%2Fdiscover"],
    ["an empty address", ""],
  ])("refuses %s", (_label, href) => {
    expect(parseSectorPortfolioContext(href)).toBeNull();
  });

  it("refuses a snapshot the incumbent parser does not accept", () => {
    const noncanonical = encodeSectorDepthReturn({ ...DEFAULT_SECTOR_STATE, workspace: "discover" }) + "&extra=1";
    expect(parseSectorPortfolioContext(`/portfolio?sector=XLK&sectorReturn=${encodeURIComponent(noncanonical)}`)).toBeNull();
  });
});

describe("the admitted return", () => {
  it("returns to the exact selection through the relative Sector route", () => {
    const href = sectorPortfolioHref("XLK", OPENERS.rotation)!;
    const back = sectorPortfolioReturnHref(parseSectorPortfolioContext(href))!;
    expect(back).toBe("/discover?tab=sectors&sectorWorkspace=rotation&sectorRotationMode=list&sector=xle");
    expect(back.startsWith("/discover?")).toBe(true);
    expect(back).not.toMatch(/^https?:|^\/\//);
    const url = new URL(back, "https://mastermind.invalid");
    expect(url.searchParams.get("tab")).toBe("sectors");
    expect(url.searchParams.get("sectorWorkspace")).toBe("rotation");
    expect(url.searchParams.get("sector")).toBe("xle");
  });

  it("keeps the filters and the selection of the admitted opener", () => {
    const opener: SectorState = { ...DEFAULT_SECTOR_STATE, sector: "xlf", group: "banks",
      discoveryQuery: "trust", discoveryMode: "table" };
    const href = sectorPortfolioHref("XLF", opener)!;
    const back = sectorPortfolioReturnHref(parseSectorPortfolioContext(href))!;
    const params = new URL(back, "https://mastermind.invalid").searchParams;
    expect(params.get("sector")).toBe("xlf");
    expect(params.get("group")).toBe("banks");
    expect(params.get("sectorDiscoveryQuery")).toBe("trust");
    expect(params.get("sectorDiscoveryMode")).toBe("table");
  });

  it("returns from Portfolio to the exact nondefault breadth selection", () => {
    const opener: SectorState = { ...DEFAULT_SECTOR_STATE, workspace: "breadth", sector: "xle",
      breadthSort: "contract", breadthWindow: 1, discoveryQuery: "Energy", theme: "light" };
    const href = sectorPortfolioHref("XLE", opener)!;
    const context = parseSectorPortfolioContext(href);
    expect(context?.opener).toEqual(opener);
    const back = sectorPortfolioReturnHref(context)!;
    const url = new URL(back, "https://mastermind.invalid");
    expect(url.pathname).toBe("/discover");
    expect(url.searchParams.get("tab")).toBe("sectors");
    expect(parseSectorState(url.searchParams)).toEqual(opener);
  });

  it("refuses a context whose snapshot no longer decodes", () => {
    expect(sectorPortfolioReturnHref(null)).toBeNull();
    expect(sectorPortfolioReturnHref({ etf: "XLK", snapshot: "not=canonical", opener: DEFAULT_SECTOR_STATE })).toBeNull();
  });
});

describe("the direct ETF holding", () => {
  it("counts only exact open records and sums multiple open lots", () => {
    const holding = sectorEtfHolding([lot("XLK"), lot("XLK", { shares: 5, entryPrice: 200 }),
      lot("XLK", { status: "closed" }), lot("XLF")], "XLK", book())!;
    expect(holding.openRecords).toBe(2);
    expect(holding.coveredRecords).toBe(2);
    // 1000 + 1000 of an eligible 3000 recorded cost.
    expect(holding.eligibleCost).toBe(3000);
    expect(holding.eligibleLots).toBe(3);
    expect(holding.currency).toBe("USD");
    expect(holding.weightPct).toBe(66.7);
  });

  it("does not read a closed lot as a holding", () => {
    const holding = sectorEtfHolding([lot("XLK", { status: "closed" })], "XLK", book())!;
    expect(holding.openRecords).toBe(0);
    expect(holding.gap).toBe("not_held");
    expect(holding.weightPct).toBeNull();
  });

  it("never implies sector exposure from a technology stock", () => {
    const holding = sectorEtfHolding([lot("NVDA"), lot("AMD")], "XLK", book())!;
    expect(holding.openRecords).toBe(0);
    expect(holding.gap).toBe("not_held");
    expect(holding.weightPct).toBeNull();
  });

  it("reports an empty book as no directly held record, not as a number", () => {
    const holding = sectorEtfHolding([], "XLK", book())!;
    expect(holding.openRecords).toBe(0);
    expect(holding.gap).toBe("not_held");
    expect(holding.weightPct).toBeNull();
  });

  it("withholds the number when the book is unreadable or stale", () => {
    const positions = [lot("XLK"), lot("XLF")];
    const unreadable = sectorEtfHolding(positions, "XLK", book({ unreadable: true }))!;
    expect(unreadable.gap).toBe("unreadable");
    expect(unreadable.weightPct).toBeNull();
    const stale = sectorEtfHolding(positions, "XLK", book({ stale: true }))!;
    expect(stale.gap).toBe("stale");
    expect(stale.weightPct).toBeNull();
  });

  it("never turns an unreadable book into a claim that nothing is held", () => {
    const unreadable = sectorEtfHolding([], "XLK", book({ unreadable: true }))!;
    expect(unreadable.gap).toBe("unreadable");
    expect(unreadable.weightPct).toBeNull();
    const stale = sectorEtfHolding([], "XLK", book({ stale: true }))!;
    expect(stale.gap).toBe("stale");
    expect(stale.weightPct).toBeNull();
  });

  it("withholds the number when the entry currency is unknown or mixed", () => {
    const unknown = sectorEtfHolding([lot("XLK", { entryCurrency: null }), lot("XLF")], "XLK", book())!;
    expect(unknown.gap).toBe("currency_unknown");
    expect(unknown.weightPct).toBeNull();
    const mixed = sectorEtfHolding([lot("XLK"), lot("XLF", { entryCurrency: "HKD" })], "XLK", book())!;
    expect(mixed.gap).toBe("currency_mismatch");
    expect(mixed.weightPct).toBeNull();
  });

  it("withholds the number when the basis is missing or the recorded cost overflows", () => {
    const missing = sectorEtfHolding([lot("XLK", { shares: null }), lot("XLF")], "XLK", book())!;
    expect(missing.gap).toBe("missing_basis");
    expect(missing.weightPct).toBeNull();
    const overflow = sectorEtfHolding([lot("XLK", { shares: 1e308, entryPrice: 1e10 }), lot("XLF")], "XLK", book())!;
    expect(overflow.gap).toBe("amount_overflow");
    expect(overflow.weightPct).toBeNull();
  });

  it("withholds the number when no eligible cost is recorded at all", () => {
    const holding = sectorEtfHolding([lot("XLK", { shares: null })], "XLK", book())!;
    expect(holding.gap).toBe("no_eligible_cost");
    expect(holding.weightPct).toBeNull();
  });

  it("never renormalizes around a gap lot", () => {
    const holding = sectorEtfHolding([lot("XLK", { shares: 10, entryPrice: 100 }),
      lot("XLK", { shares: null }), lot("XLF")], "XLK", book())!;
    expect(holding.gap).toBe("missing_basis");
    expect(holding.weightPct).toBeNull();
    expect(holding.eligibleCost).toBe(2000);
  });

  it("refuses a foreign identity outright", () => {
    expect(sectorEtfHolding([lot("SPY")], "SPY", book())).toBeNull();
  });
});

describe("the admitted copy", () => {
  it("gives every key an English and a Chinese string", () => {
    const en = sectorPortfolioCopy("en"), zh = sectorPortfolioCopy("zh");
    for (const key of ["viewInPortfolio", "selectedSector", "scope", "holdingTitle", "noDirectRecord",
      "noDirectRecordHint", "costShare", "weightValue", "weightCoverage", "backDiscover",
      "backRotation", "backBreadth"] as const) {
      expect(en(key)).not.toBe("");
      expect(zh(key)).not.toBe("");
      expect(zh(key)).not.toBe(en(key));
    }
  });
});
