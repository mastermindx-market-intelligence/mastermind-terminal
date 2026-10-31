import { describe, expect, it } from "vitest";
import {
  COMMODITY_SUBMITTED_CONTEXT_LIMITS as LIMITS,
  COMMODITY_SUBMITTED_CONTEXT_SCHEMA as SCHEMA,
  decodeCommoditySubmittedContext,
  type CommodityContextId,
  type CommodityContextRejection,
} from "../investigationCommodityContext";

// Synthetic wire fixtures. They are neither publisher evidence nor save receipts.
function fixture(asset: CommodityContextId = "oil") {
  const family = asset === "gold" ? "precious" : asset === "copper" ? "industrial" : "energy";
  return {
    schema: SCHEMA,
    commodity_id: asset,
    as_of: "2026-10-22",
    evidence: {
      schema: "mmx.commodities.as_saved_evidence.v1",
      workspace_fingerprint: "a1".repeat(32),
      projection_revision: 6,
      asset: {
        id: asset, as_of: "2026-10-21" as string | null, family,
        label: { en: asset === "oil" ? "WTI" : asset, zh: asset === "oil" ? "原油" : asset },
        change_1m_pct: -5.1, returns: { "5": 0, "20": -4.3, "60": null, "252": 12.2 },
        trend: "up", momentum: "bear", contract: null,
      },
      hypothesis: { id: "unresolved", label: { en: "Unresolved", zh: "尚未判定" } } as
        { id: string; label?: { en: string; zh: string } } | null,
      physical: null as Record<string, unknown> | null,
      gold_physical: null as Record<string, unknown> | null,
      chains: [] as Record<string, unknown>[],
      rates: null as Record<string, unknown> | null,
      fx: null as Record<string, unknown> | null,
      ratios: [] as Record<string, unknown>[],
      source_receipts: {
        commodities: { available_at: null, immutable_source: null, point_in_time: false },
      } as Record<string, unknown>,
      live: false,
    },
    return_state: {
      tab: "research", asset, window: "1m", compare: ["gold", "oil"],
      hypothesis: "unresolved", view: "detail", query: "",
      family: "all", sort: "source", trend: "all", momentum: "all", layout: "table",
    },
  };
}

function decode(value: unknown) {
  return decodeCommoditySubmittedContext(JSON.stringify(value));
}

function accepted(value: unknown) {
  const result = decode(value);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result;
}

function rejected(value: unknown, reason: CommodityContextRejection) {
  expect(decode(value)).toEqual({ ok: false, reason });
}

