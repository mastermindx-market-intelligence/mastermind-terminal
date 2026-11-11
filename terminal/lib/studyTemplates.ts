// ── Study templates: capture and apply planning (E07) ─────────────────────────────────────────
//
// The ONLY path from a stored template to the chart. Both doors are pure functions of the chart's
// study triple (`inds` / `indParams` / `hidden`) so the template ownership contract is testable:
//
//   capture  templateFromState(state)            → the portable body + what was left out and why
//   apply    planStudyTemplateApply(state, body) → the exact next triple + a diff of it
//
// Ownership contract. A template OWNS three kinds of chart entry and nothing else:
//   * supported built-in study instances (E06 ids: "rsi", "rsi__<token>"),
//   * native suites ("structure", …) with their flat params and module eye ids ("suite:k/m"),
//   * the Golden Oracle Confluence overlay ("_oracle").
// Everything else on the chart — compare overlays, Pine scripts, built-in records this build cannot
// render (a newer build's extra instances), unknown keys — is preserved byte-for-byte by every plan,
// and the symbol, interval, drawings, watchlists, alerts, live-data policy and Day Trade Mode are not
// inputs here at all: the host applies `plan.next` to the three study setters and nothing else.
//
// Preview == apply. The host renders the plan it later applies (it never re-derives a second state
// on click); a plan carries the fingerprint of the state it was computed from, and the host refuses
// to apply it to a chart that has changed since (it re-plans and asks again).

import { IND_DEFS, withDefaults, type IndKey } from "./indicators";
import { getSuiteMeta, isSuiteKey, suiteDefaults } from "./suites/meta";
import { enabledModulesForSuite, type SuiteModuleCatalogEntry } from "./suites/catalog";
import { isAmbientCandleSuite, MASTERMIND_CANDLES_SUITE_KEY } from "./mastermindCandlesDefault";
import {
  MAX_INSTANCES_PER_TYPE,
  compareStudyIds,
  isSupportedStudyId,
  mergeStudyState,
  parseStudyId,
  readStudyStack,
  studyParamsWithDefaults,
  type AllocateOptions,
  type StudyState,
} from "./studyInstances";
import { moduleSuiteKey, type StudyTemplateBody } from "./studyTemplateSchema";

export const ORACLE_STUDY_KEY = "_oracle";

export type StudyTemplateMode = "replace" | "merge";

/** Why a template (or chart) entry was not carried / applied. Every one is shown to the user. */
export type StudyTemplateSkipReason =
  /** An extra instance of a type this build runs only once. */
  | "unsupported_multiplicity"
  /** More instances of one type than the chart allows. */
  | "over_cap"
  /** Add mode: the study is already on the chart (single-instance type, suite or overlay). */
  | "collision"
  /** A study this build does not know (written by a newer build, or retired). */
  | "unknown_study"
  /** Not part of a study template: compare overlays and scripts stay with the chart. */
  | "not_portable"
  /** Guest chart: only the first few studies fit. */
  | "guest_limit";

export type StudyTemplateSkip = { id: string; reason: StudyTemplateSkipReason };

export type StudyTripleOut = {
  inds: string[];
  indParams: Record<string, Record<string, unknown>>;
  hidden: string[];
};

export type StudyTemplateChange = {
  id: string;
  /** Registry field keys whose effective value differs (built-in studies only). */
  fields: string[];
  /** Differing settings that are not registry fields (suite module settings, visibility windows). */
  otherFields: number;
  /** The eye state differs. */
  visibility: boolean;
};

export type StudyTemplatePlan = {
  mode: StudyTemplateMode;
  next: StudyTripleOut;
  /** Ids active in `next` but not in the current chart (post-remap). */
  added: string[];
  /** Ids active in the current chart but not in `next`. */
  removed: string[];
  /** Ids active in both whose settings or eye state change. */
  changed: StudyTemplateChange[];
  /** Ids active in both and untouched. */
  unchanged: string[];
  /** Template entries not applied (and chart entries a capture could not carry), with the reason. */
  skipped: StudyTemplateSkip[];
  /** Template id -> the fresh id it was added under (add mode, an instance already active). */
  remapped: Record<string, string>;
  /** Enabled suite modules in `next` that the user's plan does not include (they stay locked). */
  lockedModules: string[];
  /** Nothing visible changes. */
  noop: boolean;
  baseFingerprint: string;
  nextFingerprint: string;
};

