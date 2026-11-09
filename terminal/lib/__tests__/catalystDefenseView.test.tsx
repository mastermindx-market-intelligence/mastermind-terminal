// @vitest-environment jsdom
import React, {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {beforeEach, afterEach, describe, it, expect, vi} from "vitest";
import owner from "./fixtures/catalystDefenseOwner.json";
import attention from "./fixtures/catalystOpportunity.json";
import {decodeDefenseContext, defenseCoreFacts} from "../catalystDefense";
const session=vi.hoisted(()=>({identity:{id:"account-a"}}));
vi.mock("@/components/chrome/AppShell",()=>({useShellIdentity:()=>session.identity}));
vi.mock("@/lib/i18n",()=>({useLang:()=>({lang:"en"})}));
import {DefenseResearchPanel, type DefensePanelProps} from "@/components/catalyst-opportunity/DefenseResearchPanel";
import CatalystOpportunityWorkspace from "@/components/catalyst-opportunity/CatalystOpportunityWorkspace";
let root:Root, host:HTMLDivElement;
const data=()=>decodeDefenseContext(structuredClone(owner));
const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status});
function render(props:Partial<DefensePanelProps>={}) {act(()=>root.render(<DefenseResearchPanel view={data()} lang="en" loading={false} error={null} onRefresh={vi.fn()} {...props}/>));}
beforeEach(()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-10-17T18:00:00Z"));
  session.identity={id:"account-a"};host=document.createElement("div");document.body.appendChild(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});

describe("Defense research workflow",()=>{
  it("shows reported segment values, source links and the original stale labels",()=>{
    render();expect(host.textContent).toContain("4,101");expect(host.textContent).toContain("14.5%");expect(host.textContent).toContain("USD million");
    expect(host.querySelectorAll('[data-dated="true"]')).toHaveLength(3);
    expect(host.textContent).toContain("Program workshare is not disclosed");
    expect(host.querySelector('a[href^="https://www.sec.gov/Archives/edgar/data/"]')).not.toBeNull();
    expect(host.querySelectorAll("article")).toHaveLength(0);
  });
  it("selects a company without ranking or manufacturing a watch signal",()=>{
    render();act(()=>[...host.querySelectorAll("button")].find(b=>b.textContent==="NOC")!.click());
    expect(host.textContent).toContain("Northrop Grumman");expect(host.textContent).toContain("2,093");expect(host.textContent).toContain("7.5%");
    expect(host.textContent).toContain("Research cohort, not a ranking");
  });
  it.each(["en","zh"] as const)("keeps display labels and interpretation in %s",lang=>{
    render({lang});expect(host.textContent).toContain(lang==="zh"?"防务公司证据":"Defense company evidence");
    expect(host.textContent).toContain(lang==="zh"?owner.profiles[0].interpretation.chain[0].summary_zh:owner.profiles[0].interpretation.chain[0].summary_en);
    expect(host.textContent).not.toContain(lang==="zh"?owner.profiles[0].interpretation.chain[0].summary_en:owner.profiles[0].interpretation.chain[0].summary_zh);
    expect(host.textContent).not.toContain("missing_owner");
  });
  it.each(["auth","access","unavailable"] as const)("clears figures and sources for %s",error=>{
    render({error});expect(host.textContent).not.toContain("4,101");expect(host.querySelector('a[href*="sec.gov"]')).toBeNull();
  });
  it("does not mislabel an incomplete or incomparable metric trio",()=>{
    const view=data();view.profiles[0].axes.economics.facts= view.profiles[0].axes.economics.facts.filter(f=>!f.fact_id.endsWith(":defense_segment_sales"));
    expect(defenseCoreFacts(view.profiles[0])).toEqual([]);render({view});expect(host.textContent).toContain("A comparable segment baseline is not available");
  });
});

describe("two-owner account isolation",()=>{
  it("shows both lanes, then clears both synchronously on an account change",async()=>{
    const fetcher=vi.fn().mockImplementation((url:string)=>session.identity.id==="account-a" ? Promise.resolve(response(url.endsWith("/defense")?owner:attention)):new Promise(()=>{}));
    vi.stubGlobal("fetch",fetcher);await act(async()=>root.render(<CatalystOpportunityWorkspace/>));
    expect(host.textContent).toContain("Energy Complex");expect(host.textContent).toContain("4,101");
    session.identity={id:"account-b"};act(()=>root.render(<CatalystOpportunityWorkspace/>));
    expect(host.textContent).not.toContain("Energy Complex");expect(host.textContent).not.toContain("4,101");
    expect(host.querySelector('a[href*="sec.gov"]')).toBeNull();
  });
  it("keeps company research usable during a market-source outage",async()=>{
    vi.stubGlobal("fetch",vi.fn((url:string)=>Promise.resolve(url.endsWith("/defense")?response(owner):response({},503))));
    await act(async()=>root.render(<CatalystOpportunityWorkspace/>));
    expect(host.textContent).toContain("Published observations could not be loaded");expect(host.textContent).toContain("4,101");
  });
  it("does not convert a Defense outage into absence of market watches",async()=>{
    vi.stubGlobal("fetch",vi.fn((url:string)=>Promise.resolve(url.endsWith("/defense")?response({},503):response(attention))));
    await act(async()=>root.render(<CatalystOpportunityWorkspace/>));
    expect(host.textContent).toContain("Energy Complex");expect(host.textContent).toContain("Defense evidence is unavailable");
  });
  it("ignores a delayed old-account Defense response",async()=>{
    let resolveOld!:(response:Response)=>void;
    vi.stubGlobal("fetch",vi.fn((url:string)=>{
      if (session.identity.id==="account-b") return Promise.resolve(response({},403));
      return url.endsWith("/defense")?new Promise<Response>(resolve=>{resolveOld=resolve;}):Promise.resolve(response(attention));
    }));
    await act(async()=>root.render(<CatalystOpportunityWorkspace/>));session.identity={id:"account-b"};
    await act(async()=>root.render(<CatalystOpportunityWorkspace/>));await act(async()=>resolveOld(response(owner)));
    expect(host.textContent).not.toContain("4,101");expect(host.textContent).not.toContain("Energy Complex");
    expect(host.querySelectorAll('a[href*="sec.gov"]')).toHaveLength(0);
  });
});


