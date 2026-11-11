import { describe, expect, it } from "vitest";
import {
  SCENARIO_CAPTURE_LIMITS,
  SCENARIO_CAPTURE_SCHEMA,
  createScenarioCapture,
  parseScenarioCapture,
  validateScenarioInputs,
} from "../investigationScenario";

/**
 * Tests for the INPUT/REFERENCE-ONLY scenario-capture contract on the
 * Investigation manifest.
 *
 * The ground truth is the frozen wire contract itself: a manifest may carry
 * the caller's panel inputs and a REFERENCE to the options_hub source (digests
 * and byte lengths of retained native bytes) — never the protected basis,
 * never a result, never a recomputation. The ORIGINAL full-value fixture
 * (schema `investigation_scenario_capture.v1`, basis + result + source_as_of)
 * MUST be refused everywhere it can appear.
 *
 * SCENARIO_REFERENCE_JSON below is byte-identical to the fixture embedded in
 * test_investigation_scenario.py — the two suites prove the same wire JSON
 * parses cross-language.
 */

const BASIS_SHA = "b9cc4728b6b52d78c47927ec4e17f1f466fdd633c27ec23e7e059e575eacd358";
const GEX_SHA = "a9a5c765bc9ca21cd5b0509edbc4f848afdb976420036af64ce32d5797d7a51d";
const MOVES_SHA = "643277d3ac8a4e361d77c7dfee3485bd116545d5d84a34bc88e638ef70e2b940";

const SCENARIO_REFERENCE_JSON = `{"schema":"investigation_scenario_reference.v1","model_version":"exposure-scenario/v1","inputs":{"targetSpot":600,"deltaSigmaPts":-1,"days":0.25},"source":{"owner":"options_hub","root":"SPX","session":"2026-10-16","source_as_of":"2026-10-16t21:14:09.000001-04:00","evaluated_at":"2026-10-16T21:14:10-04:00","lens":{"kind":"all"},"selection_key":"2026-10-16|2026-10-16T20:00:00-04:00,2026-12-18|2026-12-18T20:00:00-05:00","basis_sha256":"${BASIS_SHA}","gex":{"sha256":"${GEX_SHA}","byte_length":4096},"moves":{"sha256":"${MOVES_SHA}","byte_length":512}}}`;

/** A fresh canonical reference object on every call. */
function sourceFixture(): Record<string, unknown> {
  return {
    owner: "options_hub",
    root: "SPX",
    session: "2026-10-16",
    source_as_of: "2026-10-16",
    evaluated_at: "2026-10-16T21:14:10-04:00",
    lens: { kind: "one", exp: "2026-10-16" },
    selection_key: "2026-10-16|2026-10-16T20:00:00-04:00",
    basis_sha256: BASIS_SHA,
    gex: { sha256: GEX_SHA, byte_length: 4096 },
    moves: null,
  };
}

function inputsFixture(): Record<string, unknown> {
  return { targetSpot: 600, deltaSigmaPts: -1, days: 0.25 };
}

/** Selection key over the two fixture expiries plus n extra sorted days from 2027-01-01. */
function longSelectionKey(n: number): string {
  const parts: string[] = ["2026-10-16|2026-10-16T20:00:00-04:00"];
  const base = Date.UTC(2027, 0, 1);
  for (let i = 0; i < n; i++) {
    const d = new Date(base + i * 86400_000).toISOString().slice(0, 10);
    parts.push(`${d}|${d}T20:00:00-05:00`);
  }
  return parts.join(",");
}

