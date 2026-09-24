/**
 * Field-by-field diff between two thesis versions.
 * Lists report added / removed / reordered items; strings report changed with old and new;
 * unchanged fields are omitted.
 */
import type { ThesisHorizon, ThesisVersion } from "./theses";

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
  | { kind: "transitionChanged"; old: string; next: string };

function sameArrayItems(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((item, i) => item === sortedB[i]);
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, i) => item === b[i]);
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
    const prevItems = prevContent[field];
    const nextItems = nextContent[field];

    if (arraysEqual(prevItems, nextItems)) continue;

    // Check if same items but different order (reordered)
    const sameItems = sameArrayItems(prevItems, nextItems);
    if (sameItems) {
      deltas.push({ kind: "listReordered", field });
      continue;
    }

    // Added items (in next but not in prev)
    const added = nextItems.filter((item) => !prevItems.includes(item));
    if (added.length > 0) {
      deltas.push({ kind: "listAdded", field, items: added });
    }

    // Removed items (in prev but not in next)
    const removed = prevItems.filter((item) => !nextItems.includes(item));
    if (removed.length > 0) {
      deltas.push({ kind: "listRemoved", field, items: removed });
    }
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

  // Transition (should always be present but include for completeness)
  if (previous.transition !== next.transition) {
    deltas.push({ kind: "transitionChanged", old: previous.transition, next: next.transition });
  }

  return deltas;
}
