// ── The versioned workspace layout contract (`workspace_layout.v1`) — TS mirror ────────────────
//
// Frozen contract: research/DEEPVUE_W2A_WORKSPACE_LAYOUT_CONTRACT_2026-08-26.md (Macro repo), as
// amended by A1 (lockedVLine/split real-runtime types), A2 (Phase 6 review: real-runtime grammar,
// lossless-or-refuse, canonicalization, wire mode, key deny-list, optional `requires`, honest
// provenance) and A3 (direction-scoped lossless law, IEEE-754-safe number bounds, error precedence).
// Reference implementation Terminal proves against, field-for-field:
// engine/intelligence_workspace/workspace_layout.py (Macro repo). Golden vectors are digest-pinned
// in BOTH repos (`lib/__tests__/fixtures/workspace/`, see `workspaceVectors.test.ts`) — this is the
// W1-C parity mechanism (contract §10).
//
// This module is a pure transform of its arguments: no I/O, no network, no mutable module state.
// Every exported function is safe to call on hostile input without throwing (fail-closed).
//
// A workspace HOSTS widgets whose own state lives elsewhere (drawings, watchlist, favTF, Day Trade
// Mode, alerts — contract §2 anti-duplication law, carried forward verbatim from `layoutConfig.ts`).
// It never becomes their canonical data owner.

import { createHash } from "node:crypto";

export const SCHEMA = "workspace_layout.v1" as const;

// --- frozen vocabularies (contract §1-§8) -----------------------------------------------------

export const WIDGET_TYPES = ["chart", "brain"] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

export const SEMANTIC_LANES = ["primary", "secondary", "rail", "dock"] as const;
export type SemanticLane = (typeof SEMANTIC_LANES)[number];

