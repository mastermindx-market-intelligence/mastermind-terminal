import { AI_OBJECT_CAP, CAPTION_MAX, DRAW_OPS, type AiObject } from "./chartBus";
import { MAX_DRAWINGS_PER_SYMBOL, normalizeDrawing, normalizeDrawings, type Drawing } from "./drawings";
import { drawingToolAcceptsPersistedPointCount } from "./drawingTools";
import { isAiNativeDrawingKind } from "./chartDrawingTools";

// Provenance is inert metadata in the incumbent drawing collection. It never
// restores an execution target, ACK, command queue or authorization grant.
export const AI_DRAWING_SCHEMA = "chart.ai_drawing.v1";
const OPS = new Set<string>(DRAW_OPS);
const KEYS = new Set(["schema", "command_id", "op", "batch_id", "seq", "caption", "layer_hidden"]);
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const token = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max
  && !/[\u0000-\u001f\u007f]/.test(value);

/** Restore one AI object only when its complete provenance and geometry survive. */
export function readStoredAiDrawing(drawing: Drawing): AiObject | null {
  if (drawing.source !== "ai" || !token(drawing.id, 96) || !drawing.id.startsWith("ai_")) return null;
  const meta = drawing.meta?.chart_ai;
  if (!record(meta) || meta.schema !== AI_DRAWING_SCHEMA || Object.keys(meta).some(key => !KEYS.has(key))
    || !token(meta.command_id, 64) || !meta.command_id.startsWith("ai_")
    || !token(meta.batch_id, 40) || typeof meta.op !== "string" || !OPS.has(meta.op)
    || !Number.isSafeInteger(meta.seq) || Number(meta.seq) < 0
    || typeof meta.layer_hidden !== "boolean"
    || (meta.caption !== undefined && (typeof meta.caption !== "string" || meta.caption.length > CAPTION_MAX
      || /[\u0000-\u001f\u007f]/.test(meta.caption)))) return null;
  if (!Array.isArray(drawing.points) || !drawingToolAcceptsPersistedPointCount(drawing.kind, drawing.points.length)
    || drawing.points.length > 64 || drawing.points.some(point =>
      !record(point) || (typeof point.t !== "string" && typeof point.t !== "number")
      || !/^[0-9]+$/.test(String(point.t)) || !Number.isSafeInteger(Number(point.t))
      || Number(point.t) < 631152000 || Number(point.t) > 4102444800
      || !Number.isFinite(point.p) || point.p <= 0)
    || (meta.op === "draw.tool" && !isAiNativeDrawingKind(drawing.kind))) return null;
  return { ...drawing, by: "ai", auto: true, source: "ai",
    command_id: meta.command_id, op: meta.op as AiObject["op"],
    batch_id: meta.batch_id, seq: Number(meta.seq),
    ...(typeof meta.caption === "string" ? { caption: meta.caption } : {}) };
}

/** Encode into metadata already retained by the canonical normalizer/outbox/API. */
export function storeAiDrawing(object: AiObject, layerHidden: boolean): Drawing {
  const candidate: Drawing = { ...object, source: "ai", auto: true,
    meta: { ...object.meta, by: "ai", chart_ai: {
      schema: AI_DRAWING_SCHEMA, command_id: object.command_id ?? object.id,
      op: object.op, batch_id: object.batch_id, seq: object.seq,
      ...(object.caption ? { caption: object.caption } : {}), layer_hidden: layerHidden,
    } } };
  if (!readStoredAiDrawing(candidate)) throw new Error("invalid_ai_drawing");
  const drawing = normalizeDrawing(candidate);
  if (!drawing || !readStoredAiDrawing(drawing)) throw new Error("invalid_ai_drawing");
  return drawing;
}

export function storedAiObjects(drawings: readonly Drawing[]): AiObject[] {
  return drawings.map(readStoredAiDrawing).filter((drawing): drawing is AiObject => drawing !== null);
}

export function storedAiLayerHidden(drawings: readonly Drawing[]): boolean {
  return drawings.some(drawing => readStoredAiDrawing(drawing) && drawing.meta?.chart_ai
    && (drawing.meta.chart_ai as Record<string, unknown>).layer_hidden === true);
}

/** Strict mixed-collection boundary; legacy interactive normalization stays lenient. */
export function aiDrawingCollectionError(drawings: readonly Drawing[]): string | null {
  if (drawings.length > MAX_DRAWINGS_PER_SYMBOL) return "drawing_collection_limit";
  const ids = new Set<string>();
  let aiCount = 0;
  let layerHidden: boolean | undefined;
  for (const drawing of drawings) {
    if (ids.has(drawing.id)) return "duplicate_drawing_id";
    ids.add(drawing.id);
    if (drawing.source !== "ai") continue;
    if (!readStoredAiDrawing(drawing)) return "invalid_ai_drawing";
    if (++aiCount > AI_OBJECT_CAP) return "ai_object_limit";
    const hidden = (drawing.meta!.chart_ai as Record<string, unknown>).layer_hidden as boolean;
    if (layerHidden !== undefined && hidden !== layerHidden) return "inconsistent_ai_layer_visibility";
    layerHidden = hidden;
  }
  return null;
}

/** Refuse contradictory provenance before a normalizer could turn it into human work. */
export function drawingSourceConflict(value: unknown): boolean {
  if (!record(value)) return true;
  if (value.source !== undefined && (typeof value.source !== "string" || !["user", "detector", "ai"].includes(value.source))) return true;
  const meta = record(value.meta) ? value.meta : {};
  const claimsAi = value.by === "ai" || meta.by === "ai" || meta.chart_ai !== undefined
    || (typeof value.id === "string" && value.id.trim().startsWith("ai_"));
  return (meta.chart_ai !== undefined && value.source !== "ai")
    || (value.source !== undefined && value.source !== "ai" && claimsAi)
    || (value.source === "user" && value.auto === true);
}

/** One source's replacement always preserves the other source at commit time. */
export function replaceAiPartition(
  current: readonly Drawing[], objects: readonly AiObject[], layerHidden: boolean,
): { ok: true; drawings: Drawing[] } | { ok: false; error: string } {
  let ai: Drawing[];
  try { ai = objects.map(object => storeAiDrawing(object, layerHidden)); }
  catch { return { ok: false, error: "invalid_ai_drawing" }; }
  const drawings = [...current.filter(drawing => drawing.source !== "ai"), ...ai];
  const error = aiDrawingCollectionError(drawings);
  return error ? { ok: false, error } : { ok: true, drawings };
}

/** Recovery retains empty tombstones and valid mixed snapshots, never partial arrays. */
export function readDrawingRecovery(value: unknown): Drawing[] | null {
  if (!Array.isArray(value) || value.some(drawingSourceConflict)) return null;
  const drawings = normalizeDrawings(value);
  if (drawings.length !== value.length || drawings.some((drawing, index) =>
      drawing.source === "detector" || (drawing.source === "ai" && !readStoredAiDrawing(value[index])))
    || aiDrawingCollectionError(drawings)) return null;
  return drawings;
}
