import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { joinFuturesSource } from "../futuresSourceJoin";
import { parseFuturesPublishedView } from "../futuresTransport";
import { DEFAULT_FUTURES_REQUEST as request, parseFuturesRequest, futuresQuery } from "../futuresRequest";
import { fixtureNow as now, sourceFixture } from "./fixtures/futuresSourceFixture";

const read = (source = sourceFixture(), query = request) => joinFuturesSource(source, query, now);
function packet() { const r = read(); expect(r.status).toBe("data"); if (r.status !== "data") throw Error(JSON.stringify(r)); return r.data; }
describe("production futures source join", () => {
  it("joins the actual calculation modules under exact source hashes without exposing raw inputs", () => {
    const r = packet(); expect(r.frames).toHaveLength(24); expect(r.frames.at(-1)?.gex.status).toBe("ok");
    expect(r.frames.reduce((v, f) => v + f.bar.total, 0)).toBe(4203);
    expect(JSON.stringify(r)).not.toMatch(/payloadSha256|payloadJson|gammaAttachment|order_id|distributionEvidenceRef/);
  });
  it("switches NQ identity and source together", () => {
    const r = read(sourceFixture("NQ"), { ...request, pair: "NQ" });
    expect(r.status).toBe("data"); if (r.status !== "data") return;
    expect(r.data.contract).toBe("NQZ6"); expect(r.data.frames.at(-1)?.gex.status).toBe("ok");
    expect(read(sourceFixture("NQ"))).toEqual({ status: "unavailable", reason: "source_invalid" });
  });
  for (const expiry of ["zero", "ex-zero", "2026-10-16"]) it(`retains receipt-bound ${expiry} exposure`, () => {
    const r = read(sourceFixture(), { ...request, expiry }); expect(r.status).toBe("data");
    if (r.status !== "data") return; expect(r.data.frames.at(-1)?.gex.status).toBe("ok");
  });
  it("takes only the last publication cutoff at or before requested replay, never future bars", () => {
    const at = now - 18 * 60000;
    const r = read(sourceFixture(), { ...request, cutoffMs: at }); expect(r.status).toBe("data");
    if (r.status !== "data") return;
    expect(r.data.frames).toHaveLength(6); expect(r.data.cutoffMs).toBeLessThanOrEqual(at);
  });
  it("never silently upgrades internal research samples to subscriber data", () => {
    for (const audience of ["internal_only", "public_research_sample", ""]) {
      const s = sourceFixture(); s.audience = audience;
      expect(read(s)).toEqual({ status: "unavailable", reason: "source_restricted" });
    }
  });
  it("separates old current data, future publication, and missing replay snapshots", () => {
    const s = sourceFixture(); s.basis = "realtime"; s.freshUntilMs = now - 1;
    expect(read(s)).toEqual({ status: "unavailable", reason: "stale_source" });
    s.publishedAtMs = now + 1; expect(read(s)).toEqual({ status: "unavailable", reason: "source_invalid" });
    expect(read(sourceFixture(), { ...request, cutoffMs: now + 1 })).toEqual({ status: "unavailable", reason: "no_replay_frame" });
  });
  it("a corrupt gamma digest cannot erase or contaminate valid futures executions", () => {
    const s = sourceFixture(); for (const view of s.views) for (const f of view.frames) f.gammaAttachment.payload.sha256 = "0".repeat(64);
    const r = read(s); expect(r.status).toBe("data"); if (r.status !== "data") return;
    expect(r.data.frames.every(f => f.gex.status === "unavailable")).toBe(true);
    expect(r.data.frames.reduce((v, f) => v + f.bar.total, 0)).toBe(4203);
  });
  it("never recomputes a live conversion against cash-closed index prices", () => {
    const s = sourceFixture(); for (const view of s.views) for (const f of view.frames) f.gammaAttachment.cashSession = "closed";
    const r = read(s); expect(r.status).toBe("data"); if (r.status !== "data") return;
    expect(r.data.frames.at(-1)?.gex).toEqual({ status: "unavailable", reason: "cash_closed" });
  });
  it("ambiguously duplicated snapshot identity fails, rather than selecting a convenient version", () => {
    const s = sourceFixture(); s.views.push(structuredClone(s.views[1]));
    expect(read(s)).toEqual({ status: "unavailable", reason: "source_invalid" });
  });
});
describe("wire-level conservation and replay boundary", () => {
  for (const [name, mutate] of [
    ["volume", (p: ReturnType<typeof packet>) => p.frames[0].bar.total++],
    ["OHLC", (p: ReturnType<typeof packet>) => p.frames[0].bar.highTicks = 1],
    ["future availability", (p: ReturnType<typeof packet>) => p.frames[0].bar.availableAtNs = String(BigInt(p.cutoffMs) * BigInt(1000000) + BigInt(1))],
    ["CVD", (p: ReturnType<typeof packet>) => p.frames[1].bar.cvdKnown++],
    ["duplicate cell", (p: ReturnType<typeof packet>) => p.frames[0].bar.cells.push(p.frames[0].bar.cells[0])],
    ["depth coverage", (p: ReturnType<typeof packet>) => p.frames[0].depth!.coverageFraction = .5],
    ["negative depth", (p: ReturnType<typeof packet>) => p.frames[0].depth!.levels[0].bidMean = -1],
    ["gamma coordinate", (p: ReturnType<typeof packet>) => { if (p.frames[0].gex.status === "ok") p.frames[0].gex.projection.mapped[0].futuresPrice++; }],
    ["root", (p: ReturnType<typeof packet>) => { if (p.frames[0].gex.status === "ok") p.frames[0].gex.projection.indexRoot = "NDX"; }],
    ["missing publication clock", (p: ReturnType<typeof packet>) => Reflect.deleteProperty(p, "publishedAtMs")],
    ["retrospective live", (p: ReturnType<typeof packet>) => { p.basis = "realtime"; p.availabilityBasis = "vendor_capture_retrospective"; }],
    ["unbounded grace", (p: ReturnType<typeof packet>) => p.freshUntilMs = now + 86400000],
  ] as const) it(`rejects invalid ${name}`, () => {
    const p = packet(); mutate(p); expect(parseFuturesPublishedView(p, request, now)).toBeNull();
  });
  it("exposes incomplete execution coverage without claiming complete delta", () => {
    const p = packet(); p.tradeCoverage = "partial";
    for (const f of p.frames) f.bar.cvd = null;
    expect(parseFuturesPublishedView(p, request, now)?.tradeCoverage).toBe("partial");
    p.frames[0].bar.cvd = p.frames[0].bar.cvdKnown;
    expect(parseFuturesPublishedView(p, request, now)).toBeNull();
  });
  it("requires contract definitions before frame decisions and within actual validity", () => {
    const p = packet(); p.definition.availableAtNs = String(BigInt(p.cutoffMs) * BigInt(1000000) + BigInt(1));
    expect(parseFuturesPublishedView(p, request, now)).toBeNull();
    const q = packet(); q.definition.validUntilNs = q.frames[0].bar.endNs;
    expect(parseFuturesPublishedView(q, request, now)).toBeNull();
  });
  it("does not let a fresh source heartbeat disguise an old live chart cutoff", () => {
    const p = packet(); p.basis = "realtime"; p.availabilityBasis = "source_observed";
    p.sourceAsOfMs = now + 3600000; p.publishedAtMs = p.sourceAsOfMs; p.freshUntilMs = p.sourceAsOfMs + 5000;
    expect(parseFuturesPublishedView(p, request, p.publishedAtMs)).toBeNull();
  });
  it("withholds a cutoff beyond the publisher's observed source time", () => {
    const p = packet(); p.sourceAsOfMs = p.cutoffMs - 1;
    expect(parseFuturesPublishedView(p, request, now)).toBeNull();
  });
  it("drops unapproved payload fields", () => {
    const p = packet(); Object.assign(p, { secret: "do-not-forward" }); Object.assign(p.frames[0].bar, { vendorToken: "no" });
    const parsed = parseFuturesPublishedView(p, request, now); expect(parsed).not.toBeNull();
    expect(JSON.stringify(parsed)).not.toMatch(/secret|vendorToken/);
  });
});
describe("closed request vocabulary", () => {
  for (const q of ["pair=ES&pair=NQ", "pair=CL", "interval=01", "rows=0", "at=1.5", "expiry=2026-02-30", "url=http://evil", "path=ES.json", "mapping=other"])
    it(`rejects ${q}`, () => expect(parseFuturesRequest(new URLSearchParams(q))).toBeNull());
  it("roundtrips canonical input", () => expect(parseFuturesRequest(new URLSearchParams(futuresQuery(request)))).toEqual(request));
});

