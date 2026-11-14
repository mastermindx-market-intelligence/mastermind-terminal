// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import IexDepthReplayView from "@/components/futures/IexDepthReplayView";
import fixture from "./fixtures/iexDepthReplay.synthetic.json";

const scope=vi.hoisted(()=>({search:"",shell:true,fetch:vi.fn(),owner:{kind:"account",userId:"iex-fixture-owner"}}));
vi.mock("next/navigation",()=>({usePathname:()=>"/options/equity-replay",useSearchParams:()=>new URLSearchParams(scope.search)}));
vi.mock("next/link",()=>({default:({href,children}:{href:string;children:React.ReactNode})=><a href={href}>{children}</a>}));
vi.mock("@/lib/i18n",()=>({useLang:()=>({lang:"en"}),applyLang:vi.fn()}));
vi.mock("@/components/chrome/AppShell",()=>({useShellIdentity:()=>scope.owner}));
vi.mock("@/components/chrome/shared-shell/SharedShellPresentation",()=>({useOptionalSharedShellPresentation:()=>scope.shell?{context:{locale:"en",theme:"dark"}}:null}));
vi.mock("@/lib/largeTrades/client",()=>({fetchLargeTrades:(symbol:string,signal:AbortSignal)=>scope.fetch(symbol,signal)}));
vi.mock("@/components/charts/svgChart",async original=>({...await original<typeof import("@/components/charts/svgChart")>(),useChartWidth:()=>640}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root,host:HTMLDivElement;
beforeEach(()=>{
 scope.shell=true;scope.fetch.mockReset().mockImplementation(async symbol=>symbol==="SPY"
  ?{state:"ready",envelope:fixture,artifactSha256:"a".repeat(64),servedAtNs:fixture.provenance.generatedAtNs}
  :{state:"unavailable",reason:"feed_not_admitted"});
 window.history.replaceState({},"","/options/equity-replay?symbol=SPY&workspaceMarket=hk#source");scope.search=window.location.search;
 host=document.createElement("div");document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();});
async function render(){scope.search=window.location.search;await act(async()=>root.render(<IexDepthReplayView initialSymbol="SPY"/>));}
async function choose(symbol:string){await act(async()=>{
 const select=host.querySelector<HTMLSelectElement>('select[aria-label="Symbol"]')!;select.value=symbol;select.dispatchEvent(new Event("change",{bubbles:true}));
 });await render();}
async function move(href:string){window.history.replaceState({},"",href);await act(async()=>window.dispatchEvent(new PopStateEvent("popstate")));await render();}
function chart(){return [...host.querySelectorAll<HTMLAnchorElement>("a")].find(a=>a.textContent==="Price chart");}
function chartUrl(){expect(chart()).toBeDefined();return new URL(chart()!.href);}

it("links the selected IEX instrument and exact shell return, independently of research market",async()=>{
 await render();const url=chartUrl();expect(url.pathname).toBe("/terminal");expect(url.searchParams.get("symbol")).toBe("SPY");
 expect(url.searchParams.get("ret")).toBe(window.location.href);expect(scope.fetch).toHaveBeenCalledTimes(1);
 expect(scope.fetch.mock.calls[0][0]).toBe("SPY");expect(host.textContent).toContain("IEX venue only");
});

it("preserves market/hash on a real symbol choice and retires unavailable-symbol values",async()=>{
 await render();await choose("QQQ");const url=new URL(window.location.href);
 expect(url.searchParams.get("symbol")).toBe("QQQ");expect(url.searchParams.get("workspaceMarket")).toBe("hk");expect(url.hash).toBe("#source");
 expect(scope.fetch.mock.calls.map(call=>call[0])).toEqual(["SPY","QQQ"]);
 expect(host.querySelector('[data-testid="iex-executed-total"]')).toBeNull();expect(host.querySelector('[data-testid="iex-depth-unavailable"]')).not.toBeNull();
 expect(chartUrl().searchParams.get("symbol")).toBe("QQQ");expect(chartUrl().searchParams.get("ret")).toBe(window.location.href);
});

it("takes the restored URL symbol on history traversal instead of the original prop or last local choice",async()=>{
 await render();await choose("QQQ");await move("/options/equity-replay?symbol=SPY&workspaceMarket=us#source");
 expect(host.querySelector<HTMLSelectElement>('select[aria-label="Symbol"]')!.value).toBe("SPY");
 expect(scope.fetch.mock.calls.map(call=>call[0])).toEqual(["SPY","QQQ","SPY"]);
 expect(host.querySelector('[data-testid="iex-executed-total"]')?.textContent).toBe("60");
 expect(chartUrl().searchParams.get("symbol")).toBe("SPY");expect(chartUrl().searchParams.get("ret")).toBe(window.location.href);
});

it("changes only return context without restarting the exact source request",async()=>{
 await render();const source=host.querySelector('[data-testid="iex-depth-source"]');
 await move("/options/equity-replay?symbol=SPY&workspaceMarket=ca#source");
 expect(scope.fetch).toHaveBeenCalledTimes(1);expect(host.querySelector('[data-testid="iex-depth-source"]')).toBe(source);
 expect(chartUrl().searchParams.get("ret")).toBe(window.location.href);
});

it("uses the route's NVDA default when the symbol is removed, without reviving the SPY prop",async()=>{
 await render();await move("/options/equity-replay?workspaceMarket=hk");
 expect(scope.fetch.mock.calls.at(-1)?.[0]).toBe("NVDA");expect(chartUrl().searchParams.get("symbol")).toBe("NVDA");
});

it.each(["symbol=SPY&symbol=SPY","symbol=../SPY","symbol=spy","symbol=SPY&workspaceMarket=crypto","symbol=SPY&source=other"])("refuses a changed invalid browser query %s without a substitute source",async search=>{
 await render();const count=scope.fetch.mock.calls.length;await move("/options/equity-replay?"+search);
 expect(scope.fetch).toHaveBeenCalledTimes(count);expect(host.querySelector('[data-testid="iex-depth-source"]')).toBeNull();expect(chart()).toBeUndefined();
});

it("ordinary Terminal retains a symbol-specific chart link without inventing a beta return",async()=>{
 scope.shell=false;await render();const url=chartUrl();expect(url.searchParams.get("sym")).toBe("SPY");expect(url.searchParams.has("ret")).toBe(false);
});

it("retires an earlier accepted archive across SPY→QQQ→SPY until the restored source read succeeds",async()=>{
 const ready={state:"ready",envelope:fixture,artifactSha256:"a".repeat(64),servedAtNs:fixture.provenance.generatedAtNs};
 let releaseQQQ!:(value:unknown)=>void,releaseSPY!:(value:unknown)=>void,spyReads=0;
 scope.fetch.mockImplementation((symbol:string)=>{
  if(symbol==="QQQ")return new Promise(resolve=>{releaseQQQ=resolve;});
  if(++spyReads===1)return Promise.resolve(ready);
  return new Promise(resolve=>{releaseSPY=resolve;});
 });
 await render();expect(host.querySelector('[data-testid="iex-depth-source"]')).not.toBeNull();
 await choose("QQQ");const qqqSignal=scope.fetch.mock.calls[1][1] as AbortSignal;
 await move("/options/equity-replay?symbol=SPY&workspaceMarket=us");
 expect(qqqSignal.aborted).toBe(true);expect(host.querySelector('[data-testid="iex-depth-source"]')).toBeNull();
 expect(host.textContent).toContain("Reading the published archive");
 await act(async()=>releaseQQQ({state:"unavailable",reason:"feed_not_admitted"}));
 expect(host.textContent).toContain("Reading the published archive");
 await act(async()=>releaseSPY({state:"denied",reason:"access_denied"}));
 expect(host.querySelector('[data-testid="iex-depth-source"]')).toBeNull();
 expect(host.querySelector('[data-testid="iex-depth-unavailable"]')).not.toBeNull();
});

it("keeps the selected observation for a market-only change and resets it for a new symbol visit",async()=>{
 await render();const slider=host.querySelector<HTMLInputElement>('input[type="range"]')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(slider,"0");slider.dispatchEvent(new Event("input",{bubbles:true}));});
 expect(host.querySelector('[data-testid="iex-executed-total"]')?.textContent).toBe("50");
 await move("/options/equity-replay?symbol=SPY&workspaceMarket=ca#source");
 expect(scope.fetch).toHaveBeenCalledTimes(1);expect(slider.value).toBe("0");
 await choose("QQQ");await move("/options/equity-replay?symbol=SPY&workspaceMarket=hk#source");
 expect(host.querySelector<HTMLInputElement>('input[type="range"]')!.value).toBe("4");
 expect(host.querySelector('[data-testid="iex-executed-total"]')?.textContent).toBe("60");
});
