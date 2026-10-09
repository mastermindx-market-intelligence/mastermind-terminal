import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { rateLimit, tooMany } from "@/lib/rateLimit";

// Neural Web display feeds (macro repo → www.mastermind-x.com/neuralwebdata/). The producer
// serves static JSON with no CORS header, so the browser can't fetch it cross-origin from
// app.mastermind-x.com — this route proxies it same-origin. Display-only context: the
// Terminal never ranks, gates, or scores features off these feeds.
// NW_BASE is shared with copilotTools via lib/upstreams (one edit rotates every consumer).
//
// Entitlement (T-NW-AUTH, seat ruling 2026-10-06): macro's regwall/paywall is the SOLE
// authority over these bytes. This route relays the CALLER'S OWN Supabase session cookie
// (set on .mastermind-x.com, so the browser already sends it here) and nothing else. It
// holds no service credential and keeps NO cache shared across callers, so one entitled
// caller's bytes can never be served to the next anonymous caller.
import { NW_BASE } from "@/lib/upstreams";
const FIXTURE_DIR = path.join(process.cwd(), "public", "data");

const FEEDS: Record<string, string> = {
  market_plane: "market_plane.json",
  // Gate #8: macro's read-only projection of the latest finalized U.S. picks
  // (mastermind.selection_cohort_projection.v1). Same proxy, same entitlement relay, same 503 honesty.
  selection_cohort_us: "selection_cohort/us.json",
};

// Checked-in samples served when NW_FIXTURE=1, one per feed.
const FIXTURES: Record<string, string> = {
  market_plane: "nw_plane_fixture.json",
};

// Per-caller bytes: no browser, CDN or proxy may keep or share them.
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" } as const;

// The caller's Supabase session cookie, whole or chunked (.0, .1, ...). Nothing else leaves this route.
const SUPABASE_AUTH_COOKIE = /^sb-[a-z0-9]+-auth-token(\.\d{1,2})?$/;

function supabaseAuthCookieHeader(req: Request): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  const kept: string[] = [];
  for (const part of raw.split(";")) {
    const pair = part.trim();
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    if (SUPABASE_AUTH_COOKIE.test(name)) kept.push(`${name}=${pair.slice(eq + 1).trim()}`);
  }
  return kept.length ? kept.join("; ") : null;
}

function refuse(status: 401 | 403 | 503): Response {
  const error = status === 401 ? "sign_in_required" : status === 403 ? "not_entitled" : "feed unavailable";
  return NextResponse.json({ error }, { status, headers: PRIVATE_HEADERS });
}

export async function GET(req: Request): Promise<Response> {
  const rl = rateLimit(req, { name: "nw" });
  if (!rl.ok) return tooMany(rl);
  const url = new URL(req.url);
  const f = url.searchParams.get("f") ?? "market_plane";
  const file = FEEDS[f];
  if (!file) {
    return NextResponse.json({ error: "bad f param" }, { status: 400 });
  }

  // Dev fixture mode: serve the checked-in sample without touching the upstream.
  if (process.env.NW_FIXTURE === "1") {
    const fixtureFile = FIXTURES[f];
    if (!fixtureFile) {
      return NextResponse.json({ error: "fixture unavailable" }, { status: 503 });
    }
    try {
      const raw = await fs.readFile(path.join(FIXTURE_DIR, fixtureFile), "utf8");
      return NextResponse.json(JSON.parse(raw) as Record<string, unknown>, {
        headers: { "Cache-Control": "no-store", "X-NW-Source": "fixture" },
      });
    } catch {
      return NextResponse.json({ error: "fixture unavailable" }, { status: 503 });
    }
  }

  // No session, no upstream call: macro would refuse an anonymous read anyway.
  const cookie = supabaseAuthCookieHeader(req);
  if (!cookie) return refuse(401);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4_000);
  try {
    const res = await fetch(`${NW_BASE}/${file}`, {
      signal: ctrl.signal,
      headers: { Cookie: cookie, "User-Agent": "mastermind-terminal/1.0" },
      cache: "no-store",
      // Never follow: a followed redirect drops the cookie cross-origin and lands on an unvetted origin.
      redirect: "manual",
    });
    if (res.status === 401) return refuse(401);
    if (res.status === 402 || res.status === 403) return refuse(403);
    // Any other non-2xx, every 3xx, and an opaque redirect: the strip/card render their unavailable state.
    if (!res.ok) return refuse(503);
    const data = (await res.json()) as Record<string, unknown>;
    return NextResponse.json(data, { headers: PRIVATE_HEADERS });
  } catch {
    // Network error, timeout or unparseable body. No stale copy exists to fall back to, by design.
    return refuse(503);
  } finally {
    clearTimeout(timer);
  }
}
