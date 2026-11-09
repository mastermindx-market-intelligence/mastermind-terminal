/** Inert transport fixture derived from the retained wire golden; no acquisition. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { ownerKeyFor } from "@/lib/accountIdentity";
import { prepareRetainedMatrixRequest, type RetainedMatrixAvailable } from "@/lib/retainedMatrixRead";
export const principal = "11111111-1111-4111-8111-111111111111";
export const secondPrincipal = "22222222-2222-4222-8222-222222222222";
export function retainedFixture(owner = principal, strike = "100") {
  const wire = JSON.parse(readFileSync("lib/__tests__/fixtures/retained-options/matrix-wire.json", "utf8"));
  const body = Buffer.from(wire.capture.body_base64, "base64").toString("utf8")
    .replace("123456789012.12345678", strike)
    .replace(',"coverage"', ',"_build_meta":{"asof_date":"2026-10-19"},"coverage"');
  const hash = createHash("sha256").update(body).digest("hex"), bytes = Buffer.byteLength(body);
  wire.capture.body_base64 = Buffer.from(body).toString("base64"); wire.capture.sha256 = hash; wire.capture.byte_length = bytes;
  wire.document.object.cells.array[0].object.strike = { decimal: strike };
  wire.document.object._build_meta = { object: { asof_date: "2026-10-19" } };
  wire.rows[0].strike = strike;
  Object.assign(wire.snapshot, { sha256: hash, byte_length: bytes, version_ref: `sha256:${hash}:bytes:${bytes}:session:2026-10-19`, key: `options_structure/matrix/history/SPY/${hash}.json` });
  const display = JSON.parse(body);
  const matrix = { ...display, _matrix_source_identity: { schema: "options_structure.acquired_bytes/v1", kind: "matrix", root: "SPY", session: "2026-10-19", sha256: hash, byte_length: bytes } };
  const input = { root: "SPY", session: "2026-10-19", matrix: { sha256: hash, bytes }, lens: "chain",
    primary: { expiry: "2026-10-30", side: "call", strikeToken: String(Number(strike)) }, comparisons: [],
    view: { metric: "volume", side: "call", expiry: "2026-10-30", displayMode: "3d" } };
  const request = prepareRetainedMatrixRequest(input, ownerKeyFor(owner))!;
  const { key: _key, ...reference } = wire.snapshot; void _key;
  const response: RetainedMatrixAvailable = { schema: "options.matrix.read/v1", status: "available", display,
    retained: { wire_utf8: JSON.stringify(wire), reference, selector: wire.selector, owner_id: owner,
      selection_sha256: createHash("sha256").update(request.selection).digest("hex"), read_generation: "fixture-request-1" }, reason: null };
  return { input, matrix, request, response };
}
