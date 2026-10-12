import { NextResponse } from "next/server";
import { rateLimit, tooMany } from "@/lib/rateLimit";
import { hasLiveOptions } from "@/lib/entitlement";
// Shared server-side data path (fixture / backend→R2 / server-side flowScore).
// The proprietary flow_score_v1 model stays server-only inside flowSource — see SECURITY.md.
import {
  isValidF,
  fixtureFor,
  attachFlowScores,
  tryFetchUpstream,
  tryFetchUpstreamResult,
} from "@/lib/flowSource";
import { fetchOptionsAlphaCandidatePair } from "@/lib/optionsAlphaCandidatePair";

// Bare-minimum in-memory cache so concurrent renders share one fetch.
type CacheEntry = { data: Record<string, unknown>; ts: number };
const CACHE: Record<string, CacheEntry> = {};
const TTL_MS = 30_000;

// Inflight dedup: a single background revalidation promise per cache key.
// Without this, N concurrent stale requests each fire a separate upstream fetch.
const INFLIGHT: Record<string, Promise<Record<string, unknown> | null> | undefined> = {};

function revalidateFlow(f: string): Promise<Record<string, unknown> | null> {
  if (INFLIGHT[f]) return INFLIGHT[f];
  // The same in-flight owner serves ordinary SWR and explicit Leaders refresh,
  // so two users cannot create competing source-check workers for one key.
  const request = tryFetchUpstream(f).then(
    (data) => {
      if (data) {
        attachFlowScores(f, data);
        CACHE[f] = { data, ts: Date.now() };
      }
      return data;
    },
    () => null,
  ).finally(() => {
    if (INFLIGHT[f] === request) delete INFLIGHT[f];
  });
  INFLIGHT[f] = request;
  return request;
}

export async function GET(req: Request): Promise<Response> {
  const rl = rateLimit(req, { name: "flow" });
  if (!rl.ok) return tooMany(rl);
  // Options data is a PAID feature — enforced SERVER-SIDE against the macro-api
  // entitlement authority: the `terminal_live_options` feature from /api/me
  // (config/plans.yml — essential + pro, incl. trial), NOT profiles.is_pro (a UI
  // hint that can drift; see AGENTS.md). Dev fixture mode is exempt.
  if (process.env.FLOW_FIXTURE !== "1" && !(await hasLiveOptions())) {
    return NextResponse.json(
      { error: "pro_required" },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }
  const url = new URL(req.url);
  const f = url.searchParams.get("f") ?? "feed";
  if (!isValidF(f)) {
    // Every response on this route carries no-store, error branches included:
    // EdgeOne keys /api/* error responses WITHOUT the auth cookie, so an
    // uncacheable-marker gap here can be replayed to an entitled caller.
    return NextResponse.json(
      { error: "bad f param" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  // Dev fixture mode: return static fixture data without touching any upstream.
  if (process.env.FLOW_FIXTURE === "1") {
    // Candidate evidence is only meaningful as its verified R2 payload/receipt pair.
    // There is deliberately no synthetic one-object fallback.
    if (f === "options_alpha_candidate_feed") {
      return NextResponse.json(
        { error: "feed unavailable" },
        { status: 503, headers: { "Cache-Control": "private, no-store" } }
      );
    }
    try {
      const data = await fixtureFor(f);
      attachFlowScores(f, data);
      return NextResponse.json(data, {
        headers: { "Cache-Control": "no-store", "X-Flow-Source": "fixture" },
      });
    } catch {
      return NextResponse.json(
        { error: "fixture unavailable" },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }
  }

  // The candidate feed is a coupled, raw-byte-attested R2 pair. It is always fetched and
  // verified for this request: never enter the generic SWR cache or its stale background path.
  if (f === "options_alpha_candidate_feed") {
    try {
      return NextResponse.json(await fetchOptionsAlphaCandidatePair(), {
        headers: { "Cache-Control": "no-store", "X-Flow-Source": "options-alpha-r2-pair" },
      });
    } catch {
      // Do not reveal which contract check failed to an unauthenticated edge/cache layer.
      return NextResponse.json({ error: "feed unavailable" }, {
        status: 503, headers: { "Cache-Control": "private, no-store" },
      });
    }
  }

  // Only a user-explicit Leaders check can bypass the server's 30-second
  // display cache. Keep entitlement/rate limits and the existing in-flight
  // owner intact; other flow families preserve their established TTL.
  if (f === "leaders" && url.searchParams.get("refresh") === "1") {
    const previous = CACHE[f];
    const refreshed = await revalidateFlow(f);
    if (refreshed) {
      return NextResponse.json(refreshed, { headers: { "Cache-Control": "no-store" } });
    }
    if (previous) {
      return NextResponse.json({ ...previous.data, stale: true }, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    return NextResponse.json({ error: "feed unavailable" }, {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  }

  const now = Date.now();
  const cached = CACHE[f];

  if (!cached) {
    const outcome = await tryFetchUpstreamResult(f);
    if (outcome.status === "absent") {
      // A proven absence (the store of record answered 404), not an outage: clients
      // render "not published" for a 404 and a load error for a 503. Never cached here,
      // and no-store matters doubly — EdgeOne caches /api/* 404s without the auth cookie.
      return NextResponse.json(
        { error: "not published" },
        { status: 404, headers: { "Cache-Control": "no-store" } }
      );
    }
    if (outcome.status === "unavailable") {
      return NextResponse.json(
        { error: "feed unavailable" },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }
    const data = outcome.data;
    // Score once here (before caching) so cache hits reuse the scored payload.
    attachFlowScores(f, data);
    CACHE[f] = { data, ts: now };
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  }

  const age = now - cached.ts;
  if (age < TTL_MS) {
    return NextResponse.json(cached.data, { headers: { "Cache-Control": "no-store" } });
  }

  const stale = { ...cached.data, stale: true };
  const refresh = revalidateFlow(f);
  // Leaders is a nightly-derived source with a source-session admission gate.
  // The generic background SWR response reports stale:true immediately, even if
  // the new Macro artifact is already current. Wait for this one coalesced check
  // so an explicit Leaders refresh actually consumes the newly published source.
  // On upstream failure the historical cached snapshot stays explicitly stale.
  if (f === "leaders") {
    const refreshed = await refresh;
    return NextResponse.json(refreshed ?? stale, { headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json(stale, { headers: { "Cache-Control": "no-store" } });
}
