import { describe,expect,it } from "vitest";
import { macroSelection,macroWorkspaceHref,macroWorkspacePayload } from "@/lib/shared-shell/macroWorkspacePayload";
import { liquidityFixture } from "./fixtures/macroLiquidity";

describe("closed native Macro selection and source binding",()=>{
  it("selects one explicit workspace and preserves unrelated return context",()=>{
    expect(macroSelection(new URLSearchParams())).toBe("overview");
    expect(macroSelection(new URLSearchParams("macroWorkspace=liquidity_regime"))).toBe("liquidity");
    for(const query of ["macroWorkspace=","macroWorkspace=unknown","macroWorkspace=liquidity_regime&macroWorkspace=liquidity_regime"]) expect(macroSelection(new URLSearchParams(query))).toBe("invalid");
    expect(macroWorkspaceHref("workspaceMarket=us&from=today&macroWorkspace=bad",true)).toBe("/intelligence?workspaceMarket=us&from=today&macroWorkspace=liquidity_regime");
    expect(macroWorkspaceHref("workspaceMarket=us&macroWorkspace=liquidity_regime",false)).toBe("/intelligence?workspaceMarket=us");
  });
  it("retains the producer state, actual comparison dates, zero, missing driver and absent history",()=>{
    const fixture=liquidityFixture(),decoded=macroWorkspacePayload(fixture);
    expect(decoded).toBe(fixture);
    expect(decoded?.selected_workspace.view?.headline.state_id).toBe("D");
    expect(decoded?.selected_workspace.view?.axes[0].value_raw).toBe(48);
    expect(decoded?.selected_workspace.view?.changes.deltas[1].delta_raw).toBe(0);
    expect(decoded?.selected_workspace.view?.drivers[0].rows[1].value).toBeNull();
    expect(decoded?.selected_workspace.view?.series.absent).toBe(true);
  });
  it("admits a source-declared stale artifact without upgrading its evidence",()=>{
    const fixture=liquidityFixture();fixture.selected_workspace.view.context.state="STALE_SOURCE";fixture.selected_workspace.view.context.worst_freshness_token="STALE_SOURCE";
    expect(macroWorkspacePayload(fixture)?.selected_workspace.view?.context.state).toBe("STALE_SOURCE");
  });
  it.each(["workspace","region","generation","artifact","manifest","authority","date","size"])("refuses mismatched %s",kind=>{
    const fixture=liquidityFixture(),v=fixture.selected_workspace.view;
    if(kind==="workspace")v.workspace.id="growth_real_economy";
    if(kind==="region")Reflect.set(v.region,"code","CN");
    if(kind==="generation")v.evidence.generation.generation_id="other";
    if(kind==="artifact")v.evidence.artifact.sha256="7".repeat(64);
    if(kind==="manifest")fixture.source.manifest_sha256="bad";
    if(kind==="authority")Reflect.set(v.evidence.authority.flags[0],"value",true);
    if(kind==="date")v.headline.effective_date="2026-02-30";
    if(kind==="size")fixture.selected_workspace.artifact.bytes=3000000;
    expect(macroWorkspacePayload(fixture)).toBeNull();
  });
  it.each([null,"","   "])("refuses blank present observations and impacts (%s)",display=>{
    const fixture=liquidityFixture();fixture.selected_workspace.view.changes.deltas[0].prior=display;
    expect(macroWorkspacePayload(fixture)).toBeNull();
    const impact=liquidityFixture();impact.selected_workspace.view.drivers[0].rows[0].impact=display;
    expect(macroWorkspacePayload(impact)).toBeNull();
  });
  it("rejects non-finite values, false presence and future prior dates",()=>{
    for(const alter of [(f:ReturnType<typeof liquidityFixture>)=>{f.selected_workspace.view.changes.deltas[0].current_raw=Infinity;},(f:ReturnType<typeof liquidityFixture>)=>{f.selected_workspace.view.changes.deltas[0].delta_present=false;},(f:ReturnType<typeof liquidityFixture>)=>{f.selected_workspace.view.changes.prior_effective_date="2026-11-13";}]) {const f=liquidityFixture();alter(f);expect(macroWorkspacePayload(f)).toBeNull();}
  });
  it("retains a selected refusal only when it contains no substituted view or receipt",()=>{
    const f=liquidityFixture();const refusal={...f,selected_workspace:{workspace_id:"liquidity_regime",region:"US",state:"unavailable",generation_id:null,artifact:null,view:null,failure:{kind:"SOURCE_FAILED",detail:"Published workspace could not be verified."}}};
    expect(macroWorkspacePayload(refusal)).toBe(refusal);
    expect(macroWorkspacePayload({...refusal,selected_workspace:{...refusal.selected_workspace,view:f.selected_workspace.view}})).toBeNull();
  });
});
