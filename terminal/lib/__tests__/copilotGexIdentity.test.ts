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
import { promises as fsp } from "fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { capJson, curateGex, execTool, MIN_CAP_BYTES } from "../copilotTools";

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

// Review round 1 (head 8ff5ad35): a read that did not land is not an empty result
// (failure-state-truth law). The hub read falls back to the R2 mirror; only a 404 from every
// store that was asked is an absence. 5xx, network errors, timeouts and unparseable bodies are
// failed reads: the half is unknown, never "not published" and never "no coverage".
describe("execTool get_options_summary — failed GEX reads are unavailable, not absent", () => {
  const prev = process.env.FLOW_FIXTURE;
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    if (prev === undefined) delete process.env.FLOW_FIXTURE;
    else process.env.FLOW_FIXTURE = prev;
  });
  type Side = "state" | "ladder";
  const json = (status: number, body?: unknown) =>
    new Response(body === undefined ? "{}" : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const stub = (handler: (side: Side, url: string, init?: RequestInit) => Promise<Response>) => {
    delete process.env.FLOW_FIXTURE;
    vi.stubGlobal("fetch", vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      return handler(/gexstate|gex_state/.test(url) ? "state" : "ladder", url, init);
    }));
  };
  const aaplLadder = ladder({ root: "AAPL" });
  const aaplState = state({ root: "AAPL" });
  const gexOf = async () => (await execTool("get_options_summary", { symbol: "AAPL" })).gex as Obj;

  it("a state read that returned HTTP 503 is not reported as an unpublished state", async () => {
    stub(async (side) => (side === "state" ? json(503) : json(200, aaplLadder)));
    const gex = await gexOf();
    expect(gex.status).toBe("partial");
    expect(gex.source).toBe("ladder");
    expect(String(gex.limitations)).not.toMatch(/no state was published/);
    expect(String(gex.limitations)).toMatch(/state read failed/);
    expect(String(gex.limitations)).toMatch(/unknown/);
    expect(JSON.stringify(gex.read_failures)).toMatch(/HTTP 503/);
  });
  it("both reads 404 is no coverage; both 503 or a network error is a failed read with a different reason", async () => {
    stub(async () => json(404));
    const absent = await gexOf();
    stub(async () => json(503));
    const down = await gexOf();
    stub(async () => {
      throw new TypeError("fetch failed");
    });
    const thrown = await gexOf();
    expect(absent.no_data).toBe(true);
    expect(String(absent.reason)).toMatch(/no GEX coverage/);
    for (const failed of [down, thrown]) {
      expect(failed.status).toBe("unavailable");
      expect(failed.no_data).toBe(true);
      expect(failed.reason).not.toBe(absent.reason);
      expect(String(failed.reason)).not.toMatch(/coverage|published/);
      expect(String(failed.reason)).toMatch(/read failed/);
    }
    expect(JSON.stringify(down.read_failures)).toMatch(/HTTP 503/);
    expect(JSON.stringify(thrown.read_failures)).toMatch(/network/);
  });
  it("a mirror 404 behind a failed hub read does not turn the failure into an absence", async () => {
    stub(async (_side, url) => (url.includes("/api/hub/") ? json(502) : json(404)));
    const gex = await gexOf();
    expect(gex.status).toBe("unavailable");
    expect(String(gex.reason)).not.toMatch(/coverage/);
    expect(String(gex.reason)).toMatch(/read failed/);
  });
  it("an unparseable body is a failed read, not an absence", async () => {
    stub(async (side) =>
      side === "state" ? new Response("<html>bad gateway</html>", { status: 200 }) : json(200, aaplLadder),
    );
    const gex = await gexOf();
    expect(gex.status).toBe("partial");
    expect(String(gex.limitations)).toMatch(/state read failed/);
    expect(String(gex.limitations)).not.toMatch(/no state was published/);
  });
  it("a ladder read that times out is described as unavailable, not absent", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    stub((side, _url, init) => {
      if (side === "state") return Promise.resolve(json(200, aaplState));
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    });
    const pending = gexOf();
    await vi.advanceTimersByTimeAsync(3_100);
    await vi.advanceTimersByTimeAsync(3_100);
    const gex = await pending;
    expect(gex.status).toBe("partial");
    expect(gex.source).toBe("state");
    expect(String(gex.limitations)).not.toMatch(/no ladder was published/);
    expect(String(gex.limitations)).toMatch(/ladder read failed/);
    expect(JSON.stringify(gex.read_failures)).toMatch(/timed out/);
  });
});

