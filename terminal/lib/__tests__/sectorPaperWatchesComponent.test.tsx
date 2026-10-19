// @vitest-environment jsdom
import React,{act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import PaperSectorWatches from "@/components/sector-intelligence/PaperSectorWatches";
import type {AccountIdentity} from "../accountIdentity";
(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLDivElement,root:Root;
const account=(id:string):AccountIdentity=>({kind:"account",userId:id,email:"same-display@example.test"});
const lists=(id:string,symbols:string[]=[])=>({lists:[{id,name:id,position:0,symbols:symbols.map((symbol,position)=>({symbol,section:"",position}))}],sharedWithMe:[{id:"read-only",name:"Shared",position:0,symbols:[]}]});
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
const render=async(identity:AccountIdentity,refreshEpoch=0)=>act(async()=>root.render(<PaperSectorWatches identity={identity} lang="en" sector={{id:"xle",ticker:"XLE",name:"Energy"}} sectors={[{id:"xle",ticker:"XLE",name:"Energy"}]} refreshEpoch={refreshEpoch} onInspect={vi.fn()}/>));
beforeEach(()=>{host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
describe("My watches retains the canonical account boundary",()=>{
 it("hides the old account before the new inventory arrives and never keys ownership on email",async()=>{
  let finishB:(value:Response)=>void=()=>{};
  const next=new Promise<Response>(resolve=>{finishB=resolve;});
  const fetcher=vi.fn().mockResolvedValueOnce(reply(lists("owner-A",["SECRET-A"]))).mockReturnValueOnce(next);
  vi.stubGlobal("fetch",fetcher);
  await render(account("A"));expect(host.textContent).toContain("SECRET-A");
  await render(account("B"));expect(host.textContent).not.toContain("SECRET-A");expect(host.textContent).toContain("Loading your lists");
  await act(async()=>finishB(reply(lists("owner-B",["VISIBLE-B"]))));
  expect(host.textContent).toContain("VISIBLE-B");expect(host.textContent).not.toContain("owner-A");
  expect(host.textContent).not.toContain("Shared");
 });
 it("ignores a delayed response after its owner is gone",async()=>{
  let finishA:(value:Response)=>void=()=>{};
  const delayed=new Promise<Response>(resolve=>{finishA=resolve;});
  vi.stubGlobal("fetch",vi.fn().mockReturnValueOnce(delayed).mockResolvedValueOnce(reply(lists("owner-B",["VISIBLE-B"]))));
  await render(account("A"));await render(account("B"));
  await act(async()=>finishA(reply(lists("owner-A",["SECRET-A"]))));
  expect(host.textContent).toContain("VISIBLE-B");expect(host.textContent).not.toContain("SECRET-A");
 });
 it("removes cached rows after denied refresh and makes no account read for a guest",async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(reply(lists("owner-A",["SECRET-A"]))).mockResolvedValueOnce(reply({error:"unauthenticated"},401));
  vi.stubGlobal("fetch",fetcher);await render(account("A"));await render(account("A"),1);
  expect(host.textContent).not.toContain("SECRET-A");expect(host.textContent).toContain("Sign in to read saved lists");
  await render({kind:"guest"});expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it("reconciles a lost write reply without retrying the mutation or claiming confirmed success",async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(reply(lists("owned-list")))
    .mockRejectedValueOnce(new Error("reply lost")).mockResolvedValueOnce(reply(lists("owned-list",["XLE"])));
  vi.stubGlobal("fetch",fetcher);await render(account("A"));
  const add=host.querySelector<HTMLButtonElement>('[aria-label="Watch XLE in owned-list"]')!;
  await act(async()=>add.click());
  const writes=fetcher.mock.calls.filter(call=>(call[1] as RequestInit)?.method==="POST");
  expect(writes).toHaveLength(1);
  expect(JSON.parse((writes[0][1] as RequestInit).body as string)).toEqual({action:"add",listId:"owned-list",symbols:["XLE"]});
  expect(host.textContent).toContain("The save was not confirmed");
  expect(host.textContent).not.toContain("Save confirmed.");
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Watch XLE in owned-list"]')!.disabled).toBe(true);
 });
});
