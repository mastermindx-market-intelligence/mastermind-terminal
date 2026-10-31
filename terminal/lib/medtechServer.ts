import "server-only";
import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rateLimit";
import type { WatchlistDb } from "@/lib/watchlists";

export class MedTechError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

// Match the retained openFDA record grammar. Only PMA records have supplements.
// The final assertion also rejects a trailing newline, which JavaScript's $ permits.
export const EVENT_ID = /^fda-(?:510k-(?:[A-Z]\d{6}|DEN\d{6})|pma-(?:[A-Z]\d{6}|N\d{5})(?:-S\d{1,6})?)$(?![\s\S])/;
export const PMA_APPLICATION_ID = /^fda-pma-P\d{6}$(?![\s\S])/;
export const GENERATION = /^[0-9a-f]{64}$/;
export type MedTechAuth = { db: WatchlistDb; userId: string; token: string };

export function privateJson(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: {
    "cache-control": "private, no-store",
    "vary": "Authorization, Cookie",
    "x-content-type-options": "nosniff",
    "x-robots-tag": "noindex",
  } });
}

/** Macro's canonical Caddy host is the public origin; Next may see a loopback bind URL. */
function trustedWriteOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin || request.headers.get("sec-fetch-site") === "cross-site") return false;
  if (origin === "https://app.mastermind-x.com") return true;
  // Local development has no public reverse proxy. Request headers never expand this policy.
  const url = new URL(request.url);
  return process.env.NODE_ENV !== "production" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && origin === url.origin;
}

/** Verify the exact session bearer that will reach Macro. Caller headers are never forwarded. */
export async function authenticate(): Promise<MedTechAuth> {
  const client = await createClient();
  const session = await client.auth.getSession();
  if (session.error) throw new MedTechError(503, "account_unavailable");
  const token = session.data.session?.access_token;
  if (!token) throw new MedTechError(401, "sign_in_required");
  const verified = await client.auth.getUser(token);
  if (verified.error) {
    const status = verified.error.status;
    throw new MedTechError(status && status < 500 && status !== 429 ? 401 : 503,
      status && status < 500 && status !== 429 ? "sign_in_required" : "account_unavailable");
  }
  if (!verified.data.user?.id) throw new MedTechError(401, "sign_in_required");
  return { db: client as unknown as WatchlistDb, userId: verified.data.user.id, token };
}

export async function runMedTech(
  request: Request,
  write: boolean,
  action: (auth: MedTechAuth) => Promise<unknown>,
): Promise<Response> {
  try {
    const rate = rateLimit(request, { name: "medtech", max: 120 });
    if (!rate.ok) {
      const response = privateJson({ error: "rate_limited" }, 429);
      response.headers.set("retry-after", String(rate.retryAfterSec));
      return response;
    }
    const auth = await authenticate();
    if (write) {
      if (!trustedWriteOrigin(request)) {
        throw new MedTechError(403, "origin_mismatch");
      }
      if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
        throw new MedTechError(415, "json_required");
      }
    }
    return privateJson(await action(auth));
  } catch (error) {
    const known = error instanceof MedTechError ? error : new MedTechError(503, "medtech_unavailable");
    return privateJson({ error: known.code }, known.status);
  }
}

/** Bounds allocation as bytes arrive, including chunked requests and slow bodies. */
export async function boundedJson(body: ReadableStream<Uint8Array> | null, maxBytes: number,
  timeoutMs = 10_000): Promise<unknown> {
  if (!body) throw new MedTechError(400, "invalid_json");
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      void reader.cancel().catch(() => {});
      reject(new MedTechError(408, "body_timeout"));
    }, timeoutMs);
  });
  try {
    const read = async () => {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        total += part.value.byteLength;
        if (total > maxBytes) throw new MedTechError(413, "body_too_large");
        chunks.push(part.value);
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
      catch { throw new MedTechError(400, "invalid_json"); }
    };
    return await Promise.race([read(), timeout]);
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}

export function object(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some(key => !allowed.includes(key))) {
    throw new MedTechError(400, "invalid_request");
  }
  return value as Record<string, unknown>;
}

export function generation(value: unknown): string {
  if (typeof value !== "string" || !GENERATION.test(value)) throw new MedTechError(400, "invalid_snapshot");
  return value;
}

const EXPECTED_SCHEMAS = new Set([
  "medtech.health/v1", "medtech.events/v1", "medtech.event_detail/v1",
  "medtech.changes/v1", "medtech.subject/v1", "medtech.updates/v1",
]);

/** A bounded transport to the existing paid Macro API, never a source collector or arbitrary proxy. */
export async function macroRead(
  auth: MedTechAuth, path: string, params = new URLSearchParams(),
): Promise<Record<string, unknown>> {
  const parts = path.split("/");
  const eventPath = parts[0] === "" && parts[1] === "events" && EVENT_ID.test(parts[2] ?? "") &&
    (parts.length === 3 || (parts.length === 4 && parts[3] === "changes"));
  const subjectPath = parts.length === 4 && parts[0] === "" && parts[1] === "subjects" &&
    ((parts[2] === "event" && EVENT_ID.test(parts[3])) ||
      (parts[2] === "pma_application" && PMA_APPLICATION_ID.test(parts[3])));
  const allowed = path === "/health" || path === "/events" || path === "/changes" || eventPath || subjectPath;
  if (!allowed) throw new MedTechError(404, "not_found");
  const base = new URL(process.env.BRAIN_GATEWAY_URL || "https://www.mastermind-x.com");
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash ||
      (base.pathname !== "/" && base.pathname !== "")) {
    throw new MedTechError(503, "medtech_unavailable");
  }
  // Caddy owns this exact legacy alias; resolve it before sending the bearer, never by following redirects.
  if (base.origin === "https://mastermind-x.com") base.hostname = "www.mastermind-x.com";
  const url = new URL("/api/medtech" + path, base);
  url.search = params.toString();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 12_000);
  try {
    const response = await fetch(url, {
      method: "GET", headers: { authorization: "Bearer " + auth.token, accept: "application/json" },
      cache: "no-store", redirect: "error", signal: abort.signal,
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      const status = [400, 401, 402, 403, 404, 409, 429].includes(response.status) ? response.status : 503;
      const codes: Record<number, string> = {
        400: "invalid_request", 401: "sign_in_required", 402: "subscription_required",
        403: "subscription_required", 404: "not_found", 409: "snapshot_changed", 429: "rate_limited",
      };
      throw new MedTechError(status, codes[status] || "source_unavailable");
    }
    if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      void response.body?.cancel().catch(() => {});
      throw new MedTechError(503, "source_unavailable");
    }
    let dto: unknown;
    try { dto = await boundedJson(response.body, 2 * 1024 * 1024); }
    catch { throw new MedTechError(503, "source_unavailable"); }
    if (!dto || typeof dto !== "object" || Array.isArray(dto) ||
        !EXPECTED_SCHEMAS.has(String((dto as Record<string, unknown>).schema)) ||
        !GENERATION.test(String((dto as Record<string, unknown>).snapshot_id))) {
      throw new MedTechError(503, "source_unavailable");
    }
    return dto as Record<string, unknown>;
  } catch (error) {
    if (error instanceof MedTechError && error.status !== 408 && error.status !== 413) throw error;
    throw new MedTechError(503, "source_unavailable");
  } finally { clearTimeout(timer); }
}
