/**
 * /api/flow/stream — Server-Sent Events transport for the flow feed (Phase 1 live spine).
 *
 * Replaces browser polling with a single server→client push connection: the browser
 * opens ONE EventSource, the server watches the upstream and pushes a fresh payload
 * only when it changes (plus heartbeats to hold the connection open). Same `?f=` params
 * and same resolved data as GET /api/flow — both go through lib/flowSource.
 *
 * SSE (not WebSocket) by design: the feed is server→client only, so SSE gives us
 * auto-reconnect (built into EventSource) and clean passage through Caddy/EdgeOne with
 * far less surface than a WS upgrade. If we later need client→server per-widget
 * subscription params beyond the query string, revisit WebSocket.
 */
import { rateLimit, tooMany } from "@/lib/rateLimit";
import { isValidF } from "@/lib/flowSource";
import { subscribe } from "@/lib/flowBroadcast";
import { hasLiveOptions, LIVE_OPTIONS_CACHE_TTL_MS } from "@/lib/entitlement";

// SSE must never be statically cached, and flowSource reads fixtures via fs → node runtime.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Existing scored feed frames exceed 2 MiB. Bound queued bytes, rather than
// rejecting those legitimate frames or allowing an unbounded slow consumer.
const MAX_QUEUED_BYTES = 8 * 1024 * 1024;
const RECHECK_TIMEOUT_MS = 15_000;