export const ENTITY_TYPES = ["security", "industry", "theme", "portfolio", "event"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const MIGRATION_SOURCES = ["legacy_v0", "chart_layout_v1", "chart_layout_v2", "none", "import"] as const;
export type MigrationSource = (typeof MIGRATION_SOURCES)[number];

/** The complete frozen failure vocabulary (contract §8) — 16 codes, no more, no fewer. */
export const FAILURE_CODES = [
  "malformed_workspace", "unsupported_schema", "unsupported_floor",
  "unknown_widget_type", "invalid_widget_config", "duplicate_widget_id",
  "invalid_lane", "invalid_port", "name_conflict", "stale_revision",
  "store_unavailable", "unauthenticated", "not_found", "invalid_import",
  "oversized_workspace", "too_many_widgets",
] as const;
export type FailureCode = (typeof FAILURE_CODES)[number];

// --- frozen limits (contract §3) ----------------------------------------------------------------

export const MAX_WIDGETS = 12;
export const MAX_ENVELOPE_BYTES = 65536;
export const MAX_LINK_GROUPS = 8;
export const MAX_PORTS = 8;
export const FLOOR_SUPPORTED = 1;
// Amendment A2 ruling 1: bounded map nesting — 64 keys per level, depth <=3 below the
// per-indicator/per-symbol object inside indParams/compareCfg.
export const MAX_PARAM_KEYS_PER_LEVEL = 64;
export const MAX_PARAM_NEST_DEPTH = 3;
// Amendment A3 ruling 2 (number law, completes A2 ruling 4): integers bounded to the IEEE-754 safe
// range everywhere numbers occur (params, revision, source_revision, grid); a non-integral number
// is valid only within 1e-4 <= |x| < 1e12 — both languages' shortest-repr is exponent-free and
// digit-identical in that window, which is exactly why it was chosen. JS has no separate int/float
// type, so "integral-valued float normalizes to int" is automatic here — the bound is a pure range
// check on `Number.isInteger(x)` vs not.
export const MAX_SAFE_INT = 9007199254740991; // 2**53 - 1
export const MIN_NONZERO_FLOAT_MAGNITUDE = 1e-4;
export const MAX_FLOAT_MAGNITUDE = 1e12; // exclusive upper bound

/** The 12 chart-config fields owned verbatim by the existing Terminal chart-layout contract
 *  (contract §2). Order carries no schema meaning; it matches the Macro reference for readability. */
export const CHART_CONFIG_FIELDS = [
  "panes", "paneTfs", "split", "activePane", "sync", "chartType",
  "inds", "indParams", "hidden", "compare", "compareCfg", "lockedVLine",
] as const;
export type ChartConfigField = (typeof CHART_CONFIG_FIELDS)[number];

// --- shapes ---------------------------------------------------------------------------------

export type ParamMap = Record<string, Record<string, unknown>>;

export type ChartWidgetConfig = {
  panes?: string[]; paneTfs?: string[]; split?: number; activePane?: number; sync?: boolean;
  chartType?: string; inds?: string[]; indParams?: ParamMap; hidden?: string[];
  compare?: string[]; compareCfg?: Record<string, unknown>; lockedVLine?: string | null;
};

export type LinkGroup = { entity_type: EntityType };
export type WidgetGrid = { x: number; y: number; w: number; h: number };

export type Widget = {
  id: string;
  type: WidgetType;
  semantic_lane: SemanticLane;
  grid?: WidgetGrid;
  context_in: string[];
  context_out: string[];
  config: Record<string, unknown>;
};

export type MigrationProvenance = { source: MigrationSource; source_revision: number | null };

export type WorkspaceEnvelope = {
  schema: typeof SCHEMA;
  requires: { floor: number };
  revision: number;
  name: string | null;
  link_groups: Record<string, LinkGroup>;
  widgets: Widget[];
  migration: MigrationProvenance;
};

export type ValidationError = { code: FailureCode; path: string };
export type ValidationResult = { ok: true; errors: [] } | { ok: false; errors: ValidationError[] };

// --- internal helpers -------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

/** Amendment A3 ruling 2: an integer within the IEEE-754 safe range (|n| <= 2**53 - 1) — the bound
 *  applied everywhere a plain integer is accepted (params, revision, source_revision, grid). */
const isSafeInt = (v: unknown): v is number => isInt(v) && Math.abs(v) <= MAX_SAFE_INT;

const TOP_LEVEL_KEYS = new Set(["schema", "requires", "revision", "name", "link_groups", "widgets", "migration"]);
// Amendment A2 ruling 11: `requires` is optional (absent -> floor 1).
const REQUIRED_TOP_LEVEL_KEYS = new Set([...TOP_LEVEL_KEYS].filter((k) => k !== "requires"));
const WIDGET_KEYS = new Set(["id", "type", "semantic_lane", "grid", "context_in", "context_out", "config"]);
const GRID_KEYS = new Set(["x", "y", "w", "h"]);
const MIGRATION_KEYS = new Set(["source", "source_revision"]);
const LINK_GROUP_KEYS = new Set(["entity_type"]);

// Amendment A2 ruling 10: prototype-pollution-shaped keys are never valid identifiers anywhere a
// key/id is accepted (widget ids, link-group names, indParams/compareCfg identifiers and nested
// param keys).
const DENIED_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const isDeniedKey = (key: unknown): boolean => typeof key === "string" && DENIED_KEYS.has(key);

const WIDGET_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const LINK_GROUP_NAME_RE = /^[a-z][a-z0-9_]{0,31}$/;
const TIMEFRAME_RE = /^[A-Za-z0-9]{1,8}$/;
// Amendment A2 ruling 1 (real-runtime grammar, Phase 6 review):
//   symbol       — covers composite panes ("NVDA+AMD"), caret index panes ("^NDX"), and colon
//                  venue-qualified tickers ("BINANCE:BTCUSDT").
//   chart_type   — covers hyphenated chart types ("line-markers").
//   indicator_id — covers underscore-prefixed ids ("_lab").
//   param_key    — covers dotted premium-suite keys ("ob.showLast").
const SYMBOL_RE = /^[\^A-Z0-9.+:_-]{1,24}$/;
const CHART_TYPE_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const INDICATOR_ID_RE = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;
const PARAM_KEY_RE = /^[A-Za-z0-9_][A-Za-z0-9_.]{0,63}$/;
// Amendment A1: 1..64 chars, no ASCII control characters (0x00-0x1f, 0x7f).
const LOCKED_VLINE_RE = /^[^\x00-\x1f\x7f]{1,64}$/;

/** Sentinel distinguishing "field present but wrong type/shape" (never claimed) from a
 *  legitimately-valid `null` value (e.g. `lockedVLine` explicitly cleared) — mirrors the Python
 *  reference's `_INVALID` object (contract §6 claim semantics). */
export const INVALID: unique symbol = Symbol("workspace-field-invalid");
type FieldResult<T> = T | typeof INVALID;

/** A data-typed leaf value: bool/safe-int/bounded-float/null, or a string <=64 chars. NaN/Infinity
 *  are never valid (A2 ruling 4). Amendment A3 ruling 2: a plain integer must be IEEE-754-safe; an
 *  integral-valued number normalizes to that same bound (JS has no separate float type, so this is
 *  a single range check); a non-integral number is valid only within
 *  `1e-4 <= |x| < 1e12` (both languages' shortest-repr is exponent-free and digit-identical there).
 *  No executable payloads, no non-finite or unbounded numerics, anywhere (contract §3). */
const isBoundedPrimitive = (value: unknown): boolean => {
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return false;
    if (Number.isInteger(value)) return Math.abs(value) <= MAX_SAFE_INT;
    const magnitude = Math.abs(value);
    return magnitude >= MIN_NONZERO_FLOAT_MAGNITUDE && magnitude < MAX_FLOAT_MAGNITUDE;
  }
  if (typeof value === "string") return value.length <= 64;
  return false;
};

