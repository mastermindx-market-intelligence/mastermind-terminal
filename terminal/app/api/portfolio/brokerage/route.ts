import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimit, tooMany } from "@/lib/rateLimit";
import { brokerageServices, brokerFields, TABLE, finishLink, linkStart, syncConnection, disconnect, type Connection } from "@/lib/brokerage/service.server";

const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{"Cache-Control":"private, no-store"}});
async function sessionId(){const client=await createClient(); return (await client.auth.getUser()).data.user?.id;}
export async function GET(){
  const owner=await sessionId(); if(!owner) return reply({error:"signed_out"},401);
  const services=brokerageServices(); if(!services) return reply({enabled:false});
  const read=await services.db.from(TABLE).select("id,stage,synced_at,sync_error,holdings").eq("user_id",owner).in("stage",["connected","disconnecting"]).order("created_at");
  if(read.error) return reply({error:"unavailable"},503);
  return reply({enabled:true,owner,connections:read.data.map(({holdings,...connection})=>({...connection,
    accounts:[...new Set((holdings as {accountName:string}[]).map(row=>row.accountName))]}))});
}
export async function POST(req:Request){
  const owner=await sessionId(); if(!owner) return reply({error:"signed_out"},401);
  const services=brokerageServices(); if(!services) return reply({error:"unavailable"},503);
  if(req.headers.get("origin")!==services.config.origin) return reply({error:"origin"},403);
  const limiter=rateLimit(req,{name:"portfolio-brokerage",max:15}); if(!limiter.ok) return tooMany(limiter);
  const body=await req.json().catch(()=>null);
  if(!body || body.expectedOwnerId!==owner) return reply({error:"owner_changed"},409);
  try{
    const {db,config}=services;
    if(body.action==="start") return reply({url:await linkStart(db,config,owner)});
    if(!["finish","sync","disconnect"].includes(body.action) || typeof body.id!=="string" || !/^[\da-f-]{36}$/i.test(body.id)) return reply({error:"invalid_request"},400);
    const read=await db.from(TABLE).select(brokerFields).eq("id",body.id).eq("user_id",owner).maybeSingle();
    if(read.error) return reply({error:"unavailable"},503);
    if(!read.data) return reply({error:"unknown_connection"},404);
    const row=read.data as Connection;
    if(body.action==="finish") await finishLink(db,config,row);
    else if(body.action==="disconnect") await disconnect(db,config,row);
    else await syncConnection(db,config,row);
    return reply({ok:true});
  }catch{return reply({error:"connection_unconfirmed"},503);}
}
