// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PaperSectorWorkspace, { type PaperSectorWorkspaceProps } from "@/components/sector-intelligence/PaperSectorWorkspace";
import { PaperSectorConfluence } from "@/components/sector-intelligence/PaperSectorEvidence";
import PaperSectorReturnChart from "@/components/sector-intelligence/PaperSectorReturnChart";
import { qualifyPaperReturnSeries } from "../sectorPaper";
import { type FeedMap } from "../sectorIntelligence";
import fixture from "./fixtures/measured_read_v1.json";

(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLDivElement,root:Root;
const feeds=():FeedMap=>({sector:{data:{measured_read:fixture},receipt:{source:"sector",status:"ready",path:"/marketdata/sector_central.json",asOf:"2026-10-09",observedAt:null,contentHash:"fixture",stale:false}}});
const props=():PaperSectorWorkspaceProps=>({lang:"en",theme:"light",feeds:feeds(),route:"brief",lens:"rotation",
 onRoute:vi.fn(),onLens:vi.fn(),onInspect:vi.fn(),onSources:vi.fn(),onRefresh:vi.fn(),onTurns:vi.fn()});
const render=async(p:PaperSectorWorkspaceProps)=>{await act(async()=>root.render(<PaperSectorWorkspace {...p}/>));};
const button=(name:string)=>Array.from(host.querySelectorAll("button")).find(node=>node.textContent?.trim()===name)!;
beforeEach(()=>{host=document.createElement("div");document.body.append(host);root=createRoot(host);vi.stubGlobal("ResizeObserver",class {observe(){}disconnect(){}});});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});

