/**
 * The browser side of smart screens (E04, AC-E04-03/04): one store per OWNER.
 *
 * The account (`/api/smart-screens`) is the source of truth. This store keeps two things on the
 * device, in the owner's own slot of `mm.smartScreens` (ownerStorage envelope — one owner's copy
 * is never readable as another's):
 *
 *   ack      — the last list the account ACKNOWLEDGED (a successful read or write answer). It is
 *              what the user sees, labeled stale, when a later read fails. A failed read never
 *              replaces it and never empties it.
 *   pending  — every write the account has not acknowledged yet (a failed save, delete, conflict
 *              or a save that a reload interrupted), with the complete intended content, so it
 *              survives a remount and can be retried, resolved or discarded by the user. Nothing
 *              is retried automatically and nothing is dropped without the user saying so.
 *
 * Writes need a baseline: no write is offered before an acknowledged list exists (the #884
 * unread-baseline rule). Writes are compare-and-set on the record's `rev`, so a write from a
 * stale baseline is safe — the account answers with a conflict instead of being overwritten.
 * One request is in flight at a time.
 */

import { GUEST_OWNER } from "@/lib/accountIdentity";
import { isPlainObject, readOwnerSlot, writeOwnerSlot, type StoragePort } from "@/lib/ownerStorage";
import { canonicalDefinition, normalizeDefinition, type ScreenDefinition } from "./predicate";
import { normalizeReview, reviewableDefinition, type ReviewSnapshot } from "./review";
import { isScreenRevision, SCREEN_ID_RE, newScreenId, normalizeScreenName, parseScreenRecord, type ReadOnlyScreen, type ScreenRecord } from "./record";

export const SMART_SCREENS_LOCAL_KEY = "mm.smartScreens";
export const LOCAL_VERSION = 1;
export const SMART_SCREENS_ENDPOINT = "/api/smart-screens";
export const MAX_PENDING = 20;

export type Ack = { screens: ScreenRecord[]; readOnly: ReadOnlyScreen[]; invalid: number; readAt: string };

export type FailReason =
  | "network" | "unavailable" | "unauthenticated" | "limit_reached" | "record_too_large"
  | "rejected" | "interrupted" | "newer_schema";

export type PendingOp = {
  opId: string;
  action: "create" | "update" | "delete";
  id: string;
  /** The rev the write is conditional on (null for a create). */
  expectedRev: number | null;
  name: string;
  /** Intended definition (null for a delete). */
  def: ScreenDefinition | null;
  hash: string | null;
  review: ReviewSnapshot | null;
  /** sending = in flight; failed = the account did not acknowledge it; conflict = the account
   *  holds a different version; gone = the screen was deleted elsewhere. */
  state: "sending" | "failed" | "conflict" | "gone";
  error: FailReason | null;
  /** The account's version when `state` is conflict (null when it is a version this Terminal
   *  cannot read). */
  current: ScreenRecord | null;
  at: string;
};

export type SyncStatus = "guest" | "loading" | "ready" | "stale" | "unavailable";
export type ReadFailure = "network" | "unavailable" | "unauthenticated" | null;

export type SmartScreensSnapshot = {
  owner: string;
  status: SyncStatus;
  /** Why the last read failed (stale/unavailable only). */
  readFailure: ReadFailure;
  ack: Ack | null;
  pending: PendingOp[];
  busy: boolean;
  /** ok = the device copy is kept; failed = this browser refused the write (kept in memory for
   *  the session); blocked = a newer Terminal owns the device copy, which is left untouched. */
  device: "ok" | "failed" | "blocked";
};

export type OpOutcome =
  | { ok: true }
  | { ok: false; reason: "guest" | "no_baseline" | "busy" | "pending_exists" | "too_many_pending" | "invalid" | "not_found" | PendingOp["state"] };

type Deps = {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  storage: StoragePort | null;
  now?: () => string;
  newId?: () => string;
};

type ScreenContent = { name: string; def: ScreenDefinition; hash: string; review: ReviewSnapshot | null };

