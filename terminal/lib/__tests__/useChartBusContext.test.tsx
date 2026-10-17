// @vitest-environment jsdom
import React,{act,StrictMode,useLayoutEffect} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {useChartBus,type ChartBus,type ChartBusHost} from "../useChartBus";
(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let bus:ChartBus,root:Root,element:HTMLDivElement;
const fetcher=vi.fn(async()=>({ok:true}));
function Harness({symbol,tf="1D",pane=0}:{symbol:string;tf?:string;pane?:number}){
 const host:ChartBusHost={activeSymbol:symbol,currentTf:tf,activePaneId:pane,bars:[],capabilities:{tfs:["1D","1W"],indicators:[]},sessionIndicators:[],userDrawings:[],getContextIdentity:()=>({origin_id:"existing-brain-owner",context_revision:1}),setSymbol:vi.fn(),setTf:vi.fn(),setIndicators:vi.fn(),setRange:vi.fn()};
 const next=useChartBus(host);useLayoutEffect(()=>{bus=next;},[next]);return null;
}
async function render(symbol:string,tf="1D",pane=0){await act(async()=>{root.render(<StrictMode><Harness symbol={symbol} tf={tf} pane={pane}/></StrictMode>);});}
beforeEach(()=>{vi.useFakeTimers();vi.stubGlobal("fetch",fetcher);fetcher.mockClear();element=document.createElement("div");document.body.append(element);root=createRoot(element);});
afterEach(()=>{act(()=>root.unmount());element.remove();vi.useRealTimers();vi.unstubAllGlobals();});
describe("context session belongs to the mounted Chart Bus",()=>{
 it("seeds the committed active pane and survives the StrictMode effect remount",async()=>{
  await render("AAPL");expect(bus.context?.snapshot("active-chart")?.value).toEqual({kind:"security",id:"AAPL",timeframe:"1D",pane_id:0});
 });
 it("invalidates old A responses on A-B-A and distinguishes duplicate symbols/timeframes",async()=>{
  await render("AAPL");const context=bus.context!,token=context.token("active-chart")!;
  await render("MSFT");await render("AAPL");expect(bus.context).toBe(context);expect(context.isCurrent(token)).toBe(false);
  const sameSymbol=context.token("active-chart")!;await render("AAPL","1W",1);expect(context.isCurrent(sameSymbol)).toBe(false);expect(context.snapshot("active-chart")?.value).toMatchObject({id:"AAPL",timeframe:"1W",pane_id:1});
 });
 it("read and subscribe add no mirror writes or Brain pins, and unmount closes the session",async()=>{
  await render("AAPL");await act(async()=>{await vi.advanceTimersByTimeAsync(250);});expect(fetcher).toHaveBeenCalledTimes(1);
  const context=bus.context!,token=context.token("active-chart")!;context.register({id:"read-only","group":"active_security",emit:false});context.subscribe("read-only",()=>{});context.snapshot("read-only");context.receipts();
  await act(async()=>{await vi.advanceTimersByTimeAsync(3000);});expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async()=>{root.render(null);});expect(context.isCurrent(token)).toBe(false);expect(bus.context).toBeNull();
 });
});


describe("P2 typed read model from the existing Chart Bus owner",()=>{
 it("derives current typed security from the mounted session across symbol/timeframe changes",async()=>{
  await render("AAPL");
  const owner=bus.context;
  expect(bus.readSemanticSecurity()).toEqual({
   status:"qualified",
   value:{kind:"entity_selection",ref:{owner:"terminal.analysis_symbol",kind:"security",object_id:"AAPL"}},
  });
  await render("NVDA","1W",1);
  expect(bus.context).toBe(owner);
  expect(bus.context?.snapshot("active-chart")?.value).toEqual({
   kind:"security",id:"NVDA",timeframe:"1W",pane_id:1,
  });
  expect(bus.readSemanticSecurity()).toEqual({
   status:"qualified",
   value:{kind:"entity_selection",ref:{owner:"terminal.analysis_symbol",kind:"security",object_id:"NVDA"}},
  });
 });

 it("repeated semantic reads never advance native revision or send a Brain state mirror",async()=>{
  await render("AAPL");
  const session=bus.context!;
  const start=session.snapshot("active-chart")!;
  const receiptCount=session.receipts().length;
  await act(async()=>{await vi.advanceTimersByTimeAsync(250);});
  const writes=fetcher.mock.calls.length;
  for(let i=0;i<30;i++)expect(bus.readSemanticSecurity().status).toBe("qualified");
  expect(session.snapshot("active-chart")?.group_revision).toBe(start.group_revision);
  expect(session.snapshot("active-chart")?.revision).toBe(start.revision);
  expect(session.receipts()).toHaveLength(receiptCount);
  await act(async()=>{await vi.advanceTimersByTimeAsync(1000);});
  expect(fetcher.mock.calls.length).toBe(writes);
 });
 it("returns unavailable after native Chart Bus unmount rather than keeping stale security",async()=>{
  await render("AAPL");
  const read=()=> bus.readSemanticSecurity();
  expect(read()).toMatchObject({status:"qualified"});
  await act(async()=>{root.render(null);});
  expect(read()).toEqual({status:"unsupported",reason:"chart_session_unavailable"});
 });
});


