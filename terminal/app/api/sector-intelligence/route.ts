import { intelligenceResponse } from "@/lib/shared-shell/intelligenceResponse";
import { qualifyFinvizMembershipManifest } from "@/lib/finvizMembershipManifest";
import { normalizeFinviz, TIMEFRAMES } from "@/lib/finvizThemes";
import { isAdminRequest } from "@/lib/adminGate";
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rateLimit";
import { NW_BASE } from "@/lib/upstreams";
import { qualifyRiskEnvelope } from "@/lib/marketRisk";
import { object, number, feedSourceStamp, readableOwnerEnvelope, type FeedReceipt, type SectorFeed } from "@/lib/sectorIntelligence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };
// Transport of existing owner outputs only. No dossier composition or inference.
const PATHS: Record<SectorFeed, string> = {
  sector: "/sectordata/sector_central.json",
  confluence: "/marketdata/subsector_confluence.json",
  themes: "/neuralwebdata/theme_state.json",
  heatmap: "/marketdata/sp500_heatmap.json",
  finviz: "/marketdata/themes_heatmap.json",
  risk: "/riskdata/risk_envelope.json",
  history: "/sectordata/sector_cycles.json",
  events: "/marketdata/rotation_events.json",
  relative_trend: "/sectordata/sector_rotation_relative_trend.json",
  holdings: "/sectordata/sector_holdings_coverage.json",
  // The basket-pulse owner file also carries the accepted per-basket intraday comparison.
  // It is one more read of that same static owner output, on the same fixed origin and the same
  // filtered cookie; no direct browser fetch, no alternate host, no separate entitlement path.
  intraday: "/live/basket_pulse.json",
};
const MAX_BYTES = 4 * 1024 * 1024;

const SUPABASE_AUTH_COOKIE = /^sb-[A-Za-z0-9_-]+-auth-token(?:\.\d+)?$/;
type CookieValue = { name: string; value: string };
function isSupabaseAuthCookie(name: string): boolean {
  return SUPABASE_AUTH_COOKIE.test(name);
}
function filteredSupabaseCookieValues(values: readonly CookieValue[]): string | null {
  const pairs = values
    .filter(cookie => isSupabaseAuthCookie(cookie.name) && cookie.value)
    .map(cookie => `${cookie.name}=${cookie.value}`);
  return pairs.length ? pairs.join("; ") : null;
}

/** Forward only the caller's shared Supabase session cookie chunks.
 * Macro's static regwall/paywall consumes this cookie, not an Authorization bearer.
 * No unrelated Terminal cookie ever leaves this route.
 */
export function filteredSupabaseCookieHeader(req: Request): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  const values: CookieValue[] = [];
  for (const part of raw.split(";")) {
    const cookie = part.trim(), separator = cookie.indexOf("=");
    if (separator <= 0) continue;
    values.push({ name: cookie.slice(0, separator).trim(), value: cookie.slice(separator + 1) });
  }
  return filteredSupabaseCookieValues(values);
}

async function currentSupabaseCookieHeader(): Promise<string | null> {
  const store = await cookies();
  return filteredSupabaseCookieValues(store.getAll());
}

/** The owner body completed and failed a content check.
 *
 * This is a payload verdict: the owner answered, and what it sent is not the
 * owner envelope. It is deliberately distinct from an interrupted read, so a
 * body that never arrived is never reported as an invalid payload.
 */
class InvalidOwnerBody extends Error {
  constructor(readonly verdict: string) { super(`invalid_owner_body:${verdict}`); }
}

/** The owner body did not complete: the read was cut mid-stream.
 *
 * The headers already arrived, so the owner did answer — what failed is the
 * transport carrying the body. The established transport classifier decides
 * whether that was the fetch budget, the caller hanging up, or neither. The
 * interruption is never inferred from the shape or name of the exception.
 */
class InterruptedOwnerBody extends Error {
  constructor() { super("interrupted_owner_body"); }
}

async function readJson(response: Response): Promise<{ data: unknown; hash: string }> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_BYTES) throw new InvalidOwnerBody("size");
  const type = response.headers.get("content-type") || "";
  if (!type.toLowerCase().includes("application/json")) throw new InvalidOwnerBody("content_type");
  if (!response.body) throw new InvalidOwnerBody("empty");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new InvalidOwnerBody("size");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    // A body that completed and failed a content check is a payload verdict and
    // stays one. Anything else means the read was cut before the body completed.
    if (error instanceof InvalidOwnerBody) throw error;
    throw new InterruptedOwnerBody();
  } finally { reader.releaseLock(); }
  const buffer = Buffer.concat(chunks);
  let data: unknown;
  try { data = JSON.parse(buffer.toString("utf8")); }
  catch { throw new InvalidOwnerBody("json"); }
  if (!data || typeof data !== "object") throw new InvalidOwnerBody("shape");
  return { data, hash: createHash("sha256").update(buffer).digest("hex") };
}

