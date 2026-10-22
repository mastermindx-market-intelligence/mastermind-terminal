// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import SearchModal from "@/components/SearchModal";
import { LangProvider } from "@/lib/i18n";
vi.mock("@/components/onboarding/OnboardingProvider",()=>({useOnboarding:()=>({open:vi.fn()})}));
vi.mock("@/lib/useMediaQuery",()=>({useIsPhone:()=>false}));
vi.mock("@/lib/searchTrack",()=>({trackSearch:vi.fn()}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const manifest={BABA:{name:"Alibaba",col:"#aaa",verdict:"SELL",mkt:"NYSE",sec:"Equities"},"9988.HK":{name:"Alibaba",col:"#aaa",verdict:"BUY",mkt:"HKEX",sec:"Equities"},TEST:{name:"Alibaba unknown venue",col:"#aaa",verdict:null,sec:"Equities"},"BTC-USD":{name:"Alibaba token",col:"#aaa",verdict:null,mkt:"Crypto",sec:"Crypto"},"EURUSD=X":{name:"Alibaba FX",col:"#aaa",verdict:null,mkt:"US",sec:"Forex"},UNKNOWN:{name:"Alibaba unknown asset",col:"#aaa",verdict:null},QQQ:{name:"Alibaba ETF",col:"#aaa",verdict:null,sec:"Equities"},SPY:{name:"Alibaba fund",col:"#aaa",verdict:null,mkt:"US",sec:"Funds"}};
let root:Root,host:HTMLDivElement;
beforeEach(()=>{host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
async function render(onPick:(s:string)=>void,open=true){await act(async()=>root.render(<LangProvider><SearchModal open={open} seed="Alibaba" mode="pick" companyScope manifest={manifest} inWatchlist={new Set()} onClose={()=>{}} onPick={onPick}/></LangProvider>));}
it("distinguishes supported listings by exact symbol and source venue without a trade signal badge",async()=>{
 const onPick=vi.fn();await render(onPick);
 const rows=Array.from(host.querySelectorAll(".sres .r"));
 const hk=rows.find(row=>row.querySelector(".tk")?.textContent==="9988.HK");
 expect(hk?.textContent).toContain("HKEX");
 expect(rows.find(row=>row.querySelector(".tk")?.textContent==="BABA")?.textContent).toContain("NYSE");
 expect(rows.find(row=>row.querySelector(".tk")?.textContent==="TEST")?.textContent).toContain("Venue unavailable");
 expect(host.querySelector(".verd")).toBeNull();
 expect(rows.some(row=>row.querySelector(".tk")?.textContent==="BTC-USD")).toBe(false);
 expect(rows.some(row=>row.querySelector(".tk")?.textContent==="EURUSD=X")).toBe(false);
 expect(rows.some(row=>row.querySelector(".tk")?.textContent==="SPY")).toBe(false);
 expect(rows.some(row=>row.querySelector(".tk")?.textContent==="QQQ")).toBe(false);
 expect(rows.some(row=>row.querySelector(".tk")?.textContent==="UNKNOWN")).toBe(false);
 expect(Array.from(host.querySelectorAll('[role="tab"]')).some(tab=>tab.textContent?.includes("Crypto"))).toBe(false);
 await act(async()=>{(hk as HTMLElement).click();});
 expect(onPick).toHaveBeenCalledWith("9988.HK");
});
it("keeps hook order when the same picker is closed and reopened",async()=>{
 await render(vi.fn());await render(vi.fn(),false);await render(vi.fn());
 expect(host.querySelector("[role=combobox]")).not.toBeNull();
});

it("names and contains the company dialog and restores its opener after Escape from a tab",async()=>{
 const opener=document.createElement("button");opener.textContent="Search companies trigger";document.body.append(opener);opener.focus();
 const close=vi.fn();
 await act(async()=>root.render(<LangProvider><SearchModal open seed="Alibaba" mode="pick" companyScope manifest={manifest} inWatchlist={new Set()} onPick={()=>{}} onClose={close}/></LangProvider>));
 const dialog=host.querySelector('[role="dialog"]') as HTMLElement;
 expect(dialog.getAttribute("aria-modal")).toBe("true");
 expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent).toBe("Search companies");
 const input=dialog.querySelector("input")!;expect(document.activeElement).toBe(input);
 // jsdom has no layout, so expose the same visible focus targets as the browser.
 for(const element of dialog.querySelectorAll<HTMLElement>("button,input,[tabindex]")) Object.defineProperty(element,"offsetParent",{configurable:true,get:()=>dialog});
 const items=Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]),input,[tabindex]:not([tabindex="-1"])'));
 const tail=items.at(-1)!;tail.focus();
 const tab=new KeyboardEvent("keydown",{key:"Tab",bubbles:true,cancelable:true});await act(async()=>tail.dispatchEvent(tab));
 expect(tab.defaultPrevented).toBe(true);expect(dialog.contains(document.activeElement)).toBe(true);
 const scopeTab=dialog.querySelector('[role="tab"]') as HTMLElement;scopeTab.focus();
 await act(async()=>scopeTab.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true})));
 expect(close).toHaveBeenCalledTimes(1);
 await act(async()=>root.render(<LangProvider><SearchModal open={false} seed="" manifest={manifest} inWatchlist={new Set()} onPick={()=>{}} onClose={close}/></LangProvider>));
 expect(document.activeElement).toBe(opener);opener.remove();
});
