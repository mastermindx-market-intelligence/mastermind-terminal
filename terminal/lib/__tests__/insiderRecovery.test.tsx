// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,Root} from 'react-dom/client';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import InsiderPage from '@/components/fin/InsiderPage';
import {getJSONResult,invalidate} from '@/lib/dataCache';
vi.mock('@/components/fin/FinCharts',()=>({ComboChart:(p:any)=><div data-chart={JSON.stringify({labels:p.labels,bars:p.bars,line:p.line})}/>}));
vi.mock('@/components/ui/ArcGauge',()=>({ArcGauge:(p:any)=><div data-gauge={JSON.stringify(p)}/>}));
vi.mock('@/components/fin/ForecastPage',()=>({Disclaimer:()=><div data-disclaimer/>}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLDivElement,root:Root,sym:string;let seq=0;
const quiet=()=>({asof:'2026-06-30',score:50,signal:'NEUTRAL',confidence:'None',routine_only:true,buyers:0,sellers:0,net_usd:0,window_days:548,series:[],trades:[]});
const populated=()=>({...quiet(),score:70,signal:'BUY',confidence:'High',routine_only:false,buyers:3,net_usd:3000,series:[{month:'2026-09',buy_usd:3000,sell_usd:0}],trades:[{date:'2026-09-30',title:'CEO',side:'buy',shares:30,price:100,usd:3000}]});
const response=(data:any,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
const settle=async()=>act(async()=>{for(let i=0;i<12;i++)await Promise.resolve()});
const mount=async(zh=false,ticker=sym)=>{await act(async()=>root.render(<InsiderPage sym={ticker} zh={zh}/>));await settle()};
const button=()=>host.querySelector('button');
const retry=async()=>{expect(button()).not.toBeNull();await act(async()=>button()!.click());await settle()};
const unavailable=(zh=false)=>{expect(host.querySelector('[role="alert"]')).not.toBeNull();expect(host.textContent).toContain(zh?'暂时无法加载内部交易数据':'Insider data unavailable');expect(host.textContent).not.toContain('No open-market Form 4 buys or sells have been filed');expect(button()?.textContent).toBe(zh?'重试':'Retry')};
beforeEach(()=>{sym='TEST'+(++seq);invalidate();vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));host=document.createElement('div');document.body.append(host);root=createRoot(host)});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();invalidate();vi.useRealTimers();vi.unstubAllGlobals()});
describe.each([false,true])('Insider recovery zh=%s',zh=>{
 for(const kind of ['network','503','429','403','malformed','null']){
  it('does not describe '+kind+' as a no-filings fact',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>{if(kind==='network')throw Error('offline');if(kind==='malformed')return {ok:true,status:200,json:async()=>{throw Error('bad json')}};return response(null,kind==='null'?200:Number(kind))}));await mount(zh);unavailable(zh)});
 }
 it('retries an unavailable read successfully without reload',async()=>{const f=vi.fn().mockResolvedValueOnce(response(null,503)).mockResolvedValueOnce(response(populated()));vi.stubGlobal('fetch',f);await mount(zh);await retry();expect(f).toHaveBeenCalledTimes(2);expect(host.querySelector('table')).not.toBeNull();expect(host.querySelector('[role="alert"]')).toBeNull()});
 it('offers another retry after repeated failure',async()=>{const f=vi.fn().mockResolvedValueOnce(response(null,503)).mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce(response(quiet()));vi.stubGlobal('fetch',f);await mount(zh);await retry();unavailable(zh);await retry();expect(f).toHaveBeenCalledTimes(3);expect(host.querySelector('[role="alert"]')).toBeNull();expect(host.querySelector('[data-gauge]')).not.toBeNull()});
 it('removes retry while its read is pending',async()=>{let resolve!:(x:any)=>void;const pending=new Promise(r=>resolve=r);const f=vi.fn().mockResolvedValueOnce(response(null,503)).mockReturnValueOnce(pending);vi.stubGlobal('fetch',f);await mount(zh);await retry();expect(button()).toBeNull();expect(host.textContent).toContain(zh?'正在加载':'Loading insider');await act(async()=>resolve(response(quiet())));await settle();expect(f).toHaveBeenCalledTimes(2);expect(host.querySelector('[data-gauge]')).not.toBeNull()});
 it('does not negative-cache a failed read when reopening the tab',async()=>{const f=vi.fn().mockResolvedValueOnce(response(null,503)).mockResolvedValueOnce(response(quiet()));vi.stubGlobal('fetch',f);await mount(zh);await act(async()=>root.render(<div/>));await mount(zh);expect(f).toHaveBeenCalledTimes(2);expect(host.querySelector('[data-gauge]')).not.toBeNull()});
 for(const status of [404,410]){
  it('preserves confirmed '+status+' absence and cache',async()=>{const f=vi.fn(async()=>response(null,status));vi.stubGlobal('fetch',f);await mount(zh);expect(host.textContent).toContain(zh?'暂无内部交易数据':'No insider data');expect(button()).toBeNull();expect(host.querySelector('[role="alert"]')).toBeNull();await act(async()=>root.render(<div/>));await mount(zh);expect(f).toHaveBeenCalledTimes(1)});
 }
 for(const [name,data] of [['quiet',quiet],['populated',populated]] as const){
  it('preserves '+name+' content exactly',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>response(data())));await mount(zh);expect(host.querySelector('[data-gauge]')).not.toBeNull();expect(host.querySelector('[role="alert"]')).toBeNull();expect(host.querySelector('table')!==null).toBe(name==='populated')});
 }
 it('keeps foreign-listing confirmed-absence copy',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>response(null,404)));await mount(zh,'0700.HK');expect(host.textContent).toContain(zh?'美国以外上市':'listed outside the US');expect(button()).toBeNull()});
 it('does not let old success replace a newer ticker failure',async()=>{let resolve!:(x:any)=>void;vi.stubGlobal('fetch',vi.fn().mockReturnValueOnce(new Promise(r=>resolve=r)).mockResolvedValueOnce(response(null,503)));await mount(zh);await mount(zh,sym+'B');unavailable(zh);await act(async()=>resolve(response(populated())));await settle();unavailable(zh);expect(host.querySelector('table')).toBeNull()});
 it('does not let old failure replace a newer ticker success',async()=>{let resolve!:(x:any)=>void;vi.stubGlobal('fetch',vi.fn().mockReturnValueOnce(new Promise(r=>resolve=r)).mockResolvedValueOnce(response(populated())));await mount(zh);await mount(zh,sym+'B');await act(async()=>resolve(response(null,503)));await settle();expect(host.querySelector('table')).not.toBeNull();expect(host.querySelector('[role="alert"]')).toBeNull()});
 it('retains cached last-good content if background refresh fails',async()=>{const f=vi.fn().mockResolvedValueOnce(response(populated())).mockResolvedValueOnce(response(null,503));vi.stubGlobal('fetch',f);await getJSONResult('/data/'+sym+'.insider.json');vi.advanceTimersByTime(61_000);await mount(zh);expect(host.querySelector('table')).not.toBeNull();expect(host.querySelector('[role="alert"]')).toBeNull();expect(f).toHaveBeenCalledTimes(2)});
 it('ignores a pending read after unmount',async()=>{let resolve!:(x:any)=>void;vi.stubGlobal('fetch',vi.fn(()=>new Promise(r=>resolve=r)));await mount(zh);await act(async()=>root.render(<div data-away/>));await act(async()=>resolve(response(populated())));await settle();expect(host.querySelector('[data-away]')).not.toBeNull();expect(host.querySelector('table')).toBeNull()});
});
