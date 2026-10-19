/** Metadata-only indicator parameter validation for the existing Chart Bus.
 * No runtime imports, second catalogue, indicator maths, or entitlement decisions.
 */
import { IND_DEFS, type IndField, type IndKey } from "./indicators";
import { isSupportedStudyId, readStudyStack, studyTypeOf } from "./studyInstances";
import { getSuiteMeta, SUITE_ORDER } from "./suites/meta";
import type { SuiteField } from "./indicator-canvas/types";
import { hasGuide } from "./guides/registry";

export type IndicatorParam = number | boolean | string;
export type NativeParamsResult =
  | { ok: true; params?: Record<string, IndicatorParam> }
  | { ok: false; error: string };

function validField(field: SuiteField, value: unknown): value is IndicatorParam {
  if (field.type === "bool") return typeof value === "boolean";
  if (field.type === "select") return field.options?.some(option => option.v === value) === true;
  if (field.type !== "number" || typeof value !== "number" || !Number.isFinite(value)) return false;
  if (field.min !== undefined && value < field.min) return false;
  if (field.max !== undefined && value > field.max) return false;
  // NumberField uses step for +/- controls, not to quantize manual values.
  return true;
}

/** A bad native setting rejects the complete command; never replace it with a default. */
export function readNativeSuiteParams(suiteKey: string, value: unknown): NativeParamsResult {
  const suite = getSuiteMeta(suiteKey);
  if (!suite) return { ok: false, error: "unknown_indicator" };
  if (value === undefined) return { ok: true };
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return { ok: false, error: "bad_native_params" };
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype)
    return { ok: false, error: "bad_native_params" };

  const out: Record<string, IndicatorParam> = {};
  for (const key of Object.keys(value)) {
    const parts = key.split(".");
    if (parts.length !== 2) return { ok: false, error: "unknown_native_setting" };
    const module = suite.modules.find(candidate => candidate.key === parts[0]);
    if (!module) return { ok: false, error: "unknown_native_setting" };
    // JSON is the wire format. Reject accessor-bearing local objects rather than executing them.
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) return { ok: false, error: "bad_native_params" };
    const setting: unknown = descriptor.value;
    if (parts[1] === "on") {
      if (typeof setting !== "boolean") return { ok: false, error: "invalid_native_setting" };
    } else {
      const field = module.fields.find(candidate => candidate.key === parts[1]);
      if (!field) return { ok: false, error: "unknown_native_setting" };
      if (!validField(field, setting)) return { ok: false, error: "invalid_native_setting" };
    }
    out[key] = setting as IndicatorParam;
  }
  return { ok: true, params: Object.keys(out).length ? out : undefined };
}


export type NativeParameterSchema = {
  type: "number" | "boolean" | "string" | Array<"number" | "string">;
  default: IndicatorParam;
  minimum?: number;
  maximum?: number;
  enum?: Array<string | number>;
};
export type NativeModuleDescription = {
  id: string;
  suite: string;
  module: string;
  label: string;
  tier: string;
  additional_parameters: false;
  parameters: Record<string, NativeParameterSchema>;
  unsupported_parameters: string[];
};
export type NativeSuiteCapabilities = {
  schema: "chart.native_parameters.v1";
  authority: "configuration_description_only";
  scope: "active_native_suites";
  status: "complete" | "partial";
  semantics: {
    membership: "replace_set";
    parameters: "merge_existing";
    module_switch: "<module>.on boolean";
    numeric_step: "ui_increment_not_constraint";
    entitlements: "renderer_enforced";
  };
  modules: NativeModuleDescription[];
  omitted_modules: string[];
};
export const NATIVE_CAPABILITIES_MAX_BYTES = 4096;

// This is a projection of the same fields used above, not another validator or catalog.
function describeField(field: SuiteField, value: unknown): NativeParameterSchema | null {
  if (!validField(field, value)) return null;
  if (field.type === "bool") return { type: "boolean", default: value };
  if (field.type === "select") {
    const values = (field.options ?? []).map(option => option.v);
    const numeric = values.every(option => typeof option === "number");
    const textual = values.every(option => typeof option === "string");
    return { type: numeric ? "number" : textual ? "string" : ["number", "string"],
      enum: values, default: value };
  }
  const row: NativeParameterSchema = { type: "number", default: value };
  if (field.min !== undefined) row.minimum = field.min;
  if (field.max !== undefined) row.maximum = field.max;
  return row;
}

/** Bounded model-visible configuration facts on the existing chart-state path.
 * Current values remain in session.indicators. Discovery neither computes a suite,
 * grants its tier, nor claims that its output is a research predicate or probability.
 */
