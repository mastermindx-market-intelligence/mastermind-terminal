import { describe, expect, it } from "vitest";
import witnessBook from "./fixtures/portfolio-brief-context/witness_book.json";
import { decodeSnapshotBrief } from "@/lib/portfolioBriefContext.server";

// Full decoder regressions. Raw values and witnessed composer inputs agree exactly;
// only the numeric reader disagreement must cause the rejection.
function decoded(field: "shares" | "entry_price", value: unknown) {
  const body = structuredClone(witnessBook);
  const witness = body.portfolio_context;
  (witness.rows[0] as Record<string, unknown>)[field] = value;
  (witness.composer_inputs[0] as Record<string, unknown>)[field] = value;
  return decodeSnapshotBrief(body, witness.owner_id);
}

describe("leading-decimal Python numeric forms never certify a different canonical book", () => {
  for (const field of ["shares", "entry_price"] as const) {
    // Python float() accepts these. Number() rejects them. The incumbent producer
    // incorrectly accepts these Unicode forms too; consumer defense must still hold.
    for (const value of [".٥", ".５", ".५", "+.٥", "-.٥", ".٥e2", ".٥e-1", ".5e١", ".٥٥", ".١٢e٣"]) {
      it(`${field}=${value}: Unicode leading decimal refuses`, () => {
        expect(decoded(field, value)).toEqual({ ok: false, reason: "row_incompatible" });
      });
    }
    // Independent consumer checks: the current producer already rejects underscores.
    for (const value of [".5_0", ".٥_٠", "+.5_0e2", ".5e1_0"]) {
      it(`${field}=${value}: leading-decimal underscores refuse`, () => {
        expect(decoded(field, value)).toEqual({ ok: false, reason: "row_incompatible" });
      });
    }
    // Preserve current agreed readings, including malformed fields absent to both readers.
    for (const value of [".5", "+.5", "-.5", ".5e2", ".5e-1", "0.5", ".", "._5", ".5_", null, "not-a-number"]) {
      it(`${field}=${String(value)}: agreed-reading control`, () => {
        expect(decoded(field, value).ok).toBe(true);
      });
    }
  }
});
