// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
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
let readContext:object, currentView:ReturnType<typeof data>;
function render(changes:Partial<CatalystOpportunityViewProps>={}) {
  act(()=>root.render(<CatalystOpportunityView view={currentView} readContext={readContext} lang="en" loading={false} error={null} onRefresh={vi.fn()} {...changes} />));
}
function click(text:string) {
  const button=[...host.querySelectorAll("button")].find(b=>b.textContent?.trim()===text);
  expect(button).toBeDefined();act(()=>button!.click());
}
beforeEach(()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  readContext={};currentView=data();
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
    expect(host.querySelector("#catalyst-detail-title")).toBeNull();
    expect([...host.querySelectorAll("button")].some(b=>b.textContent==="Copy case link")).toBe(false);
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


function deferredCopy() {
  let resolve!:()=>void, reject!:(reason?:unknown)=>void;
  const promise=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}
function clipboard(writeText:(text:string)=>Promise<void>) {
  Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText}});
}
function search(value:string) {
  const input=host.querySelector<HTMLInputElement>('input[type="search"]')!;
  act(()=>{
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value);
    input.dispatchEvent(new Event("input",{bubbles:true}));
  });
}
function historyCase(id:string) {
  act(()=>{window.history.replaceState(null,"","/discover?tab=catalysts&case="+id);window.dispatchEvent(new PopStateEvent("popstate"));});
}
function inspect(name:string) {
  const button=host.querySelector<HTMLButtonElement>('[aria-label="Inspect evidence: '+name+'"]')!;
  expect(button).not.toBeNull();act(()=>button.click());
}

