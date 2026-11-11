// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ShellSearch from "@/components/chrome/shared-shell/ShellSearch";
import { COMPANY_SEARCH_HISTORY_KEY } from "@/lib/companySearchContext";
import type { SharedSearchOptions } from "@/components/SharedSearchWorkspace";
const state=vi.hoisted(()=>({push:vi.fn(),props:null as null|{searchSeed?:string;sharedSearch?:SharedSearchOptions}}));
vi.mock("next/navigation",()=>({useRouter:()=>({push:state.push})}));
vi.mock("@/lib/activeSymbol",()=>({useActiveSymbol:()=>"BABA",writeActiveSymbol:vi.fn()}));
vi.mock("@/components/SymbolPicker",()=>({default:(props:{searchSeed?:string;sharedSearch?:SharedSearchOptions})=>{state.props=props;return <section><button onClick={()=>props.sharedSearch?.onOpenTool("/tools/calculators/cagr.html","compound")}>open tool</button></section>;}}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root,host:HTMLDivElement;const opened=vi.fn();
beforeEach(()=>{state.push.mockReset();opened.mockReset();window.history.replaceState({nextRouter:"retain",other:42},"","/discover?view=tools&q=a%20b&q=a+b#current-position");host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it("returns from a finite tool to exact origin/query/scope/selection without rewriting Next history fields",async()=>{
 await act(async()=>root.render(<ShellSearch open onOpenChange={opened}/>));const origin=window.location.href;
 await act(async()=>(host.querySelector("button") as HTMLButtonElement).click());
 expect(state.push).toHaveBeenCalledWith("/tools/calculators/cagr.html");expect(window.location.href).toBe(origin);
 const previous=window.history.state;expect(previous.nextRouter).toBe("retain");expect(previous.other).toBe(42);
 expect(previous[COMPANY_SEARCH_HISTORY_KEY]).toEqual({scope:"tools",query:"compound",selected:"/tools/calculators/cagr.html",href:origin});
 window.history.replaceState(null,"","/tools/calculators/cagr.html");window.history.replaceState(previous,"",origin);
 await act(async()=>window.dispatchEvent(new PopStateEvent("popstate")));
 expect(opened).toHaveBeenLastCalledWith(true);expect(state.props?.searchSeed).toBe("compound");expect(state.props?.sharedSearch?.scope).toBe("tools");expect(state.props?.sharedSearch?.selectedTool).toBe("/tools/calculators/cagr.html");expect(window.location.href).toBe(origin);
});
it("refuses off-origin and protocol-relative destinations even at the host callback boundary",async()=>{
 await act(async()=>root.render(<ShellSearch open onOpenChange={opened}/>));const origin=window.location.href;
 await act(async()=>{state.props?.sharedSearch?.onOpenTool("https://evil.example/x","x");state.props?.sharedSearch?.onOpenTool("//evil.example/x","x");});expect(state.push).not.toHaveBeenCalled();expect(window.location.href).toBe(origin);
});
it("keeps a company-only programmatic opening distinct from a restored Tools scope",async()=>{
 const href=window.location.href;
 window.history.replaceState({...window.history.state,[COMPANY_SEARCH_HISTORY_KEY]:{scope:"tools",query:"compound",selected:"/tools/calculators/cagr.html",href}},"",href);
 await act(async()=>root.render(<ShellSearch open onOpenChange={opened}/>));
 expect(state.props?.sharedSearch?.scope).toBe("tools");
 await act(async()=>root.render(<ShellSearch open={false} onOpenChange={opened}/>));
 await act(async()=>root.render(<ShellSearch open onOpenChange={opened}/>));
 expect(state.props?.sharedSearch?.scope).toBe("companies");
 expect(state.props?.searchSeed).toBe("compound");expect(window.location.href).toBe(href);
});
