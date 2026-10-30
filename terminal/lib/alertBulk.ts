import { isForexWatch } from "./forexWatches";
/**
 * E18 — scoped alert management: filter, select an explicit set, pause or resume it, and report
 * every row's own outcome. Pure contract module (no React, no fetch, no DOM) so each rule below is
 * unit-testable on its own.
 *
 * The only owner of alert state is `/api/alerts` (app/api/alerts/route.ts): it authenticates, owner-
 * scopes every read and write to the signed-in account, and is the one place tier rules live. This
 * module never decides whether a write is allowed — it decides only WHICH ids a confirmed action
 * targets and HOW to read the owner's answer for each one.
 *
 * Rules, each pinned by lib/__tests__/alertBulk.test.ts:
 *  1. The target is the captured selection, in the order it was selected — never whatever the
 *     filters happen to show when the user confirms (AC-E18-01).
 *  2. Every row's answer is classified on its own: acknowledged · refused · not confirmed · not sent ·
 *     skipped. The summary counts each kind; it never collapses a mixed batch into "all updated"
 *     (AC-E18-02).
 *  3. Each id is sent at most once. An answer that does not acknowledge the write is NOT replayed and
 *     is never counted as paused or resumed — even when a later read shows the hoped-for state, that
 *     is a reading, not a confirmation (AC-E18-03, the macro#6819 re-arm rule).
 *  4. A refresh keeps every selected id that still exists and names the ones that were deleted or
 *     changed since they were selected (AC-E18-05). A pending review becomes stale on any change.
 */

export type BulkAlert = {
  id: string;
  symbol: string;
  active: boolean;
  condition: Record<string, unknown>;
  created_at: string;
};

/** What the store's own fields say about one alert. There is no expiry and no group field. */
export type AlertState = "armed" | "paused" | "fired" | "saved";
export type TypeGroup = "signal" | "price" | "rsi" | "regime" | "options" | "suite" | "forex" | "other";
export type BulkAction = "pause" | "resume";

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** Inventory rows the manager can act on. A row without a string id is unusable and dropped. */
export function toBulkAlerts(raw: unknown): BulkAlert[] | null {
  if (!Array.isArray(raw)) return null;
  const out: BulkAlert[] = [];
  for (const r of raw) {
    if (!isPlainObject(r) || typeof r.id !== "string" || !r.id) continue;
    out.push({
      id: r.id,
      symbol: typeof r.symbol === "string" ? r.symbol : "",
      active: r.active === true,
      condition: isPlainObject(r.condition) ? r.condition : {},
      created_at: typeof r.created_at === "string" ? r.created_at : "",
    });
  }
  return out;
}

/** Armed = the engine evaluates it; fired = the engine disarmed it and stamped it; paused = off. */
export function alertState(a: Pick<BulkAlert, "active" | "condition">): AlertState {
  if (isForexWatch(a.condition)) return "saved";
  if (a.active) return "armed";
  return a.condition && a.condition.triggered ? "fired" : "paused";
}

export function typeGroup(condition: Record<string, unknown> | null | undefined): TypeGroup {
  if (isForexWatch(condition)) return "forex";
  const t = typeof condition?.type === "string" ? condition.type : "";
  if (t === "signal" || t === "price" || t === "rsi" || t === "regime") return t;
  if (t.startsWith("opt_")) return "options";
  if (t === "suite_event" || t === "suite_sequence") return "suite";
  return "other";
}

export type BulkFilter = { state: AlertState | "all"; type: TypeGroup | "all"; symbol: string };
export const NO_FILTER: BulkFilter = { state: "all", type: "all", symbol: "" };

export function matchesFilter(a: BulkAlert, f: BulkFilter): boolean {
  if (f.state !== "all" && alertState(a) !== f.state) return false;
  if (f.type !== "all" && typeGroup(a.condition) !== f.type) return false;
  const q = f.symbol.trim().toUpperCase();
  return !q || a.symbol.toUpperCase().includes(q);
}

/**
 * What a confirmed action would do to one row, decided from the row as last read:
 *   pause  · armed → pause · paused → skip (already paused) · fired → skip (not being watched)
 *   resume · paused → resume · fired → re-arm (the owner clears the fired record) · armed → skip
 */
