// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SettingsPanel from '@/components/settings/SettingsPanel';
import { LangProvider } from '@/lib/i18n';
import { accountIdentity } from '@/lib/accountIdentity';
import { emptyAccuracyReadout } from '@/lib/personalAccuracy';
const observed = vi.hoisted(() => [] as { readout: unknown; loadErr: boolean; teamId: unknown }[]);
vi.mock('@/components/settings/SectionAccuracy', () => ({ default: (props: { readout: unknown; loadErr: boolean; teamId: unknown }) => {
 observed.push({ readout: props.readout, loadErr: props.loadErr, teamId: props.teamId }); return null;
} }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, container: HTMLDivElement;
let pending: { url: string; resolve: (r: Response) => void }[];
const A='8f2c41ba-7d19-4e6a-9c03-5b71ee0a4d22', B='9f2c41ba-7d19-4e6a-9c03-5b71ee0a4d23';
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
beforeEach(()=>{
 pending=[]; observed.length=0; container=document.createElement('div');document.body.append(container);root=createRoot(container);
 vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener(){},removeEventListener(){}}));
 vi.stubGlobal('fetch',vi.fn((input:RequestInfo|URL)=>{
  const url=String(input);if(url==='/api/accuracy'||url==='/api/teams')return new Promise<Response>(resolve=>pending.push({url,resolve}));
  return Promise.resolve(response({tier:'free',status:'none'}));
 }));
});
afterEach(()=>{act(()=>root.unmount());container.remove();vi.unstubAllGlobals();});
async function render(id:string,email='same@example.com',seq=1,visible=true){
 observed.length=0;
 await act(async()=>root.render(<LangProvider><SettingsPanel visible={visible} openSeq={seq} section="accuracy" onSection={()=>{}} onClose={()=>{}} identity={accountIdentity(id,email)} user={null} onPatchMeta={()=>{}} onRefreshUser={async()=>{}} devPlan={{tier:'free',status:'none'}} /></LangProvider>));
 return [...observed];
}
async function settle(index:number,body:unknown,status=200){await act(async()=>pending[index].resolve(response(body,status)));}
it.each([200,503])('masks personal state and team on first B render (status %i)',async status=>{
 await render(A);await settle(0,emptyAccuracyReadout(),status);await settle(1,{teams:[{id:'team-A',role:'member'}],truncated:false});
 const frames=await render(B);expect(frames.length).toBeGreaterThan(0);
 for(const frame of frames)expect(frame).toEqual({readout:null,loadErr:false,teamId:undefined});
});
it('masks previous team on first guest render without another account request',async()=>{
 await render(A);await settle(0,emptyAccuracyReadout());await settle(1,{teams:[{id:'team-A',role:'member'}],truncated:false});
 const n=pending.length;const frames=await render('');
 for(const frame of frames)expect(frame).toEqual({readout:null,loadErr:false,teamId:undefined});expect(pending).toHaveLength(n);
});
it('ignores late A failure and membership after B settles',async()=>{
 await render(A);await render(B);const value=emptyAccuracyReadout();await settle(2,value);await settle(3,{teams:[{id:'team-B',role:'member'}],truncated:false});
 await settle(0,{},503);await settle(1,{teams:[{id:'team-A',role:'member'}],truncated:false});
 expect(observed.at(-1)).toEqual({readout:value,loadErr:false,teamId:'team-B'});
});
it('preserves same-UUID data through email change and revalidates on reopen',async()=>{
 const value=emptyAccuracyReadout();await render(A);await settle(0,value);await settle(1,{teams:[],truncated:false});
 const frames=await render(A,'changed@example.com');expect(pending).toHaveLength(2);expect(frames[0]).toEqual({readout:value,loadErr:false,teamId:null});
 const reopened=await render(A,'changed@example.com',2);expect(pending).toHaveLength(4);expect(reopened[0]).toEqual({readout:value,loadErr:false,teamId:null});
});
it('preserves membership invalidation across an actual close and reopen',async()=>{
 const value=emptyAccuracyReadout();await render(A);await settle(0,value);await settle(1,{teams:[{id:'team-A',role:'member'}],truncated:false});
 await render(A,'same@example.com',1,false);
 const frames=await render(A,'same@example.com',2,true);
 expect(pending).toHaveLength(4);
 for(const frame of frames)expect(frame).toEqual({readout:value,loadErr:false,teamId:undefined});
 await settle(3,{teams:[],truncated:false});
 expect(observed.at(-1)).toEqual({readout:value,loadErr:false,teamId:null});
});
