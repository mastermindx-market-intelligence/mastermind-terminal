import { describe, expect, it } from "vitest";
import {
  MARKET_ONTOLOGY_ORIGIN,
  MO_CONTEXT_KEYS,
  MarketOntologyContext,
  clearMarketOntologyContext,
  hasMarketOntologyContext,
  marketOntologyReturnHref,
  parseMarketOntologyContext,
  serializeMarketOntologyContext,
} from "@/lib/marketOntologyContext";

/**
 * Unit tests for MarketOntologyContext — mastermind.market-ontology-context/v1
 *
 * Sol's tests 1-10:
 * 1. complete valid context round-trips (parse → serialize → parse equal)
 * 2. missing optional fields allowed
 * 3. duplicate mo_* invalidates
 * 4. overlength / non-ASCII / control chars / encoded separators / malformed or impossible dates invalidate
 * 5. unknown mo_* not forwarded by serialize
 * 6. serializer emits only closed validated fields
 * 7. return href cannot incorporate unvalidated prose or an arbitrary URL
 * 8. clear removes all mo_* (known and unknown) and leaves symbol/page/view/thesis untouched
 * 9. mo_from=transmission (or anything but ontology) → null
 * 10. mo_chain missing → null
 */

const VALID_CHAIN = "abc123";
const VALID_FOCUS = "node_42";
const VALID_PATH_REV = "3";
const VALID_DATE = "2026-09-23";

function makeParams(entries: Record<string, string>): URLSearchParams {
  return new URLSearchParams(entries as Record<string, string>);
}

