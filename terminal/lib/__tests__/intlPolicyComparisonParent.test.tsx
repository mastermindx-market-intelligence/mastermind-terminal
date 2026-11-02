// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { IntlPolicyComparison } from "@/components/research/IntlPolicyComparison";
import { beginPolicyPreview, createPolicyPreviewSession, receivePolicyPreview, updatePolicyDraft, type PolicyPreviewSessionState } from "@/lib/intlPolicyPreviewSession";
afterEach(cleanup);
const binding = { principal_partition:"p",auth_epoch:"a",saved_id:"s",saved_revision:1,source_generation:"g",instrument_mapping_identity:"m",qualification_identity:"q" };
const settings = { economy_a:"JP",economy_b:"US",lens:"nominal_policy_point_gap" as const,definition:"absolute_gap_change_bp" as const,method_version:"test",period:{mode:"fixed_dates" as const,start:"2026-08-31",end:"2026-09-30"},instrument_a_ref:null,instrument_b_ref:null,revision_policy:"latest_vintage" as const };
function state(result?: object) {
 const s=updatePolicyDraft(createPolicyPreviewSession(binding),{ok:true,settings});
 if (!result) return s;
 const b=beginPolicyPreview(s);
 return receivePolicyPreview(b.state,b.ticket!,{identity:{binding,settings},...result} as never);
}
function show(s:PolicyPreviewSessionState, extra:Record<string,unknown>={}) {
 const base = {state:s,step:"setup" as const,locale:"en" as const,question:"  exact question  ",focusEconomyLabel:"Japan",draft:{comparator:"US",mode:"fixed_dates" as const,horizonKey:"",startDate:settings.period.start,endDate:settings.period.end},comparatorOptions:[{value:"US",label:"United States"}],horizonOptions:[],fieldErrors:[],onDraftChange:vi.fn(),onPreview:vi.fn(),onBack:vi.fn()};
 return render(<IntlPolicyComparison {...base} {...extra}/>);
}
it("shows actual negative absolute-gap change as signed delta and positive narrowing magnitude",()=>{
 show(state({state:"qualified",signed_start_bp:-300,signed_end_bp:-250,signed_change_bp:50,absolute_change_bp:-50,direction:"narrowed",crosses_zero:false}));
 expect(screen.getByText("50 bp")).toBeTruthy();
 const row=screen.getByRole("row",{name:/Change in absolute gap/});
 expect(within(row).getByText("-50 bp")).toBeTruthy();
});
it("preserves the supplied localized unavailable reason instead of generic loss",()=>{
 show(state({state:"unavailable",reasons:["observation_missing"],missing_refs:["a_start"]}),{reasonLabels:{observation_missing:"The start observation has not been published."}});
 expect(screen.getByText("The start observation has not been published.")).toBeTruthy();
 expect(screen.queryByText("observation_missing")).toBeNull();
});
it("renders independently supplied baseline comparison rather than fabricated absence",()=>{
 show(state(),{baselineComparison:{status:"available",statusLabel:"Compared with your saved context",description:"The saved comparison remains available for inspection."}});
 expect(screen.getByText("The saved comparison remains available for inspection.")).toBeTruthy();
 expect(screen.queryByText("UNAVAILABLE FOR THIS SETUP")).toBeNull();
});
it("associates period-mode owner error and focuses a mode control",()=>{
 const s=updatePolicyDraft(state(),{ok:false,errors:[{field:"period_mode",code:"owner_mode_error"}]});
 show(s,{fieldErrors:[{field:"period_mode",message:"Choose an observation mode."}]});
 const group=screen.getByRole("group",{name:"Observation window"});
 expect(group.getAttribute("aria-invalid")).toBe("true");
 const id=group.getAttribute("aria-describedby");
 expect(id).toBeTruthy(); expect(document.getElementById(id!)?.textContent).toBe("Choose an observation mode.");
 fireEvent.click(screen.getByText("Update preview"));
 expect(document.activeElement).toBe(screen.getByRole("button",{name:"Rolling horizon"}));
});
it("retains an escape action when the review snapshot is invalidated",()=>{
 const onBack=vi.fn(); show(state(),{step:"review",onBack});
 fireEvent.click(screen.getByRole("button",{name:"Back to preview · Keep draft"}));
 expect(onBack).toHaveBeenCalledOnce();
});
it("does not assert a USD preference that the owner never supplied",()=>{
 show(state()); expect(screen.queryByText(/USD preference/)).toBeNull();
});

it("unknown reason codes colliding with Object prototype stay explicitly unavailable",()=>{
 show(state({state:"unavailable",reasons:["toString","__proto__","constructor"],missing_refs:[]}));
 expect(screen.getAllByText("Additional reason unavailable.")).toHaveLength(3);
});
it("finite supported preview values never format as Infinity",()=>{
 show(state({state:"qualified",signed_start_bp:1e308,signed_end_bp:1e308,signed_change_bp:0,absolute_change_bp:0,direction:"unchanged_at_endpoints",crosses_zero:false}));
 expect(screen.queryAllByText(/Infinity/)).toHaveLength(0);
 expect(screen.getAllByText("+1e+308 bp")).toHaveLength(2);
});
