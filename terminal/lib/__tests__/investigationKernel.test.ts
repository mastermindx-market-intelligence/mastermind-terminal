import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import corpus from "./fixtures/investigation_kernel_vectors.json";
import legacy from "./fixtures/investigation_manifest_pre_kernel_vectors.json";
import { canonicalInvestigationJson, validateInvestigationManifest, validateStoredInvestigationManifest } from "../investigationContracts";

describe("shared Investigation kernel corpus", () => {
  it.each(corpus.vectors)("$name", vector => {
    const result = validateInvestigationManifest(vector.manifest, corpus.admission);
    expect(result.ok, JSON.stringify(result)).toBe(vector.valid);
    if (result.ok) {
      const bytes = canonicalInvestigationJson(result.value);
      expect(bytes).toBe(vector.canonical);
      expect(createHash("sha256").update(bytes, "utf8").digest("hex")).toBe(vector.sha256);
      expect(result.value).toEqual(vector.manifest);
    }
  });
  it.each(legacy.vectors.filter(v=>v.valid && v.manifest.schema==="investigation_manifest.v2"))("reads original pre-repair bytes without enabling new writes: $name",vector=>{
    const result=validateStoredInvestigationManifest(vector.manifest,vector.admission);
    expect(result).toEqual({ok:true,value:vector.manifest});
    expect(validateInvestigationManifest(vector.manifest,vector.admission).ok).toBe(false);
  });
});
