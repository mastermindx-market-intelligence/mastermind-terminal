import fs from'node:fs/promises';import path from'node:path';import{fileURLToPath}from'node:url';const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..'),owner='11111111-1111-4111-8111-111111111111';
const SUNDAY='2026-11-01T12:00:00Z',MONDAY='2026-11-02T15:30:00Z';
const pair=(en,zh)=>({en,zh});
const chip=(id,section,label,value,as_of,as_of_display,note=null)=>({id,section,label,tone:'neutral',null:value===null,value,cause:value===null?'see_curve':null,note,meaning:null,as_of,as_of_display});
// One reading per freshness kind (the same on both clocks): Friday close = current, Thursday = 1 session behind,
// the live 16 October strip = 10 sessions old, and a reading without a clock carries no age line
// (its clock line already says the source date is unavailable).
const mixedStrip=[
 chip('liquidity','liquidity',pair('Liquidity','流动性'),pair('Mixed','不均衡'),'2026-10-30',pair('30 Oct 2026','2026年10月30日')),
 chip('credit','credit',pair('Credit spreads','信用利差'),pair('Tight','偏紧'),'2026-10-29',pair('29 Oct 2026','2026年10月29日'),pair('High yield near cycle lows','高收益利差接近周期低位')),
 chip('dollar','dollar',pair('Dollar','美元'),pair('Firm','偏强'),'2026-10-16',pair('16 Oct 2026','2026年10月16日')),
 chip('curve','curve',pair('Curve','曲线'),null,null,null),
];
// A reading dated four days ahead of the clock is a producer clock error and says so.
const aheadStrip=[...mixedStrip.slice(0,3),chip('rates','curve',pair('Rates','利率'),pair('Steady','平稳'),'2026-11-05',pair('5 Nov 2026','2026年11月5日'))];
const staleStrip=mixedStrip.slice(0,3).map(c=>({...c,as_of:'2026-10-16',as_of_display:pair('16 Oct 2026','2026年10月16日')}));
const briefing=(strip)=>{const dated=strip.map(x=>x.as_of).filter(Boolean),asOf=dated.length?[...dated].sort()[0]:null;return({schema:'mastermind.macro_command_read.v1',state:'partial',source:{served_root_qualified:true,manifest_generated_at:'2026-10-30T10:00:00Z',manifest_sha256:'d'.repeat(64),composed_at:'2026-10-31T07:00:00Z'},read:{as_of:asOf,as_of_display:asOf==='2026-10-16'?pair('16 October 2026','2026年10月16日'):pair('29 October 2026','2026年10月29日'),as_of_meaning:dated.every(d=>d===asOf)?pair(`All ${dated.length} dated readings in the strip below share this date.`,`下方 ${dated.length} 项有日期读数均为此日期。`):pair(`Oldest date among the ${dated.length} dated readings in the strip below; each reading shows its own date.`,`取下方 ${dated.length} 项有日期读数中最早的一项；各读数标注各自日期。`),clauses:[{topic:pair('Liquidity','流动性'),predicate:pair('is mixed','不均衡'),punct:pair('.','。'),section:'liquidity'}],omitted:true},strip,coverage:{available:3,total:4},sections:['liquidity','credit','dollar','curve'].map(id=>({id,label:pair(id,id),href:`/macro_monetary.html#${id}`})),workspaces:[]});};
// /api/market-breadth answers: the proxy's projection of a live.breadth.v1 file built five minutes before the
// Monday clock (fixture numbers); the producer's session_closed verdict, which the proxy sends without numbers;
// Friday's post-session answer arriving on Sunday, which the cell re-checks and withholds as source behind;
// and the proxy's 503.
const usable={schema:'mmx.market_breadth.v1',asof:'2026-11-02T15:25:00Z',built_at:'2026-11-02T15:25:00Z',source_age_min:0,session:'rth',delay_min:15,usable:true,unusable_reason:null,coverage_pct:99.2,large:{n:503,adv_pct:44.31,pa200:60.37},comp:{n:1503,adv_pct:42.8,pa200:55.0}};
const withheld={...usable,asof:'2026-10-30T22:59:11Z',built_at:'2026-10-30T22:59:11Z',session:'closed',usable:false,unusable_reason:'session_closed',large:null,comp:null};
const agedOut={...usable,asof:'2026-10-30T22:59:11Z',built_at:'2026-10-30T22:59:11Z',session:'post'};
const catalog={available:true,items:[{id:'report-one',title:'Fixture source report: semiconductor demand',institution:'Fixture research desk',published_at:'2026-10-29',summary_points:['Fixture summary retained from the catalog boundary.']}],preview:false,stale:false,generated_at:'2026-10-31T06:00:00Z'};
const golden=JSON.parse(await fs.readFile(path.join(project,'lib/__tests__/fixtures/aapl-event-workspace.json'),'utf8'));const retained={ok:true,workspace:golden,receipt:{schema:'earnings.retained_baseline.v1',owner:'earnings.workspace_generation',company_id:golden.issuer.company_id,event_id:golden.event_id,generation_id:golden.generation_id,workspace_schema:golden.schema,manifest_schema:'event_workspace_manifest.v1',authority:'context_only',manifest_sha256:'a'.repeat(64),manifest_bytes:2048,workspace_sha256:'b'.repeat(64),workspace_bytes:4096,fingerprint:'c'.repeat(64),public_known_at:golden.lifecycle.source_available_at,platform_known_at:golden.lifecycle.observed_at,generation_emitted_at:'2026-10-21T12:00:00Z',rights:{allowed:true,policy_version:'fixture-retained-context.v1',checked_at:'2026-10-21T12:00:00Z'}}};
const lists={lists:[{id:'owned-list',name:'Fixture saved research',position:0,symbols:[{symbol:'AAPL',section:'us_equities',position:0}]}]};
const MODES={
 mixed:{clock:MONDAY,today:briefing(mixedStrip,'2026-10-29'),breadth:[200,usable],kinds:['current','behind','stale','current'],breadthState:'live',readKind:'stale'},
 stale:{clock:SUNDAY,today:briefing(staleStrip,'2026-10-16'),breadth:[200,withheld],kinds:['stale','stale','stale'],breadthState:'withheld',reason:'withheld',readKind:'stale'},
 aged:{clock:SUNDAY,today:briefing(aheadStrip,'2026-10-29'),breadth:[200,agedOut],kinds:['current','behind','stale','ahead'],breadthState:'withheld',reason:'sourceBehind',readKind:'stale'},
 unavailable:{clock:SUNDAY,today:briefing(mixedStrip,'2026-10-29'),breadth:[503,{error:'breadth_unavailable'}],kinds:['current','behind','stale'],breadthState:null,readKind:'stale'},
};
for(const since of ['paid','first','quiet','portfolioUnavailable','empty'])MODES[since]={...MODES.mixed,since};

export{MODES,catalog,lists,retained,owner};
