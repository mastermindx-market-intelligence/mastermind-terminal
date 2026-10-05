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

export type SemanticContextPort = {
  port_id: string;
  origin_id: string;
  direction: "emit" | "consume" | "both";
  mode: "linked" | "pinned" | "local";
  accepts: SemanticContextKind[];
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

export type SemanticContextReceipt = {
  mutation_id: string;
  accepted_revision: number;
  applied_ports: string[];
  pinned_ports: string[];
  rejected_ports: Array<{ port_id: string; reason: string }>;
  collisions: Array<
    | { code: "stale_base"; expected: number; received: number }
    | { code: "epoch_mismatch" }
    | { code: "mutation_conflict" }
  >;
  missing_adapters: Array<{
    port_id: string;
    from_kind: SemanticContextKind;
    to_kinds: SemanticContextKind[];
    adapter_id?: string;
  }>;
  temporal_mismatches: Array<{
    port_id: string;
    requested: SemanticTemporalCapability;
    supported: SemanticTemporalCapability[];
  }>;
};

export type SemanticContextDelivery = {
  port_id: string;
  value: SemanticContextValue;
};

export type SemanticContextApplyResult =
  | {
      ok: true;
      replayed: boolean;
      changed: boolean;
      snapshot: SemanticContextGroup;
      receipt: SemanticContextReceipt;
      deliveries: SemanticContextDelivery[];
    }
  | {
      ok: false;
      code:
        | "invalid_delta"
        | "epoch_mismatch"
        | "group_mismatch"
        | "stale_base"
        | "mutation_conflict"
        | "origin_not_emitter"
        | "kind_mismatch"
        | "revision_exhausted";
      snapshot: SemanticContextGroup;
      receipt: SemanticContextReceipt;
    };

const KIND_SET = new Set<string>(SEMANTIC_CONTEXT_KINDS);
const TEMPORAL_SET = new Set<string>(SEMANTIC_TEMPORAL_CAPABILITIES);
const SUBJECT_KINDS = new Set([
  "security", "issuer", "industry", "subtheme", "theme", "regime", "economy",
  "event", "portfolio", "option_underlying", "option_contract", "policy_question",
]);
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

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => deepEqual(value, right[index]));
  }
  if (!isPlainRecord(left) || !isPlainRecord(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every(key => Object.hasOwn(right, key) && deepEqual(left[key], right[key]));
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

function validatePort(raw: unknown, path: string): SemanticContextValidationResult<SemanticContextPort> {
  const required = ["port_id", "origin_id", "direction", "mode", "accepts", "temporal_capabilities"];
  if (!isPlainRecord(raw) || !exactKeys(raw, required, ["adapter_id"])) {
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
  return {
    ok: true,
    value: {
      port_id: raw.port_id as string,
      origin_id: raw.origin_id as string,
      direction: raw.direction as SemanticContextPort["direction"],
      mode: raw.mode as SemanticContextPort["mode"],
      accepts: [...raw.accepts] as SemanticContextKind[],
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

function blankReceipt(mutationId: string, revision: number): SemanticContextReceipt {
  return {
    mutation_id: mutationId,
    accepted_revision: revision,
    applied_ports: [],
    pinned_ports: [],
    rejected_ports: [],
    collisions: [],
    missing_adapters: [],
    temporal_mismatches: [],
  };
}

function requestedTemporal(value: SemanticContextValue): SemanticTemporalCapability | null {
  if (value.kind === "historical_cutoff") return value.policy;
  if (value.kind === "scenario_selection") return "scenario";
  return null;
}

export function matchesSemanticContextGeneration(
  group: SemanticContextGroup,
  generation: { session_epoch: string; group_id: string; revision: number },
): boolean {
  return group.session_epoch === generation.session_epoch
    && group.group_id === generation.group_id
    && group.revision === generation.revision;
}

export function createSemanticContextCoordinator(
  initial: SemanticContextGroup,
  transformAdapters: readonly SemanticContextTransformAdapter[] = [],
) {
  const validated = validateSemanticContextGroup(initial);
  if (!validated.ok) throw new TypeError("invalid semantic context group");
  let group = cloneJson(validated.value);
  const adapters = new Map<string, SemanticContextTransformAdapter>();
  for (const adapter of transformAdapters) {
    if (!OPAQUE_128.test(adapter.adapter_id) || adapters.has(adapter.adapter_id)
        || !KIND_SET.has(adapter.from_kind) || !KIND_SET.has(adapter.to_kind)) {
      throw new TypeError("invalid semantic context adapter");
    }
    adapters.set(adapter.adapter_id, adapter);
  }
  const seen = new Map<string, { delta: SemanticContextDelta; receipt: SemanticContextReceipt }>();

  const snapshot = () => cloneJson(group);

  function fail(
    code: Extract<SemanticContextApplyResult, { ok: false }>["code"],
    mutationId = "",
    collisions: SemanticContextReceipt["collisions"] = [],
  ): SemanticContextApplyResult {
    const receipt = blankReceipt(mutationId, group.revision);
    receipt.collisions = collisions;
    return { ok: false, code, snapshot: snapshot(), receipt };
  }

  function apply(raw: unknown): SemanticContextApplyResult {
    const parsed = validateSemanticContextDelta(raw);
    if (!parsed.ok) return fail("invalid_delta");
    const delta = parsed.value;

    const seenKey = delta.session_epoch + ":" + delta.mutation_id;
    const prior = seen.get(seenKey);
    if (prior) {
      if (!deepEqual(prior.delta, delta)) {
        return fail("mutation_conflict", delta.mutation_id, [{ code: "mutation_conflict" }]);
      }
      return {
        ok: true,
        replayed: true,
        changed: false,
        snapshot: snapshot(),
        receipt: cloneJson(prior.receipt),
        deliveries: [],
      };
    }

    if (delta.session_epoch !== group.session_epoch) {
      return fail("epoch_mismatch", delta.mutation_id, [{ code: "epoch_mismatch" }]);
    }
    if (delta.group_id !== group.group_id) return fail("group_mismatch", delta.mutation_id);
    if (delta.base_revision !== group.revision) {
      return fail("stale_base", delta.mutation_id, [{
        code: "stale_base",
        expected: group.revision,
        received: delta.base_revision,
      }]);
    }

    const origin = group.ports.find(port =>
      port.origin_id === delta.origin_id
      && port.mode === "linked"
      && (port.direction === "emit" || port.direction === "both")
    );
    if (!origin) return fail("origin_not_emitter", delta.mutation_id);
    if (delta.patch.kind !== group.kind) return fail("kind_mismatch", delta.mutation_id);

    const receipt = blankReceipt(delta.mutation_id, group.revision);
    if (deepEqual(delta.patch, group.value)) {
      seen.set(seenKey, { delta: cloneJson(delta), receipt: cloneJson(receipt) });
      return {
        ok: true,
        replayed: false,
        changed: false,
        snapshot: snapshot(),
        receipt,
        deliveries: [],
      };
    }

    if (group.revision >= MAX_REVISION) {
      return fail("revision_exhausted", delta.mutation_id);
    }

    const deliveries: SemanticContextDelivery[] = [];
    const temporal = requestedTemporal(delta.patch);

    for (const port of group.ports) {
      if (port.port_id === origin.port_id) continue;
      if (port.mode === "pinned") {
        receipt.pinned_ports.push(port.port_id);
        continue;
      }
      if (port.mode === "local") {
        receipt.rejected_ports.push({ port_id: port.port_id, reason: "local" });
        continue;
      }
      if (port.direction === "emit") {
        receipt.rejected_ports.push({ port_id: port.port_id, reason: "output_only" });
        continue;
      }
      if (temporal && !port.temporal_capabilities.includes(temporal)) {
        receipt.temporal_mismatches.push({
          port_id: port.port_id,
          requested: temporal,
          supported: [...port.temporal_capabilities],
        });
        continue;
      }
      if (port.accepts.includes(delta.patch.kind)) {
        receipt.applied_ports.push(port.port_id);
        deliveries.push({ port_id: port.port_id, value: cloneJson(delta.patch) });
        continue;
      }

      const adapter = port.adapter_id ? adapters.get(port.adapter_id) : undefined;
      if (!adapter || adapter.from_kind !== delta.patch.kind || !port.accepts.includes(adapter.to_kind)) {
        receipt.missing_adapters.push({
          port_id: port.port_id,
          from_kind: delta.patch.kind,
          to_kinds: [...port.accepts],
          ...(port.adapter_id ? { adapter_id: port.adapter_id } : {}),
        });
        continue;
      }

      let projected:
        | { ok: true; value: SemanticContextValue }
        | { ok: false; reason: string };
      try {
        projected = adapter.project(cloneJson(delta.patch));
      } catch {
        projected = { ok: false, reason: "adapter_error" };
      }
      if (!projected.ok) {
        receipt.rejected_ports.push({ port_id: port.port_id, reason: projected.reason || "adapter_refused" });
        continue;
      }
      const checked = validateSemanticContextValue(projected.value, "$.adapter");
      if (!checked.ok || checked.value.kind !== adapter.to_kind) {
        receipt.rejected_ports.push({ port_id: port.port_id, reason: "adapter_invalid_output" });
        continue;
      }
      receipt.applied_ports.push(port.port_id);
      deliveries.push({ port_id: port.port_id, value: checked.value });
    }

    group = { ...group, revision: group.revision + 1, value: cloneJson(delta.patch) };
    receipt.accepted_revision = group.revision;
    seen.set(seenKey, { delta: cloneJson(delta), receipt: cloneJson(receipt) });
    return {
      ok: true,
      replayed: false,
      changed: true,
      snapshot: snapshot(),
      receipt,
      deliveries,
    };
  }

  return { snapshot, apply };
}
