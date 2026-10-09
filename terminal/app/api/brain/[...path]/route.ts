// Brain-gateway catch-all proxy — the Mastermind Brain widget (mm_brain.js) calls
// /api/brain/* same-origin with credentials:'include' and NO Authorization header (the
// Terminal has no window.MDXAuth). This route verifies the Supabase session and, when it
// has one, injects the Bearer for the gateway, streaming the response body straight through.
//
// This is a TIGHT allowlist, not a generic open proxy. Only the exact paths the widget
// needs are forwarded; everything else 404s. Thread rename (PATCH) and delete (DELETE)
// target `threads/<id>` ONLY and are session-required — never guest-eligible.
//
// RUN PLANE (macro PR #3574): a chat turn is a server-side RUN, so it outlives its socket.
// The widget re-attaches with `GET runs/<id>/stream?cursor=N` after a dropped connection,
// reads status with `GET runs/<id>`, recovers a lost run id with `GET runs/active`, and
// cancels with `POST runs/<id>/cancel`. Until these were allowlisted here the Terminal 404'd
// all four, so the live re-attach never worked on this surface (the widget degraded to
// re-reading the thread tail — which a GUEST does not have, leaving them with "The reply
// didn't make it through.").
//
// GUEST LANE: the gateway has an admin-toggled guest mode (a free Fast lane, N/day per
// device cookie+IP). For `GET me`, `POST stream` and the run-resume READS
// (`GET runs/<id>`, `GET runs/<id>/stream`) ONLY, a missing/invalid session no
// longer 401s here — we forward WITHOUT any Authorization header and let the GATEWAY be
// the sole authority: guest mode on → it serves tier "guest"; off → it 401s itself and we
// pass that through unchanged. The device-identity headers (x-mm-aid / x-mm-ip /
// x-mm-proxy-secret) still ride along so the gateway can meter the per-device pool AND so
// the run's guest owner resolves to the same principal that started it; the rate limit +
// body caps still apply. All other paths stay session-required 401s.
//
// Required env: BRAIN_GATEWAY_URL (default https://mastermind-x.com; VPS co-located http://127.0.0.1:8000)
// The gateway expects Authorization: Bearer <supabase access token> and does its own tier/quota checks.

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimit, tooMany } from "@/lib/rateLimit";

const GATEWAY = process.env.BRAIN_GATEWAY_URL || "https://mastermind-x.com";

// Allowlist of forwarded upstream paths, keyed by HTTP method. `stream` and
// `runs/<id>/cancel` are the POSTs; `me` / `threads` / `threads/<id>` / `runs/active` /
// `runs/<id>` / `runs/<id>/stream` are GET reads; `threads/<id>` is also the ONLY
// PATCH (rename) and DELETE target. A thread or run id is a single path segment (no
// slashes) so `threads/abc/../secret` can never slip through.
type Method = "GET" | "POST" | "PATCH" | "DELETE";

// `threads/<id>` is shared by GET (read), PATCH (rename), and DELETE. Params are
// already decoded: reject URL separators/escapes before interpolating the upstream
// path. UUIDs and the existing bounded alphanumeric/underscore/hyphen IDs remain valid.
function threadIdPath(segs: string[]): string | null {
  if (segs.length === 2 && segs[0] === "threads") {
    const id = segs[1];
    if (id && /^[A-Za-z0-9_-]{1,64}$/.test(id)) return `threads/${id}`;
  }
  return null;
}

// A run id as the gateway mints it: `uuid.uuid4().hex`. Both run and thread ids use
// a bounded charset because the resolved path is interpolated into the upstream
// URL — so a segment containing "?" or "#" would not just be
// an odd id, it would smuggle a query string (or truncate the path) into the gateway call.
// Next decodes route params, so `%3F` arrives here as a literal "?"; this charset is what
// stops it. Kept a little wider than 32 hex chars so a future id format does not 404, but
// narrow enough that no separator, dot, or percent can ever survive.
const RUN_ID = /^[A-Za-z0-9_-]{1,64}$/;

