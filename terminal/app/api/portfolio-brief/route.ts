// Portfolio-brief proxy — GET-only pass-through to the macro-api desk endpoint
// (GET {GATEWAY}/api/portfolio/brief), mirroring the brain-gateway proxy pattern
// (app/api/brain/[...path]/route.ts). CSP blocks the browser from calling the gateway
// cross-origin, so the "Your book today" panel calls this same-origin route; here we
// verify the Supabase session and, when it exists, inject Authorization: Bearer <token>.
//
// AUTHORITY: the macro-api endpoint is the sole authority on the Pro entitlement (it
// checks the canonical Stripe-backed tier). We do NOT gate on `profiles.is_pro` here —
// that flag is only the terminal's initial-UI hint. This route forwards to the gateway
// and relays its status verbatim: 200 (brief), 403 {error:"pro_required",tier} (teaser),
// 503 (artifact unavailable). The one thing we short-circuit is a MISSING session: with
// no bearer to send there is nothing for the desk to key a per-user brief on, so we 401
// locally and never contact the gateway (the panel treats 401 as "hidden").
//
// FRESHNESS: this proxy holds NO success cache. The producer owns freshness — macro's
// /api/portfolio/brief loads the CURRENT holdings BEFORE it consults its own
// (uid, ctx-file-mtime, holdings-fingerprint) cache, so a brief it serves is keyed to the
// book as it stands now. A token-keyed cache here sat in front of that and could hand
// back a brief composed for an EARLIER book (and replay a success after a later failure),
// which is exactly the stale-brief symptom this route must not create. Every
// authenticated read therefore reaches the producer, and the upstream read is explicit
// `cache: "no-store"` so no framework-level cache can reintroduce the same staleness.
//
// ── the BOUND contract (X-Mastermind-Portfolio-Context: snapshot-v1) ───────────
//
// The opt-in header selects a RESPONSE CONTRACT; it grants no authority, carries no owner
// and changes nothing about authentication. The Portfolio panel opts in; ordinary callers
// (Today) do not, and their data, population, cursor and status behaviour is UNCHANGED.
//
// In bound mode the desk answers with the ordinary brief PLUS a private witness that
// describes the exact book it read. This route proves that witness against the server-
// verified owner and the Terminal's OWN canonical normalizer (lib/portfolioBriefContext
// .server.ts), and returns only a MINIMAL validated context beside the public brief. The
// witness itself — the owner's rows, notes, currency receipts — never crosses this
// boundary: a shape, identity, compatibility or transport failure is answered with a
// fixed safe unavailable body that carries no upstream text and no exception string.
//
// Required env: BRAIN_GATEWAY_URL (default https://mastermind-x.com).

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimit, tooMany } from "@/lib/rateLimit";
import {
  SNAPSHOT_CONTEXT_HEADER,
  SNAPSHOT_CONTEXT_VERSION,
  decodeSnapshotBrief,
} from "@/lib/portfolioBriefContext.server";

const GATEWAY = process.env.BRAIN_GATEWAY_URL || "https://mastermind-x.com";
const UPSTREAM = `${GATEWAY}/api/portfolio/brief`;

// The response headers every answer carries in both modes: private, never stored.
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" } as const;

/** Verify the session and return the access token AND the server-verified user id, or null
 *  when there is no valid session.
 *
 *  We NEVER read or forward a client-supplied Authorization header — the only Bearer this
 *  proxy sends is one minted here from the server-verified session. The user id is the
 *  OWNER the bound contract compares the producer's witness against; it is never taken
 *  from the request, from a cookie the client set, or from the witness itself. */
async function sessionOwner(): Promise<{ token: string; userId: string } | null> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!session || !user || !user.id) return null;
  return { token: session.access_token, userId: user.id };
}

/** The fixed safe body for every bound-mode failure. It carries no upstream text, no
 *  exception string and no field the caller did not ask for. */
function snapshotUnavailable(): Response {
  return NextResponse.json(
    { error: "portfolio_snapshot_unavailable" },
    { status: 503, headers: { ...PRIVATE_HEADERS, "X-Brief-Cache": "miss" } },
  );
}

/** Read a JSON body without ever letting a parse failure escape as an exception. */
async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** The teaser tier, from either the legacy body shape or the producer's `detail` wrapper.
 *  Only the two known tier tokens are carried on; anything else is dropped rather than
 *  relayed. */
