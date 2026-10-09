/**
 * Pure mounted-session semantic context contract for Intelligence Workspace 2.0 P2.
 *
 * This is not a persistence owner, bus, identity registry, permission layer, clock, or
 * Brain store. It computes one accepted in-memory group generation plus receipt; hosts
 * decide how to deliver returned values through existing Chart/Brain/replay owners.
 */
export const SEMANTIC_CONTEXT_GROUP_SCHEMA = "semantic_context_group.v1" as const;
export const SEMANTIC_CONTEXT_DELTA_SCHEMA = "semantic_context_delta.v1" as const;

export const SEMANTIC_CONTEXT_KINDS = [
  "entity_selection",
  "entity_set",
  "time_horizon",
  "historical_cutoff",
  "scenario_selection",
] as const;
export type SemanticContextKind = (typeof SEMANTIC_CONTEXT_KINDS)[number];

export const SEMANTIC_TEMPORAL_CAPABILITIES = [
  "live",
  "recorded_snapshot",
  "as_known",
  "revised_period_history",
  "scenario",
] as const;
export type SemanticTemporalCapability = (typeof SEMANTIC_TEMPORAL_CAPABILITIES)[number];

export type SemanticContextRef = {
  owner: string;
  kind?: string;
  object_id: string;
  version_ref?: string;
};

export type SemanticContextValue =
  | { kind: "entity_selection"; ref: SemanticContextRef }
  | { kind: "entity_set"; refs: SemanticContextRef[] }
  | { kind: "time_horizon"; horizon: string }
  | {
      kind: "historical_cutoff";
      policy: "recorded_snapshot" | "as_known" | "revised_period_history";
      cutoff: string;
    }
  | {
      kind: "scenario_selection";
      ref: { owner: string; object_id: string; version_ref: string };
    };

/** Port-declared owner/kind routing support; never authentication or entitlement. */
export type SemanticPortReferenceSupport = {
  owner: string;
  kinds: string[];
};

export type SemanticContextPort = {
  port_id: string;
  origin_id: string;
  direction: "emit" | "consume" | "both";
  mode: "linked" | "pinned" | "local";
  accepts: SemanticContextKind[];
  /** Required for reference-bearing kinds; no implicit source→target coercion. */
  ref_accepts?: SemanticPortReferenceSupport[];
  adapter_id?: string;
  temporal_capabilities: SemanticTemporalCapability[];
};

export type SemanticContextGroup = {
  schema: typeof SEMANTIC_CONTEXT_GROUP_SCHEMA;
  session_epoch: string;
  group_id: string;
  revision: number;
  kind: SemanticContextKind;
  label: string;
  value: SemanticContextValue;
  ports: SemanticContextPort[];
};

export type SemanticContextDelta = {
  schema: typeof SEMANTIC_CONTEXT_DELTA_SCHEMA;
  session_epoch: string;
  group_id: string;
  base_revision: number;
  mutation_id: string;
  origin_id: string;
  patch: SemanticContextValue;
  cause: "user_action" | "explicit_restore";
};

export type SemanticContextTransformAdapter = {
  adapter_id: string;
  from_kind: SemanticContextKind;
  to_kind: SemanticContextKind;
  project: (
    value: SemanticContextValue,
  ) =>
    | { ok: true; value: SemanticContextValue }
    | { ok: false; reason: string };
};

export type SemanticContextValidationError = { path: string; code: string };
export type SemanticContextValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: SemanticContextValidationError[] };

const KIND_SET = new Set<string>(SEMANTIC_CONTEXT_KINDS);
const TEMPORAL_SET = new Set<string>(SEMANTIC_TEMPORAL_CAPABILITIES);
const SUBJECT_KINDS = new Set([
  "security", "issuer", "industry", "subtheme", "theme", "regime", "economy",
  "event", "portfolio", "option_underlying", "option_contract", "policy_question",
]);
const PORT_REF_KINDS = new Set([...SUBJECT_KINDS, "scenario"]);
const REFERENCE_KINDS = new Set<SemanticContextKind>([
  "entity_selection", "entity_set", "scenario_selection",
]);
const MAX_REFERENCE_SUPPORTS = 16;
const OPAQUE_64 = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const OPAQUE_128 = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const OWNER = /^[a-z][a-z0-9_.-]{0,63}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const MAX_REVISION = 2_147_483_646;
const MAX_PORTS = 64;
const MAX_SET_REFS = 16;

