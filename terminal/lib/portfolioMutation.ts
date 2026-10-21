import {
  normalizeEntryCurrency, normalizeEntryDate, normalizeNotes, normalizeNumeric,
  normalizeStatus, normalizeTicker, type Position,
} from "@/lib/portfolio";

export type MutationReceipt = { ok?: boolean; position?: Position; deletedId?: string; error?: string };

const POSITION_REFUSALS = [
  [400, "invalid ticker", "invalidPositionTicker"],
  [400, "invalid shares", "invalidPositionShares"],
  [400, "invalid entry price", "invalidPositionPrice"],
  [400, "invalid entry currency", "invalidPositionCurrency"],
  [400, "invalid entry date", "invalidPositionDate"],
  [400, "invalid notes", "invalidPositionNotes"],
  [400, "invalid position intent", "invalidPositionIntent"],
  [404, "position not found", "positionNotFound"],
  [409, "position intent conflict", "createConflict"],
  [409, "entry price or identity changed; currency not recorded", "positionCurrencyUnconfirmed"],
  // The fixed stale-owner precondition (comparison-only, refused before any store call). A
  // fenced write must not invite a blind retry of a deliberately refused intent (011 F7).
  [409, "owner mismatch", "ownerChanged"],
] as const;

export type PositionFailureReason = typeof POSITION_REFUSALS[number][2];
/** A retired write is discriminated, never success and never an ordinary refusal: a queued
 *  intent whose owner scope retired BEFORE dispatch was never sent, and one that retired after
 *  the POST was sent stays sent-but-unconfirmable — no replay, no rollback claim (011 F5). */
export type RetiredMutationStage = "never-dispatched" | "sent-uncertain";
export type PositionMutationResult =
  | { ok: true }
  | { ok: false; reason: PositionFailureReason | null; retired?: RetiredMutationStage };

/** Only known status/code pairs carry actionable copy. An arbitrary error, a 5xx,
 * or an unreadable reply says nothing about whether an earlier attempt persisted. */
export function positionMutationFailure(status: number, receipt: unknown): Extract<PositionMutationResult, { ok: false }> {
  const error = receipt && typeof receipt === "object" && !Array.isArray(receipt)
    && "error" in receipt && typeof receipt.error === "string" ? receipt.error : null;
  const refusal = POSITION_REFUSALS.find(([expectedStatus, code]) => status === expectedStatus && error === code);
  return { ok: false, reason: refusal?.[2] ?? null };
}

/** Both Portfolio entry points confirm their own intended write against the same
 * canonical read. This predicate owns no fetch, queue, persistent state, or retry. */
export function mutationPostcondition(
  body: Record<string, unknown>,
  receipt: MutationReceipt,
  positions: readonly Position[],
): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)
    || !receipt || typeof receipt !== "object" || Array.isArray(receipt) || receipt.ok !== true
    || !Array.isArray(positions)) return false;
  const action = body.action;
  if (!["create", "update", "close", "reopen", "delete"].includes(String(action))) return false;
  if (action === "delete") {
    const intendedId = typeof body.id === "string" ? body.id.trim() : "";
    return !!intendedId && receipt.deletedId === intendedId
      && !positions.some(position => position?.id === intendedId);
  }

  const written = receipt.position;
  if (!written || typeof written.id !== "string" || !written.id) return false;
  if (action !== "create" && written.id !== body.id) return false;
  if (action === "create" && body.clientPositionId !== undefined
    && (typeof body.clientPositionId !== "string" || written.id !== body.clientPositionId.toLowerCase())) return false;
  if (action === "close" && written.status !== "closed") return false;
  if (action === "reopen" && written.status !== "open") return false;

  if (action === "create" || action === "update") {
    if (action === "create" || body.ticker !== undefined) {
      const ticker = normalizeTicker(body.ticker);
      if (!ticker || written.ticker !== ticker) return false;
    }
    // Use the canonical writer's normalization: blank, absent, and invalid have
    // different meanings; a valid receipt cannot substitute a different intent.
    for (const [key, normalize] of [
      ["shares", normalizeNumeric], ["entryPrice", normalizeNumeric],
      ["entryCurrency", normalizeEntryCurrency], ["entryDate", normalizeEntryDate],
      ["notes", normalizeNotes],
    ] as const) {
      const field = normalize(body[key]);
      if (field.kind === "invalid") return false;
      if (field.kind === "value" && (written[key] ?? null) !== field.value) return false;
      if (field.kind === "absent" && action === "create" && (written[key] ?? null) !== null) return false;
    }
    if ((action === "create" || body.status !== undefined) && written.status !== normalizeStatus(body.status)) return false;
  }

  const reread = positions.find(position => position?.id === written.id);
  if (!reread) return false;
  return reread.ticker === written.ticker
    && reread.shares === written.shares && reread.entryPrice === written.entryPrice
    && (reread.entryCurrency ?? null) === (written.entryCurrency ?? null)
    && reread.entryDate === written.entryDate && reread.notes === written.notes
    && reread.status === written.status && reread.createdAt === written.createdAt;
}
