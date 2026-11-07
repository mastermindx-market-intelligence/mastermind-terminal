// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ShellSearch from "@/components/chrome/shared-shell/ShellSearch";
import { LangProvider } from "@/lib/i18n";
vi.mock("next/navigation",()=>({useRouter:()=>({push:vi.fn()})}));
vi.mock("@/lib/activeSymbol",()=>({useActiveSymbol:()=>"NVDA",writeActiveSymbol:vi.fn()}));
vi.mock("@/lib/sharedShellCopy",()=>({useSharedShellT:()=>((key:string)=>key)}));
vi.mock("@/components/chrome/AppShell",()=>({useShellIdentity:()=>({})}));
vi.mock("@/lib/useMarketPrefs",async()=>{const {DEFAULT_PREFS}=await import("@/lib/markets");return {useMarketPrefs:()=>({prefs:DEFAULT_PREFS,ready:true,enableAll:vi.fn()})};});
vi.mock("@/lib/dataCache",()=>({getJSONResult:vi.fn(async()=>({status:"data",data:{symbols:{AAPL:{name:"Apple",col:"#aaa",verdict:null,mkt:"US",sec:"Equities"}}}}))}));
vi.mock("@/components/onboarding/OnboardingProvider",()=>({useOnboarding:()=>({open:vi.fn()})}));
vi.mock("@/lib/useMediaQuery",()=>({useIsPhone:()=>false,useIsMobile:()=>false}));
vi.mock("@/lib/searchTrack",()=>({trackSearch:vi.fn()}));
// Resolve only the framework chunk seam; both picker and dialog remain real.
vi.mock("next/dynamic",async()=>{const {default:SearchModal}=await import("@/components/SearchModal");return {default:()=>SearchModal};});
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root,host:HTMLDivElement;
function Harness(){const [open,setOpen]=useState(false);return <LangProvider><button data-external="" onClick={()=>setOpen(true)}>Open companies</button><ShellSearch open={open} onOpenChange={setOpen}/></LangProvider>;}
beforeEach(async()=>{host=document.createElement("div");document.body.append(host);root=createRoot(host);await act(async()=>root.render(<Harness/>));});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
async function escape(){const dialog=document.body.querySelector<HTMLElement>('[role="dialog"]')!;await act(async()=>dialog.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true})));}
it.each(["Escape", "close button"])("restores a live search trigger after cold keyboard activation and %s",async(closeMode)=>{
 const placeholder=host.querySelector<HTMLButtonElement>(".shared-shell-company-search")!;placeholder.focus();
 await act(async()=>placeholder.click());
 const dialog=document.body.querySelector('[role="dialog"]')!;expect(dialog).not.toBeNull();expect(host.contains(dialog)).toBe(false);
 if(closeMode === "Escape") await escape();
 else await act(async()=>document.body.querySelector<HTMLButtonElement>('[aria-label="Close search"]')!.click());
 const trigger=host.querySelector<HTMLButtonElement>(".shared-shell-company-search")!;
 expect(trigger).not.toBe(placeholder);expect(trigger.isConnected).toBe(true);
 expect(document.activeElement).toBe(trigger);
});
it("restores a real external opener after programmatic cold open",async()=>{
 const opener=host.querySelector<HTMLButtonElement>("[data-external]")!;opener.focus();await act(async()=>opener.click());
 expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();await escape();expect(document.activeElement).toBe(opener);
});