describe("on-demand Defense evidence inspection",()=>{
  function openAll() { act(()=>[...host.querySelectorAll("button")].find(b=>b.textContent?.startsWith("Inspect all company evidence"))!.click()); }
  function select(symbol:string) { act(()=>[...host.querySelectorAll("button")].find(b=>b.textContent===symbol)!.click()); }
  it("does not eagerly mount the full facts, then exposes every source-backed fact on request",()=>{
    render();expect(host.querySelectorAll('[data-testid="defense-source-fact"]')).toHaveLength(0);
    openAll();expect(host.querySelectorAll('[data-testid="defense-source-fact"]')).toHaveLength(owner.profiles[0].axes.economics.facts.length);
    expect(host.textContent).toContain("-150");expect(host.textContent).toContain("Company guidance, not a reported result");
    expect(host.textContent).toContain("Earlier company guidance");expect(host.textContent).toContain("not sales or new orders");
    expect(host.querySelector('[aria-expanded="true"]')?.getAttribute("aria-controls")).toBeTruthy();
  });
  it("connects the NOC margin explanation to its four exact evidence references",()=>{
    render();select("NOC");
    const disclosure=[...host.querySelectorAll("details")].find(d=>d.querySelector("summary")?.textContent?.startsWith("Segment operating margin"))!;
    act(()=>disclosure.querySelector("button")!.click());
    const rows=[...disclosure.querySelectorAll('[data-testid="defense-source-fact"]')];
    expect(rows).toHaveLength(4);expect(disclosure.textContent).toContain("12.7%");
    expect(disclosure.textContent).toContain("SiAW unfavorable cost-estimate revision");
    expect(disclosure.textContent).toContain("Earlier Sentinel favorable cost-estimate revision");
    expect(disclosure.textContent).not.toContain("Adjusted free cash flow");
  });
  it("resets expanded financial evidence on issuer and source generation changes",()=>{
    render();openAll();select("RTX");expect(host.querySelectorAll('[data-testid="defense-source-fact"]')).toHaveLength(0);
    openAll();expect(host.textContent).toContain("USD billion");
    const changed=data();changed.content_id="dfe1-000000000000000000000000";render({view:changed});
    expect(host.querySelectorAll('[data-testid="defense-source-fact"]')).toHaveLength(0);
  });
  it.each(["access","auth","unavailable"] as const)("removes expanded evidence and links on %s",error=>{
    render();openAll();render({error});expect(host.querySelectorAll('[data-testid="defense-source-fact"]')).toHaveLength(0);
    expect(host.textContent).not.toContain("-150");expect(host.querySelector('a[href*="sec.gov"]')).toBeNull();
  });
  it("shows native axis explanations rather than only a status badge",()=>{
    render();expect(host.textContent).toContain(owner.profiles[0].axes.demand.summary_en);
    expect(host.textContent).toContain("Source observation");
  });
  it("labels original English terms explicitly inside the Chinese evidence workflow",()=>{
    render({lang:"zh"});select("LHX");
    act(()=>[...host.querySelectorAll("button")].find(b=>b.textContent?.startsWith("核查全部公司证据"))!.click());
    expect(host.textContent).toContain("原始来源措辞（英文）");expect(host.textContent).toContain("有条件条款，并非已实现所得款项");
    expect(host.querySelectorAll('blockquote[lang="en"]').length).toBeGreaterThan(0);
  });
});


describe("shared entitlement revocation is symmetric",()=>{
  it("clears market observations when the Defense owner denies the same account",async()=>{
    vi.stubGlobal("fetch",vi.fn((url:string)=>Promise.resolve(url.endsWith("/defense")?response({},403):response(attention))));
    await act(async()=>root.render(<CatalystOpportunityWorkspace/>));
    expect(host.textContent).not.toContain("Energy Complex");expect(host.textContent).not.toContain("4,101");
    expect(host.textContent).toContain("requires the site-full research entitlement");
  });
  it("does not let a late successful market reply override an earlier Defense denial",async()=>{
    let resolveMarket!:(value:Response)=>void;
    vi.stubGlobal("fetch",vi.fn((url:string)=>url.endsWith("/defense")?Promise.resolve(response({},401)):new Promise<Response>(resolve=>{resolveMarket=resolve;})));
    await act(async()=>root.render(<CatalystOpportunityWorkspace/>));
    await act(async()=>resolveMarket(response(attention)));
    expect(host.textContent).not.toContain("Energy Complex");expect(host.textContent).toContain("Sign in to view Catalyst Intelligence");
  });
  it("allows an explicit fresh generation to recover after both owners authorize",async()=>{
    let authorized=false;
    vi.stubGlobal("fetch",vi.fn((url:string)=>Promise.resolve(!authorized&&url.endsWith("/defense")?response({},403):response(url.endsWith("/defense")?owner:attention))));
    await act(async()=>root.render(<CatalystOpportunityWorkspace/>));expect(host.textContent).not.toContain("Energy Complex");
    authorized=true;await act(async()=>[...host.querySelectorAll("button")].find(b=>b.textContent==="Refresh sources")!.click());
    expect(host.textContent).toContain("Energy Complex");expect(host.textContent).toContain("4,101");
  });
});
