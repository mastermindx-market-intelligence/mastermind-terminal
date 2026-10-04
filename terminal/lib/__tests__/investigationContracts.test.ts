import { describe, expect, it, vi } from "vitest";
import { validateInvestigationManifest } from "../investigationContracts";

// These are synthetic owner capabilities, never production identities or grants.
const admission = {
  subjects: [{ owner: "fixture.data", kinds: ["security", "issuer", "theme", "economy"] }],
  evidence: [{ owner: "fixture.evidence", object_types: ["field", "baseline"] }],
};
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const digest = "a".repeat(64);
function draft() {
  return {
    schema: "investigation_manifest.v1",
    intent: { title: "A question", question: "Why did this change?", subjects: [] as unknown[] },
    layout_refs: [] as unknown[], thesis_refs: [] as unknown[], evidence_refs: [] as unknown[],
    continuation: {} as Record<string, unknown>,
  };
}
const subject = (n = 1) => ({ kind: "security", owner: "fixture.data", object_id: `fixture-security-${n}` });
const layout = (n = 1) => ({ layout_id: id(n), layout_revision_id: id(n + 100), digest, role: n === 1 ? "primary" : "supporting" });
const evidence = (n = 1) => ({ owner: "fixture.evidence", object_type: "field", object_id: `fixture-field-${n}`, mode: "pinned", version_ref: `fixture-vintage-${n}` });
function reject(raw: unknown, code: string, path?: string) {
  const result = validateInvestigationManifest(raw, admission);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Unexpected accepted manifest");
  expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code, ...(path ? { path } : {}) })]));
}