/** A value inside a per-indicator/per-symbol params object: either a bounded primitive leaf, or —
 *  while `remainingDepth` budget remains — a further bounded nested object whose own keys/values
 *  recurse the same rule (Amendment A2 ruling 1: nesting depth <=3 below the per-indicator object,
 *  e.g. the real `_vis` visibility-range shape). Deny-listed keys are rejected at every level
 *  (Amendment A2 ruling 10). */
function validateParamLeafOrNested(value: unknown, remainingDepth: number): FieldResult<unknown> {
  if (isRecord(value)) {
    if (remainingDepth <= 0) return INVALID;
    const entries = Object.entries(value);
    if (entries.length > MAX_PARAM_KEYS_PER_LEVEL) return INVALID;
    const out: Record<string, unknown> = {};
    for (const [key, sub] of entries) {
      if (!PARAM_KEY_RE.test(key) || isDeniedKey(key)) return INVALID;
      const normalized = validateParamLeafOrNested(sub, remainingDepth - 1);
      if (normalized === INVALID) return INVALID;
      out[key] = normalized;
    }
    return out;
  }
  if (!isBoundedPrimitive(value)) return INVALID;
  return value;
}

/** Shared shape for `indParams`/`compareCfg`: a bounded map of identifier -> bounded map of
 *  param-name -> (bounded primitive | nested object up to depth 3, Amendment A2 ruling 1). No
 *  executable payloads anywhere (contract §3); prototype-pollution-shaped keys denied at every
 *  level (Amendment A2 ruling 10). */
function validateParamBlock(value: unknown, keyPattern: RegExp): FieldResult<ParamMap> {
  if (!isRecord(value) || Object.keys(value).length > MAX_PARAM_KEYS_PER_LEVEL) return INVALID;
  const out: ParamMap = {};
  for (const [key, sub] of Object.entries(value)) {
    if (!keyPattern.test(key) || isDeniedKey(key)) return INVALID;
    if (!isRecord(sub) || Object.keys(sub).length > MAX_PARAM_KEYS_PER_LEVEL) return INVALID;
    const subOut: Record<string, unknown> = {};
    for (const [subKey, subVal] of Object.entries(sub)) {
      if (!PARAM_KEY_RE.test(subKey) || isDeniedKey(subKey)) return INVALID;
      const normalized = validateParamLeafOrNested(subVal, MAX_PARAM_NEST_DEPTH);
      if (normalized === INVALID) return INVALID;
      subOut[subKey] = normalized;
    }
    out[key] = subOut;
  }
  return out;
}

