import { describe, expect, it, vi } from "vitest";
import { handleV1WatchlistAdd } from "@/lib/apiV1WatchlistWrite";
import { newApiKeySalt } from "@/lib/apiV1";
import { normalizeKeyScopes } from "@/lib/apiKeys";
const KEY = "mmx_" + "A".repeat(40);
const ID = "30000000-0000-4000-8000-000000000001";
const body = { schema: "mm.api.v1.watchlist_symbol", version: "2026-10-15", asof: "2026-10-15T00:00:00Z", data: {symbol:"AAPL",added:true} };
function deps(scopes: unknown = ["read","watchlists:write"], reply: unknown = { status:201,body,replayed:false }) {
  const rpc = vi.fn(async (fn: string) => {
    if (fn === "api_key_salt_for_prefix") return {data:{key_salt:newApiKeySalt()},error:null};
    if (fn === "api_key_authenticate") return {data:{user_id:"owner",key_id:"key",scopes,limit:60,remaining:59},error:null};
    return {data:reply,error:null};
  });
  return {service:{rpc}};
}
function request(value: unknown = {symbol:" aapl "}, id = "request-id-000001") {
  return new Request("https://app.mastermind-x.com/api/v1/watchlists/"+ID+"/symbols", {
    method:"POST",headers:{Authorization:"Bearer "+KEY,"Idempotency-Key":id,"Content-Type":"application/json"},body:JSON.stringify(value),
  });
}
describe("watchlist write HTTP boundary",()=>{
  it("normalizes existing product semantics and forwards only authenticated identity",async()=>{
    const d=deps(); const r=await handleV1WatchlistAdd(request(),ID,d);
    expect(r.status).toBe(201);expect(await r.json()).toEqual(body);
    expect(d.service.rpc).toHaveBeenLastCalledWith("api_v1_add_watchlist_symbol",{p_key_id:"key",p_user_id:"owner",p_watchlist_id:ID,p_request_id:"request-id-000001",p_symbol:"AAPL",p_section:"Watchlist"});
    expect(r.headers.get("Cache-Control")).toBe("no-store");
  });
  it.each([["read"],undefined,[],["admin"]])("requires actual write scope (%j)",async(scopes)=>{
    const d=deps(scopes===undefined?null:scopes);
    expect((await handleV1WatchlistAdd(request(),ID,d)).status).toBe(403);
    expect(d.service.rpc).toHaveBeenCalledTimes(2);
  });
  it.each([null,[],{symbol:["AAPL"]},{symbol:""},{symbol:"AAPL",section:null},{symbol:"AAPL",user_id:"other"},{symbol:"AAPL",section:"x".repeat(81)},{symbol:"AAPL\u0000"}])("rejects malformed input without write (%j)",async(value)=>{
    const d=deps();expect((await handleV1WatchlistAdd(request(value),ID,d)).status).toBe(400);
    expect(d.service.rpc).toHaveBeenCalledTimes(2);
  });
  it("enforces body size and request identity",async()=>{
    for (const [value,key,id] of [[{symbol:"AAPL",section:"a".repeat(5000)},"request-id-000001",ID],[{symbol:"AAPL"},"short",ID],[{symbol:"AAPL"},"request-id-000001","bad-id"]] as const) {
      const d=deps();expect((await handleV1WatchlistAdd(request(value,key),id,d)).status).toBe(400);
      expect(d.service.rpc).toHaveBeenCalledTimes(2);
    }
  });
  it("replays stored status/body and surfaces database denials",async()=>{
    const r=await handleV1WatchlistAdd(request(),ID,deps(["read","watchlists:write"],{status:201,body,replayed:true}));
    expect(await r.json()).toEqual(body);expect(r.headers.get("Idempotency-Replayed")).toBe("true");
    for(const status of [400,401,403,404,409,503]){
      expect((await handleV1WatchlistAdd(request(),ID,deps(["read","watchlists:write"],{status}))).status).toBe(status);
    }
  });
  it("unconfirmed RPC transport is retryable without exposing internal errors",async()=>{
    const d=deps();d.service.rpc.mockImplementationOnce(async()=>({data:{key_salt:newApiKeySalt()},error:null}));
    d.service.rpc.mockImplementationOnce(async()=>({data:{user_id:"owner",key_id:"key",scopes:["read","watchlists:write"]},error:null}));
    d.service.rpc.mockImplementationOnce(async()=>{throw new Error("private credential");});
    const r=await handleV1WatchlistAdd(request(),ID,d);expect(r.status).toBe(503);expect(r.headers.get("Retry-After")).toBe("3");expect(await r.text()).not.toContain("private credential");
  });
});
it("scope opt-in accepts only the exact supported combinations",()=>{
  expect(normalizeKeyScopes(undefined)).toEqual(["read"]);
  expect(normalizeKeyScopes(["watchlists:write","read"])).toEqual(["read","watchlists:write"]);
  for(const value of [null,[],["admin"],["write"],["read","read"],["watchlists:write"],"read",["read","watchlists:write","admin"]]) expect(normalizeKeyScopes(value)).toBeNull();
});
