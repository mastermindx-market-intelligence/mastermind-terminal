import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import vectors from "./fixtures/options_matrix_selection_vectors_v1.json";

// Candidate-contract qualification, not a new runtime admission path. The same
// corpus is evaluated by Python; source membership and current rights are separate.
const schema = JSON.parse(readFileSync(new URL("../../../contracts/options_matrix_selection.v1.schema.json", import.meta.url), "utf8"));
const ajv = new Ajv2020({ strict: true, allErrors: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv);
const validate = ajv.compile(schema);

describe("candidate Options selection structural contract", () => {
  it("uses unique vector identities", () => {
    expect(new Set(vectors.vectors.map(vector => vector.name)).size).toBe(vectors.vectors.length);
  });

  it.each(vectors.vectors)("$name: $reason", vector => {
    const input = structuredClone(vector.input);
    const before = JSON.stringify(input);
    expect(validate(input), JSON.stringify(validate.errors)).toBe(vector.valid);
    // In particular, comparisons are neither sorted nor silently deduplicated.
    expect(JSON.stringify(input)).toBe(before);
    if (vector.valid) expect(Buffer.byteLength(before, "utf8")).toBeLessThanOrEqual(2048);
  });
});
