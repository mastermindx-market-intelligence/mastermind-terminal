import { AI_OBJECT_CAP, type AiObject } from "@/lib/chartBus";

export type AiDrawingGroup = {
  id: string;
  op: AiObject["op"];
  caption?: string;
  batchId: string;
  objects: AiObject[];
};

/** Read-only projection of the existing AI store. No inferred prefixes or second collection. */
export function groupAiDrawings(objects: readonly AiObject[]): AiDrawingGroup[] {
  const groups = new Map<string, AiDrawingGroup>();
  for (const object of objects) {
    const id = object.command_id ?? object.id;
    let group = groups.get(id);
    if (!group) {
      group = { id, op: object.op, caption: object.caption, batchId: object.batch_id, objects: [] };
      groups.set(id, group);
    }
    group.objects.push(object);
  }
  return [...groups.values()];
}

export type AiObjectEdit = "show" | "hide" | "remove";

/** The UI and chat both operate on exact AI-owned object ids. A stale selection is a no-op. */
export function editAiObjects(
  objects: readonly AiObject[], ids: readonly string[], edit: AiObjectEdit,
): AiObject[] | null {
  if (!ids.length || ids.length > AI_OBJECT_CAP || ids.some(id => !objects.some(o => o.id === id))) return null;
  const selected = new Set(ids);
  if (edit === "remove") return objects.filter(o => !selected.has(o.id));
  return objects.map(o => selected.has(o.id) ? { ...o, hidden: edit === "hide" } : o);
}

export type AiLayerController = {
  count: number;
  objects: readonly AiObject[];
  hidden: boolean;
  toggleHidden: () => void;
  clear: () => void;
  // Local AI-store acceptance, not a network ACK or pixel-render receipt.
  editObjects: (ids: readonly string[], edit: AiObjectEdit) => boolean;
};
