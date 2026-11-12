import { describe, expect, it } from "vitest";
import { catalogItems, type CatalogItem } from "../shared-shell/readingPayloads";
import { researchLibrary } from "../shared-shell/researchLibrary";
const item = (id:string, published_at?:string|null, tags:string[] = [], institution="Desk"):CatalogItem => ({id,title:id,published_at,tags,institution});
describe("Research loaded-selection discovery",()=>{
 it("projects nullable tags without fabricating topics or mutating source metadata",()=>{
  const raw={items:[{id:"one",title:"One",tags:null,institution:null},{id:"two",title:"Two"},{id:"three",title:"Three",tags:["亚洲 [增长]","<b>literal</b>","Rates"]}]};
  const before=JSON.stringify(raw), parsed=catalogItems(raw)!;
  expect(parsed[0].institution).toBeUndefined();
  expect(catalogItems({items:[{id:"bad",title:"Bad",institution:123}]})).toBeNull();
  expect(parsed[0].tags).toBeUndefined();expect(parsed[1].tags).toBeUndefined();
  expect(parsed[2].tags).toEqual(raw.items[2].tags);expect(JSON.stringify(raw)).toBe(before);
  for(const tags of ["Rates",["Rates",1],{},false])expect(catalogItems({items:[{id:"one",title:"One",tags}]})).toBeNull();
 });
 it("keeps genuine dates in order and invalid or absent dates last in both directions",()=>{
  const rows=[item("missing"),item("impossible","2026-02-30"),item("old","2024-02-29"),item("recent","2026-11-03T08:00:00+08:00"),item("null",null),item("wrongLeap","2025-02-29")];
  expect(researchLibrary(rows).items.map(x=>x.id)).toEqual(["recent","old","missing","impossible","null","wrongLeap"]);
  expect(researchLibrary(rows,{sort:"date-oldest"}).items.map(x=>x.id)).toEqual(["old","recent","missing","impossible","null","wrongLeap"]);
 });
 it("rejects ambiguous or impossible clocks and retains equivalent-clock ties in supplied order",()=>{
  const rows=[item("first","2026-11-03T08:00:00+08:00"),item("second","2026-11-03T00:00:00Z"),item("badClock","2026-11-03T24:00:00Z"),item("noZone","2026-11-03T00:00:00"),item("badMonth","2026-13-01"),item("spaces"," 2026-11-03")];
  expect(researchLibrary(rows).items.map(x=>x.id)).toEqual(rows.map(x=>x.id));
  expect(researchLibrary([item("earlier","2026-11-03T00:00:00.000001Z"),item("later","2026-11-03T00:00:00.000002Z")]).items.map(x=>x.id)).toEqual(["later","earlier"]);
 });
 it("combines exact supplied Unicode and bracket labels; unknown choices never broaden the result",()=>{
  const rows=[item("a","2026-11-01",["亚洲 [增长]"],"Desk [A]"),item("b","2026-11-02",["亚洲 [增长]"],"Desk [B]"),item("c","2026-11-03",["Rates"],"Desk [A]")];
  const result=researchLibrary(rows,{topic:"亚洲 [增长]",institution:"Desk [A]"});
  expect(result.items.map(x=>x.id)).toEqual(["a"]);expect(result.loadedCount).toBe(3);expect(result.matchedCount).toBe(1);
  expect(result.institutions).toEqual(["Desk [A]","Desk [B]"]);expect(result.topics).toEqual(["Rates","亚洲 [增长]"]);
  expect(researchLibrary(rows,{topic:"增长"}).items).toEqual([]);expect(researchLibrary(rows,{institution:"desk [A]"}).items).toEqual([]);
  expect(researchLibrary(rows,{topic:"",institution:""}).items).toHaveLength(3);
 });
 it("sorts title deterministically, preserves ties and never changes the received array",()=>{
  const rows=[item("b"),item("a"),{...item("second-b"),title:"b"}];const before=structuredClone(rows);
  expect(researchLibrary(rows,{sort:"title"}).items.map(x=>x.id)).toEqual(["a","b","second-b"]);expect(rows).toEqual(before);
 });
});