function vPanes(value: unknown): FieldResult<string[]> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) return INVALID;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !SYMBOL_RE.test(item)) return INVALID;
    out.push(item);
  }
  return out;
}

function vPaneTfs(value: unknown): FieldResult<string[]> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) return INVALID;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !TIMEFRAME_RE.test(item)) return INVALID;
    out.push(item);
  }
  return out;
}

const VALID_SPLITS = [1, 2, 4] as const;

/** Amendment A1 (2026-08-26, Macro commit 8b4d326514f6): `split` is Terminal's discrete
 *  pane-split selector (`layoutConfig.ts` `VALID_SPLITS = [1,2,4]`), never a 0-100 percentage —
 *  the original freeze's `0..100` bound was an authoring error that would have rejected every
 *  real Terminal v2 layout using this field. */
function vSplit(value: unknown): FieldResult<number> {
  if (!isInt(value) || !(VALID_SPLITS as readonly number[]).includes(value)) return INVALID;
  return value;
}

function vActivePane(value: unknown): FieldResult<number> {
  if (!isInt(value) || value < 0 || value > 3) return INVALID;
  return value;
}

function vSync(value: unknown): FieldResult<boolean> {
  if (typeof value !== "boolean") return INVALID;
  return value;
}

function vChartType(value: unknown): FieldResult<string> {
  if (typeof value !== "string" || !CHART_TYPE_RE.test(value)) return INVALID;
  return value;
}

function vInds(value: unknown): FieldResult<string[]> {
  if (!Array.isArray(value) || value.length > 32) return INVALID;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !INDICATOR_ID_RE.test(item) || isDeniedKey(item)) return INVALID;
    out.push(item);
  }
  return out;
}

function vIndParams(value: unknown): FieldResult<ParamMap> {
  return validateParamBlock(value, INDICATOR_ID_RE);
}

function vHidden(value: unknown): FieldResult<string[]> {
  return vInds(value);
}

function vCompare(value: unknown): FieldResult<string[]> {
  if (!Array.isArray(value) || value.length > 32) return INVALID;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !SYMBOL_RE.test(item)) return INVALID;
    out.push(item);
  }
  return out;
}

function vCompareCfg(value: unknown): FieldResult<ParamMap> {
  return validateParamBlock(value, SYMBOL_RE);
}

/** Amendment A1 (2026-08-26, Macro commit 8b4d326514f6): `lockedVLine` is `string | null` in the
 *  real Terminal runtime (`TerminalShell.tsx`/`ChartPanel.tsx` own it as a string key), never a
 *  number — the original freeze's `number | null` bound would have rejected every real Terminal v2
 *  layout that used it (this worker's own KNOWN GAP finding, ruled a real contract defect). */
function vLockedVLine(value: unknown): FieldResult<string | null> {
  if (value === null) return null;
  if (typeof value !== "string") return INVALID;
  if (!LOCKED_VLINE_RE.test(value)) return INVALID;
  return value;
}

/** Per-field validators, keyed by the frozen chart-config field name (contract §2). Exported so
 *  `workspaceMigrate.ts` can reuse the SAME claim semantics the Macro reference uses. */
export const CHART_FIELD_VALIDATORS: { [K in ChartConfigField]: (value: unknown) => FieldResult<unknown> } = {
  panes: vPanes,
  paneTfs: vPaneTfs,
  split: vSplit,
  activePane: vActivePane,
  sync: vSync,
  chartType: vChartType,
  inds: vInds,
  indParams: vIndParams,
  hidden: vHidden,
  compare: vCompare,
  compareCfg: vCompareCfg,
  lockedVLine: vLockedVLine,
};

function err(code: FailureCode, path: string): ValidationError {
  return { code, path };
}

function validateGrid(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== GRID_KEYS.size || !keys.every((k) => GRID_KEYS.has(k))) return false;
  return ["x", "y", "w", "h"].every((k) => {
    const v = (value as Record<string, unknown>)[k];
    return isSafeInt(v) && v >= 0 && v <= 64;
  });
}

