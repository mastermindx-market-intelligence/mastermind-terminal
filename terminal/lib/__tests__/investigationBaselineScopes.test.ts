import {beforeEach, describe, expect, it, vi} from "vitest";
import golden from "./fixtures/aapl-event-workspace.json";

const {getUser, current, whole, selected}=vi.hoisted(()=>({getUser:vi.fn(),current:vi.fn(),whole:vi.fn(),selected:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getUser}})}));
vi.mock("@/lib/eventWorkspace",async()=>({
  ...await vi.importActual<typeof import("@/lib/eventWorkspace")>("@/lib/eventWorkspace"),
  resolveCurrentEventWorkspaceFromR2:current,resolveRetainedEventWorkspaceFromR2:whole,
}));
vi.mock("@/lib/investigationIssuerRelease",()=>({resolveInvestigationIssuerRelease:selected}));
import {GET} from "@/app/api/investigations/baseline/route";
import {loadCompanyRetainedContext} from "../companyRetainedContext";
import {normalizeEventWorkspace} from "../eventWorkspace";

const pin={event_id:golden.event_id,generation_id:golden.generation_id,company_id:golden.issuer.company_id,fingerprint:"a".repeat(64)};
const unavailable={ok:false,code:"HISTORICAL_UNAVAILABLE",reason:"rights_unavailable"};
const receipt={schema:"earnings.retained_baseline.v1",owner:"earnings.workspace_generation",...pin,
  workspace_schema:"event_workspace.v1",manifest_schema:"event_workspace_manifest.v1",authority:"context_only",
  manifest_sha256:"b".repeat(64),manifest_bytes:1,workspace_sha256:"c".repeat(64),workspace_bytes:1,
  public_known_at:null,platform_known_at:null,generation_emitted_at:golden.generated_at,
  rights:{allowed:true,policy_version:"fixture-scoped-owner.v1",checked_at:golden.generated_at}};
const query=new URLSearchParams(pin).toString();
const request=(q:string)=>new Request(`https://terminal.test/api/investigations/baseline?${q}`);
const localFetch:typeof fetch=async(input,init)=>GET(new Request(`https://terminal.test${input}`,init));
beforeEach(()=>{
  vi.clearAllMocks();getUser.mockResolvedValue({data:{user:{id:"fixture-principal"}},error:null});
  current.mockResolvedValue({ok:true,state:"ready",workspace:golden});
  whole.mockResolvedValue(unavailable);selected.mockResolvedValue(unavailable);
});

describe("Company context and selected-release endpoint scope composition",()=>{
  it("keeps no-scope IW2 requests on the selected owner with no authorization invented",async()=>{
    expect((await GET(request(query))).status).toBe(503);
    expect(selected.mock.calls[0][0]).toEqual(pin);expect(selected.mock.calls[0][2].authorize).toBeUndefined();
    expect(whole).not.toHaveBeenCalled();expect(current).not.toHaveBeenCalled();
  });
  it("routes explicit Company pins only to the whole owner; a selected grant cannot substitute",async()=>{
    selected.mockResolvedValue({ok:true,workspace:{schema:"earnings.issuer_release_projection.v1"}});
    const response=await GET(request(`${query}&scope=company_context`));
    expect(response.status).toBe(503);expect(await response.json()).toEqual(unavailable);
    expect(whole.mock.calls[0][0]).toEqual(pin);expect(whole.mock.calls[0][2].authorize).toBeUndefined();
    expect(selected).not.toHaveBeenCalled();expect(current).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("composes the Company loader with the exact full owner payload in an authorized owner fixture",async()=>{
    whole.mockResolvedValue({ok:true,workspace:golden,receipt});
    expect(await loadCompanyRetainedContext({symbol:"AAPL",pin,fetchImpl:localFetch}))
      .toEqual({ok:true,workspace:normalizeEventWorkspace(golden),receipt});
    expect(whole.mock.calls[0][0]).toEqual(pin);expect(selected).not.toHaveBeenCalled();
  });
  it("rejects a selected projection even when paired with a superficially valid whole receipt",async()=>{
    whole.mockResolvedValue({ok:true,workspace:{...golden,schema:"earnings.issuer_release_projection.v1"},receipt});
    const result=await loadCompanyRetainedContext({symbol:"AAPL",pin,fetchImpl:localFetch});
    expect(result).toEqual({ok:false,code:"HISTORICAL_UNAVAILABLE",reason:"normalize"});
    expect(whole).toHaveBeenCalledTimes(1);expect(current).not.toHaveBeenCalled();expect(selected).not.toHaveBeenCalled();
  });
  it("rejects unknown/duplicated scopes and mixed selectors without reading either owner",async()=>{
    for(const q of [`${query}&scope=issuer_release`,`${query}&scope=company_context&scope=company_context`,
      `${query}&scope=`,`${query}&scope=company_context&symbol=AAPL`]){
      expect((await GET(request(q))).status).toBe(400);
    }
    expect(whole).not.toHaveBeenCalled();expect(selected).not.toHaveBeenCalled();expect(current).not.toHaveBeenCalled();
  });
  it("authenticates Company scope before owner access",async()=>{
    getUser.mockResolvedValue({data:{user:null},error:null});
    expect((await GET(request(`${query}&scope=company_context`))).status).toBe(401);
    expect(whole).not.toHaveBeenCalled();expect(selected).not.toHaveBeenCalled();expect(current).not.toHaveBeenCalled();
  });
  it("binds Company bootstrap to its company and exact generation before the separate whole-owner read",async()=>{
    expect(await loadCompanyRetainedContext({symbol:"AAPL",fetchImpl:localFetch})).toEqual(unavailable);
    expect(current).toHaveBeenCalledTimes(1);
    expect(whole.mock.calls[0][0]).toEqual({event_id:pin.event_id,generation_id:pin.generation_id,company_id:pin.company_id});
    expect(whole.mock.calls[0][2].authorize).toBeUndefined();expect(selected).not.toHaveBeenCalled();
  });
  it("fails closed for a legacy no-scope Company caller receiving selected content",async()=>{
    selected.mockResolvedValue({ok:true,workspace:{...golden,schema:"earnings.issuer_release_projection.v1"},receipt});
    const legacyFetch:typeof fetch=async(input,init)=>{
      const url=new URL(`https://terminal.test${input}`);url.searchParams.delete("scope");
      return GET(new Request(url,init));
    };
    expect(await loadCompanyRetainedContext({symbol:"AAPL",pin,fetchImpl:legacyFetch}))
      .toEqual({ok:false,code:"HISTORICAL_UNAVAILABLE",reason:"normalize"});
    expect(selected).toHaveBeenCalledTimes(1);expect(whole).not.toHaveBeenCalled();expect(current).not.toHaveBeenCalled();
  });
});
