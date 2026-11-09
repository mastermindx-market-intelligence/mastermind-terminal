/**
 * Field-by-field diff between two thesis versions.
 * Lists report added / removed / reordered items; strings report changed with old and new;
 * unchanged fields are omitted.
 */
import type { ThesisHorizon, ThesisVersion } from "./theses";

export type ThesisDeltaField =
  | "title"
  | "statement"
  | "catalysts"
  | "falsifiers"
  | "risks"
  | "horizon"
  | "effectiveAt"
  | "revisionNote"
  | "status";

export type ThesisDelta =
  | { kind: "origin" }
  | { kind: "truncated" }
  | { kind: "stringChanged"; field: "title" | "statement"; old: string; next: string }
  | { kind: "listAdded"; field: "catalysts" | "falsifiers" | "risks"; items: string[] }
  | { kind: "listRemoved"; field: "catalysts" | "falsifiers" | "risks"; items: string[] }
  | { kind: "listReordered"; field: "catalysts" | "falsifiers" | "risks" }
  | { kind: "horizonChanged"; old: ThesisHorizon; next: ThesisHorizon }
  | { kind: "effectiveAtChanged"; old: string | null; next: string | null }
  | { kind: "revisionNoteChanged"; old: string | null; next: string | null }
  | { kind: "lifecycleChanged"; old: ThesisVersion["lifecycleState"]; next: ThesisVersion["lifecycleState"] };

export type ThesisDeltaCopy = {
  language: "en" | "zh";
  origin: string;
  truncated: string;
  fields: Record<ThesisDeltaField, string>;
  changed: string;
  added: string;
  removed: string;
  reordered: string;
  none: string;
  formatHorizon: (horizon: ThesisHorizon) => string;
  formatDate: (date: string | null) => string;
  formatLifecycle: (lifecycle: ThesisVersion["lifecycleState"]) => string;
};

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, i) => item === b[i]);
}

/** Returns multiset-difference deltas for a list field (caller adds field). */
function diffListField(
  prevItems: string[],
  nextItems: string[],
): Array<{ kind: "listAdded"; items: string[] } | { kind: "listRemoved"; items: string[] } | { kind: "listReordered" }> {
  if (arraysEqual(prevItems, nextItems)) return [];

  // Build item counts (multiset)
  const prevCounts = new Map<string, number>();
  const nextCounts = new Map<string, number>();
  for (const item of prevItems) prevCounts.set(item, (prevCounts.get(item) ?? 0) + 1);
  for (const item of nextItems) nextCounts.set(item, (nextCounts.get(item) ?? 0) + 1);

  // Check if same multiset (same items with same counts) → pure reorder
  const sameMultiset = Array.from(prevCounts.keys()).every(
    (item) => prevCounts.get(item) === nextCounts.get(item),
  ) && Array.from(nextCounts.keys()).every(
    (item) => prevCounts.get(item) === nextCounts.get(item),
  );

  if (sameMultiset) {
    // Same items, different order
    return [{ kind: "listReordered" as const }];
  }

  const deltas: Array<{ kind: "listAdded"; items: string[] } | { kind: "listRemoved"; items: string[] } | { kind: "listReordered" }> = [];
  // Compute net added: items whose count increased (multiset diff)
  const added: string[] = [];
  for (const [item, count] of nextCounts) {
    const diff = count - (prevCounts.get(item) ?? 0);
    for (let i = 0; i < diff; i++) added.push(item);
  }
  if (added.length > 0) deltas.push({ kind: "listAdded", items: added });

  // Compute net removed: items whose count decreased
  const removed: string[] = [];
  for (const [item, count] of prevCounts) {
    const diff = count - (nextCounts.get(item) ?? 0);
    for (let i = 0; i < diff; i++) removed.push(item);
  }
  if (removed.length > 0) deltas.push({ kind: "listRemoved", items: removed });

  return deltas;
}