export async function GET(req: Request): Promise<Response> {
  const rl = rateLimit(req, { name: "flow-stream" });
  if (!rl.ok) return tooMany(rl);

  const requestedFeed = new URL(req.url).searchParams.get("f") ?? "feed";

  // The full US Prophet plan book is request/response only. It must never
  // enter a long-lived or process-shared SSE producer.
  if (requestedFeed === "prophet_idx") {
    return new Response("bad f param", {
      status: 400,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }

  // Options Alpha candidate evidence: GET-only for now. The publisher has not yet
  // shipped formed candidates (MACRO PR #8310, options.alpha_candidate_feed/v1),
  // and there is no poller, no SSE contract, and no UI consumer wired in. Refuse
  // the stream before entitlement/upstream/stream creation so a future caller
  // cannot quietly turn it into a long-lived producer the publisher would have to
  // honour.
  if (requestedFeed === "options_alpha_candidate_feed") {
    return new Response("bad f param", {
      status: 400,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }

  // Options data is a PAID feature — gate the stream at connection open against
  // the macro-api entitlement (terminal_live_options via /api/me), not
  // profiles.is_pro. Fixture mode (dev/CI) is exempt.
  if (process.env.FLOW_FIXTURE !== "1" && !(await hasLiveOptions())) {
    return new Response("pro_required", { status: 403 });
  }

  // Keep the existing post-entitlement parse/validation flow for every
  // stream that is actually admissible.
  const url = new URL(req.url);
  const f = url.searchParams.get("f") ?? "feed";
  if (!isValidF(f)) {
    return new Response("bad f param", { status: 400 });
  }

  // This connection owns no timer and no upstream read. It attaches to the process-level
  // producer for `f` (lib/flowBroadcast), which polls once per cadence and serializes each
  // changed frame once, however many clients are attached. Frames arrive here already
  // formatted as SSE text; the only per-connection work left is UTF-8 encoding them into
  // this stream. (Encoding stays per-connection deliberately: sharing one Uint8Array across
  // independent ReadableStreams risks buffer aliasing, and the expensive part — serializing
  // a ~2 MB object graph — is already shared.)
  const encoder = new TextEncoder();
  let closed = false;
  let detach: (() => void) | null = null;
  let recheckTimer: ReturnType<typeof setInterval> | null = null;
  let recheckDeadline: ReturnType<typeof setTimeout> | null = null;
  let checking = false;
  let pendingFrame: Uint8Array | null = null;
  let finish: ((discardQueued: boolean) => void) | null = null;
  const onAbort = () => teardown();

  const teardown = (discardQueued = false) => {
    if (closed) return;
    closed = true;
    if (recheckTimer !== null) clearInterval(recheckTimer);
    if (recheckDeadline !== null) clearTimeout(recheckDeadline);
    recheckTimer = recheckDeadline = null;
    req.signal.removeEventListener("abort", onAbort);
    detach?.();
    detach = null;
    pendingFrame = null;
    finish?.(discardQueued);
    finish = null;
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      finish = (discardQueued) => {
        try {
          if (discardQueued) controller.error(new Error("Flow stream lifetime ended"));
          else controller.close();
        } catch { /* The consumer already closed the stream. */ }
      };
      const send = (payload: string) => {
        if (closed) return;
        // A recheck pauses new delivery. Keep only the latest data frame, not
        // heartbeats; pending + queued bytes share the same bounded budget.
        if (checking && !payload.startsWith("data:")) return;
        const chunk = encoder.encode(payload);
        const available = controller.desiredSize;
        if (available === null || chunk.byteLength > available) { teardown(true); return; }
        if (checking) { pendingFrame = chunk; return; }
        try { controller.enqueue(chunk); } catch { teardown(true); }
      };

      // Client navigated away / closed the tab.
      req.signal.addEventListener("abort", onAbort, { once: true });

      // A signal that is ALREADY aborted never fires its listener, and start() runs after the
      // `await hasLiveOptions()` above — so a client that gives up during that entitlement
      // round-trip would otherwise subscribe here and never detach, stranding a producer and
      // its timers with no connection behind them. Bail before attaching.
      if (req.signal.aborted) {
        teardown();
        return;
      }

      // Tell EventSource to wait 10s before reconnecting after a drop.
      send("retry: 10000\n\n");

      // Attach. If the producer already holds a frame, subscribe() delivers it synchronously
      // here, so a client joining a warm feed still renders with no first-paint wait — and
      // without the upstream read every connection used to perform for itself.
      const release = subscribe(f, send);
      // A warm frame can overflow synchronously before subscribe returns its
      // disposer. Settle that same subscription rather than losing the handle.
      if (closed) { release(); return; }
      detach = release;
      if (process.env.FLOW_FIXTURE !== "1") {
        recheckTimer = setInterval(() => {
          if (closed || checking) return;
          checking = true;
          recheckDeadline = setTimeout(() => teardown(true), RECHECK_TIMEOUT_MS);
          void hasLiveOptions().then((allowed) => {
            if (closed) return;
            if (!allowed) { teardown(true); return; }
            if (recheckDeadline !== null) clearTimeout(recheckDeadline);
            recheckDeadline = null;
            checking = false;
            if (pendingFrame) {
              const frame = pendingFrame; pendingFrame = null;
              try { controller.enqueue(frame); } catch { teardown(true); }
            }
          }).catch(() => teardown(true));
        }, LIVE_OPTIONS_CACHE_TTL_MS);
      }
    },
    cancel() {
      teardown();
    },
  }, { highWaterMark: MAX_QUEUED_BYTES, size: (chunk) => chunk.byteLength });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // `no-store` alone — deliberately NOT `no-transform`.
      //
      // The scored feed frame measures 2,002,874 B raw / 100,435 B gzipped: a 20×
      // ratio, and the single largest thing on the tape's critical path. Next's
      // production server runs the `compression` middleware (verified:
      // next/dist/server/lib/router-server.js:115-116, enabled unless
      // `compress:false`), and its content-type filter accepts text/event-stream
      // via the `^text\/` fallback — but its `shouldTransform()` bails out on a
      // `no-transform` Cache-Control, so this header was silently switching gzip
      // OFF for the biggest response we serve. `no-transform` bought us nothing:
      // `no-store` already forbids storing, and nothing else in the path rewrites
      // an SSE body.
      //
      // The usual reason to fear SSE + gzip — the encoder buffering whole events
      // and destroying push latency — does not apply here: Next flushes the
      // compressor after EVERY chunk it writes
      // (next/dist/server/pipe-readable.js:75-80 calls `res.flush()` when the
      // response has one, which is exactly what `compression` installs). Each
      // `send()` below therefore still reaches the client as its own frame, and
      // Caddy auto-flushes text/event-stream upstream responses.
      "Cache-Control": "no-store",
      "Connection": "keep-alive",
      // Disable response buffering at nginx/edge so events flush immediately.
      "X-Accel-Buffering": "no",
    },
  });
}
