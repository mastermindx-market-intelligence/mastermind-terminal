/**
 * Options R1 W3C — review projector for a saved investigation. Pure: it folds the saved
 * revisions, the alerts owner's firing receipts and the W2 evidence status into the rows a
 * review shows — what changed, what stayed supported, which condition fired with its id,
 * vintage, observed value and delivery state — and mints the next immutable manifest that
 * records the user's assessment. An assessment never edits an existing revision; it is saved
 * as a NEW revision through the existing command.
 */
import type { InvestigationEvidenceRef, InvestigationManifest } from "./investigationContracts";
import { watchesFor, type OwnerAlertRow } from "./investigationWatch";

export type Assessment = "confirmed" | "contradicted" | "inconclusive";
export const ASSESSMENTS: readonly Assessment[] = ["confirmed", "contradicted", "inconclusive"];
export const isAssessment = (v: unknown): v is Assessment => ASSESSMENTS.includes(v as Assessment);

export type ReceiptQueue = "read" | "unavailable" | "absent";
export interface FireReceipt {
  fire_event_id: string | null;
  alert_id: string;
  fired_at: string | null;
  condition_plain: string | null;
  observed: number | null;
  source_note: string | null;
  vintage: string | null;
  delivery: string | null;
  corrects: { lane: string; id: string } | null;
  /** Where the receipt came from: an outbox row ("read"); the alert's own trigger stamp because
   * the outbox could not be read ("unavailable"); or the trigger stamp because the readable
   * outbox held no row for that firing ("absent"). The view words each differently — an
   * unreadable or capped queue is never shown as "not yet delivered". */
  queue: ReceiptQueue;
}
export interface ReviewRow { kind: "changed" | "still_supported" | "unavailable"; object_type: string; object_id: string; detail: string }

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): string | null => typeof v === "string" && v.length ? v : null;
const finite = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
const correctsOf = (v: unknown): FireReceipt["corrects"] =>
  record(v) && typeof v.lane === "string" && typeof v.id === "string" ? { lane: v.lane, id: v.id } : null;

/** The trigger stamp on the alert row describes its LATEST firing only (a re-arm deletes it).
 * Its value and note are paired with a receipt only when the receipt is that same firing — an
 * older firing's receipt never borrows a later firing's reading; it shows "—" instead. */
function receiptFrom(alert: OwnerAlertRow, queue: ReceiptQueue, over: Partial<FireReceipt>): FireReceipt {
  const triggered = alert.condition?.triggered;
  const fired_at = over.fired_at ?? text(triggered?.at);
  const sameFiring = fired_at !== null && fired_at === text(triggered?.at);
  return {
    fire_event_id: over.fire_event_id ?? null,
    alert_id: alert.id,
    fired_at,
    condition_plain: over.condition_plain ?? null,
    observed: over.observed ?? (sameFiring ? finite(triggered?.value) : null),
    source_note: sameFiring ? text(triggered?.note) : null,
    vintage: over.vintage ?? null,
    delivery: over.delivery ?? null,
    corrects: over.corrects ?? null,
    queue,
  };
}

const watchFired = (row: OwnerAlertRow) => !!row.condition?.triggered;
const firingKey = (alertId: string, firedAt: string | null) => `${alertId}\u0000${firedAt ?? ""}`;

/** One receipt per outbox row of a linked alert, each carrying ITS OWN observed reading
 * (`payload.value`, the engine's per-firing figure). When the outbox read is unavailable
 * (`outboxRows === null`) there is one trigger-stamp row per fired alert marked
 * queue "unavailable"; when the queue is readable but holds no row for a fired alert's latest
 * firing (the read is capped at its most recent rows) the stamp row is marked "absent". The
 * data never fabricates an id or a delivery state. */