type Obj = Record<string, unknown>;

function isPlainRecord(value: unknown): value is Obj {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  } catch {
    return false;
  }
}

function exactKeys(value: Obj, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  const ownNames = Object.getOwnPropertyNames(value);
  return Object.getOwnPropertySymbols(value).length === 0
    && required.every(key => Object.hasOwn(value, key))
    && ownNames.every(key => allowed.has(key));
}

function plainArray(value: unknown, max: number): value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max) return false;
  if (Object.getOwnPropertySymbols(value).length !== 0) return false;
  if (!Object.getOwnPropertyNames(value).every(name =>
    name === "length" || (/^(?:0|[1-9][0-9]*)$/.test(name) && Number(name) < value.length)
  )) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}

function safeRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= MAX_REVISION;
}

function text(value: unknown, max: number, singleLine = false): value is string {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  let count = 0;
  for (const char of value) {
    const point = char.codePointAt(0)!;
    if (point >= 0xd800 && point <= 0xdfff) return false;
    if (++count > max) return false;
  }
  return !CONTROL.test(value) && (!singleLine || !/[\r\n\t]/.test(value));
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function validOwner(value: unknown): value is string {
  return typeof value === "string" && OWNER.test(value);
}

function validObjectId(value: unknown): value is string {
  return text(value, 256, true);
}

function validateRef(
  raw: unknown,
  path: string,
  errors: SemanticContextValidationError[],
): SemanticContextRef | null {
  if (!isPlainRecord(raw) || !exactKeys(raw, ["owner", "object_id"], ["kind", "version_ref"])) {
    errors.push({ path, code: "invalid_reference" });
    return null;
  }
  if (!validOwner(raw.owner) || !validObjectId(raw.object_id)
      || (Object.hasOwn(raw, "kind") && (typeof raw.kind !== "string" || !SUBJECT_KINDS.has(raw.kind)))
      || (Object.hasOwn(raw, "version_ref") && !text(raw.version_ref, 256, true))) {
    errors.push({ path, code: "invalid_reference" });
    return null;
  }
  return cloneJson(raw) as SemanticContextRef;
}

function refIdentity(ref: SemanticContextRef): string {
  return JSON.stringify([ref.owner, ref.kind ?? null, ref.object_id, ref.version_ref ?? null]);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function validRfc3339(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[10] === undefined ? 0 : Number(match[10]);
  const offsetMinute = match[11] === undefined ? 0 : Number(match[11]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)
      || hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) return false;
  return Number.isFinite(Date.parse(value));
}

function validateSemanticContextValueUnsafe(
  raw: unknown,
  path = "$",
): SemanticContextValidationResult<SemanticContextValue> {
  const fail = (code: string): SemanticContextValidationResult<SemanticContextValue> => ({
    ok: false,
    errors: [{ path, code }],
  });
  if (!isPlainRecord(raw) || typeof raw.kind !== "string" || !KIND_SET.has(raw.kind)) {
    return fail("invalid_kind");
  }

  if (raw.kind === "entity_selection") {
    if (!exactKeys(raw, ["kind", "ref"])) return fail("unknown_field");
    const errors: SemanticContextValidationError[] = [];
    const ref = validateRef(raw.ref, path + ".ref", errors);
    return ref && !errors.length
      ? { ok: true, value: { kind: "entity_selection", ref } }
      : { ok: false, errors };
  }

  if (raw.kind === "entity_set") {
    if (!exactKeys(raw, ["kind", "refs"]) || !plainArray(raw.refs, MAX_SET_REFS)
        || raw.refs.length === 0) return fail("invalid_entity_set");
    const refs: SemanticContextRef[] = [];
    const errors: SemanticContextValidationError[] = [];
    const seen = new Set<string>();
    for (let index = 0; index < raw.refs.length; index += 1) {
      const ref = validateRef(raw.refs[index], path + ".refs[" + index + "]", errors);
      if (!ref) continue;
      const identity = refIdentity(ref);
      if (seen.has(identity)) errors.push({ path: path + ".refs[" + index + "]", code: "duplicate_reference" });
      seen.add(identity);
      refs.push(ref);
    }
    return errors.length ? { ok: false, errors } : { ok: true, value: { kind: "entity_set", refs } };
  }

  if (raw.kind === "time_horizon") {
    return exactKeys(raw, ["kind", "horizon"]) && text(raw.horizon, 64, true)
      ? { ok: true, value: { kind: "time_horizon", horizon: raw.horizon } }
      : fail("invalid_horizon");
  }

  if (raw.kind === "historical_cutoff") {
    const policies = new Set(["recorded_snapshot", "as_known", "revised_period_history"]);
    return exactKeys(raw, ["kind", "policy", "cutoff"])
      && typeof raw.policy === "string" && policies.has(raw.policy)
      && validRfc3339(raw.cutoff)
      ? {
          ok: true,
          value: {
            kind: "historical_cutoff",
            policy: raw.policy as "recorded_snapshot" | "as_known" | "revised_period_history",
            cutoff: raw.cutoff,
          },
        }
      : fail("invalid_historical_cutoff");
  }

  if (!exactKeys(raw, ["kind", "ref"]) || !isPlainRecord(raw.ref)
      || !exactKeys(raw.ref, ["owner", "object_id", "version_ref"])
      || !validOwner(raw.ref.owner) || !validObjectId(raw.ref.object_id)
      || !text(raw.ref.version_ref, 256, true)) return fail("invalid_scenario_reference");

  return {
    ok: true,
    value: {
      kind: "scenario_selection",
      ref: {
        owner: raw.ref.owner,
        object_id: raw.ref.object_id,
        version_ref: raw.ref.version_ref,
      },
    },
  };
}

export function validateSemanticContextValue(
  raw: unknown,
  path = "$",
): SemanticContextValidationResult<SemanticContextValue> {
  try {
    return validateSemanticContextValueUnsafe(raw, path);
  } catch {
    return { ok: false, errors: [{ path, code: "invalid_value" }] };
  }
}

function validatePortReferenceSupport(raw: unknown): SemanticPortReferenceSupport[] | null {
  if (!plainArray(raw, MAX_REFERENCE_SUPPORTS) || raw.length === 0) return null;
  const owners = new Set<string>();
  const supports: SemanticPortReferenceSupport[] = [];
  for (const entry of raw) {
    if (!isPlainRecord(entry) || !exactKeys(entry, ["owner", "kinds"])
        || !validOwner(entry.owner)
        || !plainArray(entry.kinds, PORT_REF_KINDS.size) || entry.kinds.length === 0
        || entry.kinds.some(kind => typeof kind !== "string" || !PORT_REF_KINDS.has(kind))
        || new Set(entry.kinds).size !== entry.kinds.length
        || owners.has(entry.owner)) return null;
    owners.add(entry.owner);
    supports.push({ owner: entry.owner, kinds: [...entry.kinds] as string[] });
  }
  return supports;
}

/** Routing compatibility only. Rights/identity are always evaluated by existing owners. */
function portSupportsValue(port: SemanticContextPort, value: SemanticContextValue): boolean {
  if (value.kind === "time_horizon" || value.kind === "historical_cutoff") return true;
  const refs = value.kind === "entity_selection"
    ? [value.ref]
    : value.kind === "entity_set"
      ? value.refs
      : [{ owner: value.ref.owner, kind: "scenario" }];
  return refs.every(ref =>
    !!ref.kind && (port.ref_accepts ?? []).some(
      support => support.owner === ref.owner && support.kinds.includes(ref.kind!),
    ),
  );
}

function validatePort(raw: unknown, path: string): SemanticContextValidationResult<SemanticContextPort> {
  const required = ["port_id", "origin_id", "direction", "mode", "accepts", "temporal_capabilities"];
  if (!isPlainRecord(raw) || !exactKeys(raw, required, ["adapter_id", "ref_accepts"])) {
    return { ok: false, errors: [{ path, code: "invalid_port" }] };
  }
  const directions = new Set(["emit", "consume", "both"]);
  const modes = new Set(["linked", "pinned", "local"]);
  if (typeof raw.port_id !== "string" || !OPAQUE_128.test(raw.port_id)
      || typeof raw.origin_id !== "string" || !OPAQUE_64.test(raw.origin_id)
      || typeof raw.direction !== "string" || !directions.has(raw.direction)
      || typeof raw.mode !== "string" || !modes.has(raw.mode)
      || !plainArray(raw.accepts, SEMANTIC_CONTEXT_KINDS.length) || raw.accepts.length < 1
      || raw.accepts.some(value => typeof value !== "string" || !KIND_SET.has(value))
      || new Set(raw.accepts).size !== raw.accepts.length
      || !plainArray(raw.temporal_capabilities, SEMANTIC_TEMPORAL_CAPABILITIES.length)
      || raw.temporal_capabilities.some(value => typeof value !== "string" || !TEMPORAL_SET.has(value))
      || new Set(raw.temporal_capabilities).size !== raw.temporal_capabilities.length
      || (Object.hasOwn(raw, "adapter_id") && (typeof raw.adapter_id !== "string" || !OPAQUE_128.test(raw.adapter_id)))) {
    return { ok: false, errors: [{ path, code: "invalid_port" }] };
  }
  const needsReferenceSupport = (raw.accepts as SemanticContextKind[]).some(kind => REFERENCE_KINDS.has(kind));
  const hasReferenceSupport = Object.hasOwn(raw, "ref_accepts");
  const referenceSupport = hasReferenceSupport ? validatePortReferenceSupport(raw.ref_accepts) : undefined;
  if (needsReferenceSupport !== hasReferenceSupport || (hasReferenceSupport && !referenceSupport)) {
    return { ok: false, errors: [{ path, code: "invalid_reference_support" }] };
  }
  return {
    ok: true,
    value: {
      port_id: raw.port_id as string,
      origin_id: raw.origin_id as string,
      direction: raw.direction as SemanticContextPort["direction"],
      mode: raw.mode as SemanticContextPort["mode"],
      accepts: [...raw.accepts] as SemanticContextKind[],
      ...(referenceSupport ? { ref_accepts: referenceSupport } : {}),
      ...(Object.hasOwn(raw, "adapter_id") ? { adapter_id: raw.adapter_id as string } : {}),
      temporal_capabilities: [...raw.temporal_capabilities] as SemanticTemporalCapability[],
    },
  };
}

export function validateSemanticContextGroup(
  raw: unknown,
): SemanticContextValidationResult<SemanticContextGroup> {
  try {
    if (!isPlainRecord(raw)
        || !exactKeys(raw, ["schema", "session_epoch", "group_id", "revision", "kind", "label", "value", "ports"])
        || raw.schema !== SEMANTIC_CONTEXT_GROUP_SCHEMA
        || typeof raw.session_epoch !== "string" || !OPAQUE_64.test(raw.session_epoch)
        || typeof raw.group_id !== "string" || !OPAQUE_64.test(raw.group_id)
        || !safeRevision(raw.revision)
        || typeof raw.kind !== "string" || !KIND_SET.has(raw.kind)
        || !text(raw.label, 120)
        || !plainArray(raw.ports, MAX_PORTS) || raw.ports.length < 1) {
      return { ok: false, errors: [{ path: "$", code: "invalid_group" }] };
    }

    const value = validateSemanticContextValue(raw.value, "$.value");
    if (!value.ok || value.value.kind !== raw.kind) {
      return value.ok
        ? { ok: false, errors: [{ path: "$.value.kind", code: "kind_mismatch" }] }
        : value;
    }

    const ports: SemanticContextPort[] = [];
    const seen = new Set<string>();
    const emittingOrigins = new Set<string>();
    for (let index = 0; index < raw.ports.length; index += 1) {
      const parsed = validatePort(raw.ports[index], "$.ports[" + index + "]");
      if (!parsed.ok) return parsed;
      if (seen.has(parsed.value.port_id)) {
        return { ok: false, errors: [{ path: "$.ports[" + index + "].port_id", code: "duplicate_port" }] };
      }
      seen.add(parsed.value.port_id);
      if (parsed.value.mode === "linked"
          && (parsed.value.direction === "emit" || parsed.value.direction === "both")) {
        if (emittingOrigins.has(parsed.value.origin_id)) {
          return { ok: false, errors: [{ path: "$.ports[" + index + "].origin_id", code: "ambiguous_emitter_origin" }] };
        }
        emittingOrigins.add(parsed.value.origin_id);
      }
      ports.push(parsed.value);
    }
    // At least one linked emitter must be able to represent an initial owner ref
    // when the group actually declares an emitter for this dimension.
    const emittingPorts = ports.filter(port => port.mode === "linked"
      && (port.direction === "emit" || port.direction === "both")
      && port.accepts.includes(value.value.kind));
    if (emittingPorts.length && !emittingPorts.some(port => portSupportsValue(port, value.value))) {
      return { ok: false, errors: [{ path: "$.value", code: "emitter_reference_incompatible" }] };
    }

    return {
      ok: true,
      value: {
        schema: SEMANTIC_CONTEXT_GROUP_SCHEMA,
        session_epoch: raw.session_epoch,
        group_id: raw.group_id,
        revision: raw.revision,
        kind: raw.kind as SemanticContextKind,
        label: raw.label,
        value: value.value,
        ports,
      },
    };
  } catch {
    return { ok: false, errors: [{ path: "$", code: "invalid_group" }] };
  }
}

export function validateSemanticContextDelta(
  raw: unknown,
): SemanticContextValidationResult<SemanticContextDelta> {
  try {
    if (!isPlainRecord(raw)
        || !exactKeys(raw, ["schema", "session_epoch", "group_id", "base_revision", "mutation_id", "origin_id", "patch", "cause"])
        || raw.schema !== SEMANTIC_CONTEXT_DELTA_SCHEMA
        || typeof raw.session_epoch !== "string" || !OPAQUE_64.test(raw.session_epoch)
        || typeof raw.group_id !== "string" || !OPAQUE_64.test(raw.group_id)
        || !safeRevision(raw.base_revision)
        || typeof raw.mutation_id !== "string" || !OPAQUE_64.test(raw.mutation_id)
        || typeof raw.origin_id !== "string" || !OPAQUE_64.test(raw.origin_id)
        || (raw.cause !== "user_action" && raw.cause !== "explicit_restore")) {
      return { ok: false, errors: [{ path: "$", code: "invalid_delta" }] };
    }
    const patch = validateSemanticContextValue(raw.patch, "$.patch");
    if (!patch.ok) return patch;
    return {
      ok: true,
      value: {
        schema: SEMANTIC_CONTEXT_DELTA_SCHEMA,
        session_epoch: raw.session_epoch,
        group_id: raw.group_id,
        base_revision: raw.base_revision,
        mutation_id: raw.mutation_id,
        origin_id: raw.origin_id,
        patch: patch.value,
        cause: raw.cause,
      },
    };
  } catch {
    return { ok: false, errors: [{ path: "$", code: "invalid_delta" }] };
  }
}

function requestedTemporal(value: SemanticContextValue): SemanticTemporalCapability | null {
  if (value.kind === "historical_cutoff") return value.policy;
  if (value.kind === "scenario_selection") return "scenario";
  return null;
}

/**
 * P2 / #802 integration: these functions are pure adapters for the existing mounted
 * WorkspaceContextSession. They DO NOT create a session, own revisions, retain
 * mutation IDs, notify listeners, or confer evidence/identity/rights authority.
 */
import type {
  ContextFrame,
  ContextGroup,
  ContextValue,
  WorkspaceContextSession,
} from "./workspaceContextSession";
import { normalizeAnalysisSymbol } from "./analysisSymbol";

type NativeSemanticResult<T> = { ok: true; value: T } | { ok: false; reason: string };

function nativeScalarValue(value: Record<string, unknown>): value is ContextValue {
  const keys = Object.keys(value);
  return keys.length > 0 && keys.length <= 16 &&
    keys.every((key) => /^[A-Za-z0-9_-]{1,64}$/.test(key) && (
      value[key] === null || typeof value[key] === "boolean" ||
      (typeof value[key] === "string" && (value[key] as string).length <= 512) ||
      (typeof value[key] === "number" && Number.isSafeInteger(value[key]))
    ));
}

export function encodeNativeSemanticValue(raw: unknown): NativeSemanticResult<ContextValue> {
  const checked = validateSemanticContextValue(raw);
  if (!checked.ok) return { ok: false, reason: "invalid_semantic_value" };
  const value = checked.value;
  let flat: Record<string, unknown>;
  switch (value.kind) {
    case "entity_selection":
      flat = { kind: value.kind, owner: value.ref.owner, object_id: value.ref.object_id };
      if (value.ref.kind !== undefined) flat.ref_kind = value.ref.kind;
      if (value.ref.version_ref !== undefined) flat.version_ref = value.ref.version_ref;
      break;
    case "entity_set":
      flat = { kind: value.kind, refs_json: JSON.stringify(value.refs) };
      break;
    case "time_horizon":
      flat = { kind: value.kind, horizon: value.horizon };
      break;
    case "historical_cutoff":
      flat = { kind: value.kind, policy: value.policy, cutoff: value.cutoff };
      break;
    case "scenario_selection":
      flat = { kind: value.kind, owner: value.ref.owner, object_id: value.ref.object_id, version_ref: value.ref.version_ref };
      break;
    default:
      return { ok: false, reason: "native_kind_unsupported" };
  }
  if (!nativeScalarValue(flat)) return { ok: false, reason: "native_capacity_exceeded" };
  return { ok: true, value: flat };
}

export function decodeNativeSemanticValue(raw: unknown): SemanticContextValidationResult<SemanticContextValue> {
  const fail = (): SemanticContextValidationResult<SemanticContextValue> => ({
    ok: false, errors: [{ path: "$", code: "invalid_native_semantic_value" }],
  });
  try {
    if (!isPlainRecord(raw) || typeof raw.kind !== "string") return fail();
    const hasKeys = (required: string[], optional: string[] = []) => exactKeys(raw, required, optional);
    let value: unknown;
    switch (raw.kind) {
      case "entity_selection":
        if (!hasKeys(["kind", "owner", "object_id"], ["ref_kind", "version_ref"])) return fail();
        value = { kind: "entity_selection",
          ref: { owner: raw.owner, object_id: raw.object_id,
            ...(Object.hasOwn(raw, "ref_kind") ? { kind: raw.ref_kind } : {}),
            ...(Object.hasOwn(raw, "version_ref") ? { version_ref: raw.version_ref } : {}),
          },
        };
        break;
      case "entity_set": {
        if (!hasKeys(["kind", "refs_json"]) || typeof raw.refs_json !== "string") return fail();
        const refs: unknown = JSON.parse(raw.refs_json);
        if (JSON.stringify(refs) !== raw.refs_json) return fail();
        value = { kind: "entity_set", refs };
        break;
      }
      case "time_horizon":
        if (!hasKeys(["kind", "horizon"])) return fail();
        value = { kind: "time_horizon", horizon: raw.horizon };
        break;
      case "historical_cutoff":
        if (!hasKeys(["kind", "policy", "cutoff"])) return fail();
        value = { kind: "historical_cutoff", policy: raw.policy, cutoff: raw.cutoff };
        break;
      case "scenario_selection":
        if (!hasKeys(["kind", "owner", "object_id", "version_ref"])) return fail();
        value = { kind: "scenario_selection",
          ref: { owner: raw.owner, object_id: raw.object_id, version_ref: raw.version_ref },
        };
        break;
      default:
        return fail();
    }
    return validateSemanticContextValue(value);
  } catch {
    return fail();
  }
}

/** Existing #802 Chart Bus value shape is {kind:'security', id, timeframe, pane_id}. */
function readNativeActiveSecurity(value: unknown): SemanticContextValidationResult<SemanticContextValue> {
  const fail = (): SemanticContextValidationResult<SemanticContextValue> => ({
    ok:false, errors:[{path:"$",code:"native_chart_context_invalid"}],
  });
  try {
    if (!isPlainRecord(value) || !exactKeys(value,["kind","id","timeframe","pane_id"])
        || value.kind !== "security"
        || typeof value.id !== "string"
        || normalizeAnalysisSymbol(value.id) !== value.id
        || !text(value.timeframe, 32, true)
        || !Number.isSafeInteger(value.pane_id) || Number(value.pane_id) < 0) return fail();
    return validateSemanticContextValue({
      kind:"entity_selection",
      ref:{owner:"terminal.analysis_symbol",kind:"security",object_id:value.id},
    });
  } catch { return fail(); }
}

function writeNativeActiveSecurity(
  semantic: SemanticContextValue,
  prior: ContextValue,
): NativeSemanticResult<ContextValue> {
  if (!readNativeActiveSecurity(prior).ok
      || semantic.kind !== "entity_selection"
      || semantic.ref.owner !== "terminal.analysis_symbol"
      || semantic.ref.kind !== "security"
      || normalizeAnalysisSymbol(semantic.ref.object_id) !== semantic.ref.object_id) {
    return {ok:false,reason:"native_chart_context_invalid"};
  }
  // The chart's existing timeframe and pane are native owner values. Never
  // default, normalize, or replace them as a side effect of changing a symbol.
  return {ok:true,value:{
    kind:"security",
    id:semantic.ref.object_id,
    timeframe:prior.timeframe!,
    pane_id:prior.pane_id!,
  }};
}

function nativeSafeId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(value)
    && value !== "constructor" && value !== "prototype" && value !== "__proto__";
}

