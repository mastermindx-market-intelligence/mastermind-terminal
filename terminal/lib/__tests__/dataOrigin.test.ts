// Data OS U02 — deriveDataOrigin: the pure rules that turn a daily-OHLC document's
// `view` block (schema terminal.ohlc_view.v1, produced by ingest/polygon_bars.py)
// into the frame-bar readout state. A file with NO view is the normal production
// state today and must read "unknown" — never an error, never a claimed "adjusted".
import { describe, expect, it } from "vitest";
import { deriveDataOrigin, originComposite, originNotCovered, originPending, originUnavailable } from "@/lib/dataOrigin";

const AS_OF = "2026-10-13T00:00:00Z";
const REV = "rev-2026-10-13-0007";

function contract(basis = "tradj") {
  return {
    schema: "dataos.view_contract.v1",
    purpose: "terminal_daily_ohlc",
    identity_namespace: "mmx/us/daily",
    field_units: { o: "vendor_adjusted_usd" },
    adjustment_reference: { basis, action_revision_set_id: REV, as_at: AS_OF },
    evidence_mode: { mode: "CURRENT", clock: "td_close", dependency_generation_ids: ["g1"], code_version: "1" },
    coverage: { from: "1999-01-04", to: "2026-10-10" },
    refusal_reasons: [],
  };
}

function view(overrides: Record<string, unknown> = {}) {
  return {
    schema: "terminal.ohlc_view.v1",
    contract: contract(),
    listing: { security_id: "s1", listing_id: "l1", mic: "XNAS", src: "polygon", refusal_reasons: [] },
    segments: [{ from: "1999-01-04", to: "2026-10-10", src: "polygon", bar_quality: "raw" }],
    basis_drift: null,
    suspected_breaks: [],
    refusal_reasons: [],
    ...overrides,
  };
}

function doc(overrides: Record<string, unknown> = {}) {
  return { t: "NVDA", o: 1, src: "polygon", bar_quality: "raw", bars: [], view: view(), ...overrides };
}

function deepFreeze<T>(v: T): T {
  if (v && typeof v === "object") {
    for (const k of Object.keys(v as object)) deepFreeze((v as Record<string, unknown>)[k]);
    Object.freeze(v);
  }
  return v;
}

