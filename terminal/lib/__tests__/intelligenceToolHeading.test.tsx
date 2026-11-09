// @vitest-environment jsdom
import React,{act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const state=vi.hoisted(()=>({phase:"ready" as "ready"|"checking"|"ended"|"unavailable",loaded:true,lang:"en" as "en"|"zh"}));
vi.mock("@/lib/i18n",()=>({useLang:()=>({lang:state.lang})}));
vi.mock("@/lib/shared-shell/useReadingScope",()=>({useReadingScope:()=>({ready:state.phase==="ready",ended:state.phase==="ended",unavailable:state.phase==="unavailable",retryIdentity:vi.fn()})}));
vi.mock("@/lib/flowClientCache",()=>({flowInvalidate:vi.fn()}));
vi.mock("@/components/intelligence/IntelligenceNav",()=>({default:()=> <nav data-testid="context-nav"/>}));
vi.mock("next/link",()=>({default:({children,prefetch:_p,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>&{prefetch?:boolean})=>{void _p;return <a {...props}>{children}</a>;}}));
vi.mock("next/dynamic",()=>({default:(loader:()=>unknown,options?:{loading?:React.ComponentType})=>{
 const sector=String(loader).includes("SectorIntelligenceWorkspace");
 return function ControlledIncumbent(){
  if(!state.loaded){const Loading=options?.loading;return Loading?<Loading/>:null;}
  // The immutable current incumbent Sector owns its ready main/h1; Prophet lanes do not.
  return sector?<main id="shared-shell-content" data-testid="incumbent-sector"><h1>Sector Intelligence</h1></main>:<div data-testid="incumbent-prophet"/>;
 };
}}));
import Tool from "@/components/intelligence/IntelligenceToolWorkspace";
(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLDivElement,root:Root;
beforeEach(()=>{state.phase="ready";state.loaded=true;state.lang="en";host=document.createElement("div");document.body.appendChild(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
async function render(kind:"sectors"|"prophet"="sectors"){await act(async()=>root.render(<Tool ownerKey="unit-owner" kind={kind}/>));}
describe("one page-title owner across native tool boundaries",()=>{
 it.each(["en","zh"] as const)("%s ready sectors retains only the incumbent heading",async lang=>{
  state.lang=lang;await render();expect(host.querySelectorAll("h1")).toHaveLength(1);
  expect(host.querySelector('[data-testid="incumbent-sector"] h1')).toBeTruthy();expect(host.querySelector("header > h1")).toBeNull();
  expect(host.querySelector('[data-testid="context-nav"]')).toBeTruthy();
 });
 it.each(["checking","ended","unavailable"] as const)("%s keeps a title and never mounts the private tool",async phase=>{
  state.phase=phase;await render();expect(host.querySelectorAll("h1")).toHaveLength(1);
  expect(host.querySelector('[data-testid="incumbent-sector"]')).toBeNull();expect(host.querySelector('[data-testid="context-nav"]')).toBeTruthy();
 });
 it.each(["en","zh"] as const)("%s lazy-load fallback hands its single title to the incumbent",async lang=>{
  state.lang=lang;state.loaded=false;await render();expect(host.querySelectorAll("h1")).toHaveLength(1);
  expect(host.querySelector('main h1')?.textContent).toBe(lang==="zh"?"行业情报":"Sector Intelligence");
  state.loaded=true;await render();expect(host.querySelectorAll("h1")).toHaveLength(1);expect(host.querySelector('[data-testid="incumbent-sector"] h1')).toBeTruthy();
 });
 it("ready-to-ended removes the incumbent and restores the wrapper title",async()=>{
  await render();state.phase="ended";await render();expect(host.querySelectorAll("h1")).toHaveLength(1);
  expect(host.querySelector('[data-testid="incumbent-sector"]')).toBeNull();expect(host.querySelector('header > h1')).toBeTruthy();
 });
 it("Prophet retains its wrapper title because its incumbent lanes have none",async()=>{
  await render("prophet");expect(host.querySelectorAll("h1")).toHaveLength(1);expect(host.querySelector('[data-testid="incumbent-prophet"]')).toBeTruthy();
 });
});
