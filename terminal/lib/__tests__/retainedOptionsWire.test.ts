import { webcrypto, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeRetainedOptions, exactText } from "../retainedOptionsWire";
function mutate(value: unknown, path: string, next: unknown) {
  const parts = path.split("."); let target = value as Record<string, unknown>;
  for (const key of parts.slice(0, -1)) target = target[key] as Record<string, unknown>;
  const key = parts.at(-1)!;
  if (next === undefined) delete target[key]; else target[key] = next;
}
const context = { root: "SPY", session: "2026-10-19", ownerKey: "account:one" };
const raw = (kind: string) => readFileSync(new URL(`./fixtures/retained-options/${kind}-wire.json`, import.meta.url), "utf8");
const wire = (kind = "matrix") => JSON.parse(raw(kind));
const decode = (value: unknown, ctx = context) => decodeRetainedOptions(JSON.stringify(value), ctx);
beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => vi.unstubAllGlobals());

it("consumes the exact qualified matrix golden without binary-number or string/tag conflation", async () => {
  const view = await decodeRetainedOptions(raw("matrix"), context);
  expect(view).not.toBeNull();
  expect(view!.rows[0].label).toBe("2026-10-30 · 123456789012.12345678 · call");
  expect(view!.rows[0].values.open_interest).toEqual({ decimal: "9007199254740993" });
  expect(view!.rows[0].values.volume).toBeNull();
  expect(view!.rows[0].values.delta_oi).toEqual({ decimal: "-2.5" });
  expect(view!.wire).toBe(raw("matrix"));
  expect(view!.cutoff).toBe("2026-10-20T16:00:00.123456789+00:00");
  expect(exactText(undefined)).toBe("∅"); expect(exactText(null)).toBe("—"); expect(exactText({ decimal: "0" })).toBe("0");
  expect(exactText({ object: { decimal: "12" } })).toBe('{"object":{"decimal":"12"}}');
});
it("preserves original event availability nanoseconds, byte receipt, prefix and exact size", async () => {
  const view = await decodeRetainedOptions(raw("events"), context);
  expect(view).not.toBeNull(); expect(view!.rows).toHaveLength(1);
  expect(view!.rows[0].availableAt).toBe("2026-10-19T14:33:00.123456789+00:00");
  expect(view!.rows[0].values.size).toEqual({ decimal: "9007199254740993" });
  expect(view!.rows[0].values.open_interest).toEqual({ decimal: "0" });
  expect(view!.wire).toBe(raw("events")); expect(view!.rows[0].key).toContain(wire("events").records[0].source_stage_prefix_sha256);
});

describe("rejects unbound or inconsistent transport", () => {
  it.each([
    ["schema", (w: unknown) => mutate(w, "schema", "future")],
    ["extra field", (w: unknown) => mutate(w, "extra", true)],
    ["digest", (w: unknown) => mutate(w, "capture.sha256", "0".repeat(64))],
    ["length", (w: unknown) => mutate(w, "capture.byte_length", 999)],
    ["boolean length", (w: unknown) => mutate(w, "capture.byte_length", true)],
    ["base64", (w: unknown) => mutate(w, "capture.body_base64", "invalid\n")],
    ["read cutoff", (w: unknown) => mutate(w, "capture.read_at", "2027-01-01T00:00:00Z")],
    ["normalized cutoff", (w: unknown) => mutate(w, "cutoff_utc", "2026-10-20T16:00:00.123457Z")],
    ["calendar", (w: unknown) => mutate(w, "decision_at", "2026-02-30T16:00:00Z")],
    ["reference", (w: unknown) => mutate(w, "snapshot.version_ref", "mutable-head")],
    ["key", (w: unknown) => mutate(w, "snapshot.key", "current.json")],
    ["row precision", (w: unknown) => mutate(w, "rows.0.strike", "123456789012.12346")],
    ["string as decimal", (w: unknown) => mutate(w, "rows.0.metrics.open_interest", "9007199254740993")],
    ["source mutation", (w: unknown) => mutate(w, "document.object.root", "QQQ")],
    ["invented availability", (w: unknown) => mutate(w, "state.first_available_at", wire().read_observed_at)],
    ["row index", (w: unknown) => mutate(w, "rows.0.cell_index", 1)],
    ["null as omitted", (w: unknown) => mutate(w, "rows.0.metrics.volume", undefined)],
    ["selector", (w: unknown) => mutate(w, "selector.side", "put")],
  ] as [string, (w: unknown) => void][])("%s", async (_name, change) => { const w = wire(); change(w); expect(await decode(w)).toBeNull(); });
  it.each(["root", "session", "ownerKey"])("refuses missing or wrong expected %s", async field => {
    expect(await decode(wire(), { ...context, [field]: field === "root" ? "QQQ" : field === "session" ? "2026-10-20" : "" })).toBeNull();
  });
  it.each(["", "{}", '{"schema":"a","schema":"b"}', "[null]", '{"x":NaN}', '{"x":1e300}', '\uFEFF{}'])("refuses malformed %s", async value => { expect(await decodeRetainedOptions(value, context)).toBeNull(); });
  it("refuses duplicate wire fields even if their values agree", async () => {
    const w = raw("matrix").replace('"kind":"matrix"', '"kind":"matrix","kind":"matrix"');
    expect(w).not.toBe(raw("matrix")); expect(await decodeRetainedOptions(w, context)).toBeNull();
  });
});

