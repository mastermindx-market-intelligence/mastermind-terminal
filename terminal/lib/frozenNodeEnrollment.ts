import "server-only";
import { createServiceClient } from "./supabase/service";
import { readFrozenNodeSourceAction, type FrozenNodeSourceActionDependencies } from "./frozenNodeSourceAction";
import { fnpInstantMicros, frozenNodeTargetFingerprint, type FrozenNodeTarget } from "./optionsAlerts";
import type { ExposureLens } from "./exposureMapProjection";

/** Dormant server composition only. No route, insert, active toggle, automatic
 * caller, quote evaluation, historical fire, outbox or delivery is installed.
 * Requires UNAPPLIED0046, not old0045's initial CAS. */
export type FrozenNodeInitialIntent = {
  /** Retain this entire server-owned pin durably BEFORE calling run(). Never
   * manufacture an id to adopt a historical UNKNOWN operation. */
  attemptId: string;
  alertId: string;
  principal: string;
  predicate: { type: "opt_frozen_node_proximity"; root: string; target: FrozenNodeTarget; within_pct?: number };
  expectedIntentRevision: string;
  expectedGeneration: null;
  expectedRevision: null;
  lens: ExposureLens;
};
type Runtime = {
  schema: "options.frozen_runtime/v1";
  alertId: string; principal: string; predicate: FrozenNodeInitialIntent["predicate"];
  generation: string; revision: 0; createdAt: string; armingEpoch: string; priorState: null;
};
export type FrozenNodeEnrollmentResult =
  | { kind: "committed"; intent: FrozenNodeInitialIntent; historicalRuntime: Runtime; currentState: "unavailable" }
  | { kind: "unavailable" | "denied" | "conflict"; reason: string }
  | { kind: "effect_unknown"; reason: "enrollment_acknowledgment_unknown"; intent: FrozenNodeInitialIntent };
export type FrozenNodeRetentionResult = FrozenNodeEnrollmentResult
  | { kind: "retained"; intent: FrozenNodeInitialIntent };
const uuid = (x: unknown): x is string => typeof x === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(x);
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const keys = (x: Record<string, unknown>, expected: string[]) => Object.keys(x).sort().join("|") === [...expected].sort().join("|");
// Full JSON value equality; property order is not an economic or ownership edit.
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => equal(v, b[i]));
  if (!record(a) || !record(b)) return false;
  return keys(a, Object.keys(b)) && Object.keys(a).every(k => equal(a[k], b[k]));
}
export function snapshotFrozenNodeInitialIntent(request: FrozenNodeInitialIntent): FrozenNodeInitialIntent | null {
  try {
    const pin = structuredClone(request);
    if (!record(pin) || !keys(pin, ["attemptId", "alertId", "principal", "predicate", "expectedIntentRevision", "expectedGeneration", "expectedRevision", "lens"])
      || !uuid(pin.attemptId) || !uuid(pin.alertId) || !uuid(pin.principal) || !uuid(pin.expectedIntentRevision)
      || pin.expectedGeneration !== null || pin.expectedRevision !== null || !record(pin.predicate)) return null;
    const p = pin.predicate;
    if (!keys(p, ["type", "root", "target", ...(p.within_pct === undefined ? [] : ["within_pct"])])
      || p.type !== "opt_frozen_node_proximity" || p.root !== p.target?.root || !frozenNodeTargetFingerprint(p.target)
      || (p.within_pct !== undefined && (typeof p.within_pct !== "number" || !Number.isFinite(p.within_pct) || p.within_pct < 0))) return null;
    return pin;
  } catch { return null; }
}
/** Decode identity only, never permission or a recovered dispatch capability.
 * The actual source/account reader and RPC still validate the exact saved pin. */
