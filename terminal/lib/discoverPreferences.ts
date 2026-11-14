import { PreferencePump, LOCAL_STATUS, type DeliveryStatus } from "./prefDelivery";
import { readOwnerSlot, writeOwnerSlot, type StoragePort } from "./ownerStorage";
import { DISCOVER_CURRENT_KEY, DISCOVER_LOCAL_KEY, DISCOVER_VIEW_ID, MAX_DISCOVER_VIEWS, discoverViewKey, normalizeDiscoverName, parseDiscoverView, readDiscoverPreferences, sameDiscoverValue, scopeDiscoverWrite, type DiscoverPreferences, type DiscoverView } from "./discoverWorkspace";

const ENDPOINT = "/api/smart-screens?resource=discover_views";
type Values = Record<string, unknown>;
type Issue = "conflict" | "unavailable" | "unauthenticated" | "newer_schema" | "rejected" | null;
export type DiscoverPreferenceSnapshot = { value: DiscoverPreferences; ready: boolean; base: "pending" | "loaded" | "retrying"; sync: DeliveryStatus; issue: Issue; device: boolean };
const object = (v: unknown): v is Values => !!v && typeof v === "object" && !Array.isArray(v);
const idle: DeliveryStatus = { phase: "idle", attempts: 0, revision: 0, acked: 0 };

/** Feature adapter under useMarketPrefs' existing owner/generation lifecycle.
 * It reuses PreferencePump for serialization/coalescing and the Smart Screens
 * account route for persistence. No second auth client, global owner or queue.
 * ACK + pending preimages survive a reload in the existing owner-storage envelope.
 */
