// Deferred acceptance specifications. No runtime or strategy qualification is claimed.
import { describe, expect, it, vi } from "vitest";
import { validateEnvelope, translate, type ChartCommandV2 } from "../chartBus";

const target = { schema: "chart.command_target.v1", origin_id: "origin-input",
  context_revision: 3, pane_id: 0, symbol: "NVDA", tf: "D" };
const caps = { tfs: ["D", "1W"], indicators: ["sma", "ema"] };
function command(op = "ai.clear", args?: unknown): Record<string, unknown> {
  return { v: 2, on: true, batch_id: "brain_input", seq: 0, op,
    ...(args === undefined ? {} : { args }) };
}
function admitted(value: unknown): ChartCommandV2 {
  const result = validateEnvelope(value);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result.cmd;
}

describe("chart command input never broadens a malformed edit", () => {
  it.each([null, true, 3, "all", []])("refuses supplied non-object arguments: %j", (args) => {
    expect(validateEnvelope(command("ai.clear", args)).ok).toBe(false);
  });
  it("refuses an explicitly undefined selector before JSON could erase it", () => {
    expect(validateEnvelope({ ...command("ai.clear", { ids: undefined }), target }).ok).toBe(false);
  });
  it("refuses an explicitly undefined argument object", () => {
    expect(validateEnvelope({ ...command(), args: undefined }).ok).toBe(false);
  });
  it.each([null, undefined, false, "invalid"])("refuses supplied invalid indicator mode: %j", mode => {
    const value = command("chart.set_indicators", { mode, indicators: [{ name: "sma" }] });
    const checked = validateEnvelope(value);
    expect(checked.ok && translate(checked.cmd, caps, [{ name: "ema" }]).ok).toBe(false);
  });
  it("direct translation does not turn undefined ids into clear-all", () => {
    const result = translate({ ...command("ai.clear", { ids: undefined }), target } as unknown as ChartCommandV2, caps);
    expect(result).toMatchObject({ ok: false, error: "bad_ai_clear_ids" });
  });
  it("retains a genuinely omitted selector as the existing explicit clear-all operation", () => {
    expect(translate(admitted(command()), caps)).toMatchObject({ ok: true, clear: true });
  });
  it("preserves valid selective removal exactly", () => {
    const value = { ...command("ai.clear", { ids: ["ai_first", "ai_second"] }), target };
    const result = translate(admitted(value), caps);
    expect(result).toMatchObject({ ok: true, clearIds: ["ai_first", "ai_second"] });
    expect(result).not.toHaveProperty("clear");
  });
  it("does not call toJSON which could replace a selection with a broad clear", () => {
    const toJSON = vi.fn(() => ({}));
    const value = { ...command("ai.clear", { ids: ["ai_first"], toJSON }), target };
    expect(validateEnvelope(value).ok).toBe(false);
    expect(toJSON).not.toHaveBeenCalled();
  });
  it("does not evaluate accessors while capturing a command", () => {
    const getter = vi.fn(() => ["ai_first"]);
    const args = Object.defineProperty({}, "ids", { get: getter, enumerable: true });
    expect(validateEnvelope({ ...command("ai.clear", args), target }).ok).toBe(false);
    expect(getter).not.toHaveBeenCalled();
  });
  it("rejects a non-enumerable selector rather than losing it in JSON", () => {
    const args = Object.defineProperty({}, "ids", { value: ["ai_first"] });
    expect(validateEnvelope({ ...command("ai.clear", args), target }).ok).toBe(false);
  });
  it("rejects inherited selectors rather than silently clearing everything", () => {
    const args = Object.create({ ids: ["ai_first"] });
    expect(validateEnvelope({ ...command("ai.clear", args), target }).ok).toBe(false);
  });
  it.each([Number.NaN, Number.POSITIVE_INFINITY, BigInt(7)])("rejects lossy scalar payloads", value => {
    expect(validateEnvelope(command("chart.set_indicators", {
      indicators: [{ name: "sma", params: { len: value } }],
    })).ok).toBe(false);
  });
  it("rejects cycles and sparse arrays without throwing", () => {
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    expect(validateEnvelope(command("ai.clear", cyclic)).ok).toBe(false);
    expect(validateEnvelope({ ...command("ai.clear", { ids: new Array(2) }), target }).ok).toBe(false);
  });
  it("bounds payload depth and size", () => {
    let nested: unknown = {};
    for (let i = 0; i < 20; i++) nested = { nested };
    expect(validateEnvelope(command("ai.clear", nested)).ok).toBe(false);
    expect(validateEnvelope({ ...command(), caption: "x".repeat(70_000) }).ok).toBe(false);
  });
  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1])("rejects undeliverable sequence identity %s", seq => {
    expect(validateEnvelope({ ...command(), seq }).ok).toBe(false);
  });
  it.each(["x".repeat(41), "brain\ninput"])("rejects unrepresentable batch identity", batch_id => {
    expect(validateEnvelope({ ...command(), batch_id }).ok).toBe(false);
  });
  it("retains readable receipt identity when only the payload is malformed", () => {
    expect(validateEnvelope(command("ai.clear", null))).toMatchObject({
      ok: false, batch_id: "brain_input", seq: 0, op: "ai.clear",
    });
  });
  it("captures ordinary commands independently of later caller mutation", () => {
    const args = { symbol: "NVDA" };
    const raw = command("chart.set_symbol", args);
    const checked = admitted(raw);
    args.symbol = "AAPL";
    raw.op = "ai.clear";
    expect(checked.op).toBe("chart.set_symbol");
    expect(translate(checked, caps)).toMatchObject({ ok: true, setSymbol: "NVDA" });
  });
  it("allows omitted optional root fields used by local typed callers", () => {
    expect(validateEnvelope({ ...command(), caption: undefined, id: undefined, target: undefined }).ok).toBe(true);
  });
  it("does not alter unrelated studies in a valid patch", () => {
    const current = [{ name: "ema", params: { len: 20 } }];
    const value = { ...command("chart.set_indicators", { mode: "patch", indicators: [{ name: "sma", params: { len: 50 } }] }), target };
    expect(translate(admitted(value), caps, current)).toMatchObject({ ok: true, setIndicators: [
      { name: "ema", params: { len: 20 } }, { name: "sma", params: { len: 50 } },
    ] });
    expect(current).toEqual([{ name: "ema", params: { len: 20 } }]);
  });
});
