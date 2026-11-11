import { describe, expect, it } from "vitest";
import { intelligenceResponse } from "../shared-shell/intelligenceResponse";
const payload = { schema:"prophet.index/v1", asof:"2026-11-02", source_asof:"2026-10-30", open_count:0, plans:[] };
describe("intelligence response retains incumbent access semantics",()=>{
 it.each([401,403,404,429,503])("returns HTTP %s unchanged without consuming its body",async status=>{
  const response = new Response("private refusal",{status,headers:{"Retry-After":"5","Cache-Control":"no-store"}});
  const projected = await intelligenceResponse(response,"prophet");
  expect(projected).toBe(response);expect(response.bodyUsed).toBe(false);expect(projected.headers.get("Retry-After")).toBe("5");
 });
 it("returns a bounded private body and removes stale length/encoding/etag headers",async()=>{
  const response = Response.json({...payload,ignored_history:new Array(5000).fill("not part of overview")},
   {headers:{"Content-Length":"999999","Content-Encoding":"gzip","ETag":"old-body","Vary":"Accept-Encoding"}});
  const projected = await intelligenceResponse(response,"prophet");
  expect(projected.status).toBe(200);expect(projected.headers.get("Cache-Control")).toBe("private, no-store");
  expect(projected.headers.get("Vary")).toContain("Cookie");expect(projected.headers.get("Content-Length")).toBeNull();
  expect(projected.headers.get("Content-Encoding")).toBeNull();expect(projected.headers.get("ETag")).toBeNull();
  expect((await projected.text()).length).toBeLessThan(1000);
 });
 it.each([{},null,{...payload,open_count:1}])("malformed success fails unavailable, not empty",async value=>{
  const response = await intelligenceResponse(Response.json(value),"prophet");
  expect(response.status).toBe(503);expect(await response.json()).toEqual({error:"intelligence_summary_unavailable"});
 });
});
