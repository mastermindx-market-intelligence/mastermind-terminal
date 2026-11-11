import { NextResponse } from "next/server";
import { authenticateApiKey, assertNoForbiddenFields, type ApiV1Deps } from "@/lib/apiV1Server";
import { errorBody, errorStatus, type ApiV1ErrorCode } from "@/lib/apiV1";
import { createServiceClient } from "@/lib/supabase/service";
import { normalizeSymbols, normalizeSection } from "@/lib/watchlists";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_ID = /^[A-Za-z0-9_.:-]{16,128}$/;
const MAX_BODY_BYTES = 4096;

async function smallJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new Error("content type");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("empty body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new Error("body too large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Only personal watchlist additions. SQL owns current permissions, concurrency and receipts. */
export async function handleV1WatchlistAdd(request: Request, listId: string, deps?: ApiV1Deps) {
  const headers: Record<string,string> = { "Cache-Control": "no-store" };
  const fail = (code: ApiV1ErrorCode) => NextResponse.json(errorBody(code), {
    status: errorStatus(code), headers: { ...headers, ...(code === "unavailable" ? { "Retry-After": "3" } : {}) },
  });
  try {
    const authenticated = await authenticateApiKey(request, deps, true);
    if (!authenticated.ok) {
      authenticated.response.headers.set("Cache-Control", "no-store");
      return authenticated.response;
    }
    const auth = authenticated.auth;
    headers["X-RateLimit-Limit"] = String(auth.limit);
    headers["X-RateLimit-Remaining"] = String(Math.max(0, auth.remaining));
    if (!auth.scopes.includes("watchlists:write")) return fail("forbidden");
    const requestId = request.headers.get("idempotency-key") ?? "";
    if (!UUID.test(listId) || !REQUEST_ID.test(requestId)) return fail("invalid_request");
    let raw: unknown;
    try { raw = await smallJson(request); } catch { return fail("invalid_request"); }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail("invalid_request");
    const body = raw as Record<string,unknown>;
    if (Object.keys(body).some(k => k !== "symbol" && k !== "section") || typeof body.symbol !== "string" ||
        (body.section !== undefined && typeof body.section !== "string")) return fail("invalid_request");
    const symbols = normalizeSymbols(body.symbol);
    const section = normalizeSection(body.section);
    if (symbols.length !== 1 || section === null) return fail("invalid_request");
    const service = deps?.service ?? createServiceClient();
    if (!service) return fail("unavailable");
    const result = await service.rpc("api_v1_add_watchlist_symbol", {
      p_key_id: auth.keyId, p_user_id: auth.userId, p_watchlist_id: listId.toLowerCase(),
      p_request_id: requestId, p_symbol: symbols[0], p_section: section,
    });
    if (result.error) return fail("unavailable");
    const data = result.data as { status?: unknown; body?: unknown; error?: unknown; replayed?: unknown } | null;
    if ((data?.status === 200 || data?.status === 201) && data.body && typeof data.body === "object") {
      assertNoForbiddenFields(data.body);
      return NextResponse.json(data.body, { status: data.status, headers: { ...headers, "Idempotency-Replayed": String(data.replayed === true) } });
    }
    const errors: Record<number, ApiV1ErrorCode> = {400:"invalid_request",401:"unauthorized",403:"forbidden",404:"not_found",409:"idempotency_conflict",503:"unavailable"};
    return fail(typeof data?.status === "number" ? errors[data.status] ?? "unavailable" : "unavailable");
  } catch { return fail("unavailable"); }
}