describe("event provenance", () => {
  it.each([
    ["receipt", (w: unknown) => mutate(w, "records.0.source_availability_receipt_base64", wire("events").capture.body_base64)],
    ["prefix", (w: unknown) => mutate(w, "records.0.source_stage_prefix_sha256", "0".repeat(64))],
    ["ordinal", (w: unknown) => mutate(w, "records.0.source_stage_prefix_records", 1)],
    ["original nanoseconds", (w: unknown) => mutate(w, "records.0.source_available_at", "2026-10-19T14:33:00.123456788+00:00")],
    ["normalized availability", (w: unknown) => mutate(w, "records.0.available_at", "2026-10-19T14:33:00.123457Z")],
    ["source key", (w: unknown) => mutate(w, "records.0.source_stage_key", "mutable.json")],
    ["event", (w: unknown) => mutate(w, "records.0.event.object.size.decimal", "9007199254740992")],
    ["missing record", (w: unknown) => mutate(w, "records", [])],
    ["unknown id", (w: unknown) => mutate(w, "selector.event_ids", ["unknown"])],
    ["duplicate id", (w: unknown) => mutate(w, "selector.event_ids", ["one", "one"])],
    ["packages", (w: unknown) => mutate(w, "state.package_support", "inferred")],
  ] as [string, (w: unknown) => void][])("refuses changed %s", async (_name, change) => { const w = wire("events"); change(w); expect(await decode(w)).toBeNull(); });
});

