import type { ThesisVersion } from "./theses";

const KEY = "__mmThesisInspectionV1";
type Inspection = { ownerKey: string; thesisId: string; version: number };

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

// Only a reference belongs in this browser entry. Canonical thesis content and
// authority always come from the fresh owner-bound detail read.
export function withThesisInspection(state: unknown, selection: Inspection | null): Record<string, unknown> {
  const next = { ...object(state) };
  delete next[KEY];
  if (selection) next[KEY] = { ...selection };
  return next;
}

export function readThesisInspection(
  state: unknown,
  ownerKey: string,
  thesisId: string,
  history: readonly Pick<ThesisVersion, "thesisId" | "version">[],
): number | null {
  const selection = object(object(state)[KEY]);
  const version = selection.version;
  if (!ownerKey || !thesisId || selection.ownerKey !== ownerKey || selection.thesisId !== thesisId
    || typeof version !== "number" || !Number.isSafeInteger(version) || version < 1) return null;
  return history.some(entry => entry.thesisId === thesisId && entry.version === version) ? version : null;
}
