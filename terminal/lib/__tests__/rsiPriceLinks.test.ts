import { describe, expect, it } from "vitest";
import { RSI_DIVERGENCE_MODULE } from "../suites/rsix/rsiDivergence";
import type { LabelPrim, PolyPrim, Prim, SuiteBar, SuiteColors } from "../indicator-canvas/types";
const T0 = Date.UTC(2026, 0, 1) / 1000;
const colors = Object.fromEntries(["up", "down", "flowBuy", "flowSell", "warn", "brand", "text", "muted", "neutral"].map(k => [k, `var(--${k})`])) as unknown as SuiteColors;
const price = (i: number) => 100 - .06 * i + 8 * Math.sin(i / 5) + 2 * Math.sin(i / 1.7);
const bars: SuiteBar[] = Array.from({length:240}, (_,i) => {
 const c=price(i),o=i?price(i-1):c; return {t:T0+i*86400,o,h:Math.max(c,o)+.3,l:Math.min(c,o)-.3,c,v:1000+(i%7)*80};
});
const space = (p: Prim) => (p as Prim & { coordinateSpace?: string }).coordinateSpace;
const run = (b=bars, priceLinks=true, lang: "en"|"zh"="en") => RSI_DIVERGENCE_MODULE.compute({bars:b,tf:"1D",symbol:"CAUSAL_UI_FIXTURE",isIntraday:false,s:{...RSI_DIVERGENCE_MODULE.defaults,priceLinks,showLast:16},suite:{},colors,lang});

describe("RSI divergence links its actual price anchors without manufacturing another signal", () => {
 it("emits paired price connectors for the exact native oscillator connectors", () => {
  const result=run(); const linked=result.prims.filter(p=>space(p)==="price" && p.kind==="poly") as PolyPrim[];
  expect(linked.length).toBeGreaterThan(0);
  for(const p of linked){
   const native=result.prims.find(x=>x.id===p.id.replace("rsix-price-div-c-","rsix-div-c-")) as PolyPrim;
   expect(native).toBeDefined(); expect(native.pts.map(v=>v.i)).toEqual(p.pts.map(v=>v.i)); expect(p.color).toBe(native.color);
   const low=p.id.endsWith("-bull")||p.id.endsWith("-hiddenBull");
   for(const point of p.pts) expect(point.p).toBe(low?bars[point.i].l:bars[point.i].h);
  }
 });
 it("keeps the original native geometry and event tape identical when links are switched on", () => {
  const off=run(bars,false),on=run();
  expect(on.events).toEqual(off.events);
  expect(on.prims.filter(p=>space(p)!=="price")).toEqual(off.prims);
  expect(off.prims.some(p=>space(p)==="price")).toBe(false);
  expect(RSI_DIVERGENCE_MODULE.defaults.priceLinks).toBe(false);
 });
 it("places a detection label at its first available bar on every input prefix", () => {
  const seen=new Set<string>();
  for(let n=1;n<=bars.length;n++) for(const p of run(bars.slice(0,n)).prims){
   if(space(p)!=="price"||p.kind!=="label"||seen.has(p.id))continue;
   seen.add(p.id);
   expect(p.i,p.id).toBe(n-1); expect(p.p).toBe(bars[n-1].c);
   expect(p.text).toContain("+5");
  }
  expect(seen.size).toBeGreaterThan(0);
 });
 it("has no early price link for the pivot at 100 before its fifth later bar", () => {
  const match=(p:Prim)=>space(p)==="price"&&p.kind==="poly"&&(p as PolyPrim).pts.at(-1)?.i===100;
  expect(run(bars.slice(0,105)).prims.some(match)).toBe(false);
  expect(run(bars.slice(0,106)).prims.some(match)).toBe(true);
 });
 it("keeps source confirmation timing and paired prices inspectable in the existing tooltip", () => {
  const result=run(); const labels=result.prims.filter(p=>space(p)==="price"&&p.kind==="label") as LabelPrim[];
  expect(labels.length).toBeGreaterThan(0);
  for(const label of labels){
   const tip=result.tooltips?.find(t=>t.id===label.tooltipId);
   expect(tip).toBeDefined();
   expect(tip!.rows.some(row=>row.k==="Detection delay"&&row.v==="5 bars")).toBe(true);
   expect(tip!.rows.some(row=>row.k==="Confirmation bar"&&row.v.includes(new Date(bars[label.i as number].t*1000).toISOString().slice(0,10)))).toBe(true);
  }
 });
 it("emits translated detection labels without claiming a trading entry", () => {
  const labels=run(bars,true,"zh").prims.filter(p=>space(p)==="price"&&p.kind==="label") as LabelPrim[];
  expect(labels.length).toBeGreaterThan(0); expect(labels.every(p=>p.text.includes("背离")&&!p.text.includes("BUY"))).toBe(true);
 });
});
