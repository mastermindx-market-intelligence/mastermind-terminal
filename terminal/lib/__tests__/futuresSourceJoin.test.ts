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
    ["volume", (p: any) => p.frames[0].bar.total++],
    ["OHLC", (p: any) => p.frames[0].bar.highTicks = 1],
    ["future availability", (p: any) => p.frames[0].bar.availableAtNs = String(BigInt(p.cutoffMs) * BigInt(1000000) + BigInt(1))],
    ["CVD", (p: any) => p.frames[1].bar.cvdKnown++],
    ["duplicate cell", (p: any) => p.frames[0].bar.cells.push(p.frames[0].bar.cells[0])],
    ["depth coverage", (p: any) => p.frames[0].depth.coverageFraction = .5],
    ["negative depth", (p: any) => p.frames[0].depth.levels[0].bidMean = -1],
    ["gamma coordinate", (p: any) => p.frames[0].gex.projection.mapped[0].futuresPrice++],
    ["root", (p: any) => p.frames[0].gex.projection.indexRoot = "NDX"],
    ["missing publication clock", (p: any) => delete p.publishedAtMs],
    ["retrospective live", (p: any) => { p.basis = "realtime"; p.availabilityBasis = "vendor_capture_retrospective"; }],
    ["unbounded grace", (p: any) => p.freshUntilMs = now + 86400000],
  ] as const) it(`rejects invalid ${name}`, () => {
    const p = packet(); mutate(p); expect(parseFuturesPublishedView(p, request, now)).toBeNull();
  });
  it("drops unapproved payload fields", () => {
    const p = packet() as any; p.secret = "do-not-forward"; p.frames[0].bar.vendorToken = "no";
    const parsed = parseFuturesPublishedView(p, request, now); expect(parsed).not.toBeNull();
    expect(JSON.stringify(parsed)).not.toMatch(/secret|vendorToken/);
  });
});
describe("closed request vocabulary", () => {
  for (const q of ["pair=ES&pair=NQ", "pair=CL", "interval=01", "rows=0", "at=1.5", "expiry=2026-02-30", "url=http://evil", "path=ES.json", "mapping=other"])
    it(`rejects ${q}`, () => expect(parseFuturesRequest(new URLSearchParams(q))).toBeNull());
  it("roundtrips canonical input", () => expect(parseFuturesRequest(new URLSearchParams(futuresQuery(request)))).toEqual(request));
});
