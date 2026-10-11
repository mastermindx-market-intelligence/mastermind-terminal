// ── Study-instance view helpers: the chart/shell consumers of the E06 identity contract ─────────
//
// `lib/studyInstances.ts` owns the identity law (ids, params, transitions). This module owns the
// small, pure READ projections every surface needs so the renderer, legend, settings dialog,
// object tree and data table all agree on WHICH instances are drawn, in WHAT order, under WHAT
// label — without any of them re-deriving the rules or addressing a study by its type key.
//
//   * "Renderable" == exactly what `readStudyStack` would return as an instance: a supported id
//     (primary, or an additional id of a multi-instance type), at most MAX_INSTANCES_PER_TYPE per
//     type, the first ones in canonical order. An unsupported or over-cap id is never drawn and
//     never gets a legend row, a column or a label — it stays in state untouched.
//   * Labels disambiguate only when needed: a lone instance keeps its registry label ("RSI"), so a
//     single-instance chart renders byte-identically to pre-E06. With siblings each instance reads
//     "RSI 1 (14)", "RSI 2 (7)" (label AND tag, so a table/CSV header says which length it is): a
//     canonical position (display only, never an identity) plus its first numeric input, so two
//     instances can never share a visible name.
//
// Pure: no I/O, no React, no module state.

import { IND_DEFS, type IndKey } from "./indicators";
import {
  MAX_INSTANCES_PER_TYPE,
  compareStudyIds,
  isAdditionalStudyId,
  isSupportedStudyId,
  parseStudyId,
  studyParamsWithDefaults,
  studyTypeOf,
  supportsMultipleInstances,
} from "./studyInstances";

export type StudyInstanceMeta = {
  id: string;
  type: IndKey;
  primary: boolean;
  /** Registry kind: drawn on the price pane, or in its own sub-pane keyed by the instance id. */
  kind: "overlay" | "pane";
  /** 1-based canonical position among the renderable instances of its type. Display only. */
  index: number;
  /** How many renderable instances of this type are active (1 == no disambiguation). */
  siblings: number;
  /** Legend / settings / object-tree name. Unique among active instances of one type. */
  label: string;
  /** Column (table/CSV header) / chip name. Unique among active instances of one type. */
  tag: string;
};

/**
 * The renderable instance ids of `type` among `ids`, canonical order (primary first, then by
 * token), capped at MAX_INSTANCES_PER_TYPE — the same set and order `readStudyStack` yields.
 */
export function renderableStudyIds(type: IndKey, ids: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || seen.has(id)) continue;
    seen.add(id);
    if (isSupportedStudyId(id) && studyTypeOf(id) === type) out.push(id);
  }
  return out.sort(compareStudyIds).slice(0, MAX_INSTANCES_PER_TYPE);
}

/** Is `id` an instance the chart draws, given the active ids? (False for passthrough keys.) */
export function isRenderableStudyInstance(id: string, activeIds: Iterable<string>): boolean {
  const type = studyTypeOf(id);
  return !!type && renderableStudyIds(type, activeIds).includes(id);
}

/**
 * Expand a canonical TYPE order (e.g. the chart's sub-pane order) into instance ids: a
 * multi-instance type becomes every renderable instance of it found in `ids`, canonical order;
 * every other key stays as-is (callers still filter by presence, exactly as before E06).
 */
export function expandStudyOrder(order: readonly string[], ids: Iterable<string>): string[] {
  const list = [...ids];
  const out: string[] = [];
  for (const key of order) {
    if (supportsMultipleInstances(key)) out.push(...renderableStudyIds(key as IndKey, list));
    else out.push(key);
  }
  return out;
}

/** The value of the type's first numeric input (RSI → length), as shown in a disambiguated label. */
export function studyParamSummary(id: string, params: unknown): string {
  const type = studyTypeOf(id);
  if (!type) return "";
  const field = IND_DEFS[type].fields.find((f) => f.group === "inputs" && f.type === "number");
  if (!field) return "";
  const value = studyParamsWithDefaults(id, params)[field.key];
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

/**
 * Display identity of one active instance, or `null` when `id` is not a renderable built-in
 * instance among `activeIds` (passthrough, unsupported, over the cap, or not active).
 */
export function studyInstanceMeta(id: string, activeIds: Iterable<string>, params?: unknown): StudyInstanceMeta | null {
  const parsed = parseStudyId(id);
  if (!parsed) return null;
  const siblings = renderableStudyIds(parsed.type, activeIds);
  const index = siblings.indexOf(id) + 1;
  if (index === 0) return null;
  const def = IND_DEFS[parsed.type];
  const base = { id, type: parsed.type, primary: parsed.primary, kind: def.kind, index, siblings: siblings.length };
  if (siblings.length <= 1) return { ...base, label: def.label, tag: def.tag };
  const summary = studyParamSummary(id, params);
  const suffix = summary ? ` (${summary})` : "";
  return { ...base, label: `${def.label} ${index}${suffix}`, tag: `${def.tag} ${index}${suffix}` };
}

/**
 * Carry the stored params of every ADDITIONAL instance id in `indicators` onto `base` — the step
 * the device/template load paths need because they otherwise seed only registry type keys and
 * would silently reset an instance to defaults (then persist the reset). A supported instance is
 * validated and defaults-merged (`studyParamsWithDefaults`, the same read the renderer uses); an
 * unsupported one (a type a newer build can multiply) is preserved verbatim, never reinterpreted.
 * Additional ids that are not active are NOT carried: their ids are never reused, so their records
 * are retired. Primary and passthrough records are untouched. Returns a new object.
 */
export function withStudyInstanceParams<T extends Record<string, unknown>>(
  base: T,
  indicators: Iterable<string>,
  stored: unknown,
): T {
  const out: Record<string, unknown> = { ...base };
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return out as T;
  const source = stored as Record<string, unknown>;
  for (const id of indicators) {
    if (!isAdditionalStudyId(id) || !Object.prototype.hasOwnProperty.call(source, id)) continue;
    const raw = source[id];
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;
    out[id] = isSupportedStudyId(id) ? studyParamsWithDefaults(id, raw) : { ...(raw as Record<string, unknown>) };
  }
  return out as T;
}