/**
 * A typed declaration for a NEW dimension within #802's existing session.
 * Do not use it to mount a second "active_security": that group is already
 * native-owned by useChartBus, and must be adapted via prepare/project below.
 */
export function nativeGroupFromSemanticDeclaration(raw: unknown): NativeSemanticResult<ContextGroup> {
  const parsed = validateSemanticContextGroup(raw);
  if (!parsed.ok) return { ok: false, reason: "invalid_semantic_declaration" };
  const group = parsed.value;
  if (!nativeSafeId(group.session_epoch) || !nativeSafeId(group.group_id)
      || group.ports.some(port => !nativeSafeId(port.port_id))) {
    return { ok: false, reason: "native_identifier_unsupported" };
  }
  if (group.revision !== 0) return { ok: false, reason: "native_history_not_importable" };
  const first = encodeNativeSemanticValue(group.value);
  if (!first.ok) return first;
  const emitters = group.ports.filter(
    p => p.mode === "linked" && (p.direction === "emit" || p.direction === "both")
  );
  // #802's native accepts(value) knows the group, not the emitting port.
  // Mixed emitter permissions would let one origin publish another origin's
  // reference or temporal capability. Refuse until the native owner can
  // enforce per-origin validation; do not create a second permission plane.
  if (emitters.length === 0) return { ok: false, reason: "native_no_emitter" };
  const supportIdentity = (p: SemanticContextPort) => JSON.stringify({
    kinds: [...p.accepts].sort(),
    temporal: [...p.temporal_capabilities].sort(),
    refs: (p.ref_accepts ?? []).map(r => ({
      owner: r.owner, kinds: [...r.kinds].sort(),
    })).sort((a, b) => a.owner.localeCompare(b.owner)),
  });
  if (emitters.some(p => supportIdentity(p) !== supportIdentity(emitters[0]))) {
    return { ok: false, reason: "native_emitter_support_conflict" };
  }
  return { ok: true, value: {
    id: group.group_id,
    initial: first.value,
    accepts(nativeValue: ContextValue) {
      const decoded = decodeNativeSemanticValue(nativeValue);
      if (!decoded.ok || decoded.value.kind !== group.kind) return false;
      return emitters.some(p => p.accepts.includes(decoded.value.kind)
        && portSupportsValue(p, decoded.value)
        && (!requestedTemporal(decoded.value) || p.temporal_capabilities.includes(requestedTemporal(decoded.value)!)));
    },
  } };
}

