import { describe, expect, it } from "vitest";
import { chunkSymbols } from "@/lib/watchlists";
import {
  parseWatchlistCsv,
  planWatchlistCsvImport,
  serializeWatchlistCsv,
  type WatchlistCsvRow,
} from "@/lib/watchlistCsv";

const row = (symbol: string, section = ""): WatchlistCsvRow => ({ symbol, section });
const parsed = (text: string) => {
  const result = parseWatchlistCsv(text);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("expected valid CSV");
  return result;
};

describe("Watchlist CSV exact round-trip", () => {
  it("preserves comma, double quote, non-ASCII, empty root and genuine apostrophe prefixes", () => {
    const originals = [
      row("AAPL", "Core, US"),
      row("9988.HK", 'Core "HK"'),
      row("BTC-USD", "科技與成長"),
      row("CME_MINI:ES1!", ""),
      row("NEM", "'Growth"),
      row("MSFT", "'=a genuine apostrophe"),
    ];
    const exported = serializeWatchlistCsv(originals);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.csv).toContain('AAPL,"Core, US"');
    expect(exported.csv).toContain('9988.HK,"Core ""HK"""');
    expect(parsed(exported.csv)).toEqual({ ok: true, rows: originals, invalid: 0 });
  });

  it("exports safe lists after a blocked list, without any row alteration", () => {
    expect(serializeWatchlistCsv([row("AAPL"), row("MSFT", "=1+1")])).toEqual({
      ok: false, row: 2, column: "section",
    });
    const safe = serializeWatchlistCsv([row("AAPL", "'=1+1")]);
    expect(safe).toEqual({ ok: true, csv: "symbol,section\nAAPL,'=1+1" });
  });

  it.each(["=", "+", "-", "@"])("refuses %s in either column, with whitespace and BOM prefixes", (prefix) => {
    for (const raw of [`${prefix}1+1`, `  ${prefix}1+1`, `\uFEFF \t${prefix}1+1`]) {
      expect(serializeWatchlistCsv([row(raw, "safe")])).toEqual({
        ok: false, row: 1, column: "symbol",
      });
      expect(serializeWatchlistCsv([row("AAPL", raw)])).toEqual({
        ok: false, row: 1, column: "section",
      });
    }
  });

  it("refuses leading control fields and any embedded canonical controls", () => {
    for (const label of [" \tAAPL", "\nunsafe", "abc\u0000", "a\u007fb"]) {
      expect(serializeWatchlistCsv([row("AAPL", label)]).ok).toBe(false);
    }
  });

  it("does not truncate a safe symbol list and keeps ordinary output order", () => {
    const source = [row("SPY", "Core"), row("MSFT", ""), row("NVDA", "Tech")];
    expect(serializeWatchlistCsv(source)).toEqual({
      ok: true, csv: "symbol,section\nSPY,Core\nMSFT,\nNVDA,Tech",
    });
  });
});

