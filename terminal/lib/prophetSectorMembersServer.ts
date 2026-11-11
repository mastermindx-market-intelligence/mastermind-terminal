import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { BILLING_BASE, billingAuthResult } from "@/app/api/billing/gateway";
import { rateLimit } from "@/lib/rateLimit";
import {
  decodeProphetSectorMembers, PROPHET_MEMBER_STATES,
  SECTOR_MEMBERS_GROUP_ID, SECTOR_MEMBERS_MAX_LIMIT, SECTOR_MEMBERS_QUERY, SECTOR_MEMBERS_SYMBOL,
} from "./prophetSectorMembers";
import {
  applyFixtureSectorMembersQuery, SECTOR_MEMBERS_FIXTURE_DIR, fixtureGroupFile, fixtureSymbolFile,
} from "./prophetSectorMembersFixture";

export const PROPHET_SECTOR_MEMBERS_MAX_BYTES = 128 * 1024;
export const PROPHET_SECTOR_MEMBERS_DEADLINE_MS = 10_000;
const HEADERS = { "Cache-Control": "private, no-store", Vary: "Authorization, Cookie", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, noarchive" };

function error(code: string, status: number): Response {
  return Response.json({ error: code }, { status, headers: HEADERS });
}
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
function origin(): string | null {
  try {
    const url = new URL(BILLING_BASE);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return url.protocol === "https:" || (url.protocol === "http:" && local) ? url.origin : null;
  } catch { return null; }
}
function aborted(): DOMException { return new DOMException("Read cancelled", "AbortError"); }
async function within<T>(signal: AbortSignal, action: () => Promise<T>): Promise<T> {
  if (signal.aborted) throw aborted();
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(aborted());
    signal.addEventListener("abort", stop, { once: true });
    Promise.resolve().then(() => { if (signal.aborted) throw aborted(); return action(); }).then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", stop));
  });
}
async function readJSON(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json") || !response.body) throw new Error("Invalid source");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const next = await within(signal, () => reader.read());
      if (next.done) break;
      length += next.value.byteLength;
      if (length > PROPHET_SECTOR_MEMBERS_MAX_BYTES) throw new Error("Source exceeds read bound");
      chunks.push(next.value);
    }
    const joined = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined)) as unknown;
  } finally {
    // A hostile or broken stream must not extend the request deadline during cleanup.
    void reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch { /* Pending read is cancelled by the owner signal. */ }
  }
}

/** Contract query admission: only the frozen parameter set, single occurrence,
 * grammar-checked. Malformed query answers 422 like the upstream owner. */
type ForwardedQuery = { group?: string; symbol?: string; offset?: number; limit?: number; q?: string; state?: string };
function readQuery(request: Request): { ok: true; query: ForwardedQuery } | { ok: false; response: Response } {
  const query = new URL(request.url).searchParams;
  const allowed = ["group", "symbol", "offset", "limit", "q", "state"];
  for (const key of query.keys()) {
    if (!allowed.includes(key)) return { ok: false, response: error("invalid_query", 422) };
    if (query.getAll(key).length !== 1) return { ok: false, response: error("invalid_query", 422) };
  }
  const out: ForwardedQuery = {};
  const group = query.get("group");
  if (group !== null) {
    if (!SECTOR_MEMBERS_GROUP_ID.test(group)) return { ok: false, response: error("invalid_query", 422) };
    out.group = group;
  }
  const symbol = query.get("symbol");
  if (symbol !== null) {
    if (!SECTOR_MEMBERS_SYMBOL.test(symbol)) return { ok: false, response: error("invalid_query", 422) };
    out.symbol = symbol;
  }
  if (out.group !== undefined && out.symbol !== undefined) {
    return { ok: false, response: error("invalid_query", 422) };
  }
  const offset = query.get("offset");
  if (offset !== null) {
    if (!/^\d{1,7}$/.test(offset)) return { ok: false, response: error("invalid_query", 422) };
    out.offset = Number(offset);
  }
  const limit = query.get("limit");
  if (limit !== null) {
    if (!/^\d{1,3}$/.test(limit) || Number(limit) < 1 || Number(limit) > SECTOR_MEMBERS_MAX_LIMIT) {
      return { ok: false, response: error("invalid_query", 422) };
    }
    out.limit = Number(limit);
  }
  const q = query.get("q");
  if (q !== null) {
    if (!SECTOR_MEMBERS_QUERY.test(q)) return { ok: false, response: error("invalid_query", 422) };
    out.q = q;
  }
  const state = query.get("state");
  if (state !== null) {
    if (!(PROPHET_MEMBER_STATES as readonly string[]).includes(state)) {
      return { ok: false, response: error("invalid_query", 422) };
    }
    out.state = state;
  }
  return { ok: true, query: out };
}

function fixtureMode(): boolean {
  return process.env.FLOW_FIXTURE === "1" || process.env.TERMINAL_E2E_FIXTURE === "1";
}

/** Fixture branch: the committed synthetic captures answer without any
 * upstream or billing dependency (dev + Playwright), with the SAME query
 * semantics as the real endpoint (shared engine in prophetSectorMembersFixture). */