export function prepareNativeSemanticFrame(
  session: WorkspaceContextSession,
  rawGroup: unknown,
  portId: string,
  rawDelta: unknown,
  sequence: number,
): NativeSemanticResult<ContextFrame> {
  const groupResult = validateSemanticContextGroup(rawGroup);
  const deltaResult = validateSemanticContextDelta(rawDelta);
  if (!groupResult.ok || !deltaResult.ok) return { ok: false, reason: "invalid_semantic_delta" };
  const group = groupResult.value, delta = deltaResult.value;
  const port = group.ports.find(p => p.port_id === portId);
  const native = session.snapshot(portId);
  if (!native || !port) return { ok: false, reason: "port_unavailable" };
  if (native.epoch !== group.session_epoch || delta.session_epoch !== native.epoch ||
      native.group !== group.group_id || delta.group_id !== native.group) {
    return { ok: false, reason: "session_group_mismatch" };
  }
  if (native.group_revision !== delta.base_revision) return { ok: false, reason: "stale_group_revision" };
  if (native.mode !== "follow" || port.mode !== "linked"
      || (port.direction !== "both" && port.direction !== "emit")
      || port.origin_id !== delta.origin_id) {
    return { ok: false, reason: "origin_not_emitter" };
  }
  if (delta.patch.kind !== group.kind || !port.accepts.includes(delta.patch.kind)
      || !portSupportsValue(port, delta.patch)) {
    return { ok: false, reason: "reference_incompatible" };
  }
  const temporal = requestedTemporal(delta.patch);
  if (temporal && !port.temporal_capabilities.includes(temporal)) {
    return { ok: false, reason: "temporal_incompatible" };
  }
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    return { ok: false, reason: "invalid_native_sequence" };
  }
  const encoded = native.value.kind === "security"
    ? writeNativeActiveSecurity(delta.patch, native.value)
    : encodeNativeSemanticValue(delta.patch);
  if (!encoded.ok) return encoded;
  return { ok: true, value: {
    epoch: native.epoch,
    origin: native.consumer,
    origin_generation: native.incarnation,
    sequence,
    value: encoded.value,
  } };
}

