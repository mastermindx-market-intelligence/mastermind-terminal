// @vitest-environment jsdom
// Diagnostic only: rendered production SettingsPanel; no source mutation or network writes.
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
async function renderOwner(id:string){
 await act(async()=>root.render(<LangProvider><SettingsPanel visible openSeq={1} section="accuracy" onSection={()=>{}} onClose={()=>{}} identity={accountIdentity(id,'same@example.com')} user={{id,email:'same@example.com'} as never} onPatchMeta={()=>{}} onRefreshUser={async()=>{}} devPlan={{tier:'free',status:'none'}} /></LangProvider>));
}
async function answerFirst(url:string,body:unknown,status=200){
 const request=requests.find(r=>r.url===url);expect(request).toBeTruthy();
 await act(async()=>request!.resolve(response(body,status)));
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