// `runs/<id>` plus an optional fixed sub-resource — the run plane. `tails` is the exact set
// of sub-resources THIS method may reach: "" is the bare `runs/<id>` status read, "stream"
// the resume, "cancel" the Stop. Anything else — a deeper path, an unknown tail — returns
// null and 404s, so widening one method never widens another.
//
// The literal id `active` is refused here: `runs/active` is a fixed COLLECTION path resolved
// separately in resolvePath, and letting it arrive through this helper would quietly make it
// guest-eligible along with the rest of the run reads (see guestOk).
function runIdPath(segs: string[], tails: readonly string[]): string | null {
  if (segs[0] !== "runs") return null;
  const id = segs[1];
  if (!id || id === "active" || !RUN_ID.test(id)) return null;
  const tail = segs.length === 2 ? "" : segs.length === 3 ? segs[2] : null;
  if (tail === null || !tails.includes(tail)) return null;
  return tail ? `runs/${id}/${tail}` : `runs/${id}`;
}

function resolvePath(method: Method, segs: string[]): string | null {
  const joined = segs.join("/");
  if (method === "POST") {
    // `stream` = SSE chat turn; `chart/state` = the Chart Bus v2 state-mirror POST (CMX W1) —
    // a small JSON body carrying the terminal's chart session + drawing acks for the gateway.
    if (joined === "stream" || joined === "chart/state") return joined;
    // `runs/<id>/cancel` = the Stop button, so an abandoned turn is not re-attached to.
    return runIdPath(segs, ["cancel"]);
  }
  // PATCH (rename) and DELETE target a single thread and nothing else.
  if (method === "PATCH" || method === "DELETE") return threadIdPath(segs);
  // GET
  if (joined === "me" || joined === "threads" || joined === "runs/active") return joined;
  // Run status read and run resume; NOT `cancel`, which is a POST.
  return runIdPath(segs, ["", "stream"]) ?? threadIdPath(segs);
}

