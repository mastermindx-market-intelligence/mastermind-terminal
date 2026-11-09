import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import {
  decodePrivateEvidence, projectPrivateEvidence, decodePrivateEvidenceProjection,
  PRIVATE_EVIDENCE_PROJECTION_SCHEMA, type EvidenceKind, type PrivateEvidenceProjectionReceipt,
} from "../tp1PrivateEvidence";

const fixtures = new URL("./fixtures/", import.meta.url);
const golden = [
  ["Minute", "minute", 2362, "71bed6bb49ffce62735cc50c9f16a181d69b80393e6737f7899b911985f7f2c8"],
  ["Research", "research", 2219, "47fb5af5e6e7fb8b30c594725363d8d84d787e1879a8916362aa0b81016e9ad2"],
  ["Unknown", "minute", 2210, "02e0bab2885af1a46e399aa1b9474486c1a650a61c3927a2726d702baa6406bf"],
  ["HighPrecision", "research", 2390, "c2a0d860787e1967815635a8ceda2ecd47f9c3dad6bd2a7df9f4ba9fa0552372"],
  ["Engineering", "minute", 2362, "9879018af385139f145067551aff97fbce5b242327826cd42bf01a8d26f80798"],
] as const;
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
type ObjectValue = Record<string, unknown>;
type Sample = {
  projection: PrivateEvidenceProjectionReceipt;
  original: { sha256: string; length: number };
};
function original(name = "Minute") {
  return readFileSync(new URL("tp1Private" + name + ".synthetic.v0.json", fixtures));
}
function sample(bytes: Uint8Array = original(), kind: EvidenceKind = "minute"): Sample {
  const trust = { sha256: digest(bytes), length: bytes.byteLength };
  return { original: trust, projection: projectPrivateEvidence({
    kind, bytes, expectedSha256: trust.sha256, expectedLength: trust.length,
  }) };
}
function read(value: Sample) {
  return decodePrivateEvidenceProjection({
    kind: value.projection.kind, bytes: value.projection.bytesPrivateOnly,
    expectedProjectionSha256: value.projection.sha256,
    expectedProjectionLength: value.projection.byteLength,
    expectedOriginalSha256: value.original.sha256,
    expectedOriginalLength: value.original.length,
  });
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    const obj = value as ObjectValue;
    return "{" + Object.keys(obj).sort().map(k => JSON.stringify(k) + ":" + canonical(obj[k])).join(",") + "}";
  }
  return JSON.stringify(value);
}
function document(value: Sample): ObjectValue {
  return JSON.parse(Buffer.from(value.projection.bytesPrivateOnly).toString("utf8"));
}
function rewrap(value: Sample, bytes: Uint8Array): Sample {
  return { ...value, projection: { ...value.projection, bytesPrivateOnly: bytes,
    byteLength: bytes.byteLength, sha256: digest(bytes) } };
}
function change(value: Sample, edit: (doc: ObjectValue) => void): Sample {
  const doc = document(value);
  edit(doc);
  return rewrap(value, Buffer.from(canonical(doc) + "\n"));
}
const observation = (doc: ObjectValue) => doc.observation as ObjectValue;

