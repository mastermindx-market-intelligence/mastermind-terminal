import "server-only";
import { createClient } from "./supabase/server";
import { createFrozenNodeInitialEnrollment, retainedFrozenNodeIntent, snapshotFrozenNodeInitialIntent,
  type FrozenNodeEnrollmentResult, type FrozenNodeInitialIntent } from "./frozenNodeEnrollment";
import type { FrozenNodeSourceActionDependencies } from "./frozenNodeSourceAction";

/** Dormant private server composition. Public POST/PATCH, opt-in and publisher
 * remain unchanged. Network capabilities are server-owned, never request JSON. */
type Transports = Omit<FrozenNodeSourceActionDependencies, "auth">;
type Reference = { alertId: string; attemptId: string };
export type PersistedFrozenNodeEnrollmentResult = FrozenNodeEnrollmentResult
  | { kind: "effect_unknown"; reason: "original_enrollment_receipt_unknown"; reference: Reference };
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
async function bounded<T>(work: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([Promise.resolve(work), new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("owner_read_unknown")), 5_000);
  })]); } finally { if (timer !== undefined) clearTimeout(timer); }
}
function transports(source: Transports): Transports {
  return { ...source, sourceTransport: { ...source.sourceTransport } };
}
async function ownerRow(reference: Reference) {
  const db = await createClient();
  const session = await bounded(db.auth.getSession());
  const token = session.data.session?.access_token;
  if (session.error || !token) return null;
  // Same verified bearer is later used by the actual current-account reader.
  const user = await bounded(db.auth.getUser(token));
  if (user.error || !uuid(user.data.user?.id)) return null;
  const principal = user.data.user.id;
  // This is the incumbent authenticated owner RLS client, not service-role read.
  const reply = await bounded(db.from("alerts")
    .select("id,user_id,symbol,condition,active,created_at,frozen_runtime,frozen_intent_revision,frozen_enrollment")
    .eq("id", reference.alertId).eq("user_id", principal).maybeSingle());
  const row: unknown = structuredClone(reply.data);
  if (reply.error || !record(row) || row.id !== reference.alertId || row.user_id !== principal) return null;
  return { row, principal, auth: {
    getSession: db.auth.getSession.bind(db.auth), getUser: db.auth.getUser.bind(db.auth),
  } };
}

/** One original server-owned full pin. PREPARE durably retains it in the same
 * protected alerts slot; only a confirmed original reply can reach one ARM.
 * A lost retention reply stays UNKNOWN. It cannot be retried by a new caller:
 * the retained PREPARED slot yields pending, not a fresh dispatch capability.
 * The caller must retain its immutable attempt reference to request recovery;
 * this API never generates one, looks up a latest attempt, or adopts history. */
export function createPersistedFrozenNodeEnrollment(request: FrozenNodeInitialIntent, source: Transports): {
  run: () => Promise<PersistedFrozenNodeEnrollmentResult>;
} {
  const pin = snapshotFrozenNodeInitialIntent(request), deps = transports(source);
  let result: Promise<PersistedFrozenNodeEnrollmentResult> | undefined;
  async function execute(): Promise<PersistedFrozenNodeEnrollmentResult> {
    if (!pin) return { kind: "unavailable", reason: "invalid_initial_intent" };
    let retentionStarted = false;
    try {
      const owned = await ownerRow(pin);
      if (!owned) return { kind: "unavailable", reason: "owner_intent_unavailable" };
      if (owned.principal !== pin.principal) return { kind: "denied", reason: "principal_mismatch" };
      // An already occupied slot is recovery-only, even if its exact pin matches.
      if (owned.row.frozen_enrollment !== null) return {
        kind: "effect_unknown", reason: "enrollment_acknowledgment_unknown", intent: structuredClone(pin),
      };
      const attempt = createFrozenNodeInitialEnrollment(pin, { ...deps, auth: owned.auth });
      retentionStarted = true;
      const retained = await attempt.retain();
      if (retained.kind !== "retained") return retained;
      // run() rechecks current Auth/account/exact source and SQL's current-token
      // CAS. No cached policy result or PREPARED marker grants authority.
      return await attempt.run();
    } catch { return retentionStarted ? { kind: "effect_unknown", reason: "enrollment_acknowledgment_unknown", intent: structuredClone(pin) }
      : { kind: "unavailable", reason: "owner_intent_unavailable" }; }
  }
  return { run: async () => { result ??= execute(); return structuredClone(await result); } };
}

/** Explicit read-only recovery for a KNOWN original attempt reference. Absent,
 * deleted or replaced rows/receipts remain UNKNOWN. Identifier is not authority:
 * owner RLS plus current canonical account and exact source still gate disclosure.
 * No run/fence/prepare/arm capability is returned or reconstructed. */
export async function reconcilePersistedFrozenNodeEnrollment(request: Reference, source: Transports): Promise<PersistedFrozenNodeEnrollmentResult> {
  const reference = structuredClone(request), deps = transports(source);
  const unknown = (): PersistedFrozenNodeEnrollmentResult => ({ kind: "effect_unknown",
    reason: "original_enrollment_receipt_unknown", reference: structuredClone(reference) });
  if (!reference || Object.keys(reference).sort().join("|") !== "alertId|attemptId"
    || !uuid(reference.alertId) || !uuid(reference.attemptId)) return { kind: "unavailable", reason: "original_attempt_reference_required" };
  try {
    const owned = await ownerRow(reference);
    if (!owned) return unknown();
    const pin = retainedFrozenNodeIntent(owned.row.frozen_enrollment,
      { ...reference, principal: owned.principal }, deps.clock());
    if (!pin) return unknown();
    return await createFrozenNodeInitialEnrollment(pin, { ...deps, auth: owned.auth }).reconcile();
  } catch { return unknown(); }
}
