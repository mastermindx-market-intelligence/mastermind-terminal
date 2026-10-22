/** @vitest-environment jsdom */
import {act, createElement} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import MonitorWorkspace from '@/components/workspaces/MonitorWorkspace';
const state = vi.hoisted(() => ({open: vi.fn(), getUser: vi.fn(), unsubscribe: vi.fn()}));
const owner = '6ed52847-3cbe-49d2-b54d-33d39ef482cf';
vi.mock('@/components/chrome/AppShell', () => ({useShellIdentity: () => ({kind:'account',userId:'6ed52847-3cbe-49d2-b54d-33d39ef482cf',email:'fixture@example.invalid'})}));
vi.mock('@/lib/i18n', () => ({useLang: () => ({lang:'en'})}));
vi.mock('@/components/onboarding/OnboardingProvider', () => ({useOnboarding: () => ({open: state.open})}));
vi.mock('@/lib/supabase/client', () => ({createClient: () => ({auth: {
  getUser: state.getUser,
  onAuthStateChange: () => ({data:{subscription:{unsubscribe:state.unsubscribe}}}),
}})}));
vi.mock('next/link', () => ({default: ({children, ...props}: React.AnchorHTMLAttributes<HTMLAnchorElement>) => createElement('a', props, children)}));
let root: Root | null;
let host: HTMLDivElement;
let baselineStatus: number;
const reads: {url:string; signal:AbortSignal | null | undefined; finish:(response:Response)=>void}[] = [];
const list = (name: string) => ({lists:[{id:'owned',name,position:0,symbols:[{symbol:'AAPL',section:'Watchlist',position:0}]}]});
const alerts = (symbol: string) => ({alerts:[{id:'alert',symbol,active:true,created_at:'2026-10-20T12:00:00Z',condition:{type:'price',op:'above',value:180}}]});
const response = (value:unknown, status=200) => new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
const text = () => host.textContent ?? '';
async function click(label: string) {await act(async () => {Array.from(host.querySelectorAll('button')).find(button => button.textContent===label)?.click();});}
async function finish(index: number, body: unknown) {await act(async () => {reads[index].finish(response(body));});}
beforeEach(async () => {
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  reads.length=0;baselineStatus=401;state.open.mockReset();state.getUser.mockReset();state.unsubscribe.mockReset();
  vi.stubGlobal('fetch', vi.fn((url: RequestInfo | URL, init?:RequestInit) => {
    if (String(url).startsWith('/api/investigations/baseline')) return Promise.resolve(response({},baselineStatus));
    return new Promise<Response>(finish => reads.push({url:String(url),signal:init?.signal,finish}));
  }));
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  await act(async () => {root!.render(createElement(MonitorWorkspace));});
});
afterEach(async () => {await act(async () => {root?.unmount();});root=null;host.remove();vi.unstubAllGlobals();(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=false;});

describe('Monitor authoritative session failure composed with real helper and owner verifier', () => {
  it('closes all private rows and held reads on event401, then requires verified same-UUID and fresh inventory', async () => {
    await finish(0,list('PRIVATE-OLD-LIST'));
    expect(text()).toContain('PRIVATE-OLD-LIST'); expect(reads).toHaveLength(2);
    await click('Check event evidence');
    expect(host.querySelector('[data-monitor-session="ended"]')).not.toBeNull();
    expect(text()).not.toContain('PRIVATE-OLD-LIST');expect(text()).not.toContain('AAPL');
    expect(host.querySelector('a[href^="/analysis?"]')).toBeNull();expect(reads[1].signal?.aborted).toBe(true);
    await finish(1,alerts('PRIVATE-LATE-ALERT'));expect(text()).not.toContain('PRIVATE-LATE-ALERT');
    await click('Sign in');expect(state.open).toHaveBeenCalledWith('signin');expect(reads).toHaveLength(2);
    // An SDK/user response for another owner cannot revive server-prop A's private scope.
    state.getUser.mockResolvedValueOnce({data:{user:{id:'another-account'}},error:null});
    await click('Verify account and reload');expect(text()).toContain('could not be verified');expect(reads).toHaveLength(2);
    let verify!: (value:unknown)=>void;
    state.getUser.mockReturnValueOnce(new Promise(resolve => {verify=resolve;}));
    await click('Verify account and reload');expect(text()).toContain('Verifying the current account');expect(reads).toHaveLength(2);
    await act(async () => {verify({data:{user:{id:owner}},error:null});});
    expect(reads).toHaveLength(4);expect(text()).not.toContain('PRIVATE-OLD-LIST');expect(text()).not.toContain('PRIVATE-LATE-ALERT');
    await finish(2,list('FRESH-VERIFIED-LIST'));await finish(3,alerts('FRESH-VERIFIED-ALERT'));
    expect(text()).toContain('FRESH-VERIFIED-LIST');expect(text()).toContain('FRESH-VERIFIED-ALERT');
    expect(text()).not.toContain('PRIVATE-LATE-ALERT');expect(text()).toContain('Choose “Check event evidence”');
    expect(host.querySelector('a[href*="ci_event="]')).toBeNull();expect(state.getUser).toHaveBeenCalledTimes(2);
  });
  it('keeps an event rights denial local without treating it as a session failure', async () => {
    baselineStatus=403;await finish(0,list('OWNED-LIST'));await finish(1,alerts('SAVED-ALERT'));
    await click('Check event evidence');
    expect(text()).toContain('OWNED-LIST');expect(text()).toContain('SAVED-ALERT');
    expect(text()).toContain('restricted under current access');expect(host.querySelector('[data-monitor-session]')).toBeNull();
    expect(state.getUser).not.toHaveBeenCalled();expect(host.querySelector('a[href*="ci_event="]')).toBeNull();
  });
});