const sameIntent = (record: ScreenRecord, op: PendingOp): boolean =>
  record.id === op.id && record.name === op.name && record.hash === op.hash && op.def !== null
  && canonicalDefinition(record.def) === canonicalDefinition(op.def)
  && JSON.stringify(record.review) === JSON.stringify(op.review);

// ── parsing what comes back (from the account or from this device) ───────────────────────

function parseAckLists(value: { screens?: unknown; readOnly?: unknown; invalid?: unknown }): Omit<Ack, "readAt"> {
  const screens: ScreenRecord[] = [];
  const readOnly: ReadOnlyScreen[] = [];
  let invalid = typeof value.invalid === "number" && Number.isInteger(value.invalid) && value.invalid >= 0 ? value.invalid : 0;
  if (Array.isArray(value.screens)) {
    for (const item of value.screens) {
      // The client re-normalizes every record with the same grammar module the API used; a
      // record whose stored hash does not reproduce here is not trusted.
      const parsed = parseScreenRecord(item);
      if (parsed.kind === "ok") screens.push(parsed.record);
      else if (parsed.kind === "newer") readOnly.push(parsed.screen);
      else invalid++;
    }
  }
  if (Array.isArray(value.readOnly)) {
    for (const item of value.readOnly) {
      if (!isPlainObject(item) || typeof item.id !== "string" || !SCREEN_ID_RE.test(item.id)
        || !isScreenRevision(item.rev) || typeof item.schema !== "number"
        || !Number.isSafeInteger(item.schema) || item.schema < 1) { invalid++; continue; }
      readOnly.push({
        id: item.id, rev: item.rev, name: normalizeScreenName(item.name),
        // A newer grammar or review may still use record schema 1.
        schema: item.schema,
      });
    }
  }
  return { screens, readOnly, invalid };
}

function parseLocalAck(value: unknown): Ack | null {
  if (!isPlainObject(value) || typeof value.readAt !== "string" || !Number.isFinite(Date.parse(value.readAt))) return null;
  return { ...parseAckLists(value), readAt: value.readAt };
}

const OP_STATES = ["sending", "failed", "conflict", "gone"] as const;
const FAIL_REASONS: FailReason[] = ["network", "unavailable", "unauthenticated", "limit_reached", "record_too_large", "rejected", "interrupted", "newer_schema"];

function parseLocalOp(value: unknown): PendingOp | null {
  if (!isPlainObject(value)) return null;
  const { opId, action, id, expectedRev, name, state, error, at } = value;
  if (typeof opId !== "string" || !opId || opId.length > 64) return null;
  if (action !== "create" && action !== "update" && action !== "delete") return null;
  if (typeof id !== "string" || !/^[0-9a-f]{32}$/.test(id)) return null;
  if (action === "create" ? expectedRev !== null : typeof expectedRev !== "number") return null;
  const cleanName = normalizeScreenName(name);
  if (!cleanName || typeof at !== "string") return null;
  if (!(OP_STATES as readonly unknown[]).includes(state)) return null;
  let def: ScreenDefinition | null = null;
  let hash: string | null = null;
  let review: ReviewSnapshot | null = null;
  if (action !== "delete") {
    const normalized = normalizeDefinition(value.def);
    if (!normalized.ok) return null;
    def = normalized.def;
    hash = normalized.hash;
    if (value.review !== null && value.review !== undefined) {
      const checked = normalizeReview(value.review, hash);
      if (!checked.ok || !reviewableDefinition(def)) return null;
      review = checked.review;
    }
  }
  let current: ScreenRecord | null = null;
  if (value.current !== null && value.current !== undefined) {
    const parsed = parseScreenRecord(value.current);
    current = parsed.kind === "ok" ? parsed.record : null;
  }
  // A write that was in flight when the page went away has an UNKNOWN effect. It is shown as
  // failed so the user decides; a retry is safe because every write is idempotent by id + rev.
  const interrupted = state === "sending";
  return {
    opId, action, id, expectedRev: expectedRev as number | null, name: cleanName, def, hash, review,
    state: interrupted ? "failed" : (state as PendingOp["state"]),
    error: interrupted ? "interrupted" : FAIL_REASONS.includes(error as FailReason) ? (error as FailReason) : null,
    current, at,
  };
}

