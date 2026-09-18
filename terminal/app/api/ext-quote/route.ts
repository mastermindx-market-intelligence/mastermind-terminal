import { NextResponse } from "next/server";
import { rateLimit, tooMany } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Extended/overnight prints for the watchlist Ext column + pane-card ☾ block.
//
// ARCHITECTURE RULING (Phase 8 merge gate): the QUOTE HUB owns all extended-hours
// data — one server-side singleton (Alpaca leg when keys present, keyless grey
// fallback otherwise) multiplexed across every user, with a shared LRU
// subscription budget. This route is a THIN PROXY over the hub's /quotes ext
// fields; it must never fetch upstream sources itself (an earlier draft polled
// Yahoo directly from this route — that forked the source of truth and bypassed
// the hub's LRU/session logic).
//
// Response shape (UI contract):
//   { quotes: { SYM: { extPrice, extChg, extTs, extSession? } | null } }
// `extSession` ('pre' | 'post' | 'overnight') is the hub's own classification of WHICH
// out-of-hours window the print came from. The route used to strip it, which forced the UI
// to label every ext print "Overnight" — including a 08:15 ET pre-market print. Passed through
// only when the hub supplies it; a symbol with no ext data stays `null` as before.

const HUB_PORT = process.env.HUB_PORT ?? "3100";
const HUB_TIMEOUT_MS = 3_000;
const MAX_SYMS = 100;

const unavailable = () => NextResponse.json(
  { error: "quote_hub_unavailable" },
  {
    status: 503,
    headers: {
      "Cache-Control": "no-store",
      "Retry-After": "1",
    },
  },
);

// Anything the hub sends outside this set is dropped rather than relayed — the UI maps the
// value straight onto a label, so an unknown string would surface raw in the interface.
const EXT_SESSIONS = ["pre", "post", "overnight"] as const;
type ExtSession = (typeof EXT_SESSIONS)[number];
const asExtSession = (v: unknown): ExtSession | null =>
  (EXT_SESSIONS as readonly string[]).includes(v as string) ? (v as ExtSession) : null;

export async function GET(req: Request) {
  const rl = rateLimit(req, { name: "ext-quote" });
  if (!rl.ok) return tooMany(rl);
  const { searchParams } = new URL(req.url);
  const syms = (searchParams.get("syms") || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, MAX_SYMS);
  if (syms.length === 0) return NextResponse.json({ quotes: {} });

  type ExtEntry = { extPrice: number; extChg: number; extTs: number; extSession?: ExtSession };
  const out: Record<string, ExtEntry | null> = {};
  for (const s of syms) out[s] = null;

  try {
    const r = await fetch(
      `http://127.0.0.1:${HUB_PORT}/quotes?syms=${encodeURIComponent(syms.join(","))}`,
      { cache: "no-store", signal: AbortSignal.timeout(HUB_TIMEOUT_MS) },
    );
    // A transport failure is not an authoritative "no ext print" answer. Returning the
    // pre-filled all-null object here used to make every client erase its last-good values,
    // then restore them on the next successful 30 s poll — the visible in/out flicker.
    if (!r.ok) return unavailable();

    const j: unknown = await r.json();
    if (!j || typeof j !== "object" || Array.isArray(j)) return unavailable();
    const hubQuotes = j as Record<string, unknown>;
    for (const s of syms) {
      const value = hubQuotes[s];
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const q = value as Record<string, unknown>;
      if (typeof q.extPrice === "number" && typeof q.extChg === "number") {
        const session = asExtSession(q.extSession);
        const extTs = typeof q.extTs === "number"
          ? q.extTs
          : typeof q.ts === "number" ? q.ts : 0;
        out[s] = {
          extPrice: q.extPrice, extChg: q.extChg, extTs,
          ...(session ? { extSession: session } : {}),
        };
      }
    }
    return NextResponse.json({ quotes: out }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // The browser treats non-2xx as a failed refresh and keeps the last-good ext snapshot.
    return unavailable();
  }
}
