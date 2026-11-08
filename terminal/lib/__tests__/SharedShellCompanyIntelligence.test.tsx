// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SharedShellCompanyIntelligence, { COMPANY_CONTEXT_READ_TIMEOUT_MS } from "@/components/fin/SharedShellCompanyIntelligence";
import { normalizeEventWorkspace, type RetainedEventWorkspaceReceipt } from "@/lib/eventWorkspace";
import { companyRetainedContextParams } from "@/lib/companyRetainedContext";
import raw from "./fixtures/aapl-event-workspace.json";

const edges=vi.hoisted(()=>({identity:{kind:"account",userId:"11111111-1111-4111-8111-111111111111",email:"same@example.test"},load:vi.fn(),open:vi.fn(),lang:"en" as "en"|"zh",routerSearch:null as string|null}));
vi.mock("@/components/onboarding/OnboardingProvider",()=>({useOnboarding:()=>({open:edges.open})}));
vi.mock("next/navigation",()=>({useSearchParams:()=>new URLSearchParams(edges.routerSearch ?? window.location.search)}));
vi.mock("@/components/chrome/AppShell",()=>({useShellIdentity:()=>edges.identity}));
vi.mock("@/lib/i18n",()=>({useLang:()=>({lang:edges.lang})}));
vi.mock("@/lib/companyRetainedContext",async original=>({...await original<typeof import("@/lib/companyRetainedContext")>(),loadCompanyRetainedContext:edges.load}));
vi.mock("@/components/fin/CompanyIntelligenceV2Current",()=>({default:({ticker}:{ticker:string})=><p data-retained-company={ticker}>verified {ticker}</p>}));
vi.mock("@/components/fin/CompanyWatchSave",()=>({default:()=>null}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const workspace=normalizeEventWorkspace(raw)!;
const receipt:RetainedEventWorkspaceReceipt={schema:"earnings.retained_baseline.v1",owner:"earnings.workspace_generation",company_id:workspace.issuer.company_id,event_id:workspace.event_id,generation_id:workspace.generation_id,workspace_schema:"event_workspace.v1",manifest_schema:"event_workspace_manifest.v3",authority:"context_only",manifest_sha256:"a".repeat(64),manifest_bytes:2000,workspace_sha256:"b".repeat(64),workspace_bytes:4000,fingerprint:"c".repeat(64),public_known_at:null,platform_known_at:null,generation_emitted_at:workspace.generated_at,rights:{allowed:true,policy_version:"fixture-rights-v1",checked_at:"2026-10-21T12:00:00Z"}};
const success={ok:true as const,workspace,receipt};
let root:Root,host:HTMLDivElement;
let pending:Array<{resolve:(value:typeof success)=>void;signal:AbortSignal}>;
beforeEach(()=>{edges.lang="en";edges.routerSearch=null;edges.load.mockReset();edges.open.mockReset();edges.identity={kind:"account",userId:"11111111-1111-4111-8111-111111111111",email:"same@example.test"};pending=[];edges.load.mockImplementation(({signal}:{signal:AbortSignal})=>new Promise(resolve=>pending.push({resolve,signal})));host=document.createElement("div");document.body.append(host);root=createRoot(host);window.history.replaceState({},"","/analysis?symbol=AAPL&page=intelligence");});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();});
async function render(symbol="AAPL"){await act(async()=>root.render(<SharedShellCompanyIntelligence sym={symbol} onOpenTx={()=>{}}/>));}
async function resolve(index:number){await act(async()=>pending[index].resolve(success));}

