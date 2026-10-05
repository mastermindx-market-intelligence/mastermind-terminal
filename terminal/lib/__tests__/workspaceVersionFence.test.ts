import {describe,expect,it} from "vitest";
import {listLayouts,saveLayout,saveWorkspace} from "../layouts";
import {createLayoutFixtureDb,fixtureLayoutUserId,pokeLayoutFixtureRow} from "../layoutsFixtureDb";
const v1=()=>({schema:"workspace_layout.v1",requires:{floor:1},revision:1,name:null,link_groups:{},widgets:[],migration:{source:"none",source_revision:null}});
describe("old workspace writers preserve unsupported stored formats",()=>{
 for(const format of ["schema","floor"] as const)for(const mode of ["numbered","conversion","legacy"] as const){
  it(`${mode} cannot replace a future ${format}`,async()=>{
   const key=`version-fence-${format}-${mode}`,db=createLayoutFixtureDb(key),user=fixtureLayoutUserId(key);
   const created=await saveWorkspace(db,user,"Future",v1(),null);expect(created.ok).toBe(true);
   const future={...v1(),...(format==="schema"?{schema:"workspace_layout.v2"}:{requires:{floor:2}}),future_owner_state:{retain:"exact"}};
   pokeLayoutFixtureRow(key,user,"Future",{config:future});
   const result=mode==="legacy"?await saveLayout(db,user,{name:"Future",config:{panes:["AAPL"]},mode:"overwrite"}):await saveWorkspace(db,user,"Future",v1(),mode==="numbered"?1:null,created.ok?created.id:undefined);
   expect(result.ok).toBe(false);
   const listed=await listLayouts(db,user);expect(listed.ok).toBe(true);
   expect(listed.ok&&listed.layouts.find(row=>row.name==="Future")?.config).toEqual(future);
  });
 }
});
