// @vitest-environment jsdom
import React,{act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const state=vi.hoisted(()=>({path:"/intelligence",query:"",lang:"en" as "en"|"zh"}));
vi.mock("@/lib/i18n",()=>({useLang:()=>({lang:state.lang}),useT:()=>((key:string,fallback?:string)=>fallback??key)}));
vi.mock("next/navigation",()=>({usePathname:()=>state.path,useSearchParams:()=>new URLSearchParams(state.query)}));
vi.mock("next/link",()=>({default:({children,prefetch:_p,onClick,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>&{prefetch?:boolean})=>{
 void _p;return <a {...props} onClick={event=>{event.preventDefault();onClick?.(event);}}>{children}</a>;
}}));
vi.mock("@/components/ui/Tip",()=>({Tip:({children}:{children:React.ReactNode})=>children}));
import Primary from "@/components/intelligence/SharedShellPrimaryNav";
import {INTELLIGENCE_DESTINATIONS} from "@/lib/shared-shell/intelligenceNavigation";
(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLDivElement,root:Root;
beforeEach(()=>{state.path="/intelligence";state.query="";state.lang="en";host=document.createElement("div");document.body.appendChild(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
async function mount(mode:"rail"|"drawer"="rail",onNavigate?:()=>void){
 await act(async()=>root.render(<Primary mode={mode} labelled activeSymbol="MU" renderGlyph={key=><svg data-test-glyph={key}/>} onNavigate={onNavigate}/>));
}
describe("one intelligence navigation owner with incumbent company/context links",()=>{
 it.each([["rail","en"],["rail","zh"],["drawer","en"],["drawer","zh"]] as const)("%s %s preserves every canonical destination and current company",async(mode,lang)=>{
  state.lang=lang;await mount(mode);const nav=host.querySelector(`[data-intelligence-nav="${mode}"]`)!;
  for(const item of INTELLIGENCE_DESTINATIONS){const a=nav.querySelector(`a[href="${item.href}"]`)!;expect(a.textContent).toBe(item.label[lang==="zh"?1:0]);expect(a.getAttribute("aria-label")).toBe(item.label[lang==="zh"?1:0]);}
  expect(host.querySelector('a[href="/analysis?symbol=MU"]')).toBeTruthy();
  expect(host.querySelector('a[href="/research"]')).toBeTruthy();expect(host.querySelector('a[href="/portfolio"]')).toBeTruthy();
 });
 // The complete Prophet opportunity workspace remains the owner's legacy destination;
 // the native plan/options desk links to it and is explicitly entered from the overview.
 it.each([["/intelligence","","/intelligence"],["/prophet","","/us_stocks.html"],["/sectors","sector=xlk","/sectors"],
  ["/options","tab=prophet","/us_stocks.html"],["/discover","tab=sectors&sector=xlk","/sectors"],
  ["/sector_cycles.html","","/sector_cycles.html"],["/macro_monetary.html","","/macro.html"]])("selects exact existing context %s %s",async(path,query,href)=>{
  state.path=path;state.query=query;await mount();const selected=host.querySelectorAll('a[aria-current]');
  expect(selected).toHaveLength(1);expect(selected[0].getAttribute("href")).toBe(href);
 });
 it("preserves nested ordinary workspace location and drawer close",async()=>{
  state.path="/research/reading";const close=vi.fn();await mount("drawer",close);
  const link=host.querySelector('a[href="/research"]')!;expect(link.getAttribute("aria-current")).toBe("location");
  await act(async()=>link.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true})));expect(close).toHaveBeenCalledTimes(1);
 });
 it("does not mark a non-Prophet options selection as intelligence",async()=>{
  state.path="/options";state.query="tab=tape";await mount();expect(host.querySelector('[data-intelligence-nav] a[aria-current]')).toBeNull();
 });
});
