/** @vitest-environment jsdom */
import {act, createElement} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import MonitorWorkspace from '@/components/workspaces/MonitorWorkspace';
const state = vi.hoisted(() => ({
  open:vi.fn(), getUser:vi.fn(), unsubscribe:vi.fn(),
  listener:null as null | ((event:string,session:{user:{id:string}}|null)=>void),
}));
const owner = '6ed52847-3cbe-49d2-b54d-33d39ef482cf';
vi.mock('@/components/chrome/AppShell', () => ({useShellIdentity: () => ({kind:'account',userId:'6ed52847-3cbe-49d2-b54d-33d39ef482cf',email:'fixture@example.invalid'})}));
vi.mock('@/lib/i18n', () => ({useLang: () => ({lang:'en'})}));
vi.mock('@/components/onboarding/OnboardingProvider', () => ({useOnboarding: () => ({open:state.open})}));
vi.mock('@/lib/supabase/client', () => ({createClient: () => ({auth:{
  getUser:state.getUser,
  onAuthStateChange:(listener:typeof state.listener) => {state.listener=listener;return {data:{subscription:{unsubscribe:state.unsubscribe}}};},
}})}));
vi.mock('next/link', () => ({default:({children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>) => createElement('a',props,children)}));
let root:Root|null;
let host:HTMLDivElement;
let baselineStatus:number;
const reads:{url:string;signal:AbortSignal|null|undefined;finish:(response:Response)=>void}[]=[];
const list=(name:string)=>({lists:[{id:'owned',name,position:0,symbols:[{symbol:'AAPL',section:'Watchlist',position:0}]}]});
const alerts=(symbol:string)=>({alerts:[{id:'alert',symbol,active:true,created_at:'2026-10-20T12:00:00Z',condition:{type:'price',op:'above',value:180}}]});
const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
const text=()=>host.textContent??'';
async function flush(){for(let i=0;i<4;i++)await act(async()=>{await Promise.resolve();});}
async function mount(){await act(async()=>{root!.render(createElement(MonitorWorkspace));});await flush();}
async function click(label:string){await act(async()=>{Array.from(host.querySelectorAll('button')).find(button=>button.textContent===label)?.click();});await flush();}
async function finish(index:number,body:unknown,status=200){await act(async()=>{reads[index].finish(response(body,status));});await flush();}
beforeEach(()=>{
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  reads.length=0;baselineStatus=401;state.listener=null;state.open.mockReset();state.getUser.mockReset();state.unsubscribe.mockReset();
  state.getUser.mockResolvedValue({data:{user:{id:owner}},error:null});
  vi.stubGlobal('fetch',vi.fn((url:RequestInfo|URL,init?:RequestInit)=>{
    if(String(url).startsWith('/api/investigations/baseline'))return Promise.resolve(response({},baselineStatus));
    return new Promise<Response>(finish=>reads.push({url:String(url),signal:init?.signal,finish}));
  }));
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>{root?.unmount();});root=null;host.remove();vi.unstubAllGlobals();(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=false;});

describe('Monitor verified owner lifetime',()=>{
  it('makes no inventory read when the browser account differs from the server owner',async()=>{
    state.getUser.mockResolvedValue({data:{user:{id:'another-account'}},error:null});
    await mount();expect(reads).toHaveLength(0);expect(text()).toContain('could not be verified');
    expect(host.querySelector('[data-monitor-session="ended"]')).not.toBeNull();
  });
  it.each(['SIGNED_OUT','SIGNED_IN'])('clears ready rows and fences held reads on %s',async event=>{
    await mount();await finish(0,list('PRIVATE-OLD-LIST'));expect(text()).toContain('PRIVATE-OLD-LIST');
    await act(async()=>state.listener!(event,event==='SIGNED_OUT'?null:{user:{id:'another-account'}}));await flush();
    expect(text()).not.toContain('PRIVATE-OLD-LIST');expect(reads[1].signal?.aborted).toBe(true);
    await finish(1,alerts('PRIVATE-LATE-ALERT'));expect(text()).not.toContain('PRIVATE-LATE-ALERT');
    expect(host.querySelector('[data-monitor-session="ended"]')).not.toBeNull();
  });
  it.each([0,1])('inventory401 at branch %s invalidates both private branches',async failing=>{
    await mount();const other=1-failing;
    await finish(other,other===0?list('PRIVATE-LIST'):alerts('PRIVATE-ALERT'));
    expect(text()).toContain(other===0?'PRIVATE-LIST':'PRIVATE-ALERT');
    await finish(failing,{},401);
    expect(text()).not.toContain('PRIVATE-LIST');expect(text()).not.toContain('PRIVATE-ALERT');
    expect(text()).toContain('session ended');expect(host.querySelector('a[href^="/analysis?"]')).toBeNull();
  });
  it('keeps inventory403 local to the restricted source',async()=>{
    await mount();await finish(0,list('OWNED-LIST'));await finish(1,{},403);
    expect(text()).toContain('OWNED-LIST');expect(text()).toContain('Saved alert conditions are restricted');
    expect(host.querySelector('[data-monitor-session]')).toBeNull();
  });
  it('keeps identity-service failure distinct from logout and rechecks before any inventory read',async()=>{
    state.getUser.mockResolvedValueOnce({data:{user:null},error:Error('offline')});await mount();
    expect(reads).toHaveLength(0);expect(text()).toContain('account service is unavailable');expect(text()).not.toContain('session ended');
    await click('Verify account and reload');expect(reads).toHaveLength(2);
  });
  it('closes all private rows on event401 and requires same-owner verification and fresh inventory',async()=>{
    await mount();await finish(0,list('PRIVATE-OLD-LIST'));
    await click('Check event evidence');
    expect(host.querySelector('[data-monitor-session="ended"]')).not.toBeNull();
    expect(text()).not.toContain('PRIVATE-OLD-LIST');expect(reads[1].signal?.aborted).toBe(true);
    await finish(1,alerts('PRIVATE-LATE-ALERT'));expect(text()).not.toContain('PRIVATE-LATE-ALERT');
    await click('Sign in');expect(state.open).toHaveBeenCalledWith('signin');expect(reads).toHaveLength(2);
    state.getUser.mockResolvedValueOnce({data:{user:{id:'another-account'}},error:null});
    await click('Verify account and reload');expect(text()).toContain('could not be verified');expect(reads).toHaveLength(2);
    let verify!:(value:unknown)=>void;
    state.getUser.mockReturnValueOnce(new Promise(resolve=>{verify=resolve;}));
    await click('Verify account and reload');expect(text()).toContain('Verifying the current account');expect(reads).toHaveLength(2);
    await act(async()=>{verify({data:{user:{id:owner}},error:null});});await flush();
    expect(reads).toHaveLength(4);expect(text()).not.toContain('PRIVATE-OLD-LIST');
    await finish(2,list('FRESH-VERIFIED-LIST'));await finish(3,alerts('FRESH-VERIFIED-ALERT'));
    expect(text()).toContain('FRESH-VERIFIED-LIST');expect(text()).toContain('FRESH-VERIFIED-ALERT');
    expect(text()).not.toContain('PRIVATE-LATE-ALERT');expect(text()).toContain('Choose “Check event evidence”');
    expect(host.querySelector('a[href*="ci_event="]')).toBeNull();expect(state.getUser).toHaveBeenCalledTimes(3);
  });
  it('keeps an event403 local without invalidating authorized inventory',async()=>{
    baselineStatus=403;await mount();await finish(0,list('OWNED-LIST'));await finish(1,alerts('SAVED-ALERT'));
    await click('Check event evidence');
    expect(text()).toContain('OWNED-LIST');expect(text()).toContain('SAVED-ALERT');
    expect(text()).toContain('restricted under current access');expect(host.querySelector('[data-monitor-session]')).toBeNull();
    expect(state.getUser).toHaveBeenCalledTimes(1);expect(host.querySelector('a[href*="ci_event="]')).toBeNull();
  });
});