export type StudyTemplatePlanOptions = AllocateOptions & {
  /** Guest charts keep only this many studies (the shell's anonymous clamp); `null` = signed in. */
  guestLimit?: number | null;
  userTier?: "free" | "essential" | "pro";
};

type CarriedKind = "builtin" | "suite" | "oracle";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function uniqueStrings(list: readonly unknown[] | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list ?? []) {
    if (typeof item !== "string" || !item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

/** Deterministic, key-sorted serialisation (fingerprints and value equality). */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return "null";
}

/** FNV-1a 32-bit over the stable serialisation; equal triples (any `hidden` order) hash equal. */
export function studyStateFingerprint(state: StudyState): string {
  const canonical = stableStringify({
    inds: uniqueStrings(state.inds),
    indParams: isRecord(state.indParams) ? state.indParams : {},
    hidden: uniqueStrings(state.hidden).sort(),
  });
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** What kind of template-owned entry `key` is, or `null` when a template never owns it. */
function carriedKind(key: string): CarriedKind | null {
  if (key === ORACLE_STUDY_KEY) return "oracle";
  if (isSuiteKey(key)) return "suite";
  if (parseStudyId(key)) return "builtin";
  return null;
}

function notCarriedReason(key: string): StudyTemplateSkipReason {
  return key.startsWith("cmp:") || key.startsWith("pine:") ? "not_portable" : "unknown_study";
}

/** The `hidden` entries one owned key controls: itself, plus a suite's module eye ids. */
function ownedHidden(key: string, hidden: Iterable<string>): string[] {
  const out: string[] = [];
  const suite = isSuiteKey(key);
  for (const entry of hidden) {
    if (entry === key || (suite && moduleSuiteKey(entry) === key)) out.push(entry);
  }
  return out;
}

/** The params a study renders with (registry/suite defaults under the stored values). */
function effectiveParams(key: string, params: unknown): Record<string, unknown> {
  const kind = carriedKind(key);
  if (kind === "builtin") return studyParamsWithDefaults(key, params);
  if (kind === "suite") return { ...suiteDefaults(key), ...(isRecord(params) ? params : {}) };
  return isRecord(params) ? { ...params } : {};
}

// --- capture ------------------------------------------------------------------------------------

/**
 * The portable body of the chart's current studies, in chart order. Built-in instances carry their
 * full effective params (so a later registry default change cannot silently alter a saved setup);
 * suites carry their flat params over suite defaults and their module eye ids. Entries a template
 * cannot carry are listed in `excluded` — never silently dropped.
 */
export function templateFromState(state: StudyState): { body: StudyTemplateBody; excluded: StudyTemplateSkip[] } {
  const inds = uniqueStrings(state.inds);
  const hidden = uniqueStrings(state.hidden);
  const params = isRecord(state.indParams) ? state.indParams : {};
  const stack = readStudyStack({ inds, indParams: params, hidden });
  const renderable = new Set(stack.instances.map((instance) => instance.id));
  const unsupported = new Map(stack.unsupported.map((entry) => [entry.id, entry.reason]));
  const body: StudyTemplateBody = { indicators: [], indParams: {}, hidden: [] };
  const excluded: StudyTemplateSkip[] = [];
  for (const key of inds) {
    const kind = carriedKind(key);
    if (kind === "builtin") {
      if (!renderable.has(key)) {
        const reason = unsupported.get(key);
        excluded.push({ id: key, reason: reason === "over_cap" ? "over_cap" : "unsupported_multiplicity" });
        continue;
      }
      body.indicators.push(key);
      body.indParams[key] = studyParamsWithDefaults(key, params[key]);
    } else if (kind === "suite") {
      body.indicators.push(key);
      body.indParams[key] = effectiveParams(key, params[key]);
    } else if (kind === "oracle") {
      body.indicators.push(key);
    } else {
      excluded.push({ id: key, reason: notCarriedReason(key) });
      continue;
    }
    body.hidden.push(...ownedHidden(key, hidden));
  }
  return { body, excluded };
}

// --- diff ---------------------------------------------------------------------------------------

/**
 * The entries of a triple the chart actually draws as studies, in `inds` order: renderable built-in
 * instances (never an unsupported or over-cap record), suites and the overlay. Keys a template never
 * owns are left out — they are preserved verbatim, so they can never differ.
 */
function displayedStudies(state: StudyState): string[] {
  const inds = uniqueStrings(state.inds);
  const stack = readStudyStack({ inds, indParams: isRecord(state.indParams) ? state.indParams : {}, hidden: [] });
  const renderable = new Set(stack.instances.map((instance) => instance.id));
  return inds.filter((key) => {
    const kind = carriedKind(key);
    return kind === "builtin" ? renderable.has(key) : kind !== null;
  });
}

/**
 * The visible difference between two triples, computed from the states alone (not from how a plan
 * built them), so a test can hold a plan's summary to the state it actually applies.
 */
export function diffStudyStates(current: StudyState, next: StudyState): Pick<StudyTemplatePlan, "added" | "removed" | "changed" | "unchanged"> {
  const before = displayedStudies(current);
  const after = displayedStudies(next);
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const beforeHidden = uniqueStrings(current.hidden);
  const afterHidden = uniqueStrings(next.hidden);
  const added = after.filter((key) => !beforeSet.has(key));
  const removed = before.filter((key) => !afterSet.has(key));
  const changed: StudyTemplateChange[] = [];
  const unchanged: string[] = [];
  for (const key of after) {
    if (!beforeSet.has(key)) continue;
    const a = effectiveParams(key, current.indParams?.[key]);
    const b = effectiveParams(key, next.indParams?.[key]);
    const type = parseStudyId(key)?.type as IndKey | undefined;
    const fieldKeys = new Set(type ? IND_DEFS[type].fields.map((f) => f.key) : []);
    const fields: string[] = [];
    let otherFields = 0;
    for (const field of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (stableStringify(a[field]) === stableStringify(b[field])) continue;
      if (fieldKeys.has(field)) fields.push(field);
      else otherFields++;
    }
    const visibility = stableStringify(ownedHidden(key, beforeHidden).sort()) !== stableStringify(ownedHidden(key, afterHidden).sort());
    if (fields.length || otherFields || visibility) changed.push({ id: key, fields, otherFields, visibility });
    else unchanged.push(key);
  }
  return { added, removed, changed, unchanged };
}

// --- apply planning -----------------------------------------------------------------------------

type TemplateParts = {
  /** Supported built-in template instances (template order), with the params to apply. */
  builtins: string[];
  suites: string[];
  oracle: boolean;
  /** Template keys in template order, kind-tagged. */
  order: { key: string; kind: CarriedKind }[];
  skipped: StudyTemplateSkip[];
};

function splitTemplate(template: StudyTemplateBody): TemplateParts {
  const indicators = uniqueStrings(template.indicators);
  const builtinIds = indicators.filter((key) => carriedKind(key) === "builtin");
  const stack = readStudyStack({ inds: builtinIds, indParams: template.indParams ?? {}, hidden: template.hidden ?? [] });
  const renderable = new Set(stack.instances.map((instance) => instance.id));
  const skipped: StudyTemplateSkip[] = stack.unsupported.map((entry) => ({ id: entry.id, reason: entry.reason }));
  const parts: TemplateParts = { builtins: [], suites: [], oracle: false, order: [], skipped };
  for (const key of indicators) {
    const kind = carriedKind(key);
    if (!kind) {
      skipped.push({ id: key, reason: notCarriedReason(key) });
      continue;
    }
    if (kind === "builtin") {
      if (!renderable.has(key)) continue;
      parts.builtins.push(key);
    } else if (kind === "suite") parts.suites.push(key);
    else parts.oracle = true;
    parts.order.push({ key, kind });
  }
  return parts;
}

/** The params a template entry applies under `id` (the template's own id or its remap). */
function templateParamsFor(
  templateId: string,
  appliedId: string,
  kind: CarriedKind,
  template: StudyTemplateBody,
  current: Readonly<Record<string, Record<string, unknown>>>,
): Record<string, unknown> | undefined {
  const own = template.indParams?.[templateId];
  if (kind === "builtin") {
    if (isRecord(own)) return studyParamsWithDefaults(appliedId, own);
    const parsed = parseStudyId(appliedId);
    // A primary without a template record keeps the user's device preference (pre-E06 add);
    // an additional instance starts from registry defaults, exactly like "add another".
    if (parsed?.primary) return current[appliedId];
    return parsed ? withDefaults(parsed.type, {}) : undefined;
  }
  if (kind === "suite") {
    if (isRecord(own)) return { ...suiteDefaults(templateId), ...own };
    return current[appliedId] ?? suiteDefaults(templateId);
  }
  return undefined;
}

/** Template eye entries owned by `templateId`, rewritten onto `appliedId` for a remapped instance. */
function templateHiddenFor(templateId: string, appliedId: string, template: StudyTemplateBody): string[] {
  const owned = ownedHidden(templateId, uniqueStrings(template.hidden));
  return appliedId === templateId ? owned : owned.map((entry) => (entry === templateId ? appliedId : entry));
}

const TIER_RANK = { free: 0, essential: 1, pro: 2 } as const;

/**
 * Plan applying `template` to the chart's `current` triple.
 *
 *   replace — the template's studies become the chart's studies: every template-owned entry on the
 *             chart not in the template is removed; entries a template never owns stay. A candle-
 *             only "Mastermind candles" carrier (the default candle style, not a study the user
 *             added) stays when the template has no trend suite of its own.
 *   merge   — the template's studies are ADDED: built-in instances through the E06 merge (an
 *             already-active multi-instance study is added again under a fresh id; a
 *             single-instance one is reported as already on the chart); a suite or overlay already
 *             on the chart is left as it is and reported.
 *
 * Params of removed primaries and suites stay as the device preference (the shell's remove rule);
 * a removed additional instance's record is retired with it (its id is never reused). On a guest
 * chart the shell's anonymous clamp is applied here, so the plan IS the state the chart settles on.
 */
export function planStudyTemplateApply(
  current: StudyState,
  template: StudyTemplateBody,
  mode: StudyTemplateMode,
  options: StudyTemplatePlanOptions = {},
): StudyTemplatePlan {
  const currentInds = uniqueStrings(current.inds);
  const currentParams = isRecord(current.indParams) ? current.indParams : {};
  const currentHidden = uniqueStrings(current.hidden);
  const parts = splitTemplate(template);
  const skipped: StudyTemplateSkip[] = [...parts.skipped];
  const remapped: Record<string, string> = {};
  /** Applied id -> how it got there (template id + kind) for guest-limit reverts. */
  const applied = new Map<string, { templateId: string; kind: CarriedKind }>();
  const indParams: Record<string, Record<string, unknown>> = { ...currentParams };
  const hidden = new Set(currentHidden);
  let inds: string[];

  if (mode === "replace") {
    const templateKeys = new Set(parts.order.map((entry) => entry.key));
    const currentStack = readStudyStack({ inds: currentInds, indParams: currentParams, hidden: currentHidden });
    const currentRenderable = new Set(currentStack.instances.map((instance) => instance.id));
    const keepAmbientTrend = !templateKeys.has(MASTERMIND_CANDLES_SUITE_KEY)
      && currentInds.includes(MASTERMIND_CANDLES_SUITE_KEY)
      && isAmbientCandleSuite(currentInds, currentParams);
    const owned = (key: string) => {
      const kind = carriedKind(key);
      if (!kind) return false;
      if (kind === "builtin") return currentRenderable.has(key);
      if (key === MASTERMIND_CANDLES_SUITE_KEY && keepAmbientTrend) return false;
      return true;
    };
    const preserved = currentInds.filter((key) => !owned(key));
    // A preserved over-cap record (a newer build's extra instance) still counts toward its type's
    // cap; the template's own instances fill only the remaining slots, canonical order.
    const perType = new Map<string, number>();
    for (const key of preserved) {
      const type = isSupportedStudyId(key) ? parseStudyId(key)?.type : undefined;
      if (type) perType.set(type, (perType.get(type) ?? 0) + 1);
    }
    const allowed = new Set<string>();
    for (const id of [...parts.builtins].sort(compareStudyIds)) {
      const type = parseStudyId(id)?.type as string;
      const count = perType.get(type) ?? 0;
      if (count >= MAX_INSTANCES_PER_TYPE) {
        skipped.push({ id, reason: "over_cap" });
        continue;
      }
      perType.set(type, count + 1);
      allowed.add(id);
    }
    const order = parts.order.filter((entry) => entry.kind !== "builtin" || allowed.has(entry.key));
    // Clear every eye entry the replaced chart studies and the incoming template studies control.
    for (const key of currentInds) if (owned(key)) for (const entry of ownedHidden(key, currentHidden)) hidden.delete(entry);
    for (const { key } of order) for (const entry of ownedHidden(key, currentHidden)) hidden.delete(entry);
    for (const { key, kind } of order) {
      const params = templateParamsFor(key, key, kind, template, currentParams);
      if (params === undefined) delete indParams[key];
      else indParams[key] = params;
      for (const entry of templateHiddenFor(key, key, template)) hidden.add(entry);
      applied.set(key, { templateId: key, kind });
    }
    inds = [...preserved, ...order.map((entry) => entry.key)];
    // Retire the records of additional instances this replace removed.
    const nextSet = new Set(inds);
    for (const key of currentInds) {
      if (!nextSet.has(key) && parseStudyId(key)?.primary === false) delete indParams[key];
    }
  } else {
    const builtinState: StudyState = {
      inds: parts.builtins,
      indParams: Object.fromEntries(parts.builtins.flatMap((id) => {
        const own = template.indParams?.[id];
        return isRecord(own) ? [[id, studyParamsWithDefaults(id, own)]] : [];
      })),
      hidden: uniqueStrings(template.hidden).filter((entry) => parts.builtins.includes(entry)),
    };
    const merged = mergeStudyState({ inds: currentInds, indParams: currentParams, hidden: currentHidden }, builtinState, options);
    Object.assign(remapped, merged.remapped);
    const inverse = new Map(Object.entries(merged.remapped).map(([from, to]) => [to, from]));
    for (const entry of merged.unsupported) skipped.push({ id: entry.id, reason: entry.reason });
    const addedBuiltins = new Set(merged.added);
    Object.assign(indParams, merged.state.indParams);
    hidden.clear();
    for (const entry of merged.state.hidden) hidden.add(entry);
    for (const id of merged.added) {
      const templateId = inverse.get(id) ?? id;
      const params = templateParamsFor(templateId, id, "builtin", template, currentParams);
      if (params === undefined) delete indParams[id];
      else indParams[id] = params;
      applied.set(id, { templateId, kind: "builtin" });
    }
    const appendOrder: string[] = [];
    for (const { key, kind } of parts.order) {
      if (kind === "builtin") {
        const id = remapped[key] ?? key;
        if (addedBuiltins.has(id)) appendOrder.push(id);
        continue;
      }
      if (currentInds.includes(key)) {
        skipped.push({ id: key, reason: "collision" });
        continue;
      }
      for (const entry of ownedHidden(key, currentHidden)) hidden.delete(entry);
      const params = templateParamsFor(key, key, kind, template, currentParams);
      if (params === undefined) delete indParams[key];
      else indParams[key] = params;
      for (const entry of templateHiddenFor(key, key, template)) hidden.add(entry);
      applied.set(key, { templateId: key, kind });
      appendOrder.push(key);
    }
    inds = [...currentInds, ...appendOrder];
  }

  // Guest charts: emulate the shell's anonymous clamp over the final order, then put back the
  // pre-apply records of every template entry it drops (so nothing the user did not get changes).
  const limit = options.guestLimit;
  if (typeof limit === "number" && limit >= 0) {
    const ambient = isAmbientCandleSuite(inds, indParams);
    const counted = inds.filter((key) => !(ambient && key === MASTERMIND_CANDLES_SUITE_KEY));
    if (counted.length > limit) {
      const keep = new Set(counted.slice(0, limit));
      if (ambient) keep.add(MASTERMIND_CANDLES_SUITE_KEY);
      const dropped = inds.filter((key) => !keep.has(key));
      inds = inds.filter((key) => keep.has(key));
      for (const key of dropped) {
        const origin = applied.get(key);
        if (!origin) continue;
        applied.delete(key);
        skipped.push({ id: origin.templateId, reason: "guest_limit" });
        if (origin.templateId !== key) delete remapped[origin.templateId];
        // The template entry was not applied, so neither are its settings. A chart study the
        // replace removed follows the shell's remove rule (primary/suite params stay as the
        // device preference, an additional instance's record retires, its eye entries clear).
        const wasActive = currentInds.includes(key);
        const parsed = parseStudyId(key);
        if (wasActive && parsed && !parsed.primary) delete indParams[key];
        else if (Object.prototype.hasOwnProperty.call(currentParams, key)) indParams[key] = currentParams[key];
        else delete indParams[key];
        for (const entry of ownedHidden(key, [...hidden])) hidden.delete(entry);
        if (!wasActive) for (const entry of ownedHidden(key, currentHidden)) hidden.add(entry);
      }
    }
  }

  const next: StudyTripleOut = { inds, indParams, hidden: [...hidden] };
  const diff = diffStudyStates({ inds: currentInds, indParams: currentParams, hidden: currentHidden }, next);
  const tier = TIER_RANK[options.userTier ?? "free"] ?? 0;
  const lockedModules: string[] = [];
  for (const key of inds) {
    if (!applied.has(key) || carriedKind(key) !== "suite") continue;
    for (const entry of enabledModulesForSuite(key, inds, indParams) as SuiteModuleCatalogEntry[]) {
      if ((TIER_RANK[entry.tier as keyof typeof TIER_RANK] ?? 0) > tier) lockedModules.push(entry.id);
    }
  }
  return {
    mode,
    next,
    ...diff,
    skipped,
    remapped,
    lockedModules,
    noop: !diff.added.length && !diff.removed.length && !diff.changed.length,
    baseFingerprint: studyStateFingerprint({ inds: currentInds, indParams: currentParams, hidden: currentHidden }),
    nextFingerprint: studyStateFingerprint(next),
  };
}

// --- display helpers ----------------------------------------------------------------------------

/**
 * A plain display name for one template/chart entry, never a raw key. `null` for a key this build
 * does not know (the caller shows its own "unrecognized study" text).
 */
export function studyTemplateEntryLabel(key: string, activeIds: Iterable<string> = [], params?: unknown): string | null {
  if (key === ORACLE_STUDY_KEY) return "Golden Oracle Confluence";
  if (isSuiteKey(key)) return getSuiteMeta(key)?.label ?? null;
  const parsed = parseStudyId(key);
  if (!parsed) return null;
  const def = IND_DEFS[parsed.type];
  const ids = [...activeIds];
  const siblings = ids.filter((id) => parseStudyId(id)?.type === parsed.type);
  if (siblings.length <= 1) return def.label;
  const field = def.fields.find((f) => f.group === "inputs" && f.type === "number");
  const value = field ? studyParamsWithDefaults(key, params)[field.key] : undefined;
  return typeof value === "number" && Number.isFinite(value) ? `${def.label} (${value})` : def.label;
}

/** The registry label of one built-in field, for the "changed" list. */
export function studyFieldLabel(key: string, field: string): string | null {
  const type = parseStudyId(key)?.type;
  if (!type) return null;
  return IND_DEFS[type].fields.find((f) => f.key === field)?.label ?? null;
}

/** A short summary of a template body for list rows: how many studies of which kinds. */
export function studyTemplateSummary(body: StudyTemplateBody): { studies: number; unknown: number } {
  let studies = 0;
  let unknown = 0;
  for (const key of uniqueStrings(body.indicators)) {
    if (carriedKind(key)) studies++;
    else unknown++;
  }
  return { studies, unknown };
}
