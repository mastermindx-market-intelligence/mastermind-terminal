import "server-only";
import { BILLING_BASE, billingAuthResult } from "@/app/api/billing/gateway";
import { rateLimit } from "@/lib/rateLimit";
import { decodeCatalystView } from "./catalystOpportunity";
import { decodeDefenseContext } from "./catalystDefense";

export const CATALYST_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store", Vary: "Authorization, Cookie",
  "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, noarchive",
};
export const CATALYST_MAX_BYTES = 4 * 1024 * 1024;
export const CATALYST_DEADLINE_MS = 8000;
const OWNER_PATHS = {
  attention: "/api/catalyst-opportunities/v1",
  defense: "/api/government-revenue/defense-economics",
} as const;
type OwnerKind = keyof typeof OWNER_PATHS;

function json(value: unknown, status = 200): Response {
  return Response.json(value, {status, headers:CATALYST_RESPONSE_HEADERS});
}
function unavailable(): Response { return json({error:"CATALYST_UNAVAILABLE"},503); }
function ownerUrl(kind: OwnerKind): string | null {
  try {
    const base = new URL(BILLING_BASE);
    if (base.protocol !== "https:" || !["mastermind-x.com","www.mastermind-x.com"].includes(base.hostname)
        || base.port || base.username || base.password || base.search || base.hash || !["","/"].includes(base.pathname)) return null;
    return "https://www.mastermind-x.com" + OWNER_PATHS[kind];
  } catch { return null; }
}
function within<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error("cancelled"));
  return new Promise<T>((resolve,reject)=>{
    const abort = () => { cleanup(); reject(new Error("cancelled")); };
    const cleanup = () => signal.removeEventListener("abort",abort);
    signal.addEventListener("abort",abort,{once:true});
    promise.then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});
  });
}
async function readOwner(response: Response, signal: AbortSignal): Promise<unknown> {
  const size = Number(response.headers.get("content-length"));
  if ((Number.isFinite(size) && size > CATALYST_MAX_BYTES)
      || !response.headers.get("content-type")?.toLowerCase().includes("application/json") || !response.body) {
    void response.body?.cancel().catch(()=>undefined);
    throw new Error("invalid owner response");
  }
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const {value,done} = await within(reader.read(),signal);
      if (done) break;
      total += value.byteLength;
      if (total > CATALYST_MAX_BYTES) throw new Error("response too large");
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(()=>undefined);
    throw error;
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total); let position = 0;
  for (const chunk of chunks) {bytes.set(chunk,position);position += chunk.byteLength;}
  return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
}

/** Existing session verification; the fixed Macro route owns current site-full entitlement. */
async function handleOwnerRequest(request: Request, kind: OwnerKind): Promise<Response> {
  const url = ownerUrl(kind);
  if (!url) return unavailable();
  const limit = rateLimit(request,{name:"catalyst-opportunities",max:60});
  if (!limit.ok) return Response.json({error:"RATE_LIMITED"},{status:429,
    headers:{...CATALYST_RESPONSE_HEADERS,"Retry-After":String(limit.retryAfterSec)}});
  const controller = new AbortController(), abort = () => controller.abort();
  request.signal.addEventListener("abort",abort,{once:true});
  if (request.signal.aborted) controller.abort();
  const timer = setTimeout(abort,CATALYST_DEADLINE_MS);
  try {
    const session = await within(billingAuthResult(),controller.signal);
    if (session.status === "denied") return json({error:"AUTHENTICATION_REQUIRED"},401);
    if (session.status !== "ok" || !session.token) return unavailable();
    if (new URL(request.url).search || request.body !== null) return json({error:"INVALID_QUERY"},400);
    const response = await within(fetch(url,{
      method:"GET",headers:{Authorization:`Bearer ${session.token}`,Accept:"application/json"},
      cache:"no-store",redirect:"manual",signal:controller.signal,
    }),controller.signal);
    if (response.status === 401 || response.status === 403) {
      void response.body?.cancel().catch(()=>undefined);
      return json({error:response.status===401 ? "AUTHENTICATION_REQUIRED" : "ENTITLEMENT_REQUIRED"},response.status);
    }
    if (response.status !== 200 && response.status !== 503) {
      void response.body?.cancel().catch(()=>undefined);
      return unavailable();
    }
    if (kind === "defense") {
      if (response.status !== 200) { void response.body?.cancel().catch(()=>undefined); return unavailable(); }
      return json(decodeDefenseContext(await readOwner(response,controller.signal)));
    }
    const data = decodeCatalystView(await readOwner(response,controller.signal));
    if ((response.status === 503) !== (data.status === "unavailable")) return unavailable();
    return json(data,response.status);
  } catch { return unavailable(); }
  finally {clearTimeout(timer);request.signal.removeEventListener("abort",abort);}
}

// Only these server-owned entrypoints select an owner; requests cannot choose a URL.
export function handleCatalystRequest(request: Request): Promise<Response> {
  return handleOwnerRequest(request, "attention");
}
export function handleDefenseContextRequest(request: Request): Promise<Response> {
  return handleOwnerRequest(request, "defense");
}
