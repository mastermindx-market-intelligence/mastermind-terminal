// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/catalystOpportunity.json";
import { decodeCatalystView } from "../catalystOpportunity";
const session = vi.hoisted(()=>({identity:{id:"test-account-a"}}));
vi.mock("@/components/chrome/AppShell",()=>({useShellIdentity:()=>session.identity}));
vi.mock("@/lib/i18n",()=>({useLang:()=>({lang:"en"})}));
import { CatalystOpportunityView, type CatalystOpportunityViewProps } from "@/components/catalyst-opportunity/CatalystOpportunityView";
import CatalystOpportunityWorkspace from "@/components/catalyst-opportunity/CatalystOpportunityWorkspace";

let root:Root, host:HTMLDivElement;
const data=()=>decodeCatalystView(structuredClone(fixture));
function render(changes:Partial<CatalystOpportunityViewProps>={}) {
  act(()=>root.render(<CatalystOpportunityView view={data()} lang="en" loading={false} error={null} onRefresh={vi.fn()} {...changes} />));
}
function click(text:string) {
  const button=[...host.querySelectorAll("button")].find(b=>b.textContent?.trim()===text);
  expect(button).toBeDefined();act(()=>button!.click());
}
beforeEach(()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  session.identity={id:"test-account-a"};window.history.replaceState(null,"","/discover?tab=catalysts");
  host=document.createElement("div");document.body.appendChild(host);root=createRoot(host);
  vi.spyOn(window,"requestAnimationFrame").mockImplementation(callback=>{callback(0);return 1;});
});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});

describe("Catalyst investor workflow",()=>{
  it("shows real source values as percentage points and participation, not a probability",()=>{
    render();expect(host.textContent).toContain("+6.21 pp");expect(host.textContent).toContain("75%");
    expect(host.textContent).toContain("Research attention, not a buy list");expect(host.querySelectorAll("article")).toHaveLength(2);
  });
  it("can filter defense independently of the current manual watchlist",()=>{
    render();click("Defense");expect(host.querySelectorAll("article")).toHaveLength(1);
    expect(host.querySelector("article h2")?.textContent).toBe("Defense & Aerospace");
  });
  it("selects a case, exposes a usable deep link and moves focus",()=>{
    render();const button=host.querySelector<HTMLButtonElement>('[aria-label="Inspect evidence: Defense & Aerospace"]')!;
    act(()=>button.click());expect(host.querySelector("#catalyst-detail-title")?.textContent).toBe("Defense & Aerospace");
    expect(new URL(window.location.href).searchParams.get("case")).toBe("defense");
    expect(document.activeElement?.id).toBe("catalyst-detail-title");
  });
  it("restores a saved case and handles history navigation",()=>{
    window.history.replaceState(null,"","/discover?tab=catalysts&case=defense");render();
    expect(host.querySelector("#catalyst-detail-title")?.textContent).toBe("Defense & Aerospace");
    act(()=>{window.history.replaceState(null,"","/discover?tab=catalysts&case=energy_complex");window.dispatchEvent(new PopStateEvent("popstate"));});
    expect(host.querySelector("#catalyst-detail-title")?.textContent).toBe("Energy Complex");
  });
  it("keeps a missing saved case explicit instead of silently claiming it is current",()=>{
    window.history.replaceState(null,"","/discover?tab=catalysts&case=missing_theme");render();
    expect(host.textContent).toContain("That saved case is not present");
  });
  it("copies an actual case link on the user action",async()=>{
    const writeText=vi.fn().mockResolvedValue(undefined);Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText}});
    render();await act(async()=>{click("Copy case link");});
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("case=energy_complex"));expect(host.textContent).toContain("Case link copied");
  });
  it("does not show unavailable measurements as positive zero",()=>{
    const view=data();view.cases[0].metrics.rel_5d=null;render({view});
    const value=host.querySelector("article strong");expect(value?.textContent).toBe("Not available");expect(value?.hasAttribute("data-sign")).toBe(false);
  });
  it("supports the Chinese workflow",()=>{
    render({lang:"zh"});expect(host.querySelector("h1")?.textContent).toBe("当下值得关注");expect(host.textContent).toContain("能源综合体");expect(host.textContent).toContain("个百分点");
  });
  it("renders untrusted names as text, never markup",()=>{
    const view=data();view.cases[0].name="<img src=x onerror=alert(1)>";render({view});
    expect(host.querySelector("img")).toBeNull();expect(host.textContent).toContain("<img src=x");
  });
  it("distinguishes loading, missing source and denied access from a quiet market",()=>{
    render({view:null,loading:true});expect(host.textContent).toContain("Checking published observations");expect(host.textContent).not.toContain("No watches match");
    render({view:null,error:"unavailable"});expect(host.textContent).toContain("not a signal that markets are quiet");
    render({view:null,error:"access"});expect(host.textContent).toContain("requires the site-full research entitlement");expect(host.querySelectorAll("article")).toHaveLength(0);
  });
  it("preserves stale-source warning and the original source date",()=>{
    const view=data();view.status="stale";view.source!.freshness="stale";render({view});
    expect(host.textContent).toContain("This snapshot is dated");expect(host.textContent).toContain("Oct 16, 2026");
  });
  it.each(["en", "zh"] as const)("distinguishes an unknown population from missing observations in %s",lang=>{
    const view=data();view.status="partial";view.coverage.declared=null;view.coverage.complete=false;view.reason_codes=["UNKNOWN_POPULATION"];
    render({view,lang});
    expect(host.textContent).toContain(lang==="zh"?"尚未提供主题总数":"The full theme count is not provided");
    expect(host.textContent).not.toContain(lang==="zh"?"部分观测不可用":"Some observations are unavailable");
    expect(host.querySelectorAll("article")).toHaveLength(2);
  });
  it("shows refused observations even when the total population is unknown",()=>{
    const view=data();view.status="partial";view.coverage.declared=null;view.coverage.complete=false;
    view.coverage.observed+=1;view.coverage.refused=1;view.reason_codes=["UNKNOWN_POPULATION","PARTIAL_POPULATION"];
    render({view});expect(host.textContent).toContain("The full theme count is not provided");
    expect(host.textContent).toContain("Some observations are unavailable");
  });
  it.each(["en", "zh"] as const)("renders caution text, never its internal identifier, in %s",lang=>{
    const view=data();view.cases[0].cautions=[{code:"INTERNAL_CAUTION_IDENTIFIER",text:"Review today's price",text_zh:"请核查今日价格"}];
    render({view,lang});
    expect(host.textContent).toContain(lang==="zh"?"请核查今日价格":"Review today's price");
    expect(host.textContent).not.toContain("INTERNAL_CAUTION_IDENTIFIER");
    expect(host.textContent).not.toContain(lang==="zh"?"Review today's price":"请核查今日价格");
  });
  it("never replaces a lack of watch with a lack of coverage",()=>{
    const view=data();view.cases=view.cases.filter(c=>c.theme_id!=="defense");view.coverage.watch_count=1;view.inventory.find(t=>t.theme_id==="defense")!.watch=false;
    render({view});click("Defense");expect(host.textContent).toContain("Defense is covered in this snapshot");expect(host.textContent).toContain("Inspect coverage and theme states (3)");
  });
});

