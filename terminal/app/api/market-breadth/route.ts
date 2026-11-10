// Same-origin proxy for the Macro live breadth reading (www.mastermind-x.com/live/breadth.json,
// live.breadth.v1), shown as one cell in the Today source-readings strip.
//
// The producer is the VPS poller scripts/live_breadth_poller.py (Polygon snapshot joined to
// the nightly close cache, 15-minute delayed); engine/live_breadth.py adjudicates `usable` /
// `unusable_reason` and nothing here second-guesses that verdict. Macro already shows the
// same aggregate on its own pages (templates/live.js).
//
// Differences from the raw file, all deliberate:
//   * Session-gated like the other Today reads: without a Supabase session it 401s locally and
//     never contacts the gateway.
//   * A WHITELISTED projection only (lib/shared-shell/marketBreadth.ts): the S&P 500 tier and the
//     composite advancing / above-200-day shares, the clocks, coverage and the verdict. Per-name
//     membership (`meta`) and every other field stay upstream.
//   * Anything that does not validate is a 503, never a partial or zero-filled reading:
//     unavailable is not "no stocks advancing".
//   * The verdict is re-dated on this server's clock: a file older than the live window (the
//     poller stops between sessions) is answered as `source_stale` with no numbers.
//   * One pinned origin (https://www.mastermind-x.com, the canonical host the bare domain
//     redirects to), redirects refused, a 5-second deadline and a 256 KB body cap. The file is
//     public and static, so BRAIN_GATEWAY_URL (a loopback brain in production) is not used.
//   * NO server cache and no logging.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimit, tooMany } from "@/lib/rateLimit";
import { BREADTH_UPSTREAM, projectBreadth } from "@/lib/shared-shell/marketBreadth";

const NO_STORE = "private, no-store";
const MAX_BYTES = 256 * 1024;
const DEADLINE_MS = 5000;

async function boundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw new Error("body_limit");
  if (!response.body) throw new Error("missing_body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error("body_limit");
      chunks.push(value);
    }
  } catch (e) {
    await reader.cancel().catch(() => undefined);
    throw e;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

async function signedIn(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return !!session && !!user;
}

function unavailable() {
  return NextResponse.json(
    { error: "breadth_unavailable" },
    { status: 503, headers: { "Cache-Control": NO_STORE } },
  );
}

export async function GET(req: Request) {
  const rl = rateLimit(req, { name: "market-breadth", max: 30 });
  if (!rl.ok) return tooMany(rl);

  if (!(await signedIn())) {
    return NextResponse.json(
      { error: "unauthenticated" },
      { status: 401, headers: { "Cache-Control": NO_STORE } },
    );
  }

  try {
    const upstream = await fetch(BREADTH_UPSTREAM, {
      headers: { Accept: "application/json" },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(DEADLINE_MS)]),
    });
    if (!upstream.ok) return unavailable();
    const projected = projectBreadth(await boundedJson(upstream), new Date());
    if (!projected) return unavailable();
    return NextResponse.json(projected, { headers: { "Cache-Control": NO_STORE } });
  } catch {
    return unavailable();
  }
}
