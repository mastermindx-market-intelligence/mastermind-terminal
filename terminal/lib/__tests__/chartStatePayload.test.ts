// Source-authored acceptance cases; test execution is deferred for this feature phase.
import { describe, expect, it } from "vitest";
import { chartStateSizeUpperBound, prepareChartStatePayload, CHART_STATE_SAFE_BYTES,
  type ChartStatePayload } from "../chartStatePayload";

const ack = (seq: number, error?: string) => ({ batch_id: "brain_fixture", seq,
  id: `ai_${seq}`, ok: !error, ...(error ? { error } : {}) });
function input(): ChartStatePayload {
  return { client: "terminal", origin_id: "fixture_origin", context_revision: 3,
    session: { symbol: "SYNTHETIC", tf: "D", pane_id: 0,
      indicators: [{ name: "rsix", params: { "eng.len": 14, "eng.on": true } }],
      capabilities: { tfs: ["D"], indicators: ["rsix"], command_target: { schema: "chart.command_target.v1" } },
      drawings: [], native_observations: { schema: "chart.native_live_observations.v1", status: "partial" } },
    acks: [ack(0)] };
}
const prepared = (value: ChartStatePayload, limit?: number) => {
  const result = prepareChartStatePayload(value, limit);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result;
};

describe("bounded chart-state mirror", () => {
  it("keeps the small snapshot wire shape and exact command receipt", () => {
    const original = input();
    const result = prepared(original);
    expect(JSON.parse(result.text)).toEqual(original);
    expect(result.sentAcks).toEqual(original.acks);
    expect(result.remainingAcks).toEqual([]);
    expect(result.sizeUpperBound).toBeLessThanOrEqual(CHART_STATE_SAFE_BYTES);
  });
  it("counts ASCII escaping and server spacing, not browser Unicode bytes only", () => {
    const text = JSON.stringify({ text: "中文🙂", value: 0.0000001 });
    const pythonEquivalent = '{"text": "\\u4e2d\\u6587\\ud83d\\ude42", "value": 1e-07}';
    expect(chartStateSizeUpperBound(text)).toBeGreaterThanOrEqual(pythonEquivalent.length);
    expect(chartStateSizeUpperBound(text)).toBeGreaterThan(new TextEncoder().encode(text).byteLength);
  });
  it("does not mistake punctuation inside a string for JSON structure", () => {
    expect(chartStateSizeUpperBound(JSON.stringify("1234567890:,:"))).toBe(
      chartStateSizeUpperBound(JSON.stringify("abcdefghijxyz")));
  });
  it("preserves exact FIFO acknowledgements across bounded batches", () => {
    const original = input();
    original.acks = Array.from({ length: 70 }, (_, i) => ack(i));
    const delivered: ChartStatePayload["acks"] = [];
    let remaining = original.acks;
    for (let i = 0; i < 3; i++) {
      const result = prepared({ ...original, acks: remaining });
      expect(result.sentAcks.length).toBeLessThanOrEqual(32);
      delivered.push(...result.sentAcks);
      remaining = result.remainingAcks;
    }
    expect(delivered).toEqual(original.acks);
    expect(remaining).toEqual([]);
  });
  it("removes drawing detail only in the transport projection", () => {
    const original = input();
    original.session.drawings = [{ id: "human_1", by: "user", op: "draw.path",
      args: { points: Array.from({ length: 5000 }, (_, i) => ({ t: 1700000000 + i, p: 100 + i })) } }];
    const before = JSON.stringify(original);
    const result = prepared(original);
    const body = JSON.parse(result.text);
    expect(body.session.drawings).toEqual([{ id: "human_1", by: "user", op: "draw.path" }]);
    expect(body.session.mirror_coverage.drawings).toEqual({ available: 1, returned: 1, omitted: 0, details_omitted: 1 });
    expect(body.session.native_observations).toEqual(original.session.native_observations);
    expect(body.acks).toEqual(original.acks);
    expect(JSON.stringify(original)).toBe(before);
  });
  it("reports an incomplete drawing roster without implying chart deletion", () => {
    const original = input();
    original.session.drawings = Array.from({ length: 500 }, (_, i) => ({ id: `human_${i}_${"x".repeat(100)}`, by: "user" }));
    const result = prepared(original, 4096);
    const body = JSON.parse(result.text);
    expect(body.session.mirror_coverage.drawings.omitted).toBeGreaterThan(0);
    expect(body.session.mirror_coverage.drawings.returned + body.session.mirror_coverage.drawings.omitted).toBe(500);
    expect(body.session.mirror_coverage.basis).toBe("transport_projection_not_chart_deletion");
    expect(result.sizeUpperBound).toBeLessThanOrEqual(4096);
  });
  it("retains native capability and target identity when large parameter documentation is withheld", () => {
    const original = input();
    (original.session.capabilities as any).native_parameters = { documentation: "设置".repeat(10000) };
    const body = JSON.parse(prepared(original).text);
    expect(body.session.capabilities.command_target).toEqual((original.session.capabilities as any).command_target);
    expect(body.session.capabilities.native_parameters.status).toBe("unavailable");
    expect(body.session.indicators).toEqual(original.session.indicators);
    expect(body.origin_id).toBe(original.origin_id);
    expect(body.context_revision).toBe(3);
  });
  it("sends an explicit unavailable marker when native evidence itself cannot fit", () => {
    const original = input();
    original.session.native_observations = { schema: "chart.native_live_observations.v1", data: "中文".repeat(10000) };
    const body = JSON.parse(prepared(original).text);
    expect(body.session.native_observations).toEqual({ schema: "chart.native_live_observations.v1",
      status: "unavailable", reason: "chart_state_budget" });
    expect(body.session.mirror_coverage.omitted_fields).toContain("native_observations");
    expect(body.acks).toEqual(original.acks);
  });
  it("reduces a large receipt batch without dropping later receipt identities", () => {
    const original = input();
    original.acks = Array.from({ length: 32 }, (_, i) => ack(i, "x".repeat(1000)));
    const result = prepared(original, 4096);
    expect(result.sentAcks.length).toBeGreaterThan(0);
    expect(result.sentAcks.length).toBeLessThan(32);
    expect([...result.sentAcks, ...result.remainingAcks]).toEqual(original.acks);
  });
  it("refuses an unfittable first acknowledgement without truncating it", () => {
    const original = input();
    original.acks = [ack(0, "x".repeat(100000))];
    expect(prepareChartStatePayload(original)).toEqual({ ok: false, reason: "essential_chart_state_too_large" });
    expect(original.acks[0].error).toHaveLength(100000);
  });
  it("refuses cyclic source data without consuming its ACK batch", () => {
    const original = input();
    original.session.cycle = original.session;
    expect(prepareChartStatePayload(original)).toEqual({ ok: false, reason: "chart_state_not_serializable" });
    expect(original.acks).toEqual([ack(0)]);
  });
});