// Identity forwarding for the co-located gateway's device-linked free-credit pool.
// The gateway trusts x-mm-aid / x-mm-ip ONLY when they carry BRAIN_PROXY_SECRET — a
// source-IP check is insufficient because the gateway sits behind Caddy on 127.0.0.1,
// so ALL public traffic appears local. We forward the visitor's first-party mm_aid
// cookie, their real client IP, and the shared secret. All empty-safe.
const PROXY_SECRET = process.env.BRAIN_PROXY_SECRET || "";
function mmAid(req: Request): string {
  const m = (req.headers.get("cookie") || "").match(/(?:^|;\s*)mm_aid=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}
function mmIp(req: Request): string {
  for (const k of ["eo-client-ip", "cf-connecting-ip", "true-client-ip"]) {
    const v = (req.headers.get(k) || "").trim();
    if (v) return v;
  }
  return (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
}
function idHeaders(req: Request): Record<string, string> {
  const h: Record<string, string> = { "x-mm-aid": mmAid(req), "x-mm-ip": mmIp(req) };
  if (PROXY_SECRET) h["x-mm-proxy-secret"] = PROXY_SECRET;
  return h;
}

// Upstream paths served through the gateway's guest lane: `GET me`, `POST stream`, and the
// run-resume READS `GET runs/<id>` + `GET runs/<id>/stream`. For these, a missing/invalid
// session is forwarded (no Authorization) so the gateway can decide; every other allowlisted
// path stays session-required.
//
// The run reads are guest-eligible because a guest has NO thread-store fallback — guests
// write no thread rows at all — so the server-side run buffer is a guest's ONLY way to get
// an answer back after a dropped connection. The gateway still owns the check: it resolves
// the run's owner from the guest principal our x-mm-aid / x-mm-ip headers carry, and 404s a
// run that principal does not own.
//
// `runs/active` is deliberately NOT guest-eligible, and the explicit refusal below is what
// keeps it that way. The gateway returns an empty list to guests on purpose: a guest
// principal is `guest:<mm_aid cookie>` or `guest:ip:<hash>`, so every anonymous visitor
// behind one CGNAT/office egress IP is the SAME principal. Enumerating run ids to it would
// hand one visitor another's question and answer. A run's 128-bit id is the guest's whole
// capability; keeping this session-required means we never even ask on their behalf.
// `runs/<id>/cancel` also stays session-required — it is cleanup, not a recovery path, and
// the widget clears its stored run id locally either way.
const GUEST_OK = new Set(["me", "stream"]);
const GUEST_OK_RUN_READ = /^runs\/[^/]+(\/stream)?$/;

function guestOk(upstreamPath: string): boolean {
  if (upstreamPath === "runs/active") return false; // never — see note above
  return GUEST_OK.has(upstreamPath) || GUEST_OK_RUN_READ.test(upstreamPath);
}

// Verify the session and return the access token, or null when there is no valid session.
// The caller decides what null means per path. We NEVER read or forward a client-supplied
// Authorization header — the only Bearer this proxy sends is one minted here from the
// server-verified session.
async function sessionToken(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!session || !user) return null;
  return session.access_token;
}

// Resolve auth for a resolved upstream path: return the outbound headers to attach
// (device identity always; Authorization only when we hold a token), or a 401 Response to
// relay when the path requires a session and none is present. Anonymous callers to a
// guestOk path get device headers but NO Authorization — the gateway does the rest.
async function authHeaders(
  req: Request,
  upstreamPath: string,
): Promise<{ headers: Record<string, string> } | { error: Response }> {
  const token = await sessionToken();
  if (!token && !guestOk(upstreamPath)) {
    return {
      error: NextResponse.json({ error: "unauthenticated" }, { status: 401 }),
    };
  }
  const headers: Record<string, string> = { ...idHeaders(req) };
  if (token) headers.Authorization = `Bearer ${token}`;
  return { headers };
}

// SSE / JSON pass-through: relay upstream status + body untouched. Streaming bodies
// (the /stream SSE) flow straight through with no buffering.
function relay(upstream: Response): Response {
  const ct =
    upstream.headers.get("content-type") ||
    "application/json; charset=utf-8";
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": ct,
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const rl = rateLimit(req, { name: "brain", max: 60 });
  if (!rl.ok) return tooMany(rl);

  const { path = [] } = await params;
  const upstreamPath = resolvePath("GET", path);
  if (!upstreamPath) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const auth = await authHeaders(req, upstreamPath);
  if ("error" in auth) return auth.error;

  // The resume cursor is the ONE query param that crosses to the gateway. This handler used
  // to drop the query string wholesale, which on `runs/<id>/stream` is not a no-op: the
  // gateway defaults `cursor` to 0 and replays the run buffer from the beginning, so every
  // re-attach would paint the whole answer into the bubble a SECOND time. Everything else in
  // the query is still discarded — the allowlist covers the query as well as the path.
  //
  // A cursor that is not a short run of digits cannot come from the widget, so it fails loudly
  // as a 400 rather than silently degrading into that replay-from-0. The length cap bounds
  // what we hand the gateway's int parser; real cursors are event counts in the thousands.
  let query = "";
  if (/^runs\/[^/]+\/stream$/.test(upstreamPath)) {
    const cursor = new URL(req.url).searchParams.get("cursor");
    if (cursor !== null) {
      if (!/^\d{1,12}$/.test(cursor)) {
        return NextResponse.json({ error: "bad_cursor" }, { status: 400 });
      }
      query = `?cursor=${cursor}`;
    }
  }

  try {
    const upstream = await fetch(`${GATEWAY}/api/brain/${upstreamPath}${query}`, {
      headers: auth.headers,
      signal: req.signal,
    });
    return relay(upstream);
  } catch (e: any) {
    return NextResponse.json(
      { error: "Gateway unreachable", detail: e?.message },
      { status: 502 },
    );
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const rl = rateLimit(req, { name: "brain", max: 60 });
  if (!rl.ok) return tooMany(rl);

  const { path = [] } = await params;
  const upstreamPath = resolvePath("POST", path);
  if (!upstreamPath) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const auth = await authHeaders(req, upstreamPath);
  if ("error" in auth) return auth.error;

  // Forward the raw body; the gateway validates the contract. Preserve the client's
  // Content-Type (defaults to JSON) so the gateway parses it correctly.
  // Body cap: text turns are ~2KB and vision turns carry up to 4 downscaled images
  // (~500KB each as data URIs) — 8MB is generous headroom while still bounding what
  // an abusive client can make this proxy buffer.
  const contentType = req.headers.get("content-type") || "application/json";
  // Path-specific body caps: the chat `stream` carries vision data URIs (up to ~8MB); the Chart Bus
  // `chart/state` mirror is a small JSON session snapshot — cap it tight at 64KB; `runs/<id>/cancel`
  // carries nothing at all (the run id is in the path), so it gets the tightest cap of the three.
  const maxBody = upstreamPath.endsWith("/cancel")
    ? 1_000
    : upstreamPath === "chart/state"
      ? 64_000
      : 8_000_000;
  const cl = req.headers.get("content-length");
  if (cl && /^\d+$/.test(cl) && parseInt(cl, 10) > maxBody) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }
  const body = await req.text();
  if (body.length > maxBody) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }

  try {
    const upstream = await fetch(`${GATEWAY}/api/brain/${upstreamPath}`, {
      method: "POST",
      headers: { "Content-Type": contentType, ...auth.headers },
      body,
      signal: req.signal,
    });
    return relay(upstream);
  } catch (e: any) {
    return NextResponse.json(
      { error: "Gateway unreachable", detail: e?.message },
      { status: 502 },
    );
  }
}