export type Applicability = "apply" | "rearm" | "skip-paused" | "skip-fired" | "skip-armed" | "skip-forex";

export function applicability(a: BulkAlert, action: BulkAction): Applicability {
  if (isForexWatch(a.condition)) return "skip-forex";
  const s = alertState(a);
  if (action === "pause") return s === "armed" ? "apply" : s === "paused" ? "skip-paused" : "skip-fired";
  return s === "paused" ? "apply" : s === "fired" ? "rearm" : "skip-armed";
}

export const willWrite = (ap: Applicability) => ap === "apply" || ap === "rearm";

/** Key order-independent JSON, so two reads of the same row compare equal. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (isPlainObject(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
  return JSON.stringify(v) ?? "null";
}

/** Everything that would change what an action means for this row. */
export function fingerprint(a: BulkAlert): string {
  return `${alertState(a)}|${a.symbol}|${stable(a.condition)}`;
}

// ── selection ────────────────────────────────────────────────────────────────

/**
 * The user's explicit selection, scoped to the account it was made under. `rows` holds each
 * selected row as it was when last seen, so a deleted row can still be named.
 */
export type Selection = { owner: string; order: string[]; rows: Record<string, BulkAlert> };

export const emptySelection = (owner: string): Selection => ({ owner, order: [], rows: {} });

export function toggle(sel: Selection, a: BulkAlert): Selection {
  if (sel.rows[a.id]) {
    const rows = { ...sel.rows };
    delete rows[a.id];
    return { ...sel, order: sel.order.filter((id) => id !== a.id), rows };
  }
  return { ...sel, order: [...sel.order, a.id], rows: { ...sel.rows, [a.id]: a } };
}

/** Adds every shown row not yet selected, after the existing selection. Never removes any. */
export function addAll(sel: Selection, shown: BulkAlert[]): Selection {
  let next = sel;
  for (const a of shown) if (!next.rows[a.id]) next = toggle(next, a);
  return next;
}

export type ChangedRow = { before: BulkAlert; after: BulkAlert };
export type RefreshReport = { deleted: BulkAlert[]; changed: ChangedRow[] };

/**
 * Re-read the selection against a fresh inventory. Rows still present stay selected (and take the
 * fresh copy); rows gone from the inventory leave the selection and are reported as deleted; rows
 * whose state or condition moved stay selected and are reported as changed.
 */
export function reconcileSelection(sel: Selection, inventory: BulkAlert[]): { selection: Selection; report: RefreshReport } {
  const byId = new Map(inventory.map((a) => [a.id, a]));
  const order: string[] = [];
  const rows: Record<string, BulkAlert> = {};
  const report: RefreshReport = { deleted: [], changed: [] };
  for (const id of sel.order) {
    const before = sel.rows[id];
    const after = byId.get(id);
    if (!after) { report.deleted.push(before); continue; }
    if (fingerprint(before) !== fingerprint(after)) report.changed.push({ before, after });
    order.push(id);
    rows[id] = after;
  }
  return { selection: { owner: sel.owner, order, rows }, report };
}

/**
 * Fold a newer refresh report into the one on screen: one line per alert. A row changed twice
 * keeps its first "before" and its latest "after"; a changed row that is later deleted is reported
 * as deleted only.
 */
export function mergeReport(prev: RefreshReport, next: RefreshReport): RefreshReport {
  const deleted = new Map(prev.deleted.map((a) => [a.id, a]));
  for (const a of next.deleted) if (!deleted.has(a.id)) deleted.set(a.id, a);
  const changed = new Map(prev.changed.map((c) => [c.after.id, c]));
  for (const c of next.changed) {
    const had = changed.get(c.after.id);
    changed.set(c.after.id, had ? { before: had.before, after: c.after } : c);
  }
  for (const id of deleted.keys()) changed.delete(id);
  const changedRows = [...changed.values()].filter((c) => fingerprint(c.before) !== fingerprint(c.after));
  return { deleted: [...deleted.values()], changed: changedRows };
}

export const hasReport = (r: RefreshReport) => r.deleted.length > 0 || r.changed.length > 0;

// ── review (preview + explicit confirmation) ────────────────────────────────