// ── the store ────────────────────────────────────────────────────────────────────────────

export class SmartScreenStore {
  private snap: SmartScreensSnapshot;
  private listeners = new Set<() => void>();
  private loaded = false;
  private lastReadAt = 0;
  private readonly now: () => string;
  private readonly newId: () => string;

  constructor(readonly owner: string, private readonly deps: Deps) {
    this.now = deps.now ?? (() => new Date().toISOString());
    this.newId = deps.newId ?? newScreenId;
    const guest = owner === GUEST_OWNER || !owner;
    this.snap = {
      owner, status: guest ? "guest" : "loading", readFailure: null, ack: null, pending: [], busy: false, device: "ok",
    };
    if (!guest) this.readDevice();
  }

  getSnapshot = (): SmartScreensSnapshot => this.snap;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private set(patch: Partial<SmartScreensSnapshot>, persist = false): void {
    this.snap = { ...this.snap, ...patch };
    if (persist) this.persist();
    for (const listener of this.listeners) listener();
  }

  private readDevice(): void {
    const storage = this.deps.storage;
    if (!storage) return;
    let slot: unknown;
    try { slot = readOwnerSlot(storage, SMART_SCREENS_LOCAL_KEY, this.owner); } catch { return; }
    if (!isPlainObject(slot)) return;
    if (typeof slot.v === "number" && slot.v > LOCAL_VERSION) {
      // A newer Terminal wrote this device copy. Leave its bytes alone; work from the account.
      this.snap = { ...this.snap, device: "blocked" };
      return;
    }
    if (slot.v !== LOCAL_VERSION) return;
    const ack = parseLocalAck(slot.ack);
    const pending = Array.isArray(slot.pending)
      ? slot.pending.map(parseLocalOp).filter((op): op is PendingOp => op !== null).slice(0, MAX_PENDING)
      : [];
    this.snap = { ...this.snap, ack, pending };
  }

  private persist(): void {
    const storage = this.deps.storage;
    if (!storage || this.snap.device === "blocked" || this.snap.status === "guest") return;
    const ok = writeOwnerSlot(storage, SMART_SCREENS_LOCAL_KEY, this.owner, {
      v: LOCAL_VERSION, ack: this.snap.ack, pending: this.snap.pending,
    });
    if (!ok && this.snap.device !== "failed") this.snap = { ...this.snap, device: "failed" };
    if (ok && this.snap.device === "failed") this.snap = { ...this.snap, device: "ok" };
  }

  /** Read on mount: the first time for this owner, then again only when the last read is older
   *  than `rereadAfterMs`. A call while a request is in flight (StrictMode) is a no-op. */
  load(rereadAfterMs = Number.POSITIVE_INFINITY): Promise<void> {
    if (this.snap.status === "guest" || this.snap.busy) return Promise.resolve();
    if (this.loaded && Date.now() - this.lastReadAt < rereadAfterMs) return Promise.resolve();
    this.loaded = true;
    return this.read();
  }

  /** User-initiated re-read (Retry). */
  refresh(): Promise<void> {
    if (this.snap.status === "guest" || this.snap.busy) return Promise.resolve();
    return this.read();
  }

  private async read(): Promise<void> {
    this.lastReadAt = Date.now();
    this.set({ busy: true });
    let failure: ReadFailure = null;
    try {
      const response = await this.deps.fetch(SMART_SCREENS_ENDPOINT, { method: "GET", cache: "no-store", credentials: "same-origin" });
      if (response.ok) {
        const body = await response.json().catch(() => null);
        if (isPlainObject(body) && Array.isArray(body.screens)) {
          const ack: Ack = { ...parseAckLists(body), readAt: this.now() };
          this.set({ ack, status: "ready", readFailure: null, busy: false }, true);
          return;
        }
        failure = "unavailable";
      } else failure = response.status === 401 ? "unauthenticated" : "unavailable";
    } catch {
      failure = "network";
    }
    // A failed read keeps whatever was acknowledged before — it is older, not empty.
    this.set({ status: this.snap.ack ? "stale" : "unavailable", readFailure: failure, busy: false });
  }

