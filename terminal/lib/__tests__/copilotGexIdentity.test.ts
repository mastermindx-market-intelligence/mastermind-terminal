// T06 — Copilot options evidence: one qualified GEX basis or explicit partial/unavailable
// subrecords. Producer contract (Macro origin/main, read 2026-10-08):
//   - options_hub.gex/v1 (engine/options_hub.py): `asof` is the bare reference session date
//     "YYYY-MM-DD" (the latest greeks date); the dev fixture carries a full ISO stamp instead.
//   - options_structure.gex_state/v1 (scripts/build_gex_board.py `_session_close_asof`): `asof`
//     is the session date anchored at the 16:00 America/New_York close, with an explicit offset.
//     compute_gex_state(asof=None) falls back to the UTC BUILD time, which is not a session.
// So a session is the New York trading date of a close receipt; a stamp before that day's
// 16:00 ET close is an intraday / pre-close observation and is never the same session read
// as an end-of-day ladder for that date.
import { afterEach, describe, expect, it } from "vitest";
import { capJson, curateGex, execTool } from "../copilotTools";

type Obj = Record<string, unknown>;

const GEX_NUMBERS = [
  "spot", "net_gex_bn", "gamma_flip", "call_wall", "put_wall", "call_walls", "put_walls",
  "magnet", "max_pain", "pin_probability", "dist_to_flip_pct", "gamma_regime",
];
const carriesNumbers = (o: unknown): boolean => {
  const r = o && typeof o === "object" && !Array.isArray(o) ? (o as Obj) : null;
  return !!r && GEX_NUMBERS.some((k) => r[k] != null);
};

const strikes = [
  { strike: 600, gamma_call: 3, gamma_put: -1 },
  { strike: 590, gamma_call: 1, gamma_put: -4 },
];
const ladder = (o: Obj = {}): Obj => ({
  schema: "options_hub.gex/v1", root: "SPY", asof: "2026-10-02", basis: "dealer-sign", revision: "r1",
  spot_ref: 600, net_gex_bn: 2, gamma_flip: 590, call_wall: 610, put_wall: 580, by_strike: strikes, ...o,
});
const state = (o: Obj = {}): Obj => ({
  schema: "options_structure.gex_state/v1", root: "SPY", asof: "2026-10-02T16:00:00-04:00", basis: "dealer-sign",
  revision: "r1", spot: 601, net_gex_bn: 1, gamma_flip: 589, call_wall: 610, put_wall: 580, gamma_regime: "PIN", ...o,
});

describe("curateGex — owner root binds every source, not only a fused pair", () => {
  it("a ladder-only payload for another root is withheld, never that symbol's GEX", () => {
    const out = curateGex(ladder({ root: "QQQ" }), null, "SPY");
    expect(carriesNumbers(out)).toBe(false);
    expect(out.no_data).toBe(true);
    expect(out.root ?? null).toBeNull();
    expect((out.withheld as Obj | undefined)?.ladder).toMatchObject({ root: "QQQ", asof: "2026-10-02" });
  });
  it("a state-only payload for another root is withheld, never that symbol's GEX", () => {
    const out = curateGex(null, state({ root: "QQQ" }), "SPY");
    expect(carriesNumbers(out)).toBe(false);
    expect(out.no_data).toBe(true);
    expect((out.withheld as Obj | undefined)?.state).toMatchObject({ root: "QQQ" });
  });
  it("a single source without a producer root cannot be bound to the requested symbol", () => {
    for (const out of [
      curateGex(ladder({ root: undefined }), null, "SPY"),
      curateGex(null, state({ root: undefined }), "SPY"),
    ]) {
      expect(carriesNumbers(out)).toBe(false);
      expect(out.no_data).toBe(true);
      expect(String(out.reason)).toMatch(/root/i);
    }
  });
  it("a wrong-root half of a pair is withheld instead of shown as separate evidence", () => {
    const out = curateGex(ladder(), state({ root: "QQQ", spot: 777.77 }), "SPY");
    expect(JSON.stringify(out)).not.toContain("777.77");
    expect(out.status).toBe("partial");
    expect(out.source).toBe("ladder");
    expect(out.root).toBe("SPY");
    expect((out.withheld as Obj | undefined)?.state).toMatchObject({ root: "QQQ" });
  });
  it("a legitimate single source is an explicit partial with its own clock and the missing half named", () => {
    const out = curateGex(ladder(), null, "SPY");
    expect(out.status).toBe("partial");
    expect(out.source).toBe("ladder");
    expect(out.root).toBe("SPY");
    expect(out.asof_ladder).toBe("2026-10-02");
    expect(out.asof_state).toBeNull();
    expect(out.net_gex_bn).toBe(2);
    expect(String(out.limitations)).toMatch(/state/i);
  });
});

