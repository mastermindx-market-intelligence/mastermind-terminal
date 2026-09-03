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
import { isValidF, loadFlowFresh } from "@/lib/flowSource";
import { hasLiveOptions } from "@/lib/entitlement";

// SSE must never be statically cached, and flowSource reads fixtures via fs → node runtime.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Server-side watch cadence. The underlying feed refreshes on the order of 30s–minutes,
// so a 15s poll surfaces changes promptly without hammering the upstream. Heartbeat keeps
// intermediaries from closing an idle connection.
const POLL_MS = 15_000;
const HEARTBEAT_MS = 20_000;

/**
 * Cheap change signature: prefer a timestamp field, fall back to serialized size.
 * Avoids a deep-equality walk of large feed payloads every poll — we only need to know
 * "did it change", and asof + byte-length flips whenever the producer republishes.
 */
function signature(data: Record<string, unknown> | null): string {
  if (!data) return "null";
  const asof = String(data.asof ?? data.asof_utc ?? data.session_date ?? data.ts ?? "");
  let sz = 0;
  try { sz = JSON.stringify(data).length; } catch { /* non-serializable — size 0 */ }
  return `${asof}:${sz}`;
}

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

  const encoder = new TextEncoder();
  let poll: ReturnType<typeof setInterval> | null = null;
  let beat: ReturnType<typeof setInterval> | null = null;
  let lastSig = "";
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: string) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(payload)); } catch { /* stream torn down */ }
      };
      const sendData = (data: Record<string, unknown> | null) => {
        if (data) send(`data: ${JSON.stringify(data)}\n\n`);
      };
      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (poll) clearInterval(poll);
        if (beat) clearInterval(beat);
        try { controller.close(); } catch { /* already closed */ }
      };

      // Client navigated away / closed the tab.
      req.signal.addEventListener("abort", cleanup);

      // Tell EventSource to wait 10s before reconnecting after a drop.
      send("retry: 10000\n\n");

      // Initial snapshot so the consumer renders immediately (no first-paint wait).
      const first = await loadFlowFresh(f);
      lastSig = signature(first);
      sendData(first);

      // Watch for change and push.
      poll = setInterval(async () => {
        if (closed) return;
        try {
          const data = await loadFlowFresh(f);
          const sig = signature(data);
          if (data && sig !== lastSig) {
            lastSig = sig;
            sendData(data);
          }
        } catch { /* transient upstream error — keep the connection, retry next tick */ }
      }, POLL_MS);

      // Comment-line heartbeat (ignored by EventSource) keeps proxies from idling us out.
      beat = setInterval(() => send(": keepalive\n\n"), HEARTBEAT_MS);
    },
    cancel() {
      closed = true;
      if (poll) clearInterval(poll);
      if (beat) clearInterval(beat);
    },
  });

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