// Rebinding a synthetic capture is ONLY a negative/positive unit control, not acquisition.
function rebind(w: ReturnType<typeof wire>, body: string) {
  const bytes = Buffer.from(body); w.capture.body_base64 = bytes.toString("base64"); w.capture.byte_length = bytes.length; w.capture.sha256 = createHash("sha256").update(bytes).digest("hex");
  if (w.snapshot) { w.snapshot.sha256 = w.capture.sha256; w.snapshot.byte_length = bytes.length; w.snapshot.version_ref = `sha256:${w.capture.sha256}:bytes:${bytes.length}:session:${w.snapshot.session}`; w.snapshot.key = `options_structure/matrix/history/SPY/${w.capture.sha256}.json`; }
}
it("retains known zero with omitted volume and full tagged source metadata", async () => {
  const w = wire(); let body = Buffer.from(w.capture.body_base64, "base64").toString();
  body = body.replace('9007199254740993,', '0,').replace('"call_vol":null,', '');
  rebind(w, body); w.document.object.cells.array[0].object.call_oi = { decimal: "0" }; delete w.document.object.cells.array[0].object.call_vol;
  w.rows[0].metrics.open_interest = { decimal: "0" }; delete w.rows[0].metrics.volume;
  const view = await decode(w); expect(view).not.toBeNull(); expect(view!.rows[0].values.open_interest).toEqual({ decimal: "0" }); expect(view!.rows[0].values).not.toHaveProperty("volume");
});
it("accepts an explicit empty expiry without inventing observations", async () => {
  const w = wire(); w.selector.expiry = "2026-11-20"; w.rows = []; w.state.row_status = "no_supplied_observations";
  expect((await decode(w))!.rows).toEqual([]);
});
it("refuses duplicate keys in captured source even with freshly matching digest/reference", async () => {
  const w = wire(); const body = Buffer.from(w.capture.body_base64, "base64").toString().replace('"root":"SPY"', '"root":"SPY","root":"SPY"');
  rebind(w, body); expect(await decode(w)).toBeNull();
});
it("refuses stage/session mismatch even when both selector and expected context agree", async () => {
  const w = wire("events"); w.selector.session = "2026-10-20"; w.source_stage_key = "live_flow/events/2026-10-20.jsonl";
  w.records[0].source_stage_key = w.source_stage_key;
  expect(await decode(w, { ...context, session: "2026-10-20" })).toBeNull();
});
it("uses conservative read rounding without losing the original nanosecond clock", async () => {
  const w = wire(); w.capture.read_at = "2026-10-20T14:59:59.999999999+00:00";
  w.read_observed_at = "2026-10-20T15:00:00+00:00";
  expect((await decode(w))!.readAt).toBe(w.capture.read_at);
  w.read_observed_at = "2026-10-20T14:59:59.999999+00:00"; expect(await decode(w)).toBeNull();
});
it("preserves numeric-looking strings and object-tag collisions as source data", async () => {
  const w = wire(); const body = Buffer.from(w.capture.body_base64, "base64").toString().replace('"cells":', '"numeric_string":"9007199254740993","tag_collision":{"decimal":"7"},"cells":');
  rebind(w, body); w.document.object.numeric_string = "9007199254740993"; w.document.object.tag_collision = { object: { decimal: "7" } };
  expect(await decode(w)).not.toBeNull();
  w.document.object.tag_collision = { decimal: "7" }; expect(await decode(w)).toBeNull();
});
it("refuses excess source nesting and a huge nonzero exponent before projection", async () => {
  const w = wire(); const body = Buffer.from(w.capture.body_base64, "base64").toString().replace('9007199254740993,', '1e999999,'); rebind(w, body);
  expect(await decode(w)).toBeNull();
  const deep = wire(); const deepBody = Buffer.from(deep.capture.body_base64, "base64").toString().replace('"cells":', '"deep":' + '['.repeat(25) + 'null' + ']'.repeat(25) + ',"cells":'); rebind(deep, deepBody); expect(await decode(deep)).toBeNull();
});
it("keeps an existing event prefix stable after a later captured append", async () => {
  const w = wire("events"), original = Buffer.from(w.capture.body_base64, "base64").toString();
  const priorPrefix = w.records[0].source_stage_prefix_sha256;
  const appended = original + original.replaceAll('"one"', '"two"'); rebind(w, appended); w.selector.event_ids = ["one"];
  const view = await decode(w); expect(view).not.toBeNull(); expect(view!.fingerprint).not.toBe(priorPrefix);
  expect(view!.rows[0].key).toContain(priorPrefix); expect(view!.rows).toHaveLength(1);
});
it.each([
  ["later availability", "2026-10-19T14:33:00.123456001Z", false],
  ["earlier availability", "2026-10-19T14:33:00.123456900+00:00", true],
] as const)("compares original availability to original read within one microsecond: %s", async (_case, readAt, accepted) => {
  const w = wire("events");
  // Original golden availability is .123456789: both read controls ceil to
  // .123457, so normalized clocks alone cannot distinguish their raw order.
  w.capture.read_at = readAt;
  w.read_observed_at = "2026-10-19T14:33:00.123457+00:00";
  const view = await decode(w);
  expect(view !== null).toBe(accepted);
  if (accepted) {
    expect(view!.readAt).toBe(readAt);
    expect(view!.rows[0].availableAt).toBe("2026-10-19T14:33:00.123456789+00:00");
    expect(view!.wire).toBe(JSON.stringify(w));
  }
});