export type PlanRow = { row: BulkAlert; applies: Applicability };
export type BulkPlan = { owner: string; action: BulkAction; rows: PlanRow[] };

/** Freeze the selection into the exact list a confirmation will act on, in selection order. */
export function capturePlan(sel: Selection, action: BulkAction): BulkPlan {
  return {
    owner: sel.owner,
    action,
    rows: sel.order.map((id) => ({ row: sel.rows[id], applies: applicability(sel.rows[id], action) })),
  };
}

/** A review is confirmable only while every captured row still reads exactly as it was reviewed. */
export function planStillMatches(plan: BulkPlan, inventory: BulkAlert[]): boolean {
  const byId = new Map(inventory.map((a) => [a.id, a]));
  return plan.rows.every(({ row }) => {
    const now = byId.get(row.id);
    return !!now && fingerprint(now) === fingerprint(row);
  });
}

// ── execution ───────────────────────────────────────────────────────────────

export type RefusalReason = "signed-out" | "not-found" | "not-allowed";
export type NotSentReason = "signed-out" | "account-changed";

export type RowOutcome =
  | { kind: "acknowledged"; row: BulkAlert }
  | { kind: "refused"; reason: RefusalReason }
  | { kind: "unknown" }
  | { kind: "not-sent"; reason: NotSentReason };

export type Reply = { status: number; body: unknown } | "transport-failed";

/**
 * A reply acknowledges THIS write only when it carries the row back, under the expected id, in the
 * state the action produces. Resume additionally requires the fired stamp to be gone (route.ts
 * strips it on re-arm). A pause reply may carry a stamp: the engine fired the row before the pause
 * landed, and the row is still not being watched — the outcome then shows it as fired.
 */
export function isAck(x: unknown, id: string, action: BulkAction): boolean {
  if (!isPlainObject(x)) return false;
  if (x.id !== id || typeof x.symbol !== "string" || typeof x.created_at !== "string") return false;
  if (!isPlainObject(x.condition)) return false;
  if (action === "pause") return x.active === false;
  return x.active === true && !("triggered" in x.condition);
}

/**
 * Only an owner that said NO, in its own words, is a refusal: 401/403/404 carrying `{error}` are
 * answered before the store is written. Everything else — a 2xx without the row, a 400 (the owner
 * uses it after a failed update too), a 5xx, a gateway page, a dropped connection — is not
 * confirmed either way.
 */
export function classifyReply(reply: Reply, id: string, action: BulkAction): RowOutcome {
  if (reply === "transport-failed") return { kind: "unknown" };
  const { status, body } = reply;
  if (status >= 200 && status < 300) {
    const alert = isPlainObject(body) ? body.alert : undefined;
    if (isAck(alert, id, action)) {
      const [row] = toBulkAlerts([alert]) ?? [];
      if (row) return { kind: "acknowledged", row };
    }
    return { kind: "unknown" };
  }
  const said = isPlainObject(body) && typeof body.error === "string";
  if (said && status === 401) return { kind: "refused", reason: "signed-out" };
  if (said && status === 403) return { kind: "refused", reason: "not-allowed" };
  if (said && status === 404) return { kind: "refused", reason: "not-found" };
  return { kind: "unknown" };
}

export type RunOptions = {
  /** At most this many writes in flight at once. */
  concurrency: number;
  /** The account the page is on NOW — compared with the plan's owner before every send. */
  currentOwner: () => string;
  send: (id: string, action: BulkAction) => Promise<Reply>;
  onSending?: (id: string) => void;
  onOutcome?: (id: string, outcome: RowOutcome) => void;
};

/**
 * Send each writable row of a confirmed plan exactly once, with bounded concurrency. No retry
 * exists here on purpose. A refusal for "signed out", or the page moving to another account, stops
 * every row not yet sent; those rows are reported as not sent rather than guessed at.
 */
