import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { acquiredMatrixBytes, MATRIX_ACQUIRED_BYTES_MAX } from "../matrixAcquisition";
import { tryFetchUpstreamResult } from "../flowSource";
import { FLOW_BACKEND, R2_BASE } from "../upstreams";
import { scenarioNativePacket } from "./fixtures/scenarioNativePacket";

const sha = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const encode = (value: unknown): Buffer => Buffer.from(JSON.stringify(value), "utf8");

// A minimal qualified matrix doc. The top-level `asof` is the producer's BUILD
// clock; the SESSION identity may name lives only in _build_meta.asof_date.
const DOC = {
  schema: "options_structure.matrix/v1",
  asof: "2026-11-04T03:05:00Z",
  root: "SPY",
  spot: 6800.25,
  expiries: ["2026-11-20"],
  strikes: [6800],
  cells: [{ strike: 6800, expiry: "2026-11-20", gex: 1_250_000 }],
  _build_meta: { asof_date: "2026-11-03" },
};
const SESSION = "2026-11-03";

/** A payload carrying the exact closed marker for DOC's original bytes. */
function acquired(patch: Record<string, unknown> = {}, markerPatch: Record<string, unknown> = {}) {
  const bytes = encode(DOC);
  const marker = {
    schema: "options_structure.acquired_bytes/v1", kind: "matrix", root: "SPY",
    session: SESSION, sha256: sha(bytes), byte_length: bytes.length, ...markerPatch,
  };
  return { ...DOC, ...patch, _matrix_source_identity: marker };
}

const r2 = (body: Buffer, status = 200) => async (url: RequestInfo | URL): Promise<Response> =>
  String(url).startsWith(R2_BASE)
    ? status === 200 ? new Response(new Uint8Array(body)) : new Response("missing", { status })
    : new Response("unavailable", { status: 503 });

afterEach(() => vi.unstubAllGlobals());

it("names ORIGINAL producer bytes for a direct R2 matrix read", async () => {
  const bytes = encode(DOC);
  vi.stubGlobal("fetch", vi.fn(r2(bytes)));
  const outcome = await tryFetchUpstreamResult("matrix:SPY");
  expect(outcome.status).toBe("data");
  if (outcome.status !== "data") throw new Error("missing matrix payload");
  expect(outcome.data._matrix_source_identity).toEqual({
    schema: "options_structure.acquired_bytes/v1", kind: "matrix", root: "SPY",
    session: SESSION, sha256: sha(bytes), byte_length: bytes.length,
  });
  expect(acquiredMatrixBytes(outcome.data, "SPY", SESSION)).toEqual({ sha256: sha(bytes), bytes: bytes.length });
  // identity capture leaves the display payload itself untouched
  expect(outcome.data.cells).toEqual(DOC.cells);
});

it("hashes the ORIGINAL bytes, so a whitespace variant digests differently than any reserialization", async () => {
  const original = Buffer.from(JSON.stringify(DOC, null, 2) + "\n", "utf8");
  const reserialized = encode(DOC);
  expect(sha(original)).not.toBe(sha(reserialized));
  vi.stubGlobal("fetch", vi.fn(r2(original)));
  const outcome = await tryFetchUpstreamResult("matrix:SPY");
  expect(outcome.status).toBe("data");
  if (outcome.status !== "data") throw new Error("missing matrix payload");
  expect(acquiredMatrixBytes(outcome.data, "SPY", SESSION)).toEqual({ sha256: sha(original), bytes: original.length });
  expect((outcome.data._matrix_source_identity as { sha256: string }).sha256).not.toBe(sha(reserialized));
});

it("replaces a supplied marker with the identity of the bytes actually read", async () => {
  const spoofed = { ...DOC, _matrix_source_identity: {
    schema: "options_structure.acquired_bytes/v1", kind: "matrix", root: "SPY", session: SESSION,
    sha256: "f".repeat(64), byte_length: 7 } };
  const bytes = encode(spoofed);
  vi.stubGlobal("fetch", vi.fn(r2(bytes)));
  const outcome = await tryFetchUpstreamResult("matrix:SPY");
  expect(outcome.status).toBe("data");
  if (outcome.status !== "data") throw new Error("missing matrix payload");
  expect(outcome.data._matrix_source_identity).toEqual({
    schema: "options_structure.acquired_bytes/v1", kind: "matrix", root: "SPY", session: SESSION,
    sha256: sha(bytes), byte_length: bytes.length,
  });
});

