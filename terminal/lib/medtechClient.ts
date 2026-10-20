/**
 * Browser projection of the existing MedTech BFF. No credentials, baseline clock,
 * entitlement decision or account persistence is owned by this module.
 */
export type Trigger = "record_changed" | "new_supplement";
export type Watch = {
  id: string; subject_type: "event" | "pma_application"; subject_id: string;
  triggers: Trigger[]; baseline_generation: string; baseline_revision: string | null;
  baseline_at: string; created_at: string; updated_at: string; version: number;
};
export type Event = {
  event_id: string; submission_id: string; parent_submission_id: string | null;
  pathway: string; pathway_label: string;
  device: { name: string | null; generic_name: string | null; product_code: string | null };
  applicant: { name: string | null };
  decision: { code: string; status: string; label: string; date: string | null; source_description: string | null };
  supplement: { number: string | null; reason: string | null; type: string | null };
  received_on: string | null;
  source: { dataset: string; publisher: string; record_id: string; url: string; source_published_at: string | null };
  first_observed_at: string; last_observed_at: string; last_changed_at: string; revision_id: string;
};
export type Source = {
  dataset: string; cadence: string; dataset_updated_at: string | null; last_checked_at: string;
  status: "available" | "stale"; dataset_age_days: number | null;
  coverage: { kind: string; start: string; end: string; records: number; complete_for_query: boolean };
};
export type Change = {
  json_path: string; change_family: string; op: string;
  before_state: string; before_value: unknown; after_state: string; after_value: unknown;
};
export type Revision = {
  revision_id: string; observed_at: string; kind: string; changes: Change[];
  decision_date: string | null; device_name: string | null;
};
export type Update = Revision & {
  event_id: string; trigger: Trigger; source_url: string; reviewed: boolean;
};
export type Events = {
  schema: "medtech.events/v1"; snapshot_id: string; generated_at: string;
  total: number; items: Event[]; next_offset: number | null; sources: Source[];
};
export type Detail = {
  schema: "medtech.event_detail/v1"; snapshot_id: string; event: Event; history_count: number;
};
export type History = {
  schema: "medtech.changes/v1"; snapshot_id: string; event_id: string;
  total: number; items: Revision[]; next_offset: number | null;
};
export type Updates = {
  schema: "medtech.updates/v1"; snapshot_id: string; watch_id: string; watch_version: number;
  baseline_at: string; total: number; items: Update[]; next_offset: number | null;
};
export type Health = {
  schema: "medtech.health/v1"; snapshot_id: string; generated_at: string;
  state: "available" | "refresh_failed"; sources: Source[];
};
export type Watches = { schema: "medtech.watches/v1"; items: Watch[]; limit: number };

