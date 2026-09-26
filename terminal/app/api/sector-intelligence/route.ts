import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rateLimit";
import { NW_BASE } from "@/lib/upstreams";
import { object, sourceDate, type FeedReceipt, type SectorFeed } from "@/lib/sectorIntelligence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
// Transport of existing owner outputs only. No dossier composition or inference.
const PATHS: Record<SectorFeed, string> = {
  sector: "/sectordata/sector_central.json",
  confluence: "/marketdata/subsector_confluence.json",
  themes: "/neuralwebdata/theme_state.json",
  heatmap: "/marketdata/sp500_heatmap.json",
};
const MAX_BYTES = 4 * 1024 * 1024;

async function readJson(response: Response): Promise<{ data: unknown; hash: string }> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_BYTES) throw new Error("size");
  const type = response.headers.get("content-type") || "";
  if (!type.toLowerCase().includes("application/json")) throw new Error("content_type");
  if (!response.body) throw new Error("empty");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error("size");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
  const buffer = Buffer.concat(chunks), data: unknown = JSON.parse(buffer.toString("utf8"));
  if (!data || typeof data !== "object") throw new Error("shape");
  return { data, hash: createHash("sha256").update(buffer).digest("hex") };
}

export async function GET(req: Request): Promise<Response> {
  const source = new URL(req.url).searchParams.get("source") || "";
  // own-property test excludes __proto__/constructor and all user-supplied URLs.
  if (!Object.hasOwn(PATHS, source)) {
    return NextResponse.json({ error: "invalid_source" }, { status: 400, headers: HEADERS });
  }
  const key = source as SectorFeed;
  const baseReceipt: FeedReceipt = { source: key, path: PATHS[key], status: "unavailable",
    asOf: null, observedAt: null, stale: false, contentHash: null };
  const failure = (status: number, state: FeedReceipt["status"]) => NextResponse.json(
    { data: null, receipt: { ...baseReceipt, status: state } }, { status, headers: HEADERS });
  const rl = rateLimit(req, { name: "sector-intelligence", max: 60 });
  if (!rl.ok) return NextResponse.json({ data: null, receipt: { ...baseReceipt, status: "error" } }, {
    status: 429, headers: { ...HEADERS, "Retry-After": String(rl.retryAfterSec) },
  });
  let token: string;
  try {
    const client = await createClient();
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user) return failure(401, "access");
    const { data: { session } } = await client.auth.getSession();
    if (!session?.access_token || session.user.id !== user.id) return failure(401, "access");
    token = session.access_token;
  } catch { return failure(401, "access"); }

  // The established Neural Web origin also owns these static Macro outputs.
  // Never send a user's bearer to arbitrary env hosts, redirects, R2, or a sidecar.
  let url: URL;
  try {
    const base = new URL(NW_BASE);
    if (base.protocol !== "https:" || !["mastermind-x.com", "www.mastermind-x.com"].includes(base.hostname)
      || base.username || base.password || base.port) return failure(503, "unavailable");
    url = new URL(PATHS[key], base.origin);
  } catch { return failure(503, "unavailable"); }
  const controller = new AbortController();
  const abort = () => controller.abort();
  req.signal.addEventListener("abort", abort, { once: true });
  if (req.signal.aborted) controller.abort();
  const timer = setTimeout(abort, 6000);
  try {
    const response = await fetch(url, {
      signal: controller.signal, redirect: "manual", cache: "no-store",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (response.status === 401 || response.status === 403) return failure(response.status, "access");
    if (response.status === 404) return failure(404, "unavailable");
    if (!response.ok) return failure(503, "error");
    let parsed: { data: unknown; hash: string };
    try { parsed = await readJson(response); } catch { return failure(502, "invalid"); }
    const receipt: FeedReceipt = { ...baseReceipt, status: "ready", asOf: sourceDate(parsed.data),
      observedAt: new Date().toISOString(), stale: object(parsed.data).stale === true, contentHash: parsed.hash };
    return NextResponse.json({ data: parsed.data, receipt }, { headers: HEADERS });
  } catch { return failure(503, "error"); }
  finally { clearTimeout(timer); req.signal.removeEventListener("abort", abort); }
}
