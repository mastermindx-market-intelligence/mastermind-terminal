import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {describe,expect,it} from "vitest";
import {FUNDAMENTAL_FIELD_IDS} from "@/lib/fundamentalScan";
import {reviewableDefinition} from "@/lib/smartScreen/review";
import {normalizeDefinition} from "@/lib/smartScreen/predicate";

// Cross-source compatibility guard only: no SQL evaluation, database or qualification.
const sql=readFileSync(resolve(process.cwd(),"../supabase/migrations/0030_investigation_kernel.sql"),"utf8");
const declaration=sql.match(/create or replace function public\.valid_investigation_screen_record_v2\(v jsonb,p_id text\)[\s\S]*?end \$\$;/)?.[0];
if(!declaration)throw Error("retained-screen record validator is missing");
const branches=new Map([...declaration.matchAll(/when v#>'\{def,grammar\}'='(\d+)'::jsonb then public\.investigation_keys_v2\(v->'def',array\[([^\]]+)\]\)/g)].map(m=>[Number(m[1]),[...m[2].matchAll(/'([^']+)'/g)].map(k=>k[1]).sort()]));
const scope={markets:"all",asset:null,unpriced:false};
describe("native screen writer / retained SQL envelope compatibility (source only)",()=>{
 it("declares the exact keys produced by each supported native grammar",()=>{
  for(const input of [
   {grammar:1,scope,where:{all:[]}},
   {grammar:2,scope,where:{all:[]},fund:[{field:FUNDAMENTAL_FIELD_IDS[0],op:"unknown"}]},
  ]){
   const native=normalizeDefinition(input);expect(native.ok).toBe(true);
   if(native.ok)expect(branches.get(native.def.grammar)).toEqual(Object.keys(native.def).sort());
  }
  expect([...branches.keys()].sort()).toEqual([1,2]);
 });
 it("keeps the declared fundamental-array bound aligned with the native field catalogue",()=>{
  const bound=declaration.match(/jsonb_array_length\(v->'def'->'fund'\) between 1 and (\d+)/);
  expect(Number(bound?.[1])).toBe(FUNDAMENTAL_FIELD_IDS.length);
  const native=normalizeDefinition({grammar:2,scope,where:{all:[]},fund:FUNDAMENTAL_FIELD_IDS.map(field=>({field,op:"unknown"}))});
  expect(native.ok).toBe(true);
 });
 it("preserves the native prohibition on review snapshots for fundamental definitions",()=>{
  const native=normalizeDefinition({grammar:2,scope,where:{all:[]},fund:[{field:FUNDAMENTAL_FIELD_IDS[0],op:"unknown"}]});
  expect(native.ok).toBe(true);
  if(native.ok)expect(reviewableDefinition(native.def)).toBe(false);
  const grammar2=declaration.split("when v#>'{def,grammar}'='2'::jsonb then")[1]?.split("else false end")[0];
  expect(grammar2).toContain("and v->'review'='null'::jsonb");
 });

});