describe("Paper R2 controlled page",()=>{
 it("renders the four real product destinations and source-ranked Brief without changing percent units",async()=>{
  await render(props());
  const nav=host.querySelector('nav[aria-label="Sector Intelligence"]')!;
  expect(Array.from(nav.querySelectorAll("button")).map(x=>x.textContent)).toEqual(["Brief","Explore","Research","My watches"]);
  expect(host.querySelector("h2")?.textContent).toContain("Energy leads the measured");
  expect(host.textContent).toContain("+2.40%");expect(host.textContent).not.toContain("+240.00%");
  expect(host.querySelector('[data-testid="paper-sector-coverage"]')?.textContent).toContain("9 / 11");
  expect(host.textContent).toContain("Group strength.");
 });
 it("sends one composed destination action and the native measured ID to the controller",async()=>{
  const p=props();await render(p);
  await act(async()=>button("Explore rotation →").click());
  expect(p.onRoute).toHaveBeenCalledTimes(1);expect(p.onRoute).toHaveBeenCalledWith("explore","rotation");expect(p.onLens).not.toHaveBeenCalled();
  await act(async()=>button("Inspect Energy →").click());expect(p.onInspect).toHaveBeenCalledTimes(1);expect(p.onInspect).toHaveBeenCalledWith("XLE");
 });
 it("keeps the five Explore lenses and supplied native instrument",async()=>{
  const p={...props(),route:"explore" as const,explore:<div data-testid="native-instrument">Native source content</div>};await render(p);
  const nav=host.querySelector('nav[aria-label="Explore views"]')!;
  expect(Array.from(nav.querySelectorAll("button")).map(x=>x.textContent)).toEqual(["Rotation","Market map","Breadth","Confluence","Themes & overlap"]);
  await act(async()=>button("Themes & overlap").click());expect(p.onLens).toHaveBeenCalledTimes(1);expect(p.onLens).toHaveBeenCalledWith("themes");
  expect(host.querySelector('[data-testid="native-instrument"]')).not.toBeNull();
 });
 it("presents the selected dossier without another Explore instrument or page landmark",async()=>{
  await render({...props(),route:"explore",dossier:<h2>Selected dossier</h2>,explore:<p>Wrong instrument</p>});
  expect(host.textContent).toContain("Selected dossier");expect(host.textContent).not.toContain("Wrong instrument");
  expect(host.querySelectorAll("main")).toHaveLength(0);
 });
 it("passes the actual source opener and never shows stale success for access failure",async()=>{
  const p=props();p.feeds.sector!.receipt.status="access";await render(p);
  expect(host.textContent).toContain("needs access");expect(host.textContent).not.toContain("Energy leads");
  const target=button("Review sources →");await act(async()=>target.click());
  expect(p.onSources).toHaveBeenCalledWith(target);
 });
 it("keeps English and Chinese interface copy separate",async()=>{
  await render({...props(),lang:"zh"});
  expect(host.textContent).toContain("板块情报");expect(host.textContent).toContain("能源领跑");
  expect(host.textContent).not.toContain("Three places to investigate");expect(host.textContent).not.toContain("Review sources");
 });
 it("does not put a mismatched absolute-return history into the Brief",async()=>{
  await render({...props(),returnSeries:{definition:"cumulative_total_return_from_common_start",unit:"fraction",groupId:"XLK",benchmark:"SPY",currency:"USD",sourceId:"fixture",membershipRevision:null,startSession:"2026-10-08",endSession:"2026-10-09",points:[{session:"2026-10-08",groupReturn:0,benchmarkReturn:0},{session:"2026-10-09",groupReturn:.1,benchmarkReturn:.03}]}});
  expect(host.querySelector('svg[role="img"]')).toBeNull();expect(host.textContent).toContain("Common-start total-return history is not available");
 });
 it("breaks only the missing return leg, retains isolated points and provides an accessible value table",async()=>{
  const series=qualifyPaperReturnSeries({definition:"cumulative_total_return_from_common_start",unit:"fraction",groupId:"XLE",benchmark:"SPY",currency:"USD",sourceId:"fixture",membershipRevision:null,startSession:"2026-10-07",endSession:"2026-10-09",points:[{session:"2026-10-07",groupReturn:0,benchmarkReturn:0},{session:"2026-10-08",groupReturn:null,benchmarkReturn:.01},{session:"2026-10-09",groupReturn:.024,benchmarkReturn:.015}]})!;
  await act(async()=>root.render(<PaperSectorReturnChart series={series} groupName="Energy" lang="en"/>));
  expect(host.querySelectorAll('path[data-series="first"]')).toHaveLength(2);
  expect(host.querySelectorAll('path[data-series="second"]')).toHaveLength(1);
  expect(host.querySelectorAll("circle").length).toBeGreaterThanOrEqual(3);
  expect(host.querySelector("svg")?.getAttribute("preserveAspectRatio")).not.toBe("none");
  expect(host.querySelector("table")?.textContent).toContain("+2.40%");
  const missing=Array.from(host.querySelectorAll("tbody tr")).find(row=>row.textContent?.includes("2026-10-08"))!;
  expect(missing.textContent).toContain("—");expect(missing.textContent).toContain("+1.00%");
 });
});

describe("Source-local exclusions and stale disclosure",()=>{
 it("shows names and source reasons for both unmeasured sectors",async()=>{
  await render(props());
  const population=host.querySelector('[aria-label="Unmeasured sectors"]')!;
  expect(population.textContent).toContain("Real Estate");
  expect(population.textContent).toContain("Missing source input");
  expect(population.textContent).toContain("Utilities");
  expect(population.textContent).toContain("Insufficient history");
 });
 it.each(["en","zh"] as const)("keeps confluence's delayed state and source date visible in %s",async lang=>{
  const feeds:FeedMap={confluence:{data:{ok:true,sectors:[],subsectors:[]},receipt:{source:"confluence",status:"ready",path:"/marketdata/subsector_confluence.json",asOf:"2026-09-23",observedAt:"2026-10-19T00:00:00Z",contentHash:"fixture",stale:true}}};
  await act(async()=>root.render(<PaperSectorConfluence feeds={feeds} selected="" onSelect={vi.fn()} onSources={vi.fn()} stateLabel={()=>""} lang={lang}/>));
  expect(host.querySelector('[role="status"]')?.textContent).toContain(lang==="zh"?"共振来源存在延迟":"confluence source is delayed");
  expect(host.textContent).toContain("2026-09-23");
 });
});