export function describeNativeSuiteCapabilities(
  indicators: readonly string[],
  settings: Record<string, Record<string, unknown>> = {},
): NativeSuiteCapabilities | null {
  const active = new Set(indicators);
  const candidates: Array<{ row: NativeModuleDescription; enabled: boolean }> = [];
  for (const key of SUITE_ORDER) {
    if (!active.has(key)) continue;
    const suite = getSuiteMeta(key)!;
    for (const module of suite.modules) {
      const parameters: Record<string, NativeParameterSchema> = {
        [`${module.key}.on`]: { type: "boolean", default: module.defaultOn },
      };
      const unsupported: string[] = [];
      for (const field of module.fields) {
        if (field.key === "on") continue; // the existing master-switch meaning wins
        const name = `${module.key}.${field.key}`;
        const description = describeField(field, module.defaults?.[field.key]);
        if (description) parameters[name] = description;
        else unsupported.push(name);
      }
      candidates.push({
        enabled: (settings[key]?.[`${module.key}.on`] ?? module.defaultOn) !== false,
        row: { id: `${key}/${module.key}`, suite: key, module: module.key,
          label: module.label, tier: module.tier, additional_parameters: false,
          parameters, unsupported_parameters: unsupported },
      });
    }
  }
  if (!candidates.length) return null;
  // Stable sort keeps canonical suite/module order within each priority group.
  candidates.sort((a, b) => Number(b.enabled) - Number(a.enabled));
  let packet: NativeSuiteCapabilities = {
    schema: "chart.native_parameters.v1", authority: "configuration_description_only",
    scope: "active_native_suites", status: "partial",
    semantics: { membership: "replace_set", parameters: "merge_existing",
      module_switch: "<module>.on boolean", numeric_step: "ui_increment_not_constraint",
      entitlements: "renderer_enforced" },
    modules: [], omitted_modules: candidates.map(({ row }) => row.id),
  };
  const encoder = new TextEncoder();
  for (const { row } of candidates) {
    const omitted = packet.omitted_modules.filter(id => id !== row.id);
    const candidate: NativeSuiteCapabilities = { ...packet,
      modules: [...packet.modules, row], omitted_modules: omitted,
      status: omitted.length ? "partial" : "complete" };
    if (encoder.encode(JSON.stringify(candidate)).byteLength <= NATIVE_CAPABILITIES_MAX_BYTES)
      packet = candidate;
  }
  return packet;
}


export type NativeStudyContext = {
  schema: "chart.native_study_context.v1";
  scope: "configured_native_modules";
  status: "complete" | "partial";
  settings_source: "session.indicators";
  qualifications: {
    configuration_is_not_observation: true;
    output_health: "unknown";
    entitlement: "renderer_enforced_not_attested";
    guide_is_not_validated_edge: true;
  };
  modules: Array<{ id: string; suite: string; module: string; enabled: boolean; guide_available: boolean }>;
  omitted_modules: string[];
};
export const NATIVE_STUDY_CONTEXT_MAX_BYTES = 4096;

/** Compact identity projection, independent of the larger parameter-schema budget.
 * Uses the existing suite and guide registries; never computes or copies an indicator.
 * An enabled setting describes configuration, not output, entitlement or warmup health.
 */
export function describeNativeStudyContext(
  indicators: readonly string[],
  settings: Record<string, Record<string, unknown>> = {},
): NativeStudyContext | null {
  const active = new Set(indicators);
  const modules: NativeStudyContext["modules"] = [];
  for (const key of SUITE_ORDER) {
    if (!active.has(key)) continue;
    const suite = getSuiteMeta(key)!;
    for (const module of suite.modules) {
      modules.push({
        id: `${key}/${module.key}`, suite: key, module: module.key,
        enabled: (settings[key]?.[`${module.key}.on`] ?? module.defaultOn) !== false,
        guide_available: hasGuide(key, module.key),
      });
    }
  }
  if (!modules.length) return null;
  modules.sort((a, b) => Number(b.enabled) - Number(a.enabled));
  let packet: NativeStudyContext = {
    schema: "chart.native_study_context.v1", scope: "configured_native_modules",
    status: "partial", settings_source: "session.indicators",
    qualifications: {
      configuration_is_not_observation: true, output_health: "unknown",
      entitlement: "renderer_enforced_not_attested", guide_is_not_validated_edge: true,
    },
    modules: [], omitted_modules: modules.map(module => module.id),
  };
  const encoder = new TextEncoder();
  for (const module of modules) {
    const omitted = packet.omitted_modules.filter(id => id !== module.id);
    const next: NativeStudyContext = { ...packet, modules: [...packet.modules, module],
      omitted_modules: omitted, status: omitted.length ? "partial" : "complete" };
    if (encoder.encode(JSON.stringify(next)).byteLength <= NATIVE_STUDY_CONTEXT_MAX_BYTES)
      packet = next;
  }
  return packet;
}