const HASH = /^[0-9a-f]{64}$/;
export const EVENT_ID = /^fda-(?:510k-(?:[A-Z]\d{6}|DEN\d{6})|pma-(?:[A-Z]\d{6}|N\d{5})(?:-S\d{1,6})?)$(?![\s\S])/;
export function familyId(event: Event): string | null {
  return event.source.dataset === "pma" && /^P\d{6}$(?![\s\S])/.test(event.submission_id)
    ? "fda-pma-" + event.submission_id : null;
}
export function fdaUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "www.accessdata.fda.gov" &&
      !url.username && !url.password && !url.port &&
      url.pathname.startsWith("/scripts/cdrh/cfdocs/") ? url.href : null;
  } catch { return null; }
}
export class MedTechClientError extends Error {
  constructor(public status: number, public code: string) { super(code); }
  get access() { return [401, 402, 403].includes(this.status); }
  get stale() { return this.status === 409 && this.code === "snapshot_changed"; }
}
export function asError(error: unknown): MedTechClientError {
  return error instanceof MedTechClientError ? error : new MedTechClientError(503, "connection_failed");
}
export function isAborted(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function fail(): never { throw new MedTechClientError(503, "invalid_response"); }
function record(value: unknown): Record<string, unknown> { return object(value) ? value : fail(); }
function nullableText(value: unknown) { return value === null || typeof value === "string"; }
function event(value: unknown): value is Event {
  if (!object(value) || typeof value.event_id !== "string" || !EVENT_ID.test(value.event_id) ||
      typeof value.submission_id !== "string" || typeof value.pathway !== "string" ||
      !object(value.device) || !object(value.applicant) || !object(value.decision) ||
      !object(value.supplement) || !object(value.source)) return false;
  return nullableText(value.device.name) && nullableText(value.device.generic_name) &&
    nullableText(value.applicant.name) && typeof value.decision.status === "string" &&
    typeof value.decision.code === "string" && nullableText(value.decision.date) &&
    typeof value.source.url === "string" && typeof value.source.dataset === "string" &&
    typeof value.revision_id === "string" && HASH.test(value.revision_id);
}
function revision(value: unknown): value is Revision {
  return object(value) && typeof value.revision_id === "string" && HASH.test(value.revision_id) &&
    typeof value.observed_at === "string" && typeof value.kind === "string" &&
    Array.isArray(value.changes) && value.changes.every(c => object(c) &&
      typeof c.json_path === "string" && typeof c.before_state === "string" && typeof c.after_state === "string");
}
function source(value: unknown): value is Source {
  return object(value) && typeof value.dataset === "string" && nullableText(value.dataset_updated_at) &&
    typeof value.last_checked_at === "string" && object(value.coverage) &&
    typeof value.coverage.start === "string" && typeof value.coverage.end === "string" &&
    typeof value.coverage.records === "number";
}
function watch(value: unknown): value is Watch {
  return object(value) && typeof value.id === "string" &&
    ["event", "pma_application"].includes(String(value.subject_type)) &&
    typeof value.subject_id === "string" && Array.isArray(value.triggers) &&
    value.triggers.length > 0 && value.triggers.every(t => t === "record_changed" || t === "new_supplement") &&
    typeof value.baseline_at === "string" && Number.isSafeInteger(value.version);
}
function schema(value: unknown, expected: string, generation = true) {
  const d = record(value);
  if (d.schema !== expected || (generation && (typeof d.snapshot_id !== "string" || !HASH.test(d.snapshot_id)))) fail();
  return d;
}
function page(d: Record<string, unknown>) {
  if (!Number.isSafeInteger(d.total) || Number(d.total) < 0 ||
      !(d.next_offset === null || (Number.isSafeInteger(d.next_offset) && Number(d.next_offset) > 0))) fail();
}
export function readEvents(value: unknown): Events {
  const d = schema(value, "medtech.events/v1"); page(d);
  if (!Array.isArray(d.items) || d.items.length > 100 || !d.items.every(event) ||
      !Array.isArray(d.sources) || !d.sources.every(source)) fail();
  return d as unknown as Events;
}
export function readDetail(value: unknown): Detail {
  const d = schema(value, "medtech.event_detail/v1"); if (!event(d.event)) fail();
  return d as unknown as Detail;
}
export function readHistory(value: unknown): History {
  const d = schema(value, "medtech.changes/v1"); page(d);
  if (!Array.isArray(d.items) || d.items.length > 100 || !d.items.every(revision)) fail();
  return d as unknown as History;
}
export function readUpdates(value: unknown): Updates {
  const d = schema(value, "medtech.updates/v1"); page(d);
  if (!Array.isArray(d.items) || d.items.length > 100 || !d.items.every(x => revision(x) &&
    typeof (x as Update).event_id === "string" && EVENT_ID.test((x as Update).event_id) &&
    typeof (x as Update).reviewed === "boolean" && typeof (x as Update).source_url === "string")) fail();
  return d as unknown as Updates;
}
export function readHealth(value: unknown): Health {
  const d = schema(value, "medtech.health/v1");
  if (!["available", "refresh_failed"].includes(String(d.state)) || !Array.isArray(d.sources) || !d.sources.every(source)) fail();
  return d as unknown as Health;
}
export function readWatches(value: unknown): Watches {
  const d = schema(value, "medtech.watches/v1", false);
  if (!Array.isArray(d.items) || d.items.length > 50 || !d.items.every(watch)) fail();
  return d as unknown as Watches;
}
export function readWatch(value: unknown): Watch {
  const d = schema(value, "medtech.watch/v1", false);
  return watch(d.watch) ? d.watch : fail();
}
/** Same-origin cookie session only. Generation checks prevent mixed-source rendering. */
export async function medtechRequest<T>(
  path: string, decode: (value: unknown) => T,
  options: { signal?: AbortSignal; method?: "POST" | "PATCH" | "DELETE"; body?: unknown; snapshot?: string } = {},
): Promise<T> {
  const response = await fetch("/api/medtech" + path, {
    method: options.method ?? "GET", cache: "no-store", credentials: "same-origin",
    signal: options.signal, headers: options.body === undefined ? { Accept: "application/json" } :
      { Accept: "application/json", "Content-Type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const raw: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = object(raw) && typeof raw.code === "string" ? raw.code.toLowerCase() : "request_failed";
    throw new MedTechClientError(response.status, code);
  }
  if (options.snapshot && (!object(raw) || raw.snapshot_id !== options.snapshot)) {
    throw new MedTechClientError(409, "snapshot_changed");
  }
  return decode(raw);
}
export function confirmReview(value: unknown, watchId: string, item: Update): void {
  const d = schema(value, "medtech.review/v1", false);
  if (d.reviewed !== true || d.watch_id !== watchId || d.event_id !== item.event_id ||
      d.revision_id !== item.revision_id || typeof d.reviewed_at !== "string") fail();
}
export function confirmDelete(value: unknown, watchId: string): void {
  const d = schema(value, "medtech.watch_deleted/v1", false);
  if (d.id !== watchId) fail();
}
