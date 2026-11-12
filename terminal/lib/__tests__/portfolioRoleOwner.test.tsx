// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import PortfolioView from "@/components/PortfolioView";
import { LangProvider } from "@/lib/i18n";
import { portfolioBookKey } from "@/lib/portfolioSnapshot.server";
import { computePortfolioTargets } from "@/lib/portfolioTargets";
import type { Position } from "@/lib/portfolio";
vi.mock("@/lib/dataCache", () => ({ getJSON: async () => ({ symbols: {} }) }));
vi.mock("@/components/PortfolioBriefPanel", () => ({ default: () => null }));
vi.mock("@/components/EventImpactPanel", () => ({ default: () => null }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
const positions: Position[] = [{ id: "record", ticker: "NVDA", shares: 10, entryPrice: 100, entryCurrency: "USD", entryDate: null, notes: null, status: "open", createdAt: null }];
let host: HTMLDivElement, root: Root, account: number, labels: (string|null)[], posts: Record<string,unknown>[];
let hold: boolean, settle: (r: Response) => void, ignoreWrite: boolean;
const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status});
async function flush() { await act(async()=>{for(let i=0;i<15;i++)await Promise.resolve();}); }
async function show(n:number) { account=n; await act(async()=>root.render(<LangProvider><PortfolioView positions={positions} email="same@example.test" userId={ids[n]}/></LangProvider>)); await flush(); }
function edit(value:string) { act(()=>{const input=host.querySelector<HTMLInputElement>('[aria-label="Role label: NVDA"]')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));}); }
const click=()=>act(()=>{Array.from(host.querySelectorAll("button")).find(x=>x.textContent==="Save role label")!.click();});
beforeEach(()=>{
  account=0; labels=["A role","B role"]; posts=[];hold=false;ignoreWrite=false;
  document.documentElement.setAttribute("data-lang","en");
  vi.stubGlobal("fetch",vi.fn(async(input:string,init?:RequestInit)=>{
    const owner=account;
    if(input==="/api/portfolio?view=positions")return response({positions,bookKey:portfolioBookKey(positions)});
    if(input==="/api/portfolio/targets") {
      if(init?.method==="POST") {const body=JSON.parse(String(init.body));posts.push(body);if(!ignoreWrite)labels[owner]=body.roleLabel;if(hold)return new Promise<Response>(r=>{settle=r;});return response({ok:true});}
      const summary=computePortfolioTargets(positions,[{ticker:"NVDA",targetWeightPct:40,bandPct:5,updatedAt:null,roleLabel:labels[owner]}]);summary.roleLabelsAvailable=true;
      return response({summary,bookKey:portfolioBookKey(positions)});
    }
    if(input.startsWith("/api/quote"))return response({quotes:{}});
    return response({error:"optional analysis unavailable"},503);
  }));
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.unstubAllGlobals();document.documentElement.removeAttribute("data-lang");});
it("uses the actual owner fence and role-only payload, then confirms canonical readback",async()=>{
  await show(0);edit("Purpose A");click();await flush();
  expect(posts).toEqual([{action:"set_role",ticker:"NVDA",roleLabel:"Purpose A",expectedOwnerId:ids[0]}]);
  expect(host.textContent).toContain("Role label saved and confirmed");
});
it("does not acknowledge a successful POST whose canonical role was not saved",async()=>{
  await show(0);ignoreWrite=true;edit("Unconfirmed");click();await flush();
  expect(host.textContent).not.toContain("Role label saved and confirmed");
  expect(host.textContent).toContain("Change not confirmed");
  expect(host.querySelector<HTMLInputElement>('[aria-label="Role label: NVDA"]')!.value).toBe("Unconfirmed");
});
it("retires the original account's late completion without writing or acknowledging in the new account",async()=>{
  await show(0);hold=true;edit("A pending");click();await flush();
  await show(1);await act(async()=>settle(response({ok:true})));await flush();
  expect(posts).toHaveLength(1);expect(posts[0].expectedOwnerId).toBe(ids[0]);
  expect(host.textContent).not.toContain("Role label saved and confirmed");
  expect(host.querySelector<HTMLInputElement>('[aria-label="Role label: NVDA"]')!.value).toBe("B role");
});
