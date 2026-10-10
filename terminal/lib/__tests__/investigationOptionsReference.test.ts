import { describe, expect, it } from "vitest";
import { parseOptionsMatrixVersionRef, readOptionsMatrixSourceSession } from "../investigationOptionsReference";

const DIGEST = "a1".repeat(32);
const reference = (bytes = "512", session = "2026-10-08", digest = DIGEST) =>
  `sha256:${digest}:bytes:${bytes}:session:${session}`;

describe("candidate retained-matrix version reference", () => {
  it.each(["0001-01-01", "2000-02-29", "2024-02-29", "2026-10-08", "9999-12-31", "unknown"])(
    "decodes an exact canonical reference with session %s", session => {
      expect(parseOptionsMatrixVersionRef(reference("512", session), DIGEST, 512)).toEqual({
        sha256: DIGEST, byteLength: 512, sourceSession: session === "unknown" ? null : session,
      });
    },
  );
  it.each(["0", "00", "01", "-1", "+1", "1.0", "1e3", " 512", "512 ", "9007199254740992", "9".repeat(200)])(
    "rejects noncanonical or unsafe byte count %s", bytes => {
      expect(parseOptionsMatrixVersionRef(reference(bytes), DIGEST, Number.MAX_SAFE_INTEGER)).toBeNull();
    },
  );
  it.each(["0000-01-01", "1900-02-29", "2026-02-29", "2026-04-31", "2026-13-01", "2026-00-01", "2026-01-00", "2026-1-01", "2026-10-08T00:00:00Z", "UNKNOWN"])(
    "rejects invalid or noncanonical date %s", session => {
      expect(parseOptionsMatrixVersionRef(reference("512", session), DIGEST, 512)).toBeNull();
    },
  );
  it.each(["\n", "\r\n", " ", ":extra", "\u0000", "\u2028"])("rejects trailing data %j", suffix => {
    expect(parseOptionsMatrixVersionRef(reference() + suffix, DIGEST, 512)).toBeNull();
  });
  it("refuses missing values, digest mismatch, case changes and non-string coercion", () => {
    for (const value of [null, undefined, 1, {}, { toString: () => reference() }, " " + reference()]) {
      expect(parseOptionsMatrixVersionRef(value, DIGEST, 512)).toBeNull();
    }
    expect(parseOptionsMatrixVersionRef(reference(), "b".repeat(64), 512)).toBeNull();
    expect(parseOptionsMatrixVersionRef(reference("512", "unknown", DIGEST.toUpperCase()), DIGEST.toUpperCase(), 512)).toBeNull();
    expect(parseOptionsMatrixVersionRef(reference("512", "unknown", DIGEST.slice(1)), DIGEST.slice(1), 512)).toBeNull();
    expect(parseOptionsMatrixVersionRef(reference(), { toString: () => DIGEST }, 512)).toBeNull();
  });
  it("requires an explicit positive safe byte bound and enforces its exact edge", () => {
    for (const limit of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(parseOptionsMatrixVersionRef(reference(), DIGEST, limit)).toBeNull();
    }
    expect(parseOptionsMatrixVersionRef(reference(), DIGEST, 511)).toBeNull();
    expect(parseOptionsMatrixVersionRef(reference(), DIGEST, 512)?.byteLength).toBe(512);
    expect(parseOptionsMatrixVersionRef(reference("1"), DIGEST, 1)?.byteLength).toBe(1);
    expect(parseOptionsMatrixVersionRef(reference(String(Number.MAX_SAFE_INTEGER)), DIGEST, Number.MAX_SAFE_INTEGER)?.byteLength).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("retained-matrix source-session consistency", () => {
  it.each([
    {}, { session: null }, { _build_meta: null }, { _build_meta: {} },
    { session: null, _build_meta: { asof_date: null } },
  ])("preserves unknown clocks for absent/null fields: %j", value => {
    expect(readOptionsMatrixSourceSession(value)).toEqual({ ok: true, sourceSession: null });
  });
  it.each([
    { session: "2026-10-08" },
    { _build_meta: { asof_date: "2026-10-08" } },
    { session: null, _build_meta: { asof_date: "2026-10-08" } },
    { session: "2026-10-08", _build_meta: { asof_date: null } },
    { session: "2026-10-08", _build_meta: { asof_date: "2026-10-08" } },
  ])("reads one consistent source session: %j", value => {
    expect(readOptionsMatrixSourceSession(value)).toEqual({ ok: true, sourceSession: "2026-10-08" });
  });
  it("refuses contradictory clocks without choosing one", () => {
    expect(readOptionsMatrixSourceSession({ session: "2026-10-08", _build_meta: { asof_date: "2026-10-07" } }))
      .toEqual({ ok: false, reason: "source_session_mismatch" });
  });
  it.each(["2026-02-29", "2026-10-08\n", "unknown", "", 0, false, [], undefined])(
    "refuses malformed metadata even if the other date is valid: %j", invalid => {
      for (const value of [
        { session: invalid, _build_meta: { asof_date: "2026-10-08" } },
        { session: "2026-10-08", _build_meta: { asof_date: invalid } },
      ]) expect(readOptionsMatrixSourceSession(value)).toEqual({ ok: false, reason: "invalid_source_session" });
    },
  );
  it.each([null, [], "payload", 1, { session: "2026-10-08", _build_meta: [] },
    { session: "2026-10-08", _build_meta: "2026-10-08" }, { _build_meta: undefined }])(
    "refuses invalid object structure: %j", value => {
      expect(readOptionsMatrixSourceSession(value)).toEqual({ ok: false, reason: "invalid_source_session" });
    },
  );
  it("never invokes inspected accessor fields", () => {
    let calls = 0;
    const accessor = () => { calls++; return "2026-10-08"; };
    for (const value of [
      Object.defineProperty({}, "session", { get: accessor }),
      Object.defineProperty({}, "_build_meta", { get: accessor }),
      { _build_meta: Object.defineProperty({}, "asof_date", { get: accessor }) },
    ]) expect(readOptionsMatrixSourceSession(value)).toEqual({ ok: false, reason: "invalid_source_session" });
    expect(calls).toBe(0);
  });
  it("rejects custom prototypes and catches exceptional object inspection", () => {
    expect(readOptionsMatrixSourceSession(Object.create({ session: "2026-10-08" })))
      .toEqual({ ok: false, reason: "invalid_source_session" });
    const proxy = new Proxy({}, { getPrototypeOf() { throw new Error("untrusted"); } });
    expect(readOptionsMatrixSourceSession(proxy)).toEqual({ ok: false, reason: "invalid_source_session" });
  });
  it("accepts null-prototype JSON objects without changing source bytes or claiming schema/rights", () => {
    const value = Object.assign(Object.create(null), { session: "2026-10-08", schema: "uninspected", _build_meta: Object.assign(Object.create(null), { asof_date: "2026-10-08" }) });
    const before = JSON.stringify(value);
    expect(readOptionsMatrixSourceSession(value)).toEqual({ ok: true, sourceSession: "2026-10-08" });
    expect(JSON.stringify(value)).toBe(before);
  });
});