function teaserTier(body: unknown): "free" | "insider" | null {
  if (!body || typeof body !== "object") return null;
  const candidates: unknown[] = [];
  const direct = (body as Record<string, unknown>).tier;
  candidates.push(direct);
  const detail = (body as Record<string, unknown>).detail;
  if (detail && typeof detail === "object") candidates.push((detail as Record<string, unknown>).tier);
  for (const candidate of candidates) {
    if (candidate === "free" || candidate === "insider") return candidate;
  }
  return null;
}

/**
 * The BOUND read: ask for the snapshot contract, prove the witness, and answer with the
 * public brief plus the minimal validated context.
 *
 * The entitlement statuses are classified BEFORE any witness qualification: a 401 or a 403
 * needs neither a witness nor a canonical book key, and both stay observable for the
 * current owner while the canonical read is still pending or unavailable. A failed
 * positions read is never an entitlement result.
 */
async function boundBrief(
  req: Request,
  owner: { token: string; userId: string },
): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await fetch(UPSTREAM, {
      headers: {
        Authorization: `Bearer ${owner.token}`,
        Accept: "application/json",
        [SNAPSHOT_CONTEXT_HEADER]: SNAPSHOT_CONTEXT_VERSION,
      },
      cache: "no-store",
      signal: req.signal,
    });
  } catch {
    // The gateway is unreachable. One fixed safe body — never the exception's text.
    return snapshotUnavailable();
  }

  const status = upstream.status;
  if (status === 401) {
    return NextResponse.json(
      { error: "unauthenticated" },
      { status: 401, headers: { ...PRIVATE_HEADERS, "X-Brief-Cache": "miss" } },
    );
  }
  if (status === 403) {
    const tier = teaserTier(await readJson(upstream));
    return NextResponse.json(
      tier ? { error: "pro_required", tier } : { error: "pro_required" },
      { status: 403, headers: { ...PRIVATE_HEADERS, "X-Brief-Cache": "miss" } },
    );
  }
  if (status !== 200) {
    // Every other upstream status is an honest "the brief is not available" — with the
    // upstream's own status preserved where it is a real status, and a fixed body.
    const safe = status >= 400 && status <= 599 ? status : 503;
    return NextResponse.json(
      { error: "unavailable" },
      { status: safe, headers: { ...PRIVATE_HEADERS, "X-Brief-Cache": "miss" } },
    );
  }

  const decoded = decodeSnapshotBrief(await readJson(upstream), owner.userId);
  if (!decoded.ok) {
    // Parse, shape, identity, count or compatibility failure: ONE fixed safe answer. The
    // witness, the upstream body and the reason code never reach the browser.
    return snapshotUnavailable();
  }
  return NextResponse.json(
    { ...decoded.brief, context: decoded.context },
    { headers: { ...PRIVATE_HEADERS, "X-Brief-Cache": "miss" } },
  );
}

export async function GET(req: Request) {
  const rl = rateLimit(req, { name: "portfolio-brief", max: 30 });
  if (!rl.ok) return tooMany(rl);

  // The header's PRESENCE selects the contract. An unsupported version is TOLD, never
  // quietly answered with an ordinary response a caller would read as a witness.
  const requested = req.headers.get(SNAPSHOT_CONTEXT_HEADER);
  const bound = requested !== null;
  if (bound && requested!.trim() !== SNAPSHOT_CONTEXT_VERSION) {
    return NextResponse.json(
      { error: "unsupported_portfolio_context" },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }

  const owner = await sessionOwner();
  // No session → nothing to key a per-user brief on. 401 locally; the panel hides itself.
  if (!owner) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  if (bound) return boundBrief(req, owner);

  try {
    const upstream = await fetch(UPSTREAM, {
      headers: { Authorization: `Bearer ${owner.token}`, Accept: "application/json" },
      // Explicitly uncached: the producer is the freshness authority (it keys its own
      // cache to the live holdings), so this read must always observe the remote.
      cache: "no-store",
      signal: req.signal,
    });
    const contentType =
      upstream.headers.get("content-type") || "application/json; charset=utf-8";
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, no-store",
        // Diagnostic only. There is no proxy cache any more, so a response can never be
        // a proxy-cache hit — say "miss" truthfully rather than claim a hit.
        "X-Brief-Cache": "miss",
      },
    });
  } catch (e: unknown) {
    // Gateway unreachable — the panel renders one quiet "unavailable" line and the
    // Conviction Book below is never blocked. 503 keeps the panel's unavailable branch.
    const detail = (e as { message?: string } | null | undefined)?.message;
    return NextResponse.json(
      { error: "gateway_unreachable", detail },
      { status: 503 },
    );
  }
}
