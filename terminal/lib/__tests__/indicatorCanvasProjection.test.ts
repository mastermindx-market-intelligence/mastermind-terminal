import { describe, expect, it } from "vitest";
import * as host from "../indicator-canvas/host";
import type { Prim, SuiteRenderBundle } from "../indicator-canvas/types";
const native={kind:"poly",id:"rsi",pts:[{i:1,p:30},{i:2,p:40}],color:"var(--up)"} as Prim;
const price={...native,id:"price",coordinateSpace:"price",pts:[{i:1,p:90},{i:2,p:85}]} as Prim;
function project(bundle:SuiteRenderBundle,space:"native"|"price"):SuiteRenderBundle{
 const fn=(host as unknown as Record<string,unknown>).projectSuiteBundle;
 expect(fn).toBeTypeOf("function");
 return (fn as (bundle:SuiteRenderBundle,space:string)=>SuiteRenderBundle)(bundle,space);
}
describe("one existing draw-list is partitioned by coordinates, never by a new event owner",()=>{
 it("puts each primitive into exactly its declared native or price projection",()=>{
  const bundle:SuiteRenderBundle={prims:[native,price],tooltips:new Map(),events:[],tables:[],candlePaint:[]};
  expect(project(bundle,"native").prims).toEqual([native]); expect(project(bundle,"price").prims).toEqual([price]);
  expect(bundle.prims).toEqual([native,price]);
 });
 it("does not clone or change signal/tooltip identities or invent a parallel tape",()=>{
  const bundle:SuiteRenderBundle={prims:[native,price],tooltips:new Map(),events:[{type:"rsix_div",i:1,dir:"bull"}],tables:[],candlePaint:[]};
  const out=project(bundle,"price"); expect(out.events).toBe(bundle.events); expect(out.tooltips).toBe(bundle.tooltips); expect(out.prims[0]).toBe(price);
 });
 it("refuses an unknown coordinate tag rather than interpreting it as oscillator data",()=>{
  const invalid={...price,coordinateSpace:"unknown"} as unknown as Prim;
  const bundle:SuiteRenderBundle={prims:[invalid],tooltips:new Map(),events:[],tables:[],candlePaint:[]};
  expect(project(bundle,"native").prims).toEqual([]);expect(project(bundle,"price").prims).toEqual([]);
 });
});
