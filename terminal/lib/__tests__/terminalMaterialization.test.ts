import { createHash, webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fixture from "./terminalMaterialization.fixture.json";
import { encodeTerminalRows, terminalMaterializationRefusal, verifyTerminalMaterialization } from "../terminalMaterialization";
import { decodeReturnSeries } from "../returnsIntelligence";

// Deliberately malformed candidates need a mutable, unknown-input boundary.
const document = (): Record<string, any> => structuredClone(fixture.document);
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
  vi.stubGlobal("crypto", webcrypto);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("matches Data OS's portable bytes and SHA across float-looking prices and safe large volume", () => {
  expect(fixture.fixture).toBe(true);
  for (const [rows, encoded, digest] of [
    [fixture.document.bars, fixture.encoded_hex, fixture.bars_sha256],
    [fixture.portable_rows, fixture.portable_encoded_hex, fixture.portable_sha256],
  ] as const) {
    const bytes = encodeTerminalRows(rows);
    expect(Buffer.from(bytes).toString("hex")).toBe(encoded);
    expect(sha(bytes)).toBe(digest);
  }
  // The prior Python JSON digest must never be silently redefined as JSON.stringify.
  expect(sha(new TextEncoder().encode(JSON.stringify(fixture.document.bars))))
    .not.toBe(fixture.document.source_observation.bars_sha256);
});

it("requires actual process-local verification before an owner contract qualifies the series", async () => {
  const doc = document();
  doc.view.contract.materialization.verified = true;
  doc.verified = true;
  expect(decodeReturnSeries("ZQXA",doc).quality).not.toBe("qualified");
  expect(await verifyTerminalMaterialization("ZQXA",doc)).toBeNull();
  expect(decodeReturnSeries("ZQXA",doc).quality).toBe("qualified");
  expect(decodeReturnSeries("ZQXA",doc).basis).toBe("adjusted_view");
  // Serialization carries data, not a verified capability.
  expect(decodeReturnSeries("ZQXA", JSON.parse(JSON.stringify(doc))).quality).not.toBe("qualified");
});

it("detects changed high/open values even when the close series is unchanged", async () => {
  const doc = document();
  doc.bars[0][2] += 1;
  expect(await verifyTerminalMaterialization("ZQXA",doc)).toBe("MATERIALIZATION_CONTENT_MISMATCH");
  expect(decodeReturnSeries("ZQXA",doc).quality).toBe("refused");
});

it.each(["append","trim","reorder","wrong-symbol","wrong-namespace","unsupported-request","bad-code","false-generation","bad-segment"])(
  "withholds qualification for %s without accepting metadata presence as proof", async fault => {
    const doc = document(), m = doc.view.contract.materialization;
    if (fault === "append") doc.bars.push(["2026-10-19",102,104,101,103,200]);
    if (fault === "trim") doc.bars.shift();
    if (fault === "reorder") doc.bars.reverse();
    if (fault === "wrong-symbol") m.symbol = "OTHER";
    if (fault === "wrong-namespace") m.alias_namespace = "store";
    if (fault === "unsupported-request") m.request.auto_adjust = false;
    if (fault === "bad-code") { m.owner.code_version = "sha256:" + "0".repeat(64); doc.view.contract.evidence_mode.code_version = m.owner.code_version; }
    if (fault === "false-generation") m.identity_reference.generation_attested = true;
    if (fault === "bad-segment") doc.view.segments[0].src = "polygon";
    expect(await verifyTerminalMaterialization("ZQXA",doc)).not.toBeNull();
    expect(decodeReturnSeries("ZQXA",doc).quality).not.toBe("qualified");
  }
);

it("invalidates successful verification when either rows or refusal evidence later changes", async () => {
  const doc = document();
  await verifyTerminalMaterialization("ZQXA",doc);
  doc.bars[0][1] += 0.125;
  expect(terminalMaterializationRefusal("ZQXA",doc)).toBe("MATERIALIZATION_CONTENT_CHANGED");
  expect(decodeReturnSeries("ZQXA",doc).quality).toBe("refused");
  const other = document();
  await verifyTerminalMaterialization("ZQXA",other);
  other.view.refusal_reasons.push("MATERIALIZATION_CONTENT_CHANGED");
  expect(decodeReturnSeries("ZQXA",other).quality).toBe("refused");
});

it("refuses a stripped materialization on the direct-source evidence variant", async () => {
  const doc = document();
  delete doc.view.contract.materialization;
  expect(await verifyTerminalMaterialization("ZQXA",doc)).not.toBeNull();
  expect(decodeReturnSeries("ZQXA",doc).quality).not.toBe("qualified");
});

it.each(["omit", "replace"])("refuses a stripped owner block when the observation clock is also %s", async fault => {
  const doc = document();
  delete doc.view.contract.materialization;
  if (fault === "omit") delete doc.view.contract.evidence_mode.clock;
  else doc.view.contract.evidence_mode.clock = "ingested_at";
  // The remaining null source registry cannot acquire legacy qualification.
  expect(doc.view.contract.evidence_mode.registry_row).toBeNull();
  expect(await verifyTerminalMaterialization("ZQXA", doc)).toBe("MATERIALIZATION_OWNER_VERSION_UNSUPPORTED");
  expect(decodeReturnSeries("ZQXA", doc).quality).toBe("refused");
});

it.each(["date","duplicate","NaN","boolean","unsafe-volume","fractional-volume","negative","extra-field"])(
  "rejects nonportable or malformed %s rows", fault => {
    const rows = document().bars;
    if (fault === "date") rows[0][0] = "2026-02-30";
    if (fault === "duplicate") rows[1][0] = rows[0][0];
    if (fault === "NaN") rows[0][4] = NaN;
    if (fault === "boolean") rows[0][5] = true;
    if (fault === "unsafe-volume") rows[0][5] = 2**53;
    if (fault === "fractional-volume") rows[0][5] = 1.5;
    if (fault === "negative") rows[0][4] = -1;
    if (fault === "extra-field") rows[0].push(0);
    expect(() => encodeTerminalRows(rows)).toThrow("MATERIALIZATION_ROWS_INVALID");
  }
);

it("normalizes volume negative zero and preserves exact supported numerical value identity", () => {
  const rows = document().bars, before = sha(encodeTerminalRows(rows));
  rows[0][5] = -0;
  expect(sha(encodeTerminalRows(rows))).toBe(before);
});

it("keeps qualification withheld when the browser cryptographic primitive is unavailable", async () => {
  vi.stubGlobal("crypto", undefined);
  const doc = document();
  expect(await verifyTerminalMaterialization("ZQXA",doc)).toBe("MATERIALIZATION_VERIFICATION_UNAVAILABLE");
  expect(decodeReturnSeries("ZQXA",doc).quality).not.toBe("qualified");
});