export function retainedFrozenNodeIntent(value: unknown, expected: { alertId: string; attemptId: string; principal: string }, at: string): FrozenNodeInitialIntent | null {
  if (!record(value) || !keys(value, ["schema", "attemptId", "alertId", "principal", "predicate", "intentRevision", "lens", "preparedAt", "phase", "outcome"])
    || value.schema !== "options.frozen_enrollment/v1" || value.alertId !== expected.alertId
    || value.attemptId !== expected.attemptId || value.principal !== expected.principal
    || !["prepared", "terminal"].includes(String(value.phase))
    || (value.phase === "prepared" && value.outcome !== null)) return null;
  const prepared = fnpInstantMicros(value.preparedAt), now = fnpInstantMicros(at);
  if (prepared === null || now === null || prepared > now) return null;
  return snapshotFrozenNodeInitialIntent({ attemptId: value.attemptId, alertId: value.alertId, principal: value.principal,
    predicate: value.predicate, expectedIntentRevision: value.intentRevision,
    expectedGeneration: null, expectedRevision: null, lens: value.lens } as FrozenNodeInitialIntent);
}
async function bounded<T>(work: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve(work), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("enrollment_deadline")), 5_000);
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
function acknowledgment(value: unknown, pin: FrozenNodeInitialIntent, preparedAt: string, returnedAt: string): Runtime | null {
  if (!record(value) || !keys(value, ["kind", "runtime", "intentRevision"]) || value.kind !== "data"
    || value.intentRevision !== pin.expectedIntentRevision || !record(value.runtime)) return null;
  const r = value.runtime;
  if (!keys(r, ["schema", "alertId", "principal", "predicate", "generation", "revision", "createdAt", "armingEpoch", "priorState"])
    || r.schema !== "options.frozen_runtime/v1" || r.alertId !== pin.alertId || r.principal !== pin.principal
    || !uuid(r.generation) || r.revision !== 0 || r.priorState !== null || !equal(r.predicate, pin.predicate)) return null;
  const epoch = fnpInstantMicros(r.armingEpoch), created = fnpInstantMicros(r.createdAt);
  const checked = fnpInstantMicros(preparedAt), returned = fnpInstantMicros(returnedAt);
  if (epoch === null || created !== epoch || checked === null || returned === null || epoch < checked || epoch > returned) return null;
  return r as Runtime;
}

/** One explicit server-owned attempt. Captures the ENTIRE pin synchronously
 * before any await. Repeated run() calls consume the retained same outcome,
 * including UNKNOWN; no retry, new id or new arm invocation. No caller-supplied
 * policy verdict or RPC implementation is accepted. Tests replace network/DB
 * boundaries, not the actual source/account admission function.
 *
 * The existing alerts row retains the exact attempt's terminal acknowledgment.
 * After process loss use reconcile() with the ORIGINAL durably retained pin;
 * it never arms. An existing prepared marker never authorizes a new run() to
 * arm. Reconciliation is READ ONLY for pending or absent receipts and leaves
 * those outcomes UNKNOWN. fence() is a SEPARATE explicit server-authorized
 * action that may close only the exact persisted PREPARED slot, never absence.
 * A recovered COMMITTED ack is historical evidence, not current armed/active
 * state. No route or historical-operation adoption is enabled here. */
