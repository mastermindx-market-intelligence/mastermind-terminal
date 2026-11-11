// ── Study instances: one stable identity per built-in indicator on the chart (E06) ─────────────
//
// The chart used to identify a built-in study by its TYPE key ("rsi") everywhere: the active set
// (`inds`), the parameter store (`indParams`), the eye state (`hidden`), the renderer's series map,
// the legend row, the settings target, the data-table column, and every persisted copy (localStorage
// `mm.inds`/`mm.indParams`/`mm.indHidden`, Saved Layouts, chart templates). One key per type means
// two RSIs could not exist: the second would alias the first's params, eye and series.
//
// This module is the single identity contract that replaces "type key" with "instance id" without
// a storage migration. It is pure: no I/O, no React, no module state, safe on hostile input.
//
// ── The identity law ──
//   * PRIMARY instance id == the type key itself ("rsi"). Every pre-E06 record therefore already IS
//     a valid instance record — a legacy v1/v2 layout, template or device store maps 1:1, never
//     gains a study, and never needs rewriting. Removing and re-adding the primary reuses the id and
//     its device-wide params, exactly as before E06.
//   * ADDITIONAL instance id == `${type}__${token}` ("rsi__lzx4k2a9q1f"). The token is lowercase
//     base36, time-ordered and minted once; an additional id is NEVER reused and NEVER promoted to
//     primary when the primary is removed. Its params belong to the instance and are retired with it.
//   * The id is the ONLY handle: renderer/series key, sub-pane key, legend row, settings target,
//     data-table column, compute-cache key prefix, `hidden` entry and every persisted key. The type is
//     always DERIVED from the id (`parseStudyId`), never stored beside it, so the two cannot disagree.
//
// ── Why `__` and this token alphabet ──
// The persisted Saved Layout wire format is the cross-repo `workspace_layout.v1` envelope, whose
// chart config validates `inds`/`hidden`/`indParams` keys with `^[A-Za-z_][A-Za-z0-9_]{0,31}$`
// (lib/workspaceLayout.ts INDICATOR_ID_RE, digest-pinned against the Macro reference). An id built
// from an IndKey + "__" + [a-z0-9] passes that grammar unchanged, so instances persist with NO
// envelope amendment and NO new field; `#`, `-` or `:` would be refused at save. No IndKey, suite
// key or other namespace in `inds` contains "__", so the grammar is unambiguous, and the alphabet
// is DOM-attribute/CSS-selector/URL safe without escaping.
//
// ── What is deliberately NOT an instance ──
// Native suite keys ("structure"…), their semantic module ids ("suite:…/…"), Pine ids ("pine:…"),
// compare keys ("cmp:…"), "suite-pane:…", "_oracle" and anything unrecognised are PASSTHROUGH:
// preserved verbatim, in order, never reinterpreted, never given instance semantics.

import { IND_DEFS, IND_ORDER, isIndKey, withDefaults, type IndKey } from "./indicators";

/** Separator between the type key and the instance token of an ADDITIONAL instance id. */
export const STUDY_INSTANCE_SEPARATOR = "__";
/** Token grammar of an additional instance id. */
export const STUDY_INSTANCE_TOKEN_RE = /^[a-z0-9]{4,16}$/;
/** Upper bound on an id's length — the `workspace_layout.v1` indicator-id bound (1 + 31). */
export const STUDY_ID_MAX_LENGTH = 32;
/** Most instances (primary + additional) of one type that may be active at once. */
export const MAX_INSTANCES_PER_TYPE = 4;
/**
 * Built-in types whose multiplicity this build can render independently. Widening this list is a
 * capability change, not a contract change: ids, persistence and merge rules are identical for
 * every type. A grammar-valid additional id of a type NOT in this list is "unsupported" — kept
 * verbatim, never rendered, never aliased onto the primary.
 */
export const MULTI_INSTANCE_TYPES: readonly IndKey[] = ["rsi"];
/**
 * Reserved per-instance param key for explicit pane placement. Only the kind default is supported
 * in this version; any other value is preserved (unknown fields survive) and read as the default.
 */
export const STUDY_PLACEMENT_PARAM = "_pane";

/** Where an instance draws: on the price pane, or in its own sub-pane keyed by the instance id. */
export type StudyPane = "price" | "own";

export type ParsedStudyId = {
  id: string;
  type: IndKey;
  primary: boolean;
  /** `null` for the primary instance. */
  token: string | null;
};

/** The runtime/persisted triple every store already holds (Sets are passed as arrays). */
export type StudyState = {
  inds: readonly string[];
  indParams: Readonly<Record<string, Record<string, unknown>>>;
  hidden: readonly string[];
};

