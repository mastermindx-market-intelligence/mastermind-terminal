import { isPublicBoatsQuote, type ExtProvenance } from "@/lib/extQuoteFreshness";
import { NextResponse } from "next/server";
import { rateLimit, tooMany } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public BOATS display through the incumbent Quote Hub singleton and demand/LRU.
// The internal source selector admits only licensed BOATS on this entire route;
// legacy mixed-provider legs remain outside this public projection.
// An exact allowlist preserves trade/arrival/publication/expiry clocks and capture
// provenance. Missing or expired quotes are null; transport failure is 503 so the
// browser can retain an unexpired last-good quote. Every response is no-store.
// BOATS is a latest qualifying trade from one ATS, not an NBBO or candle source.

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

// Preserve the owner's provenance. Missing or unknown basis is never promoted to LIVE.
const EXT_BASES = ["LIVE", "DELAYED_15M", "UNOFFICIAL"] as const;
type ExtBasis = (typeof EXT_BASES)[number];
const asExtBasis = (v: unknown): ExtBasis | null =>
  (EXT_BASES as readonly unknown[]).includes(v) ? (v as ExtBasis) : null;
const asExtSource = (v: unknown): string | null =>
  typeof v === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(v) ? v : null;

export async function GET(req: Request) {
  const rl = rateLimit(req, { name: "ext-quote" });
  if (!rl.ok) return tooMany(rl);
  const { searchParams } = new URL(req.url);
  const syms = (searchParams.get("syms") || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, MAX_SYMS);
  if (syms.length === 0) return NextResponse.json({ quotes: {} }, {headers:{"Cache-Control":"no-store"}});

  type ExtEntry = ExtProvenance & { extPrice: number; extChg: number | null; extTs: number; extSession?: ExtSession };
  const out: Record<string, ExtEntry | null> = {};
  for (const s of syms) out[s] = null;

  try {
    const r = await fetch(
      `http://127.0.0.1:${HUB_PORT}/quotes?syms=${encodeURIComponent(syms.join(","))}&extSource=tiingo_boats`,
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
      if (typeof q.extPrice === "number" && (typeof q.extChg === "number" || (q.extSource === "tiingo_boats" && q.extChg === null))) {
        if (!isPublicBoatsQuote(q)) continue;
        const session = asExtSession(q.extSession);
        const source = asExtSource(q.extSource);
        const basis = asExtBasis(q.extBasis);
        const extTs = typeof q.extTs === "number"
          ? q.extTs
          : typeof q.ts === "number" ? q.ts : 0;
        out[s] = {
          extPrice: q.extPrice, extChg: q.extChg as number | null, extTs,
          ...(session ? { extSession: session } : {}),
          ...(source ? { extSource: source } : {}),
          ...(basis ? { extBasis: basis } : {}),
          ...(source === "tiingo_boats" ? {
            extVenue: "BOATS" as const, extPriceKind: "LAST_TRADE" as const,
            extReceivedTs: q.extReceivedTs as number,
            extPublishedTs: q.extPublishedTs as number,
            extExpiresTs: q.extExpiresTs as number,
            ...(typeof q.extCaptureId === "string" && /^[a-f0-9-]{36}$/.test(q.extCaptureId) ? {extCaptureId:q.extCaptureId} : {}),
            ...(Number.isSafeInteger(q.extGeneration) && (q.extGeneration as number) >= 1 ? {extGeneration:q.extGeneration as number} : {}),
          } : {}),
        };
      }
    }
    return NextResponse.json({ quotes: out }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // The browser treats non-2xx as a failed refresh and keeps the last-good ext snapshot.
    return unavailable();
  }
}
