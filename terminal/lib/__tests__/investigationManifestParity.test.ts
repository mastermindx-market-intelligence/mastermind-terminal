import {describe,expect,it} from "vitest";
import vectors from "./fixtures/investigation_manifest_vectors.json";
import {validateInvestigationManifest} from "../investigationContracts";

describe("frozen full-manifest Python/TypeScript corpus",()=>{
 it.each(vectors.vectors)("$name",vector=>{
  const input=structuredClone(vector.manifest);
  const result=validateInvestigationManifest(input,vector.admission);
  expect(result.ok,JSON.stringify(result.ok?null:result.errors)).toBe(vector.valid);
  expect(input).toEqual(vector.manifest);
  if(result.ok){
   expect(result.value).toEqual(input);
   result.value.intent.question="Detached edit";
   expect(input.intent.question).toBe(vector.manifest.intent.question);
  }
 });
});