describe("retained Company active scope",()=>{
 it.each([
  ["en","current_owner_unavailable","Current event unavailable"],
  ["zh","current_owner_unavailable","当前事件不可用"],
  ["en","rights_denied","Current event access restricted"],
  ["zh","rights_denied","当前事件的访问受限"],
  ["en","unauthenticated","Sign in to recheck the current event"],
  ["zh","unauthenticated","登录以重新验证当前事件"],
 ] as const)("describes an unpinned %s %s result without inventing a selected version",async(lang,reason,title)=>{
  edges.lang=lang;edges.load.mockResolvedValue({ok:false,code:"HISTORICAL_UNAVAILABLE",reason});
  const original=window.location.href;await render();
  expect(host.querySelector("h2")?.textContent).toBe(title);
  expect(host.querySelector("[data-ci-unavailable-reason]")?.getAttribute("data-ci-unavailable-reason")).toBe(reason);
  expect(host.textContent).toContain(lang==="zh"?"重新验证当前事件":"Recheck current event");
  expect(host.textContent).not.toContain(lang==="zh"?"所选事件":"selected event");
  expect(host.textContent).not.toContain(lang==="zh"?"原始版本":"original event version");
  expect(Array.from(host.querySelectorAll("button")).some(button=>button.textContent===(lang==="zh"?"打开当前事件":"Open current event"))).toBe(false);
  expect(window.location.href).toBe(original);expect(edges.load).toHaveBeenCalledTimes(1);expect(edges.load.mock.calls[0][0].pin).toBeNull();
 });
 it.each(["en","zh"] as const)("preserves selected-version recovery for a pinned %s failure",async(lang)=>{
  edges.lang=lang;edges.load.mockResolvedValue({ok:false,code:"HISTORICAL_UNAVAILABLE",reason:"owner_unavailable"});
  window.history.replaceState({},"","/analysis?symbol=AAPL&page=intelligence&"+companyRetainedContextParams(receipt).toString()+"&ci_evidence=claim-1");
  const original=window.location.href;await render();
  expect(host.querySelector("h2")?.textContent).toBe(lang==="zh"?"所选事件不可用":"Selected event unavailable");
  expect(host.textContent).toContain(lang==="zh"?"原始版本":"original event version");
  expect(host.textContent).toContain(lang==="zh"?"重新验证所选事件":"Recheck selected event");
  expect(host.textContent).toContain(lang==="zh"?"打开当前事件":"Open current event");
  expect(window.location.href).toBe(original);expect(edges.load).toHaveBeenCalledTimes(1);expect(edges.load.mock.calls[0][0].pin.fingerprint).toBe(receipt.fingerprint);
 });
 it("keeps the freshly authorized event visible after pin export while the router snapshot lags",async()=>{
  edges.routerSearch=window.location.search;
  await render();await resolve(0);
  expect(window.location.search).toContain("ci_event=");
  expect(edges.routerSearch).not.toContain("ci_event=");
  expect(host.querySelector('[data-retained-company="AAPL"]')).not.toBeNull();
  expect(host.textContent).not.toContain("Verifying");
  expect(edges.load).toHaveBeenCalledTimes(1);
 });
 it("hides the previous receipt and revalidates external pin changes and Back with a stale router snapshot",async()=>{
  edges.routerSearch=window.location.search;
  await render();await resolve(0);const first=window.location.href;
  const changed=new URL(first);changed.searchParams.set("ci_fingerprint","d".repeat(64));
  await act(async()=>{window.history.pushState({},"",changed);window.dispatchEvent(new Event("mmx:shell-location"));});
  expect(host.querySelector("[data-retained-company]")).toBeNull();
  expect(edges.load).toHaveBeenCalledTimes(2);
  expect(edges.load.mock.calls[1][0].pin.fingerprint).toBe("d".repeat(64));
  await act(async()=>{window.history.replaceState({},"",first);window.dispatchEvent(new PopStateEvent("popstate"));});
  expect(edges.load).toHaveBeenCalledTimes(3);expect(pending[1].signal.aborted).toBe(true);
  await resolve(1);expect(host.querySelector("[data-retained-company]")).toBeNull();
  await resolve(2);expect(host.querySelector('[data-retained-company="AAPL"]')).not.toBeNull();
 });
 it("opens current explicitly after clearing the old pin even while the router snapshot retains it",async()=>{
  window.history.replaceState({},"","/analysis?symbol=AAPL&page=intelligence&"+companyRetainedContextParams(receipt).toString());
  edges.routerSearch=window.location.search;await render();
  await act(async()=>pending[0].resolve({ok:false,code:"HISTORICAL_UNAVAILABLE",reason:"rights_denied"} as unknown as typeof success));
  const open=Array.from(host.querySelectorAll("button")).find(button=>button.textContent==="Open current event")!;
  await act(async()=>open.click());
  expect(window.location.search).not.toContain("ci_event=");
  expect(edges.load).toHaveBeenCalledTimes(2);expect(edges.load.mock.calls[1][0].pin).toBeNull();
  expect(pending[0].signal.aborted).toBe(true);
 });
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
  expect(host.textContent).toContain("Current event unavailable");
  expect(pending[0].signal.aborted).toBe(true);
  const retry=Array.from(host.querySelectorAll("button")).find(button=>button.textContent==="Recheck current event")!;
  expect(retry.disabled).toBe(false);await act(async()=>retry.click());expect(edges.load).toHaveBeenCalledTimes(2);
 });
});