async function handleFixture(query: ForwardedQuery): Promise<Response> {
  try {
    let file: string;
    if (query.group !== undefined) file = fixtureGroupFile(query.group);
    else if (query.symbol !== undefined) file = fixtureSymbolFile(query.symbol);
    else file = "index.json";
    let body: unknown;
    try {
      body = JSON.parse(await fs.readFile(
        path.join(process.cwd(), SECTOR_MEMBERS_FIXTURE_DIR, file), "utf8")) as unknown;
    } catch {
      // Unknown group/symbol (no fixture file) reads exactly like the owner's 404.
      return Response.json({ code: "unknown_group", reason: query.group ?? query.symbol ?? null },
        { status: 404, headers: HEADERS });
    }
    const outcome = applyFixtureSectorMembersQuery(body, query);
    return Response.json(outcome.body, { status: outcome.status, headers: { ...HEADERS, "X-Flow-Source": "fixture" } });
  } catch {
    return error("fixture_unavailable", 503);
  }
}

/**
 * Transport only. Supabase verifies the session; Macro remains the sole
 * entitlement owner. The BFF forwards the frozen query set to
 * `/api/prophet/sector-members/v1`, bounds the read, and passes the owner's
 * 401/403/404/422 through; every answer is private and never cached across
 * users.
 */
export async function handleProphetSectorMembersRequest(request: Request): Promise<Response> {
  const admitted = readQuery(request);
  if (!admitted.ok) return admitted.response;

  if (fixtureMode()) {
    const limited = rateLimit(request, { name: "prophet-sector-members", max: 60 });
    if (!limited.ok) return error("rate_limited", 429);
    return handleFixture(admitted.query);
  }

  const upstreamOrigin = origin();
  if (!upstreamOrigin) return error("source_unavailable", 503);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  request.signal.addEventListener("abort", cancel, { once: true });
  if (request.signal.aborted) controller.abort();
  const timer = setTimeout(cancel, PROPHET_SECTOR_MEMBERS_DEADLINE_MS);
  let phase: "authentication" | "source" = "authentication";
  try {
    if (controller.signal.aborted) return error("source_unavailable", 503);
    const auth = await within(controller.signal, billingAuthResult);
    if (auth.status === "denied") return error("authentication_required", 401);
    if (auth.status !== "ok" || !auth.token) return error("authentication_unavailable", 502);
    const limited = rateLimit(request, { name: "prophet-sector-members", max: 60 });
    if (!limited.ok) return error("rate_limited", 429);

    phase = "source";
    const params = new URLSearchParams();
    if (admitted.query.group !== undefined) params.set("group", admitted.query.group);
    if (admitted.query.symbol !== undefined) params.set("symbol", admitted.query.symbol);
    if (admitted.query.offset !== undefined) params.set("offset", String(admitted.query.offset));
    if (admitted.query.limit !== undefined) params.set("limit", String(admitted.query.limit));
    if (admitted.query.q !== undefined) params.set("q", admitted.query.q);
    if (admitted.query.state !== undefined) params.set("state", admitted.query.state);
    const search = params.toString();
    const response = await within(controller.signal, () => fetch(
      `${upstreamOrigin}/api/prophet/sector-members/v1${search ? `?${search}` : ""}`, {
        method: "GET", headers: { Accept: "application/json", Authorization: `Bearer ${auth.token}` },
        cache: "no-store", redirect: "error", signal: controller.signal,
      }));
    if (response.status !== 200) {
      // The upstream endpoint is not deployed yet during the rollout window: a
      // 404 that is NOT the contract's unknown_group/unknown_symbol refusal is
      // an absent source, forwarded as unavailable (503) so the surface renders
      // its designed "not available yet" state instead of a wrong-group error.
      if (response.status === 404) {
        let upstreamCode: string | null = null;
        try {
          const refusal = await readJSON(response, controller.signal);
          if (record(refusal) && typeof refusal.code === "string") upstreamCode = refusal.code;
        } catch { /* non-JSON refusal body — an absent endpoint reads unavailable */ }
        if (controller.signal.aborted) return error("source_unavailable", 503);
        if (upstreamCode === "unknown_group" || upstreamCode === "unknown_symbol") {
          return Response.json({ error: upstreamCode, code: upstreamCode }, { status: 404, headers: HEADERS });
        }
        return error("source_unavailable", 503);
      }
      void response.body?.cancel().catch(() => {});
      if (response.status === 401) return error("authentication_required", 401);
      if (response.status === 403) return error("entitlement_required", 403);
      if (response.status === 422) return error("invalid_query", 422);
      return error("source_unavailable", response.status === 429 ? 429 : response.status === 503 ? 503 : 502);
    }
    const raw = await readJSON(response, controller.signal);
    // Closed-contract gate: a body outside `prophet.sector_members/v1` is never
    // forwarded for the client to half-render — the wire bytes pass through
    // only after the shared decoder admits them.
    if (!decodeProphetSectorMembers(raw)) return error("invalid_source", 502);
    return Response.json(raw, { status: 200, headers: HEADERS });
  } catch {
    if (controller.signal.aborted) return error("source_unavailable", 503);
    return error(phase === "authentication" ? "authentication_unavailable" : "source_unavailable", 502);
  } finally {
    clearTimeout(timer); request.signal.removeEventListener("abort", cancel);
    controller.abort();
  }
}