describe("deriveDataOrigin", () => {
  it("u02_fix_known: tradj contract with no refusals is known, with contract facts copied verbatim", () => {
    const o = deriveDataOrigin("NVDA", doc());
    expect(o.state).toBe("known");
    expect(o.symbol).toBe("NVDA");
    expect(o.basis).toBe("tradj");
    expect(o.src).toBe("polygon");
    expect(o.asOf).toBe(AS_OF);
    expect(o.generation).toBe(REV);
    expect(o.mode).toBe("CURRENT");
    expect(o.refusals).toEqual([]);
    expect(o.openReconstructed).toBe(false);
    expect(o.segments).toEqual([{ from: "1999-01-04", to: "2026-10-10", src: "polygon", quality: "raw" }]);
    expect(o.suspectedBreaks).toBe(0);
    expect(o.basisDrift).toBe(false);
  });

  it("u02_fix_partial: a tradj contract with a caveat refusal is partial", () => {
    const o = deriveDataOrigin("NVDA", doc({ view: view({ refusal_reasons: ["SEGMENT_SRC_UNKNOWN"] }) }));
    expect(o.state).toBe("partial");
    expect(o.basis).toBe("tradj");
    expect(o.refusals).toEqual(["SEGMENT_SRC_UNKNOWN"]);
  });

  it("u02_fix_legacy_unknown: a real-shape legacy doc (no view) reads unknown/VIEW_ABSENT, never adjusted", () => {
    const o = deriveDataOrigin("NVDA", { t: "NVDA", o: 1, src: "deep", bar_quality: "synthetic_open_deepstore", bars: [] });
    expect(o.state).toBe("unknown");
    expect(o.refusals).toEqual(["VIEW_ABSENT"]);
    expect(o.src).toBe("deep");
    expect(o.openReconstructed).toBe(true);
    expect(o.basis).toBe(null);
    expect(o.segments).toEqual([]);
  });

  it.each(["VIEW_BASIS_UNSUPPORTED", "VENUE_OUT_OF_SCOPE", "LISTING_ABSENT"] as const)(
    "u02_fix_refused: %s refuses the view with no basis claim",
    (code) => {
      const o = deriveDataOrigin("NVDA", doc({ view: view({ refusal_reasons: [code] }) }));
      expect(o.state).toBe("refused");
      expect(o.basis).toBe(null);
      expect(o.refusals).toEqual([code]);
    },
  );

  it("u02_fix_refused: a basis other than tradj is refused and labelled VIEW_BASIS_UNSUPPORTED", () => {
    const o = deriveDataOrigin("NVDA", doc({ view: view({ contract: contract("sadj") }) }));
    expect(o.state).toBe("refused");
    expect(o.basis).toBe(null);
    expect(o.refusals).toEqual(["VIEW_BASIS_UNSUPPORTED"]);
  });

  it("u02_fix_contract_null: a view without a contract is unknown", () => {
    const o = deriveDataOrigin("NVDA", doc({ view: view({ contract: null }) }));
    expect(o.state).toBe("unknown");
    expect(o.basis).toBe(null);
    expect(o.src).toBe("polygon");   // segment/listing src still describes the file honestly
  });

  it("u02_fix_src_unknown_literal: the literal 'unknown' prints as null, never a lower-layer guess", () => {
    // Whichever layer WINS the chain, the literal "unknown" maps to null.
    const unknownListing = doc({
      view: view({
        listing: { src: "unknown" },
        segments: [{ from: "a", to: "b", src: "polygon", bar_quality: "raw" }],
      }),
    });
    expect(deriveDataOrigin("NVDA", unknownListing).src).toBe(null);
    expect(deriveDataOrigin("NVDA", { t: "NVDA", src: "unknown", bars: [] }).src).toBe(null);
    // A usable top-level src still loses to the listing layer's concrete answer.
    expect(deriveDataOrigin("NVDA", doc({ src: "unknown" })).src).toBe("polygon");
  });

  it("u02_fix_symbol_mismatch: a file for another symbol is never adopted", () => {
    const o = deriveDataOrigin("NVDA", doc({ t: "amd" }));
    expect(o.state).toBe("unknown");
    expect(o.refusals).toEqual(["SYMBOL_MISMATCH"]);
  });

  it("u02_fix_null_payload: no document is unavailable/DATA_ABSENT, distinct from unknown", () => {
    for (const payload of [null, undefined, "x", 7]) {
      const o = deriveDataOrigin("NVDA", payload);
      expect(o.state).toBe("unavailable");
      expect(o.refusals).toEqual(["DATA_ABSENT"]);
    }
  });

  it("u02_fix_pure: a deep-frozen payload neither throws nor changes", () => {
    const payload = deepFreeze(doc({
      view: view({
        refusal_reasons: ["BASIS_DRIFT_SUSPECTED"],
        basis_drift: { status: "SUSPECTED", date: "2026-10-09", stored_close: 1, vendor_close: 2, ratio: 2 },
        suspected_breaks: [{ status: "SUSPECTED", at: "2010-06-01", reason: "gap", retained_bars: 3 }],
      }),
    }));
    const before = JSON.stringify(payload);
    const o = deriveDataOrigin("NVDA", payload);
    expect(o.state).toBe("partial");
    expect(o.suspectedBreaks).toBe(1);
    expect(o.basisDrift).toBe(true);
    expect(JSON.stringify(payload)).toBe(before);
  });
});

describe("origin constructors", () => {
  it("originPending carries no facts", () => {
    const o = originPending("NVDA");
    expect(o).toMatchObject({ symbol: "NVDA", state: "pending", basis: null, src: null, asOf: null, generation: null, mode: null, openReconstructed: false, suspectedBreaks: 0, basisDrift: false, refusals: [], segments: [] });
  });
  it("originUnavailable is the failure state", () => {
    expect(originUnavailable("NVDA")).toMatchObject({ state: "unavailable", refusals: ["DATA_UNAVAILABLE"] });
  });
  it("originComposite is per-leg, not claimed in v1", () => {
    expect(originComposite("AAPL+MSFT")).toMatchObject({ state: "composite", refusals: ["COMPOSITE_NOT_IN_V1"] });
  });
  it("originNotCovered names its code", () => {
    expect(originNotCovered("NVDA", "INTRADAY_NOT_IN_V1")).toMatchObject({ state: "unknown", refusals: ["INTRADAY_NOT_IN_V1"] });
  });
});
