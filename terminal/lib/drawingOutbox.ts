import { type Drawing } from "@/lib/drawings";
import { drawingSourceConflict, readDrawingRecovery } from "@/lib/drawingAiPersistence";

const DRAWING_OUTBOX_KEY = "mm.drawing.account-outbox.v1";
const MIXED_SCHEMA = "chart.drawing_recovery.v2";
export type DrawingOutbox = Record<string, Drawing[]>;
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type StoredEnvelope = Record<string, Record<string, unknown>>;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const accountOwner = (owner: string) => owner.startsWith("account:") && owner.length > "account:".length;

function readEnvelope(storage: StoragePort): StoredEnvelope {
  try {
    const value = JSON.parse(storage.getItem(DRAWING_OUTBOX_KEY) || "{}");
    return record(value) ? value as StoredEnvelope : {};
  } catch { return {}; }
}

/** Only explicitly upgraded full snapshots can replace a mixed collection. */
export function readDrawingOutbox(storage: StoragePort, owner: string): DrawingOutbox {
  if (!accountOwner(owner)) return {};
  const stored = readEnvelope(storage)[owner];
  if (!record(stored)) return {};
  const outbox: DrawingOutbox = {};
  for (const [symbol, value] of Object.entries(stored)) {
    if (!record(value) || value.schema !== MIXED_SCHEMA) continue;
    const drawings = readDrawingRecovery(value.drawings);
    if (drawings) outbox[symbol] = drawings;
  }
  return outbox;
}

/** Legacy snapshots replace humans only, after the account's server load succeeds. */
export function readLegacyDrawingOutbox(storage: StoragePort, owner: string): DrawingOutbox {
  if (!accountOwner(owner)) return {};
  const stored = readEnvelope(storage)[owner];
  if (!record(stored)) return {};
  const outbox: DrawingOutbox = {};
  for (const [symbol, value] of Object.entries(stored)) {
    if (!Array.isArray(value)) continue;
    const drawings = readDrawingRecovery(value);
    if (drawings && drawings.every(drawing => drawing.source === "user")) outbox[symbol] = drawings;
  }
  return outbox;
}

/** Update the same owner's recovery; retain legacy entries until explicitly upgraded. */
export function writeDrawingOutbox(storage: StoragePort, owner: string, outbox: DrawingOutbox): boolean {
  if (!accountOwner(owner)) return false;
  try {
    const envelope = readEnvelope(storage);
    const previous = record(envelope[owner]) ? envelope[owner] : {};
    const valid: Record<string, unknown> = Object.fromEntries(
      Object.entries(previous).filter(([, value]) => Array.isArray(value)),
    );
    for (const [symbol, drawings] of Object.entries(outbox)) {
      if (drawings.some(drawingSourceConflict)) return false;
      const persisted = readDrawingRecovery(drawings.filter(drawing => drawing.source !== "detector"));
      if (!persisted) return false;
      // [] is an explicit mixed clear, unlike a legacy human-only tombstone.
      valid[symbol] = { schema: MIXED_SCHEMA, drawings: persisted };
    }
    if (Object.keys(valid).length) envelope[owner] = valid;
    else delete envelope[owner];
    if (Object.keys(envelope).length) storage.setItem(DRAWING_OUTBOX_KEY, JSON.stringify(envelope));
    else storage.removeItem(DRAWING_OUTBOX_KEY);
    return true;
  } catch { return false; }
}

export { DRAWING_OUTBOX_KEY };
