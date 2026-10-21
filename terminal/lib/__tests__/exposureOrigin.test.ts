import { describe, expect, it } from "vitest";
import {
  encodeExposureOrigin, exposureOriginForCompany, exposureOriginRosterState, exposureOriginStep,
  isExposureOrigin, parseExposureOrigin, sectorOriginFromState, stripExposureOrigin, withExposureOrigin,
  type ExposureOrigin,
} from "@/lib/exposureOrigin";
import { DEFAULT_SECTOR_STATE, parseSectorState, writeSectorState } from "@/lib/sectorIntelligence";

const state = { ...DEFAULT_SECTOR_STATE, sector: "technology", group: "semiconductors", sort: "return" as const, query: "", company: "NVDA" };
const returnHref = writeSectorState(new URL("https://mastermind.invalid/discover"), state);
const origin: ExposureOrigin = {
  v: 1, kind: "sector", returnHref, sector: "technology", group: "semiconductors", company: "NVDA",
  index: 2, count: 3, sort: "return", query: "", asOf: "2026-10-20", contentHash: "hash12345678",
  method: "incumbent_rs_63_21/v1", benchmark: "SPY",
};
const roster = ["AAPL", "MSFT", "NVDA"];
const encoded = (value: unknown) => `?origin=${encodeURIComponent(JSON.stringify(value))}`;