type SemanticPortRead =
  | { status: "qualified"; value: SemanticContextValue }
  | { status: "unsupported"; reason: string };

export function projectNativeSemanticPort(
  session: WorkspaceContextSession,
  rawGroup: unknown,
  portId: string,
  adapters: readonly SemanticContextTransformAdapter[] = [],
): SemanticPortRead {
  const g = validateSemanticContextGroup(rawGroup);
  const native = session.snapshot(portId);
  if (!g.ok || !native || g.value.group_id !== native.group || g.value.session_epoch !== native.epoch) {
    return { status: "unsupported", reason: "port_unavailable" };
  }
  const port = g.value.ports.find(p => p.port_id === portId);
  if (!port) return { status: "unsupported", reason: "port_unavailable" };
  const source = native.value.kind === "security"
    ? readNativeActiveSecurity(native.value)
    : decodeNativeSemanticValue(native.value);
  if (!source.ok || source.value.kind !== g.value.kind) {
    return { status: "unsupported", reason: "native_value_unavailable" };
  }
  let projected: SemanticContextValue = source.value;
  if (!port.accepts.includes(projected.kind) || !portSupportsValue(port, projected)) {
    const adapter = port.adapter_id ? adapters.find(a => a.adapter_id === port.adapter_id) : undefined;
    if (!adapter || adapter.from_kind !== source.value.kind || !port.accepts.includes(adapter.to_kind)) {
      return { status: "unsupported", reason: "reference_incompatible" };
    }
    let candidate: ReturnType<SemanticContextTransformAdapter["project"]>;
    try {
      candidate = adapter.project(source.value);
    } catch {
      return { status: "unsupported", reason: "adapter_error" };
    }
    if (!candidate.ok) return { status: "unsupported", reason: candidate.reason };
    const checked = validateSemanticContextValue(candidate.value);
    if (!checked.ok || checked.value.kind !== adapter.to_kind) {
      return { status: "unsupported", reason: "invalid_adapter_output" };
    }
    projected = checked.value;
  }
  if (!port.accepts.includes(projected.kind) || !portSupportsValue(port, projected)) {
    return { status: "unsupported", reason: "reference_incompatible" };
  }
  const temporal = requestedTemporal(projected);
  if (temporal && !port.temporal_capabilities.includes(temporal)) {
    return { status: "unsupported", reason: "temporal_incompatible" };
  }
  return { status: "qualified", value: projected };
}