/** Exact cause of a failed Sector Central owner fetch.
 *
 * The receipt status alone cannot separate the causes an operator must act on:
 * this gateway's own per-IP limiter, the owner origin's own 429, an owner 502
 * (that origin lost its own upstream), another 5xx from the owner origin, an
 * elapsed fetch budget, an unreachable owner origin and a body the
 * owner-envelope check rejected all collapsed into one indistinguishable
 * response. This classification rides on the receipt and the HTTP status so
 * the cause is readable without a server log.
 *
 * It is additive: the shared FeedReceipt interface is owned by an open PR, so the
 * field is not declared there. Clients that do not know it ignore it.
 */
export type FeedFailure =
  /** The local session / entitlement gate refused. */
  | "access_denied"
  /** The local gate could not answer. */
  | "gate_unavailable"
  /** This gateway's own per-IP limiter refused. */
  | "rate_limited"
  /** The owner origin answered 429. */
  | "upstream_rate_limited"
  /** The owner origin answered 401/403. */
  | "upstream_unauthorized"
  /** The owner origin answered 404. */
  | "upstream_not_found"
  /** The owner origin answered 502 — its own upstream failed or was refused.
   *  The status alone does not prove which upstream fault occurred, so the
   *  class stays neutral: it is not evidence of a reset. */
  | "upstream_bad_gateway"
  /** The owner origin answered another non-ok status. */
  | "upstream_unavailable"
  /** The owner fetch budget elapsed before the answer completed. */
  | "upstream_timeout"
  /** The owner connection failed before a complete answer arrived. */
  | "upstream_transport"
  /** The caller hung up before the origin answered. */
  | "request_aborted"
  /** The body arrived but is not the owner envelope. */
  | "payload_invalid";

