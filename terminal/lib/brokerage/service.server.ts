import "server-only";
import { randomUUID } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { brokerageConfig, plaid, seal, unseal, type BrokerageConfig } from "./plaid.server";
import { brokerageSnapshot, type ImportedHolding } from "./snapshot";

export const TABLE = "portfolio_broker_connections";
export const brokerFields = "id,user_id,stage,secret_box,item_id,expires_at,revision,synced_at,attempted_at,sync_error,holdings";
type Service = NonNullable<ReturnType<typeof createServiceClient>>;
export type Connection = { id:string; user_id:string; stage:string; secret_box:string; item_id:string|null; expires_at:string|null;
  revision:string; synced_at:string|null; attempted_at:string|null; sync_error:boolean; holdings:ImportedHolding[] };
export function brokerageServices() {
  const config = brokerageConfig(), db = createServiceClient();
  return config && db ? {config,db} : null;
}
const bind = (owner:string,id:string,kind:string) => JSON.stringify([owner,id,kind]);
export async function linkStart(db:Service, config:BrokerageConfig, owner:string) {
  const id = randomUUID();
  const url = new URL("/portfolio",config.origin);
  url.searchParams.set("brokerage_return",id);
  const body = await plaid(config,"/link/token/create",{client_name:"Mastermind Portfolio",country_codes:["US"],language:"en",
    user:{client_user_id:owner},products:["investments"],
    ...(process.env.PLAID_OAUTH_REDIRECT_URI?{redirect_uri:process.env.PLAID_OAUTH_REDIRECT_URI}:{}),hosted_link:{completion_redirect_uri:url.href,url_lifetime_seconds:1800}});
  if (typeof body.link_token !== "string" || typeof body.hosted_link_url !== "string" ||
      !Number.isFinite(Date.parse(body.expiration))) throw new Error("Invalid Link response");
  const link = new URL(body.hosted_link_url);
  if (link.origin !== "https://secure.plaid.com") throw new Error("Invalid Link destination");
  const saved = await db.from(TABLE).insert({id,user_id:owner,stage:"pending",secret_box:seal(config,body.link_token,bind(owner,id,"link")),expires_at:body.expiration});
  if(saved.error) throw new Error("Link unavailable");
  return link.href;
}
async function fencedUpdate(db:Service,row:Connection,values:Record<string,unknown>) {
  const res=await db.from(TABLE).update({...values,revision:randomUUID()}).eq("id",row.id).eq("user_id",row.user_id)
    .eq("stage",row.stage).eq("revision",row.revision).select(brokerFields).maybeSingle();
  if(res.error) throw new Error("Connection update unavailable");
  return res.data as Connection|null;
}
export async function finishLink(db:Service, config:BrokerageConfig, row:Connection) {
  if (row.stage==="connected") return;
  if(row.stage!=="pending" || !row.expires_at || Date.parse(row.expires_at)<=Date.now()) throw new Error("Link expired or already in progress");
  const token=unseal(config,row.secret_box,bind(row.user_id,row.id,"link"));
  const status=await plaid(config,"/link/token/get",{link_token:token});
  const tokens=(status.link_sessions??[]).flatMap((s:{results?:{item_add_results?:{public_token?:string}[]}})=>
    (s.results?.item_add_results??[]).map(r=>r.public_token).filter((t):t is string=>typeof t==="string" && t.length>0));
  if(tokens.length!==1) throw new Error("Link has no confirmed institution");
  const claimed=await fencedUpdate(db,row,{stage:"exchanging"});
  if(!claimed) throw new Error("Exchange already in progress");
  // An uncertain exchange is left fenced: never blindly consume the same public token twice.
  const item=await plaid(config,"/item/public_token/exchange",{public_token:tokens[0]});
  if(typeof item.access_token!=="string" || typeof item.item_id!=="string") throw new Error("Unconfirmed exchange");
  const connected=await fencedUpdate(db,claimed,{stage:"connected",item_id:item.item_id,expires_at:null,
    secret_box:seal(config,item.access_token,bind(row.user_id,row.id,"item"))});
  if(!connected) throw new Error("Connection could not be confirmed");
  await syncConnection(db,config,connected);
}
export async function syncConnection(db:Service, config:BrokerageConfig,row:Connection) {
  if(row.stage!=="connected" || !row.item_id) throw new Error("Holdings refresh unavailable");
  const claimed=await fencedUpdate(db,row,{attempted_at:new Date().toISOString()});
  if(!claimed) throw new Error("Holdings refresh already in progress");
  try {
    const raw=await plaid(config,"/investments/holdings/get",{access_token:unseal(config,claimed.secret_box,bind(row.user_id,row.id,"item"))});
    const holdings=brokerageSnapshot(raw,row.item_id);
    if(!await fencedUpdate(db,claimed,{holdings,synced_at:new Date().toISOString(),sync_error:false})) throw new Error("Refresh superseded");
  } catch {
    await fencedUpdate(db,claimed,{sync_error:true});
    throw new Error("Holdings refresh unavailable");
  }
}
export async function disconnect(db:Service,config:BrokerageConfig,row:Connection) {
  if(row.stage!=="connected") throw new Error("Connection cannot currently be removed");
  const claimed=await fencedUpdate(db,row,{stage:"disconnecting"});
  if(!claimed) throw new Error("Disconnect already in progress");
  await plaid(config,"/item/remove",{access_token:unseal(config,row.secret_box,bind(row.user_id,row.id,"item"))});
  const deleted=await db.from(TABLE).delete().eq("id",row.id).eq("user_id",row.user_id).eq("stage","disconnecting").eq("revision",claimed.revision).select("id").maybeSingle();
  if(deleted.error || !deleted.data) throw new Error("Disconnect confirmation unavailable");
}