function validateWidgetConfig(widgetType: unknown, config: unknown, path: string): ValidationError[] {
  const errors: ValidationError[] = [];
  if (widgetType === "brain") {
    // Closed, no properties.
    if (!(isRecord(config) && Object.keys(config).length === 0)) errors.push(err("invalid_widget_config", path));
    return errors;
  }
  if (widgetType === "chart") {
    if (!isRecord(config)) {
      errors.push(err("invalid_widget_config", path));
      return errors;
    }
    for (const key of Object.keys(config)) {
      if (!(CHART_CONFIG_FIELDS as readonly string[]).includes(key)) {
        errors.push(err("invalid_widget_config", `${path}.${key}`));
      }
    }
    for (const [field, raw] of Object.entries(config)) {
      const validator = (CHART_FIELD_VALIDATORS as Record<string, (v: unknown) => FieldResult<unknown>>)[field];
      if (!validator) continue; // already reported as unknown above
      if (validator(raw) === INVALID) errors.push(err("invalid_widget_config", `${path}.${field}`));
    }
    return errors;
  }
  // Unknown widget type: `unknown_widget_type` is reported by the caller; config shape is not
  // independently meaningful for an unrecognized type.
  if (!isRecord(config)) errors.push(err("invalid_widget_config", path));
  return errors;
}

/** Wire-mode name law (Amendment A2 ruling 5/14): already trimmed, no internal whitespace runs
 *  collapsed away, 1..60 chars. */
function isNormalizedName(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length < 1 || value.length > 60) return false;
  if (value !== value.trim()) return false;
  if (/\s{2,}/.test(value)) return false;
  return true;
}

/** Trim + collapse internal whitespace runs + bound to 1..60 chars. Returns `null` when the input
 *  is not a usable name at all (not a string, or empty/oversized after normalization) — the caller
 *  refuses rather than store/echo an unusable name (Amendment A2 ruling 14). */
function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const collapsed = value.trim().replace(/\s+/g, " ");
  if (collapsed.length < 1 || collapsed.length > 60) return null;
  return collapsed;
}

/**
 * Validate a `workspace_layout.v1` envelope: schema shape AND the cross-field laws the JSON Schema
 * alone cannot express (contract §1-§8, amended by A1/A2/A3). Never throws — every branch is a
 * type/membership check on already-untrusted input, fail-closed on anything unexpected.
 *
 * `wire=false` (default) is the STORED-row law: `name` must be `null`. `wire=true` (Amendment A2
 * ruling 5) is the wire/export law: `name` may additionally be a normalized non-null string
 * (trim/collapse/1..60, ruling 14) — used to validate the read/export projection and IMPORT
 * payloads, never the stored row itself.
 *
 * Amendment A3 ruling 3 (error precedence): the `schema` literal is checked FIRST — a mismatch
 * returns `unsupported_schema` ALONE, before any other issue in the object is even inspected.
 * `requires.floor` is checked SECOND — a well-formed but unsupported floor returns
 * `unsupported_floor` ALONE. Only once both gates pass does the general structural sweep run.
 */
