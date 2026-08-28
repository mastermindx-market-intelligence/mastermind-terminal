import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminGate";
import { listSearchEvents, resolveUserEmails, searchStats } from "@/lib/searchEvents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Owner-only read path for the search-tracking plane.
//
// ── The status codes are a contract, not decoration ──
// The client has to tell "you may not see this" apart from "we could not check" and from "the
// store is down", because those want three different UIs: a denial, a retry, and a
// stale-but-usable log. Previously all three arrived as a 404 or as a 200 with an empty array.
//
//   404  not an admin. The route's existence stays unadvertised, so a logged-out visitor gets
//        this too. A DEFINITIVE denial — the client may latch it.
//   503  the authority or the store did not answer. NOT a denial: retryable, and the client keeps
//        whatever it already had on screen.
//   200  the events read succeeded. `stats` may still be absent with `statsUnavailable: true` —
//        the aggregate is a SEPARATE read, and a failed KPI must not take a usable log down.
const NO_STORE = { "cache-control": "no-store" } as const;

export async function GET(req: Request) {
  const authority = await isAdminRequest();
  if (authority.status === "unavailable") {
    return NextResponse.json({ error: "authority_unavailable" }, { status: 503, headers: NO_STORE });
  }
  if (authority.status !== "admin") {
    return NextResponse.json({ error: "not found" }, { status: 404, headers: NO_STORE });
  }

  const sp = new URL(req.url).searchParams;
  const limit = Math.min(500, Math.max(1, parseInt(sp.get("limit") || "", 10) || 100));
  const before = parseInt(sp.get("before") || "", 10);
  const symbol = (sp.get("symbol") || "").trim().toUpperCase();
  const source = (sp.get("source") || "").trim();
  const visitor = (sp.get("visitor") || "").trim();

  const read = await listSearchEvents({
    limit,
    beforeId: Number.isFinite(before) ? before : undefined,
    symbol: symbol || undefined,
    source: source || undefined,
    visitor: visitor || undefined,
  });
  if (!read.ok) {
    // The log IS the page. With no rows there is nothing honest to render, so this is the one
    // failure that takes the whole response down — as a 503, never as `{ events: [] }`.
    return NextResponse.json({ error: "events_unavailable" }, { status: 503, headers: NO_STORE });
  }

  const events = read.events;
  const nextBefore = events.length === limit ? events[events.length - 1].id : null;
  const userMap = await resolveUserEmails(events.map((e) => e.user_id).filter(Boolean) as string[]);

  const stats = sp.get("stats") === "1" ? await searchStats() : null;

  return NextResponse.json(
    {
      events,
      nextBefore,
      userMap,
      ...(stats?.ok ? { stats: stats.stats } : {}),
      ...(stats && !stats.ok ? { statsUnavailable: true } : {}),
    },
    { headers: NO_STORE },
  );
}