  private gate(id: string | null): OpOutcome | null {
    if (this.snap.status === "guest") return { ok: false, reason: "guest" };
    if (!this.snap.ack) return { ok: false, reason: "no_baseline" };
    if (this.snap.busy) return { ok: false, reason: "busy" };
    if (id && this.snap.pending.some((op) => op.id === id)) return { ok: false, reason: "pending_exists" };
    if (this.snap.pending.length >= MAX_PENDING) return { ok: false, reason: "too_many_pending" };
    return null;
  }

  private content(input: { name: unknown; def: unknown; review?: unknown }): ScreenContent | null {
    const name = normalizeScreenName(input.name);
    const normalized = normalizeDefinition(input.def);
    if (!name || !normalized.ok) return null;
    let review: ReviewSnapshot | null = null;
    if (input.review !== null && input.review !== undefined) {
      const checked = normalizeReview(input.review, normalized.hash);
      if (!checked.ok || !reviewableDefinition(normalized.def)) return null;
      review = checked.review;
    }
    return { name, def: normalized.def, hash: normalized.hash, review };
  }

  create(input: { name: unknown; def: unknown; review?: unknown }): Promise<OpOutcome> {
    const blocked = this.gate(null);
    if (blocked) return Promise.resolve(blocked);
    const content = this.content(input);
    if (!content) return Promise.resolve({ ok: false, reason: "invalid" });
    return this.begin({
      opId: this.newId(), action: "create", id: this.newId(), expectedRev: null, ...content,
      state: "sending", error: null, current: null, at: this.now(),
    });
  }

  /** Replace a screen's name/definition/review, conditional on the rev this device last saw. */
  update(id: string, patch: { name?: unknown; def?: unknown; review?: unknown }): Promise<OpOutcome> {
    const blocked = this.gate(id);
    if (blocked) return Promise.resolve(blocked);
    const record = this.snap.ack?.screens.find((screen) => screen.id === id);
    if (!record) return Promise.resolve({ ok: false, reason: "not_found" });
    const defChanged = patch.def !== undefined;
    const content = this.content({
      name: patch.name ?? record.name,
      def: patch.def ?? record.def,
      // A new definition invalidates the old review: it was evaluated under another predicate.
      review: patch.review !== undefined ? patch.review : defChanged ? null : record.review,
    });
    if (!content) return Promise.resolve({ ok: false, reason: "invalid" });
    return this.begin({
      opId: this.newId(), action: "update", id, expectedRev: record.rev, ...content,
      state: "sending", error: null, current: null, at: this.now(),
    });
  }

  remove(id: string): Promise<OpOutcome> {
    const blocked = this.gate(id);
    if (blocked) return Promise.resolve(blocked);
    const record = this.snap.ack?.screens.find((screen) => screen.id === id);
    const readOnly = this.snap.ack?.readOnly.find((screen) => screen.id === id);
    if (!record && !readOnly) return Promise.resolve({ ok: false, reason: "not_found" });
    return this.begin({
      opId: this.newId(), action: "delete", id, expectedRev: (record ?? readOnly)!.rev,
      name: record?.name ?? readOnly?.name ?? id.slice(0, 8), def: null, hash: null, review: null,
      state: "sending", error: null, current: null, at: this.now(),
    });
  }

  /** Re-send a failed write exactly as it was (same id, same expected rev). */
  retry(opId: string): Promise<OpOutcome> {
    const op = this.snap.pending.find((item) => item.opId === opId);
    if (!op) return Promise.resolve({ ok: false, reason: "not_found" });
    if (this.snap.busy) return Promise.resolve({ ok: false, reason: "busy" });
    if (op.state !== "failed") return Promise.resolve({ ok: false, reason: op.state });
    return this.send({ ...op, state: "sending", error: null });
  }