export function validateEnvelope(obj: unknown, wire = false): ValidationResult {
  if (!isRecord(obj)) {
    return { ok: false, errors: [err("malformed_workspace", "$")] };
  }

  // --- Ruling 3, gate 1: schema literal, alone. -----------------------------------------------
  const schema = obj.schema;
  if (schema !== SCHEMA) {
    return { ok: false, errors: [err("unsupported_schema", "$.schema")] };
  }

  // --- Ruling 3, gate 2: requires.floor, alone (A2 ruling 11: `requires`/`requires.floor` are
  // optional — absent defaults to floor 1). A STRUCTURALLY malformed `requires` is not
  // "unsupported", so it is remembered here and folded into the general sweep below instead of
  // short-circuiting — only a well-formed-but-too-high floor gets the alone-and-immediate treatment.
  const requires: unknown = "requires" in obj ? obj.requires : {};
  let requiresError: ValidationError | null = null;
  if (!isRecord(requires) || Object.keys(requires).some((k) => k !== "floor")) {
    requiresError = err("malformed_workspace", "$.requires");
  } else {
    const floor = "floor" in requires ? requires.floor : FLOOR_SUPPORTED;
    if (!isSafeInt(floor) || floor < 1) {
      requiresError = err("malformed_workspace", "$.requires.floor");
    } else if (floor > FLOOR_SUPPORTED) {
      return { ok: false, errors: [err("unsupported_floor", "$.requires.floor")] };
    }
  }

  // --- Gate passed: the general structural sweep. ---------------------------------------------
  const errors: ValidationError[] = [];
  if (requiresError) errors.push(requiresError);

  for (const key of Object.keys(obj)) {
    if (!TOP_LEVEL_KEYS.has(key)) errors.push(err("malformed_workspace", `$.${key}`));
  }
  for (const key of REQUIRED_TOP_LEVEL_KEYS) {
    if (!(key in obj)) errors.push(err("malformed_workspace", `$.${key}`));
  }

  const revision = obj.revision;
  if (!isSafeInt(revision) || revision < 1) errors.push(err("malformed_workspace", "$.revision"));

  const name = obj.name;
  if (wire) {
    if (name !== null && !isNormalizedName(name)) errors.push(err("malformed_workspace", "$.name"));
  } else {
    if (name !== null) errors.push(err("malformed_workspace", "$.name"));
  }

  const linkGroups = obj.link_groups;
  const declaredGroups = new Set<string>();
  if (!isRecord(linkGroups)) {
    errors.push(err("malformed_workspace", "$.link_groups"));
  } else {
    const entries = Object.entries(linkGroups);
    if (entries.length > MAX_LINK_GROUPS) errors.push(err("malformed_workspace", "$.link_groups"));
    for (const [groupName, group] of entries) {
      if (!LINK_GROUP_NAME_RE.test(groupName) || isDeniedKey(groupName)) {
        errors.push(err("malformed_workspace", `$.link_groups.${groupName}`));
        continue;
      }
      declaredGroups.add(groupName);
      if (!isRecord(group)) {
        errors.push(err("malformed_workspace", `$.link_groups.${groupName}`));
        continue;
      }
      const gKeys = Object.keys(group);
      if (gKeys.length !== LINK_GROUP_KEYS.size || !gKeys.every((k) => LINK_GROUP_KEYS.has(k))) {
        errors.push(err("malformed_workspace", `$.link_groups.${groupName}`));
        continue;
      }
      if (!(ENTITY_TYPES as readonly string[]).includes(group.entity_type as string)) {
        errors.push(err("malformed_workspace", `$.link_groups.${groupName}.entity_type`));
      }
    }
  }

  let widgets: unknown[] = [];
  const rawWidgets = obj.widgets;
  if (!Array.isArray(rawWidgets)) {
    errors.push(err("malformed_workspace", "$.widgets"));
  } else {
    widgets = rawWidgets;
    if (rawWidgets.length > MAX_WIDGETS) errors.push(err("too_many_widgets", "$.widgets"));
    else if (rawWidgets.length < 1) errors.push(err("malformed_workspace", "$.widgets"));
  }

  const seenIds = new Set<string>();
  widgets.forEach((widget, index) => {
    const path = `$.widgets[${index}]`;
    if (!isRecord(widget)) {
      errors.push(err("invalid_widget_config", path));
      return;
    }
    for (const key of Object.keys(widget)) {
      if (!WIDGET_KEYS.has(key)) errors.push(err("invalid_widget_config", `${path}.${key}`));
    }
    for (const key of ["id", "type", "semantic_lane", "context_in", "context_out", "config"]) {
      if (!(key in widget)) errors.push(err("invalid_widget_config", `${path}.${key}`));
    }

    const widgetId = widget.id;
    if (typeof widgetId !== "string" || !WIDGET_ID_RE.test(widgetId) || isDeniedKey(widgetId)) {
      errors.push(err("invalid_widget_config", `${path}.id`));
    } else {
      if (seenIds.has(widgetId)) errors.push(err("duplicate_widget_id", `${path}.id`));
      seenIds.add(widgetId);
    }

    const widgetType = widget.type;
    if (!(WIDGET_TYPES as readonly unknown[]).includes(widgetType)) {
      errors.push(err("unknown_widget_type", `${path}.type`));
    }

    const lane = widget.semantic_lane;
    if (!(SEMANTIC_LANES as readonly unknown[]).includes(lane)) {
      errors.push(err("invalid_lane", `${path}.semantic_lane`));
    }

    if ("grid" in widget && !validateGrid(widget.grid)) {
      errors.push(err("invalid_widget_config", `${path}.grid`));
    }

    for (const portKey of ["context_in", "context_out"] as const) {
      const ports = widget[portKey];
      if (!Array.isArray(ports) || ports.length > MAX_PORTS) {
        errors.push(err("invalid_widget_config", `${path}.${portKey}`));
        continue;
      }
      ports.forEach((groupName, portIndex) => {
        if (typeof groupName !== "string" || !LINK_GROUP_NAME_RE.test(groupName)) {
          errors.push(err("invalid_port", `${path}.${portKey}[${portIndex}]`));
        } else if (!declaredGroups.has(groupName)) {
          errors.push(err("invalid_port", `${path}.${portKey}[${portIndex}]`));
        }
      });
    }

    if ((WIDGET_TYPES as readonly unknown[]).includes(widgetType)) {
      errors.push(...validateWidgetConfig(widgetType, widget.config, `${path}.config`));
    }
  });

  const migration = obj.migration;
  if (!isRecord(migration)) {
    errors.push(err("malformed_workspace", "$.migration"));
  } else {
    const mKeys = Object.keys(migration);
    if (mKeys.length !== MIGRATION_KEYS.size || !mKeys.every((k) => MIGRATION_KEYS.has(k))) {
      errors.push(err("malformed_workspace", "$.migration"));
    } else {
      if (!(MIGRATION_SOURCES as readonly unknown[]).includes(migration.source)) {
        errors.push(err("malformed_workspace", "$.migration.source"));
      }
      // Amendment A2 ruling 12 + A3 ruling 2: 1 <= source_revision <= safe int.
      const sourceRevision = migration.source_revision;
      if (sourceRevision !== null && (!isSafeInt(sourceRevision) || sourceRevision < 1)) {
        errors.push(err("malformed_workspace", "$.migration.source_revision"));
      }
    }
  }

  try {
    const canonical = canonicalJson(obj);
    if (Buffer.byteLength(canonical, "utf8") > MAX_ENVELOPE_BYTES) {
      errors.push(err("oversized_workspace", "$"));
    }
  } catch {
    // Amendment A2 ruling 4: NaN/Infinity anywhere in the structure, or a lone UTF-16 surrogate in
    // any string, both land here as malformed, never a crash.
    errors.push(err("malformed_workspace", "$"));
  }

  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors };
}