describe("Exposure origin envelope", () => {
  it("accepts a well-formed sector origin and round-trips through encode and parse", () => {
    expect(isExposureOrigin(origin)).toBe(true);
    const encodedValue = encodeExposureOrigin(origin)!;
    // Canonical interface key order: v first, benchmark last.
    expect(Object.keys(JSON.parse(decodeURIComponent(encodedValue)))).toEqual(Object.keys(origin));
    expect(parseExposureOrigin(`?origin=${encodedValue}`)).toEqual(origin);
    expect(parseExposureOrigin(`a=b&origin=${encodedValue}`)).toEqual(origin);
    // A URLSearchParams instance holds the decoded value, exactly as the browser presents a single-encoded URL.
    expect(parseExposureOrigin(new URLSearchParams([["origin", decodeURIComponent(encodedValue)]]))).toEqual(origin);
    // The wire form is encoded exactly once: a double-encoded value is not an origin.
    expect(parseExposureOrigin(new URLSearchParams([["origin", encodedValue]]))).toBeNull();
    expect(parseExposureOrigin(null)).toBeNull();
    expect(parseExposureOrigin("?other=1")).toBeNull();
  });

  it("rejects an extra key, a missing key and an unsupported version", () => {
    expect(isExposureOrigin({ ...origin, extra: 1 })).toBe(false);
    const missing: Record<string, unknown> = { ...origin };
    delete missing.contentHash;
    expect(isExposureOrigin(missing)).toBe(false);
    expect(isExposureOrigin({ ...origin, v: 2 })).toBe(false);
    expect(isExposureOrigin({ ...origin, v: "1" })).toBe(false);
    expect(isExposureOrigin({ ...origin, kind: "theme" })).toBe(false);
    expect(parseExposureOrigin(encoded({ ...origin, v: 2 }))).toBeNull();
    expect(parseExposureOrigin(encoded({ ...origin, extra: 1 }))).toBeNull();
  });

  it("rejects an oversize encoded value and malformed JSON without throwing", () => {
    expect(parseExposureOrigin(`?origin=${"a".repeat(1025)}`)).toBeNull();
    expect(parseExposureOrigin("?origin=%7Binvalid")).toBeNull();
    expect(parseExposureOrigin("?origin=%25zz")).toBeNull();
    expect(parseExposureOrigin("?origin=5")).toBeNull();
    expect(parseExposureOrigin("?origin=null")).toBeNull();
    // A maximally filled origin cannot travel: the encoded form alone exceeds the bound.
    const wide = sectorOriginFromState({
      state: { ...state, sector: "a".repeat(80), group: "b".repeat(80), query: "q".repeat(40) },
      company: "NVDA", roster, asOf: "2026-10-20", contentHash: "h".repeat(128), benchmark: "SPY",
    });
    expect(wide).not.toBeNull();
    expect(encodeExposureOrigin(wide!)).toBeNull();
  });

  it("rejects a returnHref that is absolute, protocol-relative, carries a hash, or does not re-parse to the same sector state", () => {
    expect(isExposureOrigin({ ...origin, returnHref: `https://evil.example${returnHref}` })).toBe(false);
    expect(isExposureOrigin({ ...origin, returnHref: returnHref.replace("/discover", "//evil.example/discover") })).toBe(false);
    expect(isExposureOrigin({ ...origin, returnHref: `${returnHref}#x` })).toBe(false);
    expect(isExposureOrigin({ ...origin, returnHref: `${returnHref} extra` })).toBe(false);
    expect(isExposureOrigin({ ...origin, sector: "energy" })).toBe(false);
    expect(isExposureOrigin({ ...origin, returnHref: returnHref.replace("tab=sectors", "tab=prism") })).toBe(false);
    expect(isExposureOrigin({ ...origin, returnHref: returnHref.replace("sectorCompany=NVDA", "sectorCompany=AAPL") })).toBe(false);
  });

  it("rejects index without count, index at or above count, count above 500 and a non-integer index", () => {
    expect(isExposureOrigin({ ...origin, count: null })).toBe(false);
    expect(isExposureOrigin({ ...origin, index: 3 })).toBe(false);
    expect(isExposureOrigin({ ...origin, index: 5 })).toBe(false);
    expect(isExposureOrigin({ ...origin, count: 501, index: 500 })).toBe(false);
    expect(isExposureOrigin({ ...origin, count: 0 })).toBe(false);
    expect(isExposureOrigin({ ...origin, index: 1.5 })).toBe(false);
    expect(isExposureOrigin({ ...origin, index: -1 })).toBe(false);
    expect(isExposureOrigin({ ...origin, index: 0, count: 3 })).toBe(true);
    expect(parseExposureOrigin(encoded({ ...origin, index: 3 }))).toBeNull();
  });

  it("rejects an impossible asOf date and a malformed contentHash", () => {
    expect(isExposureOrigin({ ...origin, asOf: "2026-02-30" })).toBe(false);
    expect(isExposureOrigin({ ...origin, asOf: "2026-10-20T00:00:00Z" })).toBe(false);
    expect(isExposureOrigin({ ...origin, asOf: 42 })).toBe(false);
    expect(isExposureOrigin({ ...origin, asOf: "2026-02-29" })).toBe(false);
    expect(isExposureOrigin({ ...origin, asOf: "2024-02-29" })).toBe(true);
    expect(isExposureOrigin({ ...origin, contentHash: "short" })).toBe(false);
    expect(isExposureOrigin({ ...origin, contentHash: "has space in it" })).toBe(false);
    expect(isExposureOrigin({ ...origin, contentHash: 7 })).toBe(false);
  });

  it("withExposureOrigin adds the parameter to a relative href and carries the exposure hash byte for byte", () => {
    const href = withExposureOrigin("/terminal?symbol=NVDA#exposure=%7B%22v%22%3A1%7D", origin);
    expect(href.slice(href.indexOf("#"))).toBe("#exposure=%7B%22v%22%3A1%7D");
    expect(new URLSearchParams(href.slice(href.indexOf("?") + 1, href.indexOf("#"))).get("symbol")).toBe("NVDA");
    expect(parseExposureOrigin(new URLSearchParams(href.slice(href.indexOf("?") + 1, href.indexOf("#"))))).toEqual(origin);
    const plain = withExposureOrigin("/options?tab=prism&symbol=NVDA&view=chart", origin);
    expect(plain.startsWith("/options?tab=prism&symbol=NVDA&view=chart&origin=")).toBe(true);
    // Single-encoded on the wire: the browser decodes it once and parse sees JSON, never "%257B".
    expect(plain).toContain("&origin=%7B%22v%22%3A1");
    expect(plain).not.toContain("%25");
    expect(parseExposureOrigin(new URL(plain, "https://mastermind.invalid").searchParams)).toEqual(origin);
    expect(parseExposureOrigin(plain)).toEqual(origin);
  });

  it("withExposureOrigin replaces an existing origin; stripExposureOrigin removes it and the dangling question mark", () => {
    const stale = "?origin=%7B%22stale%22%3A1%7D";
    const replaced = withExposureOrigin(`/terminal${stale}&symbol=NVDA#h`, origin);
    const search = replaced.slice(replaced.indexOf("?") + 1, replaced.indexOf("#"));
    expect(parseExposureOrigin(new URLSearchParams(search))).toEqual(origin);
    expect(search.includes("stale")).toBe(false);
    expect(withExposureOrigin("/terminal?symbol=NVDA", null)).toBe("/terminal?symbol=NVDA");
    expect(stripExposureOrigin(replaced)).toBe("/terminal?symbol=NVDA#h");
    expect(stripExposureOrigin("/terminal?origin=abc")).toBe("/terminal");
    expect(stripExposureOrigin("/options?tab=prism&origin=abc#x")).toBe("/options?tab=prism#x");
  });

  it("sectorOriginFromState writes a returnHref that parseSectorState reads back with the same sector, group, sort, query and company", () => {
    const built = sectorOriginFromState({
      state, company: "NVDA", roster, asOf: "2026-10-20", contentHash: "hash12345678", benchmark: "SPY",
    });
    expect(built).toEqual(origin);
    const params = new URLSearchParams(built!.returnHref.slice(built!.returnHref.indexOf("?") + 1));
    const reread = parseSectorState(params);
    expect([reread.sector, reread.group, reread.sort, reread.query, reread.company])
      .toEqual([built!.sector, built!.group, built!.sort, built!.query, built!.company]);
    expect(sectorOriginFromState({ state, company: "nvda", roster, asOf: null, contentHash: null, benchmark: null })).toBeNull();
    const absent = sectorOriginFromState({ state, company: "NVDA", roster: ["AAPL", "MSFT"], asOf: "bad", contentHash: "x", benchmark: "spy" });
    expect([absent!.index, absent!.count, absent!.asOf, absent!.contentHash, absent!.benchmark]).toEqual([null, 2, null, null, null]);
    const overflow = sectorOriginFromState({ state, company: "NVDA", roster: Array.from({ length: 501 }, (_, at) => `T${at}`), asOf: null, contentHash: null, benchmark: null });
    expect([overflow!.index, overflow!.count]).toEqual([null, null]);
  });

  it("exposureOriginStep never wraps: null at the first and last positions and when the roster no longer matches", () => {
    const first = { ...origin, company: "AAPL", index: 0 };
    const middle = { ...origin, company: "MSFT", index: 1 };
    const last = { ...origin, company: "NVDA", index: 2 };
    expect(exposureOriginStep(first, roster, -1)).toBeNull();
    expect(exposureOriginStep(last, roster, 1)).toBeNull();
    expect(exposureOriginStep(middle, roster, -1)).toEqual({ company: "AAPL", index: 0 });
    expect(exposureOriginStep(middle, roster, 1)).toEqual({ company: "NVDA", index: 2 });
    expect(exposureOriginStep(last, ["AAPL", "MSFT", "TSLA"], 1)).toBeNull();
    expect(exposureOriginStep({ ...origin, index: null, company: "NVDA" }, roster, 1)).toBeNull();
  });

  it("exposureOriginRosterState is exact only on equal non-null hashes and a matching position, changed on a different hash or position, unavailable without a receipt or roster", () => {
    const receipt = { contentHash: "hash12345678" };
    expect(exposureOriginRosterState(origin, receipt, roster)).toBe("exact");
    expect(exposureOriginRosterState(origin, { contentHash: "other1234567" }, roster)).toBe("changed");
    expect(exposureOriginRosterState(origin, { contentHash: null }, roster)).toBe("changed");
    expect(exposureOriginRosterState(origin, receipt, ["AAPL", "MSFT", "TSLA"])).toBe("changed");
    expect(exposureOriginRosterState(origin, receipt, ["AAPL", "MSFT"])).toBe("changed");
    expect(exposureOriginRosterState(origin, null, roster)).toBe("unavailable");
    expect(exposureOriginRosterState(origin, receipt, null)).toBe("unavailable");
    expect(exposureOriginRosterState(origin, null, null)).toBe("unavailable");
  });

  it("exposureOriginForCompany rewrites company, index and returnHref consistently", () => {
    const next = exposureOriginForCompany(origin, "MSFT", 1);
    expect([next.company, next.index]).toEqual(["MSFT", 1]);
    expect(isExposureOrigin(next)).toBe(true);
    const reread = parseSectorState(new URLSearchParams(next.returnHref.slice(next.returnHref.indexOf("?") + 1)));
    expect([reread.sector, reread.group, reread.sort, reread.query, reread.company]).toEqual(["technology", "semiconductors", "return", "", "MSFT"]);
    expect(exposureOriginForCompany(origin, "nvda", 0)).toEqual(origin);
    expect(exposureOriginForCompany(origin, "MSFT", 9)).toEqual(origin);
  });
});