describe("curateGex — session identity follows the producer clocks", () => {
  it("an intraday state is never fused with the same date's end-of-day ladder", () => {
    const out = curateGex(ladder(), state({ asof: "2026-10-02T11:30:00-04:00" }), "SPY");
    expect(out.mixed_source).toBe(true);
    expect(carriesNumbers(out)).toBe(false);
    expect((out.state as Obj).asof).toBe("2026-10-02T11:30:00-04:00");
    expect((out.ladder as Obj).asof).toBe("2026-10-02");
  });
  it("a post-close state stamped on the next UTC day is the same New York session", () => {
    const out = curateGex(ladder(), state({ asof: "2026-10-03T01:00:00Z" }), "SPY");
    expect(out.mixed_source).not.toBe(true);
    expect(out.status).toBe("matched");
    expect(out.session).toBe("2026-10-02");
  });
  it("a fused read is dated by its shared session, not by the newer of the two stamps", () => {
    const out = curateGex(ladder(), state(), "SPY");
    expect(out.status).toBe("matched");
    expect(out.asof).toBe("2026-10-02");
    expect(out.asof_state).toBe("2026-10-02T16:00:00-04:00");
    expect(out.asof_ladder).toBe("2026-10-02");
  });
  it("a timestamp without a zone cannot prove which session it belongs to", () => {
    const out = curateGex(ladder(), state({ asof: "2026-10-02T16:30:00" }), "SPY");
    expect(out.status).not.toBe("matched");
    expect(out.mixed_source).toBe(true);
  });
});

describe("curateGex — null, measured zero and unavailable stay distinct", () => {
  it("measured zero net gamma is a number, not missing", () => {
    const out = curateGex(null, state({ net_gex_bn: 0 }), "SPY");
    expect(out.net_gex_bn).toBe(0);
    expect(out.no_data).not.toBe(true);
  });
  it("an empty ladder shell is unavailable with its own reason, distinct from no coverage", () => {
    const shell = curateGex(ladder({ net_gex_bn: null, gamma_flip: null, call_wall: null, put_wall: null, by_strike: [] }), null, "SPY");
    const absent = curateGex(null, null, "SPY");
    expect(shell.no_data).toBe(true);
    expect(carriesNumbers(shell)).toBe(false);
    expect(absent.no_data).toBe(true);
    expect(shell.reason).not.toBe(absent.reason);
    expect((shell.withheld as Obj | undefined)?.ladder).toMatchObject({ root: "SPY", asof: "2026-10-02" });
  });
  it("a state with no net gamma beside a usable ladder is named as unavailable", () => {
    const out = curateGex(ladder(), state({ net_gex_bn: null }), "SPY");
    expect(out.status).toBe("partial");
    expect(out.source).toBe("ladder");
    expect((out.withheld as Obj | undefined)?.state).toBeTruthy();
  });
});

