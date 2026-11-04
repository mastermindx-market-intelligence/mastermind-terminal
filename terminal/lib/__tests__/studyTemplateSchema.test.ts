// E07 — the portable study-template record: names, body validation, limits and version reads.
import { describe, expect, it } from "vitest";
import {
  STUDY_TEMPLATE_LIMITS,
  STUDY_TEMPLATE_VERSION,
  normalizeStudyTemplateBody,
  normalizeStudyTemplateRecord,
  normalizeTemplateName,
  sameTemplateName,
  studyTemplateBodyBytes,
  studyTemplateLimitProblem,
  studyTemplateSettingsKey,
  STUDY_TEMPLATE_KEY_RE,
  templateNameProblem,
} from "../studyTemplateSchema";

describe("template names", () => {
  it("strips control and direction-override characters and collapses whitespace", () => {
    expect(normalizeTemplateName("  Two‮  RSI\u0007 \n pair ")).toBe("Two RSI pair");
    expect(normalizeTemplateName("​​")).toBeNull();
    expect(templateNameProblem("   ")).toBe("empty");
  });

  it("refuses an over-long name instead of cutting it", () => {
    const long = "x".repeat(STUDY_TEMPLATE_LIMITS.nameMax + 1);
    expect(normalizeTemplateName(long)).toBeNull();
    expect(templateNameProblem(long)).toBe("too_long");
    expect(normalizeTemplateName("x".repeat(STUDY_TEMPLATE_LIMITS.nameMax))).toHaveLength(STUDY_TEMPLATE_LIMITS.nameMax);
    // Counted in code points, so a CJK or emoji name is not penalised for its UTF-16 length.
    expect(normalizeTemplateName("指".repeat(STUDY_TEMPLATE_LIMITS.nameMax))).not.toBeNull();
  });

  it("treats case and full-width forms as the same name", () => {
    expect(sameTemplateName("RSI pair", "ｒｓｉ PAIR")).toBe(true);
    expect(sameTemplateName("RSI pair", "RSI pairs")).toBe(false);
  });
});

