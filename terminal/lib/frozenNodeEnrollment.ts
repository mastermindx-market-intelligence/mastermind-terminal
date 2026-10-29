import "server-only";
import { createServiceClient } from "./supabase/service";
import { readFrozenNodeSourceAction, type FrozenNodeSourceActionDependencies } from "./frozenNodeSourceAction";
import { fnpInstantMicros, frozenNodeTargetFingerprint, type FrozenNodeTarget } from "./optionsAlerts";
import type { ExposureLens } from "./exposureMapProjection";

/** Dormant server composition only. No route, insert, active toggle, automatic
 * caller, quote evaluation, historical fire, outbox or delivery is installed.
 * Requires the UNAPPLIED intent-revision amendment, not old0045's initial CAS. */
export type FrozenNodeInitialIntent = {
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
  | { kind: "armed"; intent: FrozenNodeInitialIntent; runtime: Runtime }
  | { kind: "unavailable" | "denied" | "conflict"; reason: string }
  | { kind: "effect_unknown"; reason: "arm_acknowledgment_unknown"; intent: FrozenNodeInitialIntent };
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
function snapshot(request: FrozenNodeInitialIntent): FrozenNodeInitialIntent | null {
  try {
    const pin = structuredClone(request);
    if (!record(pin) || !keys(pin, ["alertId", "principal", "predicate", "expectedIntentRevision", "expectedGeneration", "expectedRevision", "lens"])
      || !uuid(pin.alertId) || !uuid(pin.principal) || !uuid(pin.expectedIntentRevision)
      || pin.expectedGeneration !== null || pin.expectedRevision !== null || !record(pin.predicate)) return null;
    const p = pin.predicate;
    if (!keys(p, ["type", "root", "target", ...(p.within_pct === undefined ? [] : ["within_pct"])])
      || p.type !== "opt_frozen_node_proximity" || p.root !== p.target?.root || !frozenNodeTargetFingerprint(p.target)
      || (p.within_pct !== undefined && (typeof p.within_pct !== "number" || !Number.isFinite(p.within_pct) || p.within_pct < 0))) return null;
    return pin;
  } catch { return null; }
}
async function bounded<T>(work: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve(work), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("enrollment_deadline")), 5_000);
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
function acknowledgment(value: unknown, pin: FrozenNodeInitialIntent, checkedAt: string, returnedAt: string): Runtime | null {
  if (!record(value) || !keys(value, ["kind", "runtime", "intentRevision"]) || value.kind !== "data"
    || value.intentRevision !== pin.expectedIntentRevision || !record(value.runtime)) return null;
  const r = value.runtime;
  if (!keys(r, ["schema", "alertId", "principal", "predicate", "generation", "revision", "createdAt", "armingEpoch", "priorState"])
    || r.schema !== "options.frozen_runtime/v1" || r.alertId !== pin.alertId || r.principal !== pin.principal
    || !uuid(r.generation) || r.revision !== 0 || r.priorState !== null || !equal(r.predicate, pin.predicate)) return null;
  const epoch = fnpInstantMicros(r.armingEpoch), created = fnpInstantMicros(r.createdAt);
  const checked = fnpInstantMicros(checkedAt), returned = fnpInstantMicros(returnedAt);
  if (epoch === null || created !== epoch || checked === null || returned === null || epoch < checked || epoch > returned) return null;
  return r as Runtime;
}

/** One explicit server-owned attempt. Captures the ENTIRE pin synchronously
 * before any await. Repeated run() calls consume the retained same outcome,
 * including UNKNOWN; no retry, new id or new arm invocation. No caller-supplied
 * policy verdict or RPC implementation is accepted. Tests replace network/DB
 * boundaries, not the actual source/account admission function.
 *
 * This object is not a durable restart journal. A future route MUST retain an
 * UNKNOWN result and must not recreate/retry its intent after process loss.
 * No such route or restart recovery is enabled by this source composition. */
export function createFrozenNodeInitialEnrollment(
  request: FrozenNodeInitialIntent,
  source: FrozenNodeSourceActionDependencies,
): { run: () => Promise<FrozenNodeEnrollmentResult> } {
  const pin = snapshot(request);
  // Freeze the capability references as well; caller mutation during await must
  // not replace the verified Auth/account/source/or invocation-clock boundary.
  const deps = { ...source, auth: {
    getSession: source.auth.getSession.bind(source.auth), getUser: source.auth.getUser.bind(source.auth),
  }, sourceTransport: { ...source.sourceTransport } };
  let outcome: Promise<FrozenNodeEnrollmentResult> | undefined;
  async function execute(): Promise<FrozenNodeEnrollmentResult> {
    const unavailable = (reason: string): FrozenNodeEnrollmentResult => ({ kind: "unavailable", reason });
    if (!pin) return unavailable("invalid_initial_intent");
    let armStarted = false;
    const unknown = (): FrozenNodeEnrollmentResult => ({ kind: "effect_unknown", reason: "arm_acknowledgment_unknown", intent: structuredClone(pin!) });
    try {
      // Verify the real interactive principal/current canonical account and
      // selected source before making even the privileged persisted-row read.
      const admitted = await readFrozenNodeSourceAction({ expected: structuredClone(pin.predicate.target),
        principal: pin.principal, lens: structuredClone(pin.lens) }, deps);
      if (admitted.kind !== "admitted") return admitted.kind === "missing" ? unavailable("selected_source_missing") : admitted;
      if (admitted.context.principal !== pin.principal || !equal(admitted.context.target, pin.predicate.target)) return unavailable("admitted_target_mismatch");
      const db = createServiceClient();
      if (!db) return unavailable("service_client_unavailable");
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
      // DB repeats ownership, active/full predicate, current row-intent and
      // null-runtime CAS under lock. No second application read closes this race.
      armStarted = true;
      const reply = await bounded(db.rpc("arm_frozen_node_runtime", {
        p_alert_id: pin.alertId, p_principal: pin.principal, p_predicate: structuredClone(pin.predicate),
        p_expected_generation: null, p_expected_revision: null,
        p_expected_intent_revision: pin.expectedIntentRevision,
      }));
      if (reply.error) return unknown();
      const body: unknown = structuredClone(reply.data);
      if (record(body) && keys(body, ["kind", "reason"]) && ["unavailable", "conflict"].includes(String(body.kind))
        && typeof body.reason === "string" && body.reason) {
        return { kind: body.kind as "unavailable" | "conflict", reason: body.reason };
      }
      const runtime = acknowledgment(body, pin, admitted.context.evaluationAt, deps.clock());
      return runtime ? { kind: "armed", intent: structuredClone(pin), runtime } : unknown();
    } catch { return armStarted ? unknown() : unavailable("initial_enrollment_unavailable"); }
  }
  return { run: async () => {
    outcome ??= execute();
    return structuredClone(await outcome);
  } };
}
