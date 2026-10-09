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