describe("template body", () => {
  const body = {
    indicators: ["rsi", "rsi__abcd1234", "structure", "_oracle"],
    indParams: { rsi: { length: 14 }, rsi__abcd1234: { length: 7 }, structure: { "ms.on": true } },
    hidden: ["rsi__abcd1234", "suite:structure/ms"],
  };

  it("accepts a clean body unchanged in strict mode", () => {
    const result = normalizeStudyTemplateBody(body, { strict: true });
    expect(result.issues).toEqual([]);
    expect(result.body).toEqual(body);
  });

  it("strict mode refuses params or eye entries that belong to no template study", () => {
    const hostile = { ...body, indParams: { ...body.indParams, symbol: { value: "TSLA" } } };
    expect(normalizeStudyTemplateBody(hostile, { strict: true })).toEqual({ body: null, issues: ["orphan_params"] });
    const eye = { ...body, hidden: [...body.hidden, "pine:abc", "cmp:AAPL"] };
    expect(normalizeStudyTemplateBody(eye, { strict: true }).body).toBeNull();
  });

  it("lenient mode prunes a legacy record to the template's own studies", () => {
    // A v1 device record captured the WHOLE chart params map, not just the template's studies.
    const legacy = { indicators: ["ema"], indParams: { ema: { p1: 9 }, rsi: { length: 3 }, macd: { fast: 1 } } };
    const result = normalizeStudyTemplateBody(legacy);
    expect(result.body).toEqual({ indicators: ["ema"], indParams: { ema: { p1: 9 } }, hidden: [] });
    expect(result.issues).toContain("orphan_params");
  });

  it("drops prototype keys, non-finite numbers and functions", () => {
    const raw = JSON.parse('{"indicators":["rsi"],"indParams":{"rsi":{"length":14,"__proto__":{"polluted":1},"nested":{"constructor":1,"ok":2}}}}');
    const result = normalizeStudyTemplateBody(raw);
    expect(result.body?.indParams.rsi).toEqual({ length: 14, nested: { ok: 2 } });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const nan = normalizeStudyTemplateBody({ indicators: ["rsi"], indParams: { rsi: { length: Number.NaN } } }, { strict: true });
    expect(nan.body).toBeNull();
  });

  it("refuses duplicate, malformed and prototype study keys", () => {
    const result = normalizeStudyTemplateBody({ indicators: ["rsi", "rsi", "bad key", "__proto__", 4] });
    expect(result.body?.indicators).toEqual(["rsi"]);
    expect(result.issues).toEqual(expect.arrayContaining(["duplicate_key", "invalid_key"]));
  });

  it("enforces the study, eye and size limits", () => {
    const many = Array.from({ length: STUDY_TEMPLATE_LIMITS.studiesMax + 1 }, (_, i) => `rsi__tok${String(i).padStart(4, "0")}`);
    const tooMany = normalizeStudyTemplateBody({ indicators: many }, { strict: true });
    expect(tooMany).toEqual({ body: null, issues: ["too_many_studies"] });
    const big = { indicators: ["rsi"], indParams: { rsi: { note: "x".repeat(STUDY_TEMPLATE_LIMITS.bodyBytesMax) } }, hidden: [] };
    expect(normalizeStudyTemplateBody(big, { strict: true }).issues).toEqual(["too_large"]);
    expect(studyTemplateLimitProblem(big)).toBe("too_large");
    expect(studyTemplateBodyBytes({ indicators: [], indParams: {}, hidden: [] })).toBeLessThan(64);
    let deep: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < STUDY_TEMPLATE_LIMITS.paramDepthMax + 1; i++) deep = { deep };
    const tooDeep = normalizeStudyTemplateBody({ indicators: ["rsi"], indParams: { rsi: deep } }, { strict: true });
    expect(tooDeep.body).toBeNull();
    expect(tooDeep.issues).toContain("too_deep");
  });
});

describe("template records", () => {
  it("reads a v1 device record as revision 1 and keeps its id", () => {
    const v1 = { id: "ct_abc123", name: "Swing", indicators: ["ema"], indParams: { ema: { p1: 9 } }, createdAt: "2026-07-01T00:00:00.000Z" };
    const read = normalizeStudyTemplateRecord(v1, { scope: "device" });
    expect(read?.newer).toBe(false);
    expect(read?.record).toMatchObject({ v: 1, id: "ct_abc123", revision: 1, hidden: [], updatedAt: v1.createdAt });
  });

  it("reads a newer record but flags it so this build never rewrites it", () => {
    const id = "0".repeat(32);
    const read = normalizeStudyTemplateRecord({ v: STUDY_TEMPLATE_VERSION + 1, id, name: "Future", indicators: ["rsi"], revision: 4, futureField: true }, { scope: "account" });
    expect(read?.newer).toBe(true);
    expect(read?.record.revision).toBe(4);
  });

  it("refuses an account record whose id does not match its row key", () => {
    const id = "a".repeat(32);
    expect(normalizeStudyTemplateRecord({ v: 2, id, name: "x", indicators: [] }, { scope: "account", expectedId: "b".repeat(32) })).toBeNull();
    expect(normalizeStudyTemplateRecord({ v: 2, id: "ct_legacy", name: "x", indicators: [] }, { scope: "account" })).toBeNull();
    expect(normalizeStudyTemplateRecord({ v: 0, id, name: "x" }, { scope: "account" })).toBeNull();
    expect(normalizeStudyTemplateRecord("not a record")).toBeNull();
  });

  it("keys account rows inside the workspace_settings key grammar", () => {
    const key = studyTemplateSettingsKey("f".repeat(32));
    expect(key).toMatch(STUDY_TEMPLATE_KEY_RE);
    expect(key).toMatch(/^[a-z][a-z0-9_.]{0,63}$/);
  });
});