describe("execTool get_options_summary — FLOW_FIXTURE single-root state sample", () => {
  const prev = process.env.FLOW_FIXTURE;
  afterEach(() => {
    if (prev === undefined) delete process.env.FLOW_FIXTURE;
    else process.env.FLOW_FIXTURE = prev;
  });
  it("the SPY state sample never answers for a root with no fixture ladder", async () => {
    process.env.FLOW_FIXTURE = "1";
    const out = await execTool("get_options_summary", { symbol: "AAPL" });
    const gex = out.gex as Obj;
    const text = JSON.stringify(out);
    expect(text).not.toContain("751.71");
    expect(text).not.toContain("4.6735");
    expect(gex.no_data).toBe(true);
    expect((gex.withheld as Obj | undefined)?.state).toMatchObject({ root: "SPY" });
  });
  it("NVDA keeps its own ladder and withholds the SPY state", async () => {
    process.env.FLOW_FIXTURE = "1";
    const out = await execTool("get_options_summary", { symbol: "NVDA" });
    const gex = out.gex as Obj;
    expect(JSON.stringify(out)).not.toContain("751.71");
    expect(gex.status).toBe("partial");
    expect(gex.root).toBe("NVDA");
    expect(gex.net_gex_bn).toBe(-1.24);
    expect((gex.withheld as Obj | undefined)?.state).toMatchObject({ root: "SPY" });
  });
  it("SPY shows the fixture ladder and state separately, each with its own clock", async () => {
    process.env.FLOW_FIXTURE = "1";
    const out = await execTool("get_options_summary", { symbol: "SPY" });
    const gex = out.gex as Obj;
    expect(gex.mixed_source).toBe(true);
    expect(carriesNumbers(gex)).toBe(false);
    expect((gex.state as Obj).asof).toBe("2026-07-10T06:21:31+00:00");
    expect((gex.ladder as Obj).asof).toBe("2026-07-10T20:15:00Z");
  });
});

describe("capJson — budget pressure keeps GEX identity and caveats or refuses truthfully", () => {
  const variants: Record<string, Obj> = {
    matched: curateGex(ladder(), state(), "SPY"),
    separate: curateGex(ladder(), state({ asof: "2026-10-02T11:30:00-04:00" }), "SPY"),
    partial: curateGex(ladder(), null, "SPY"),
  };
  const envelope = (gex: Obj): Obj => ({
    symbol: "SPY",
    iv: { spot: 600, asof: "2026-10-02", iv_term: [{ label: "1W", iv_pct: 20 }], term_slope: "x".repeat(120) },
    gex,
  });

  it("GEX never silently vanishes: kept with identity, or a typed oversize refusal", () => {
    const bad: string[] = [];
    for (const [name, gex] of Object.entries(variants)) {
      for (let cap = 60; cap <= 2000; cap += 20) {
        const out = capJson(envelope(gex), cap);
        const kept = out.gex as Obj | undefined;
        if (!kept) {
          if (!(out.no_data === true && out.oversize === true && typeof out.reason === "string")) bad.push(`${name}@${cap}: gex dropped without refusal`);
          continue;
        }
        for (const rec of [kept, kept.state as Obj | undefined, kept.ladder as Obj | undefined]) {
          if (carriesNumbers(rec) && (rec!.root == null || rec!.asof == null)) bad.push(`${name}@${cap}: numbers without root/asof`);
        }
        if (kept.mixed_source === true && kept.limitations == null) bad.push(`${name}@${cap}: mixed without limitations`);
        if (kept.status === "partial" && kept.limitations == null) bad.push(`${name}@${cap}: partial without limitations`);
      }
    }
    expect(bad).toEqual([]);
  });
  it("a compacted separate read keeps both subrecord clocks", () => {
    const env = { symbol: "SPY", gex: variants.separate };
    const full = Buffer.byteLength(JSON.stringify(env), "utf8");
    const out = capJson(env, full - 40);
    const gex = out.gex as Obj | undefined;
    if (!gex) {
      expect(out.no_data === true && out.oversize === true).toBe(true);
      return;
    }
    expect(gex.mixed_source).toBe(true);
    expect((gex.state as Obj | undefined)?.asof).toBe("2026-10-02T11:30:00-04:00");
    expect((gex.ladder as Obj | undefined)?.asof).toBe("2026-10-02");
  });
  it("stale reasons survive whenever the stale verdict survives", () => {
    const bad: number[] = [];
    for (let cap = 80; cap <= 600; cap += 10) {
      const out = capJson({
        verdict: "RISK_OFF", score: 72, asof: "2026-10-02", stale: true,
        stale_reasons: ["missing_or_invalid_asof", "future_built"], detail: "y".repeat(400),
      }, cap);
      if (out.stale === true && !Array.isArray(out.stale_reasons)) bad.push(cap);
    }
    expect(bad).toEqual([]);
  });
});
