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
}
export interface ReviewRow { kind: "changed" | "still_supported" | "unavailable"; object_type: string; object_id: string; detail: string }

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): string | null => typeof v === "string" && v.length ? v : null;
const correctsOf = (v: unknown): FireReceipt["corrects"] =>
  record(v) && typeof v.lane === "string" && typeof v.id === "string" ? { lane: v.lane, id: v.id } : null;

function receiptFrom(alert: OwnerAlertRow, over: Partial<FireReceipt>): FireReceipt {
  const triggered = alert.condition?.triggered;
  return {
    fire_event_id: over.fire_event_id ?? null,
    alert_id: alert.id,
    fired_at: over.fired_at ?? text(triggered?.at),
    condition_plain: over.condition_plain ?? null,
    observed: typeof triggered?.value === "number" && Number.isFinite(triggered.value) ? triggered.value : null,
    source_note: text(triggered?.note),
    vintage: over.vintage ?? null,
    delivery: over.delivery ?? null,
    corrects: over.corrects ?? null,
  };
}

/** One receipt per outbox row of a linked alert. When the outbox read is unavailable
 * (`outboxRows === null`) there is one row per fired alert with a null fire_event_id — the view
 * renders "not yet delivered"; the data never fabricates an id. */
export function receiptsFrom(alertRows: readonly OwnerAlertRow[], outboxRows: readonly unknown[] | null, investigationId: string): FireReceipt[] {
  const linked = new Map(watchesFor(alertRows, investigationId).map(row => [row.id, row]));
  if (outboxRows === null) return [...linked.values()].filter(row => watchFired(row)).map(row => receiptFrom(row, {}));
  const receipts: FireReceipt[] = [];
  for (const raw of outboxRows ?? []) {
    if (!record(raw)) continue;
    const alertId = typeof raw.alert_id === "string" ? raw.alert_id : null;
    const alert = alertId ? linked.get(alertId) : undefined;
    if (!alert) continue;
    const payload = record(raw.payload) ? raw.payload : {};
    receipts.push(receiptFrom(alert, {
      fire_event_id: text(raw.fire_event_id),
      delivery: text(raw.status),
      fired_at: text(payload.fired_at),
      condition_plain: text(payload.condition_plain),
      vintage: text(payload.source_asof),
      corrects: correctsOf(payload.corrects),
    }));
  }
  return receipts;
}
const watchFired = (row: OwnerAlertRow) => !!row.condition?.triggered;

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