describe("parseScenarioCapture", () => {
  it("accepts the canonical reference fixture, round-trips JSON, key order immaterial", () => {
    const raw = JSON.parse(SCENARIO_REFERENCE_JSON) as unknown;
    const parsed = parseScenarioCapture(raw);
    expect(parsed).not.toBeNull();
    expect(parsed).toEqual({
      schema: SCENARIO_CAPTURE_SCHEMA,
      model_version: "exposure-scenario/v1",
      inputs: { targetSpot: 600, deltaSigmaPts: -1, days: 0.25 },
      source: {
        owner: "options_hub",
        root: "SPX",
        session: "2026-10-16",
        source_as_of: "2026-10-16t21:14:09.000001-04:00",
        evaluated_at: "2026-10-16T21:14:10-04:00",
        lens: { kind: "all" },
        selection_key: "2026-10-16|2026-10-16T20:00:00-04:00,2026-12-18|2026-12-18T20:00:00-05:00",
        basis_sha256: BASIS_SHA,
        gex: { sha256: GEX_SHA, byte_length: 4096 },
        moves: { sha256: MOVES_SHA, byte_length: 512 },
      },
    });
    const reordered = (JSON.parse(SCENARIO_REFERENCE_JSON) as Record<string, unknown>);
    const { source, inputs } = reordered;
    expect(parseScenarioCapture({ source, inputs, schema: reordered.schema, model_version: reordered.model_version }))
      .toEqual(parsed);
  });

  it("retains clocks and digests verbatim — no normalization, moves:null stays null", () => {
    const raw: Record<string, unknown> = {
      schema: SCENARIO_CAPTURE_SCHEMA,
      model_version: "exposure-scenario/v1",
      inputs: inputsFixture(),
      source: {
        ...sourceFixture(),
        root: "BRK.B",
        source_as_of: null,
        evaluated_at: "2026-10-16t14:30:00+05:45",
        lens: { kind: "zero" },
        selection_key: "2026-10-16|2026-10-16T20:00:00-04:00",
        basis_sha256: GEX_SHA,
        gex: { sha256: GEX_SHA, byte_length: SCENARIO_CAPTURE_LIMITS.gexBytes },
      },
    };
    const parsed = parseScenarioCapture(raw);
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    expect(parsed.source.source_as_of).toBe(null); // unknown stays an explicit null, no invention
    expect(parsed.source.evaluated_at).toBe("2026-10-16t14:30:00+05:45"); // lowercase t, offset kept
    expect(parsed.source.selection_key).toBe("2026-10-16|2026-10-16T20:00:00-04:00");
    expect(parsed.source.moves).toBe(null); // no latest fallback, no gex-digest substitution
    expect(parsed.source.gex.byte_length).toBe(SCENARIO_CAPTURE_LIMITS.gexBytes); // 8 MiB boundary accepted
    expect(parsed.source.root).toBe("BRK.B");
  });

  it("REFUSES the original full-value capture — basis/result can never return", () => {
    const legacy = {
      schema: "investigation_scenario_capture.v1",
      model_version: "exposure-scenario/v1",
      source_as_of: "2026-10-16",
      basis: {
        root: "SPX", session: "2026-10-16", referenceSpot: 600.24,
        gexMn: -1383, vexMn: 220, cexMn: -80, emPct: null,
        qualification: "qualified", sourceRef: null,
      },
      inputs: inputsFixture(),
      result: {
        ok: true, version: "exposure-scenario/v1",
        moveFraction: -0.00039984015794078426, movePct: -0.039984015794078426,
        inputs: inputsFixture(),
        terms: { spotMn: 55.297685843137, volMn: 220, timeMn: 20 },
        totalMn: 184.70211915233698, joint: false, missing: [],
      },
    };
    expect(parseScenarioCapture(legacy)).toBeNull();
    // Even re-dressed with the new discriminator, the full-value shape is refused:
    expect(parseScenarioCapture({ ...legacy, schema: SCENARIO_CAPTURE_SCHEMA })).toBeNull();
    // And the new capture with legacy keys ADDED is refused, not trimmed:
    const added = JSON.parse(SCENARIO_REFERENCE_JSON) as Record<string, unknown>;
    added.basis = legacy.basis;
    added.result = legacy.result;
    expect(parseScenarioCapture(added)).toBeNull();
  });

  it("refuses extra, hidden, accessor, inherited and spoofed fields at every level", () => {
    const extraTop = JSON.parse(SCENARIO_REFERENCE_JSON) as Record<string, unknown>;
    extraTop.attestation = "trust-me";
    expect(parseScenarioCapture(extraTop)).toBeNull();

    const extraSource = JSON.parse(SCENARIO_REFERENCE_JSON) as Record<string, unknown>;
    (extraSource.source as Record<string, unknown>).bucket = "s3://nope";
    expect(parseScenarioCapture(extraSource)).toBeNull();

    const hidden = JSON.parse(SCENARIO_REFERENCE_JSON) as Record<string, unknown>;
    Object.defineProperty(hidden, "result", { value: { totalMn: 184.68 }, enumerable: false });
    expect(parseScenarioCapture(hidden)).toBeNull(); // non-enumerable own key: refused, never dropped

    const accessor = JSON.parse(SCENARIO_REFERENCE_JSON) as Record<string, unknown>;
    let reads = 0;
    Object.defineProperty(accessor, "inputs", {
      enumerable: true,
      get: () => { reads += 1; return inputsFixture(); },
    });
    expect(parseScenarioCapture(accessor)).toBeNull();
    expect(reads).toBe(0); // the getter was never executed

    const inherited = Object.create({ qualification: "qualified" }) as Record<string, unknown>;
    Object.assign(inherited, JSON.parse(SCENARIO_REFERENCE_JSON) as object);
    expect(parseScenarioCapture(inherited)).toBeNull(); // prototype is not Object.prototype

    class Spoofed { schema = SCENARIO_CAPTURE_SCHEMA; }
    const spoofed = Object.assign(new Spoofed(), JSON.parse(SCENARIO_REFERENCE_JSON) as object);
    expect(parseScenarioCapture(spoofed)).toBeNull();
  });

  it("refuses coerced numerics: strings, booleans, NaN, ±∞", () => {
    const coerce = (over: Record<string, unknown>): unknown => {
      const raw = JSON.parse(SCENARIO_REFERENCE_JSON) as Record<string, unknown>;
      raw.inputs = { ...inputsFixture(), ...over };
      return raw;
    };
    expect(parseScenarioCapture(coerce({ targetSpot: "600" }))).toBeNull(); // string number
    expect(parseScenarioCapture(coerce({ deltaSigmaPts: true }))).toBeNull(); // boolean
    expect(parseScenarioCapture(coerce({ days: Number.NaN }))).toBeNull();
    expect(parseScenarioCapture(coerce({ targetSpot: Number.POSITIVE_INFINITY }))).toBeNull();
    expect(parseScenarioCapture(coerce({ days: Number.NEGATIVE_INFINITY }))).toBeNull();
    const boolLen = JSON.parse(SCENARIO_REFERENCE_JSON) as Record<string, unknown>;
    (boolLen.source as Record<string, unknown>).gex = { sha256: GEX_SHA, byte_length: true };
    expect(parseScenarioCapture(boolLen)).toBeNull();
  });

  it("refuses bad digests and byte bounds — 8 MiB / 1 MiB ceilings are exact", () => {
    const digest = (over: Record<string, unknown>): unknown => {
      const raw = JSON.parse(SCENARIO_REFERENCE_JSON) as Record<string, unknown>;
      raw.source = { ...(raw.source as Record<string, unknown>), ...over };
      return raw;
    };
    expect(parseScenarioCapture(digest({ basis_sha256: BASIS_SHA.slice(1) }))).toBeNull(); // 63
    expect(parseScenarioCapture(digest({ basis_sha256: `${BASIS_SHA}0` }))).toBeNull(); // 65
    expect(parseScenarioCapture(digest({ basis_sha256: BASIS_SHA.toUpperCase() }))).toBeNull(); // not lowercase hex
    expect(parseScenarioCapture(digest({ basis_sha256: "g".repeat(64) }))).toBeNull(); // not hex
    const gexOver = JSON.parse(SCENARIO_REFERENCE_JSON) as Record<string, unknown>;
    (gexOver.source as Record<string, unknown>).gex = {
      sha256: GEX_SHA, byte_length: SCENARIO_CAPTURE_LIMITS.gexBytes + 1,
    };
    expect(parseScenarioCapture(gexOver)).toBeNull(); // over the 8 MiB contract ceiling
    const movesOver = JSON.parse(SCENARIO_REFERENCE_JSON) as Record<string, unknown>;
    (movesOver.source as Record<string, unknown>).moves = {
      sha256: MOVES_SHA, byte_length: SCENARIO_CAPTURE_LIMITS.movesBytes + 1,
    };
    expect(parseScenarioCapture(movesOver)).toBeNull(); // over the 1 MiB contract ceiling
    expect(parseScenarioCapture(digest({ gex: { sha256: GEX_SHA, byte_length: 0 } }))).toBeNull();
    expect(parseScenarioCapture(digest({ gex: { sha256: GEX_SHA, byte_length: 4096.5 } }))).toBeNull();
    expect(parseScenarioCapture(digest({ gex: { sha256: GEX_SHA, byte_length: "4096" } }))).toBeNull();
    expect(parseScenarioCapture(digest({ moves: { sha256: MOVES_SHA } }))).toBeNull(); // missing byte_length
  });

  it("refuses bad roots and non-hub owners", () => {
    const owner = (over: Record<string, unknown>): unknown => {
      const raw = JSON.parse(SCENARIO_REFERENCE_JSON) as Record<string, unknown>;
      raw.source = { ...(raw.source as Record<string, unknown>), ...over };
      return raw;
    };
    expect(parseScenarioCapture(owner({ owner: "moves_hub" }))).toBeNull();
    expect(parseScenarioCapture(owner({ owner: "options_hub " }))).toBeNull();
    expect(parseScenarioCapture(owner({ root: "spx" }))).toBeNull(); // lowercase: not a native root
    expect(parseScenarioCapture(owner({ root: "SPXWXXXXXXXX" }))).toBeNull(); // letters-only run breaks the root rule
    expect(parseScenarioCapture(owner({ root: "gex:../../admin/secrets" }))).toBeNull(); // traversal shape
    expect(parseScenarioCapture(owner({ root: "" }))).toBeNull();
  });

  it("refuses invalid clocks and schema/version drift", () => {
    const clock = (over: Record<string, unknown>): unknown => {
      const raw = JSON.parse(SCENARIO_REFERENCE_JSON) as Record<string, unknown>;
      raw.source = { ...(raw.source as Record<string, unknown>), ...over };
      return raw;
    };
    expect(parseScenarioCapture(clock({ evaluated_at: "2026-10-16T21:14:10" }))).toBeNull(); // naive
    expect(parseScenarioCapture(clock({ evaluated_at: "2026-02-30T00:00:00Z" }))).toBeNull(); // impossible date
    expect(parseScenarioCapture(clock({ evaluated_at: "2026-10-16T23:59:60Z" }))).toBeNull(); // leap second
    expect(parseScenarioCapture(clock({ evaluated_at: "2026-10-16T21:14:10+24:00" }))).toBeNull(); // absurd offset
    expect(parseScenarioCapture(clock({ source_as_of: "2026-13-01" }))).toBeNull(); // month 13
    expect(parseScenarioCapture(clock({ source_as_of: "" }))).toBeNull();
    expect(parseScenarioCapture(clock({ session: "2026-2-16" }))).toBeNull();
    const schemaDrift = JSON.parse(SCENARIO_REFERENCE_JSON) as Record<string, unknown>;
    schemaDrift.schema = "investigation_scenario_capture.v1"; // the refused old discriminator
    expect(parseScenarioCapture(schemaDrift)).toBeNull();
    const versionDrift = JSON.parse(SCENARIO_REFERENCE_JSON) as Record<string, unknown>;
    versionDrift.model_version = "exposure-scenario/v2";
    expect(parseScenarioCapture(versionDrift)).toBeNull();
  });

  it("enforces clock ordering — and keeps unknown null without inventing a clock", () => {
    const clock = (over: Record<string, unknown>): unknown => {
      const raw = JSON.parse(SCENARIO_REFERENCE_JSON) as Record<string, unknown>;
      raw.source = { ...(raw.source as Record<string, unknown>), ...over };
      return raw;
    };
    // evaluated_at's calendar date cannot precede the session:
    expect(parseScenarioCapture(clock({ evaluated_at: "2026-10-15T23:00:00-04:00" }))).toBeNull();
    // source_as_of in the future of evaluated_at, judged across offsets:
    expect(parseScenarioCapture(clock({
      source_as_of: "2026-10-17T01:00:00-04:00",
      evaluated_at: "2026-10-16T21:00:00-04:00",
    }))).toBeNull();
    // …while an earlier-instant source clock on a LATER written date is fine:
    expect(parseScenarioCapture(clock({
      source_as_of: "2026-10-16T23:00:00+05:00", // 17:30Z
      evaluated_at: "2026-10-17T02:00:00+05:00", // 21:00Z next day
    }))).not.toBeNull();
    // A bare-date source clock after the evaluation date:
    expect(parseScenarioCapture(clock({
      source_as_of: "2026-10-17",
      evaluated_at: "2026-10-16T21:14:10-04:00",
    }))).toBeNull();
    // Sub-second ordering is exact:
    expect(parseScenarioCapture(clock({
      source_as_of: "2026-10-16T21:14:10.9Z",
      evaluated_at: "2026-10-16T21:14:10.1Z",
    }))).toBeNull();
    // Unknown stays an explicit null — accepted, never invented:
    const kept = parseScenarioCapture(clock({ source_as_of: null }));
    expect(kept).not.toBeNull();
    expect(kept?.source.source_as_of ?? null).toBe(null);
  });

  it("enforces the lens contract: five kinds, no extras, no ex-zero", () => {
    const lens = (l: unknown): unknown => {
      const raw = JSON.parse(SCENARIO_REFERENCE_JSON) as Record<string, unknown>;
      const source: Record<string, unknown> = { ...(raw.source as Record<string, unknown>), lens: l };
      if (l && typeof l === "object" && "kind" in l) {
        const selected = l as { kind: unknown; exp?: unknown };
        const exp = selected.kind === "zero" ? source.session : selected.kind === "one" ? selected.exp : null;
        if (typeof exp === "string") source.selection_key = String(source.selection_key).split(",").filter(pair => pair.startsWith(exp + "|")).join(",");
      }
      raw.source = source;
      return raw;
    };
    expect(parseScenarioCapture(lens({ kind: "all" }))).not.toBeNull();
    expect(parseScenarioCapture(lens({ kind: "zero" }))).not.toBeNull(); // session is in the selection
    expect(parseScenarioCapture(lens({ kind: "next-live" }))).not.toBeNull();
    expect(parseScenarioCapture(lens({ kind: "week" }))).not.toBeNull();
    expect(parseScenarioCapture(lens({ kind: "one", exp: "2026-12-18" }))).not.toBeNull();
    expect(parseScenarioCapture(lens({ kind: "one" }))).toBeNull(); // one needs its exp
    expect(parseScenarioCapture(lens({ kind: "one", exp: "2026-13-01" }))).toBeNull(); // real date only
    expect(parseScenarioCapture(lens({ kind: "all", exp: "2026-10-16" }))).toBeNull(); // no extra exp
    expect(parseScenarioCapture(lens({ kind: "ex-zero" }))).toBeNull(); // not in the frozen contract
    expect(parseScenarioCapture(lens({ kind: "gamma" }))).toBeNull();
    expect(parseScenarioCapture(lens("all"))).toBeNull();
  });

  it("enforces lens/selection agreement: one must select its expiry, zero its session", () => {
    const lens = (l: unknown): unknown => {
      const raw = JSON.parse(SCENARIO_REFERENCE_JSON) as Record<string, unknown>;
      const source: Record<string, unknown> = { ...(raw.source as Record<string, unknown>), lens: l };
      if (l && typeof l === "object" && "kind" in l) {
        const selected = l as { kind: unknown; exp?: unknown };
        const exp = selected.kind === "zero" ? source.session : selected.kind === "one" ? selected.exp : null;
        if (typeof exp === "string") source.selection_key = String(source.selection_key).split(",").filter(pair => pair.startsWith(exp + "|")).join(",");
      }
      raw.source = source;
      return raw;
    };
    expect(parseScenarioCapture(lens({ kind: "one", exp: "2027-03-19" }))).toBeNull(); // not selected
    expect(parseScenarioCapture(lens({ kind: "zero" }))).not.toBeNull(); // session selected
    const zeroMissing = JSON.parse(SCENARIO_REFERENCE_JSON) as Record<string, unknown>;
    const src = { ...(zeroMissing.source as Record<string, unknown>) };
    src.selection_key = "2026-12-18|2026-12-18T20:00:00-05:00"; // session not among the expiries
    src.lens = { kind: "zero" };
    zeroMissing.source = src;
    expect(parseScenarioCapture(zeroMissing)).toBeNull();
  });

  it("enforces the selection_key format, bounds, order and session floor", () => {
    const sel = (selectionKey: unknown): unknown => {
      const raw = JSON.parse(SCENARIO_REFERENCE_JSON) as Record<string, unknown>;
      raw.source = { ...(raw.source as Record<string, unknown>), selection_key: selectionKey };
      return raw;
    };
    expect(parseScenarioCapture(sel(""))).toBeNull(); // empty
    expect(parseScenarioCapture(sel("https://example.com/x.json"))).toBeNull(); // a URI is not a selection
    expect(parseScenarioCapture(sel("2026-12-18|2026-12-18T20:00:00-05:00,2026-10-16|2026-10-16T20:00:00-04:00")))
      .toBeNull(); // not strictly sorted
    expect(parseScenarioCapture(sel("2026-10-16|2026-10-16T20:00:00-04:00,2026-10-16|2026-10-16T20:00:00-04:00")))
      .toBeNull(); // duplicate full pair
    expect(parseScenarioCapture(sel("2026-10-16"))).toBeNull(); // no pair separator
    expect(parseScenarioCapture(sel("2026-10-16|2026-10-16T20:00:00"))).toBeNull(); // naive economic expiry
    expect(parseScenarioCapture(sel("2026-10-15|2026-10-15T20:00:00-04:00"))).toBeNull(); // expiry before session
    expect(parseScenarioCapture(sel("2026-10-16|2026-10-16T20:00:00-04:00|extra"))).toBeNull();
    expect(parseScenarioCapture(sel(longSelectionKey(SCENARIO_CAPTURE_LIMITS.selectionPairs - 1)))).not.toBeNull();
    expect(parseScenarioCapture(sel(longSelectionKey(SCENARIO_CAPTURE_LIMITS.selectionPairs)))).toBeNull(); // 129
    expect(parseScenarioCapture(sel("x".repeat(SCENARIO_CAPTURE_LIMITS.selectionKey + 1)))).toBeNull(); // > 16 KiB
    expect(parseScenarioCapture(sel(20261016))).toBeNull();
  });
});

