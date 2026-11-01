// @vitest-environment jsdom
// Actual component, icons, identity, scenario parser and dependencies; synthetic transport only.
// SavedScenarioRead is out-of-scope recipient rendering and stubbed null.
import React,{act} from 'react';import{createRoot,Root}from'react-dom/client';import{it,expect,vi,beforeEach,afterEach}from'vitest';
import Sharing from '@/components/settings/PinnedResearchSharing';
const handoff=vi.hoisted(()=>({listHandoffs:vi.fn(),readHandoff:vi.fn(),shareHandoff:vi.fn(),revokeHandoff:vi.fn(),isHandoffOwnerChangeError:()=>false}));
vi.mock('@/lib/researchHandoffs',()=>handoff);
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
const inv='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',owner='11111111-1111-4111-8111-111111111111';
const capture={schema:'investigation_scenario_reference.v1',model_version:'exposure-scenario/v1',inputs:{targetSpot:600,deltaSigmaPts:-1,days:0.25},source:{owner:'options_hub',root:'SPX',session:'2026-10-16',source_as_of:'2026-10-16',evaluated_at:'2026-10-16T21:14:10-04:00',lens:{kind:'one',exp:'2026-10-16'},selection_key:'2026-10-16|2026-10-16T20:00:00-04:00',basis_sha256:'a'.repeat(64),gex:{sha256:'b'.repeat(64),byte_length:4096},moves:null}};
let host:HTMLDivElement,root:Root,fetcher:any;
beforeEach(()=>{vi.clearAllMocks();host=document.createElement('div');document.body.append(host);root=createRoot(host);handoff.listHandoffs.mockImplementation(async()=>({result:{status:'listed',own:[{id:inv,revision:3,title:'Pinned A'}],sent:[],received:[],sentNextCursor:null,receivedNextCursor:null}}));});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.unstubAllGlobals()});
const response=(status:number,body:any)=>({ok:status>=200&&status<300,status,json:async()=>body});
const body=(manifest:any={})=>({status:'found',id:inv,revision:3,manifest});
const words={en:{open:'Open pinned research sharing',failed:'could not be verified',none:'This revision has no saved scenario',refresh:'Refresh'},zh:{open:'展开钉选研究共享',failed:'无法核实',none:'此修订版本没有',refresh:'刷新'}};
async function click(label:string){await act(async()=>{host.querySelector<HTMLButtonElement>('button[aria-label="'+label+'"]')!.click()});}
async function mount(lang:'en'|'zh',status:number,data:any){
 fetcher=vi.fn(async()=>response(status,data));vi.stubGlobal('fetch',fetcher);
 await act(async()=>root.render(<Sharing {...{t:(x:string)=>x,lang,identity:{kind:'account',userId:owner,email:'synthetic@example.test'}} as any}/>));
 expect(fetcher).not.toHaveBeenCalled();await click(words[lang].open);
 await act(async()=>{const e=host.querySelector('select')!;e.value=inv;e.dispatchEvent(new Event('change',{bubbles:true}))});
}
for(const lang of ['en','zh'] as const){
 for(const status of [401,404,500,503])it(lang+' HTTP '+status+' preview is unverifiable, not absent',async()=>{await mount(lang,status,{status:status===404?'not_found':'unavailable'});expect(host.textContent).toContain(words[lang].failed);expect(host.textContent).not.toContain(words[lang].none);expect(host.querySelector('input[type=checkbox]')).toBeNull();expect(handoff.shareHandoff).not.toHaveBeenCalled()});
 for(const [name,data]of [['wrong revision',{...body({scenario_capture:capture}),revision:4}],['wrong id',{...body(),id:'other'}],['missing manifest',{status:'found',id:inv,revision:3}],['wrong status',{...body(),status:'not_found'}]] as const)it(lang+' '+name+' is unverifiable',async()=>{await mount(lang,200,data);expect(host.textContent).toContain(words[lang].failed);expect(host.textContent).not.toContain(words[lang].none);expect(host.querySelector('input[type=checkbox]')).toBeNull()});
 it(lang+' successful exact empty manifest remains no reference',async()=>{await mount(lang,200,body());expect(host.textContent).toContain(words[lang].none);expect(host.textContent).not.toContain(words[lang].failed)});
 it(lang+' legacy invalid capture still excluded as none',async()=>{await mount(lang,200,body({scenario_capture:{schema:'investigation_scenario_capture.v1',basis:{}}}));expect(host.textContent).toContain(words[lang].none);expect(host.querySelector('input[type=checkbox]')).toBeNull()});
 it(lang+' exact valid capture enables deliberate unchecked opt-in',async()=>{await mount(lang,200,body({scenario_capture:capture}));const box=host.querySelector<HTMLInputElement>('input[type=checkbox]');expect(box).toBeTruthy();expect(box!.checked).toBe(false)});
 it(lang+' explicit refresh recovers failed preview without mutation',async()=>{await mount(lang,503,{status:'unavailable'});expect(host.textContent).toContain(words[lang].failed);fetcher.mockResolvedValue(response(200,body({scenario_capture:capture})));await click(words[lang].refresh);expect(host.querySelector('input[type=checkbox]')).toBeTruthy();expect(host.textContent).not.toContain(words[lang].failed);expect(handoff.shareHandoff).not.toHaveBeenCalled();expect(handoff.revokeHandoff).not.toHaveBeenCalled();expect(fetcher).toHaveBeenCalledTimes(2)});
}
