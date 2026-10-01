/** Per-mounted-consumer transport coordination for the existing saved-view owner.
 * No saved-data store, worker, automatic retries or market evaluation is introduced.
 * Only an account-bound request ID/digest is retained locally for explicit status checks.
 */
import {
  SAVED_VIEW_CONTRACT, exactKeys, normalizeReceipt, normalizeSavedDefinition, normalizeSavedId,
  normalizeSavedViewName, normalizeWorkspaceSavedView, objectRecord, savedRequestFingerprint,
} from "@/lib/savedViewContract";
import type { SavedViewDefinition, WorkspaceSavedView } from "@/lib/savedViewContract";

export type PendingSavedView = { version: 1; ownerId: string; requestId: string; fingerprint: string };
export type SavedViewWritePhase = "idle" | "saving" | "checking" | "unknown" | "confirmed" | "deleted"
  | "rejected" | "conflict" | "access_required" | "recovery_blocked";
export type SavedViewClientState = {
  phase: SavedViewWritePhase; error: string | null; view: WorkspaceSavedView | null;
  pending: PendingSavedView | null; views: WorkspaceSavedView[];
  listStatus: "unloaded" | "loading" | "ready" | "unavailable"; truncated: boolean;
};
export type RecoveryHandleStore = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };
export const SAVED_VIEW_RECOVERY_PREFIX = "mm.saved-view-request.v2:";
export function savedViewRecoveryKey(ownerId: string): string { return SAVED_VIEW_RECOVERY_PREFIX + encodeURIComponent(ownerId); }
const ENDPOINT = "/api/thesis-saved-views";
const safeClientErrors = new Set(["invalid_name", "invalid_definition", "invalid_filter", "invalid_id", "invalid_scope", "invalid_fields", "invalid_contract", "invalid_json", "unsupported_action"]);
function pendingHandle(value: unknown, owner: string): PendingSavedView | null {
  const raw = objectRecord(value);
  if (!raw || !exactKeys(raw, ["version", "ownerId", "requestId", "fingerprint"]) || raw.version !== 1 || raw.ownerId !== owner) return null;
  const id = normalizeSavedId(raw.requestId);
  return id && typeof raw.fingerprint === "string" && /^[a-f0-9]{64}$/.test(raw.fingerprint)
    ? { version: 1, ownerId: owner, requestId: id, fingerprint: raw.fingerprint } : null;
}
export class SavedViewClient {
  private current: SavedViewClientState = { phase: "idle", error: null, view: null, pending: null, views: [], listStatus: "unloaded", truncated: false };
  private disposed = false;
  private busy = false;
  private listGeneration = 0;
  private mutationGeneration = 0;
  private listeners = new Set<(state: SavedViewClientState) => void>();
  private readonly key: string;
  constructor(
    readonly ownerId: string,
    private readonly handles: RecoveryHandleStore,
    private readonly transport: typeof fetch = fetch,
    private readonly uuid: () => string = () => crypto.randomUUID(),
    private readonly viewKind?: SavedViewDefinition["kind"],
  ) {
    this.key = savedViewRecoveryKey(ownerId);
    try {
      const stored = handles.getItem(this.key);
      if (stored !== null) {
        const handle = pendingHandle(JSON.parse(stored), ownerId);
        this.current = handle ? { ...this.current, phase: "unknown", pending: handle, error: "check_original_request" }
          : { ...this.current, phase: "recovery_blocked", error: "invalid_recovery_handle" };
      }
    } catch { this.current = { ...this.current, phase: "recovery_blocked", error: "recovery_storage_unavailable" }; }
  }
  snapshot(): SavedViewClientState { return structuredClone(this.current); }
  subscribe(listener: (state: SavedViewClientState) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }
  private publish(patch: Partial<SavedViewClientState>) {
    if (this.disposed) return;
    this.current = { ...this.current, ...patch };
    for (const listener of this.listeners) listener(this.snapshot());
  }
  private clearHandle(handle: PendingSavedView) {
    // Failed removal leaves a safe check-only handle, not permission to auto-create on reload.
    try {
      const raw = this.handles.getItem(this.key);
      const current = raw === null ? null : pendingHandle(JSON.parse(raw), this.ownerId);
      if (current?.requestId === handle.requestId && current.fingerprint === handle.fingerprint) this.handles.removeItem(this.key);
    } catch { /* canonical confirmation remains valid */ }
  }
  /** A changed mount/account hides private results but never claims to cancel the server operation. */
  dispose() {
    this.disposed = true; this.listGeneration += 1; this.mutationGeneration += 1; this.listeners.clear();
    this.current = { phase: "idle", error: null, view: null, pending: null, views: [], listStatus: "unloaded", truncated: false };
  }
  /** Explicitly retire only a resolved UI state; an uncertain request must be checked, not discarded. */
  clearResolved(): boolean {
    if (this.busy || this.disposed || !["confirmed", "deleted", "rejected"].includes(this.current.phase)) return false;
    this.publish({ phase: "idle", error: null, view: null, pending: null });
    return true;
  }
  async save(nameValue: unknown, definitionValue: unknown): Promise<SavedViewClientState> {
    if (this.disposed || this.busy || this.current.pending || !["idle", "rejected"].includes(this.current.phase)) return this.snapshot();
    const name = normalizeSavedViewName(nameValue), definition = normalizeSavedDefinition(definitionValue);
    if (!name || !definition) { this.publish({ phase: "rejected", error: name ? "invalid_definition" : "invalid_name" }); return this.snapshot(); }
    this.busy = true; // synchronous, before UUID/digest awaits or a second click can enter
    const generation = ++this.mutationGeneration; ++this.listGeneration;
    this.publish({ phase: "saving", error: null, view: null, listStatus: this.current.listStatus === "loading" ? "unloaded" : this.current.listStatus });
    let dispatched = false;
    try {
      const id = normalizeSavedId(this.uuid());
      if (!id) throw new Error("invalid_client_id");
      const fingerprint = await savedRequestFingerprint(this.ownerId, id, name, definition);
      if (this.disposed || generation !== this.mutationGeneration) return this.snapshot();
      const handle: PendingSavedView = { version: 1, ownerId: this.ownerId, requestId: id, fingerprint };
      // Another mounted consumer may have begun a request while the digest was computing.
      const occupied = this.handles.getItem(this.key);
      if (occupied !== null) {
        const incumbent = pendingHandle(JSON.parse(occupied), this.ownerId);
        this.publish(incumbent ? { phase: "unknown", pending: incumbent, error: "check_original_request" }
          : { phase: "recovery_blocked", error: "invalid_recovery_handle" });
        return this.snapshot();
      }
      this.handles.setItem(this.key, JSON.stringify(handle)); // persist recovery identity BEFORE the first write
      this.publish({ pending: handle });
      dispatched = true;
      const response = await this.transport(ENDPOINT, { method: "PUT", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", contract: SAVED_VIEW_CONTRACT, id, name, definition }) });
      await this.consume(response, handle, generation, "create");
    } catch {
      if (!this.disposed && generation === this.mutationGeneration) this.publish({ phase: dispatched ? "unknown" : "rejected",
        error: dispatched ? "save_outcome_unknown" : "recovery_storage_unavailable", ...(dispatched ? {} : { pending: null }) });
    } finally { this.busy = false; }
    return this.snapshot();
  }
  async check(): Promise<SavedViewClientState> {
    if (this.disposed || this.busy || !this.current.pending) return this.snapshot();
    this.busy = true;
    const generation = ++this.mutationGeneration, handle = this.current.pending;
    this.publish({ phase: "checking", error: null });
    try {
      const response = await this.transport(ENDPOINT + "?contract=" + encodeURIComponent(SAVED_VIEW_CONTRACT) + "&id=" + encodeURIComponent(handle.requestId), { cache: "no-store" });
      await this.consume(response, handle, generation, "check");
    } catch {
      if (!this.disposed && generation === this.mutationGeneration) this.publish({ phase: "unknown", error: "save_outcome_unknown" });
    } finally { this.busy = false; }
    return this.snapshot();
  }
  private async consume(response: Response, handle: PendingSavedView, generation: number, action: "create" | "check") {
    let body: Record<string, unknown> | null = null;
    try { body = objectRecord(await response.json()); } catch { /* successful HTTP without a usable receipt is uncertain */ }
    if (this.disposed || generation !== this.mutationGeneration) return;
    if (response.status === 401 || response.status === 403) {
      ++this.listGeneration; ++this.mutationGeneration;
      this.publish({ phase: "access_required", error: "sign_in_to_original_account", view: null, views: [], listStatus: "unavailable", truncated: false });
      return;
    }
    const error = typeof body?.error === "string" ? body.error : "";
    if (!response.ok) {
      if (action === "create" && ((response.status === 400 && safeClientErrors.has(error)) || (response.status === 409 && error === "limit_reached"))) {
        this.clearHandle(handle); this.publish({ phase: "rejected", error, pending: null }); return;
      }
      if (response.status === 409 && error === "request_conflict") { this.publish({ phase: "conflict", error }); return; }
      // 404/410/503, read failure and unrecognized responses never establish that no creation occurred.
      this.publish({ phase: "unknown", error: action === "check" && response.status === 404 ? "request_not_yet_observed" : "save_outcome_unknown" }); return;
    }
    const receipt = normalizeReceipt(body?.receipt);
    if (!body || body.contract !== SAVED_VIEW_CONTRACT || body.ownerId !== this.ownerId || !receipt
        || receipt.requestId !== handle.requestId || receipt.fingerprint !== handle.fingerprint) {
      this.publish({ phase: "unknown", error: "invalid_save_receipt" }); return;
    }
    if (body.state === "deleted" && body.view === null) {
      ++this.listGeneration; this.clearHandle(handle);
      this.publish({ phase: "deleted", error: null, view: null, pending: null, views: this.current.views.filter(v => v.id !== handle.requestId) }); return;
    }
    const view = normalizeWorkspaceSavedView(body.view);
    if (body.state !== "present" || !view || view.revision < 1 || view.id !== handle.requestId || !receipt.originalName) {
      this.publish({ phase: "unknown", error: "invalid_save_receipt" }); return;
    }
    const actual = await savedRequestFingerprint(this.ownerId, view.id, receipt.originalName, view.definition);
    if (this.disposed || generation !== this.mutationGeneration) return;
    if (actual !== handle.fingerprint) { this.publish({ phase: "unknown", error: "invalid_save_receipt" }); return; }
    ++this.listGeneration; this.clearHandle(handle);
    this.publish({ phase: "confirmed", error: null, view, pending: null,
      views: (!this.viewKind || view.definition.kind === this.viewKind ? [view, ...this.current.views.filter(v => v.id !== view.id)] : this.current.views).slice(0, 50) });
  }
  async load(): Promise<SavedViewClientState> {
    if (this.disposed) return this.snapshot();
    const generation = ++this.listGeneration, mutation = this.mutationGeneration;
    this.publish({ listStatus: "loading" });
    try {
      const response = await this.transport(ENDPOINT + "?contract=" + encodeURIComponent(SAVED_VIEW_CONTRACT)
        + (this.viewKind ? "&kind=" + encodeURIComponent(this.viewKind) : ""), { cache: "no-store" });
      if (this.disposed || generation !== this.listGeneration || mutation !== this.mutationGeneration) return this.snapshot();
      // An authentication gateway may return HTML or an empty body. The status alone
      // requires hiding protected state; JSON parsing must not defer that boundary.
      if (response.status === 401 || response.status === 403) {
        ++this.mutationGeneration;
        this.publish({ phase: "access_required", error: "sign_in_to_original_account", view: null, views: [], listStatus: "unavailable", truncated: false }); return this.snapshot();
      }
      const body = objectRecord(await response.json());
      if (this.disposed || generation !== this.listGeneration || mutation !== this.mutationGeneration) return this.snapshot();
      if (!response.ok || body?.contract !== SAVED_VIEW_CONTRACT || body.ownerId !== this.ownerId || !Array.isArray(body.views)
          || body.views.length > 50 || typeof body.truncated !== "boolean") throw new Error("invalid_list");
      const views = body.views.map(normalizeWorkspaceSavedView);
      if (views.some(v => v === null || (this.viewKind && v.definition.kind !== this.viewKind)) || new Set(views.map(v => v?.id)).size !== views.length) throw new Error("invalid_list");
      this.publish({ views: views as WorkspaceSavedView[], truncated: body.truncated, listStatus: "ready" });
    } catch {
      if (!this.disposed && generation === this.listGeneration && mutation === this.mutationGeneration) this.publish({ listStatus: "unavailable" });
    }
    return this.snapshot();
  }
}
/** Names, membership, prices and conditions are deliberately NOT stored in browser recovery state. */
export function browserSavedViewHandles(): RecoveryHandleStore { return window.sessionStorage; }

/** Keys belong to the existing central LEX; this module creates no locale provider. */
export function savedViewOperationMessageKey(phase: SavedViewWritePhase, error: string | null): string {
  if (error === "request_not_yet_observed") return "savedViewOpNotObserved";
  const keys: Partial<Record<SavedViewWritePhase, string>> = {
    saving: "savedViewOpSaving", checking: "savedViewOpChecking", unknown: "savedViewOpUnknown",
    conflict: "savedViewOpConflict", access_required: "savedViewOpAccess", recovery_blocked: "savedViewOpRecovery",
    deleted: "savedViewOpDeleted",
  };
  return keys[phase] ?? "savedViewOpUnknown";
}