describe("production source hardening", () => {
  it("withholds gamma from a different definition while preserving valid futures flow", () => {
    const source = sourceFixture();
    for (const v of source.views) for (const f of v.frames) f.gammaAttachment.input.contract.definitionId = "wrong:definition";
    const result = read(source); expect(result.status).toBe("data");
    if (result.status !== "data") return;
    expect(result.data.frames.every(f => f.gex.status === "unavailable")).toBe(true);
    expect(result.data.frames.reduce((n, f) => n + f.bar.total, 0)).toBe(4203);
  });
  it("does not widen the actual definition validity through a gamma attachment", () => {
    const source = sourceFixture();
    for (const v of source.views) for (const f of v.frames) f.gammaAttachment.input.contract.validUntilMs += 1;
    const result = read(source); expect(result.status).toBe("data");
    if (result.status === "data") expect(result.data.frames.every(f => f.gex.status === "unavailable")).toBe(true);
  });
  it("rejects a mismatched projected definition before browser rendering", () => {
    const p = packet(), g = p.frames[0].gex;
    if (g.status !== "ok") throw Error("fixture"); g.provenance.definitionId = "wrong:definition";
    expect(parseFuturesPublishedView(p, request, now)).toBeNull();
  });
  it("bounds total gamma points rather than only each frame", () => {
    const p = packet();
    for (const f of p.frames) {
      if (f.gex.status !== "ok") throw Error("fixture");
      const ratio = f.gex.projection.ratio;
      f.gex.projection.mapped = Array.from({ length: 2048 }, (_, i) => {
        const strike = 7400 + i / 4, price = strike * ratio;
        return { sourceStrike: strike, futuresPrice: price, displayTickPrice: Math.round(price * 4) / 4, gammaNetMn: 1 };
      });
    }
    expect(parseFuturesPublishedView(p, request, now)).toBeNull();
  });
  it("never forwards an unbounded provenance string", () => {
    const p = packet(), g = p.frames[0].gex;
    if (g.status !== "ok") throw Error("fixture"); g.provenance.inventoryBasis = "x".repeat(129);
    expect(parseFuturesPublishedView(p, request, now)).toBeNull();
  });
  it("suppresses imbalance flags when execution coverage is partial", () => {
    const p = packet(); p.tradeCoverage = "partial";
    for (const f of p.frames) { f.bar.cvd = null; for (const c of f.bar.cells) { c.buyImbalance = true; c.sellImbalance = true; } }
    const result = parseFuturesPublishedView(p, request, now); expect(result).not.toBeNull();
    expect(result?.frames.every(f => f.bar.cells.every(c => !c.buyImbalance && !c.sellImbalance))).toBe(true);
  });
});

