/** Browser-local display preferences. No market rows, timestamps or account data. */
import { decodeTapeView, encodeTapeView, type TapeViewState } from "./optionsTapeView";

export const SAVED_TAPE_VIEWS_KEY = "mm.optionsTapeSavedViews.v1";
export const MAX_SAVED_TAPE_VIEWS = 20;
export type SavedTapeView = { id: string; name: string; state: string };
export type SavedTapeViewsResult = { ok: true; views: SavedTapeView[] } | { ok: false; reason: "invalid" };

export function normalizeTapeViewName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.normalize("NFC").trim();
  // ZWJ/ZWNJ and other legitimate multilingual format characters remain valid.
  if (!name || !name.replace(/\p{Cf}/gu, "").trim() || [...name].length > 60 || /[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u.test(name)) return null;
  return name;
}

function exactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function validateViews(value: unknown): SavedTapeView[] {
  if (!Array.isArray(value) || value.length > MAX_SAVED_TAPE_VIEWS) throw new Error("invalid");
  const ids = new Set<string>();
  const names = new Set<string>();
  return value.map((row) => {
    if (!exactKeys(row, ["id", "name", "state"]) || typeof row.id !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(row.id)) throw new Error("invalid");
    const name = normalizeTapeViewName(row.name);
    const state = decodeTapeView(typeof row.state === "string" ? row.state : null);
    if (!name || !state || ids.has(row.id) || names.has(name.toLowerCase())) throw new Error("invalid");
    ids.add(row.id);
    names.add(name.toLowerCase());
    return { id: row.id, name, state: encodeTapeView(state) };
  });
}

export function decodeSavedTapeViews(raw: string | null): SavedTapeViewsResult {
  if (raw === null) return { ok: true, views: [] };
  if (raw.length > 100_000) return { ok: false, reason: "invalid" };
  try {
    const value: unknown = JSON.parse(raw);
    if (!exactKeys(value, ["v", "views"]) || value.v !== 1) return { ok: false, reason: "invalid" };
    return { ok: true, views: validateViews(value.views) };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

export function encodeSavedTapeViews(views: readonly SavedTapeView[]): string {
  return JSON.stringify({ v: 1, views: validateViews(views) });
}

function uniqueName(views: readonly SavedTapeView[], input: unknown, except?: string): string {
  const name = normalizeTapeViewName(input);
  if (!name) throw new Error("name");
  if (views.some((view) => view.id !== except && view.name.toLowerCase() === name.toLowerCase())) throw new Error("duplicate");
  return name;
}

export function addSavedTapeView(views: readonly SavedTapeView[], id: string, name: string, state: TapeViewState): SavedTapeView[] {
  const current = validateViews(views);
  if (current.length >= MAX_SAVED_TAPE_VIEWS) throw new Error("full");
  const next = { id, name: uniqueName(current, name), state: encodeTapeView(state) };
  return validateViews([...current, next]);
}

export function renameSavedTapeView(views: readonly SavedTapeView[], id: string, name: string): SavedTapeView[] {
  const current = validateViews(views);
  if (!current.some((view) => view.id === id)) throw new Error("missing");
  const normalized = uniqueName(current, name, id);
  return current.map((view) => view.id === id ? { ...view, name: normalized } : view);
}

export function removeSavedTapeView(views: readonly SavedTapeView[], id: string): SavedTapeView[] {
  const current = validateViews(views);
  if (!current.some((view) => view.id === id)) throw new Error("missing");
  return current.filter((view) => view.id !== id);
}
