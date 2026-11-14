// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import SharedShellMarketSelect from "@/components/chrome/shared-shell/SharedShellMarketSelect";

const context=vi.hoisted(()=>({path:"/portfolio",lang:"en" as "en"|"zh",push:vi.fn()}));
vi.mock("next/navigation",()=>({usePathname:()=>context.path,useSearchParams:()=>new URLSearchParams(window.location.search),useRouter:()=>({push:context.push})}));
vi.mock("@/lib/i18n",()=>({useLang:()=>({lang:context.lang})}));
vi.mock("@/lib/sharedShellCopy",async original=>{
 const actual=await original<typeof import("@/lib/sharedShellCopy")>();
 return {...actual,useSharedShellT:()=>(key:string)=>actual.SHARED_SHELL_COPY[key](context.lang)};
});
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root,host:HTMLDivElement;
beforeEach(()=>{
 context.path="/portfolio";context.lang="en";context.push.mockClear();
 window.history.replaceState({__NA:true,_N:true,shellSearch:{href:"/portfolio"}},"","/portfolio?workspaceMarket=us&sector=XLK&sectorReturn=source%2Bpin&filter=second%2Frecord#holdings");
 host=document.createElement("div");document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();});
async function render(){await act(async()=>root.render(<SharedShellMarketSelect/>));}
async function choose(value:string){const select=host.querySelector("select")!;await act(async()=>{select.value=value;select.dispatchEvent(new Event("change",{bubbles:true}));});}

it("changes only Portfolio research context with a fresh entry and the existing location notification",async()=>{
 await render();const before=new URL(window.location.href),push=vi.spyOn(window.history,"pushState"),events:string[]=[];
 const onLocation=()=>events.push(window.location.href);window.addEventListener("mmx:shell-location",onLocation);
 try{
  await choose("hk");
  expect(context.push).not.toHaveBeenCalled();expect(push).toHaveBeenCalledTimes(1);
  const after=new URL(window.location.href);expect(after.searchParams.get("workspaceMarket")).toBe("hk");
  before.searchParams.delete("workspaceMarket");after.searchParams.delete("workspaceMarket");expect(after.href).toBe(before.href);
  expect(push.mock.calls[0][0]).toEqual({});expect(events).toEqual([window.location.href]);
  // These are source-entry-specific markers. Next owns copying its own internal tree.
  expect(window.history.state).toEqual({});
 }finally{window.removeEventListener("mmx:shell-location",onLocation);}
});

it("does not push an identical Portfolio context or publish a duplicate location event",async()=>{
 await render();const push=vi.spyOn(window.history,"pushState"),event=vi.fn();window.addEventListener("mmx:shell-location",event);
 try{await choose("us");expect(push).not.toHaveBeenCalled();expect(context.push).not.toHaveBeenCalled();expect(event).not.toHaveBeenCalled();}
 finally{window.removeEventListener("mmx:shell-location",event);}
});

it.each(["workspaceMarket=us&workspaceMarket=hk","workspaceMarket=us&workspaceMarket=us"])("repairs ambiguous context %s rather than treating the first duplicate as selected",async ambiguous=>{
 window.history.replaceState({},"",`/portfolio?${ambiguous}&filter=second%2Frecord#holdings`);
 await render();const push=vi.spyOn(window.history,"pushState");await choose("us");
 expect(push).toHaveBeenCalledTimes(1);expect(context.push).not.toHaveBeenCalled();
 expect(window.location.search).toBe("?filter=second%2Frecord&workspaceMarket=us");
 expect(window.location.hash).toBe("#holdings");
});

it("does not apply the Portfolio shortcut from a stale rendered path after another route became live",async()=>{
 await render();window.history.replaceState({},"","/china_stocks.html?view=board#leaders");
 const push=vi.spyOn(window.history,"pushState");await choose("hk");
 expect(push).not.toHaveBeenCalled();expect(context.push).toHaveBeenCalledWith("/hk_stocks.html?view=board");
});

it.each([
 ["/sectors","/sectors?workspaceMarket=us&sectorJob=explore&sector=XLK#sources","cn","/sectors?sectorJob=explore&workspaceMarket=cn"],
 ["/china_stocks.html","/china_stocks.html?view=board","hk","/hk_stocks.html?view=board"],
 ["/china.html","/china.html?workspaceMarket=us","us","/macro.html"],
])("retains router navigation for %s",async(path,href,market,expected)=>{
 context.path=path;window.history.replaceState({},"",href);await render();const push=vi.spyOn(window.history,"pushState");
 await choose(market);expect(context.push).toHaveBeenCalledWith(expected);expect(push).not.toHaveBeenCalled();
});

it.each(["en","zh"] as const)("describes the personal scope in %s without claiming book availability",async lang=>{
 context.lang=lang;await render();const select=host.querySelector("select")!;
 expect(select.getAttribute("aria-label")).toBe(lang==="zh"?"工作区市场":"Workspace market");
 const description=document.getElementById(select.getAttribute("aria-describedby")||"");
 expect(description?.textContent).toBe(lang==="zh"?"研究市场。投资组合保留全部持仓及其已记录币种。":"Research market. Your portfolio keeps all holdings and their recorded currencies.");
 expect(select.title).toBe(description?.textContent);
 context.path="/research";await render();expect(host.querySelector("select")?.hasAttribute("aria-describedby")).toBe(false);
});