  /** Conflict → keep the account's version: this device's change is dropped. */
  useAccountVersion(opId: string): OpOutcome {
    const op = this.snap.pending.find((item) => item.opId === opId);
    if (!op || op.state !== "conflict") return { ok: false, reason: "not_found" };
    const ack = this.snap.ack && op.current ? this.applyRecord(this.snap.ack, op.current) : this.snap.ack;
    this.set({ ack, pending: this.snap.pending.filter((item) => item.opId !== opId) }, true);
    return { ok: true };
  }

  /** Conflict → write this device's version over the account's, now that the user has seen it. */
  overwrite(opId: string): Promise<OpOutcome> {
    const op = this.snap.pending.find((item) => item.opId === opId);
    if (!op || op.state !== "conflict" || !op.current) return Promise.resolve({ ok: false, reason: "not_found" });
    if (this.snap.busy) return Promise.resolve({ ok: false, reason: "busy" });
    const ack = this.snap.ack ? this.applyRecord(this.snap.ack, op.current) : this.snap.ack;
    this.set({ ack });
    // An overwrite cannot carry a review evaluated under a definition the account no longer
    // holds unless it is this device's own definition — which it is: op.def/op.review travel
    // together, and the API re-checks the review against the definition it stores.
    return this.send({ ...op, expectedRev: op.current.rev, state: "sending", error: null, current: null });
  }

  /** Gone (deleted on another device) → keep this device's version as a NEW screen. */
  saveAsNew(opId: string): Promise<OpOutcome> {
    const op = this.snap.pending.find((item) => item.opId === opId);
    if (!op || op.state !== "gone" || !op.def) return Promise.resolve({ ok: false, reason: "not_found" });
    if (this.snap.busy) return Promise.resolve({ ok: false, reason: "busy" });
    return this.send({ ...op, action: "create", id: this.newId(), expectedRev: null, state: "sending", error: null, current: null });
  }

  /** Forget only this local request. This neither undoes nor disproves an account write. */
  discard(opId: string): OpOutcome {
    const op = this.snap.pending.find((item) => item.opId === opId);
    if (!op || op.state === "sending") return { ok: false, reason: "not_found" };
    let ack = this.snap.ack;
    // A screen deleted elsewhere leaves the list when its pending change is discarded.
    if (op.state === "gone" && ack) ack = { ...ack, screens: ack.screens.filter((screen) => screen.id !== op.id) };
    this.set({ ack, pending: this.snap.pending.filter((item) => item.opId !== opId) }, true);
    return { ok: true };
  }

  private begin(op: PendingOp): Promise<OpOutcome> {
    return this.send(op);
  }

  private replaceOp(op: PendingOp, persist = true): void {
    const exists = this.snap.pending.some((item) => item.opId === op.opId);
    const pending = exists ? this.snap.pending.map((item) => (item.opId === op.opId ? op : item)) : [...this.snap.pending, op];
    this.set({ pending }, persist);
  }

  private applyRecord(ack: Ack, record: ScreenRecord): Ack {
    const screens = ack.screens.some((screen) => screen.id === record.id)
      ? ack.screens.map((screen) => (screen.id === record.id ? record : screen))
      : [...ack.screens, record];
    return { ...ack, screens, readOnly: ack.readOnly.filter((screen) => screen.id !== record.id) };
  }

  private settle(op: PendingOp, ack: Ack | null): OpOutcome {
    this.set({ ack, pending: this.snap.pending.filter((item) => item.opId !== op.opId), busy: false }, true);
    return { ok: true };
  }

  private fail(op: PendingOp, patch: Partial<PendingOp>): OpOutcome {
    const next = { ...op, ...patch };
    const uncertain = next.state === "failed" && (next.error === "network" || next.error === "unavailable");
    this.snap = {
      ...this.snap, busy: false,
      ...(uncertain ? { status: this.snap.ack ? "stale" as const : "unavailable" as const, readFailure: next.error as ReadFailure } : {}),
    };
    this.replaceOp(next);
    return { ok: false, reason: next.state };
  }