function makeRawParams(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

describe("parseMarketOntologyContext", () => {
  // Test 1: complete valid context round-trips (parse → serialize → parse equal)
  it("round-trips a full valid context", () => {
    const original: MarketOntologyContext = {
      from: "ontology",
      chain: VALID_CHAIN,
      focus: VALID_FOCUS,
      pathRev: VALID_PATH_REV,
      channel: "ch_1",
      theme: "theme_x",
      company: "co_y",
      security: "sec_z",
      asof: VALID_DATE,
      kc: "2026-08-01",
    };

    const params = serializeMarketOntologyContext(original);
    const parsed = parseMarketOntologyContext(params);

    expect(parsed).toEqual(original);
  });

  // Test 2: missing optional fields allowed
  it("parses a minimal valid context with only mo_from and mo_chain", () => {
    const params = makeParams({ mo_from: "ontology", mo_chain: VALID_CHAIN });
    const result = parseMarketOntologyContext(params);

    expect(result).toEqual({ from: "ontology", chain: VALID_CHAIN });
  });

  it("parses all optional fields present", () => {
    const params = makeParams({
      mo_from: "ontology",
      mo_chain: VALID_CHAIN,
      mo_focus: VALID_FOCUS,
      mo_path_rev: VALID_PATH_REV,
      mo_channel: "ch_1",
      mo_theme: "theme_x",
      mo_company: "co_y",
      mo_security: "sec_z",
      mo_asof: VALID_DATE,
      mo_kc: "2026-08-01",
    });

    const result = parseMarketOntologyContext(params);

    expect(result).toEqual({
      from: "ontology",
      chain: VALID_CHAIN,
      focus: VALID_FOCUS,
      pathRev: VALID_PATH_REV,
      channel: "ch_1",
      theme: "theme_x",
      company: "co_y",
      security: "sec_z",
      asof: VALID_DATE,
      kc: "2026-08-01",
    });
  });

  // Test 3: duplicate mo_* invalidates
  it("returns null when mo_chain appears twice", () => {
    const params = new URLSearchParams();
    params.append("mo_from", "ontology");
    params.append("mo_chain", VALID_CHAIN);
    params.append("mo_chain", "dup_chain");

    expect(parseMarketOntologyContext(params)).toBeNull();
  });

  it("returns null when mo_from appears twice", () => {
    const params = new URLSearchParams();
    params.append("mo_from", "ontology");
    params.append("mo_from", "ontology");

    expect(parseMarketOntologyContext(params)).toBeNull();
  });

  it("returns null when mo_focus appears twice", () => {
    const params = new URLSearchParams();
    params.append("mo_from", "ontology");
    params.append("mo_chain", VALID_CHAIN);
    params.append("mo_focus", VALID_FOCUS);
    params.append("mo_focus", "dup_focus");

    expect(parseMarketOntologyContext(params)).toBeNull();
  });

  // Test 9: mo_from=transmission (or anything but ontology) → null
  it("returns null when mo_from is transmission", () => {
    const params = makeParams({ mo_from: "transmission", mo_chain: VALID_CHAIN });
    expect(parseMarketOntologyContext(params)).toBeNull();
  });

  it("returns null when mo_from is empty string", () => {
    const params = makeParams({ mo_from: "", mo_chain: VALID_CHAIN });
    expect(parseMarketOntologyContext(params)).toBeNull();
  });

  it("returns null when mo_from is missing entirely", () => {
    const params = makeParams({ mo_chain: VALID_CHAIN });
    expect(parseMarketOntologyContext(params)).toBeNull();
  });

  // Test 10: mo_chain missing → null
  it("returns null when mo_chain is missing", () => {
    const params = makeParams({ mo_from: "ontology" });
    expect(parseMarketOntologyContext(params)).toBeNull();
  });

  it("returns null when mo_chain is empty string", () => {
    const params = makeParams({ mo_from: "ontology", mo_chain: "" });
    expect(parseMarketOntologyContext(params)).toBeNull();
  });

  it.each([
    ["mo_focus", "node with prose"],
    ["mo_path_rev", "1e9"],
    ["mo_channel", "bad channel"],
    ["mo_theme", "bad theme!"],
    ["mo_company", "bad company!"],
    ["mo_security", "bad security!"],
    ["mo_asof", "2026-02-30"],
    ["mo_kc", "2026-02-30"],
  ] as const)("returns null when present optional %s is invalid", (key, value) => {
    const params = makeParams({ mo_from: "ontology", mo_chain: VALID_CHAIN, [key]: value });
    expect(parseMarketOntologyContext(params)).toBeNull();
  });

  // Test 4: overlength / non-ASCII / control chars / encoded separators / malformed or impossible dates invalidate
  describe("grammar validation", () => {
    it("returns null when mo_chain starts with underscore", () => {
      const params = makeParams({ mo_from: "ontology", mo_chain: "_invalid" });
      expect(parseMarketOntologyContext(params)).toBeNull();
    });

    it("returns null when mo_chain starts with hyphen", () => {
      const params = makeParams({ mo_from: "ontology", mo_chain: "-invalid" });
      expect(parseMarketOntologyContext(params)).toBeNull();
    });

    it("returns null when mo_chain contains control character", () => {
      const params = new URLSearchParams();
      params.set("mo_from", "ontology");
      params.set("mo_chain", "valid\x00char");
      expect(parseMarketOntologyContext(params)).toBeNull();
    });

    it("returns null when mo_chain exceeds 80 chars total", () => {
      const longChain = "a" + "b".repeat(80); // 81 chars
      const params = makeParams({ mo_from: "ontology", mo_chain: longChain });
      expect(parseMarketOntologyContext(params)).toBeNull();
    });

    it("returns null when mo_chain is exactly 81 chars (over limit)", () => {
      // ID_GRAMMAR: ^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$ — max 80 total chars
      const longChain = "a".repeat(81);
      const params = makeParams({ mo_from: "ontology", mo_chain: longChain });
      expect(parseMarketOntologyContext(params)).toBeNull();
    });

    it("accepts mo_chain at exactly 80 chars", () => {
      // 1 char + 79 more = 80 total
      const maxChain = "a" + "b".repeat(79);
      const params = makeParams({ mo_from: "ontology", mo_chain: maxChain });
      const result = parseMarketOntologyContext(params);
      expect(result).not.toBeNull();
      expect(result!.chain).toBe(maxChain);
    });

    // Per spec: "every other field is optional" — but any KNOWN mo_* key that fails grammar
    // invalidates the whole context (not just that field). Duplicate keys are caught earlier.
    it("returns null when mo_focus contains .. (path traversal attempt)", () => {
      const params = makeParams({ mo_from: "ontology", mo_chain: VALID_CHAIN, mo_focus: "..\\..\\etc" });
      expect(parseMarketOntologyContext(params)).toBeNull();
    });

    it("returns null when mo_focus contains :// (URL injection attempt)", () => {
      const params = makeParams({ mo_from: "ontology", mo_chain: VALID_CHAIN, mo_focus: "https://evil.com" });
      expect(parseMarketOntologyContext(params)).toBeNull();
    });

    it("returns null when mo_asof is invalid date 2026-02-30", () => {
      const params = makeParams({ mo_from: "ontology", mo_chain: VALID_CHAIN, mo_asof: "2026-02-30" });
      expect(parseMarketOntologyContext(params)).toBeNull();
    });

    it("returns null when mo_asof has invalid month 00", () => {
      const params = makeParams({ mo_from: "ontology", mo_chain: VALID_CHAIN, mo_asof: "2026-00-01" });
      expect(parseMarketOntologyContext(params)).toBeNull();
    });

    it("returns null when mo_asof has invalid month 13", () => {
      const params = makeParams({ mo_from: "ontology", mo_chain: VALID_CHAIN, mo_asof: "2026-13-01" });
      expect(parseMarketOntologyContext(params)).toBeNull();
    });

    it("returns null when mo_asof has invalid day 00", () => {
      const params = makeParams({ mo_from: "ontology", mo_chain: VALID_CHAIN, mo_asof: "2026-09-00" });
      expect(parseMarketOntologyContext(params)).toBeNull();
    });

    it("returns null when mo_asof has invalid day 32", () => {
      const params = makeParams({ mo_from: "ontology", mo_chain: VALID_CHAIN, mo_asof: "2026-09-32" });
      expect(parseMarketOntologyContext(params)).toBeNull();
    });

    it("returns null when mo_asof is a non-date string", () => {
      const params = makeParams({ mo_from: "ontology", mo_chain: VALID_CHAIN, mo_asof: "not-a-date" });
      expect(parseMarketOntologyContext(params)).toBeNull();
    });

    it("returns null when mo_path_rev contains letters", () => {
      const params = makeParams({ mo_from: "ontology", mo_chain: VALID_CHAIN, mo_path_rev: "abc" });
      expect(parseMarketOntologyContext(params)).toBeNull();
    });

    it("returns null when mo_path_rev exceeds 9 digits", () => {
      const params = makeParams({ mo_from: "ontology", mo_chain: VALID_CHAIN, mo_path_rev: "1234567890" });
      expect(parseMarketOntologyContext(params)).toBeNull();
    });

    it("accepts mo_path_rev with up to 9 digits", () => {
      const params = makeParams({ mo_from: "ontology", mo_chain: VALID_CHAIN, mo_path_rev: "123456789" });
      const result = parseMarketOntologyContext(params);
      expect(result).not.toBeNull();
      expect(result!.pathRev).toBe("123456789");
    });

    it("returns null when a raw query decodes %26 into an ampersand", () => {
      expect(parseMarketOntologyContext(makeRawParams("mo_from=ontology&mo_chain=a%26b"))).toBeNull();
    });

    it("returns null when a raw query decodes %3D into an equals sign", () => {
      expect(parseMarketOntologyContext(makeRawParams("mo_from=ontology&mo_chain=a%3Db"))).toBeNull();
    });

    it("returns null when a raw query decodes %2F into a slash", () => {
      expect(parseMarketOntologyContext(makeRawParams("mo_from=ontology&mo_chain=a%2Fb"))).toBeNull();
    });

    it("returns null when a raw query decodes %E8%8A%82 into a non-ASCII focus", () => {
      expect(parseMarketOntologyContext(makeRawParams("mo_from=ontology&mo_chain=a&mo_focus=%E8%8A%82%E7%82%B9"))).toBeNull();
    });

    it("returns null when a raw query decodes %C3%A9 into a non-ASCII chain", () => {
      expect(parseMarketOntologyContext(makeRawParams("mo_from=ontology&mo_chain=abc%C3%A9"))).toBeNull();
    });

    it.each([
      ["2024-02-29", true],
      ["2026-02-29", false],
      ["2026-04-31", false],
    ] as const)("treats %s as a %s calendar date", (date, isValid) => {
      const result = parseMarketOntologyContext(
        makeRawParams(`mo_from=ontology&mo_chain=a&mo_asof=${date}`)
      );
      expect(result === null).toBe(!isValid);
    });

    it.each([
      "prose with spaces",
      "javascript:alert(1)",
      "https://evil.example/x",
      "../..",
      "#",
      "?",
      "&",
    ])("returns null when focus is the adversarial value %s", (focus) => {
      const params = makeParams({ mo_from: "ontology", mo_chain: VALID_CHAIN, mo_focus: focus });
      expect(parseMarketOntologyContext(params)).toBeNull();
    });

    it("returns null when a present optional field is empty", () => {
      expect(parseMarketOntologyContext(makeRawParams("mo_from=ontology&mo_chain=a&mo_focus="))).toBeNull();
      expect(parseMarketOntologyContext(makeRawParams("mo_from=ontology&mo_chain=a&mo_asof="))).toBeNull();
    });
  });

  it("parses a valid context with a simple valid mo_focus", () => {
    const params = makeParams({ mo_from: "ontology", mo_chain: VALID_CHAIN, mo_focus: "node_42" });
    const result = parseMarketOntologyContext(params);
    expect(result).not.toBeNull();
    expect(result!.focus).toBe("node_42");
  });

  it("ignores unknown mo_* keys (does not invalidate)", () => {
    const params = makeParams({
      mo_from: "ontology",
      mo_chain: VALID_CHAIN,
      mo_unknown: "should-be-ignored",
      mo_fancy: "also-ignored",
    });
    const result = parseMarketOntologyContext(params);
    expect(result).toEqual({ from: "ontology", chain: VALID_CHAIN });
  });

  it("ignores a non-ASCII unknown mo_* key", () => {
    const result = parseMarketOntologyContext(
      makeRawParams("mo_from=ontology&mo_chain=a&mo_%E8%8A%82=x")
    );
    expect(result).toEqual({ from: "ontology", chain: "a" });
  });

  it("round-trips a raw valid context through parse and serialize", () => {
    const raw = "symbol=NVDA&mo_from=ontology&mo_chain=a&mo_focus=node_42&mo_path_rev=3";
    const params = makeRawParams(raw);
    const parsed = parseMarketOntologyContext(params);
    expect(parsed).not.toBeNull();
    expect(serializeMarketOntologyContext(parsed!, params).toString()).toBe(
      "symbol=NVDA&mo_from=ontology&mo_chain=a&mo_focus=node_42&mo_path_rev=3"
    );
  });
});

describe("serializeMarketOntologyContext", () => {
  it("serializes a full context", () => {
    const ctx: MarketOntologyContext = {
      from: "ontology",
      chain: VALID_CHAIN,
      focus: VALID_FOCUS,
      pathRev: VALID_PATH_REV,
      channel: "ch_1",
      theme: "theme_x",
      company: "co_y",
      security: "sec_z",
      asof: VALID_DATE,
      kc: "2026-08-01",
    };

    const params = serializeMarketOntologyContext(ctx);
    expect(params.get("mo_from")).toBe("ontology");
    expect(params.get("mo_chain")).toBe(VALID_CHAIN);
    expect(params.get("mo_focus")).toBe(VALID_FOCUS);
    expect(params.get("mo_path_rev")).toBe(VALID_PATH_REV);
    expect(params.get("mo_channel")).toBe("ch_1");
    expect(params.get("mo_theme")).toBe("theme_x");
    expect(params.get("mo_company")).toBe("co_y");
    expect(params.get("mo_security")).toBe("sec_z");
    expect(params.get("mo_asof")).toBe(VALID_DATE);
    expect(params.get("mo_kc")).toBe("2026-08-01");
  });

  it("serializes minimal context with only required fields", () => {
    const ctx: MarketOntologyContext = { from: "ontology", chain: VALID_CHAIN };
    const params = serializeMarketOntologyContext(ctx);

    expect(params.get("mo_from")).toBe("ontology");
    expect(params.get("mo_chain")).toBe(VALID_CHAIN);
    expect(params.has("mo_focus")).toBe(false);
    expect(params.has("mo_path_rev")).toBe(false);
    expect(params.has("mo_channel")).toBe(false);
    expect(params.has("mo_theme")).toBe(false);
    expect(params.has("mo_company")).toBe(false);
    expect(params.has("mo_security")).toBe(false);
    expect(params.has("mo_asof")).toBe(false);
    expect(params.has("mo_kc")).toBe(false);
  });

  // Test 5: unknown mo_* not forwarded by serialize
  it("does not emit unknown mo_* fields when appending to existing params", () => {
    const ctx: MarketOntologyContext = { from: "ontology", chain: VALID_CHAIN };
    const existing = new URLSearchParams({ symbol: "NVDA", mo_unknown: "should-be-ignored" });
    const result = serializeMarketOntologyContext(ctx, existing);

    expect(result.get("mo_unknown")).toBeNull();
    expect(result.get("symbol")).toBe("NVDA");
  });

  // Test 6: serializer emits only closed validated fields
  it("emits only closed validated fields", () => {
    // Cast through unknown to simulate an object with extra fields that TypeScript doesn't know about.
    // The serializer must not emit any key not in MarketOntologyContext.
    const ctx = {
      from: "ontology" as const,
      chain: VALID_CHAIN,
      extraField: "should-not-appear",
    } as unknown as MarketOntologyContext;

    const params = serializeMarketOntologyContext(ctx);
    // Only known keys should be present
    expect(params.get("mo_from")).toBe("ontology");
    expect(params.get("mo_chain")).toBe(VALID_CHAIN);
    // No other keys
    const allKeys = Array.from(params.keys());
    expect(allKeys).toEqual(["mo_from", "mo_chain"]);
  });

  it("removes known and unknown mo_* keys absent from the context", () => {
    const ctx: MarketOntologyContext = { from: "ontology", chain: VALID_CHAIN };
    const existing = makeParams({
      symbol: "NVDA",
      page: "intelligence",
      mo_focus: "pre_existing_focus",
      mo_asof: VALID_DATE,
      mo_unknown: "u",
    });
    const result = serializeMarketOntologyContext(ctx, existing);

    expect(result.has("mo_focus")).toBe(false);
    expect(result.has("mo_asof")).toBe(false);
    expect(result.has("mo_unknown")).toBe(false);
    expect([...result.keys()]).toEqual(["symbol", "page", "mo_from", "mo_chain"]);
  });

  it.each([
    ["focus", "a b"],
    ["pathRev", "1e9"],
    ["asof", "2026-02-30"],
  ] as const)("omits an illegal forged %s field", (field, value) => {
    const ctx = { from: "ontology", chain: VALID_CHAIN, [field]: value } as unknown as MarketOntologyContext;
    const result = serializeMarketOntologyContext(ctx);
    expect([...result.keys()]).toEqual(["mo_from", "mo_chain"]);
  });
});

describe("marketOntologyReturnHref", () => {
  // Test 7: return href cannot incorporate unvalidated prose or an arbitrary URL
  it("returns base URL with no pathRev or focus", () => {
    const ctx: MarketOntologyContext = { from: "ontology", chain: VALID_CHAIN };
    expect(marketOntologyReturnHref(ctx)).toBe(`${MARKET_ONTOLOGY_ORIGIN}/ontology.html`);
  });

  it("returns URL with pathRev only", () => {
    const ctx: MarketOntologyContext = { from: "ontology", chain: VALID_CHAIN, pathRev: "3" };
    expect(marketOntologyReturnHref(ctx)).toBe(`${MARKET_ONTOLOGY_ORIGIN}/ontology.html?rev=3`);
  });

  it("returns URL with focus only (encoded)", () => {
    const ctx: MarketOntologyContext = { from: "ontology", chain: VALID_CHAIN, focus: "node_42" };
    expect(marketOntologyReturnHref(ctx)).toBe(`${MARKET_ONTOLOGY_ORIGIN}/ontology.html#ox-leg-node_42`);
  });

  it("returns URL with pathRev and focus", () => {
    const ctx: MarketOntologyContext = {
      from: "ontology",
      chain: VALID_CHAIN,
      pathRev: "3",
      focus: "node_42",
    };
    expect(marketOntologyReturnHref(ctx)).toBe(`${MARKET_ONTOLOGY_ORIGIN}/ontology.html?rev=3#ox-leg-node_42`);
  });

  it("returns the bare href when an empty pathRev or focus is forged", () => {
    const ctx = { from: "ontology", chain: VALID_CHAIN, pathRev: "", focus: "" } as unknown as MarketOntologyContext;
    expect(marketOntologyReturnHref(ctx)).toBe(`${MARKET_ONTOLOGY_ORIGIN}/ontology.html`);
  });

  it("percent-encodes a legal focus into one opaque fragment token", () => {
    const ctx: MarketOntologyContext = { from: "ontology", chain: VALID_CHAIN, focus: "a..b" };
    const result = marketOntologyReturnHref(ctx);
    // Dots are legal in the id grammar and pass through unencoded.
    expect(result).toBe(`${MARKET_ONTOLOGY_ORIGIN}/ontology.html#ox-leg-a..b`);
  });

  it("percent-encodes a legal colon in focus", () => {
    const ctx: MarketOntologyContext = { from: "ontology", chain: VALID_CHAIN, focus: "a:b" };
    const result = marketOntologyReturnHref(ctx);
    expect(result).toBe(`${MARKET_ONTOLOGY_ORIGIN}/ontology.html#ox-leg-a%3Ab`);
  });

  it.each([
    ["pathRev", "3&x=1"],
    ["pathRev", "1e9"],
    ["focus", "a b"],
    ["focus", "https://evil.example/x"],
    ["asof", "2026-02-30"],
  ] as const)("returns the bare href when forged %s is illegal", (field, value) => {
    const ctx = { from: "ontology", chain: VALID_CHAIN, [field]: value } as unknown as MarketOntologyContext;
    const result = marketOntologyReturnHref(ctx);
    expect(result).toBe(`${MARKET_ONTOLOGY_ORIGIN}/ontology.html`);
    expect(result).not.toContain("?rev=");
    expect(result).not.toContain("#ox-leg-");
  });

  it("ignores an unknown mo_origin key when building the return href", () => {
    const withoutUnknown = parseMarketOntologyContext(makeRawParams("mo_from=ontology&mo_chain=a&mo_focus=node"));
    const withUnknown = parseMarketOntologyContext(
      makeRawParams("mo_from=ontology&mo_chain=a&mo_focus=node&mo_origin=https%3A%2F%2Fevil.example")
    );
    const expected = `${MARKET_ONTOLOGY_ORIGIN}/ontology.html#ox-leg-node`;
    expect(marketOntologyReturnHref(withoutUnknown!)).toBe(expected);
    expect(marketOntologyReturnHref(withUnknown!)).toBe(expected);
  });
});

describe("clearMarketOntologyContext", () => {
  // Test 8: clear removes all mo_* (known and unknown) and leaves symbol/page/view/thesis untouched
  it("removes all known mo_* keys and leaves other params untouched", () => {
    const params = makeParams({
      mo_from: "ontology",
      mo_chain: VALID_CHAIN,
      mo_focus: VALID_FOCUS,
      symbol: "NVDA",
      page: "intelligence",
      view: "theses",
      thesis: "123",
    });

    const result = clearMarketOntologyContext(params);

    expect(result.has("mo_from")).toBe(false);
    expect(result.has("mo_chain")).toBe(false);
    expect(result.has("mo_focus")).toBe(false);
    expect(result.get("symbol")).toBe("NVDA");
    expect(result.get("page")).toBe("intelligence");
    expect(result.get("view")).toBe("theses");
    expect(result.get("thesis")).toBe("123");
  });

  it("removes unknown mo_* keys", () => {
    const params = makeParams({
      mo_from: "ontology",
      mo_unknown_field: "should-be-removed",
      symbol: "NVDA",
    });

    const result = clearMarketOntologyContext(params);

    expect(result.has("mo_from")).toBe(false);
    expect(result.has("mo_unknown_field")).toBe(false);
    expect(result.get("symbol")).toBe("NVDA");
  });

  it("returns empty params when only mo_* keys were present", () => {
    const params = makeParams({ mo_from: "ontology", mo_chain: VALID_CHAIN });
    const result = clearMarketOntologyContext(params);
    expect(result.toString()).toBe("");
  });

  it("clears multiple unknown mo_* keys", () => {
    const params = makeParams({
      mo_from: "ontology",
      mo_chain: VALID_CHAIN,
      mo_unknown1: "val1",
      mo_unknown2: "val2",
    });

    const result = clearMarketOntologyContext(params);

    expect(result.has("mo_from")).toBe(false);
    expect(result.has("mo_chain")).toBe(false);
    expect(result.has("mo_unknown1")).toBe(false);
    expect(result.has("mo_unknown2")).toBe(false);
  });

  it("clears an uppercase MO_ prefix case-insensitively", () => {
    const result = clearMarketOntologyContext(makeRawParams("symbol=NVDA&MO_CHAIN=x"));
    expect(result.has("MO_CHAIN")).toBe(false);
    expect(result.get("symbol")).toBe("NVDA");
  });
});

describe("hasMarketOntologyContext", () => {
  it("returns true when mo_from is present", () => {
    const params = makeParams({ mo_from: "ontology", mo_chain: VALID_CHAIN });
    expect(hasMarketOntologyContext(params)).toBe(true);
  });

  it("returns true when an unknown mo_* key is present", () => {
    const params = makeParams({ mo_unknown: "value" });
    expect(hasMarketOntologyContext(params)).toBe(true);
  });

  it("returns false when no mo_* keys are present", () => {
    const params = makeParams({ symbol: "NVDA", page: "intelligence" });
    expect(hasMarketOntologyContext(params)).toBe(false);
  });

  it("returns false for empty params", () => {
    const params = new URLSearchParams();
    expect(hasMarketOntologyContext(params)).toBe(false);
  });

  it("counts an uppercase MO_ prefix case-insensitively", () => {
    expect(hasMarketOntologyContext(makeRawParams("MO_CHAIN=x"))).toBe(true);
    expect(hasMarketOntologyContext(makeRawParams("symbol=NVDA"))).toBe(false);
  });
});

describe("MO_CONTEXT_KEYS", () => {
  it("contains all expected mo_* keys in correct order", () => {
    expect(MO_CONTEXT_KEYS).toEqual([
      "mo_from",
      "mo_chain",
      "mo_focus",
      "mo_path_rev",
      "mo_channel",
      "mo_theme",
      "mo_company",
      "mo_security",
      "mo_asof",
      "mo_kc",
    ]);
  });
});

describe("MARKET_ONTOLOGY_ORIGIN", () => {
  it("is the correct constant", () => {
    expect(MARKET_ONTOLOGY_ORIGIN).toBe("https://www.mastermind-x.com");
  });
});

describe("MarketOntologyContext round-trip", () => {
  it("deep-equals the original after serialize then parse", () => {
    const original: MarketOntologyContext = {
      from: "ontology",
      chain: VALID_CHAIN,
      focus: VALID_FOCUS,
      pathRev: VALID_PATH_REV,
      channel: "ch_1",
      theme: "theme_x",
      company: "co_y",
      security: "sec_z",
      asof: VALID_DATE,
      kc: "2026-08-01",
    };
    expect(parseMarketOntologyContext(serializeMarketOntologyContext(original))).toEqual(original);
  });
});