describe("P1 Investigation command manifest (shape, not owner qualification)", () => {
  it("saves a free question without layout, Thesis, evidence, Brain, or admitted owner", () => {
    const raw = draft();
    expect(validateInvestigationManifest(raw)).toMatchObject({ ok: true, value: raw });
  });
  it("preserves exact Unicode, whitespace, line endings and reference order", () => {
    const raw = draft();
    raw.intent.title = "日本 · 🧪";
    raw.intent.question = "  Why e\u0301 rather than é?\r\n日本\t🧪  ";
    raw.intent.subjects = [subject(2), subject(1)]; raw.layout_refs = [layout()];
    const before = JSON.stringify(raw);
    const result = validateInvestigationManifest(raw, admission);
    expect(result).toMatchObject({ ok: true, value: raw });
    expect(JSON.stringify(raw)).toBe(before);
    if (!result.ok) throw new Error("Valid Unicode was rejected");
    expect(JSON.stringify(result.value)).toBe(before);
  });
  it("returns an independent value, not mutable aliases into the caller", () => {
    const raw = draft(); const result = validateInvestigationManifest(raw, admission);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Valid input was rejected");
    raw.intent.question = "Rewritten after validation";
    expect(result.value.intent.question).toBe("Why did this change?");
  });
  it.each([[160, true], [161, false]])("counts astral title characters as scalars (%i)", (count, valid) => {
    const raw = draft(); raw.intent.title = "🧪".repeat(count);
    expect(validateInvestigationManifest(raw, admission).ok).toBe(valid);
  });
  it.each([[2000, true], [2001, false]])("enforces the scalar question boundary (%i)", (count, valid) => {
    const raw = draft(); raw.intent.question = "界".repeat(count);
    expect(validateInvestigationManifest(raw, admission).ok).toBe(valid);
  });
  it.each(["\ud800", "\udfff", "a\ud800b", "\udc00\ud800"])("rejects unpaired surrogates without replacing them: %j", text => {
    const raw = draft(); raw.intent.question = text;
    reject(raw, "invalid_unicode", "$.intent.question");
    expect(raw.intent.question).toBe(text);
  });
  it("rejects U+0000 explicitly rather than allowing a later jsonb storage error", () => {
    const raw = draft(); raw.intent.question = "before\u0000after";
    reject(raw, "unsupported_code_point", "$.intent.question");
  });
  it.each(["", " \r\n\t "])("rejects an empty research question: %j", text => {
    const raw = draft(); raw.intent.question = text; reject(raw, "empty_text");
  });
  it("does not normalize canonically equivalent human wording", () => {
    const a = draft(), b = draft(); a.intent.question = "é"; b.intent.question = "e\u0301";
    const ra = validateInvestigationManifest(a), rb = validateInvestigationManifest(b);
    expect(ra.ok && rb.ok).toBe(true);
    if (ra.ok && rb.ok) expect(ra.value.intent.question).not.toBe(rb.value.intent.question);
  });
  it.each(["owner_ref", "author_ref", "scope", "recorded_at", "metadata", "source_bodies", "brain_transcript", "argument_relations", "scenario_recipes"])("rejects unsupported or server-owned top-level field %s", key => {
    reject({ ...draft(), [key]: "forged" }, "unknown_field", `$.${key}`);
  });
  it("rejects an unsupported schema instead of reducing its fields", () => {
    reject({ ...draft(), schema: "investigation_manifest.v99" }, "unsupported_schema", "$.schema");
  });
  it.each([null, [], true, 42, "question"])("rejects non-object input %j", value => reject(value, "invalid_type", "$"));
  it.each(["schema", "intent", "layout_refs", "thesis_refs", "evidence_refs", "continuation"])("requires %s", field => {
    const raw: Record<string, unknown> = draft(); delete raw[field]; reject(raw, "missing_field", `$.${field}`);
  });
  it("rejects unadmitted owner/kind pairs even when their individual names look valid", () => {
    const raw = draft(); raw.intent.subjects = [{ ...subject(), kind: "event" }];
    reject(raw, "unsupported_owner_kind");
    raw.intent.subjects = [{ ...subject(), owner: "not.admitted" }]; reject(raw, "unsupported_owner_kind");
  });
  it("admits no external references by default", () => {
    const raw = draft(); raw.intent.subjects = [subject()];
    const result = validateInvestigationManifest(raw);
    expect(result.ok).toBe(false);
  });
  it("rejects forged evidence qualification and clocks", () => {
    const raw = draft(); raw.evidence_refs = [{ ...evidence(), source_clocks: { first_known_at: "2000-01-01" }, qualified: true }];
    reject(raw, "unknown_field", "$.evidence_refs[0].source_clocks");
  });
  it("requires a retrievable version reference for pinned evidence", () => {
    const raw = draft(); const ref: Record<string, unknown> = evidence(); delete ref.version_ref;
    raw.evidence_refs = [ref]; reject(raw, "pinned_version_required");
  });
  it("allows follow-head intent without pretending it is a retained historical version", () => {
    const raw = draft(); raw.evidence_refs = [{ owner: "fixture.evidence", object_type: "field", object_id: "fixture-field-1", mode: "follow_head" }];
    expect(validateInvestigationManifest(raw, admission).ok).toBe(true);
  });
  it("rejects mixed follow-head/pinned vintage semantics", () => {
    const raw = draft(); raw.evidence_refs = [{ ...evidence(), mode: "follow_head" }];
    reject(raw, "incompatible_reference_mode");
  });
  it.each(["ABC", "A".repeat(64), "g".repeat(64), "a".repeat(63)])("rejects invalid layout digest %s", value => {
    const raw = draft(); raw.layout_refs = [{ ...layout(), digest: value }]; reject(raw, "invalid_digest");
  });
  it("requires immutable layout UUID identity, not a mutable name/revision counter", () => {
    const raw = draft(); raw.layout_refs = [{ ...layout(), layout_revision_id: 3 }]; reject(raw, "invalid_uuid");
    raw.layout_refs = [{ ...layout(), name: "My layout" }]; reject(raw, "unknown_field");
  });
  it("rejects duplicate layout references even when their roles differ", () => {
    const raw = draft(); raw.layout_refs = [layout(), { ...layout(), role: "supporting" }]; reject(raw, "duplicate_reference");
  });
  it("rejects duplicate subject and evidence references", () => {
    const raw = draft(); raw.intent.subjects = [subject(), subject()]; reject(raw, "duplicate_reference");
    raw.intent.subjects = []; raw.evidence_refs = [evidence(), evidence()]; reject(raw, "duplicate_reference");
  });
  it.each([[16, true], [17, false]])("bounds subject count %i", (count, valid) => {
    const raw = draft(); raw.intent.subjects = Array.from({ length: count }, (_, i) => subject(i));
    expect(validateInvestigationManifest(raw, admission).ok).toBe(valid);
  });
  it.each([[4, true], [5, false]])("bounds layout count %i", (count, valid) => {
    const raw = draft(); raw.layout_refs = Array.from({ length: count }, (_, i) => layout(i + 1));
    expect(validateInvestigationManifest(raw, admission).ok).toBe(valid);
  });
  it.each([[128, true], [129, false]])("bounds active evidence count %i", (count, valid) => {
    const raw = draft(); raw.evidence_refs = Array.from({ length: count }, (_, i) => evidence(i));
    expect(validateInvestigationManifest(raw, admission).ok).toBe(valid);
  });
  it("uses exact Thesis versions and rejects copied authored beliefs", () => {
    const raw = draft(); raw.thesis_refs = [{ thesis_id: id(2), version_id: id(3), role: "alternative" }];
    expect(validateInvestigationManifest(raw, admission).ok).toBe(true);
    raw.thesis_refs = [{ thesis_id: id(2), version_id: id(3), role: "alternative", statement: "Copied belief" }]; reject(raw, "unknown_field");
  });
  it("keeps no baseline absent, never synthesizes a zero-change baseline", () => {
    const result = validateInvestigationManifest(draft()); expect(result.ok).toBe(true);
    if (result.ok) expect(Object.hasOwn(result.value, "review_baseline_ref")).toBe(false);
  });
  it("validates an opaque baseline request without accepting client qualification", () => {
    const raw = { ...draft(), review_baseline_ref: { ...evidence(), object_type: "baseline" } };
    expect(validateInvestigationManifest(raw, admission).ok).toBe(true);
    reject({ ...raw, review_baseline_ref: { ...raw.review_baseline_ref, qualified_at: "2026-10-03" } }, "unknown_field");
  });
  it.each(["2026-02-30", "2025-02-29", "2026-13-01", "0000-01-01", "2026-1-1", "2026-01-01T00:00:00Z"])("rejects invalid research date %s", date => {
    const raw = draft(); Object.assign(raw.intent, { research_as_of: date }); reject(raw, "invalid_date");
  });
  it("accepts a valid leap date, without claiming historical source availability", () => {
    const raw = draft(); Object.assign(raw.intent, { research_as_of: "2024-02-29", horizon: "one month" });
    expect(validateInvestigationManifest(raw, admission).ok).toBe(true);
  });
  it("rejects server-owned baseline review timestamps in continuation", () => {
    const raw = draft(); raw.continuation = { last_reviewed_at: "2026-10-03T00:00:00Z" }; reject(raw, "unknown_field");
  });
  it("rejects non-data objects without executing getters or toJSON", () => {
    const getter = vi.fn(() => "poisoned"); const raw = draft();
    Object.defineProperty(raw.intent, "question", { get: getter, enumerable: true });
    reject(raw, "non_json_value"); expect(getter).not.toHaveBeenCalled();
    const toJSON = vi.fn(() => draft()); reject({ toJSON }, "non_json_value"); expect(toJSON).not.toHaveBeenCalled();
  });
  it("rejects cycles, undefined, exotic objects and nonfinite numbers without throwing", () => {
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic; reject(cyclic, "non_json_value");
    for (const value of [undefined, Number.NaN, Infinity, new Date(), new Map()]) reject({ ...draft(), extra: value }, "non_json_value");
  });
  it("bounds diagnostic output", () => {
    const raw = { ...draft(), ...Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`unknown_${i}`, true])) };
    const result = validateInvestigationManifest(raw, admission); expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeLessThanOrEqual(32);
  });
  it("enforces UTF-8 byte size without silently removing long references", () => {
    const raw = draft(); raw.intent.question = "界".repeat(2000);
    raw.evidence_refs = Array.from({ length: 128 }, (_, i) => ({ ...evidence(i), object_id: `${i}-` + "界".repeat(200), version_ref: "界".repeat(200) }));
    const original = JSON.stringify(raw); reject(raw, "manifest_too_large"); expect(JSON.stringify(raw)).toBe(original);
  });
});

