import { describe, expect, it } from "vitest";
import { classifyScriptReadback, parseScriptVersion, sameScriptContent, scriptParamsEqual, verifyScriptSaveReceipt, type ScriptSaveAttempt } from "@/lib/scriptSaveOutcome";
const attempt: ScriptSaveAttempt = { sequence: 1, id: "mine", name: "Owned", source: "plot(close)", params: { a: 0, b: false, nested: { z: 2, y: 1 } }, expected_updated_at: "2026-10-06T12:00:00.000123Z" };
const version = { id: attempt.id, name: attempt.name, source: attempt.source, params: attempt.params, updated_at: "2026-10-06T12:00:00.000124Z" };
describe("saved script outcome verification", () => {
 it("compares object keys semantically while preserving array order, zero and false", () => {
  expect(scriptParamsEqual(attempt.params, { nested:{ y:1,z:2 }, b:false,a:0 })).toBe(true);
  expect(scriptParamsEqual([1,2],[2,1])).toBe(false);
  expect(scriptParamsEqual({a:0},{a:null})).toBe(false);
  expect(scriptParamsEqual({a:false},{a:0})).toBe(false);
 });
 it.each([null, {}, {ok:false,id:"mine",updated_at:version.updated_at}, {id:"mine",updated_at:version.updated_at}, {ok:true,id:"other",updated_at:version.updated_at}, {ok:true,id:"mine",updated_at:"2026-10-06T12:00:00.000123Z"}, {ok:true,id:"mine",updated_at:"2026-10-06T12:00:00.000122Z"}, {ok:true,id:"mine",updated_at:"2026-10-06T08:00:00.000123-04:00"}, {ok:true,id:"mine",updated_at:"2026-10-06"}])("refuses unverified or nonadvancing receipts %#", (body) => {
  expect(verifyScriptSaveReceipt(body, attempt)).toBeNull();
 });
 it("retains the exact newer sub-millisecond token", () => {
  expect(verifyScriptSaveReceipt({ok:true,id:"mine",updated_at:version.updated_at},attempt)?.version.updated_at).toBe(version.updated_at);
 });
 it("validates complete writable contents, including the script name", () => {
  expect(parseScriptVersion(version,"mine")).toEqual(version);
  expect(parseScriptVersion({...version,params:{n:NaN}},"mine")).toBeNull();
  expect(parseScriptVersion({...version,params:[]},"mine")).toBeNull();
  expect(sameScriptContent(version,{...version,name:"Renamed"})).toBe(false);
 });
 it("keeps a same-revision read unresolved and a missing row distinct", () => {
  expect(classifyScriptReadback({scripts:[{...version,updated_at:attempt.expected_updated_at}]},attempt)).toEqual({kind:"unresolved"});
  expect(classifyScriptReadback({scripts:[]},attempt)).toEqual({kind:"missing"});
 });
 it("requires one valid exact row and never treats malformed reads as an empty library", () => {
  for(const body of [{},{scripts:null},{scripts:[version,version]},{scripts:[{...version,updated_at:"bad"}]}])
   expect(classifyScriptReadback(body,attempt)).toEqual({kind:"invalid"});
 });
 it("matches only a strictly newer version with all captured contents", () => {
  expect(classifyScriptReadback({scripts:[version]},attempt)).toEqual({kind:"matched",version});
  const renamed={...version,name:"New name"};
  expect(classifyScriptReadback({scripts:[renamed]},attempt)).toEqual({kind:"different",version:renamed});
 });
});