describe("validateScenarioInputs", () => {
  it("accepts the exact local bounds and refuses coercion and drift", () => {
    expect(validateScenarioInputs(inputsFixture())).toEqual(inputsFixture());
    expect(validateScenarioInputs({ targetSpot: 0.01, deltaSigmaPts: -5, days: 5 })).toEqual(
      { targetSpot: 0.01, deltaSigmaPts: -5, days: 5 }); // boundaries inclusive
    expect(validateScenarioInputs(null)).toBeNull();
    expect(validateScenarioInputs(undefined)).toBeNull();
    expect(validateScenarioInputs([600, -1, 0.25])).toBeNull();
    expect(validateScenarioInputs({ targetSpot: 0, deltaSigmaPts: 0, days: 0 })).toBeNull(); // spot must be > 0
    expect(validateScenarioInputs({ targetSpot: 600, deltaSigmaPts: 5.01, days: 0 })).toBeNull();
    expect(validateScenarioInputs({ targetSpot: 600, deltaSigmaPts: -5.01, days: 0 })).toBeNull();
    expect(validateScenarioInputs({ targetSpot: 600, deltaSigmaPts: 0, days: 5.25 })).toBeNull();
    expect(validateScenarioInputs({ targetSpot: 600, deltaSigmaPts: 0, days: -0.25 })).toBeNull();
    expect(validateScenarioInputs({ targetSpot: "600", deltaSigmaPts: 0, days: 0 })).toBeNull();
    expect(validateScenarioInputs({ targetSpot: true, deltaSigmaPts: 0, days: 0 })).toBeNull();
    expect(validateScenarioInputs({ targetSpot: Number.NaN, deltaSigmaPts: 0, days: 0 })).toBeNull();
    expect(validateScenarioInputs({ ...inputsFixture(), extra: 1 })).toBeNull();
    expect(validateScenarioInputs({ targetSpot: 600, deltaSigmaPts: 0 })).toBeNull(); // missing days
  });

  it("does not invent relative-spot qualification — that stays native", () => {
    // The ±3% relative spot bound needs the protected exact basis; this parser
    // enforces only the absolute input bounds and must not guess a relative one.
    expect(validateScenarioInputs({ targetSpot: 1_000_000, deltaSigmaPts: 0, days: 0 }))
      .toEqual({ targetSpot: 1_000_000, deltaSigmaPts: 0, days: 0 });
  });
});

