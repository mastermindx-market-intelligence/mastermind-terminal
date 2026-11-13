import "server-only";
import type { DbResult, DbRow } from "@/lib/watchlists";
import {
  MedTechError, EVENT_ID, PMA_APPLICATION_ID, GENERATION, generation, macroRead, object, type MedTechAuth,
} from "@/lib/medtechServer";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELDS = "id,user_id,subject_type,subject_id,triggers,baseline_generation,baseline_revision,baseline_at,created_at,updated_at,version";
export type SubjectType = "event" | "pma_application";
export type Trigger = "record_changed" | "new_supplement";
export type MedTechWatch = {
  id: string; subject_type: SubjectType; subject_id: string; triggers: Trigger[];
  baseline_generation: string; baseline_revision: string | null; baseline_at: string;
  created_at: string; updated_at: string; version: number;
};

function unavailable(): never { throw new MedTechError(503, "watches_unavailable"); }
function one(result: DbResult): DbRow | null {
  if (result.error) unavailable();
  const data = result.data;
  if (Array.isArray(data)) {
    if (data.length > 1) unavailable();
    return data[0] ?? null;
  }
  return data && typeof data === "object" ? data : null;
}
function subject(type: unknown, id: unknown): { type: SubjectType; id: string } {
  if (typeof id !== "string" ||
      !((type === "event" && EVENT_ID.test(id)) ||
        (type === "pma_application" && PMA_APPLICATION_ID.test(id)))) {
    throw new MedTechError(400, "invalid_subject");
  }
  return { type: type as SubjectType, id };
}
function triggers(value: unknown, type: SubjectType): Trigger[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2 ||
      value.some(x => x !== "record_changed" && !(type === "pma_application" && x === "new_supplement")) ||
      new Set(value).size !== value.length) throw new MedTechError(400, "invalid_triggers");
  return [...value].sort() as Trigger[];
}
function version(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new MedTechError(400, "invalid_version");
  return Number(value);
}
function watch(row: DbRow, owner: string): MedTechWatch {
  try {
    if (row.user_id !== owner || typeof row.id !== "string" || !UUID.test(row.id)) unavailable();
    const s = subject(row.subject_type, row.subject_id);
    const ts = triggers(row.triggers, s.type);
    for (const key of ["baseline_at", "created_at", "updated_at"]) {
      if (typeof row[key] !== "string" || !Number.isFinite(Date.parse(row[key] as string))) unavailable();
    }
    if (row.baseline_revision !== null &&
        (typeof row.baseline_revision !== "string" || !GENERATION.test(row.baseline_revision))) unavailable();
    return {
      id: row.id, subject_type: s.type, subject_id: s.id, triggers: ts,
      baseline_generation: generation(row.baseline_generation),
      baseline_revision: row.baseline_revision as string | null,
      baseline_at: row.baseline_at as string, created_at: row.created_at as string,
      updated_at: row.updated_at as string, version: version(row.version),
    };
  } catch { unavailable(); }
}
function validId(id: string): string {
  if (!UUID.test(id)) throw new MedTechError(404, "watch_not_found");
  return id;
}
export async function getWatch(auth: MedTechAuth, id: string): Promise<MedTechWatch> {
  const row = one(await auth.db.from("medtech_watches").select(FIELDS)
    .eq("user_id", auth.userId).eq("id", validId(id)).maybeSingle());
  if (!row) throw new MedTechError(404, "watch_not_found");
  return watch(row, auth.userId);
}
async function bySubject(auth: MedTechAuth, type: SubjectType, id: string): Promise<MedTechWatch | null> {
  const row = one(await auth.db.from("medtech_watches").select(FIELDS)
    .eq("user_id", auth.userId).eq("subject_type", type).eq("subject_id", id).maybeSingle());
  return row ? watch(row, auth.userId) : null;
}
export async function listWatches(auth: MedTechAuth) {
  const result = await auth.db.from("medtech_watches").select(FIELDS)
    .eq("user_id", auth.userId).order("created_at", { ascending: false }).limit(51);
  if (result.error || !Array.isArray(result.data) || result.data.length > 50) unavailable();
  return { schema: "medtech.watches/v1", items: result.data.map(row => watch(row, auth.userId)), limit: 50 };
}
function sameTriggers(a: readonly Trigger[], b: readonly Trigger[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}
export async function createWatch(auth: MedTechAuth, input: unknown) {
  const data = object(input, ["subject_type", "subject_id", "triggers", "snapshot_id"]);
  const s = subject(data.subject_type, data.subject_id);
  const selected = triggers(data.triggers, s.type);
  const snapshot = generation(data.snapshot_id);
  // Retry an existing save without resetting its baseline, even after publication advances.
  const existing = await bySubject(auth, s.type, s.id);
  if (existing) {
    if (!sameTriggers(existing.triggers, selected)) throw new MedTechError(409, "watch_exists");
    return { schema: "medtech.watch/v1", watch: existing, created: false };
  }
  // Resolve the exact user-selected generation through the authoritative source/paid boundary.
  const source = await macroRead(auth, "/subjects/" + s.type + "/" + s.id,
    new URLSearchParams({ snapshot_id: snapshot }));
  const allowedTriggers = source.allowed_triggers;
  if (source.schema !== "medtech.subject/v1" || source.snapshot_id !== snapshot ||
      source.subject_type !== s.type || source.subject_id !== s.id ||
      !Array.isArray(allowedTriggers) || selected.some(t => !allowedTriggers.includes(t)) ||
      (s.type === "event" ? !GENERATION.test(String(source.baseline_revision)) : source.baseline_revision !== null)) {
    throw new MedTechError(503, "source_unavailable");
  }
  const result = await auth.db.from("medtech_watches").insert({
    user_id: auth.userId, subject_type: s.type, subject_id: s.id, triggers: selected,
    baseline_generation: snapshot, baseline_revision: source.baseline_revision,
  }).select(FIELDS);
  if (result.error) {
    const error = result.error as { code?: string; message?: string };
    if (error.code === "23505") {
      const raced = await bySubject(auth, s.type, s.id);
      if (raced && sameTriggers(raced.triggers, selected)) {
        return { schema: "medtech.watch/v1", watch: raced, created: false };
      }
      throw new MedTechError(409, "watch_exists");
    }
    if (error.code === "P0001" && error.message === "medtech_watch_limit") {
      throw new MedTechError(409, "watch_limit_reached");
    }
    unavailable();
  }
  const row = one(result);
  if (!row) unavailable();
  return { schema: "medtech.watch/v1", watch: watch(row, auth.userId), created: true };
}
export async function updateWatch(auth: MedTechAuth, id: string, input: unknown) {
  const data = object(input, ["version", "triggers"]);
  const current = await getWatch(auth, id);
  const expected = version(data.version);
  const selected = triggers(data.triggers, current.subject_type);
  const row = one(await auth.db.from("medtech_watches").update({ triggers: selected })
    .eq("user_id", auth.userId).eq("id", id).eq("version", expected).select(FIELDS));
  if (!row) throw new MedTechError(409, "watch_changed");
  return { schema: "medtech.watch/v1", watch: watch(row, auth.userId), created: false };
}
export async function deleteWatch(auth: MedTechAuth, id: string, input: unknown) {
  const data = object(input, ["version"]);
  const expected = version(data.version);
  const current = await getWatch(auth, id);
  if (current.version !== expected) throw new MedTechError(409, "watch_changed");
  const row = one(await auth.db.from("medtech_watches").delete()
    .eq("user_id", auth.userId).eq("id", id).eq("version", expected).select("id"));
  if (!row) throw new MedTechError(409, "watch_changed");
  return { schema: "medtech.watch_deleted/v1", id };
}

type Update = Record<string, unknown> & { event_id: string; revision_id: string; trigger: Trigger };
function updates(dto: Record<string, unknown>, current: MedTechWatch): Update[] {
  if (dto.schema !== "medtech.updates/v1" || dto.subject_type !== current.subject_type ||
      dto.subject_id !== current.subject_id || !Array.isArray(dto.items) || dto.items.length > 100) {
    throw new MedTechError(503, "source_unavailable");
  }
  return dto.items.map(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new MedTechError(503, "source_unavailable");
    const item = value as Update;
    if (!EVENT_ID.test(item.event_id) || !GENERATION.test(item.revision_id) ||
        !current.triggers.includes(item.trigger) ||
        !(Date.parse(String(item.observed_at)) > Date.parse(current.baseline_at)) ||
        (current.subject_type === "event" ? item.event_id !== current.subject_id :
          !(item.event_id === current.subject_id || item.event_id.startsWith(current.subject_id + "-S")))) {
      throw new MedTechError(503, "source_unavailable");
    }
    return item;
  });
}
function queryFor(current: MedTechWatch): URLSearchParams {
  const query = new URLSearchParams({
    subject_type: current.subject_type, subject_id: current.subject_id, since: current.baseline_at,
  });
  if (current.triggers.length === 1) query.set("trigger", current.triggers[0]);
  return query;
}
export async function watchUpdates(auth: MedTechAuth, id: string, requested: URLSearchParams) {
  const current = await getWatch(auth, id);
  const query = queryFor(current);
  for (const [key, value] of requested) {
    if (!["limit", "offset", "snapshot_id"].includes(key) || requested.getAll(key).length !== 1) {
      throw new MedTechError(400, "invalid_request");
    }
    if (key === "snapshot_id") generation(value);
    else if (!/^\d{1,6}$/.test(value) || Number(value) > (key === "limit" ? 100 : 100000) ||
        (key === "limit" && Number(value) < 1)) throw new MedTechError(400, "invalid_request");
    query.set(key, value);
  }
  const dto = await macroRead(auth, "/changes", query);
  const items = updates(dto, current);
  const reviewed = new Set<string>();
  if (items.length) {
    const result = await auth.db.from("medtech_reviewed_changes").select("watch_id,user_id,event_id,revision_id")
      .eq("user_id", auth.userId).eq("watch_id", id).in("revision_id", items.map(item => item.revision_id)).limit(100);
    if (result.error || !Array.isArray(result.data)) unavailable();
    for (const row of result.data) {
      if (row.user_id !== auth.userId || row.watch_id !== id) unavailable();
      reviewed.add(row.event_id + ":" + row.revision_id);
    }
  }
  return { ...dto, watch_id: id, watch_version: current.version, baseline_at: current.baseline_at,
    items: items.map(item => ({ ...item, reviewed: reviewed.has(item.event_id + ":" + item.revision_id) })) };
}
export async function reviewChange(auth: MedTechAuth, id: string, input: unknown) {
  const data = object(input, ["event_id", "revision_id", "snapshot_id"]);
  if (typeof data.event_id !== "string" || !EVENT_ID.test(data.event_id)) throw new MedTechError(400, "invalid_event");
  const revision = generation(data.revision_id), snapshot = generation(data.snapshot_id);
  const current = await getWatch(auth, id);
  const query = queryFor(current);
  query.set("snapshot_id", snapshot); query.set("revision_id", revision);
  const dto = await macroRead(auth, "/changes", query);
  if (dto.snapshot_id !== snapshot ||
      !updates(dto, current).some(item => item.event_id === data.event_id && item.revision_id === revision)) {
    throw new MedTechError(409, "change_not_available");
  }
  const result = await auth.db.from("medtech_reviewed_changes").upsert({
    user_id: auth.userId, watch_id: id, event_id: data.event_id, revision_id: revision,
  }, { onConflict: "watch_id,event_id,revision_id", ignoreDuplicates: true });
  if (result.error) unavailable();
  const row = one(await auth.db.from("medtech_reviewed_changes").select("event_id,revision_id,reviewed_at")
    .eq("user_id", auth.userId).eq("watch_id", id).eq("event_id", data.event_id).eq("revision_id", revision).maybeSingle());
  if (!row || typeof row.reviewed_at !== "string" || !Number.isFinite(Date.parse(row.reviewed_at))) unavailable();
  return { schema: "medtech.review/v1", watch_id: id, event_id: data.event_id,
    revision_id: revision, reviewed_at: row.reviewed_at, reviewed: true };
}