export class DiscoverPreferenceClient {
  private ack: Values = {};
  private pending: Values = {};
  /** Captured when a key is first edited; unrelated reads/ACKs cannot rebase it. */
  private preimages: Values = {};
  private state: DiscoverPreferenceSnapshot;
  private pump: PreferencePump;
  private dead = false;
  private reading = false;
  private sequence = 0;
  private deliveryEpoch = 0;
  private sending = false;
  private formatBlocked = false;
  private requests = new Set<AbortController>();
  constructor(private owner: string, private storage: StoragePort | null, private changed: () => void, private request: typeof fetch = fetch) {
    const cached = storage ? readOwnerSlot(storage, DISCOVER_LOCAL_KEY, owner) : null;
    if (object(cached) && (cached.v === 1 || cached.v === 2) && object(cached.ack) && object(cached.pending)) {
      this.ack = scopeDiscoverWrite(cached.ack).data; this.pending = scopeDiscoverWrite(cached.pending).data;
      if (cached.v === 2 && object(cached.preimages)) this.preimages = scopeDiscoverWrite(cached.preimages).data;
      // A legacy pending edit has no trustworthy preimage. Keep it visible, but
      // require explicit discard rather than guessing and overwriting an account.
    } else if (object(cached)) this.ack = scopeDiscoverWrite(cached).data;
    this.state = { value: readDiscoverPreferences({ ...this.ack, ...this.pending }), ready: false, base: "pending", sync: owner === "guest" ? LOCAL_STATUS : idle, issue: null, device: true };
    this.pump = this.makePump();
  }
  snapshot() { return this.state; }
  private emit(patch: Partial<DiscoverPreferenceSnapshot> = {}) {
    if (this.dead) return;
    const value = readDiscoverPreferences({ ...this.ack, ...this.pending });
    this.state = { ...this.state, value: { ...value, blocked: value.blocked || this.formatBlocked }, ...patch };
    this.changed();
  }
  private cache() {
    const device = !!this.storage && writeOwnerSlot(this.storage, DISCOVER_LOCAL_KEY, this.owner, { v: 2, ack: this.ack, pending: this.pending, preimages: this.preimages });
    this.state = { ...this.state, device };
  }
  private makePump() {
    const epoch = this.deliveryEpoch;
    return new PreferencePump({ scope: scopeDiscoverWrite, send: patch => this.send(patch, epoch), onStatus: sync => { if (epoch === this.deliveryEpoch) this.emit({ sync }); } });
  }
  private async http(method: "GET" | "PUT", body?: unknown) {
    const controller = new AbortController(); this.requests.add(controller);
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await this.request(ENDPOINT, { method, cache: "no-store", credentials: "same-origin", signal: controller.signal,
        ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
      const payload: unknown = await response.json();
      return { response, payload: object(payload) ? payload : {} };
    } finally { clearTimeout(timer); this.requests.delete(controller); }
  }
  async load(discard = false) {
    if (this.dead || this.reading) return;
    // A request in flight may still commit. Do not replace its lane or claim a
    // discard until it settles; the conflict action is only shown after failure.
    if (discard && this.sending) return;
    if (this.state.ready && this.state.base === "loaded" && !discard) return;
    this.reading = true; const sequence = ++this.sequence;
    if (discard) { this.pump.dispose(); this.deliveryEpoch++; this.pump = this.makePump(); this.emit({ ready: false, base: "pending", issue: null, sync: idle }); }
    if (this.owner === "guest") { this.ack = { ...this.ack, ...this.pending }; this.pending = {}; this.preimages = {}; this.reading = false; this.cache(); this.emit({ ready: true, base: "loaded", sync: LOCAL_STATUS }); return; }
    try {
      const { response, payload } = await this.http("GET");
      if (this.dead || sequence !== this.sequence) return;
      if (!response.ok || payload.owner !== this.owner || !object(payload.values)) throw new Error(response.status === 401 || response.status === 403 || payload.owner && payload.owner !== this.owner ? "unauthenticated" : "unavailable");
      const scoped = scopeDiscoverWrite(payload.values), values = scoped.data;
      const blocked = payload.blocked === true || scoped.dropped.length > 0 || readDiscoverPreferences(values).blocked;
      // Keep the recoverable draft until a supported account replacement has
      // actually been read. A failed discard/read must not erase the only copy.
      if (discard && !blocked) { this.pending = {}; this.preimages = {}; }
      const conflict = Object.keys(this.pending).some(key => !sameDiscoverValue(values[key], this.pending[key]) &&
        (!Object.hasOwn(this.preimages, key) || !sameDiscoverValue(values[key], this.preimages[key])));
      this.formatBlocked = blocked;
      this.ack = values;
      for (const key of Object.keys(this.pending)) if (sameDiscoverValue(values[key], this.pending[key])) { delete this.pending[key]; delete this.preimages[key]; }
      this.cache(); this.emit({ ready: true, base: "loaded", issue: blocked ? "newer_schema" : conflict ? "conflict" : null });
      if (!blocked && !conflict && Object.keys(this.pending).length) this.pump.queue(this.pending, { oneShot: Object.keys(this.pending) });
    } catch (error) {
      if (!this.dead && sequence === this.sequence) this.emit({ ready: true, base: "retrying", issue: error instanceof Error && error.message === "unauthenticated" ? "unauthenticated" : "unavailable" });
    } finally { if (sequence === this.sequence) this.reading = false; }
  }
  private async send(queued: Values, epoch: number) {
    if (this.dead || epoch !== this.deliveryEpoch || this.state.base !== "loaded") return { error: "not_loaded", retry: false };
    // A coalesced edit can return to the value already ACKed by the preceding
    // request. Let the existing pump finish that revision without a second write.
    const patch = Object.fromEntries(Object.entries(queued).filter(([key]) => Object.hasOwn(this.pending, key)));
    if (!Object.keys(patch).length) return {};
    if (Object.keys(patch).some(key => !Object.hasOwn(this.preimages, key))) { this.emit({ issue: "conflict" }); return { error: "conflict", retry: false }; }
    const expected = Object.fromEntries(Object.keys(patch).map(key => [key, this.preimages[key]]));
    this.sending = true;
    try {
      const { response, payload } = await this.http("PUT", { resource: "discover_views", expectedOwner: this.owner, patch, expected });
      if (this.dead || epoch !== this.deliveryEpoch) return { error: "disposed", retry: false };
      if (!response.ok) {
        const issue: Issue = response.status === 401 || response.status === 403 ? "unauthenticated" : payload.error === "conflict" ? "conflict" : payload.error === "newer_schema" ? "newer_schema" : response.status >= 500 ? "unavailable" : "rejected";
        this.emit({ issue }); return { error: issue, retry: issue === "unavailable" };
      }
      const values = payload.values;
      if (payload.owner !== this.owner || !object(values) || scopeDiscoverWrite(values).dropped.length || readDiscoverPreferences(values).blocked || Object.keys(patch).some(key => !sameDiscoverValue(values[key], patch[key]))) {
        this.emit({ issue: "unavailable" }); return { error: "invalid_ack", retry: false };
      }
      this.ack = scopeDiscoverWrite(values).data;
      for (const key of Object.keys(patch)) {
        if (sameDiscoverValue(this.pending[key], patch[key])) { delete this.pending[key]; delete this.preimages[key]; }
        // A later edit to THIS key was made on top of the in-flight value. Its
        // own acknowledged predecessor is a valid new base; siblings are not.
        else if (Object.hasOwn(this.pending, key)) this.preimages[key] = patch[key] ?? null;
      }
      this.cache(); this.emit({ issue: null }); return {};
    } catch {
      if (!this.dead && epoch === this.deliveryEpoch) this.emit({ issue: "unavailable" });
      return { error: "network", retry: !this.dead && epoch === this.deliveryEpoch };
    } finally { if (epoch === this.deliveryEpoch) this.sending = false; }
  }
  private write(patch: Values): boolean {
    if (this.dead || this.state.base !== "loaded" || this.state.value.blocked || this.state.issue && !["unavailable", "rejected"].includes(this.state.issue)) return false;
    if (this.owner === "guest") { this.ack = { ...this.ack, ...patch }; this.cache(); this.emit({ sync: LOCAL_STATUS }); return true; }
    const changed = Object.fromEntries(Object.entries(patch).filter(([key, value]) => !sameDiscoverValue(Object.hasOwn(this.pending, key) ? this.pending[key] : this.ack[key], value)));
    if (!Object.keys(changed).length) return true;
    for (const key of Object.keys(changed)) if (!Object.hasOwn(this.pending, key)) this.preimages[key] = this.ack[key] ?? null;
    this.pending = { ...this.pending, ...changed }; this.cache(); this.emit();
    this.pump.queue(changed, { oneShot: Object.keys(changed) }); return true;
  }
  save(view: DiscoverView, named: boolean): boolean {
    const next = parseDiscoverView(view), value = this.state.value;
    if (!next || named && !DISCOVER_VIEW_ID.test(next.id) || named && !value.views.some(v => v.id === next.id) && value.views.length >= MAX_DISCOVER_VIEWS) return false;
    return this.write({ [DISCOVER_CURRENT_KEY]: next, ...(named ? { [discoverViewKey(next.id)]: next } : {}) });
  }
  rename(id: string, name: string): boolean {
    const clean = normalizeDiscoverName(name), value = this.state.value, stored = value.views.find(v => v.id === id);
    if (!clean || !stored) return false;
    return this.write({ [discoverViewKey(id)]: { ...stored, name: clean }, ...(value.current?.id === id ? { [DISCOVER_CURRENT_KEY]: { ...value.current, name: clean } } : {}) });
  }
  remove(id: string): boolean {
    const value = this.state.value;
    if (!DISCOVER_VIEW_ID.test(id) || !value.views.some(v => v.id === id)) return false;
    return this.write({ [discoverViewKey(id)]: null, ...(value.current?.id === id ? { [DISCOVER_CURRENT_KEY]: { ...value.current, id: "current", name: "Current view" } } : {}) });
  }
  retry() {
    if (this.state.base !== "loaded") { void this.load(); return; }
    if (!this.state.issue || this.state.issue === "unavailable") this.pump.retryNow();
  }
  dispose() { this.dead = true; this.sequence++; this.pump.dispose(); for (const request of this.requests) request.abort(); }
}
