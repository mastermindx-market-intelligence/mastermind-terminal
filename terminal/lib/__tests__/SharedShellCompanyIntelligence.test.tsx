// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SharedShellCompanyIntelligence, { COMPANY_CONTEXT_READ_TIMEOUT_MS } from "@/components/fin/SharedShellCompanyIntelligence";
import { normalizeEventWorkspace, type RetainedEventWorkspaceReceipt } from "@/lib/eventWorkspace";
import { companyRetainedContextParams } from "@/lib/companyRetainedContext";
import raw from "./fixtures/aapl-event-workspace.json";

const edges=vi.hoisted(()=>({identity:{kind:"account",userId:"11111111-1111-4111-8111-111111111111",email:"same@example.test"},load:vi.fn(),open:vi.fn()}));
vi.mock("@/components/onboarding/OnboardingProvider",()=>({useOnboarding:()=>({open:edges.open})}));
vi.mock("next/navigation",()=>({useSearchParams:()=>new URLSearchParams(window.location.search)}));
vi.mock("@/components/chrome/AppShell",()=>({useShellIdentity:()=>edges.identity}));
vi.mock("@/lib/i18n",()=>({useLang:()=>({lang:"en"})}));
vi.mock("@/lib/companyRetainedContext",async original=>({...await original<typeof import("@/lib/companyRetainedContext")>(),loadCompanyRetainedContext:edges.load}));
vi.mock("@/components/fin/CompanyIntelligenceV2Current",()=>({default:({ticker}:{ticker:string})=><p data-retained-company={ticker}>verified {ticker}</p>}));
vi.mock("@/components/fin/CompanyWatchSave",()=>({default:()=>null}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const workspace=normalizeEventWorkspace(raw)!;
const receipt:RetainedEventWorkspaceReceipt={schema:"earnings.retained_baseline.v1",owner:"earnings.workspace_generation",company_id:workspace.issuer.company_id,event_id:workspace.event_id,generation_id:workspace.generation_id,workspace_schema:"event_workspace.v1",manifest_schema:"event_workspace_manifest.v3",authority:"context_only",manifest_sha256:"a".repeat(64),manifest_bytes:2000,workspace_sha256:"b".repeat(64),workspace_bytes:4000,fingerprint:"c".repeat(64),public_known_at:null,platform_known_at:null,generation_emitted_at:workspace.generated_at,rights:{allowed:true,policy_version:"fixture-rights-v1",checked_at:"2026-10-21T12:00:00Z"}};
const success={ok:true as const,workspace,receipt};
let root:Root,host:HTMLDivElement;
let pending:Array<{resolve:(value:typeof success)=>void;signal:AbortSignal}>;
beforeEach(()=>{edges.load.mockReset();edges.identity={kind:"account",userId:"11111111-1111-4111-8111-111111111111",email:"same@example.test"};pending=[];edges.load.mockImplementation(({signal}:{signal:AbortSignal})=>new Promise(resolve=>pending.push({resolve,signal})));host=document.createElement("div");document.body.append(host);root=createRoot(host);window.history.replaceState({},"","/analysis?symbol=AAPL&page=intelligence");});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();});
async function render(symbol="AAPL"){await act(async()=>root.render(<SharedShellCompanyIntelligence sym={symbol} onOpenTx={()=>{}}/>));}
async function resolve(index:number){await act(async()=>pending[index].resolve(success));}

describe("retained Company active scope",()=>{
 it("distinguishes denied current rights from a missing event without replacing the selection",async()=>{
  edges.load.mockResolvedValue({ok:false,code:"HISTORICAL_UNAVAILABLE",reason:"rights_denied"});
  window.history.replaceState({},"","/analysis?symbol=AAPL&page=intelligence&"+companyRetainedContextParams(receipt).toString());
  const selected=window.location.href;await render();
  expect(host.textContent).toContain("Selected event access restricted");expect(host.textContent).toContain("Current source rights");
  expect(host.textContent).not.toContain("Sign in");expect(window.location.href).toBe(selected);
 });
 it("offers existing sign-in recovery without changing the immutable event URL",async()=>{
  edges.load.mockResolvedValue({ok:false,code:"HISTORICAL_UNAVAILABLE",reason:"unauthenticated"});
  window.history.replaceState({},"","/analysis?symbol=AAPL&page=intelligence&"+companyRetainedContextParams(receipt).toString()+"&ci_evidence=claim-1");
  const selected=window.location.href;await render();
  expect(host.textContent).toContain("Your session has expired or you are signed out");
  await act(async()=>Array.from(host.querySelectorAll("button")).find(button=>button.textContent==="Sign in")!.click());
  expect(edges.open).toHaveBeenCalledWith("signin");expect(window.location.href).toBe(selected);
 });
 it("does not reuse A rights after A to B pending to A",async()=>{
  await render();await resolve(0);expect(edges.load).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[data-retained-company="AAPL"]')).not.toBeNull();
  edges.identity={...edges.identity,userId:"22222222-2222-4222-8222-222222222222"};await render();
  edges.identity={...edges.identity,userId:"11111111-1111-4111-8111-111111111111"};await render();
  expect(edges.load).toHaveBeenCalledTimes(3);
  expect(host.querySelector("[data-retained-company]")).toBeNull();
  expect(pending[1].signal.aborted).toBe(true);
  await resolve(1);expect(host.querySelector("[data-retained-company]")).toBeNull();
  await resolve(2);expect(host.querySelector('[data-retained-company="AAPL"]')).not.toBeNull();
 });
 it("revalidates after company A to company B pending to A",async()=>{
  await render();await resolve(0);const pinnedA=window.location.href;
  window.history.replaceState({},"","/analysis?symbol=NVDA&page=intelligence");await render("NVDA");
  window.history.replaceState({},"",pinnedA);await render("AAPL");
  expect(edges.load).toHaveBeenCalledTimes(3);expect(host.querySelector("[data-retained-company]")).toBeNull();
  await resolve(1);expect(host.querySelector("[data-retained-company]")).toBeNull();
  await resolve(2);expect(host.querySelector('[data-retained-company="AAPL"]')).not.toBeNull();
 });
 it("bounds a nonsettling event read and permits a same-selection recheck",async()=>{
  vi.useFakeTimers();await render();
  await act(async()=>{await vi.advanceTimersByTimeAsync(COMPANY_CONTEXT_READ_TIMEOUT_MS+1);});
  expect(host.textContent).toContain("Selected event unavailable");
  expect(pending[0].signal.aborted).toBe(true);
  const retry=Array.from(host.querySelectorAll("button")).find(button=>button.textContent==="Recheck selected event")!;
  expect(retry.disabled).toBe(false);await act(async()=>retry.click());expect(edges.load).toHaveBeenCalledTimes(2);
 });
});
