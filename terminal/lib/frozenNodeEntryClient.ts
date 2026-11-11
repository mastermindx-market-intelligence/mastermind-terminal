import { withFrozenEntryJournal, type FrozenEntryJournalPorts } from "./frozenNodeEntryJournal";
import { entryEqual, entryObject, snapshotFrozenEntryDescriptor, snapshotFrozenEntrySelection,
  type FrozenEntryDescriptor, type FrozenEntrySelection } from "./frozenNodeEntryProtocol";

export type FrozenEntryClientResult = { kind: "retained" | "committed" | "effect_unknown" | "unavailable"; reason: string; original?: { alertId: string; attemptId: string; root: string; price: number; session: string } };
type Ports = FrozenEntryJournalPorts & { enabled: boolean; fetcher: typeof fetch;
  currentOwner: () => Promise<string | null>; currentSelection: () => string };
/** Caller journal is reference retention only, not account/source authority or
 * guaranteed hardware durability. Server independently authenticates every action.
 * No constructor/mount/restart effect; issuance and enrollment are explicit steps. */
export function createFrozenNodeEntryJourney(request: { owner: string; selectionKey: string; selection: FrozenEntrySelection | null }, ports: Ports) {
  const pin = structuredClone(request), selection = snapshotFrozenEntrySelection(pin.selection), deps = { ...ports };
  let confirmed: FrozenEntryDescriptor | null = null;
  let recoveryOnly = false;
  let issued: Promise<FrozenEntryClientResult> | undefined, dispatched: Promise<FrozenEntryClientResult> | undefined;
  const unavailable = (reason: string): FrozenEntryClientResult => ({ kind: "unavailable", reason });
  const unknown = (reason = "original_attempt_unresolved"): FrozenEntryClientResult => ({ kind: "effect_unknown", reason });
  async function current(requireSelection: boolean): Promise<boolean> {
    if (requireSelection && deps.currentSelection() !== pin.selectionKey) return false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const owner = await Promise.race([Promise.resolve().then(() => deps.currentOwner()), new Promise<null>(resolve => {
        timer = setTimeout(() => resolve(null), 5_000);
      })]);
      return owner === pin.owner && (!requireSelection || deps.currentSelection() === pin.selectionKey);
    } catch { return false; } finally { if (timer !== undefined) clearTimeout(timer); }
  }
  async function post(body: unknown): Promise<unknown> {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const work = (async () => {
        const response = await deps.fetcher("/api/alerts", { method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
          headers: { "Content-Type": "application/json", "x-mm-frozen-entry": "v1" }, body: JSON.stringify(body), signal: controller.signal });
        if (response.redirected) throw new Error("entry_redirect");
        const text = await response.text();
        if (text.length > 131_072) throw new Error("entry_size");
        return JSON.parse(text) as unknown;
      })();
      return await Promise.race([work, new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("entry_ack_unknown")); }, 15_000);
      })]);
    } finally { if (timer !== undefined) clearTimeout(timer); controller.abort(); }
  }
  function outcome(body: unknown, descriptor: FrozenEntryDescriptor): FrozenEntryClientResult {
    const reference = { alertId: descriptor.alertId, attemptId: descriptor.attemptId };
    if (!entryObject(body) || body.kind !== "enrollment" || !entryEqual(body.reference, reference) || !entryObject(body.result)) return unknown();
    const result = body.result;
    if (result.kind === "committed" && entryObject(result.intent) && result.intent.alertId === descriptor.alertId
      && result.intent.attemptId === descriptor.attemptId && result.intent.principal === pin.owner
      && entryEqual(result.intent.predicate, descriptor.predicate) && entryEqual(result.intent.lens, descriptor.lens)
      && result.currentState === "unavailable") return { kind: "committed", reason: "historical_commit_acknowledged" };
    return unknown(); // A refusal/missing response never clears a dispatched journal.
  }
  async function prepare(): Promise<FrozenEntryClientResult> {
    if (recoveryOnly) return unknown("read_only_recovery_required");
    if (!deps.enabled || !selection) return unavailable("entry_disabled_or_selection_unavailable");
    try {
      return await withFrozenEntryJournal(deps, pin.owner, async slot => {
        if (slot.read().state !== "empty") return unknown("reference_already_retained");
        if (!await current(true)) return unavailable("owner_or_selection_changed");
        const body = await post({ action: "issue", selection });
        if (!await current(true)) return unavailable("owner_or_selection_changed");
        const descriptor = entryObject(body) && body.kind === "issued" ? snapshotFrozenEntryDescriptor(body.descriptor) : null;
        if (recoveryOnly) { slot.holdMissingReference(); return unknown("read_only_recovery_required"); }
        if (!descriptor || descriptor.principal !== pin.owner || !entryEqual(descriptor.predicate, selection.predicate)
          || !entryEqual(descriptor.lens, selection.lens)) return unavailable("issuance_unconfirmed");
        if (!slot.retain(descriptor)) return unavailable("reference_retention_unconfirmed");
        confirmed = descriptor;
        return { kind: "retained", reason: "explicit_enrollment_required", original: { alertId: descriptor.alertId, attemptId: descriptor.attemptId,
          root: descriptor.predicate.root, price: descriptor.predicate.target.price, session: descriptor.predicate.target.sourceSession } };
      }) ?? unavailable("journal_lock_unavailable");
    } catch { return unavailable("issuance_or_retention_unconfirmed"); }
  }
  async function enroll(): Promise<FrozenEntryClientResult> {
    if (recoveryOnly) return unknown("read_only_recovery_required");
    if (!deps.enabled) return unavailable("entry_disabled");
    if (!confirmed) return unknown("original_confirmation_unavailable");
    const descriptor = structuredClone(confirmed);
    let started = false;
    try {
      return await withFrozenEntryJournal(deps, pin.owner, async slot => {
        const saved = slot.read();
        if (saved.state !== "held" || saved.phase !== "retained" || !entryEqual(saved.descriptor, descriptor)) return unknown();
        if (!await current(true)) return unavailable("owner_or_selection_changed");
        // Durable marker FIRST. Crash after this point is recovery-only even if
        // no HTTP request actually left; absence is never retry permission.
        if (!slot.dispatch(descriptor)) return unavailable("dispatch_retention_unconfirmed");
        started = true;
        if (!await current(true)) return unknown("owner_or_selection_changed");
        const body = await post({ action: "enroll", descriptor });
        if (!await current(true)) return unknown("owner_or_selection_changed");
        return outcome(body, descriptor);
      }) ?? (started ? unknown() : unavailable("journal_lock_unavailable"));
    } catch { return unknown(); }
  }
  return { prepare: () => issued ??= prepare(), enroll: () => dispatched ??= enroll(), recover: async (): Promise<FrozenEntryClientResult> => {
    if (!deps.enabled) return unavailable("entry_disabled");
    recoveryOnly = true;
    try {
      return await withFrozenEntryJournal(deps, pin.owner, async slot => {
        if (!await current(false)) return unavailable("owner_changed");
        const saved = slot.read();
        if (saved.state !== "held") {
          if (saved.state === "empty") slot.holdMissingReference();
          return unknown("original_reference_unavailable");
        }
        const body = await post({ action: "reconcile", reference: { alertId: saved.descriptor.alertId, attemptId: saved.descriptor.attemptId } });
        if (!await current(false)) return unknown("owner_changed");
        return { ...outcome(body, saved.descriptor), original: { alertId: saved.descriptor.alertId, attemptId: saved.descriptor.attemptId,
          root: saved.descriptor.predicate.root, price: saved.descriptor.predicate.target.price, session: saved.descriptor.predicate.target.sourceSession } };
      }) ?? unavailable("journal_lock_unavailable");
    } catch { return unknown(); }
  } };
}
