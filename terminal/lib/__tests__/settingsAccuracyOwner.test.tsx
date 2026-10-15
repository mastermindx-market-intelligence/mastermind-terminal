// @vitest-environment jsdom
// Regression: SettingsPanel owner-tags its personal-accuracy and team-membership
// reads so a settled result (or error, or team id) for one account can never be
// served to another account on the first render after an owner swap. Rendered
// production component; no source mutation and no network writes.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import SettingsPanel from '@/components/settings/SettingsPanel';
import { LangProvider } from '@/lib/i18n';
import { accountIdentity } from '@/lib/accountIdentity';
import { emptyAccuracyReadout } from '@/lib/personalAccuracy';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root, container: HTMLDivElement;
let requests: {url:string; resolve:(r:Response)=>void}[];
const response = (body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
beforeEach(()=>{
  container=document.createElement('div'); document.body.append(container); root=createRoot(container); requests=[];
  vi.stubGlobal('matchMedia',()=>({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}}));
  vi.stubGlobal('fetch',vi.fn((input:RequestInfo|URL)=>{
    const url=String(input);
    if(url==='/api/accuracy'||url==='/api/teams') return new Promise<Response>(resolve=>requests.push({url,resolve}));
    if(url.includes('/accuracy/rollup')) return Promise.resolve(response({kind:'no_rows',memberCount:19}));
    return Promise.resolve(response({tier:'free',status:'none'}));
  }));
});
afterEach(()=>{act(()=>root.unmount());container.remove();vi.unstubAllGlobals();});

async function renderOwner(id:string,openSeq=1,visible=true){
  await act(async()=>root.render(<LangProvider><SettingsPanel visible={visible} openSeq={openSeq} section="accuracy" onSection={()=>{}} onClose={()=>{}} identity={accountIdentity(id,'same@example.com')} user={{id,email:'same@example.com'} as never} onPatchMeta={()=>{}} onRefreshUser={async()=>{}} devPlan={{tier:'free',status:'none'}} /></LangProvider>));
}
async function answerFirst(url:string,body:unknown,status=200){
  const request=requests.find(r=>r.url===url);expect(request).toBeTruthy();
  await act(async()=>request!.resolve(response(body,status)));
}
async function answerAt(index:number,body:unknown,status=200){
  const request=requests[index];expect(request).toBeTruthy();
  await act(async()=>request.resolve(response(body,status)));
}
const A='8f2c41ba-7d19-4e6a-9c03-5b71ee0a4d22', B='9f2c41ba-7d19-4e6a-9c03-5b71ee0a4d23';

it('new account does not inherit previous account settled personal read while pending',async()=>{
  await renderOwner(A);await answerFirst('/api/accuracy',emptyAccuracyReadout());
  expect(document.querySelector('[data-acc-state="empty"]')).not.toBeNull();
  await renderOwner(B);expect(requests.filter(r=>r.url==='/api/accuracy')).toHaveLength(2);
  expect(document.querySelector('[data-acc-state="unread"]')).not.toBeNull();
  expect(document.querySelector('[data-acc-state="empty"]')).toBeNull();
});

it('new account does not inherit previous account personal error while pending',async()=>{
  await renderOwner(A);await answerFirst('/api/accuracy',{},503);
  expect(document.querySelector('[data-acc-state="error"]')).not.toBeNull();
  await renderOwner(B);expect(requests.filter(r=>r.url==='/api/accuracy')).toHaveLength(2);
  expect(document.querySelector('[data-acc-state="error"]')).toBeNull();
});

it('new account does not inherit old team before replacement membership read resolves',async()=>{
  await renderOwner(A);await answerFirst('/api/teams',{teams:[{id:'team-A',role:'member'}],truncated:false});
  expect(document.querySelector('[data-acc-team-state="no-rows"]')?.textContent).toContain('19');
  await renderOwner(B);expect(requests.filter(r=>r.url==='/api/teams')).toHaveLength(2);
  expect(document.querySelector('[data-acc-team-state="no-rows"]')).toBeNull();
});

it('late completion for the previous owner never reaches the new owner',async()=>{
  await renderOwner(A);                      // A's reads are left pending on purpose
  await renderOwner(B);                      // B is pending; A's in-flight reads are stale
  expect(requests.filter(r=>r.url==='/api/accuracy')).toHaveLength(2);
  await answerAt(0,emptyAccuracyReadout());  // A's personal read settles LATE, after B started
  await answerAt(1,{teams:[{id:'team-A',role:'member'}],truncated:false}); // A's membership too
  expect(document.querySelector('[data-acc-state="unread"]')).not.toBeNull();
  expect(document.querySelector('[data-acc-state="empty"]')).toBeNull();
  expect(document.querySelector('[data-acc-state="error"]')).toBeNull();
  expect(document.querySelector('[data-acc-team-state="no-rows"]')).toBeNull();
});

it('same owner keeps the settled read while the reopen revalidation is in flight',async()=>{
  await renderOwner(A);await answerFirst('/api/accuracy',emptyAccuracyReadout());
  expect(document.querySelector('[data-acc-state="empty"]')).not.toBeNull();
  await renderOwner(A,2);                    // same owner re-opens: revalidate, do not blank
  expect(requests.filter(r=>r.url==='/api/accuracy')).toHaveLength(2);
  expect(document.querySelector('[data-acc-state="empty"]')).not.toBeNull();
  await answerAt(2,{},503);                  // the replacement read fails; it — not A's data — shows
  expect(document.querySelector('[data-acc-state="error"]')).not.toBeNull();
});

// A same-team reopen must refetch the child rollup, not only membership.
it('actual close and reopen requests a fresh rollup even for the same team',async()=>{
  await renderOwner(A);
  await answerFirst('/api/teams',{teams:[{id:'team-A',role:'member'}],truncated:false});
  const rollupCalls=()=>vi.mocked(fetch).mock.calls.filter(([url])=>String(url).includes('/accuracy/rollup'));
  expect(rollupCalls()).toHaveLength(1);
  await renderOwner(A,1,false);
  await renderOwner(A,2,true);
  expect(document.querySelector('[data-acc-team-state="no-rows"]')).toBeNull();
  const membership=requests.filter(r=>r.url==='/api/teams').at(-1)!;
  await act(async()=>membership.resolve(response({teams:[{id:'team-A',role:'member'}],truncated:false})));
  expect(rollupCalls()).toHaveLength(2);
  expect(document.querySelector('[data-acc-team-state="no-rows"]')?.textContent).toContain('19');
});