async function readIncumbent(req: Request): Promise<Response> {
  const source = new URL(req.url).searchParams.get("source") || "";
  // own-property test excludes __proto__/constructor and all user-supplied URLs.
  if (!Object.hasOwn(PATHS, source)) {
    return NextResponse.json({ error: "invalid_source" }, { status: 400, headers: HEADERS });
  }
  const key = source as SectorFeed;
  const baseReceipt: FeedReceipt = { source: key, path: PATHS[key], status: "unavailable",
    asOf: null, observedAt: null, stale: false, contentHash: null };
  const failure = (status: number, state: FeedReceipt["status"], cause: FeedFailure,
    extra?: Record<string, string>) => NextResponse.json(
    { data: null, receipt: { ...baseReceipt, status: state, failure: cause } },
    { status, headers: { ...HEADERS, "X-Sector-Failure": cause, ...(extra ?? {}) } });
  const rl = rateLimit(req, { name: "sector-intelligence", max: 60 });
  if (!rl.ok) return failure(429, "error", "rate_limited", { "Retry-After": String(rl.retryAfterSec) });

  // Fail closed before authentication work when the request carries no shared
  // session credential at all. The current cookie is re-read after Supabase may
  // refresh it during lazy session initialization below.
  if (!filteredSupabaseCookieHeader(req)) return failure(401, "access", "access_denied");
  let authCookie: string | null = null;
  try {
    const client = await createClient();
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user) return failure(401, "access", "access_denied");
    // This access-token check is local session consistency only. The Macro static
    // owner gate authenticates the current filtered shared cookie forwarded below.
    const { data: { session } } = await client.auth.getSession();
    if (!session?.access_token || session.user.id !== user.id) return failure(401, "access", "access_denied");
    authCookie = await currentSupabaseCookieHeader();
  } catch { return failure(401, "access", "access_denied"); }
  if (!authCookie) return failure(401, "access", "access_denied");

  // Finviz remains INTERNAL ONLY under Macro #8509. A customer login is not
  // internal authorization. Reuse the existing owner/admin gate before fetch.
  if (key === "finviz") {
    try {
      const authority = await isAdminRequest();
      if (authority.status === "unavailable") return failure(503, "unavailable", "gate_unavailable");
      if (authority.status !== "admin") return failure(403, "access", "access_denied");
    } catch { return failure(503, "unavailable", "gate_unavailable"); }
  }

  // The established Neural Web origin also owns these static Macro outputs.
  // Never send a caller cookie to arbitrary env hosts, redirects, R2, or a sidecar.
  let url: URL;
  try {
    const base = new URL(NW_BASE);
    if (base.protocol !== "https:" || !["mastermind-x.com", "www.mastermind-x.com"].includes(base.hostname)
      || base.username || base.password || base.port) return failure(503, "unavailable", "upstream_unavailable");
    // Production canonicalizes the bare host to www. Resolve that known redirect
    // before fetch so redirect:"manual" can continue rejecting every response redirect.
    const ownerOrigin = base.hostname === "mastermind-x.com"
      ? "https://www.mastermind-x.com"
      : base.origin;
    url = new URL(PATHS[key], ownerOrigin);
  } catch { return failure(503, "unavailable", "upstream_unavailable"); }
  const controller = new AbortController();
  const abort = () => controller.abort();
  req.signal.addEventListener("abort", abort, { once: true });
  if (req.signal.aborted) controller.abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; abort(); }, 6000);
  try {
    const response = await fetch(url, {
      signal: controller.signal, redirect: "manual", cache: "no-store",
      headers: { Cookie: authCookie, Accept: "application/json" },
    });
    if (response.status === 401 || response.status === 403) return failure(response.status, "access", "upstream_unauthorized");
    if (response.status === 404) return failure(404, "unavailable", "upstream_not_found");
    if (response.status === 429) {
      // The owner origin's own limiter, not this gateway's. Its Retry-After is
      // relayed verbatim; none is invented when the origin sent none.
      const retryAfter = response.headers.get("retry-after");
      return failure(429, "error", "upstream_rate_limited", retryAfter ? { "Retry-After": retryAfter } : undefined);
    }
    // A 502 from the owner origin is that origin's own upstream failing — it
    // lost ITS upstream. It is a different class from another 5xx and is
    // relayed as the owner sent it. The status does not say which upstream
    // fault it was, so the class stays neutral and no reset is claimed.
    if (response.status === 502) return failure(502, "error", "upstream_bad_gateway");
    if (!response.ok) return failure(503, "error", "upstream_unavailable");
    let parsed: { data: unknown; hash: string };
    try { parsed = await readJson(response); }
    catch (error) {
      // The headers already arrived, so the transport classifier below has not
      // run yet. A body read that did not complete is a transport question, not
      // a payload verdict: hand it to that classifier so the recorded deadline
      // and caller-abort evidence decides the class. A body that completed and
      // failed a content check stays payload_invalid.
      if (error instanceof InterruptedOwnerBody) throw error;
      return failure(502, "invalid", "payload_invalid");
    }
    if (!readableOwnerEnvelope(key, parsed.data)) return failure(502, "invalid", "payload_invalid");
    const riskRead = key === "risk" ? qualifyRiskEnvelope(parsed.data) : null;
    const receipt: FeedReceipt = { ...baseReceipt, status: "ready", asOf: feedSourceStamp(key, parsed.data),
      observedAt: new Date().toISOString(), stale: object(parsed.data).stale === true || riskRead?.qualified === false,
      contentHash: parsed.hash, ...(riskRead ? { qualificationReasons: riskRead.reasons } : {}) };
    // Transport factual identity/membership/measurements only, never vendor prose.
    const owner = object(parsed.data);
    const membershipRead = key === "finviz"
      ? qualifyFinvizMembershipManifest(owner.membership_manifest, normalizeFinviz(owner)) : null;
    if (membershipRead?.status === "invalid") return failure(502, "invalid", "payload_invalid");
    const factualPerf = (value: unknown) => Object.fromEntries(TIMEFRAMES.map(tf => [tf, number(object(value)[tf])]));
    const data = key === "finviz" ? {
      map_type: owner.map_type, source: owner.source, asof: owner.asof,
      generated_utc: owner.generated_utc, n_tiles: owner.n_tiles, n_members: owner.n_members,
      ...(membershipRead?.status === "qualified" ? { membership_manifest: membershipRead.manifest } : {}),
      size_basis: owner.size_basis, timeframes: (owner.timeframes as unknown[]).map(value => { const row = object(value); return { key: row.key, available: row.available === true }; }),
      sectors: (owner.sectors as unknown[]).map(value => { const row = object(value); return { key: row.key, en: row.en, zh: row.zh }; }),
      tiles: (owner.tiles as unknown[]).map(value => {
        const tile = object(value);
        return { t: tile.t, name: tile.name, sector: tile.sector, size: tile.size, perf: factualPerf(tile.perf),
          members: (tile.members as unknown[]).map(value => { const member = object(value); return { t: member.t, perf: factualPerf(member.perf) }; }) };
      }),
    } : riskRead ? riskRead.envelope : parsed.data;
    return NextResponse.json({ data, receipt }, { headers: HEADERS });
  } catch {
    // The three transport outcomes are distinct and must stay distinct: an
    // elapsed fetch budget is not an unreachable origin, and neither is the
    // caller hanging up. This classifier also owns a body read that was cut
    // mid-stream, which is a transport failure for the same reason.
    if (timedOut) return failure(504, "error", "upstream_timeout");
    if (req.signal.aborted) return failure(499, "error", "request_aborted");
    return failure(502, "error", "upstream_transport");
  }
  finally { clearTimeout(timer); req.signal.removeEventListener("abort", abort); }
}

/** Compact display view over the same authenticated reader; ordinary responses are unchanged. */
export async function GET(req: Request): Promise<Response> {
  const response = await readIncumbent(req);
  const params = new URL(req.url).searchParams;
  return params.get("view") === "intelligence" && params.get("source") === "history"
    ? intelligenceResponse(response, "cycles") : response;
}
