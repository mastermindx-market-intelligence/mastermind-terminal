import "server-only";

import { createClient } from "@/lib/supabase/server";
import { TickerNewsContractError } from "@/lib/newsContract";

export const TICKER_NEWS_PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Authorization",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, noarchive",
} as const;

export const TICKER_NEWS_STREAM_HEADERS = {
  ...TICKER_NEWS_PRIVATE_HEADERS,
  "Content-Type": "text/event-stream; charset=utf-8",
  "X-Accel-Buffering": "no",
} as const;

function baseUrl(): string {
  const raw = process.env.TICKER_NEWS_API_BASE || process.env.BRAIN_GATEWAY_URL || "https://mastermind-x.com";
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("ticker_news_proxy:invalid_upstream_base"); }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))) {
    throw new Error("ticker_news_proxy:invalid_upstream_base");
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

async function sessionToken(): Promise<string | null> {
  const supabase = await createClient();
  const [{ data: sessionData }, { data: userData }] = await Promise.all([
    supabase.auth.getSession(),
    supabase.auth.getUser(),
  ]);
  const token = sessionData.session?.access_token;
  return token && userData.user ? token : null;
}

function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: TICKER_NEWS_PRIVATE_HEADERS });
}

function safeContentType(value: string | null, fallback = "application/json; charset=utf-8"): string {
  const out = value?.trim();
  if (!out || /[\r\n]/.test(out)) return fallback;
  return out;
}

async function upstreamFetch(req: Request, path: string, accept: string): Promise<Response | null> {
  const token = await sessionToken();
  if (!token) return null;
  return fetch(`${baseUrl()}${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: accept },
    cache: "no-store",
    signal: req.signal,
  });
}

export async function proxyTickerNewsJson<T>(
  req: Request,
  path: string,
  parse: (value: unknown) => T,
): Promise<Response> {
  let upstream: Response | null;
  try { upstream = await upstreamFetch(req, path, "application/json"); }
  catch { return jsonError(503, "gateway_unreachable"); }
  if (!upstream) return jsonError(401, "unauthenticated");

  const raw = await upstream.text();
  if (!upstream.ok) {
    return new Response(raw, {
      status: upstream.status,
      headers: { ...TICKER_NEWS_PRIVATE_HEADERS, "Content-Type": safeContentType(upstream.headers.get("content-type")) },
    });
  }

  let decoded: unknown;
  try { decoded = JSON.parse(raw); }
  catch { return jsonError(502, "invalid_upstream_payload"); }

  try {
    return Response.json(parse(decoded), { status: upstream.status, headers: TICKER_NEWS_PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof TickerNewsContractError) return jsonError(502, "invalid_upstream_payload");
    throw error;
  }
}

export async function proxyTickerNewsStream(req: Request, path: string): Promise<Response> {
  let upstream: Response | null;
  try { upstream = await upstreamFetch(req, path, "text/event-stream"); }
  catch { return jsonError(503, "gateway_unreachable"); }
  if (!upstream) return jsonError(401, "unauthenticated");

  if (!upstream.ok) {
    const raw = await upstream.text();
    return new Response(raw, {
      status: upstream.status,
      headers: { ...TICKER_NEWS_PRIVATE_HEADERS, "Content-Type": safeContentType(upstream.headers.get("content-type")) },
    });
  }

  const contentType = upstream.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("text/event-stream") || !upstream.body) {
    return jsonError(502, "invalid_upstream_stream");
  }
  return new Response(upstream.body, { status: 200, headers: TICKER_NEWS_STREAM_HEADERS });
}