describe("Watchlist CSV import logical records and strict shape", () => {
  it("handles both quoted LF and quoted CRLF without phantom tickers", () => {
    const content = 'symbol,section\r\nSPY,Core\r\nAAPL,"Core\r\nUS"\r\nMSFT,Tech\r\nQQQ,"Growth\nUS"\r\nNEM,Gold\r\n';
    expect(parsed(content)).toEqual({
      ok: true, rows: [row("SPY", "Core"), row("MSFT", "Tech"), row("NEM", "Gold")], invalid: 2,
    });
    const plan = planWatchlistCsvImport([], parsed(content).rows);
    expect(plan.symbols).toEqual(["SPY", "MSFT", "NEM"]);
    expect(plan.symbols).not.toContain("US");
    expect(plan.symbols).not.toContain("GROWTH");
  });

  it("parses quoted comma, doubled quotes and optional leading file BOM", () => {
    expect(parsed('\uFEFFsymbol,section\r\nAAPL,"Core, US"\r\nMSFT,"Joe ""Trader"""\r\n')).toEqual({
      ok: true, invalid: 0, rows: [row("AAPL", "Core, US"), row("MSFT", 'Joe "Trader"')],
    });
  });

  it("accepts optional single or double header, and headerless TXT", () => {
    expect(parsed("symbol\n aapl \n msft \n").rows).toEqual([row("AAPL"), row("MSFT")]);
    expect(parsed("symbol,section\n aapl , Core \n").rows).toEqual([row("AAPL", "Core")]);
    expect(parsed("BTC-USD\n9988.HK\nCME_MINI:ES1!\n").rows).toEqual([
      row("BTC-USD"), row("9988.HK"), row("CME_MINI:ES1!"),
    ]);
  });

  it.each([
    ['symbol,section\nAAPL,"Core\n', "malformed"],
    ['AAPL,Co"re', "malformed"],
    ['"AAPL"x,Core', "malformed"],
    ['AAPL,"Core" extra', "malformed"],
    ['AAPL,Core,Extra', "extra_fields"],
    ['symbol,section,extra\nAAPL,Core', "extra_fields"],
  ] as const)("rejects malformed quoting or extra fields without yielding accepted rows: %s", (csv, reason) => {
    const result = parseWatchlistCsv(csv);
    expect(result).toMatchObject({ ok: false, reason });
  });

  it("skips invalid records and keeps their neighbors", () => {
    const result = parsed([
      "symbol,section",
      "SPY,Core",
      "\u0000X,Core",
      "MSFT,Growth",
      "AAPL,\u007Fbad",
      "NEM,Miners",
    ].join("\n"));
    expect(result.rows).toEqual([row("SPY", "Core"), row("MSFT", "Growth"), row("NEM", "Miners")]);
    expect(result.invalid).toBe(2);
  });

  it("uses canonical JS code-unit boundaries, while accepting composite symbols", () => {
    const csv = [
      "symbol,section",
      `${"X".repeat(128)},${"S".repeat(80)}`,
      `${"Y".repeat(129)},Safe`,
      `NVDA,${"Z".repeat(81)}`,
      "BTC-USD,",
      "9988.HK,Asia",
      "CME_MINI:ES1!,Futures",
      "BAD\u007f,Core",
    ].join("\n");
    const r = parsed(csv);
    expect(r.rows).toEqual([
      row("X".repeat(128), "S".repeat(80)),
      row("BTC-USD", ""),
      row("9988.HK", "Asia"),
      row("CME_MINI:ES1!", "Futures"),
    ]);
    expect(r.invalid).toBe(3);
  });

  it("treats missing sections as the empty root and trims both fields", () => {
    expect(parsed("  aapl  \n mSft, \nNVDA,  Tech  ").rows).toEqual([
      row("AAPL", ""), row("MSFT", ""), row("NVDA", "Tech"),
    ]);
  });

  it("handles empty, BOM-only, blank-lines and header-only files without mutations", () => {
    for (const input of ["", "\uFEFF", "\n\r\n  \n", "symbol,section\n", "symbol\n"]) {
      const r = parsed(input);
      expect(r.rows).toEqual([]);
      expect(planWatchlistCsvImport([], r.rows).accepted).toEqual([]);
    }
  });

  it("reports all-invalid file without turning invalid logical records into symbols", () => {
    const r = parsed("symbol,section\nBA\u0000D,Core\nAAPL,\"line\nfeed\"");
    expect(r).toEqual({ ok: true, rows: [], invalid: 2 });
  });

  it("does not strip genuine single-quote labels", () => {
    expect(parsed("AAPL,'Growth\nMSFT,'=1+1").rows).toEqual([
      row("AAPL", "'Growth"), row("MSFT", "'=1+1"),
    ]);
  });
});

describe("Watchlist CSV plan and 500-row chunk contract", () => {
  it("existing membership wins, then first valid normalized duplicate wins", () => {
    const src = parsed("symbol,section\n AAPL ,Core\n aapl ,Other\n MSFT ,Tech\nmsft,Growth");
    const plan = planWatchlistCsvImport([row("AAPL", "Existing")], src.rows);
    expect(plan.accepted).toEqual([row("MSFT", "Tech")]);
    expect(plan.symbols).toEqual(["MSFT"]);
    expect(plan.sections).toEqual({ MSFT: "Tech" });
    expect(plan.duplicate).toBe(3);
  });

  it("uses the exact same accepted rows for local and server section maps", () => {
    const src = parsed("symbol,section\nSPY,Core\nAAPL,\nMSFT,Tech\nspy,Later");
    const plan = planWatchlistCsvImport([], src.rows);
    const local = plan.accepted.map(({ symbol, section }) => ({ symbol, section }));
    expect(plan.symbols).toEqual(local.map(({ symbol }) => symbol));
    expect(plan.sections).toEqual(Object.fromEntries(local.map((r) => [r.symbol, r.section])));
    expect(plan.sections.AAPL).toBe("");
  });

  it("does not generate a payload for all-duplicate file", () => {
    const plan = planWatchlistCsvImport([row("AAPL", "Prior")], parsed("aapl,New\nAAPL,Other").rows);
    expect(plan).toEqual({ accepted: [], symbols: [], sections: {}, duplicate: 2 });
  });

  it("allows 501 valid rows and leaves the existing transport to chunk 500 + 1", () => {
    const csv = "symbol,section\n" + Array.from({ length: 501 }, (_, n) => `SYM${n},Group${n % 3}`).join("\n");
    const plan = planWatchlistCsvImport([], parsed(csv).rows);
    expect(plan.symbols).toHaveLength(501);
    expect(chunkSymbols(plan.symbols).map((chunk) => chunk.length)).toEqual([500, 1]);
    expect(Object.keys(plan.sections)).toHaveLength(501);
    expect(plan.sections.SYM500).toBe("Group2");
  });
});