export function createFrozenNodeInitialEnrollment(
  request: FrozenNodeInitialIntent,
  source: FrozenNodeSourceActionDependencies,
): { retain: () => Promise<FrozenNodeRetentionResult>; run: () => Promise<FrozenNodeEnrollmentResult>; reconcile: () => Promise<FrozenNodeEnrollmentResult>;
  fence: () => Promise<FrozenNodeEnrollmentResult> } {
  const pin = snapshotFrozenNodeInitialIntent(request);
  // Freeze the capability references as well; caller mutation during await must
  // not replace the verified Auth/account/source/or invocation-clock boundary.
  const deps = { ...source, auth: {
    getSession: source.auth.getSession.bind(source.auth), getUser: source.auth.getUser.bind(source.auth),
  }, sourceTransport: { ...source.sourceTransport } };
  let outcome: Promise<FrozenNodeEnrollmentResult> | undefined;
  let retention: Promise<FrozenNodeRetentionResult> | undefined;
  let fencing: Promise<FrozenNodeEnrollmentResult> | undefined;
  async function execute(mode: "retain" | "dispatch" | "reconcile" | "fence"): Promise<FrozenNodeRetentionResult> {
    const unavailable = (reason: string): FrozenNodeEnrollmentResult => ({ kind: "unavailable", reason });
    if (!pin) return unavailable("invalid_initial_intent");
    let dispatchStarted = false;
    const unknown = (): FrozenNodeEnrollmentResult => ({ kind: "effect_unknown", reason: "enrollment_acknowledgment_unknown", intent: structuredClone(pin!) });
    try {
      // Verify the real interactive principal/current canonical account and
      // selected source before making even the privileged persisted-row read.
      const admitted = await readFrozenNodeSourceAction({ expected: structuredClone(pin.predicate.target),
        principal: pin.principal, lens: structuredClone(pin.lens) }, deps);
      if (admitted.kind !== "admitted") return admitted.kind === "missing" ? unavailable("selected_source_missing") : admitted;
      if (admitted.context.principal !== pin.principal || !equal(admitted.context.target, pin.predicate.target)) return unavailable("admitted_target_mismatch");
      const db = createServiceClient();
      if (!db) return unavailable("service_client_unavailable");
      const rpc = async (operation: "prepare" | "arm" | "reconcile" | "fence") => {
        dispatchStarted = true;
        const reply = await bounded(db.rpc("arm_frozen_node_runtime", {
          p_alert_id: pin.alertId, p_principal: pin.principal, p_predicate: structuredClone(pin.predicate),
          p_expected_generation: null, p_expected_revision: null,
          p_expected_intent_revision: pin.expectedIntentRevision,
          p_enrollment: { operation, attemptId: pin.attemptId, lens: structuredClone(pin.lens) },
        }));
        if (reply.error) throw new Error("enrollment_acknowledgment_unknown");
        return structuredClone(reply.data) as unknown;
      };
      const terminal = (body: unknown): FrozenNodeEnrollmentResult => {
        if (record(body) && keys(body, ["kind", "reason"]) && ["unavailable", "conflict"].includes(String(body.kind))
          && typeof body.reason === "string" && body.reason) {
          // A stale/missing row or generation is not the original attempt's
          // terminal outcome. Only its exact retained envelope can resolve
          // historical ambiguity; a reconciliation refusal preserves UNKNOWN.
          if (mode === "reconcile" || mode === "fence") return unknown();
          return { kind: body.kind as "unavailable" | "conflict", reason: body.reason };
        }
        if (!record(body) || !keys(body, ["kind", "enrollment"]) || body.kind !== "enrollment") return unknown();
        const saved = envelope(body.enrollment);
        if (!saved || saved.phase !== "terminal") return unknown();
        const result = saved.outcome;
        if (record(result) && keys(result, ["kind", "reason"]) && ["unavailable", "conflict"].includes(String(result.kind))
          && typeof result.reason === "string" && result.reason) {
          return { kind: result.kind as "unavailable" | "conflict", reason: result.reason };
        }
        const runtime = acknowledgment(result, pin, saved.preparedAt as string, deps.clock());
        if (!runtime) return unknown();
        return { kind: "committed", intent: structuredClone(pin), historicalRuntime: runtime, currentState: "unavailable" };
      };
      const envelope = (value: unknown): Record<string, unknown> | null => {
        if (!record(value) || !keys(value, ["schema", "attemptId", "alertId", "principal", "predicate", "intentRevision", "lens", "preparedAt", "phase", "outcome"])
          || value.schema !== "options.frozen_enrollment/v1" || value.attemptId !== pin.attemptId
          || value.alertId !== pin.alertId || value.principal !== pin.principal
          || value.intentRevision !== pin.expectedIntentRevision || !equal(value.predicate, pin.predicate)
          || !equal(value.lens, pin.lens)) return null;
        const prepared = fnpInstantMicros(value.preparedAt), now = fnpInstantMicros(deps.clock());
        return prepared !== null && now !== null && prepared <= now ? value : null;
      };
      if (mode === "reconcile" || mode === "fence") return terminal(await rpc(mode));
      if (mode === "dispatch") return terminal(await rpc("arm"));
      const read = await bounded(db.from("alerts")
        .select("id,user_id,symbol,condition,active,created_at,frozen_runtime,frozen_intent_revision")
        .eq("id", pin.alertId).eq("user_id", pin.principal).maybeSingle());
      // Retain a private full observation before the final RPC await.
      const row: unknown = structuredClone(read.data);
      if (read.error || !record(row)) return unavailable("persisted_intent_unavailable");
      if (row.id !== pin.alertId || row.user_id !== pin.principal || row.symbol !== pin.predicate.root
        || !equal(row.condition, pin.predicate) || row.active !== true || row.frozen_runtime !== null
        || row.frozen_intent_revision !== pin.expectedIntentRevision || fnpInstantMicros(row.created_at) === null) {
        return { kind: "conflict", reason: "persisted_intent_mismatch" };
      }
      const prepared = await rpc("prepare");
      if (!record(prepared) || prepared.kind !== "prepared") return terminal(prepared);
      const saved = keys(prepared, ["kind", "enrollment"]) && envelope(prepared.enrollment);
      if (!saved || saved.phase !== "prepared" || saved.outcome !== null) return unknown();
      // This instance alone retains the confirmation. Reconstructing the pin
      // from the owner row cannot recreate it: PREPARE returns pending there.
      return { kind: "retained", intent: structuredClone(pin) };
    } catch { return dispatchStarted ? unknown() : unavailable("initial_enrollment_unavailable"); }
  }
  const retain = () => retention ??= execute("retain");
  return { retain: async () => structuredClone(await retain()), run: async () => {
    // Memoize before the first await; concurrent calls share ONE ARM dispatch.
    // A lost/pending retention reply can never flow into the dispatch branch.
    outcome ??= (async () => {
      const retained = await retain();
      if (retained.kind !== "retained") return retained;
      // This separate invocation revalidates current Auth/account/exact source
      // after retention. SQL independently checks current intent under its lock.
      return await execute("dispatch") as FrozenNodeEnrollmentResult;
    })();
    return structuredClone(await outcome);
  }, reconcile: async () => {
    // Each explicit read rechecks current Auth/account/source admission. It is
    // not a new mutation or a retry of the original prepare/arm/fence.
    return structuredClone(await execute("reconcile")) as FrozenNodeEnrollmentResult;
  }, fence: async () => {
    fencing ??= execute("fence") as Promise<FrozenNodeEnrollmentResult>;
    return structuredClone(await fencing);
  } };
}