// Review round 1: each test below kills one surviving single-point mutant of head 8ff5ad35.
describe("curateGex — identity invariants each guarded by a test", () => {
  it("(M2) a rootless source is withheld even when no owner root is given", () => {
    for (const out of [curateGex(ladder({ root: undefined }), null), curateGex(null, state({ root: undefined }))]) {
      expect(out.no_data).toBe(true);
      expect(carriesNumbers(out)).toBe(false);
      expect(String(out.reason)).toMatch(/root/);
    }
  });
  it("(M11) the unclocked half of a separate read carries no numbers", () => {
    for (const bad of [undefined, "not a clock"]) {
      const out = curateGex(ladder(), state({ asof: bad }), "SPY");
      expect(out.status).toBe("separate");
      expect(carriesNumbers(out.state)).toBe(false);
      expect(String((out.state as Obj).unavailable)).toMatch(/clock/);
      expect(carriesNumbers(out.ladder)).toBe(true);
      const flipped = curateGex(ladder({ asof: bad }), state(), "SPY");
      expect(flipped.status).toBe("separate");
      expect(carriesNumbers(flipped.ladder)).toBe(false);
    }
  });
  it("(M12) a basis mismatch alone is never one matched read", () => {
    const out = curateGex(ladder({ basis: "customer-sign" }), state(), "SPY");
    expect(out.status).not.toBe("matched");
    expect(out.mixed_source).toBe(true);
  });
  it("(M13) two unknown revisions are not an identical revision", () => {
    const out = curateGex(ladder({ revision: undefined }), state({ revision: undefined }), "SPY");
    expect(out.status).not.toBe("matched");
    expect(out.mixed_source).toBe(true);
  });
  it("(M15) an explicit session later than the producer clock leaves the session unknown", () => {
    const out = curateGex(
      ladder({ asof: "2026-10-09" }),
      state({ session: "2026-10-09", asof: "2026-10-08T16:00:00-04:00" }),
      "SPY",
    );
    expect(out.status).not.toBe("matched");
    expect(out.mixed_source).toBe(true);
    expect((out.state as Obj).session).toBeNull();
  });
});

describe("capJson — last-resort refusal and dropped keys stay truthful", () => {
  const staleEnvelope = (): Obj => ({
    symbol: "SPY",
    stale: true,
    stale_reasons: ["missing_or_invalid_asof", "future_built"],
    market_risk: {
      status: "partial",
      asof: "2026-10-02",
      limitations: "risk read is partial",
      withheld: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, "w".repeat(40)])),
    },
  });
  it("(M7) the oversize refusal keeps stale_reasons beside stale", () => {
    const out = capJson(staleEnvelope(), 600);
    expect(out.oversize).toBe(true);
    expect(out.stale).toBe(true);
    expect(out.stale_reasons).toEqual(["missing_or_invalid_asof", "future_built"]);
  });
  it("no output exceeds the requested budget or the documented refusal floor", () => {
    const bad: string[] = [];
    const inputs: Obj[] = [
      staleEnvelope(),
      { symbol: "SPY", gex: curateGex(ladder(), state({ asof: "2026-10-02T11:30:00-04:00" }), "SPY") },
      { symbol: "LONGSYMBOL.HK", root: "LONGSYMBOL.HK", story: "y".repeat(5000) },
    ];
    for (const [i, input] of inputs.entries()) {
      for (let cap = 1; cap <= 2000; cap += 13) {
        const bytes = Buffer.byteLength(JSON.stringify(capJson(input, cap)), "utf8");
        if (bytes > Math.max(cap, MIN_CAP_BYTES ?? 0)) bad.push(`${i}@${cap}: ${bytes}`);
      }
    }
    expect(bad).toEqual([]);
  });
  it("a top-level key dropped for budget is named in omitted", () => {
    const out = capJson({
      symbol: "SPY",
      iv: { spot: 600, term_slope: "x".repeat(900), extra: "z".repeat(900) },
      gex: curateGex(ladder(), null, "SPY"),
    }, 500);
    expect(out.iv).toBeUndefined();
    expect(out.omitted).toEqual(expect.arrayContaining(["iv"]));
  });
});

describe("execTool get_options_summary — an IV file that could not be read is not a missing file", () => {
  const prev = process.env.FLOW_FIXTURE;
  afterEach(() => {
    vi.restoreAllMocks();
    if (prev === undefined) delete process.env.FLOW_FIXTURE;
    else process.env.FLOW_FIXTURE = prev;
  });
  const withOptsRead = (fail: () => Promise<string>) => {
    process.env.FLOW_FIXTURE = "1";
    const real = fsp.readFile.bind(fsp);
    vi.spyOn(fsp, "readFile").mockImplementation(((file: unknown, ...rest: unknown[]) =>
      String(file).endsWith("AAPL.opts.json") ? fail() : (real as (...a: unknown[]) => Promise<string>)(file, ...rest)) as typeof fsp.readFile);
  };
  it("a missing IV file is no coverage; an unreadable or corrupt one is a failed read", async () => {
    withOptsRead(() => Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" })));
    const missing = (await execTool("get_options_summary", { symbol: "AAPL" })).iv as Obj;
    withOptsRead(() => Promise.reject(Object.assign(new Error("EIO"), { code: "EIO" })));
    const io = (await execTool("get_options_summary", { symbol: "AAPL" })).iv as Obj;
    withOptsRead(() => Promise.resolve("{not json"));
    const corrupt = (await execTool("get_options_summary", { symbol: "AAPL" })).iv as Obj;
    expect(missing.no_data).toBe(true);
    expect(String(missing.reason)).toMatch(/no options IV file/);
    for (const failed of [io, corrupt]) {
      expect(failed.no_data).toBe(true);
      expect(failed.status).toBe("unavailable");
      expect(String(failed.reason)).not.toMatch(/no options IV file/);
      expect(String(failed.reason)).toMatch(/could not be read/);
    }
  });
});
