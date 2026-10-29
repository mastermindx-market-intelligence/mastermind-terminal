// @vitest-environment jsdom
import React,{act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import type {AuthLifecycleSnapshot} from "../supabase/authLifecycle";
const auth=vi.hoisted(()=>({snapshot:null as AuthLifecycleSnapshot|null,listener:null as ((s:AuthLifecycleSnapshot)=>void)|null,unsubscribe:vi.fn()}));
vi.mock("../supabase/authLifecycle",()=>({subscribeAuthLifecycle:(listener:(s:AuthLifecycleSnapshot)=>void)=>{auth.listener=listener;return{getSnapshot:()=>auth.snapshot!,unsubscribe:auth.unsubscribe};}}));
import {useOptionsPlanBoundary} from "../useOptionsPlanScope";
import {useContractShortlist} from "@/components/options/ContractShortlist";
import {draft} from "./fixtures/optionsPlanPayoff";
vi.mock("../optionsContractShortlistLex",()=>({useShortlistT:()=> (key:string)=>key,fillShortlistCopy:(key:string)=>key}));
let host:HTMLDivElement,root:Root,current:(()=>boolean)|null;
function Harness(){const scope=useOptionsPlanBoundary(),shortlist=useContractShortlist(scope.key),pin=draft().legs[0].snapshot;current=scope.isCurrent;return <><output>{scope.key}</output><span data-count>{shortlist.pins.length}</span><button onClick={()=>shortlist.toggle(pin.row,{family:pin.family,asof:pin.asofRaw,schema:pin.schema,stale:pin.sourceStale,hotView:pin.hotView},[pin.row])}>Pin</button></>;}
const snapshot=(principal:string|null,epoch:string,availability:AuthLifecycleSnapshot["availability"]="ready"):AuthLifecycleSnapshot=>({principal_partition:principal,auth_epoch:epoch,availability});
async function project(s:AuthLifecycleSnapshot){auth.snapshot=s;await act(async()=>auth.listener?.(s));}
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);auth.snapshot=snapshot(null,"pending","pending");auth.unsubscribe.mockClear();host=document.createElement("div");document.body.append(host);root=createRoot(host);current=null;});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
describe("verified Plan lifetime",()=>{
 it("clears pins for A-B-A and same-UUID/new epoch; old getter refuses before deferred projection",async()=>{
  await act(async()=>root.render(<Harness/>));await project(snapshot("a","a1"));await act(async()=>host.querySelector("button")!.click());
  expect(host.querySelector("[data-count]")?.textContent).toBe("1");const old=current!;expect(old()).toBe(true);
  auth.snapshot=snapshot("a","a2");expect(old()).toBe(false);
  await project(auth.snapshot);expect(host.querySelector("[data-count]")?.textContent).toBe("0");
  await act(async()=>host.querySelector("button")!.click());await project(snapshot("b","b1"));await project(snapshot("a","a3"));
  expect(host.querySelector("[data-count]")?.textContent).toBe("0");expect(old()).toBe(false);
 });
 it("retains an unchanged verified tuple; unverified/sign-out refuse synchronously and clear projected pins",async()=>{
  await act(async()=>root.render(<Harness/>));await project(snapshot("a","a1"));await act(async()=>host.querySelector("button")!.click());
  await project(snapshot("a","a1"));expect(host.querySelector("[data-count]")?.textContent).toBe("1");
  const old=current!;auth.snapshot=snapshot("a","a1","unverified");expect(old()).toBe(false);await project(auth.snapshot);
  expect(host.querySelector("[data-count]")?.textContent).toBe("0");await project(snapshot(null,"out","unavailable"));expect(current?.()).toBe(false);
 });
});
