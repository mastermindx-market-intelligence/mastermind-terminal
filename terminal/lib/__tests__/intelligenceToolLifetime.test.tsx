// @vitest-environment jsdom
import React,{act,useEffect} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const state=vi.hoisted(()=>({ready:true,unavailable:false,lang:'en' as 'en'|'zh',cache:'previous-account',reads:[] as string[],invalidations:0}));
vi.mock("@/lib/i18n",()=>({useLang:()=>({lang:state.lang})}));
vi.mock("@/lib/shared-shell/useReadingScope",()=>({useReadingScope:()=>({ready:state.ready,ended:!state.ready&&!state.unavailable,unavailable:state.unavailable,retryIdentity:vi.fn()})}));
vi.mock("@/lib/flowClientCache",()=>({flowInvalidate:()=>{state.cache='cleared';state.invalidations++;}}));
vi.mock("@/components/intelligence/IntelligenceNav",()=>({default:()=>null}));
vi.mock("next/link",()=>({default:({children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=><a {...props}>{children}</a>}));
vi.mock("next/dynamic",()=>({default:()=>function Child(){useEffect(()=>{state.reads.push(state.cache);},[]);return <div>Existing tool</div>;}}));
import Tool from "@/components/intelligence/IntelligenceToolWorkspace";
import TodayIntelligenceEntry from "@/components/intelligence/TodayIntelligenceEntry";
(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root,host:HTMLDivElement;
beforeEach(()=>{state.ready=true;state.unavailable=false;state.lang='en';state.cache='previous-account';state.reads=[];state.invalidations=0;host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
describe("dedicated Prophet preserves the incumbent cache boundary",()=>{
 it("clears the existing cache before child passive reads and again on account departure",async()=>{
  await act(async()=>root.render(<Tool ownerKey="A" kind="prophet"/>));expect(state.reads).toEqual(['cleared']);expect(state.invalidations).toBe(1);
  state.cache='A-private';state.ready=false;await act(async()=>root.render(<Tool ownerKey="A" kind="prophet"/>));expect(state.cache).toBe('cleared');expect(host.textContent).not.toContain('Existing tool');
  state.ready=true;state.cache='old-inflight-value';await act(async()=>root.render(<Tool ownerKey="B" kind="prophet"/>));expect(state.reads).toEqual(['cleared','cleared']);
 });

 it("renders every held-account state in the active language without exposing private tools",async()=>{
  state.ready=false; state.lang="zh";
  await act(async()=>root.render(<Tool ownerKey="A" kind="prophet"/>));
  expect(host.textContent).toContain("账户已更改或会话已结束。私人读数已清除。");
  expect(host.textContent).toContain("重新核验账户");
  expect(host.querySelector('a[href="/login?next=%2Fprophet"]')?.textContent).toBe("登录");
  expect(host.textContent).not.toContain("Existing tool");
  state.unavailable=true;
  await act(async()=>root.render(<Tool ownerKey="A" kind="prophet"/>));
  expect(host.textContent).toContain("账户核验暂不可用。私人读数已隐藏。");
  expect(host.textContent).not.toContain("Existing tool");
  state.lang="en";
  await act(async()=>root.render(<Tool ownerKey="A" kind="prophet"/>));
  expect(host.textContent).toContain("Account verification is unavailable. Private readings are hidden.");
  expect(host.textContent).toContain("Recheck account");
 });
 it("keeps the Today intelligence entry bilingual without a second navigation owner",async()=>{
  state.lang="zh";
  await act(async()=>root.render(<TodayIntelligenceEntry/>));
  expect(host.querySelector('a[href="/intelligence"] strong')?.textContent).toBe("市场情报");
  state.lang="en";
  await act(async()=>root.render(<TodayIntelligenceEntry/>));
  expect(host.querySelector('a[href="/intelligence"] strong')?.textContent).toBe("Market Intelligence");
 });
 it("does not clear the unrelated options cache when opening sectors",async()=>{await act(async()=>root.render(<Tool ownerKey="A" kind="sectors"/>));expect(state.invalidations).toBe(0);});
});
