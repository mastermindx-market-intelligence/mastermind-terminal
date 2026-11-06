import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimit, tooMany } from "@/lib/rateLimit";
import { parseInvestigationCommand, readInvestigationNativeOperation, type InvestigationDb } from "@/lib/investigations";
import { investigationApiUnavailable } from "@/lib/investigationApiAdmission";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "Vary": "Cookie" };
const respond = (body: unknown, status = 200) => NextResponse.json(body, {status,headers});

/** POST is bounded read transport only. No capture/preflight/apply/reconcile import.
 * Full original commands belong in a body, never a URL, header, or log. The
 * SAME shared CLOSED admission and current authenticated owner remain controlling.
 */
export async function POST(request: Request) {
  const unavailable = investigationApiUnavailable();
  if (unavailable) return unavailable;
  const limit = rateLimit(request,{name:"investigations-operation-read",max:30});
  if (!limit.ok) {
    const response = tooMany(limit);
    Object.entries(headers).forEach(([name,value]) => response.headers.set(name,value));
    return response;
  }
  try {
    const db = await createClient();
    const {data:{user},error} = await db.auth.getUser();
    if (error || !user) return respond({status:"unauthenticated"},401);
    if (new URL(request.url).search) return respond({status:"invalid_payload"},400);
    const maximum = 132*1024;
    const stated = Number(request.headers.get("content-length"));
    if (Number.isFinite(stated) && stated > maximum) return respond({status:"invalid_payload"},413);
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > maximum) return respond({status:"invalid_payload"},413);
    let body: unknown;
    try {body=JSON.parse(text);} catch {return respond({status:"invalid_payload"},400);}
    const command = parseInvestigationCommand(body);
    if (!command || request.headers.get("x-mm-scenario-owner") !== user.id) return respond({status:"invalid_payload"},400);
    const result = await readInvestigationNativeOperation(db as unknown as InvestigationDb,command,user.id);
    const statuses: Record<string,number> = {found:200,invalid_payload:400,not_found:404,unauthenticated:401,unavailable:503};
    const status = statuses[result.status] ?? 503;
    return respond(result,status);
  } catch {return respond({status:"unavailable"},503);}
}