export function diffThesisVersions(
  previous: ThesisVersion | null,
  next: ThesisVersion,
): ThesisDelta[] {
  if (previous === null) {
    return [{ kind: "origin" }];
  }

  const deltas: ThesisDelta[] = [];
  const prevContent = previous.content;
  const nextContent = next.content;

  // Title
  if (prevContent.title !== nextContent.title) {
    deltas.push({ kind: "stringChanged", field: "title", old: prevContent.title, next: nextContent.title });
  }

  // Statement
  if (prevContent.statement !== nextContent.statement) {
    deltas.push({ kind: "stringChanged", field: "statement", old: prevContent.statement, next: nextContent.statement });
  }

  // List fields: catalysts, falsifiers, risks
  for (const field of ["catalysts", "falsifiers", "risks"] as const) {
    const listDeltas = diffListField(prevContent[field], nextContent[field]);
    for (const d of listDeltas) deltas.push({ ...d, field });
  }

  // Horizon
  if (prevContent.horizon !== nextContent.horizon) {
    deltas.push({ kind: "horizonChanged", old: prevContent.horizon, next: nextContent.horizon });
  }

  // EffectiveAt
  if (prevContent.effectiveAt !== nextContent.effectiveAt) {
    deltas.push({ kind: "effectiveAtChanged", old: prevContent.effectiveAt, next: nextContent.effectiveAt });
  }

  // Revision note
  if (prevContent.revisionNote !== nextContent.revisionNote) {
    deltas.push({ kind: "revisionNoteChanged", old: prevContent.revisionNote, next: nextContent.revisionNote });
  }

  // Lifecycle
  if (previous.lifecycleState !== next.lifecycleState) {
    deltas.push({ kind: "lifecycleChanged", old: previous.lifecycleState, next: next.lifecycleState });
  }

  return deltas;
}

export function thesisVersionDeltaForHistory(
  history: ThesisVersion[],
  entry: ThesisVersion,
): ThesisDelta[] {
  if (entry.previousVersion === null) return [{ kind: "origin" }];
  const previous = history.find((version) => version.version === entry.previousVersion) ?? null;
  if (!previous) return [{ kind: "truncated" }];
  return diffThesisVersions(previous, entry);
}

export function describeThesisDelta(delta: ThesisDelta, copy: ThesisDeltaCopy): string {
  const join = copy.language === "zh" ? "" : " ";
  const period = copy.language === "zh" ? "。" : ".";
  const itemSeparator = copy.language === "zh" ? "；" : "; ";
  const verbs = {
    origin: copy.changed,
    truncated: copy.changed,
    stringChanged: copy.changed,
    listAdded: copy.added,
    listRemoved: copy.removed,
    listReordered: copy.reordered,
    horizonChanged: copy.changed,
    effectiveAtChanged: copy.changed,
    revisionNoteChanged: copy.changed,
    lifecycleChanged: copy.changed,
  } satisfies Record<ThesisDelta["kind"], string>;

  const describe = (field: ThesisDeltaField, verb: string, value?: string) =>
    `${copy.fields[field]}${join}${verb}${value === undefined ? "" : `${copy.language === "zh" ? "：" : ": "}${value}`}${period}`;

  switch (delta.kind) {
    case "origin":
      return copy.origin;
    case "truncated":
      return copy.truncated;
    case "stringChanged":
      return describe(delta.field, verbs[delta.kind]);
    case "listAdded":
      return describe(delta.field, verbs[delta.kind], delta.items.join(itemSeparator));
    case "listRemoved":
      return describe(delta.field, verbs[delta.kind], delta.items.join(itemSeparator));
    case "listReordered":
      return describe(delta.field, verbs[delta.kind]);
    case "horizonChanged":
      return describe("horizon", verbs[delta.kind], `${copy.formatHorizon(delta.old)} → ${copy.formatHorizon(delta.next)}`);
    case "effectiveAtChanged":
      return describe("effectiveAt", verbs[delta.kind], `${copy.formatDate(delta.old)} → ${copy.formatDate(delta.next)}`);
    case "revisionNoteChanged":
      return describe("revisionNote", verbs[delta.kind]);
    case "lifecycleChanged":
      return describe("status", verbs[delta.kind], `${copy.formatLifecycle(delta.old)} → ${copy.formatLifecycle(delta.next)}`);
  }
}
