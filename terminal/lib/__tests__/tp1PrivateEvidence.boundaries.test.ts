import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { decodePrivateEvidence, pairPrivateEvidence, type EvidenceKind } from "../tp1PrivateEvidence";

const fixtures = new URL("./fixtures/", import.meta.url);
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function decode(kind: EvidenceKind, bytes: Uint8Array) {
  return decodePrivateEvidence({ kind, bytes, expectedLength: bytes.byteLength,
    expectedSha256: digest(bytes) });
}
function fixture(name: string) {
  return readFileSync(new URL("tp1Private" + name + ".synthetic.v0.json", fixtures));
}

describe("original source policy and Python decimal boundaries", () => {
  it("keeps the accepted exact-age Python pair", () => {
    const pair = pairPrivateEvidence(decode("minute", fixture("Minute")),
      decode("research", fixture("Research")));
    expect(pair.pairingState).toBe("PRIVATE_COMPATIBLE_ORIGINAL_SOURCE_UNPROVEN");
  });
  it.each(["24999999999", "25000000001"])(
    "refuses a one-nanosecond original quote-age policy mismatch: %s", age => {
      const raw = fixture("Research").toString("utf8");
      const changed = raw.replace('"source_quote_age_limit_ns":25000000000',
        '"source_quote_age_limit_ns":' + age);
      expect(changed).not.toBe(raw);
      expect(() => pairPrivateEvidence(decode("minute", fixture("Minute")),
        decode("research", Buffer.from(changed)))).toThrowError(/age_policy/);
    });

  it("accepts exact 100E-9 emitted and verified by the actual Python projector", () => {
    const bytes = fixture("Engineering");
    expect(bytes.byteLength).toBe(2362);
    expect(digest(bytes)).toBe("9879018af385139f145067551aff97fbce5b242327826cd42bf01a8d26f80798");
    expect(bytes.toString("utf8")).toContain('"gross_sampled_notional_usd":"100E-9"');
    const minute = decode("minute", bytes);
    // Exact fixed expansion of emitted 100E-9 retains its encoded decimal scale.
    expect(minute.notionalUsd.gross_sampled_notional_usd).toBe("0.000000100");
    expect(minute.volumeShares?.source_all_printed_shares).toBe("0.000000100");
    expect(minute.originalByteSha256).toBe(digest(bytes));
    expect(minute.sourceAuthenticated).toBe(false);
  });

  // Explicit boundary examples, not a randomized/property-fuzz job. These
  // substitutions leave original integer-clock lexemes untouched.
  it.each([
    ["1E-126", "0." + "0".repeat(125) + "1"],
    ["10E+126", "1" + "0".repeat(127)],
    ["1.2300E-9", "0.0000000012300"],
    ["0.00E+129", "0"],
  ])("accepts bounded engineering text %s with exact fixed arithmetic", (value, fixed) => {
    const bytes = Buffer.from(fixture("Engineering").toString("utf8").replaceAll('"100E-9"', JSON.stringify(value)));
    const minute = decode("minute", bytes);
    expect(minute.notionalUsd.gross_sampled_notional_usd).toBe(fixed);
    expect(minute.volumeShares?.source_all_printed_shares).toBe(fixed);
  });
  it.each([
    "100E-129", "100E+126", "1E+999999999", "1E-999999999",
    "1E-7", "1e-9", "+1E-9", "-1E-9", "01E-9", "1E-009",
    "NaN", "Infinity", "0." + "0".repeat(126) + "1",
  ])("refuses malformed or expanded-over-budget engineering text %s", value => {
    const bytes = Buffer.from(fixture("Engineering").toString("utf8").replaceAll('"100E-9"', JSON.stringify(value)));
    expect(() => decode("minute", bytes)).toThrowError(/bad_decimal/);
  });
  it("keeps the R0 fixed-decimal contract separate", () => {
    const raw = fixture("Research").toString("utf8");
    const changed = raw.replace('"buy_proxy_notional_usd":"1009.0"', '"buy_proxy_notional_usd":"1.009E+3"');
    expect(changed).not.toBe(raw);
    expect(() => decode("research", Buffer.from(changed))).toThrowError(/bad_decimal/);
  });
});