/** Recognizer for `isWorkspaceEnvelope`/`rowStateFor`: a structurally-valid, ok=true envelope. */
export function isWorkspaceEnvelope(config: unknown): config is WorkspaceEnvelope {
  return isRecord(config) && config.schema === SCHEMA && validateEnvelope(config).ok;
}

/** Per-row read state for the library list (contract §8/§9): a row that fails validation is never
 *  silently rendered as empty/healthy — it is marked so the menu can show a plain-word reason. */
export function rowStateFor(config: unknown): "ok" | "unsupported_floor" | "unsupported_schema" {
  if (!isRecord(config) || config.schema !== SCHEMA) return "unsupported_schema";
  const result = validateEnvelope(config);
  if (result.ok) return "ok";
  if (result.errors.some((e) => e.code === "unsupported_floor")) return "unsupported_floor";
  return "unsupported_schema";
}

/** Amendment A2 ruling 4 + A3 ruling 2: canonicalization-time BACKSTOP for the number law (field-
 *  level checks are the first line of defense) — recurses the structure and throws on a non-finite
 *  number, an integer/integral-valued number outside the IEEE-754 safe range, or a non-integral
 *  number outside `1e-4 <= |x| < 1e12`. Callers treat any thrown error as `malformed_workspace`,
 *  never let it escape as an uncaught crash. JS has no separate int/float type, so — unlike the
 *  Python reference, which converts `20.0` to `20` — there is nothing to "normalize"; the checks
 *  below are pure range validation over `number`. */
