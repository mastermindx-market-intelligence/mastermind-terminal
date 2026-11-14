import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { brokerageServices, brokerFields, syncConnection, TABLE, type Connection } from "@/lib/brokerage/service.server";

export async function POST(req:Request){
  const secret=process.env.PORTFOLIO_BROKERAGE_CRON_SECRET;
  const digest=(s:string)=>createHash("sha256").update(s).digest();
  if(!secret || secret.length<32 || !timingSafeEqual(digest(req.headers.get("authorization")??""),digest("Bearer "+secret))) return new Response(null,{status:403});
  const services=brokerageServices();
  if(!services) return new Response(null,{status:503});
  const raw=await req.json().catch(()=>null);
  if(!raw || (raw.cursor!==null && (typeof raw.cursor!=="string" || !/^[a-f0-9-]{36}$/.test(raw.cursor)))) return new Response(null,{status:400});
  // Keyset pages walk the entire connected population once, with bounded provider concurrency.
  const cutoff=new Date(Date.now()-18*3600000).toISOString();
  let query=services.db.from(TABLE).select(brokerFields).eq("stage","connected")
    .or("attempted_at.is.null,attempted_at.lt."+cutoff).order("id").limit(4);
  if(raw.cursor) query=query.gt("id",raw.cursor);
  const res=await query;
  if(res.error) return new Response(null,{status:503});
  const rows=res.data as Connection[];
  const results=await Promise.allSettled(rows.map(row=>syncConnection(services.db,services.config,row)));
  return NextResponse.json({next:rows.length===4?rows.at(-1)!.id:null,attempted:rows.length,failed:results.filter(r=>r.status==="rejected").length},
    {headers:{"Cache-Control":"private, no-store"}});
}