describe("submitted commodity context boundary", () => {
  it("retains independent dates and exact observations without upgrading qualification", () => {
    const input = fixture();
    input.evidence.physical = { observation_date: "2026-10-16", published_at: null, stock_change: 0 };
    const result = accepted(input);
    expect(result.qualification).toBe("submitted_unverified");
    expect(result.submittedContext).toEqual(input);
    expect(result.submittedContext).not.toBe(input);
    expect(result.submittedContext.as_of).not.toBe(result.submittedContext.evidence.asset.as_of);
    expect(result.submittedContext.evidence.asset.returns).toEqual({ "5": 0, "20": -4.3, "60": null, "252": 12.2 });
    expect(result.macroReturnHash).toBe("#cw/research/oil?window=1m&compare=gold%2Coil&hypothesis=unresolved");
    expect(Object.keys(result).sort()).toEqual(["macroReturnHash", "ok", "qualification", "submittedContext"]);
    input.evidence.asset.change_1m_pct = 99;
    expect(result.submittedContext.evidence.asset.change_1m_pct).toBe(-5.1);
  });

  it("keeps unknown dates, untrusted source claims, and Unicode text as submitted", () => {
    const input = fixture("gold");
    input.evidence.asset.as_of = null;
    input.evidence.gold_physical = { observation_date: null, qualification: "verified", monitoring_active: true };
    input.evidence.source_receipts = {
      claims: { verified: true, saved: true, url: "https://untrusted.example/receipt", observed_at: null },
      text: '金价📉\n<script>alert("not interpreted")</script> {"id":"x","id":"y"}',
    };
    const result = accepted(input);
    expect(result.qualification).toBe("submitted_unverified");
    expect(result.submittedContext.evidence).toEqual(input.evidence);
    expect(result.submittedContext.evidence.live).toBe(false);
  });

  it("accepts unresolved as an object or null, without inventing a hypothesis", () => {
    const input = fixture();
    expect(accepted(input).submittedContext.evidence.hypothesis?.id).toBe("unresolved");
    input.evidence.hypothesis = null;
    expect(accepted(input).submittedContext.evidence.hypothesis).toBeNull();
    input.return_state.hypothesis = "supply";
    rejected(input, "context_mismatch");
  });

  it.each([
    ["oil", "supply"], ["oil", "demand"], ["oil", "supply_recovery"],
    ["oil", "demand_contraction"], ["gold", "rates"], ["copper", "demand"],
  ] as const)("accepts the pinned %s/%s hypothesis", (asset, hypothesis) => {
    const input = fixture(asset);
    input.return_state.hypothesis = hypothesis;
    input.evidence.hypothesis = { id: hypothesis };
    expect(accepted(input).submittedContext.evidence.hypothesis?.id).toBe(hypothesis);
  });

  it.each([
    ["oil", "rates"], ["gold", "supply"], ["copper", "rates"], ["natgas", "demand"],
    ["oil", "invented"], ["oil", "unresolved\n"], ["oil", "https://example.com"],
  ] as const)("rejects unsupported commodity/hypothesis pair %s/%s even when both copies agree", (asset, hypothesis) => {
    const input = fixture(asset);
    input.return_state.hypothesis = hypothesis;
    input.evidence.hypothesis = { id: hypothesis };
    rejected(input, "invalid_return_state");
  });

  it("rejects inconsistent subject identities and hypothesis selections", () => {
    const assetMismatch = fixture();
    assetMismatch.evidence.asset.id = "natgas";
    rejected(assetMismatch, "context_mismatch");
    const stateMismatch = fixture();
    stateMismatch.return_state.asset = "gold";
    rejected(stateMismatch, "context_mismatch");
    const hypothesisMismatch = fixture();
    hypothesisMismatch.evidence.hypothesis = { id: "supply" };
    rejected(hypothesisMismatch, "context_mismatch");
  });

  it("rejects misplaced physical branches and wrong commodity family", () => {
    const oil = fixture();
    oil.evidence.gold_physical = {};
    rejected(oil, "invalid_evidence");
    const gold = fixture("gold");
    gold.evidence.physical = {};
    rejected(gold, "invalid_evidence");
    const copper = fixture("copper");
    copper.evidence.asset.family = "precious";
    rejected(copper, "invalid_evidence");
  });

  it("does not accept input objects or invoke coercion/accessor hooks", () => {
    let touched = false;
    const hostile = new Proxy({}, { get() { touched = true; throw new Error("must not run"); } });
    for (const input of [undefined, null, 1, true, Symbol("context"), {}, [], hostile]) {
      expect(decodeCommoditySubmittedContext(input)).toEqual({ ok: false, reason: "invalid_input" });
    }
    expect(touched).toBe(false);
  });

  it.each(["", "{", "null trailing", "\ufeff{}"])("rejects invalid JSON %j", serialized => {
    expect(decodeCommoditySubmittedContext(serialized)).toEqual({ ok: false, reason: "invalid_json" });
  });

  it.each([null, [], 1, true, "context"])("rejects non-envelope JSON %j", input => {
    rejected(input, "invalid_structure");
  });

  it("closes the envelope, evidence header and return-state field sets", () => {
    const input = fixture();
    rejected({ ...input, qualification: "verified" }, "invalid_structure");
    rejected({ ...input, evidence: { ...input.evidence, saved: true } }, "invalid_evidence");
    rejected({ ...input, return_state: { ...input.return_state, url: "https://example.com" } }, "invalid_return_state");
    for (const key of Object.keys(input)) {
      const candidate: Record<string, unknown> = { ...input };
      delete candidate[key];
      rejected(candidate, "invalid_structure");
    }
    for (const key of Object.keys(input.return_state)) {
      const state: Record<string, unknown> = { ...input.return_state };
      delete state[key];
      rejected({ ...input, return_state: state }, "invalid_return_state");
    }
  });

  it("rejects schema changes and security/ticker coercion", () => {
    const input = fixture();
    rejected({ ...input, schema: "mmx.investigation.v2" }, "unsupported_schema");
    rejected({ ...input, evidence: { ...input.evidence, schema: "mmx.commodities.as_saved_evidence.v2" } }, "unsupported_schema");
    for (const commodity_id of ["WTI", "CL", "CL=F", "security:oil", "unknown", "constructor", null]) {
      rejected({ ...input, commodity_id }, "invalid_subject");
    }
  });

  it.each(["0000-01-01", "1900-02-29", "2026-02-29", "2026-04-31", "2026-13-01", "2026-1-01", "2026-10-22\n", "2026-10-22T00:00:00Z"])(
    "rejects a noncanonical analysis or asset date %s", as_of => {
      const input = fixture();
      rejected({ ...input, as_of }, "invalid_analysis_date");
      input.evidence.asset.as_of = as_of;
      rejected(input, "invalid_evidence");
    },
  );

  it.each(["0001-01-01", "2000-02-29", "2024-02-29", "9999-12-31"])("accepts a genuine independent calendar date %s", as_of => {
    accepted({ ...fixture(), as_of });
  });

  it("requires an explicit non-live appendix and bounded valid header claims", () => {
    const input = fixture();
    for (const live of [true, null, "false", 0]) rejected({ ...input, evidence: { ...input.evidence, live } }, "invalid_evidence");
    for (const projection_revision of [0, -1, 1.5, "6", null]) rejected({ ...input, evidence: { ...input.evidence, projection_revision } }, "invalid_evidence");
    for (const workspace_fingerprint of ["A".repeat(64), "a".repeat(63), "g".repeat(64), null]) {
      rejected({ ...input, evidence: { ...input.evidence, workspace_fingerprint } }, "invalid_evidence");
    }
    for (const field of ["chains", "ratios"]) {
      rejected({ ...input, evidence: { ...input.evidence, [field]: [null] } }, "invalid_evidence");
      rejected({ ...input, evidence: { ...input.evidence, [field]: Array.from({ length: 65 }, () => ({})) } }, "invalid_evidence");
    }
    for (const field of ["rates", "fx", "source_receipts"]) {
      rejected({ ...input, evidence: { ...input.evidence, [field]: [] } }, "invalid_evidence");
    }
  });
});

