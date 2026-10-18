import {
  normalizeEntryCurrency, normalizeEntryDate, normalizeNotes, normalizeNumeric,
  normalizeStatus, normalizeTicker, type Position,
} from "@/lib/portfolio";

export type MutationReceipt = { ok?: boolean; position?: Position; deletedId?: string; error?: string };

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