it("mints no identity when the carried root is not the requested root", async () => {
  const bytes = encode({ ...DOC, root: "QQQ" });
  vi.stubGlobal("fetch", vi.fn(r2(bytes)));
  const outcome = await tryFetchUpstreamResult("matrix:SPY");
  expect(outcome.status).toBe("data");
  if (outcome.status !== "data") throw new Error("missing matrix payload");
  expect(outcome.data._matrix_source_identity).toBeUndefined();
});

it("keeps backend matrix answers UNQUALIFIED: strips a supplied marker, hashes nothing, asks nothing extra", async () => {
  const payload = { ...DOC, _matrix_source_identity: {
    schema: "options_structure.acquired_bytes/v1", kind: "matrix", root: "SPY", session: SESSION,
    sha256: sha(Buffer.from("not the server response")), byte_length: 21 } };
  const fetchMock = vi.fn(async (url: RequestInfo | URL): Promise<Response> =>
    String(url).startsWith(R2_BASE)
      ? new Response("missing", { status: 404 })
      : Response.json(payload));
  vi.stubGlobal("fetch", fetchMock);
  const outcome = await tryFetchUpstreamResult("matrix:SPY");
  expect(outcome.status).toBe("data");
  if (outcome.status !== "data") throw new Error("missing matrix payload");
  // ordinary display read is unchanged; only the unqualified marker is gone
  expect(outcome.data.cells).toEqual(DOC.cells);
  expect(outcome.data._matrix_source_identity).toBeUndefined();
  expect(acquiredMatrixBytes(outcome.data, "SPY", SESSION)).toBeNull();
  // the backend answered first and was enough: no identity side-request exists
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`${FLOW_BACKEND}/api/hub/matrix/SPY`);
});

it("keeps a larger valid display payload with no identity at all", async () => {
  const value = { ...DOC, padding: "x".repeat(MATRIX_ACQUIRED_BYTES_MAX), _matrix_source_identity: { sha256: "spoof" } };
  const fetchMock = vi.fn(async (url: RequestInfo | URL): Promise<Response> =>
    String(url).startsWith(R2_BASE) ? Response.json(value) : new Response("missing", { status: 404 }));
  vi.stubGlobal("fetch", fetchMock);
  const outcome = await tryFetchUpstreamResult("matrix:SPY");
  expect(outcome.status).toBe("data");
  if (outcome.status !== "data") throw new Error("missing matrix payload");
  expect(outcome.data.cells).toEqual(DOC.cells);
  expect(outcome.data._matrix_source_identity).toBeUndefined();
});

it("leaves absence and outage classification exactly as before", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("missing", { status: 404 })));
  expect((await tryFetchUpstreamResult("matrix:SPY")).status).toBe("absent");
  vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 503 })));
  expect((await tryFetchUpstreamResult("matrix:SPY")).status).toBe("unavailable");
});

it("refuses identity for wrong root/schema/session, impossible dates, stale, oversize, bad length/hash/key shape", () => {
  const good = acquired();
  const docBytes = encode(DOC);
  const expectNull = (payload: unknown, root = "SPY", session = SESSION) =>
    expect(acquiredMatrixBytes(payload, root, session)).toBeNull();

  // the positive control: the exact closed marker for the original bytes
  expect(acquiredMatrixBytes(good, "SPY", SESSION)).toEqual({ sha256: sha(docBytes), bytes: docBytes.length });

  // the question and the payload must agree on root, schema and session
  expectNull({ ...DOC });                                   // no marker at all = plain display read
  expectNull(good, "QQQ");
  expectNull(acquired({ root: "QQQ" }));
  expectNull(acquired({}, { root: "QQQ" }));
  expectNull(acquired({ schema: "options_structure.matrix/v2" }));
  expect(acquiredMatrixBytes(good, "SPY", "2026-11-04")).toBeNull();
  expectNull(acquired({}, { session: "2026-11-02" }));

  // the session must be the doc's own Gregorian _build_meta.asof_date
  expectNull({ ...DOC, asof: SESSION });                    // build clock cannot stand in
  expectNull(acquired({ _build_meta: null }));
  expectNull(acquired({ _build_meta: { asof_date: "2026-02-30" } }, { session: "2026-02-30" }));
  expectNull(acquired({ _build_meta: { asof_date: "2026-13-01" } }, { session: "2026-13-01" }));
  expect(acquiredMatrixBytes(
    acquired({ _build_meta: { asof_date: "2024-02-29" } }, { session: "2024-02-29" }),
    "SPY", "2024-02-29")).toEqual({ sha256: sha(docBytes), bytes: docBytes.length });

  // a producer-marked-stale doc names no bytes
  expectNull(acquired({ stale: true }));

  // closed six-field marker shape
  const extra = acquired();
  (extra._matrix_source_identity as Record<string, unknown>).extra = 1;
  expectNull(extra);
  const missing = acquired();
  delete (missing._matrix_source_identity as Record<string, unknown>).session;
  expectNull(missing);
  expectNull({ ...DOC, _matrix_source_identity: "nope" });

  // byte identity sanity: safe integer length within the 16 MiB contract, lowerhex digest
  expectNull(acquired({}, { byte_length: 0 }));
  expectNull(acquired({}, { byte_length: -1 }));
  expectNull(acquired({}, { byte_length: 1.5 }));
  expectNull(acquired({}, { byte_length: "7" }));
  expectNull(acquired({}, { byte_length: MATRIX_ACQUIRED_BYTES_MAX + 1 }));
  expectNull(acquired({}, { sha256: sha(docBytes).toUpperCase() }));
  expectNull(acquired({}, { sha256: sha(docBytes).slice(1) }));
  expectNull(acquired({}, { sha256: `g${"f".repeat(63)}` }));
  expectNull(acquired({}, { schema: "options_hub.acquired_bytes/v1" }));
  expectNull(acquired({}, { kind: "gex" }));
});

