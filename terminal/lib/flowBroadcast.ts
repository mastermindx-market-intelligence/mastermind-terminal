/**
 * Shared per-feed-key producer for /api/flow/stream (server half of the Phase 1 live spine).
 *
 * WHY THIS EXISTS
 * Before this module, /api/flow/stream did its watching *inside the connection*: every
 * EventSource ran its own `setInterval`, its own `loadFlowFresh(f)`, and its own
 * `JSON.stringify` of the result. lib/flowSource states it plainly — loadFlowFresh does no
 * caching, callers own freshness — so N connections to the same feed key meant N upstream
 * reads and N serializations every 15s. The main feed frame measures 2,002,874 B raw, so the
 * cost scaled with CONNECTED CLIENTS when the only thing that actually varies is the FEED KEY.
 *
 * Now one producer per key does the work once and fans the result out. Ten subscribers to
 * `feed` cost exactly what one costs. The client half (lib/flowStream) already collapses to one
 * EventSource per feed key per tab; this is the same idea across tabs, users and processes.
 *
 * CHANGE DETECTION — why the exact serialized frame, not a signature
 * The previous identity was `${asof}:${JSON.stringify(data).length}`. Two different payloads
 * with the same asof and the same serialized LENGTH are indistinguishable under it, so a real
 * update could be silently suppressed — a correctness bug, not just a cost. We already have to
 * serialize once per cadence to build the wire frame, so comparing the exact serialized string
 * is both free and exact: it can never suppress a change. (A key-order change in an otherwise
 * equal payload would re-send a frame that parses identically — harmless, and the old code did
 * that too.)
 *
 * NOT A TRUTH STORE. This holds one in-flight frame per active key so late subscribers render
 * without waiting a cadence. lib/flowSource remains the only resolver of feed data; a producer
 * with no subscribers is destroyed, and the next subscriber starts a fresh read.
 *
 * SAFE TO RUN DETACHED. loadFlowFresh(f) is a pure function of the f-param — no cookies(),
 * no headers(), no per-request Supabase client — so a shared timer outside any request scope
 * resolves exactly what a request-scoped call would. Entitlement and rate limiting stay in the
 * route, per connection, and are checked BEFORE subscribe() is ever reached.
 */
import { loadFlowFresh } from "@/lib/flowSource";

// Server-side watch cadence. The underlying feed refreshes on the order of 30s–minutes, so a
// 15s poll surfaces changes promptly without hammering the upstream. Heartbeat keeps
// intermediaries from closing an idle connection. Both were per-connection before; they are
// now per-key, which is what makes the cost independent of subscriber count.
const POLL_MS = 15_000;
const HEARTBEAT_MS = 20_000;

/** Receives ready-to-write SSE text (a `data:` frame or a `:` comment heartbeat). */
export type Subscriber = (chunk: string) => void;

type Producer = {
  subs: Set<Subscriber>;
  poll: ReturnType<typeof setInterval> | null;
  beat: ReturnType<typeof setInterval> | null;
  /** Exact serialized content of the last delivered frame — the change identity. */
  lastJson: string | null;
  /** Wire text for that frame, built ONCE and shared by every subscriber. */
  lastFrame: string | null;
  /** A refresh is awaiting upstream; the next tick skips rather than stacking a second read. */
  inFlight: boolean;
  /** Set at teardown so a refresh that resolves afterwards cannot resurrect a dead producer. */
  stopped: boolean;
};

const PRODUCERS = new Map<string, Producer>();

function broadcast(p: Producer, chunk: string): void {
  for (const sub of p.subs) {
    // One bad connection must not stop delivery to the rest; its own cleanup is already queued.
    try { sub(chunk); } catch { /* stream torn down between abort and unsubscribe */ }
  }
}

async function refresh(f: string, p: Producer): Promise<void> {
  // Overlap guard: a read slower than the cadence must not stack a second upstream call.
  if (p.stopped || p.inFlight) return;
  p.inFlight = true;
  try {
    const data = await loadFlowFresh(f);
    if (p.stopped || !data) return;
    const json = JSON.stringify(data);
    if (json === p.lastJson) return;
    p.lastJson = json;
    p.lastFrame = `data: ${json}\n\n`;
    broadcast(p, p.lastFrame);
  } catch {
    // Transient upstream error — hold the last good frame and retry on the next tick.
  } finally {
    p.inFlight = false;
  }
}

/**
 * Attach to the producer for `f`, creating it if this is the first subscriber. Returns the
 * detach function; calling it is what eventually tears the producer down.
 *
 * `f` MUST already have passed isValidF — that is what bounds the key space, and with it the
 * number of producers a client can cause to exist.
 */
export function subscribe(f: string, sub: Subscriber): () => void {
  let p = PRODUCERS.get(f);
  if (!p) {
    const created: Producer = {
      subs: new Set(), poll: null, beat: null,
      lastJson: null, lastFrame: null, inFlight: false, stopped: false,
    };
    PRODUCERS.set(f, created);
    created.poll = setInterval(() => { void refresh(f, created); }, POLL_MS);
    created.beat = setInterval(() => broadcast(created, ": keepalive\n\n"), HEARTBEAT_MS);
    p = created;
    // Kick the first read immediately. Deliberately not awaited: the route returns its
    // Response right away and the frame streams in when upstream answers.
    void refresh(f, created);
  }
  p.subs.add(sub);
  // Late subscriber: hand over the frame we already hold so it renders at once — no
  // first-paint wait, and no upstream read of its own. This is the replay the old
  // per-connection `await loadFlowFresh(f)` was paying for on every single connection.
  if (p.lastFrame) sub(p.lastFrame);
  return () => detach(f, sub);
}

function detach(f: string, sub: Subscriber): void {
  const p = PRODUCERS.get(f);
  if (!p) return;
  p.subs.delete(sub);
  if (p.subs.size > 0) return;
  // Last one out kills the timers and drops the key, so an idle server holds no producer
  // state and no interval for a feed nobody is watching.
  p.stopped = true;
  if (p.poll) clearInterval(p.poll);
  if (p.beat) clearInterval(p.beat);
  p.poll = null;
  p.beat = null;
  PRODUCERS.delete(f);
}

/** Live producer count. Exported so the teardown contract is assertable from tests. */
export function activeProducerCount(): number {
  return PRODUCERS.size;
}
