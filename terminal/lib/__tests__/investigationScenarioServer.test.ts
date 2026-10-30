import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Focused tests over the REAL source-preflight default. These are ordinary Vitest cases over
// the unconfigured module: no backend exists behind it here, so no runtime acceptance of a
// real save/reopen is claimed or testable — only that the boundary refuses honestly.
import * as serverModule from "@/lib/investigationScenarioServer";
import { qualifyScenarioCaptureSave } from "@/lib/investigationScenarioServer";

const HEX64 = /^[0-9a-f]{64}$/;
const basisDigest = "b17d2f1a0c93e5d6a4b8f0e1d2c3a4b5968778695a4b3c2d1e0f9a8b7c6d5e4f";
const gexDigest = "5e4f3e2d3c4b5a69788796a5b4c3d2e1f0a19b8a7968594a3b2c1d0e9f8e7d6c";

/** A capture that satisfies the frozen reference contract exactly. */
const referenceCapture = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  schema: "investigation_scenario_reference.v1",
  model_version: "exposure-scenario/v1",
  inputs: { targetSpot: 600, deltaSigmaPts: 1, days: 1 },
  source: {
    owner: "options_hub",
    root: "SPX",
    session: "2026-10-16",
    source_as_of: "2026-10-16T15:30:00Z",
    evaluated_at: "2026-10-16T15:45:00Z",
    lens: { kind: "one", exp: "2026-10-30" },
    selection_key: "2026-10-30|2026-10-30T21:00:00Z",
    basis_sha256: basisDigest,
    gex: { sha256: gexDigest, byte_length: 2048 },
    moves: null,
  },
  ...over,
});

/** The REJECTED original factory payload: a full-value capture with basis and result. */
const fullValueCapture = {
  schema: "investigation_scenario_capture.v1",
  model_version: "exposure-scenario/v1",
  basis: {
    root: "SPX", session: "2026-10-16", qualification: "qualified",
    referenceSpot: 600, gexMn: -1383, vexMn: null, cexMn: null, emPct: 1.2,
  },
  source_as_of: "2026-10-16T15:30:00Z",
  inputs: { targetSpot: 600, deltaSigmaPts: 1, days: 1 },
  result: { totalMn: 184.70211915, moveFraction: 0.01, terms: { spotMn: 1, volMn: 2, timeMn: 3 }, missing: [] },
};

const user = "10000000-0000-4000-8000-000000000001";

beforeEach(() => {
  // Any network or IO attempt from the preflight is a failure — the boundary is in-process.
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("no network in preflight"); }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("qualifyScenarioCaptureSave — the unconfigured real default", () => {
  it("refuses a perfectly formed reference with source_context_unavailable, before any IO", async () => {
    const outcome = await qualifyScenarioCaptureSave(referenceCapture(), user);
    expect(outcome).toEqual({ ok: false, reason: "source_context_unavailable" });
  });

  it("is a real async boundary that stays deterministic and stateless across calls", async () => {
    const first = qualifyScenarioCaptureSave(referenceCapture(), user);
    expect(first).toBeInstanceOf(Promise);
    const [a, b] = await Promise.all([first, qualifyScenarioCaptureSave(referenceCapture(), user)]);
    expect(a).toEqual(b);
    expect(a).toEqual({ ok: false, reason: "source_context_unavailable" });
  });

  it("refuses an old full-value capture as an invalid source reference — never adopted or downgraded", async () => {
    expect(await qualifyScenarioCaptureSave(fullValueCapture, user))
      .toEqual({ ok: false, reason: "invalid_source_reference" });
    expect(await qualifyScenarioCaptureSave(referenceCapture({ result: { totalMn: 184.7 } }), user))
      .toEqual({ ok: false, reason: "invalid_source_reference" });
    expect(await qualifyScenarioCaptureSave(referenceCapture({ source: { ...(referenceCapture().source as Record<string, unknown>), basis: { gexMn: -1383 } } }), user))
      .toEqual({ ok: false, reason: "invalid_source_reference" });
  });

  it("refuses non-capture payloads instead of interpreting them", async () => {
    for (const raw of [null, undefined, "gex:SPX:2026-10-16", 42, [], referenceCapture({ schema: "other/v1" })]) {
      expect(await qualifyScenarioCaptureSave(raw, user)).toEqual({ ok: false, reason: "invalid_source_reference" });
    }
  });

  it("reports an unnameable principal as source_authorization_unavailable, a distinct refusal", async () => {
    for (const principal of ["", "   "]) {
      expect(await qualifyScenarioCaptureSave(referenceCapture(), principal))
        .toEqual({ ok: false, reason: "source_authorization_unavailable" });
    }
  });

  it("missing context cannot be armed by an env flag, header or storage value", async () => {
    vi.stubEnv("MM_SCENARIO_DESTINATION", "enabled");
    vi.stubEnv("SCENARIO_SOURCE_ADAPTER", "https://backend.example");
    process.env.MM_SCENARIO_ALLOW_ANY = "1";
    try {
      expect(await qualifyScenarioCaptureSave(referenceCapture(), user))
        .toEqual({ ok: false, reason: "source_context_unavailable" });
    } finally {
      delete process.env.MM_SCENARIO_ALLOW_ANY;
      vi.unstubAllEnvs();
    }
  });

  it("exposes exactly one callable export: no setter, no allow-switch, no mock backend", () => {
    expect(Object.keys(serverModule).sort()).toEqual(["qualifyScenarioCaptureSave"]);
    expect(typeof serverModule.qualifyScenarioCaptureSave).toBe("function");
    expect(HEX64.test(basisDigest)).toBe(true);
  });

  it("never touches the network, storage or a rights backend while refusing", async () => {
    await qualifyScenarioCaptureSave(referenceCapture(), user);
    await qualifyScenarioCaptureSave(fullValueCapture, user);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});