describe("Catalyst selection and copy context",()=>{
  it("does not expose a default case before the saved URL is resolved",()=>{
    window.history.replaceState(null,"","/discover?tab=catalysts&case=missing_theme");
    const html=renderToString(<CatalystOpportunityView view={currentView} readContext={readContext} lang="en" loading={false} error={null} onRefresh={()=>{}} />);
    expect(html).not.toContain('id="catalyst-detail-title"');expect(html).not.toContain("Copy case link");
    expect(html).not.toContain("That saved case is not present");
    render();expect(host.textContent).toContain("That saved case is not present");expect(host.querySelector("#catalyst-detail-title")).toBeNull();
  });
  it.each(["en","zh"] as const)("retains the selected Defense case through Energy, zero results and Clear in %s",async lang=>{
    const writeText=vi.fn().mockResolvedValue(undefined);clipboard(writeText);
    window.history.replaceState(null,"","/discover?tab=catalysts&case=defense");render({lang});
    click(lang==="en"?"Energy":"能源");
    expect(host.querySelectorAll("article")).toHaveLength(1);
    expect(host.querySelectorAll('article[data-selected="true"]')).toHaveLength(0);
    expect(host.querySelector("#catalyst-detail-title")?.textContent).toBe(lang==="en"?"Defense & Aerospace":"国防与航空航天");
    expect(host.textContent).toContain(lang==="en"?"Selected case is outside these filters.":"所选关注项不在当前筛选结果中。");
    const input=host.querySelector<HTMLInputElement>('input[type="search"]')!;act(()=>input.focus());
    search("no-match-for-this-snapshot");
    expect(host.querySelectorAll("article")).toHaveLength(0);expect(document.activeElement).toBe(input);
    expect(host.querySelector("#catalyst-detail-title")?.textContent).toBe(lang==="en"?"Defense & Aerospace":"国防与航空航天");
    expect([...host.querySelectorAll("button")].filter(b=>b.textContent===(lang==="en"?"Clear filters":"清除筛选"))).toHaveLength(1);
    await act(async()=>{click(lang==="en"?"Copy case link":"复制关注项链接");});
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining("case=defense"));
    click(lang==="en"?"Clear filters":"清除筛选");
    expect(host.querySelectorAll("article")).toHaveLength(2);
    expect(host.querySelector("#catalyst-detail-title")?.textContent).toBe(lang==="en"?"Defense & Aerospace":"国防与航空航天");
    expect(new URL(window.location.href).searchParams.get("case")).toBe("defense");
  });
  it("allows an implicit default only while a visible watch exists",()=>{
    render();search("no-match");
    expect(host.querySelector("#catalyst-detail-title")).toBeNull();
    expect(host.textContent).not.toContain("That saved case is not present");
    expect(host.textContent).not.toContain("Copy case link");
    click("Clear filters");expect(host.querySelector("#catalyst-detail-title")?.textContent).toBe("Energy Complex");
    expect(new URL(window.location.href).searchParams.has("case")).toBe(false);
  });
  it("requires a new explicit choice to recover an absent saved case",()=>{
    historyCase("missing_theme");render();
    expect(host.querySelector("#catalyst-detail-title")).toBeNull();expect(host.querySelectorAll("article")).toHaveLength(2);
    inspect("Defense & Aerospace");
    expect(host.querySelector("#catalyst-detail-title")?.textContent).toBe("Defense & Aerospace");
    expect(host.textContent).not.toContain("That saved case is not present");expect(document.activeElement?.id).toBe("catalyst-detail-title");
  });
  it.each(["resolve","reject"] as const)("ignores a late %s after selecting another case",async settlement=>{
    const old=deferredCopy();clipboard(vi.fn(()=>old.promise));render();click("Copy case link");
    inspect("Defense & Aerospace");
    await act(async()=>{old[settlement]();});
    expect(host.querySelector("#catalyst-detail-title")?.textContent).toBe("Defense & Aerospace");
    expect(host.textContent).not.toContain("Case link copied");expect(host.textContent).not.toContain("Copy failed");
    expect(host.querySelector("#catalyst-case-link")).toBeNull();
  });
  it.each(["resolve","reject"] as const)("keeps only the latest same-case attempt when the older attempt will %s",async olderSettlement=>{
    const first=deferredCopy(), second=deferredCopy();
    clipboard(vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise));
    render();click("Copy case link");click("Copy case link");
    await act(async()=>{if(olderSettlement==="resolve")second.reject();else second.resolve();});
    const expected=host.textContent;
    const fallback=host.querySelector<HTMLTextAreaElement>("#catalyst-case-link")?.value;
    await act(async()=>{first[olderSettlement]();});
    expect(host.textContent).toBe(expected);expect(host.querySelector<HTMLTextAreaElement>("#catalyst-case-link")?.value).toBe(fallback);
    expect(host.textContent).toContain(olderSettlement==="resolve"?"Copy failed":"Case link copied");
  });
  it("clears an earlier success while the next attempt is pending",async()=>{
    const next=deferredCopy();clipboard(vi.fn().mockResolvedValueOnce(undefined).mockReturnValueOnce(next.promise));
    render();await act(async()=>{click("Copy case link");});expect(host.textContent).toContain("Case link copied");
    click("Copy case link");expect(host.textContent).not.toContain("Case link copied");expect(host.textContent).toContain("Copying case link");
    await act(async()=>{next.resolve();});
  });
  it.each(["same-case","away-and-back"] as const)("does not revive a copy after %s history navigation",async path=>{
    const old=deferredCopy();clipboard(vi.fn(()=>old.promise));historyCase("defense");render();click("Copy case link");
    if(path==="away-and-back")historyCase("energy_complex");
    historyCase("defense");
    await act(async()=>{old.reject();});
    expect(host.querySelector("#catalyst-detail-title")?.textContent).toBe("Defense & Aerospace");
    expect(host.textContent).not.toContain("Copy failed");expect(host.querySelector("#catalyst-case-link")).toBeNull();
  });
  it("does not carry feedback into a new read with identical dates and case objects",async()=>{
    const old=deferredCopy();clipboard(vi.fn(()=>old.promise));render();click("Copy case link");
    const sameView=currentView;render({view:sameView,readContext:{}});
    await act(async()=>{old.resolve();});
    expect(host.querySelector("#catalyst-detail-title")?.textContent).toBe("Energy Complex");
    expect(host.textContent).not.toContain("Case link copied");
  });
  it.each(["loading","auth","access","unavailable","no-context"] as const)("clears the prior read and its late copy on %s",async state=>{
    const old=deferredCopy();clipboard(vi.fn(()=>old.promise));render();click("Copy case link");
    const changes:Partial<CatalystOpportunityViewProps>=state==="loading"?{loading:true}:state==="no-context"?{readContext:null}:{error:state};
    render(changes);
    expect(host.querySelector("#catalyst-detail-title")).toBeNull();expect(host.querySelectorAll("article")).toHaveLength(0);
    await act(async()=>{old.reject();});
    render();expect(host.querySelector("#catalyst-detail-title")?.textContent).toBe("Energy Complex");
    expect(host.textContent).not.toContain("Copy failed");expect(host.querySelector("#catalyst-case-link")).toBeNull();
  });
  it("retires pending clipboard feedback when the component unmounts",async()=>{
    const old=deferredCopy();clipboard(vi.fn(()=>old.promise));render();click("Copy case link");
    act(()=>root.render(null));await act(async()=>{old.reject();});render();
    expect(host.textContent).not.toContain("Copy failed");expect(host.querySelector("#catalyst-case-link")).toBeNull();
  });
  it.each(["en","zh"] as const)("offers the exact prepared URL and selects it without another write in %s",async lang=>{
    const writeText=vi.fn().mockRejectedValue(new Error("clipboard unavailable"));clipboard(writeText);
    window.history.replaceState(null,"","/discover?tab=catalysts&sector=energy#source");render({lang});
    const original=window.location.href;
    await act(async()=>{click(lang==="en"?"Copy case link":"复制关注项链接");});
    const expected=new URL(original);expected.searchParams.set("case","energy_complex");
    const field=host.querySelector<HTMLTextAreaElement>("#catalyst-case-link")!;
    expect(field.value).toBe(expected.toString());expect(field.readOnly).toBe(true);
    expect(writeText).toHaveBeenCalledWith(field.value);expect(window.location.href).toBe(original);
    click(lang==="en"?"Select link":"选择链接");
    expect(document.activeElement).toBe(field);expect(field.selectionStart).toBe(0);expect(field.selectionEnd).toBe(field.value.length);
    expect(writeText).toHaveBeenCalledTimes(1);
    // Locale changes are not new reads and must preserve the prepared fallback.
    render({lang:lang==="en"?"zh":"en"});
    expect(host.querySelector<HTMLTextAreaElement>("#catalyst-case-link")?.value).toBe(expected.toString());
  });
  it("shows the same exact fallback when the clipboard API is missing",async()=>{
    Object.defineProperty(navigator,"clipboard",{configurable:true,value:undefined});
    render();await act(async()=>{click("Copy case link");});
    expect(host.querySelector<HTMLTextAreaElement>("#catalyst-case-link")?.value).toContain("case=energy_complex");
  });
  it("recovers focus when the selected detail disappears without stealing filter focus",()=>{
    historyCase("defense");render();const copy=[...host.querySelectorAll("button")].find(b=>b.textContent==="Copy case link")!;
    act(()=>copy.focus());
    const absent=data();absent.cases=absent.cases.filter(row=>row.theme_id!=="defense");
    render({view:absent,readContext:{}});
    expect(document.activeElement?.textContent).toContain("That saved case is not present");
    render();const input=host.querySelector<HTMLInputElement>('input[type="search"]')!;act(()=>input.focus());
    render({view:absent,readContext:{}});
    expect(document.activeElement).toBe(input);
  });
  it("does not apply a superseded choice's focus to history's different case",()=>{
    render();const input=host.querySelector<HTMLInputElement>('input[type="search"]')!;act(()=>input.focus());
    const choice=host.querySelector<HTMLButtonElement>('[aria-label="Inspect evidence: Defense & Aerospace"]')!;
    act(()=>{
      choice.click();
      window.history.replaceState(null,"","/discover?tab=catalysts&case=energy_complex");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(host.querySelector("#catalyst-detail-title")?.textContent).toBe("Energy Complex");
    expect(document.activeElement).toBe(input);
  });
  it("keeps the independently supplied Defense panel during ordinary market-source failure",()=>{
    render({view:null,error:"unavailable",readContext:{},defensePanel:<section>Independent Defense evidence</section>});
    expect(host.textContent).toContain("Independent Defense evidence");
    expect(host.querySelector("#catalyst-detail-title")).toBeNull();
  });
});

