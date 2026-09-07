/**
 * prefDelivery.ts — ONE serialized delivery pump for the account-preference write lane (E2).
 *
 * ── What this replaces ────────────────────────────────────────────────────────────────────
 *
 * Every preference write used to be fire-and-forget:
 *
 *     createClient().auth.updateUser({ data }).catch(() => {})
 *
 * which loses three different things at once.
 *
 *   1. **A rejected request is silently discarded.** So is the case that matters more with
 *      Supabase, where the promise RESOLVES with `{ error }` — a `.catch()` never sees it at
 *      all. The settings pane then said "Saved" on a write that had not succeeded and never
 *      would.
 *   2. **Concurrent writes to one authority reorder.** Two edits in quick succession are two
 *      independent round trips:
 *
 *          desired v1 = { start_tf }
 *          desired v2 = { start_tf, updown }
 *          request v2 finishes first, request v1 finishes second
 *          → the OLDER, smaller blob wins and `updown` is gone.
 *
 *      Adding `.catch()` calls does not fix that; only serializing does.
 *   3. **A failed write has no retry.** The user's intent evaporates.
 *
 * ── The model ─────────────────────────────────────────────────────────────────────────────
 *
 *     local desired state
 *          ↓
 *     revision N                       (bumped on every edit; edits coalesce into ONE desired map)
 *          ↓
 *     at most ONE authority write in flight
 *          ↓
 *     ack N / fail N
 *          ↓
 *     if desired revision > acknowledged revision, send the newest COMPLETE desired state
 *
 * "Newest complete desired state" is the important half: the pump never replays a queue of
 * patches, it sends the current value of every key that has been edited. Ten taps on a chip
 * while offline cost one write when connectivity returns, and that write carries the tenth
 * value — not the first, and never a mixture.
 *
 * ── Owner binding ─────────────────────────────────────────────────────────────────────────
 *
 * A pump belongs to exactly one owner. `dispose()` cancels its retry timer and makes every
 * outstanding continuation inert, so an ack (or a scheduled retry) that arrives after the user
 * has switched accounts can neither write under the new owner nor report status into its UI.
 * The store creates a new pump per owner rather than resetting this one.
 *
 * Deliberately free of React and Supabase imports: `send` is injected, so the whole retry and
 * coalescing contract is unit-testable with a fake authority and a fake clock.
 */

/** What the UI shows about the delivery lane. */
export type DeliveryPhase =
  /** Nothing has been written this session. */
  | "idle"
  /** Guest: the change is kept on this device and there is no authority to reach. */
  | "local"
  /** A write is in flight, or queued behind one. */
  | "syncing"
  /** The authority acknowledged every edit made so far. */
  | "saved"
  /** The last attempt failed. The pump retries on its own; `retryNow()` jumps the queue. */
  | "failed";

export type DeliveryStatus = {
  phase: DeliveryPhase;
  /** Consecutive failures for the current desired state. 0 once anything is acknowledged. */
  attempts: number;
  /** Newest desired revision. */
  revision: number;
  /** Newest revision the authority has acknowledged. `revision === acked` ⇒ fully delivered. */
  acked: number;
};

/**
 * The authority's answer. `void`/`{}` is success; anything with a truthy `error` is a FAILURE —
 * this is the Supabase shape a `.catch()` cannot see, and treating it as success is what made
 * the pane claim "Saved" on a write that did not land.
 */
export type SendResult = { error?: unknown } | void;