describe("createScenarioCapture", () => {
  it("builds the same capture parse does, detached from caller memory", () => {
    const source = sourceFixture();
    const inputs = inputsFixture();
    const out = createScenarioCapture(source, inputs);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    source.root = "HACKED";
    source.gex = { sha256: "0".repeat(64), byte_length: 1 };
    (source.lens as Record<string, unknown>).exp = "2020-01-01";
    inputs.targetSpot = 1;
    expect(out.capture.source.root).toBe("SPX");
    expect(out.capture.source.gex).toEqual({ sha256: GEX_SHA, byte_length: 4096 });
    expect((out.capture.source.lens as { exp: string }).exp).toBe("2026-10-16");
    expect(out.capture.inputs.targetSpot).toBe(600);
    expect(parseScenarioCapture(JSON.parse(JSON.stringify(out.capture)))).toEqual(out.capture);
  });

  it("refuses a missing or garbage source — nothing is invented, minted or substituted", () => {
    for (const bad of [null, undefined, 42, "x", [], true]) {
      expect(createScenarioCapture(bad, inputsFixture())).toEqual({ ok: false, reason: "invalid_source_reference" });
    }
  });

  it("refuses an original ScenarioBasis as source — never converted", () => {
    const basis = {
      root: "SPX", session: "2026-10-16", referenceSpot: 600.24,
      gexMn: -1383, vexMn: 220, cexMn: -80, emPct: null,
      qualification: "qualified", sourceRef: null,
    };
    expect(createScenarioCapture(basis, inputsFixture()))
      .toEqual({ ok: false, reason: "invalid_source_reference" });
  });

  it("refuses source-kind mixing: a reference plus legacy basis/result keys", () => {
    const mixed = {
      ...sourceFixture(),
      basis: { root: "SPX", referenceSpot: 600.24, gexMn: -1383 },
      result: { totalMn: 184.68 },
    };
    expect(createScenarioCapture(mixed, inputsFixture()))
      .toEqual({ ok: false, reason: "invalid_source_reference" });
  });

  it("refuses invalid inputs after a valid source", () => {
    expect(createScenarioCapture(sourceFixture(), null)).toEqual({ ok: false, reason: "invalid_inputs" });
    expect(createScenarioCapture(sourceFixture(), { targetSpot: "600", deltaSigmaPts: 0, days: 0 }))
      .toEqual({ ok: false, reason: "invalid_inputs" });
    expect(createScenarioCapture(sourceFixture(), { targetSpot: 600, deltaSigmaPts: 9, days: 0 }))
      .toEqual({ ok: false, reason: "invalid_inputs" });
  });

  it("survives cyclic and self-referential sources without looping or executing", () => {
    const cyclic = sourceFixture();
    cyclic.gex = cyclic as unknown as { sha256: string; byte_length: number };
    expect(createScenarioCapture(cyclic, inputsFixture()))
      .toEqual({ ok: false, reason: "invalid_source_reference" });
  });
});