describe("account-bound Catalyst loading",()=>{
  it("retires a copy when the existing owner accepts a fresh read with identical source values",async()=>{
    let reads=0, resolveRefresh!:(response:Response)=>void;
    const old=deferredCopy();clipboard(vi.fn(()=>old.promise));
    vi.stubGlobal("fetch",vi.fn((url:string)=>{
      if(url.endsWith("/defense"))return Promise.resolve(new Response("{}",{status:503}));
      return reads++===0 ? Promise.resolve(new Response(JSON.stringify(fixture),{status:200}))
        : new Promise<Response>(resolve=>{resolveRefresh=resolve;});
    }));
    await act(async()=>{root.render(<CatalystOpportunityWorkspace />);});
    click("Copy case link");click("Refresh sources");
    expect(host.querySelector("#catalyst-detail-title")).toBeNull();
    await act(async()=>{resolveRefresh(new Response(JSON.stringify(fixture),{status:200}));});
    expect(host.querySelector("#catalyst-detail-title")?.textContent).toBe("Energy Complex");
    await act(async()=>{old.reject();});
    expect(host.textContent).not.toContain("Copy failed");expect(host.querySelector("#catalyst-case-link")).toBeNull();
  });
  it("does not publish an old account's copy feedback under a new account's identical snapshot",async()=>{
    const old=deferredCopy();clipboard(vi.fn(()=>old.promise));
    vi.stubGlobal("fetch",vi.fn((url:string)=>Promise.resolve(url.endsWith("/defense")
      ? new Response("{}",{status:503}) : new Response(JSON.stringify(fixture),{status:200}))));
    await act(async()=>{root.render(<CatalystOpportunityWorkspace />);});click("Copy case link");
    session.identity={id:"test-account-b"};await act(async()=>{root.render(<CatalystOpportunityWorkspace />);});
    expect(host.querySelector("#catalyst-detail-title")?.textContent).toBe("Energy Complex");
    await act(async()=>{old.resolve();});
    expect(host.textContent).not.toContain("Case link copied");expect(host.querySelector("#catalyst-case-link")).toBeNull();
  });
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