export type StudyInstance = {
  id: string;
  type: IndKey;
  primary: boolean;
  /** Stored params after type validation — NOT defaults-merged (see `studyParamsWithDefaults`). */
  params: Record<string, unknown>;
  hidden: boolean;
  pane: StudyPane;
};

export type UnsupportedStudyReason =
  /** Additional id of a type this build cannot run more than once. */
  | "unsupported_multiplicity"
  /** More instances of one type than `MAX_INSTANCES_PER_TYPE`. */
  | "over_cap"
  /** Merge only: the id is taken and no fresh id could be minted for a single-instance type. */
  | "collision";

export type UnsupportedStudy = { id: string; type: IndKey; reason: UnsupportedStudyReason };

export type StudyStack = {
  /** Renderable built-in instances, canonical order (`compareStudyIds`). */
  instances: StudyInstance[];
  /** Built-in-grammar ids this build will not render; their records are preserved untouched. */
  unsupported: UnsupportedStudy[];
  /** Non-built-in keys (suites, modules, Pine, compare, unknown), deduplicated, input order. */
  passthrough: string[];
};

export type AllocateOptions = {
  /** Clock for the token's time prefix. Default `Date.now`. */
  now?: () => number;
  /** Entropy for the token's suffix, in [0, 1). Default `Math.random`. */
  random?: () => number;
};

// --- internal helpers -------------------------------------------------------------------------

const DENIED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const TYPE_RANK = new Map<string, number>(IND_ORDER.map((key, index) => [key, index]));

