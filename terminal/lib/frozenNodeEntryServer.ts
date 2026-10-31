import "server-only";
import { createClient } from "./supabase/server";
import { readFrozenNodeSourceAction } from "./frozenNodeSourceAction";
import { createPersistedFrozenNodeEnrollment, reconcilePersistedFrozenNodeEnrollment } from "./frozenNodeEnrollmentCaller";
import { fnpInstantMicros } from "./optionsAlerts";
import { entryEqual, entryKeys, entryObject, entryUUID, snapshotFrozenEntryDescriptor, snapshotFrozenEntrySelection,
  type FrozenEntryReference } from "./frozenNodeEntryProtocol";

async function bounded<T>(work: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([Promise.resolve(work), new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("entry_ack_unknown")), 5_000);
  })]); } finally { if (timer !== undefined) clearTimeout(timer); }
}
/** Existing /api/alerts POST only, behind BOTH explicit entry header and default-OFF
 * host flag. No new endpoint, SQL/RPC, registry, default source reader or activation. */
export async function handleFrozenNodeEntry(req: Request): Promise<Response> {
  if (process.env.MM_OPTIONS_FROZEN_ENTRY_ENABLED !== "1") return Response.json({ kind: "unavailable", reason: "frozen_entry_disabled" }, { status: 409 });
  if (req.headers.get("origin") !== new URL(req.url).origin || req.headers.get("content-type")?.split(";")[0] !== "application/json")
    return Response.json({ kind: "denied", reason: "same_origin_required" }, { status: 403 });
  let started: FrozenEntryReference | null = null;
  const unknown = () => Response.json({ kind: "effect_unknown", reason: "creation_acknowledgment_unknown", reference: started }, { status: 503 });
  try {
    const text = await bounded(req.text());
    if (new TextEncoder().encode(text).length > 131_072) return Response.json({ kind: "unavailable", reason: "entry_size" }, { status: 400 });
    const body: unknown = JSON.parse(text);
    if (!entryObject(body)) return Response.json({ kind: "unavailable", reason: "entry_request" }, { status: 400 });
    const db = await createClient(), session = await bounded(db.auth.getSession());
    const token = session.data.session?.access_token;
    if (session.error || !token) return Response.json({ kind: "denied", reason: "unauthenticated" }, { status: 401 });
    const user = await bounded(db.auth.getUser(token)), principal = user.data.user?.id;
    if (user.error || !entryUUID(principal)) return Response.json({ kind: "denied", reason: "unauthenticated" }, { status: 401 });
    const deps = { auth: db.auth, accountFetcher: globalThis.fetch.bind(globalThis),
      sourceTransport: { fetcher: globalThis.fetch.bind(globalThis) }, clock: () => new Date().toISOString() };
    if (body.action === "reconcile" && entryKeys(body, ["action", "reference"]) && entryObject(body.reference)
      && entryKeys(body.reference, ["alertId", "attemptId"]) && entryUUID(body.reference.alertId) && entryUUID(body.reference.attemptId)) {
      const reference = structuredClone(body.reference) as FrozenEntryReference;
      return Response.json({ kind: "enrollment", reference, result: await reconcilePersistedFrozenNodeEnrollment(reference, deps) });
    }
    if (body.action === "issue" && entryKeys(body, ["action", "selection"])) {
      const selection = snapshotFrozenEntrySelection(body.selection);
      if (!selection) return Response.json({ kind: "unavailable", reason: "invalid_selection" }, { status: 400 });
      const admitted = await readFrozenNodeSourceAction({ expected: selection.predicate.target, principal, lens: selection.lens }, deps);
      if (admitted.kind !== "admitted") return Response.json(admitted, { status: 403 });
      // Non-effectful issuance. No DB token is invented before INSERT. This
      // descriptor is not a signed grant; every effect revalidates real authority.
      return Response.json({ kind: "issued", descriptor: { schema: "options.frozen_entry/v1", alertId: crypto.randomUUID(),
        attemptId: crypto.randomUUID(), principal, issuedAt: deps.clock(), ...selection } });
    }
    if (body.action !== "enroll" || !entryKeys(body, ["action", "descriptor"])) return Response.json({ kind: "unavailable", reason: "entry_request" }, { status: 400 });
    const descriptor = snapshotFrozenEntryDescriptor(body.descriptor);
    if (!descriptor || descriptor.principal !== principal || fnpInstantMicros(descriptor.issuedAt)! > fnpInstantMicros(deps.clock())!)
      return Response.json({ kind: "denied", reason: "entry_identity_mismatch" }, { status: 403 });
    const reference = { alertId: descriptor.alertId, attemptId: descriptor.attemptId };
    const admitted = await readFrozenNodeSourceAction({ expected: descriptor.predicate.target, principal, lens: descriptor.lens }, deps);
    if (admitted.kind !== "admitted") return Response.json(admitted, { status: 403 });
    const cap = await bounded(db.from("alerts").select("id", { count: "exact", head: true }).eq("user_id", principal));
    if (cap.error || !Number.isInteger(cap.count) || cap.count! < 0 || cap.count! >= 50)
      return Response.json({ kind: "unavailable", reason: "alert_limit_or_count_unknown" }, { status: 409 });
    started = reference; // Before INSERT; timeout/error never becomes a read-then-adopt.
    const inserted = await bounded(db.from("alerts").insert({ id: descriptor.alertId, user_id: principal,
      symbol: descriptor.predicate.root, condition: structuredClone(descriptor.predicate), active: true }).select("*").single());
    const row: unknown = structuredClone(inserted.data);
    if (inserted.error || !entryObject(row) || row.id !== descriptor.alertId || row.user_id !== principal
      || row.symbol !== descriptor.predicate.root || !entryEqual(row.condition, descriptor.predicate) || row.active !== true
      || row.frozen_runtime !== null || row.frozen_enrollment !== null || !entryUUID(row.frozen_intent_revision)
      || fnpInstantMicros(row.created_at) === null) return unknown();
    const attempt = createPersistedFrozenNodeEnrollment({ ...reference, principal, predicate: descriptor.predicate,
      lens: descriptor.lens, expectedIntentRevision: row.frozen_intent_revision, expectedGeneration: null, expectedRevision: null }, deps);
    return Response.json({ kind: "enrollment", reference, result: await attempt.run() });
  } catch { return started ? unknown() : Response.json({ kind: "unavailable", reason: "entry_unavailable" }, { status: 503 }); }
}