it("leaves the existing gex/moves hub acquisition untouched", async () => {
  const packet = scenarioNativePacket();
  const original = Buffer.from(packet.gex_base64, "base64");
  vi.stubGlobal("fetch", vi.fn(r2(original)));
  const gex = await tryFetchUpstreamResult("gex:SPY");
  expect(gex.status).toBe("data");
  if (gex.status !== "data") throw new Error("missing gex payload");
  const marker = gex.data._scenario_source_identity as { schema: string; kind: string; sha256: string; byte_length: number };
  expect(marker.schema).toBe("options_hub.acquired_bytes/v1");
  expect(marker.kind).toBe("gex");
  expect(marker.sha256).toBe(sha(original));
  expect(marker.byte_length).toBe(original.length);
  // the matrix marker family never leaks onto a hub payload
  expect(gex.data._matrix_source_identity).toBeUndefined();

  const moves = { schema: "options_hub.moves/v1", root: "SPY", asof: "2026-11-03T21:00:00Z",
    spot_ref: 6800, expected_move: { pct: 0.92, band_mult: 1.96, horizon_days: 1 } };
  const movesBytes = encode(moves);
  vi.stubGlobal("fetch", vi.fn(r2(movesBytes)));
  const movesOutcome = await tryFetchUpstreamResult("moves:SPY");
  expect(movesOutcome.status).toBe("data");
  if (movesOutcome.status !== "data") throw new Error("missing moves payload");
  const movesMarker = movesOutcome.data._scenario_source_identity as { schema: string; kind: string; sha256: string; byte_length: number };
  expect(movesMarker.schema).toBe("options_hub.acquired_bytes/v1");
  expect(movesMarker.kind).toBe("moves");
  expect(movesMarker.sha256).toBe(sha(movesBytes));
  expect(movesMarker.byte_length).toBe(movesBytes.length);
  expect(movesOutcome.data._matrix_source_identity).toBeUndefined();
});


it.each(["true", "false", 1, 0, null, "", {}])("withholds direct producer identity for malformed stale=%j", async (stale) => {
  vi.stubGlobal("fetch", vi.fn(r2(encode({ ...DOC, stale }))));
  const outcome = await tryFetchUpstreamResult("matrix:SPY");
  expect(outcome.status).toBe("data");
  if (outcome.status !== "data") throw new Error("missing display payload");
  expect(outcome.data.cells).toEqual(DOC.cells);
  expect(outcome.data._matrix_source_identity).toBeUndefined();
});

it.each(["true", "false", 1, 0, null, "", {}])("refuses carried identity for malformed stale=%j", (stale) => {
  expect(acquiredMatrixBytes(acquired({ stale }), "SPY", SESSION)).toBeNull();
});

it("does not acquire year-zero producer identity while preserving its display payload", async () => {
  const value = { ...DOC, _build_meta: { asof_date: "0000-01-01" } };
  vi.stubGlobal("fetch", vi.fn(r2(encode(value))));
  const outcome = await tryFetchUpstreamResult("matrix:SPY");
  expect(outcome.status).toBe("data");
  if (outcome.status !== "data") throw new Error("missing display payload");
  expect(outcome.data._matrix_source_identity).toBeUndefined();
});

it("rejects a carried year-zero marker and retains explicit false stale as a positive control", () => {
  expect(acquiredMatrixBytes(acquired({ _build_meta: { asof_date: "0000-01-01" } }, { session: "0000-01-01" }), "SPY", "0000-01-01")).toBeNull();
  expect(acquiredMatrixBytes(acquired({ stale: false }), "SPY", SESSION)).not.toBeNull();
});