  private async send(op: PendingOp): Promise<OpOutcome> {
    // Persist the intent BEFORE the request, so a reload mid-flight still has it.
    this.snap = { ...this.snap, busy: true };
    this.replaceOp(op);
    const body = op.action === "delete"
      ? { action: "delete", id: op.id, expectedRev: op.expectedRev }
      : { action: op.action, id: op.id, expectedRev: op.expectedRev ?? undefined, name: op.name, def: op.def, review: op.review };
    let response: Response;
    let json: Record<string, unknown> | null = null;
    try {
      response = await this.deps.fetch(SMART_SCREENS_ENDPOINT, {
        method: "PUT", cache: "no-store", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const parsed = await response.json().catch(() => null);
      json = isPlainObject(parsed) ? parsed : null;
    } catch {
      return this.fail(op, { state: "failed", error: "network" });
    }
    const ack = this.snap.ack ?? { screens: [], readOnly: [], invalid: 0, readAt: this.now() };

    if (response.ok && json) {
      if (op.action === "delete") {
        if (json.deleted !== op.id || typeof json.alreadyGone !== "boolean") {
          return this.fail(op, { state: "failed", error: "unavailable" });
        }
        return this.settle(op, {
          ...ack,
          screens: ack.screens.filter((screen) => screen.id !== op.id),
          readOnly: ack.readOnly.filter((screen) => screen.id !== op.id),
        });
      }
      const parsed = parseScreenRecord(json.record, op.id);
      if (parsed.kind === "ok" && sameIntent(parsed.record, op)
        && (op.action === "create" ? parsed.record.rev === 1
          : parsed.record.rev === op.expectedRev || parsed.record.rev === Number(op.expectedRev) + 1)) {
        return this.settle(op, this.applyRecord(ack, parsed.record));
      }
      // A 2xx whose record this version cannot verify: the effect is unknown, so it stays pending.
      return this.fail(op, { state: "failed", error: "unavailable" });
    }
    const error = json && typeof json.error === "string" ? json.error : "";
    const newerConflict = error === "conflict" && json?.current === null && json?.readOnly != null;
    if (response.status === 409 && error === "conflict" && !newerConflict) {
      const parsed = parseScreenRecord(json?.current, op.id);
      if (isPlainObject(json?.current) && json.current.id !== op.id) {
        return this.fail(op, { state: "failed", error: "unavailable" });
      }
      if (parsed.kind !== "ok") return this.fail(op, { state: "failed", error: "unavailable" });
      const current = parsed.record;
      // The account already holds exactly what this write intended (an earlier attempt landed
      // and its answer was lost): that IS the acknowledgement.
      if (current && op.action !== "delete" && sameIntent(current, op)) return this.settle(op, this.applyRecord(ack, current));
      return this.fail(op, { state: "conflict", error: null, current });
    }
    if (response.status === 409 && (error === "newer_schema" || newerConflict)) {
      const readOnly = parseAckLists({ readOnly: [json?.readOnly] }).readOnly[0];
      if (!readOnly || readOnly.id !== op.id) return this.fail(op, { state: "failed", error: "unavailable" });
      this.snap = {
        ...this.snap,
        ack: {
          ...ack,
          screens: ack.screens.filter((screen) => screen.id !== op.id),
          readOnly: [...ack.readOnly.filter((screen) => screen.id !== op.id), readOnly],
        },
      };
      return this.fail(op, { state: "failed", error: "newer_schema" });
    }
    if (response.status === 409 && error === "limit_reached") return this.fail(op, { state: "failed", error: "limit_reached" });
    if (response.status === 404) return this.fail(op, { state: "gone", error: null });
    if (response.status === 413) return this.fail(op, { state: "failed", error: "record_too_large" });
    if (response.status === 401) return this.fail(op, { state: "failed", error: "unauthenticated" });
    if (response.status === 400) return this.fail(op, { state: "failed", error: "rejected" });
    return this.fail(op, { state: "failed", error: "unavailable" });
  }
}