function checkNumericBounds(value: unknown): void {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non-finite number is not a valid canonical value");
    if (Number.isInteger(value)) {
      if (Math.abs(value) > MAX_SAFE_INT) throw new RangeError("integer exceeds the IEEE-754 safe range");
      return;
    }
    const magnitude = Math.abs(value);
    if (!(magnitude >= MIN_NONZERO_FLOAT_MAGNITUDE && magnitude < MAX_FLOAT_MAGNITUDE)) {
      throw new RangeError("non-integral number outside the canonical magnitude window");
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) checkNumericBounds(item);
    return;
  }
  if (isRecord(value)) {
    for (const sub of Object.values(value)) checkNumericBounds(sub);
  }
}

/** Re-escapes a `JSON.stringify`-quoted string so a LONE UTF-16 surrogate (never valid UTF-8 on its
 *  own — Python's `str.encode("utf-8")` raises `UnicodeEncodeError` on exactly this) throws instead
 *  of silently round-tripping through `U+FFFD`-substitution the way `Buffer.from(str, "utf8")`
 *  otherwise would. `ensure_ascii=False` (Amendment A2 ruling 4) means every OTHER character passes
 *  through untouched — this function's only job is the lone-surrogate check. */
function assertNoLoneSurrogates(s: string): void {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    const isHighSurrogate = code >= 0xd800 && code <= 0xdbff;
    const isLowSurrogate = code >= 0xdc00 && code <= 0xdfff;
    if (isHighSurrogate) {
      const next = s.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError("lone UTF-16 surrogate is not valid UTF-8");
      i++; // consumed as a valid pair
    } else if (isLowSurrogate) {
      throw new TypeError("lone UTF-16 surrogate is not valid UTF-8");
    }
  }
}

function stringifySorted(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non-finite number is not JSON-serializable");
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") {
    assertNoLoneSurrogates(value);
    return JSON.stringify(value); // ensure_ascii=False (A2 ruling 4): non-ASCII passes through raw.
  }
  if (Array.isArray(value)) return `[${value.map((v) => stringifySorted(v)).join(",")}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${stringifySorted(k)}:${stringifySorted(value[k])}`).join(",")}}`;
  }
  throw new TypeError(`value of type ${typeof value} is not JSON-serializable`);
}

/** Canonical (sorted-key, compact, `ensure_ascii=False`, numeric-bounds-checked) JSON serialization
 *  — used for the size check above and for `envelopeDigest` below. Mirrors Python's
 *  `json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)`
 *  over the same numeric-normalized structure (Amendment A2 ruling 4 / A3 ruling 2). Throws on a
 *  non-finite/out-of-range number or a lone surrogate — callers convert that into
 *  `malformed_workspace` rather than letting it escape. */
export function canonicalJson(value: unknown): string {
  checkNumericBounds(value);
  return stringifySorted(value);
}

/** SHA-256 over the canonical serialization — the digest used to pin golden vectors and to prove
 *  this module byte-identical to the Macro reference (contract §10). Never throws: an undigestable
 *  structure (non-finite/out-of-range number, lone surrogate) still returns a stable 64-char hex
 *  string rather than crashing — callers are expected to validate with `validateEnvelope` first.
 *  Node-only (uses `node:crypto`); callers in this repo only ever run server-side or under vitest. */
export function envelopeDigest(envelope: unknown): string {
  let encoded: Buffer;
  try {
    encoded = Buffer.from(canonicalJson(envelope), "utf8");
  } catch {
    encoded = Buffer.from("\x00invalid-envelope", "utf8");
  }
  return createHash("sha256").update(encoded).digest("hex");
}