/** Requested built-in edits share the settings dialog's IND_DEFS, not the tolerant
 * persisted-state reader. A typo must fail instead of surviving as an ignored key.
 */
function validBuiltinColor(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 80) return false;
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) return true;
  const match = /^(rgb|rgba)\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(\d+(?:\.\d+)?|\.\d+))?\s*\)$/i.exec(value);
  return !!match && [match[2], match[3], match[4]].every(channel => Number(channel) <= 255)
    && (match[1].toLowerCase() === "rgba" ? match[5] !== undefined && Number(match[5]) <= 1 : match[5] === undefined);
}
function validBuiltinField(field: IndField, value: unknown): value is IndicatorParam {
  if (field.type === "color") return validBuiltinColor(value);
  return validField(field, value);
}
export function readBuiltinIndicatorParams(name: string, value: unknown): NativeParamsResult {
  const type = studyTypeOf(name);
  if (!type || !isSupportedStudyId(name)) return { ok: false, error: "unknown_indicator" };
  if (value === undefined) return { ok: true };
  if (value === null || typeof value !== "object" || Array.isArray(value)
      || ![null, Object.prototype].includes(Object.getPrototypeOf(value)))
    return { ok: false, error: "bad_indicator_params" };
  const out: Record<string, IndicatorParam> = {};
  for (const key of Object.keys(value)) {
    const field = IND_DEFS[type].fields.find(candidate => candidate.key === key);
    if (!field) return { ok: false, error: "unknown_indicator_setting" };
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) return { ok: false, error: "bad_indicator_params" };
    if (!validBuiltinField(field, descriptor.value)) return { ok: false, error: "invalid_indicator_setting" };
    out[key] = descriptor.value;
  }
  return { ok: true, params: Object.keys(out).length ? out : undefined };
}

type BuiltinParameterSchema = NativeParameterSchema & { format?: "hex_or_rgb_color" };
export type BuiltinIndicatorCapabilities = {
  schema: "chart.builtin_parameters.v1";
  authority: "configuration_description_only";
  scope: "active_builtin_studies";
  status: "complete" | "partial";
  semantics: {
    parameters: "merge_existing";
    numeric_step: "ui_increment_not_constraint";
    instance_edits: "existing_attached_ids_only";
    missing_schema: "enable_then_read_chart_state";
  };
  instances: Array<{ name: string; type: IndKey }>;
  types: Array<{ name: IndKey; label: string; additional_parameters: false;
    parameters: Record<string, BuiltinParameterSchema>; unsupported_parameters: string[] }>;
  omitted_types: IndKey[];
};
export const BUILTIN_CAPABILITIES_MAX_BYTES = 4096;

/** One metadata description per type; multiple RSIs retain distinct existing ids.
 * This does not create a study, compute values, or attest output/entitlement.
 */
export function describeBuiltinIndicatorCapabilities(indicators: readonly string[]): BuiltinIndicatorCapabilities | null {
  const instances = readStudyStack({ inds: indicators, indParams: {}, hidden: [] }).instances;
  if (!instances.length) return null;
  const types = [...new Set(instances.map(instance => instance.type))];
  let packet: BuiltinIndicatorCapabilities = {
    schema: "chart.builtin_parameters.v1", authority: "configuration_description_only",
    scope: "active_builtin_studies", status: "partial",
    semantics: { parameters: "merge_existing", numeric_step: "ui_increment_not_constraint",
      instance_edits: "existing_attached_ids_only", missing_schema: "enable_then_read_chart_state" },
    instances: instances.map(({ id, type }) => ({ name: id, type })),
    types: [], omitted_types: types,
  };
  const encoder = new TextEncoder();
  for (const type of types) {
    const definition = IND_DEFS[type];
    const parameters: Record<string, BuiltinParameterSchema> = {};
    const unsupported: string[] = [];
    for (const field of definition.fields) {
      const value: unknown = definition.defaults[field.key];
      if (!validBuiltinField(field, value)) { unsupported.push(field.key); continue; }
      if (field.type === "color") parameters[field.key] = { type: "string", default: value, format: "hex_or_rgb_color" };
      else parameters[field.key] = describeField(field, value)!;
    }
    const omitted = packet.omitted_types.filter(name => name !== type);
    const next: BuiltinIndicatorCapabilities = { ...packet,
      types: [...packet.types, { name: type, label: definition.label,
        additional_parameters: false, parameters, unsupported_parameters: unsupported }],
      omitted_types: omitted, status: omitted.length ? "partial" : "complete" };
    if (encoder.encode(JSON.stringify(next)).byteLength <= BUILTIN_CAPABILITIES_MAX_BYTES) packet = next;
  }
  return packet;
}