function exactBytes(bytes: number) {
  const raw = draft();
  const refs = Array.from({ length: 128 }, (_, index) => evidence(index));
  raw.evidence_refs = refs;
  let remaining = bytes - new TextEncoder().encode(JSON.stringify(raw)).byteLength;
  for (const ref of refs) {
    for (const field of ["object_id", "version_ref"] as const) {
      const count = Math.min(256 - ref[field].length, remaining);
      ref[field] += "x".repeat(count); remaining -= count;
    }
  }
  if (remaining !== 0) throw new Error("Test fixture could not reach requested byte size");
  expect(new TextEncoder().encode(JSON.stringify(raw)).byteLength).toBe(bytes);
  return raw;
}

describe("P1 boundary and active-object falsifiers", () => {
  it.each([[65535, true], [65536, true], [65537, false]])("enforces the exact serialized byte boundary %i", (size, accepted) => {
    expect(validateInvestigationManifest(exactBytes(size), admission).ok).toBe(accepted);
  });
  it("never executes inherited Array serialization hooks", () => {
    const hook = vi.fn(() => []);
    const values: unknown[] = [];
    Object.setPrototypeOf(values, { toJSON: hook });
    const raw = draft(); raw.intent.subjects = values;
    reject(raw, "non_json_value"); expect(hook).not.toHaveBeenCalled();
  });
  it("rejects sparse arrays rather than filling their holes with null", () => {
    const raw = draft(); raw.layout_refs = new Array(2); reject(raw, "non_json_value");
  });
  it("rejects nonenumerable data rather than silently discarding it", () => {
    const raw = draft(); Object.defineProperty(raw.intent, "extra", { value: "hidden", enumerable: false });
    reject(raw, "non_json_value");
  });
  it("rejects symbols and extra array properties", () => {
    reject({ ...draft(), [Symbol("hidden")]: "private" }, "non_json_value");
    const raw = draft(); Object.assign(raw.layout_refs, { extra: "hidden" }); reject(raw, "non_json_value");
  });
  it("bounds Thesis references and distinguishes distinct versions", () => {
    const raw = draft(); raw.thesis_refs = Array.from({ length: 16 }, (_, i) => ({ thesis_id: id(i + 1), version_id: id(i + 100), role: "context" }));
    expect(validateInvestigationManifest(raw, admission).ok).toBe(true);
    raw.thesis_refs.push({ thesis_id: id(99), version_id: id(199), role: "context" }); reject(raw, "too_many_items");
  });
  it("does not conflate different fields of one evidence object", () => {
    const raw = draft(); raw.evidence_refs = [{ ...evidence(), selection: { field: "revenue" } }, { ...evidence(), selection: { field: "margin" } }];
    expect(validateInvestigationManifest(raw, admission).ok).toBe(true);
  });
  it("rejects executable or unknown selectors", () => {
    const raw = draft(); raw.evidence_refs = [{ ...evidence(), selection: { field: "eval(x)" } }]; reject(raw, "unsupported_selection");
    raw.evidence_refs = [{ ...evidence(), selection: { field: "revenue", query: "run()" } }]; reject(raw, "unknown_field");
  });
  it("cannot turn a follow-head reference into a reviewed baseline", () => {
    const raw = { ...draft(), review_baseline_ref: { owner: "fixture.evidence", object_type: "baseline", object_id: "fixture-head", mode: "follow_head" } };
    reject(raw, "unsupported_value", "$.review_baseline_ref.mode");
  });
  it("rejects privileged nested intent fields", () => {
    const raw = draft(); Object.assign(raw.intent, { owner_principal: "forged", rights: "all" });
    reject(raw, "unknown_field", "$.intent.owner_principal");
  });
});

import textVectors from "./fixtures/investigation_text_vectors.json";

describe("shared Python/TypeScript text vectors", () => {
  it.each(textVectors.vectors)("$name", vector => {
    const raw = draft();
    if (vector.field === "title") raw.intent.title = vector.text;
    else raw.intent.question = vector.text;
    const result = validateInvestigationManifest(raw);
    expect(result.ok).toBe(vector.valid);
    if (result.ok) {
      expect(result.value.intent[vector.field as "title" | "question"]).toBe(vector.text);
    } else {
      expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: vector.code })]));
    }
  });
});
