// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SharedShellToolbar from "@/components/chrome/shared-shell/SharedShellToolbar";
import AnalysisWorkspace from "@/components/workspaces/AnalysisWorkspace";
import { LangProvider } from "@/lib/i18n";

const state = vi.hoisted(()=>({query:new URLSearchParams(),push:vi.fn(),fund:vi.fn(),bars:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({push:state.push}),usePathname:()=>"/analysis",useSearchParams:()=>state.query}));
vi.mock("next/link",()=>({default:({children,href,className}:{children:React.ReactNode;href:string;className?:string})=><a href={href} className={className}>{children}</a>}));
vi.mock("@/components/chrome/shared-shell/SharedShellPresentation",()=>({useOptionalSharedShellPresentation:()=>({context:{locale:"en",theme:"dark"}})}));
vi.mock("@/components/fin/MegaPane",()=>({FIN_PAGES:["overview","intelligence","earnings"],default:({sym,page,fund,onClose}:{sym:string;page:string;fund:{ticker:string}|null;onClose:()=>void})=><section data-company={sym} data-local-view={page} data-fund-ticker={fund?.ticker??""}><button onClick={onClose}>chart</button></section>}));
vi.mock("@/components/chrome/shared-shell/ShellSearch",()=>({default:()=>null}));
vi.mock("@/components/chrome/shared-shell/SharedShellPresentationControls",()=>({default:()=>null}));
vi.mock("@/components/SymbolPicker",()=>({default:()=>null}));
vi.mock("@/lib/fund",()=>({getFund:(symbol:string)=>state.fund(symbol),getBars:(symbol:string)=>state.bars(symbol)}));
vi.mock("@/lib/dataCache",()=>({getJSON:()=>Promise.resolve(null)}));
vi.mock("@/lib/activeSymbol",()=>({readActiveSymbol:()=>null,writeActiveSymbol:vi.fn(),useActiveSymbol:()=>"NVDA"}));
vi.mock("@/lib/shellBrainSymbol",()=>({announceShellBrainSymbol:vi.fn()}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root,host:HTMLDivElement;
function location(query:string){state.query=new URLSearchParams(query);window.history.replaceState({},"","/analysis?"+query);}
async function render(){await act(async()=>root.render(<LangProvider><SharedShellToolbar symbolOpen={false} onSymbolOpenChange={()=>{}} onOpenDirectory={()=>{}}/><AnalysisWorkspace initialSymbol="NVDA" initialPage="intelligence"/></LangProvider>));}
beforeEach(()=>{state.push.mockReset();state.fund.mockReset();state.bars.mockResolvedValue([]);vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({quotes:{}})})));host=document.createElement("div");document.body.append(host);root=createRoot(host);location("symbol=NVDA&page=intelligence");});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
describe("reused Company route identity",()=>{
 it("clears malformed selection when navigation removes the symbol",async()=>{
  state.fund.mockImplementation((symbol:string)=>Promise.resolve({ticker:symbol}));
  location("symbol=BAD%2FIDENTITY");await render();
  expect(host.textContent).toContain("not a supported symbol format");
  expect(host.querySelector(".analysis-context-back")).toBeNull();
  expect(host.querySelector(".shared-shell-terminal-link")).toBeNull();
  location("");await render();
  expect(host.textContent).not.toContain("not a supported symbol format");
  expect(host.querySelector("[data-company]")?.getAttribute("data-company")).toBe("NVDA");
 });
 it("follows same-path search and ignores the delayed previous company result",async()=>{
  let oldResolve!:(result:{ticker:string})=>void;
  state.fund.mockImplementation((symbol:string)=>symbol==="NVDA"?new Promise(resolve=>{oldResolve=resolve;}):Promise.resolve({ticker:symbol}));
  await render();
  location("symbol=AAPL&page=earnings");await render();
  expect(host.querySelector("[data-company]")?.getAttribute("data-company")).toBe("AAPL");
  expect(host.querySelector("[data-local-view]")?.getAttribute("data-local-view")).toBe("earnings");
  const toolbarChart=new URL(host.querySelector(".shared-shell-terminal-link")!.getAttribute("href")!,window.location.href);
  expect(toolbarChart.searchParams.get("symbol")).toBe("AAPL");
  expect(toolbarChart.searchParams.get("ret")).toBe(window.location.href);
  await act(async()=>oldResolve({ticker:"NVDA"}));
  expect(host.querySelector("[data-fund-ticker]")?.getAttribute("data-fund-ticker")).toBe("AAPL");
  location("symbol=NVDA&page=intelligence");state.fund.mockResolvedValue({ticker:"NVDA"});await render();
  expect(host.querySelector("[data-company]")?.getAttribute("data-company")).toBe("NVDA");
 });
 it("carries the supported investigation URL when opening the current chart",async()=>{
  state.fund.mockResolvedValue({ticker:"NVDA"});
  location("symbol=NVDA&page=intelligence&ci_event=event-1&ci_lens=results");await render();
  await act(async()=>(host.querySelector("[data-company] button") as HTMLButtonElement).click());
  const chart=new URL(state.push.mock.calls.at(-1)![0],window.location.href);
  expect(chart.searchParams.get("symbol")).toBe("NVDA");
  expect(chart.searchParams.get("ret")).toBe(window.location.href);
 });
});