export function receiptsFrom(alertRows: readonly OwnerAlertRow[], outboxRows: readonly unknown[] | null, investigationId: string): FireReceipt[] {
  const linked = new Map(watchesFor(alertRows, investigationId).map(row => [row.id, row]));
  const fired = [...linked.values()].filter(watchFired);
  if (outboxRows === null) return fired.map(row => receiptFrom(row, "unavailable", {}));
  const receipts: FireReceipt[] = [];
  const seen = new Set<string>();
  for (const raw of outboxRows) {
    if (!record(raw)) continue;
    const alertId = typeof raw.alert_id === "string" ? raw.alert_id : null;
    const alert = alertId ? linked.get(alertId) : undefined;
    if (!alert) continue;
    const payload = record(raw.payload) ? raw.payload : {};
    const receipt = receiptFrom(alert, "read", {
      fire_event_id: text(raw.fire_event_id),
      delivery: text(raw.status),
      fired_at: text(payload.fired_at),
      condition_plain: text(payload.condition_plain),
      observed: finite(payload.value),
      vintage: text(payload.source_asof),
      corrects: correctsOf(payload.corrects),
    });
    seen.add(firingKey(alert.id, receipt.fired_at));
    receipts.push(receipt);
  }
  for (const row of fired) {
    if (!seen.has(firingKey(row.id, text(row.condition?.triggered?.at)))) receipts.push(receiptFrom(row, "absent", {}));
  }
  return receipts;
}

/** Receipt order: by fired time, a correcting receipt immediately after the receipt it corrects. */
export function orderReceipts(receipts: readonly FireReceipt[]): FireReceipt[] {
  const rows = [...receipts].sort((a, b) => (a.fired_at ?? "").localeCompare(b.fired_at ?? ""));
  // A correcting receipt is listed after the receipt it corrects, never in its place.
  for (let i = 0; i < rows.length; i++) {
    const target = rows[i].corrects?.id;
    if (!target) continue;
    const at = rows.findIndex(row => row.fire_event_id === target);
    if (at > i) rows.splice(i, 0, ...rows.splice(at, 1));
  }
  return rows;
}

export function projectReview(
  revisions: readonly { revision: number; committed_at?: string; manifest: InvestigationManifest }[],
  evidenceStatus: readonly { ref: InvestigationEvidenceRef; state: string }[] | null,
  receipts: readonly FireReceipt[],
): { rows: ReviewRow[]; fired: FireReceipt | null; revisions: { revision: number; committed_at: string | null; assessment: Assessment | null }[] } {
  const rows: ReviewRow[] = (evidenceStatus ?? []).map(status => ({
    kind: status.state === "matches" ? "still_supported" : status.state === "source_corrected" ? "changed" : "unavailable",
    object_type: status.ref.object_type,
    object_id: status.ref.object_id,
    detail: reviewDetail(status),
  }));
  const listed = orderReceipts(receipts);
  const timed = listed.filter(row => row.fired_at);
  const fired = timed.length ? timed.reduce((a, b) => (a.fired_at! > b.fired_at! ? a : b)) : listed.at(-1) ?? null;
  return {
    rows,
    fired,
    revisions: [...revisions].sort((a, b) => b.revision - a.revision).map(({ revision, committed_at, manifest }) => ({
      revision, committed_at: committed_at ?? null, assessment: isAssessment(manifest.review?.assessment) ? manifest.review.assessment : null,
    })),
  };
}
function reviewDetail(status: { ref: InvestigationEvidenceRef; state: string; savedFingerprint?: string | null; currentFingerprint?: string | null }): string {
  if (status.state === "source_corrected") {
    if (status.savedFingerprint && status.currentFingerprint) return `${status.savedFingerprint} → ${status.currentFingerprint}`;
    return status.savedFingerprint ?? "";
  }
  return status.ref.version_ref ?? status.ref.fingerprint ?? "";
}

/** The next manifest: a structured copy carrying the review block. The input manifest is never
 * mutated — the existing command saves this as a NEW revision with expected_revision. */
export function assessmentRevision(manifest: InvestigationManifest, assessment: Assessment, fire_event_id?: string | null, note?: string | null): InvestigationManifest {
  if (!isAssessment(assessment)) throw new Error(`invalid_assessment:${String(assessment)}`);
  const next = JSON.parse(JSON.stringify(manifest)) as InvestigationManifest;
  const review: NonNullable<InvestigationManifest["review"]> = { assessment };
  if (fire_event_id) review.fire_event_id = fire_event_id;
  if (note) review.note = note;
  next.review = review;
  return next;
}