// PATCH = rename a thread. Target is `threads/<id>` ONLY and it is session-required — it is
// NOT in GUEST_OK, so an anonymous caller gets a proxy-side 401 and the gateway is never
// contacted. The body carries just the new title, so the cap is tight (4KB).
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const rl = rateLimit(req, { name: "brain", max: 60 });
  if (!rl.ok) return tooMany(rl);

  const { path = [] } = await params;
  const upstreamPath = resolvePath("PATCH", path);
  if (!upstreamPath) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const auth = await authHeaders(req, upstreamPath);
  if ("error" in auth) return auth.error;

  // Rename payload is a tiny JSON `{ title }` — cap at 4KB. Reject on advertised
  // content-length first, then on the actual body length.
  const contentType = req.headers.get("content-type") || "application/json";
  const maxBody = 4_000;
  const cl = req.headers.get("content-length");
  if (cl && /^\d+$/.test(cl) && parseInt(cl, 10) > maxBody) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }
  const body = await req.text();
  if (body.length > maxBody) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }

  try {
    const upstream = await fetch(`${GATEWAY}/api/brain/${upstreamPath}`, {
      method: "PATCH",
      headers: { "Content-Type": contentType, ...auth.headers },
      body,
      signal: req.signal,
    });
    return relay(upstream);
  } catch (e: any) {
    return NextResponse.json(
      { error: "Gateway unreachable", detail: e?.message },
      { status: 502 },
    );
  }
}

// DELETE = remove a thread. Target is `threads/<id>` ONLY and session-required (NOT in
// GUEST_OK → anonymous callers get a proxy-side 401, gateway never contacted). No body.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const rl = rateLimit(req, { name: "brain", max: 60 });
  if (!rl.ok) return tooMany(rl);

  const { path = [] } = await params;
  const upstreamPath = resolvePath("DELETE", path);
  if (!upstreamPath) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const auth = await authHeaders(req, upstreamPath);
  if ("error" in auth) return auth.error;

  try {
    const upstream = await fetch(`${GATEWAY}/api/brain/${upstreamPath}`, {
      method: "DELETE",
      headers: auth.headers,
      signal: req.signal,
    });
    return relay(upstream);
  } catch (e: any) {
    return NextResponse.json(
      { error: "Gateway unreachable", detail: e?.message },
      { status: 502 },
    );
  }
}