function uniqueStrings(list: readonly unknown[] | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list ?? []) {
    if (typeof item !== "string" || item.length === 0 || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

/** Deterministic, key-sorted serialisation for cache keys (no node:crypto — runs in the browser). */
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return "null";
}

function countTypeInstances(ids: Iterable<string>, type: IndKey): number {
  let count = 0;
  for (const id of ids) if (parseStudyId(id)?.type === type) count++;
  return count;
}

// --- id grammar -------------------------------------------------------------------------------

/**
 * Parse an id into its built-in instance identity, or `null` when it is not a built-in instance id
 * (passthrough). Grammar only — whether the build can RENDER it is `isSupportedStudyId`.
 */
export function parseStudyId(id: unknown): ParsedStudyId | null {
  if (typeof id !== "string" || id.length === 0 || id.length > STUDY_ID_MAX_LENGTH) return null;
  if (DENIED_KEYS.has(id)) return null;
  if (isIndKey(id)) return { id, type: id, primary: true, token: null };
  const at = id.lastIndexOf(STUDY_INSTANCE_SEPARATOR);
  if (at <= 0) return null;
  const type = id.slice(0, at);
  const token = id.slice(at + STUDY_INSTANCE_SEPARATOR.length);
  if (!isIndKey(type) || !STUDY_INSTANCE_TOKEN_RE.test(token)) return null;
  return { id, type, primary: false, token };
}

/** The study type an id resolves to, or `null` for a passthrough key. */
export function studyTypeOf(id: unknown): IndKey | null {
  return parseStudyId(id)?.type ?? null;
}

export function isPrimaryStudyId(id: unknown): boolean {
  return parseStudyId(id)?.primary === true;
}

/** Grammar-valid ADDITIONAL id, whether or not this build supports its type's multiplicity. */
export function isAdditionalStudyId(id: unknown): boolean {
  return parseStudyId(id)?.primary === false;
}

export function supportsMultipleInstances(type: unknown): boolean {
  return typeof type === "string" && (MULTI_INSTANCE_TYPES as readonly string[]).includes(type);
}

/** A primary of any built-in type, or an additional id of a multi-instance type. */
export function isSupportedStudyId(id: unknown): boolean {
  const parsed = parseStudyId(id);
  return !!parsed && (parsed.primary || supportsMultipleInstances(parsed.type));
}

export function defaultStudyPane(type: IndKey): StudyPane {
  return IND_DEFS[type].kind === "pane" ? "own" : "price";
}

/**
 * Canonical instance order, a fixed function of the ids alone (so it survives the layout's sorted
 * capture): registry type order (`IND_ORDER`), then the primary, then additional instances by token
 * (time-ordered tokens of equal length sort by creation). Non-instance ids sort last, by string.
 */
export function compareStudyIds(a: string, b: string): number {
  const pa = parseStudyId(a);
  const pb = parseStudyId(b);
  if (!pa || !pb) {
    if (pa) return -1;
    if (pb) return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  const ra = TYPE_RANK.get(pa.type) ?? Number.MAX_SAFE_INTEGER;
  const rb = TYPE_RANK.get(pb.type) ?? Number.MAX_SAFE_INTEGER;
  if (ra !== rb) return ra - rb;
  if (pa.type !== pb.type) return pa.type < pb.type ? -1 : 1;
  if (pa.primary !== pb.primary) return pa.primary ? -1 : 1;
  const ta = pa.token ?? "";
  const tb = pb.token ?? "";
  return ta < tb ? -1 : ta > tb ? 1 : 0;
}

// --- params ------------------------------------------------------------------------------------

/**
 * The read-boundary for one instance's params. A known field (registry `fields`, else a key in the
 * registry `defaults`) whose value has the wrong runtime type is DROPPED so `withDefaults` backfills
 * it; ranges are NOT clamped (registry defaults themselves sit off the UI step grid, e.g. RSI width
 * 1.2). Unknown keys — `_vis`, `_pane`, fields a newer build added — are preserved verbatim.
 * Never throws; a non-record yields `{}`.
 */
export function validateStudyParams(type: IndKey, raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) return {};
  const def = IND_DEFS[type];
  const fieldTypes = new Map<string, string>(def.fields.map((f) => [f.key, f.type === "bool" ? "boolean" : f.type === "color" ? "string" : "number"]));
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (DENIED_KEYS.has(key)) continue;
    const expected = fieldTypes.get(key)
      ?? (Object.prototype.hasOwnProperty.call(def.defaults, key) ? typeof def.defaults[key] : undefined);
    if (expected === "number") {
      if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    } else if (expected === "boolean" || expected === "string") {
      if (typeof value === expected) out[key] = value;
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** The params an instance computes and renders with: validated stored params over registry defaults. */
export function studyParamsWithDefaults(id: string, params: unknown): ReturnType<typeof withDefaults> {
  const type = studyTypeOf(id);
  if (!type) return isRecord(params) ? { ...params } : {};
  return withDefaults(type, validateStudyParams(type, params));
}

/**
 * Compute/render cache key for one instance: its id plus its canonical params. Two instances never
 * share a key (the id differs), and a param edit on one changes only its own key.
 */
export function studyInstanceKey(instance: Pick<StudyInstance, "id" | "params">): string {
  return `${instance.id}:${stableStringify(instance.params)}`;
}

/**
 * 1-based position of `id` among the active instances of its type, canonical order. DISPLAY ONLY
 * (e.g. a "RSI 2" disambiguator) — it shifts when a sibling is removed, so it is never an identity.
 * 0 when `id` is not an active built-in instance.
 */
export function studyDisplayIndex(id: string, activeIds: Iterable<string>): number {
  const type = studyTypeOf(id);
  if (!type) return 0;
  const siblings = uniqueStrings([...activeIds]).filter((x) => studyTypeOf(x) === type).sort(compareStudyIds);
  return siblings.indexOf(id) + 1;
}

// --- reading -----------------------------------------------------------------------------------

/**
 * Classify a runtime/persisted triple into renderable instances, unsupported built-in records and
 * passthrough keys. Pure view — it never mutates or prunes the state it reads. Deterministic in the
 * MEMBERSHIP of `inds` (order-insensitive for instances; passthrough keeps input order).
 */
export function readStudyStack(state: StudyState): StudyStack {
  const inds = uniqueStrings(state?.inds);
  const hidden = new Set(uniqueStrings(state?.hidden));
  const params = isRecord(state?.indParams) ? state.indParams : {};
  const passthrough: string[] = [];
  const unsupported: UnsupportedStudy[] = [];
  const candidates: ParsedStudyId[] = [];
  for (const id of inds) {
    const parsed = parseStudyId(id);
    if (!parsed) passthrough.push(id);
    else if (!parsed.primary && !supportsMultipleInstances(parsed.type)) unsupported.push({ id, type: parsed.type, reason: "unsupported_multiplicity" });
    else candidates.push(parsed);
  }
  candidates.sort((a, b) => compareStudyIds(a.id, b.id));
  const perType = new Map<IndKey, number>();
  const instances: StudyInstance[] = [];
  for (const parsed of candidates) {
    const seen = perType.get(parsed.type) ?? 0;
    if (seen >= MAX_INSTANCES_PER_TYPE) {
      unsupported.push({ id: parsed.id, type: parsed.type, reason: "over_cap" });
      continue;
    }
    perType.set(parsed.type, seen + 1);
    instances.push({
      id: parsed.id,
      type: parsed.type,
      primary: parsed.primary,
      params: validateStudyParams(parsed.type, params[parsed.id]),
      hidden: hidden.has(parsed.id),
      pane: defaultStudyPane(parsed.type),
    });
  }
  unsupported.sort((a, b) => compareStudyIds(a.id, b.id));
  return { instances, unsupported, passthrough };
}

/** The triple for exactly these instances (order kept), e.g. a template's "replace" payload. */
export function studyStateFromInstances(instances: readonly StudyInstance[]): StudyState {
  const inds: string[] = [];
  const indParams: Record<string, Record<string, unknown>> = {};
  const hidden: string[] = [];
  for (const instance of instances) {
    if (indParams[instance.id]) continue;
    inds.push(instance.id);
    indParams[instance.id] = { ...instance.params };
    if (instance.hidden) hidden.push(instance.id);
  }
  return { inds, indParams, hidden };
}

// --- allocation --------------------------------------------------------------------------------

/**
 * Mint a fresh ADDITIONAL id for `type`, unique against `taken`. `null` when the type is not a
 * multi-instance type, the per-type cap is reached, or no unique token could be drawn. The token is
 * `base36(now)` (time-ordered) + 3 base36 entropy chars, so ids are never reused across a session or
 * a device in practice; uniqueness against `taken` is guaranteed.
 */
export function allocateStudyId(type: IndKey, taken: Iterable<string>, options: AllocateOptions = {}): string | null {
  if (!isIndKey(type) || !supportsMultipleInstances(type)) return null;
  const takenSet = new Set(taken);
  if (countTypeInstances(takenSet, type) >= MAX_INSTANCES_PER_TYPE) return null;
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const rawTime = Math.floor(Number(now()));
  const time = Number.isFinite(rawTime) && rawTime > 0 ? rawTime.toString(36).slice(-12) : "0";
  for (let attempt = 0; attempt < 32; attempt++) {
    const draw = Number(random());
    const entropy = Math.floor((Number.isFinite(draw) ? Math.min(Math.max(draw, 0), 0.999999) : 0) * 36 ** 3);
    const token = `${time}${entropy.toString(36).padStart(3, "0")}`;
    const id = `${type}${STUDY_INSTANCE_SEPARATOR}${token}`;
    if (STUDY_INSTANCE_TOKEN_RE.test(token) && id.length <= STUDY_ID_MAX_LENGTH && !takenSet.has(id)) return id;
  }
  return null;
}

/**
 * The id the NEXT "add <type>" should create: the primary (the type key) while it is free — so a
 * single-instance user's state stays byte-identical to pre-E06 — otherwise a fresh additional id.
 */
export function nextStudyId(type: IndKey, taken: Iterable<string>, options: AllocateOptions = {}): string | null {
  if (!isIndKey(type)) return null;
  const takenSet = new Set(taken);
  if (countTypeInstances(takenSet, type) >= MAX_INSTANCES_PER_TYPE) return null;
  if (!takenSet.has(type)) return type;
  return allocateStudyId(type, takenSet, options);
}

// --- pure state transitions (each touches ONLY the addressed id) -------------------------------

/**
 * Add an instance of `type`. The new instance is visible. A primary keeps its device-wide params
 * unless `params` is given; an additional instance is seeded from `params` over registry defaults.
 * `null` when no id can be allocated (single-instance type already active, or cap reached).
 */
export function addStudyInstance(
  state: StudyState,
  type: IndKey,
  options: AllocateOptions & { params?: Record<string, unknown> } = {},
): { state: StudyState; id: string } | null {
  const inds = uniqueStrings(state.inds);
  const id = nextStudyId(type, inds, options);
  if (!id) return null;
  const indParams = { ...state.indParams };
  if (options.params || id !== type) indParams[id] = withDefaults(type, validateStudyParams(type, options.params ?? {}));
  return {
    id,
    state: { inds: [...inds, id], indParams, hidden: state.hidden.filter((h) => h !== id) },
  };
}

/**
 * Remove one built-in instance (supported or not). It leaves `inds` and `hidden`; an ADDITIONAL
 * instance's params are retired with it, a primary's stay as the device preference (pre-E06
 * behaviour). Siblings and passthrough keys are untouched. A non-instance id is a no-op.
 */
export function removeStudyInstance(state: StudyState, id: string): StudyState {
  const parsed = parseStudyId(id);
  if (!parsed) return state;
  const inInds = state.inds.includes(id);
  const inHidden = state.hidden.includes(id);
  const retireParams = !parsed.primary && Object.prototype.hasOwnProperty.call(state.indParams, id);
  if (!inInds && !inHidden && !retireParams) return state;
  const indParams = { ...state.indParams };
  if (retireParams) delete indParams[id];
  return {
    inds: inInds ? state.inds.filter((x) => x !== id) : state.inds,
    indParams: retireParams ? indParams : state.indParams,
    hidden: inHidden ? state.hidden.filter((x) => x !== id) : state.hidden,
  };
}

/** Set one instance's eye state. A non-instance id is a no-op. */
export function setStudyHidden(state: StudyState, id: string, hidden: boolean): StudyState {
  if (!parseStudyId(id)) return state;
  const has = state.hidden.includes(id);
  if (has === hidden) return state;
  return { ...state, hidden: hidden ? [...state.hidden, id] : state.hidden.filter((x) => x !== id) };
}

/**
 * Patch one instance's params: `{...withDefaults(type, current), ...validated patch}` under that id
 * only. A non-instance id is a no-op.
 */
export function patchStudyParams(state: StudyState, id: string, patch: Record<string, unknown>): StudyState {
  const parsed = parseStudyId(id);
  if (!parsed) return state;
  const next = { ...studyParamsWithDefaults(id, state.indParams[id]), ...validateStudyParams(parsed.type, patch) };
  return { ...state, indParams: { ...state.indParams, [id]: next } };
}

/**
 * Drop the params and eye entries of ADDITIONAL ids that are no longer active (their ids are never
 * reused, so such records are dead). Primary and passthrough records are never touched. Returns the
 * same object when there is nothing to retire.
 */
export function pruneRetiredStudies<T extends StudyState>(state: T): T {
  const active = new Set(state.inds);
  const dead = (key: string) => !active.has(key) && isAdditionalStudyId(key);
  const deadParams = Object.keys(state.indParams).filter(dead);
  const hidden = state.hidden.filter((key) => !dead(key));
  if (!deadParams.length && hidden.length === state.hidden.length) return state;
  const indParams = { ...state.indParams };
  for (const key of deadParams) delete indParams[key];
  return { ...state, indParams, hidden: hidden.length === state.hidden.length ? state.hidden : hidden };
}

// --- merge (templates / imports) ---------------------------------------------------------------

export type StudyMergeResult = {
  state: StudyState;
  /** Ids present in `state` because of this merge (post-remap). */
  added: string[];
  /** Incoming id -> the fresh id it was stored under because the incoming id was already active. */
  remapped: Record<string, string>;
  /** Incoming built-in records that were NOT applied, with the reason. Never silently dropped. */
  unsupported: UnsupportedStudy[];
  /** Incoming non-built-in keys; NOT merged — their owners (suites, Pine, compare) decide. */
  passthrough: string[];
};

/**
 * Additively merge `incoming`'s built-in instances into `current` without ever overwriting an
 * active instance: a colliding id is re-minted as a fresh additional instance of the same type
 * (multi-instance types, under the cap) or reported `collision`/`over_cap`. Incoming unsupported
 * records are reported, not applied. `current`'s own records are preserved verbatim.
 */
export function mergeStudyState(current: StudyState, incoming: StudyState, options: AllocateOptions = {}): StudyMergeResult {
  const stack = readStudyStack(incoming);
  const inds = uniqueStrings(current.inds);
  const taken = new Set(inds);
  const indParams = { ...current.indParams };
  const hidden = new Set(uniqueStrings(current.hidden));
  const added: string[] = [];
  const remapped: Record<string, string> = {};
  const unsupported: UnsupportedStudy[] = [...stack.unsupported];
  for (const instance of stack.instances) {
    let id = instance.id;
    if (taken.has(id)) {
      const fresh = allocateStudyId(instance.type, taken, options);
      if (!fresh) {
        unsupported.push({ id, type: instance.type, reason: supportsMultipleInstances(instance.type) ? "over_cap" : "collision" });
        continue;
      }
      remapped[id] = fresh;
      id = fresh;
    } else if (countTypeInstances(taken, instance.type) >= MAX_INSTANCES_PER_TYPE) {
      unsupported.push({ id, type: instance.type, reason: "over_cap" });
      continue;
    }
    taken.add(id);
    inds.push(id);
    indParams[id] = { ...instance.params };
    if (instance.hidden) hidden.add(id);
    else hidden.delete(id);
    added.push(id);
  }
  return {
    state: { inds, indParams, hidden: [...hidden] },
    added,
    remapped,
    unsupported,
    passthrough: stack.passthrough,
  };
}
