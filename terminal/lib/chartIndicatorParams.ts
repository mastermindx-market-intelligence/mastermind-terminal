/** Metadata-only native parameter validation for the existing Chart Bus.
 * No runtime imports, second catalogue, indicator maths, or entitlement decisions.
 */
import { getSuiteMeta } from "./suites/meta";
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
