// @vitest-environment jsdom
import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
const fake=vi.hoisted(()=>({id:"11111111-1111-4111-8111-111111111111",meta:{} as Record<string,unknown>,readError:false,writeError:false,updates:[] as Record<string,unknown>[]}));
vi.mock("@/lib/supabase/client",()=>({createClient:()=>({auth:{getUser:async()=>fake.readError?{data:{user:null},error:{message:"offline"}}:{data:{user:{id:fake.id,user_metadata:fake.meta}},error:null},updateUser:async({data}:{data:Record<string,unknown>})=>{fake.updates.push(data);if(fake.writeError)return{error:{message:"offline"}};fake.meta={...fake.meta,...data};return{error:null};}}})}));
vi.mock("@/lib/i18n",()=>({applyLang:vi.fn()}));
import {__loadOwner,__marketPrefsSnapshot,__resetMarketPrefsStore,currentOwnerToken,persistDiscover,deleteDiscover,renameDiscover,persistTradeTypes,retryPrefSync} from "@/lib/useMarketPrefs";
import {parseDiscoverView,discoverViewKey,DISCOVER_CURRENT_KEY,DISCOVER_LOCAL_KEY} from "@/lib/discoverWorkspace";
const a="a".repeat(32),b="b".repeat(32);
const view=(id=a)=>parseDiscoverView({schema:1,id,name:id===a?"A":"B",columns:["sym","verdict","regimeBull","last"],density:"c",sort:{k:"dv",dir:-1},filters:{market:"all"},technical:null,fundamental:[],search:""})!;
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve()};
const load=async()=>{__loadOwner("account:"+fake.id);await flush()};
beforeEach(()=>{vi.useFakeTimers();localStorage.clear();__resetMarketPrefsStore();fake.id="11111111-1111-4111-8111-111111111111";fake.meta={};fake.updates=[];fake.readError=false;fake.writeError=false});
afterEach(()=>{__resetMarketPrefsStore();vi.useRealTimers()});
describe("Discover uses the existing account owner",()=>{
 it("hydrates without writes, then round-trips a named view edit while preserving siblings",async()=>{
   fake.meta={[DISCOVER_CURRENT_KEY]:view(),[discoverViewKey(a)]:view(),[discoverViewKey(b)]:view(b)};await load();expect(fake.updates).toHaveLength(0);
   const edited={...view(),columns:["sym","chg","verdict"] as const};expect(persistDiscover({...edited,columns:[...edited.columns]},true,currentOwnerToken())).toBe(true);await flush();
   expect(fake.meta[discoverViewKey(b)]).toEqual(view(b));expect((fake.meta[discoverViewKey(a)] as any).columns).toEqual(edited.columns);
   __resetMarketPrefsStore();await load();expect(__marketPrefsSnapshot().discover.views.find(v=>v.id===a)?.columns).toEqual(edited.columns);
 });
 it("renames/deletes an inactive view without changing current or another view's contents",async()=>{
   fake.meta={[DISCOVER_CURRENT_KEY]:view(),[discoverViewKey(a)]:view(),[discoverViewKey(b)]:view(b)};await load();renameDiscover(b,"Renamed",currentOwnerToken());await flush();
   expect(fake.updates[0]).toEqual({[discoverViewKey(b)]:{...view(b),name:"Renamed"}});expect(__marketPrefsSnapshot().discover.current).toEqual(view());
   deleteDiscover(b,currentOwnerToken());await flush();expect(fake.updates.at(-1)).toEqual({[discoverViewKey(b)]:null});
 });
 it("clears current's saved identity when deleting the active named view",async()=>{
   fake.meta={[DISCOVER_CURRENT_KEY]:view(),[discoverViewKey(a)]:view()};await load();deleteDiscover(a,currentOwnerToken());await flush();
   expect((fake.updates.at(-1)?.[DISCOVER_CURRENT_KEY] as any).id).toBe("current");expect(__marketPrefsSnapshot().discover.views).toEqual([]);
 });
 it("rejects delayed callbacks across A to B to A owner generations",async()=>{
   await load();const token=currentOwnerToken();fake.id="22222222-2222-4222-8222-222222222222";await load();fake.id="11111111-1111-4111-8111-111111111111";await load();
   expect(persistDiscover(view(),true,token)).toBe(false);expect(fake.updates).toEqual([]);
 });
 it("uses same-owner cache on failed hydrate and does not overwrite the unread account",async()=>{
   localStorage.setItem(DISCOVER_LOCAL_KEY,JSON.stringify({["account:"+fake.id]:{[DISCOVER_CURRENT_KEY]:view()}}));fake.readError=true;await load();
   expect(__marketPrefsSnapshot().discover.current).toEqual(view());expect(__marketPrefsSnapshot().base).toBe("retrying");expect(persistDiscover(view(),true,currentOwnerToken())).toBe(false);expect(fake.updates).toEqual([]);
 });
 it("reports failed delivery until retry acknowledgement and never replays acknowledged view keys",async()=>{
   await load();fake.writeError=true;persistDiscover(view(),true,currentOwnerToken());await flush();expect(__marketPrefsSnapshot().sync.phase).toBe("failed");
   fake.writeError=false;retryPrefSync();await flush();expect(__marketPrefsSnapshot().sync.phase).toBe("saved");persistTradeTypes(["stocks"]);await flush();expect(fake.updates.at(-1)).toEqual({trade_types:["stocks"]});
 });
 it("preserves future-format bytes and refuses incompatible writes",async()=>{
   fake.meta={[discoverViewKey(a)]:{schema:2,id:a}};await load();expect(__marketPrefsSnapshot().discover.blocked).toBe(true);expect(persistDiscover(view(b),true)).toBe(false);expect(fake.updates).toEqual([]);
 });
});