import { createAiContextProvider, type AiContextClientV1 } from "../aiContext";
import type { SemanticChartBrainComparison } from "../semanticContextAdapters";

describe("P2 Chart Bus / Brain read-only context compatibility receipt", () => {
 const compare = (read: () => AiContextClientV1) => (
  bus as ChartBus & { readSemanticBrainCompatibility: (reader: () => AiContextClientV1) => SemanticChartBrainComparison }
 ).readSemanticBrainCompatibility(read);

 it("compares the existing committed security/timeframe without changing either owner", async () => {
  const brain = createAiContextProvider({symbol:"AAPL",timeframe:"1D"});
  await render("AAPL","1D",0);
  const session=bus.context!;
  const before=session.snapshot("active-chart")!;
  const first=brain.getAiContext();
  const receipt=compare(brain.getAiContext);
  expect(receipt).toMatchObject({
   status:"compatible",symbol:"AAPL",timeframe:"1D",
   chart:{epoch:before.epoch,group_revision:before.group_revision,incarnation:before.incarnation},
   brain:{origin_id:first.origin_id,context_revision:first.context_revision},
  });
  for(let n=0;n<25;n++)expect(compare(brain.getAiContext).status).toBe("compatible");
  expect(brain.getAiContext().context_revision).toBe(first.context_revision);
  expect(session.snapshot("active-chart")).toEqual(before);
 });

 it("reports stale Brain symbol then timeframe and only accepts an updated provider",async()=>{
  const brain = createAiContextProvider({symbol:"AAPL",timeframe:"1D"});
  await render("AAPL");
  await render("NVDA","1W",1);
  expect(compare(brain.getAiContext)).toEqual({status:"incompatible",reason:"symbol_mismatch"});
  brain.noteContextChange({symbol:"NVDA",timeframe:"1D"});
  expect(compare(brain.getAiContext)).toEqual({status:"incompatible",reason:"timeframe_mismatch"});
  brain.noteContextChange({symbol:"NVDA",timeframe:"1W"});
  expect(compare(brain.getAiContext)).toMatchObject({status:"compatible",symbol:"NVDA",timeframe:"1W"});
 });

 it("refuses absent Brain identity, an unlinked chart, and unmount",async()=>{
  await render("AAPL");
  const empty=createAiContextProvider();
  expect(compare(empty.getAiContext)).toEqual({status:"unsupported",reason:"brain_context_unavailable"});
  const valid=createAiContextProvider({symbol:"AAPL",timeframe:"1D"});
  expect(bus.context?.setMode("active-chart","local")).toBe(true);
  expect(compare(valid.getAiContext)).toEqual({status:"unsupported",reason:"chart_not_following"});
  await act(async()=>{root.render(null);});
  expect(compare(valid.getAiContext)).toEqual({status:"unsupported",reason:"chart_session_unavailable"});
 });

 it("refuses a chart-generation change inside a supplied Brain read rather than claiming compatible",async()=>{
  const brain=createAiContextProvider({symbol:"AAPL",timeframe:"1D"});
  await render("AAPL");
  const session=bus.context!;
  const receipt=compare(()=>{
    const source=session.snapshot("active-chart")!;
    expect(session.publish({
      epoch:source.epoch,origin:source.consumer,origin_generation:source.incarnation,
      sequence:source.group_revision+100,
      value:{kind:"security",id:"NVDA",timeframe:"1D",pane_id:0},
    }).status).toBe("applied");
    return brain.getAiContext();
  });
  expect(receipt).toEqual({status:"incompatible",reason:"chart_generation_changed"});
 });
});