describe("Macro return fragment", () => {
  it("preserves a fully populated state, ordered comparison and encoded Unicode query", () => {
    const input = fixture("gold");
    input.return_state = {
      tab: "explore", asset: "gold", window: "20", compare: ["copper", "oil", "silver"],
      hypothesis: "rates", view: "universe", query: "金价 & x=1#📉",
      family: "energy", sort: "return_asc", trend: "unknown", momentum: "bear", layout: "map",
    };
    input.evidence.hypothesis = { id: "rates" };
    const result = accepted(input);
    expect(result.submittedContext.return_state).toEqual(input.return_state);
    expect(result.macroReturnHash).toBe("#cw/explore/gold?window=20&compare=copper%2Coil%2Csilver&hypothesis=rates&view=universe&q=%E9%87%91%E4%BB%B7+%26+x%3D1%23%F0%9F%93%89&family=energy&trend=unknown&momentum=bear&sort=return_asc&layout=map");
    expect(new URLSearchParams(result.macroReturnHash.split("?")[1]).get("q")).toBe(input.return_state.query);
  });

  it("accepts an empty comparison and filters that hide the selected asset", () => {
    const input = fixture();
    input.return_state.compare = [];
    input.return_state.family = "livestock";
    input.return_state.query = "  no match  ";
    const result = accepted(input);
    expect(result.submittedContext.return_state).toEqual(input.return_state);
    expect(result.macroReturnHash).toContain("compare=&");
    expect(result.macroReturnHash).toContain("q=++no+match++");
  });

  it("rejects duplicate, oversized, unknown or coerced comparison sets", () => {
    const input = fixture();
    for (const compare of [["oil", "oil"], ["oil", "gold", "silver", "copper", "natgas"], ["WTI"], "oil,gold", null]) {
      rejected({ ...input, return_state: { ...input.return_state, compare } }, "invalid_return_state");
    }
  });

  it("rejects unsupported return enums without applying forgiving defaults", () => {
    const input = fixture();
    for (const [key, value] of [
      ["tab", "detail"], ["asset", "WTI"], ["window", 20], ["window", "30"],
      ["view", "grid"], ["family", "missing_family"], ["sort", "desc"],
      ["trend", "neutral"], ["momentum", "up"], ["layout", "cards"],
      ["query", "\tWTI"], ["query", "WTI\u007f"], ["query", "x".repeat(81)], ["query", null],
    ]) {
      rejected({ ...input, return_state: { ...input.return_state, [key as string]: value } }, "invalid_return_state");
    }
    input.return_state.query = "中".repeat(80);
    accepted(input);
  });

  it.each(["1m", "5", "20", "60", "252"])("preserves the supported window %s", window => {
    const input = fixture();
    input.return_state.window = window;
    expect(accepted(input).submittedContext.return_state.window).toBe(window);
  });
});