describe("Terminal private /v1 string-clock projection of immutable Macro /v0 bytes", () => {
  it.each(golden)("round-trips actual Python %s bytes without changing their identity", (name, kind, length, sha256) => {
    const bytes = original(name);
    expect(bytes.byteLength).toBe(length);
    expect(digest(bytes)).toBe(sha256);
    const value = sample(bytes, kind);
    const restored = read(value);
    const decoded = decodePrivateEvidence({ kind, bytes, expectedLength: length, expectedSha256: sha256 });
    expect(restored).toMatchObject(decoded);
    expect(restored.originalByteSha256).toBe(sha256);
    expect(restored.originalByteLength).toBe(length);
    expect(restored.projectionSchema).toBe(PRIVATE_EVIDENCE_PROJECTION_SCHEMA);
    expect(restored.projectionByteSha256).toBe(value.projection.sha256);
    expect(restored.temporalRole).toBe("ORIGINAL_FROZEN_OBSERVATION");
    expect(restored.sourceAuthenticated).toBe(false);
    expect(restored.productionApproved).toBe(false);
    expect(restored.publicDeliveryAllowed).toBe(false);
    const wire = observation(document(value));
    for (const field of Object.keys(restored.clocksNs)) {
      expect(typeof wire[field]).toBe("string");
      expect(BigInt(wire[field] as string)).toBe(restored.clocksNs[field]);
    }
    expect(sample(bytes, kind).projection.sha256).toBe(value.projection.sha256);
  });

  it("preserves one-nanosecond changes through ordinary JSON transport", () => {
    const a = sample();
    const raw = original().toString("utf8");
    const b = sample(Buffer.from(raw.replace('"decision_ns":1791417662000000000',
      '"decision_ns":1791417662000000001')));
    expect(read(b).clocksNs.decision_ns - read(a).clocksNs.decision_ns).toBe(BigInt("1"));
    expect(a.projection.sha256).not.toBe(b.projection.sha256);
    expect(a.original.sha256).not.toBe(b.original.sha256);
    const browserParsed = JSON.parse(JSON.stringify(document(b)));
    expect(browserParsed.observation.decision_ns).toBe("1791417662000000001");
  });

  it("preserves the native signed-64 maximum and refuses its successor", () => {
    const raw = original().toString("utf8");
    const at = raw.replace('"decision_ns":1791417662000000000', '"decision_ns":9223372036854775807');
    expect(read(sample(Buffer.from(at))).clocksNs.decision_ns).toBe(BigInt("9223372036854775807"));
    const over = at.replace('"decision_ns":9223372036854775807', '"decision_ns":9223372036854775808');
    expect(() => sample(Buffer.from(over))).toThrowError(/overflow/);
  });

  it.each([0, 1, 1791417662000000000, null, true, "01", "+1", "-1", "1.0", "1e9", " 1",
    "9223372036854775808"])("rejects unsafe, numeric or noncanonical wire clock %s", value => {
    const altered = change(sample(), doc => { observation(doc).max_quote_age_ns = value; });
    expect(() => read(altered)).toThrowError(/unsafe_ns|overflow/);
  });

  it("does not let a rehashed envelope replace independent original-clock evidence", () => {
    const altered = change(sample(), doc => { observation(doc).decision_ns = "1791417662000000001"; });
    expect(() => read(altered)).toThrowError(/source_bytes:hash_mismatch/);
  });
  it("does not reformat an equivalent monetary value under an old byte receipt", () => {
    const altered = change(sample(original("Engineering")), doc => {
      const money = observation(doc).notional_usd as ObjectValue;
      money.gross_sampled_notional_usd = "0.0000001";
    });
    expect(() => read(altered)).toThrowError(/source_bytes:(hash_mismatch|invalid_length)/);
  });

  it.each([
    ["schema", "terminal.tp1.private_evidence_projection/v2"],
    ["kind", "research"],
    ["timestamp_encoding", "JSON_NUMBER_NS"],
    ["temporal_role", "LATER_MATURED_OUTCOME"],
  ])("rejects an altered %s contract", (field, value) => {
    expect(() => read(change(sample(), doc => { doc[field] = value; })))
      .toThrowError(/schema_or_temporal_role/);
  });
  it.each(["source_authenticated", "production_approved", "public_delivery_allowed", "rank_trade_alert_authority"])(
    "refuses an envelope upgrading %s", field => {
      expect(() => read(change(sample(), doc => { doc[field] = true; }))).toThrowError(/false_authority/);
    });
  it.each(["forward_label_available_ns", "label_matured_ns", "schema"])(
    "refuses a late or extra observation field %s", field => {
      expect(() => read(change(sample(), doc => { observation(doc)[field] = "1791417700000000000"; })))
        .toThrowError(/unapproved_fields/);
    });

  it("reuses v0 semantic validation even if both forged digests are internally consistent", () => {
    const value = sample();
    const forgedOriginal = Buffer.from(original().toString("utf8").replace('"public_delivery_allowed":false',
      '"public_delivery_allowed":true'));
    const altered = change(value, doc => {
      observation(doc).public_delivery_allowed = true;
      const receipt = doc.original_artifact as ObjectValue;
      receipt.sha256 = digest(forgedOriginal);
      receipt.byte_length = forgedOriginal.byteLength;
    });
    altered.original = { sha256: digest(forgedOriginal), length: forgedOriginal.byteLength };
    expect(() => read(altered)).toThrowError(/distribution_or_authority/);
    expect(() => sample(forgedOriginal)).toThrowError(/distribution_or_authority/);
  });

  it("requires independently supplied original digest and length", () => {
    const value = sample();
    expect(() => read({ ...value, original: { ...value.original, sha256: undefined as unknown as string } }))
      .toThrowError(/expectedOriginalSha256:digest/);
    expect(() => read({ ...value, original: { ...value.original, length: undefined as unknown as number } }))
      .toThrowError(/original_artifact:invalid_length/);
    expect(() => read({ ...value, original: { ...value.original, sha256: "f".repeat(64) } }))
      .toThrowError(/receipt_mismatch/);
    expect(() => read({ ...value, original: { ...value.original, length: value.original.length + 1 } }))
      .toThrowError(/receipt_mismatch/);
  });
  it("checks original kind/schema, exact receipt fields and envelope digest", () => {
    const value = sample();
    expect(() => read(change(value, doc => {
      (doc.original_artifact as ObjectValue).schema = "equity.tick_plane.private_minute_artifact/v1";
    }))).toThrowError(/receipt_mismatch/);
    expect(() => read(change(value, doc => {
      (doc.original_artifact as ObjectValue).authenticated = true;
    }))).toThrowError(/unapproved_fields/);
    expect(() => read({ ...value, projection: { ...value.projection, sha256: "f".repeat(64) } }))
      .toThrowError(/projection_bytes:hash_mismatch/);
  });
  it("bounds source/envelope lengths before processing and canonical depth before recursion", () => {
    const value = sample();
    expect(() => read({ ...value, projection: { ...value.projection, byteLength: -1 } }))
      .toThrowError(/invalid_length/);
    expect(() => read(rewrap(value, new Uint8Array(35 * 1024)))).toThrowError(/invalid_length/);
    expect(() => sample(new Uint8Array(33 * 1024))).toThrowError(/invalid_length/);
    const altered = change(value, doc => {
      let deep: ObjectValue = {};
      doc.extra = deep;
      for (let i = 0; i < 20; i++) { const child = {}; deep.child = child; deep = child; }
    });
    expect(() => read(altered)).toThrowError(/max_depth/);
  });
  it("rejects duplicate, unsorted, malformed and non-ASCII JSON", () => {
    const value = sample();
    const raw = Buffer.from(value.projection.bytesPrivateOnly).toString("utf8");
    for (const text of ['{"kind":"minute",' + raw.slice(1),
      JSON.stringify(document(value), null, 2) + "\n", '{"bad":}\n',
      raw.replace('"minute"', '"minüte"')]) {
      expect(() => read(rewrap(value, Buffer.from(text)))).toThrowError(/noncanonical|malformed|ascii/);
    }
  });
  it("uses stable snapshots instead of caller-owned mutable buffers", () => {
    const source = original();
    const value = sample(source);
    const originalHash = value.original.sha256;
    source.fill(0);
    const restored = read(value);
    expect(restored.originalByteSha256).toBe(originalHash);
    value.projection.bytesPrivateOnly.fill(0);
    expect(restored.clocksNs.decision_ns).toBe(BigInt("1791417662000000000"));
    expect(() => read(value)).toThrowError(/hash_mismatch/);
  });
});