export async function runPlan(plan: BulkPlan, opts: RunOptions): Promise<Record<string, RowOutcome>> {
  const queue = plan.rows.filter((r) => willWrite(r.applies)).map((r) => r.row.id);
  const outcomes: Record<string, RowOutcome> = {};
  let stop: NotSentReason | null = null;
  let next = 0;
  const settle = (id: string, o: RowOutcome) => { outcomes[id] = o; opts.onOutcome?.(id, o); };
  const worker = async () => {
    while (next < queue.length) {
      const id = queue[next++];
      if (!stop && opts.currentOwner() !== plan.owner) stop = "account-changed";
      if (stop) { settle(id, { kind: "not-sent", reason: stop }); continue; }
      opts.onSending?.(id);
      let reply: Reply;
      try {
        reply = await opts.send(id, plan.action);
      } catch {
        reply = "transport-failed";
      }
      const o = classifyReply(reply, id, plan.action);
      if (o.kind === "refused" && o.reason === "signed-out") stop = "signed-out";
      settle(id, o);
    }
  };
  const n = Math.max(1, Math.min(opts.concurrency, queue.length));
  await Promise.all(Array.from({ length: n }, worker));
  return outcomes;
}

// ── reporting ───────────────────────────────────────────────────────────────

export type Tally = {
  /** captured rows in the plan */
  total: number;
  acknowledged: number;
  refused: number;
  unknown: number;
  notSent: number;
  skipped: number;
  /** rows still waiting on their answer */
  pending: number;
};

export function tally(plan: BulkPlan, outcomes: Record<string, RowOutcome | undefined>): Tally {
  const t: Tally = { total: plan.rows.length, acknowledged: 0, refused: 0, unknown: 0, notSent: 0, skipped: 0, pending: 0 };
  for (const { row, applies } of plan.rows) {
    if (!willWrite(applies)) { t.skipped++; continue; }
    const o = outcomes[row.id];
    if (!o) t.pending++;
    else if (o.kind === "acknowledged") t.acknowledged++;
    else if (o.kind === "refused") t.refused++;
    else if (o.kind === "unknown") t.unknown++;
    else t.notSent++;
  }
  return t;
}

/**
 * The result line, as counted parts in a fixed order. There is deliberately no "all done" part:
 * the line is always the counts themselves, so a mixed batch can never read as a clean one. A pause
 * the owner acknowledged on a row that had ALREADY triggered is counted apart from the plain pauses
 * — it is off, but it fired first.
 */
export type SummaryKind = "done" | "triggeredFirst" | "refused" | "unknown" | "notSent" | "skipped" | "pending";
export type Summary = { action: BulkAction; total: number; parts: Array<{ kind: SummaryKind; n: number }> };

export function summarize(plan: BulkPlan, outcomes: Record<string, RowOutcome | undefined>): Summary {
  const tl = tally(plan, outcomes);
  let triggeredFirst = 0;
  if (plan.action === "pause") {
    for (const { row } of plan.rows) {
      const o = outcomes[row.id];
      if (o?.kind === "acknowledged" && alertState(o.row) === "fired") triggeredFirst++;
    }
  }
  const counts: Array<[SummaryKind, number]> = [
    ["done", tl.acknowledged - triggeredFirst],
    ["triggeredFirst", triggeredFirst],
    ["refused", tl.refused],
    ["unknown", tl.unknown],
    ["notSent", tl.notSent],
    ["skipped", tl.skipped],
    ["pending", tl.pending],
  ];
  return {
    action: plan.action,
    total: tl.total,
    parts: counts.filter(([, n]) => n > 0).map(([kind, n]) => ({ kind, n })),
  };
}

/**
 * For each not-confirmed row, what a later inventory read observed — qualified, never promoted to a
 * confirmation. `null` inventory means the read itself failed.
 */
export type Observation = { kind: "state"; state: AlertState } | { kind: "missing" } | { kind: "unreadable" };

export function observeUnknown(
  outcomes: Record<string, RowOutcome>,
  inventory: BulkAlert[] | null,
): Record<string, Observation> {
  const byId = inventory ? new Map(inventory.map((a) => [a.id, a])) : null;
  const out: Record<string, Observation> = {};
  for (const [id, o] of Object.entries(outcomes)) {
    if (o.kind !== "unknown") continue;
    if (!byId) { out[id] = { kind: "unreadable" }; continue; }
    const a = byId.get(id);
    out[id] = a ? { kind: "state", state: alertState(a) } : { kind: "missing" };
  }
  return out;
}
