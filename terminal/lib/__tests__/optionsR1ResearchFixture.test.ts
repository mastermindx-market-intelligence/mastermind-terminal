import {describe,expect,it} from "vitest";
import type {BrowserContext} from "@playwright/test";
import {ResearchStore,routeResearch,type Saved} from "../../e2e/helpers/optionsR1Research";
import {matchesInvestigationCommand,readInvestigation,type InvestigationCommand,type InvestigationDb} from "../investigations";

const command=(revision=0):InvestigationCommand=>({id:"10000000-0000-4000-8000-000000000001",operation_id:"20000000-0000-4000-8000-000000000001",
 expected_revision:revision,action:revision?"revise":"create",manifest:{schema:"investigation_manifest.v2",argument_relations:[],
 intent:{title:"Synthetic fixture research",question:"Use the current owner protocol",subjects:[]},layout_refs:[],thesis_refs:[],evidence_refs:[],continuation:{}}});

async function fixturePost(store:ResearchStore,c:InvestigationCommand){
 let routeHandler:((route:unknown)=>unknown)|undefined;
 const context={route:async(pattern:string,handler:(route:unknown)=>unknown)=>{if(pattern==="**/api/investigations{,?*}")routeHandler=handler;}} as unknown as BrowserContext;
 await routeResearch(context,store);let answer:unknown;
 await routeHandler!({request:()=>({method:()=>"POST",url:()=>"https://fixture.invalid/api/investigations",postDataJSON:()=>structuredClone(c)}),
  fulfill:async(value:{json:unknown})=>{answer=value.json;}});
 return answer as Record<string,unknown>;
}
describe("Options research browser fixture follows the native immutable receipt protocol",()=>{
 it("returns a command-bound immutable identity instead of an unconfirmable legacy-shaped response",async()=>{
  const store=new ResearchStore(),c=command(),answer=await fixturePost(store,c);
  expect(matchesInvestigationCommand(answer,c)).toBe(true);
  expect(answer.operation_id).toBe(c.operation_id);expect(answer.investigation_id).toBe(c.id);expect(answer.parent_revision_id).toBeNull();
  expect(answer.recorded_at).toBe(answer.committed_at);
  expect(matchesInvestigationCommand(answer,{...c,operation_id:"20000000-0000-4000-8000-000000000002"})).toBe(false);
 });
 it("names the fixture parent's revision UUID and preserves the old row on a new revision",async()=>{
  const store=new ResearchStore(),c=command(1);
  const prior={id:c.id,revision:1,revision_id:"50000000-0000-4000-8000-000000000001",lifecycle:"active",manifest:structuredClone(c.manifest),committed_at:"2026-10-19T14:00:00.000Z",layouts:[]} as Saved;
  store.records.set(c.id,[prior]);const before=structuredClone(prior);c.manifest.intent.question="A deliberately new assessment";
  const answer=await fixturePost(store,c);
  expect(matchesInvestigationCommand(answer,c)).toBe(true);expect(answer.parent_revision_id).toBe(prior.revision_id);
  expect(store.records.get(c.id)?.[0]).toEqual(before);expect(store.records.get(c.id)).toHaveLength(2);
 });
 it("reopens the same synthetic immutable identity through the real read-result validator",async()=>{
  const store=new ResearchStore(),c=command(),answer=await fixturePost(store,c);
  const row=store.records.get(c.id)![0];
  const db={rpc:async()=>({data:{...row,status:"found",current_revision:1},error:null})} as unknown as InvestigationDb;
  const reopened=await readInvestigation(db,c.id,1);
  expect(reopened).toMatchObject({status:"found",revision_id:answer.revision_id,
   manifest_digest:answer.manifest_digest,operation_id:c.operation_id});
 });

});