export type PumpOptions = {
  /** Deliver one COMPLETE desired state to the authority. */
  send: (data: Record<string, unknown>) => Promise<SendResult>;
  /** Called on every status change. */
  onStatus?: (status: DeliveryStatus) => void;
  /** Retry backoff per consecutive failure, in ms. The last entry repeats. */
  backoffMs?: readonly number[];
  /** Injectable timer, so tests need no real clock. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

const DEFAULT_BACKOFF = [2_000, 5_000, 15_000, 30_000] as const;

const IDLE: DeliveryStatus = { phase: "idle", attempts: 0, revision: 0, acked: 0 };

/** A guest lane: everything applies locally, nothing is ever delivered. */
export const LOCAL_STATUS: DeliveryStatus = { phase: "local", attempts: 0, revision: 0, acked: 0 };

export class PreferencePump {
  /** The newest complete value of every key that has ever been queued on this pump. */
  private desired: Record<string, unknown> = {};
  /**
   * Keys that need no merge base (E6 shared atomics): once the revision that queued them is
   * acknowledged, the key is evicted from `desired` so a LATER edit to an unrelated field never
   * re-sends a value the caller has not touched again. Maps key -> revision it was queued at
   * (the newest one, if queued more than once before ack).
   */
  private oneShotKeys: Map<string, number> = new Map();
  private revision = 0;
  private acked = 0;
  /** The revision the in-flight request carries. 0 when nothing is in flight. */
  private sending = 0;
  private attempts = 0;
  private timer: unknown = null;
  private dead = false;
  private status: DeliveryStatus = IDLE;

  private readonly send: PumpOptions["send"];
  private readonly onStatus: (status: DeliveryStatus) => void;
  private readonly backoff: readonly number[];
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(opts: PumpOptions) {
    this.send = opts.send;
    this.onStatus = opts.onStatus ?? (() => {});
    this.backoff = opts.backoffMs?.length ? opts.backoffMs : DEFAULT_BACKOFF;
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  getStatus(): DeliveryStatus { return this.status; }

  /** True while the authority has not acknowledged every edit made so far. */
  hasUndelivered(): boolean { return !this.dead && this.revision > this.acked; }

  /**
   * Record an edit. The patch's keys REPLACE their current desired values (each value handed in
   * is already the complete value for that key — a nested blob arrives merged), the revision
   * advances, and delivery is kicked. Coalescing is implicit: a second edit before the first
   * lands simply overwrites the desired value and raises the revision.
   */
  queue(patch: Record<string, unknown>, opts?: { oneShot?: readonly string[] }): number {
    if (this.dead) return this.revision;
    this.desired = { ...this.desired, ...patch };
    this.revision += 1;
    for (const key of opts?.oneShot ?? []) this.oneShotKeys.set(key, this.revision);
    this.kick();
    return this.revision;
  }

  /** User-driven retry. Cancels the backoff wait and attempts immediately. */
  retryNow(): void {
    if (this.dead) return;
    this.cancelTimer();
    this.attempts = 0;
    this.kick();
  }

  /** Cancel every timer and make every outstanding continuation inert. Irreversible. */
  dispose(): void {
    this.dead = true;
    this.cancelTimer();
  }

  // ── internals ──────────────────────────────────────────────────────────────────────────

  private cancelTimer() {
    if (this.timer !== null) { this.clearTimer(this.timer); this.timer = null; }
  }

  private publish(phase: DeliveryPhase) {
    this.status = { phase, attempts: this.attempts, revision: this.revision, acked: this.acked };
    this.onStatus(this.status);
  }

  private kick() {
    if (this.dead) return;
    if (this.sending) return;                 // ONE write in flight, always
    if (this.timer !== null) return;          // waiting out a backoff; that timer will kick
    if (this.revision <= this.acked) return;  // nothing outstanding

    const revision = this.revision;
    // Snapshot the desired state at send time. A later edit raises `this.revision` past this
    // one, so when this request acks the pump immediately sends the newer state — the ack can
    // never mark a revision it did not carry.
    const payload = { ...this.desired };
    this.sending = revision;
    this.publish("syncing");

    let settled: Promise<SendResult>;
    try {
      settled = Promise.resolve(this.send(payload));
    } catch (err) {
      settled = Promise.reject(err);
    }
    settled.then(
      (result) => {
        if (this.dead) return;
        this.sending = 0;
        // The Supabase shape: RESOLVED, with an error inside. A `.catch()` never sees this.
        if (result && typeof result === "object" && "error" in result && result.error) {
          this.fail();
          return;
        }
        this.attempts = 0;
        if (revision > this.acked) this.acked = revision;
        // A one-shot key needs no merge base — once its queuing revision is acknowledged it is
        // evicted, so it rides along only until it is actually delivered, never forever.
        for (const [key, atRev] of Array.from(this.oneShotKeys)) {
          if (atRev <= this.acked) {
            delete this.desired[key];
            this.oneShotKeys.delete(key);
          }
        }
        this.publish(this.revision > this.acked ? "syncing" : "saved");
        this.kick();          // a newer desired state may have arrived while this was in flight
      },
      () => {
        if (this.dead) return;
        this.sending = 0;
        this.fail();
      },
    );
  }

  private fail() {
    this.attempts += 1;
    this.publish("failed");
    const wait = this.backoff[Math.min(this.attempts - 1, this.backoff.length - 1)];
    this.timer = this.setTimer(() => {
      this.timer = null;
      if (this.dead) return;
      this.kick();
    }, wait);
  }
}