it("does not keep an expired contract current merely because the feed heartbeat is fresh", () => {
  const p = packet(); p.basis = "realtime"; p.availabilityBasis = "source_observed";
  p.definition.validUntilNs = String(BigInt(now - 1) * BigInt(1000000));
  expect(parseFuturesPublishedView(p, request, now)).toBeNull();
  // Its recorded observations remain valid at an explicit earlier replay decision.
  const replay = { ...request, cutoffMs: p.cutoffMs }; p.request = replay;
  expect(parseFuturesPublishedView(p, replay, now)).not.toBeNull();
});

describe("named level wire boundary", () => {
  it("retains source and mapped prices with explicit all-expiry scope", () => {
    const got = parseFuturesPublishedView(packet(), request, now); expect(got).not.toBeNull();
    const last = got!.frames.at(-1)!.gex; if (last.status !== "ok") throw Error("fixture");
    expect(last.landmarks).toHaveLength(3); expect(last.landmarks!.every(v => v.expiryScope === "all")).toBe(true);
  });
  for (const fault of ["wrong_price", "wrong_scope", "duplicate_role", "unknown_role"] as const)
    it(`refuses ${fault} before named level rendering`, () => {
      const p = packet(), g = p.frames[0].gex; if (g.status !== "ok" || !g.landmarks?.length) throw Error("fixture");
      if (fault === "wrong_price") g.landmarks[0].futuresPrice += .25;
      if (fault === "wrong_scope") Object.assign(g.landmarks[0], { expiryScope: "zero" });
      if (fault === "duplicate_role") g.landmarks[1].key = g.landmarks[0].key;
      if (fault === "unknown_role") Object.assign(g.landmarks[0], { key: "unsupported_wall" });
      expect(parseFuturesPublishedView(p, request, now)).toBeNull();
    });
  it("keeps old publications without named levels compatible", () => {
    const p = packet(); for (const f of p.frames) if (f.gex.status === "ok") delete f.gex.landmarks;
    const got = parseFuturesPublishedView(p, request, now); expect(got).not.toBeNull();
    const g = got!.frames[0].gex; if (g.status === "ok") expect(g.landmarks).toEqual([]);
  });
});

it("retains the derived frame-availability clock and cannot relabel old exposure as fresh", () => {
  const p = packet(), g = p.frames[0].gex; if (g.status !== "ok") throw Error("fixture");
  const result = parseFuturesPublishedView(p, request, now); expect(result).not.toBeNull();
  const parsed = result!.frames[0].gex; if (parsed.status !== "ok") throw Error("fixture");
  expect(parsed.provenance.frameAvailableAtMs).toBe(Math.max(g.provenance.sourceAvailableAtMs,
    g.provenance.indexAvailableAtMs, g.provenance.futuresAvailableAtMs));
  g.provenance.exposureAgeMs = 0; expect(parseFuturesPublishedView(p, request, now)).toBeNull();
});
it("rejects fabricated frame availability rather than silently stripping it", () => {
  const p = packet(), g = p.frames[0].gex; if (g.status !== "ok") throw Error("fixture");
  g.provenance.frameAvailableAtMs += 1; expect(parseFuturesPublishedView(p, request, now)).toBeNull();
});