describe("account-bound Catalyst loading",()=>{
  it("clears the previous account before a new response arrives",async()=>{
    let reads=0;
    const fetcher=vi.fn().mockImplementation((url:string)=>{
      if (url.endsWith("/defense")) return Promise.resolve(new Response("{}",{status:503}));
      return reads++===0 ? Promise.resolve(new Response(JSON.stringify(fixture),{status:200})) : new Promise(()=>{});
    });vi.stubGlobal("fetch",fetcher);
    await act(async()=>{root.render(<CatalystOpportunityWorkspace />);});
    expect(host.textContent).toContain("Energy Complex");
    session.identity={id:"test-account-b"};act(()=>root.render(<CatalystOpportunityWorkspace />));
    expect(host.textContent).not.toContain("Energy Complex");expect(host.textContent).toContain("Checking published observations");
    expect(fetcher.mock.calls.filter(([url])=>url==="/api/catalyst-opportunities")).toHaveLength(2);
    await act(async()=>{}); // Flush the independent source after asserting synchronous account clearing.
  });
  it("does not consume a delayed old-account response",async()=>{
    let resolveOld!:(value:Response)=>void;
    let reads=0;
    const fetcher=vi.fn().mockImplementation((url:string)=>{
      if (url.endsWith("/defense")) return Promise.resolve(new Response("{}",{status:503}));
      return reads++===0 ? new Promise<Response>(resolve=>{resolveOld=resolve;}) : Promise.resolve(new Response("{}",{status:403}));
    });vi.stubGlobal("fetch",fetcher);
    act(()=>root.render(<CatalystOpportunityWorkspace />));
    session.identity={id:"test-account-b"};await act(async()=>{root.render(<CatalystOpportunityWorkspace />);});
    await act(async()=>{resolveOld(new Response(JSON.stringify(fixture),{status:200}));});
    expect(host.textContent).not.toContain("Energy Complex");expect(host.textContent).toContain("requires the site-full research entitlement");
  });
});
