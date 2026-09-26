/** Metadata-only native parameter validation for the existing Chart Bus.
 * No runtime imports, second catalogue, indicator maths, or entitlement decisions.
 */
import { getSuiteMeta, SUITE_ORDER } from "./suites/meta";
import type { SuiteField } from "./indicator-canvas/types";

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