describe("captured lens integration", () => {
  it("refuses other expiries under a one lens", () => {
    const raw = JSON.parse(SCENARIO_REFERENCE_JSON);
    raw.source.lens = { kind: "one", exp: "2026-10-16" };
    expect(parseScenarioCapture(raw)).toBeNull();
  });
  it("refuses other expiries under a zero lens", () => {
    const raw = JSON.parse(SCENARIO_REFERENCE_JSON);
    raw.source.lens = { kind: "zero" };
    expect(parseScenarioCapture(raw)).toBeNull();
  });
  it("refuses a lens kind getter without executing it", () => {
    const source = sourceFixture();
    let reads = 0;
    source.lens = Object.defineProperty({}, "kind", { enumerable: true, get() { reads++; return "all"; } });
    expect(createScenarioCapture(source, inputsFixture()).ok).toBe(false);
    expect(reads).toBe(0);
  });
});

// Native exposureMap selectionKey sorts full expiry/economic-instant pairs, not expiry alone.
it("preserves multiple economic instants for one expiry without permitting duplicates or disorder", () => {
  const source = sourceFixture();
  const first = "2026-10-16|2026-10-16T09:30:00-04:00";
  const second = "2026-10-16|2026-10-16T20:00:00-04:00";
  source.selection_key = `${first},${second}`;
  const made = createScenarioCapture(source, inputsFixture());
  expect(made.ok).toBe(true);
  if (made.ok) expect(parseScenarioCapture(made.capture)?.source.selection_key).toBe(source.selection_key);
  for (const selection_key of [`${first},${first}`, `${second},${first}`]) {
    expect(createScenarioCapture({ ...source, selection_key }, inputsFixture()).ok).toBe(false);
  }
});
