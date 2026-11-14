import type { LiquidityView } from "@/lib/shared-shell/macroWorkspacePayload";

/** Original synthetic presentation specimen. No captured market payload or
 * observation is used. Repeated digest characters are test identities, not
 * evidence of a producer publication. The real Macro API has separate contract
 * tests against its incumbent composer and served-root reader. */
export function liquidityFixture() {
  const pair = (en:string,zh:string) => ({en,zh});
  const absent = {label:pair("Not published","未发布")};
  const artifact = {path:"macrodata/workspaces/liquidity_regime/US/latest.json",manifest_path:"macrodata/workspaces/manifest.json",sha256:"8".repeat(64),bytes:12000,min_client_contract:"1.0.0"};
  const unit = pair("Points on a 0–100 scale","0–100 量表点数");
  const view:LiquidityView = {
    ok:true,decision_first:true,workspace:{id:"liquidity_regime",title:pair("Liquidity Regime","流动性状态"),subtitle:pair("Funding conditions and balance-sheet support.","融资条件与资产负债表支持。")},region:{code:"US",supported:true},
    context:{state:"CURRENT",state_label:pair("Current source reading","当前来源读数"),worst_freshness_token:"CURRENT",worst_freshness:pair("Current","当前"),required:[
      {component_id:"nfci",label:pair("Financial conditions","金融条件"),source_asof:"2026-11-06",presence:pair("Published","已发布"),freshness:pair("Current","当前")},
      {component_id:"liquidity",label:pair("Liquidity","流动性"),source_asof:"2026-11-12",presence:pair("Published","已发布"),freshness:pair("Current","当前")},
    ]},
    headline:{state_id:"D",state_label:pair("Tight funding / Weak support","融资偏紧 / 支持偏弱"),subtitle:null,effective_date:"2026-11-12",method_version:"synthetic-liquidity-v1",prior:{state_id:"D",effective_date:"2026-11-10"},hysteresis:{held_prior:true,note:pair("The source reports that its stability rule retained the prior state.","来源注明：稳定性规则保留了上次状态。")}},
    axes:[{axis_id:"funding_pressure",label:pair("Funding tightness","融资紧张程度"),value:"48.00",value_raw:48,value_with_unit:pair("48.00","48.00"),absence:null},{axis_id:"balance_sheet_support",label:pair("Balance-sheet support","资产负债表支持"),value:"32.00",value_raw:32,value_with_unit:pair("32.00","32.00"),absence:null}],
    changes:{comparable:true,comparability:"COMPARABLE",comparability_label:pair("Comparable","可比较"),prior_is_earlier:true,prior_effective_date:"2026-11-10",absence:null,deltas:[
      {metric_id:"funding_pressure",label:pair("Funding tightness","融资紧张程度"),prior:"49.20",current:"48.00",delta:"−1.20",prior_raw:49.2,current_raw:48,delta_raw:-1.2,prior_present:true,current_present:true,delta_present:true,comparable:true,is_movement:true,absence:null},
      {metric_id:"balance_sheet_support",label:pair("Balance-sheet support","资产负债表支持"),prior:"32.00",current:"32.00",delta:"0.00",prior_raw:32,current_raw:32,delta_raw:0,prior_present:true,current_present:true,delta_present:true,comparable:true,is_movement:true,absence:null},
    ]},metrics:[{metric_id:"funding_pressure",unit},{metric_id:"balance_sheet_support",unit}],
    drivers:[{group_id:"rate_side",title:pair("Funding conditions","融资条件"),absent:false,absence:null,rows:[
      {driver_id:"nfci",label:pair("Financial conditions","金融条件"),value:pair("−0.40","−0.40"),unit:pair("std dev","标准差"),absence:null,coverage:pair("Published","已发布"),impact:"−4.00",impact_present:true},
      {driver_id:"ofr",label:pair("Systemic stress","系统性压力"),value:null,unit:pair("std dev","标准差"),absence:absent,coverage:pair("Not published","未发布"),impact:null,impact_present:false},
    ]},{group_id:"balance_sheet",title:pair("Balance-sheet support","资产负债表支持"),absent:false,absence:null,rows:[
      {driver_id:"momentum",label:pair("Liquidity momentum","流动性动量"),value:pair("−120.00","−120.00"),unit:pair("USD bn","十亿美元"),absence:null,coverage:pair("Published","已发布"),impact:"−6.00",impact_present:true},
      {driver_id:"buffer",label:pair("Reserve-buffer change","缓冲变化"),value:pair("0.00","0.00"),unit:pair("USD bn","十亿美元"),absence:null,coverage:pair("Published","已发布"),impact:"0.00",impact_present:true},
    ]}],
    implications:{entries:[{implication_id:"synthetic-context",text:pair("Funding and support are published as separate dimensions.","融资与支持分别作为独立维度发布。"),evidence_label:pair("Source context","来源背景"),evidence_claim:pair("Descriptive reading","描述性读数")}],absent:false,absence_text:pair("No implication published.","来源未发布解读。")},
    series:{absent:true,absence:{label:pair("Insufficient published history","已发布历史不足")}},
    evidence:{generation:{generation_id:"synthetic-liquidity-20261112",content_sha256:artifact.sha256,calculation_as_of:"2026-11-12"},artifact:{...artifact},authority:{class:"context_only",statement:pair("Display-only context; no ranking, sizing or execution authority.","仅供展示的背景信息；不能排名、定仓位或执行交易。"),flags:Array.from({length:5},()=>({value:false as const}))}},
  };
  return {schema:"mastermind.macro_command_workspace_read.v1",source:{served_root_qualified:true as const,manifest_generated_at:"2026-11-12T22:00:00Z",manifest_sha256:"9".repeat(64),composed_at:"2026-11-13T12:00:00Z",min_client_contract:"1.0.0"},selected_workspace:{workspace_id:"liquidity_regime" as const,region:"US" as const,state:"ready" as const,generation_id:view.evidence.generation.generation_id,artifact,view,failure:null}};
}