describe("bounded semantic JSON", () => {
  it("enforces the exact byte ceiling before parsing and counts UTF-8 bytes", () => {
    const input = fixture();
    input.evidence.source_receipts.padding = "";
    const baseBytes = new TextEncoder().encode(JSON.stringify(input)).byteLength;
    input.evidence.source_receipts.padding = "x".repeat(LIMITS.maxBytes - baseBytes);
    expect(new TextEncoder().encode(JSON.stringify(input)).byteLength).toBe(LIMITS.maxBytes);
    accepted(input);
    input.evidence.source_receipts.padding += "x";
    rejected(input, "payload_too_large");
    input.evidence.source_receipts.padding = "中".repeat(25_000);
    expect(JSON.stringify(input).length).toBeLessThan(LIMITS.maxBytes);
    rejected(input, "payload_too_large");
    expect(decodeCommoditySubmittedContext("[".repeat(LIMITS.maxBytes + 1))).toEqual({ ok: false, reason: "payload_too_large" });
  });

  it("checks depth before descending and never truncates retained metadata", () => {
    const input = fixture();
    let nested: unknown = null;
    for (let index = 0; index < LIMITS.maxDepth - 3; index += 1) nested = { child: nested };
    input.evidence.source_receipts.nested = nested;
    accepted(input);
    input.evidence.source_receipts.nested = { child: nested };
    rejected(input, "resource_limit");
  });

  it("enforces the node ceiling independently of bytes and depth", () => {
    const input = fixture();
    input.evidence.source_receipts.entries = [];
    let baseNodes = 0;
    JSON.parse(JSON.stringify(input), (_key, value) => { baseNodes += 1; return value; });
    input.evidence.source_receipts.entries = Array(LIMITS.maxNodes - baseNodes).fill(null);
    accepted(input);
    (input.evidence.source_receipts.entries as unknown[]).push(null);
    rejected(input, "resource_limit");
  });

  it("rejects nonfinite and unsafe numeric values, retaining zero, null and negative values", () => {
    const input = fixture();
    input.evidence.source_receipts.number = 1;
    const serialized = JSON.stringify(input);
    for (const number of ["1e400", "-1e400", "9007199254740993"]) {
      expect(decodeCommoditySubmittedContext(serialized.replace('"number":1', '"number":' + number))).toEqual({ ok: false, reason: "invalid_structure" });
    }
    const negativeZero = decodeCommoditySubmittedContext(serialized.replace('"number":1', '"number":-0'));
    expect(negativeZero.ok).toBe(true);
    if (negativeZero.ok) expect(Object.is(negativeZero.submittedContext.evidence.source_receipts.number, -0)).toBe(true);
  });

  it.each(["\u0000", "\ud800", "\udfff", "x\ud800y"])("rejects invalid scalar text %j", text => {
    const input = fixture();
    input.evidence.source_receipts.text = text;
    rejected(input, "invalid_structure");
  });

  it.each(["__proto__", "constructor", "prototype", "", "x".repeat(129), "x\n", "\ud800"])(
    "rejects unsafe or oversized metadata key %j", key => {
      const input = fixture();
      input.evidence.source_receipts = JSON.parse("{" + JSON.stringify(key) + ":null}");
      rejected(input, "invalid_structure");
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    },
  );

  it("rejects duplicate keys at every level, including escaped equivalent spellings", () => {
    const serialized = JSON.stringify(fixture());
    for (const candidate of [
      serialized.replace('"commodity_id":"oil"', '"commodity_id":"gold","commodity_id":"oil"'),
      serialized.replace('"commodity_id":"oil"', '"commodity_id":"gold","commodity_\\u0069d":"oil"'),
      serialized.replace('"id":"oil"', '"id":"gold","id":"oil"'),
      serialized.replace('"available_at":null', '"available_at":"claimed","available_at":null'),
    ]) expect(decodeCommoditySubmittedContext(candidate)).toEqual({ ok: false, reason: "duplicate_keys" });
  });

  it("does not confuse repeated keys in different records or punctuation inside strings", () => {
    const input = fixture();
    input.evidence.source_receipts = {
      entries: [{ id: 1, text: '":{,["id","]"]}' }, { id: 2, text: '\\"quoted\\"' }],
      spaced: " café ", decomposed: "e\u0301", composed: "é",
    };
    const result = decodeCommoditySubmittedContext(JSON.stringify(input, null, 2));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.submittedContext.evidence.source_receipts).toEqual(input.evidence.source_receipts);
  });
});
