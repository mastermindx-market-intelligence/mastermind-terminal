import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mintOptionsSelectionEvidence, selectionFromObjectId } from "../investigationEvidenceOptionsSelection";

const FIXTURE_SHA256 = "9120a929f9f156fc0107c7c7ae172c8d44a69b5ca2b2c231613a359a170cb15e";
const bytes = readFileSync(new URL("./fixtures/macro_options_matrix_selection_vectors_v1.json", import.meta.url));

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const document: unknown = JSON.parse(bytes.toString("utf8"));
const vectorList = (() => {
  if (!record(document) || !Array.isArray(document.vectors)) throw new Error("fixture vectors missing");
  return document.vectors.map((vector, index) => {
    if (!record(vector) || typeof vector.name !== "string" || typeof vector.valid !== "boolean") {
      throw new Error(`fixture vector ${index} malformed`);
    }
    return { name: vector.name, input: vector.input, valid: vector.valid };
  });
})();

/** The adapter is test-local and not exported: it checks key sets (order ignored) and string
 *  types, its sole value check being schema === "options_matrix_selection.v1", then maps the
 *  stored snake_case fields onto the mint input with the carried root, session and matrix. */
const KEY_SETS = {
  document: ["schema", "primary", "comparisons", "view"],
  coordinate: ["expiry", "side", "strike"],
  view: ["lens", "metric", "side", "expiry", "display_mode"],
} as const;

const hasExactKeys = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => {
  if (!record(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && expected.every((key, index) => actual[index] === key);
};

const stringRecord = (value: unknown, keys: readonly string[]): Record<string, string> | null => {
  if (!hasExactKeys(value, keys)) return null;
  const out: Record<string, string> = {};
  for (const key of keys) {
    const item = value[key];
    if (typeof item !== "string") return null;
    out[key] = item;
  }
  return out;
};

type VectorCoordinate = { expiry: string; side: string; strike: string };

const coordinate = (value: unknown): VectorCoordinate | null => {
  const fields = stringRecord(value, KEY_SETS.coordinate);
  return fields === null ? null : { expiry: fields.expiry, side: fields.side, strike: fields.strike };
};

const adapter = (input: unknown): Parameters<typeof mintOptionsSelectionEvidence>[0] | "shape_refused" => {
  if (!hasExactKeys(input, KEY_SETS.document)) return "shape_refused";
  const container = input;
  if (container.schema !== "options_matrix_selection.v1") return "shape_refused";
  if (!Array.isArray(container.comparisons)) return "shape_refused";
  const comparisons: VectorCoordinate[] = [];
  for (const item of container.comparisons) {
    const comparison = coordinate(item);
    if (comparison === null) return "shape_refused";
    comparisons.push(comparison);
  }
  // A null primary is a shape refusal (PLAIN(null) is false; Macro l.196), so the mint's
  // no_primary rule stays Terminal-side only and is unreachable through this adapter.
  const primary = coordinate(container.primary);
  if (primary === null) return "shape_refused";
  const view = stringRecord(container.view, KEY_SETS.view);
  if (view === null) return "shape_refused";
  return {
    root: "SPY",
    session: "2026-10-12",
    matrix: { sha256: "a".repeat(64), bytes: 1000 },
    lens: view.lens,
    primary: { expiry: primary.expiry, side: primary.side, strikeToken: primary.strike },
    comparisons: comparisons.map(entry => ({ expiry: entry.expiry, side: entry.side, strikeToken: entry.strike })),
    view: { metric: view.metric, side: view.side, expiry: view.expiry, displayMode: view.display_mode },
  };
};

const classify = (input: unknown): string => {
  const adapted = adapter(input);
  if (adapted === "shape_refused") return "shape_refused";
  const minted = mintOptionsSelectionEvidence(adapted);
  return minted.ok ? "valid" : minted.reason;
};

describe("options_matrix_selection vectors", () => {
  it("pins the shared Macro fixture byte-for-byte", () => {
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(FIXTURE_SHA256);
    expect(bytes.length).toBe(27191);
    if (!record(document) || document.schema !== "options_matrix_selection_vectors.v1") {
      throw new Error("fixture schema mismatch");
    }
    expect(vectorList).toHaveLength(76);
    expect(vectorList.filter(vector => vector.valid)).toHaveLength(16);
    expect(new Set(vectorList.map(vector => vector.name)).size).toBe(76);
  });

  it.each(vectorList)("$name", (vector) => {
    const adapted = adapter(vector.input);
    const minted = adapted === "shape_refused" ? "shape_refused" : mintOptionsSelectionEvidence(adapted);
    const outcome = minted === "shape_refused" ? "shape_refused" : minted.ok ? "valid" : minted.reason;
    expect(outcome === "valid").toBe(vector.valid);
    if (minted === "shape_refused" || !minted.ok) return;
    const rebuilt = selectionFromObjectId(minted.ref.object_id);
    expect(JSON.parse(rebuilt ?? "null")).toEqual(vector.input);
  });

  it("classifies all 76 vectors into the shared outcome histogram", () => {
    const histogram: Record<string, number> = {};
    for (const vector of vectorList) {
      const outcome = classify(vector.input);
      histogram[outcome] = (histogram[outcome] ?? 0) + 1;
    }
    expect(histogram).toEqual({
      valid: 16, shape_refused: 24, strike_not_exact: 21, expiry_invalid: 5, view_invalid: 5,
      comparison_duplicate: 2, side_invalid: 1, comparisons_over_limit: 1, lens_not_chain: 1,
    });
  });
});
