import type { DbResult, WatchlistDb } from "@/lib/watchlists";

export const THESIS_CONTENT_SCHEMA = "mastermind.thesis-content/v1" as const;
export const THESIS_SUBJECT_SCHEMA = "mastermind.thesis-subject-ref/v1" as const;
export const MAX_THESIS_TITLE = 160;
export const MAX_THESIS_STATEMENT = 12_000;
export const MAX_THESIS_LIST_ITEMS = 20;
export const MAX_THESIS_ITEM = 500;
export const MAX_REVISION_NOTE = 1_000;
export const MAX_THESIS_HISTORY = 500;

export type ThesisLifecycle = "active" | "archived" | "invalidated";
export type ThesisAction = "create" | "revise" | "archive" | "invalidate" | "reopen";
export type ThesisHorizon = "unspecified" | "days" | "weeks" | "months" | "quarters" | "years";
export type ThesisIdentityState = "resolved" | "listing_scoped";

export type ThesisSubjectRef = {
  schema: typeof THESIS_SUBJECT_SCHEMA;
  kind: "issuer" | "theme";
  owner: "data_os.security_master" | "terminal.analysis_symbol" | "macro.theme_registry";
  key: string;
  identityState: ThesisIdentityState;
  listing?: { symbol: string; mic: string | null; securityId: string | null };
  companyId?: string | null;
  display: string;
};

export type ThesisContent = {
  schema: typeof THESIS_CONTENT_SCHEMA;
  title: string;
  statement: string;
  catalysts: string[];
  falsifiers: string[];
  risks: string[];
  horizon: ThesisHorizon;
  effectiveAt: string | null;
  revisionNote: string | null;
};

export type ThesisVersion = {
  id: string;
  thesisId: string;
  version: number;
  previousVersion: number | null;
  transition: ThesisAction;
  lifecycleState: ThesisLifecycle;
  subject: ThesisSubjectRef;
  content: ThesisContent;
  clientRequestId: string;
  systemRecordedAt: string;
  effectiveAt: string | null;
};

export type ThesisSummary = {
  id: string;
  currentVersion: number;
  lifecycleState: ThesisLifecycle;
  subject: ThesisSubjectRef;
  title: string;
  updatedAt: string;
};

export type ThesisDetail = ThesisSummary & {
  createdAt: string;
  current: ThesisVersion;
  history: ThesisVersion[];
  historyTruncated: boolean;
};

export type ThesisRpcArgs = Record<string, unknown>;
export type ThesisDb = WatchlistDb & {
  rpc: (name: string, args: ThesisRpcArgs) => Promise<DbResult>;
};

export type ThesisMutationInput = {
  action: ThesisAction;
  id: string | null;
  expectedVersion: number;
  clientRequestId: string;
  subject: unknown;
  content: unknown;
};

export type ThesisMutationResult =
  | {
    ok: true;
    status: "created" | "advanced" | "replayed";
    thesisId: string;
    version: number;
    lifecycleState: ThesisLifecycle;
    replayed: boolean;
  }
  | {
    ok: false;
    status: "version_conflict";
    currentVersion: number;
    lifecycleState: ThesisLifecycle;
    error: string;
  }
  | {
    ok: false;
    status: "idempotency_conflict" | "not_found" | "invalid_transition" | "invalid_payload" | "unavailable";
    error: string;
  };

export type ThesisRead =
  | { ok: true; thesis: ThesisDetail }
  | { ok: false; status: "not_found" | "unavailable"; error: string };

export type ThesisListRead =
  | { ok: true; theses: ThesisSummary[]; truncated: boolean }
  | { ok: false; status: "unavailable"; error: string };

export type ThesisSubjectFilter = Pick<ThesisSubjectRef, "owner" | "kind" | "key">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_EXCEPT_BREAKS = /[\u0000-\u0008\u000b-\u001f\u007f]/;
const CONTROL_ALL = /[\u0000-\u001f\u007f]/;
const HORIZONS = new Set<ThesisHorizon>(["unspecified", "days", "weeks", "months", "quarters", "years"]);
const LIFECYCLES = new Set<ThesisLifecycle>(["active", "archived", "invalidated"]);
const ACTIONS = new Set<ThesisAction>(["create", "revise", "archive", "invalidate", "reopen"]);
const SUBJECT_OWNERS = new Set<ThesisSubjectRef["owner"]>([
  "data_os.security_master", "terminal.analysis_symbol", "macro.theme_registry",
]);

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const permitted = new Set(allowed);
  return Object.keys(value).every((key) => permitted.has(key));
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedText(value: unknown, max: number, required: boolean): string | null {
  if (value === null && !required) return null;
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if ((required && !normalized) || normalized.length > max || CONTROL_EXCEPT_BREAKS.test(normalized)) return null;
  return normalized || null;
}

function nullableBoundedText(value: unknown, max: number): { ok: boolean; value: string | null } {
  if (value === null || value === "") return { ok: true, value: null };
  const normalized = boundedText(value, max, false);
  return normalized === null ? { ok: false, value: null } : { ok: true, value: normalized };
}

function boundedSingleLineText(value: unknown, max: number, required: boolean): string | null {
  const normalized = boundedText(value, max, required);
  return normalized === null || CONTROL_ALL.test(normalized) ? null : normalized;
}

function nullableSingleLineText(value: unknown, max: number): { ok: boolean; value: string | null } {
  if (value === null || value === "") return { ok: true, value: null };
  const normalized = boundedSingleLineText(value, max, false);
  return normalized === null ? { ok: false, value: null } : { ok: true, value: normalized };
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_THESIS_LIST_ITEMS) return null;
  const items: string[] = [];
  for (const item of value) {
    const normalized = boundedSingleLineText(item, MAX_THESIS_ITEM, true);
    if (!normalized) return null;
    items.push(normalized);
  }
  return items;
}

function isoTimestamp(value: unknown): string | null | undefined {
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function normalizeThesisSubject(value: unknown): ThesisSubjectRef | null {
  const raw = record(value);
  if (!raw || !exactKeys(raw, ["schema", "kind", "owner", "key", "identityState", "listing", "companyId", "display"])) return null;
  if (raw.schema !== THESIS_SUBJECT_SCHEMA || (raw.kind !== "issuer" && raw.kind !== "theme")) return null;
  if (typeof raw.owner !== "string" || !SUBJECT_OWNERS.has(raw.owner as ThesisSubjectRef["owner"])) return null;
  if ((raw.owner === "macro.theme_registry" && raw.kind !== "theme")
    || (raw.owner !== "macro.theme_registry" && raw.kind !== "issuer")) return null;
  if (raw.identityState !== "resolved" && raw.identityState !== "listing_scoped") return null;
  const key = boundedSingleLineText(raw.key, 256, true);
  const display = boundedSingleLineText(raw.display, 256, true);
  if (!key || !display) return null;

  let listing: ThesisSubjectRef["listing"];
  if (raw.listing !== undefined) {
    const candidate = record(raw.listing);
    if (!candidate || !exactKeys(candidate, ["symbol", "mic", "securityId"])) return null;
    const symbol = boundedSingleLineText(candidate.symbol, 128, true);
    const mic = nullableSingleLineText(candidate.mic, 32);
    const securityId = nullableSingleLineText(candidate.securityId, 256);
    if (!symbol || !mic.ok || !securityId.ok) return null;
    listing = { symbol: symbol.toUpperCase(), mic: mic.value, securityId: securityId.value };
  }
  if (raw.identityState === "listing_scoped" && (!listing || raw.owner !== "terminal.analysis_symbol")) return null;
  if (raw.kind === "theme" && listing) return null;
  const company = nullableSingleLineText(raw.companyId ?? null, 256);
  if (!company.ok) return null;
  return {
    schema: THESIS_SUBJECT_SCHEMA,
    kind: raw.kind,
    owner: raw.owner as ThesisSubjectRef["owner"],
    key,
    identityState: raw.identityState,
    ...(listing ? { listing } : {}),
    companyId: company.value,
    display,
  };
}

export function normalizeThesisContent(value: unknown): ThesisContent | null {
  const raw = record(value);
  if (!raw || !exactKeys(raw, [
    "schema", "title", "statement", "catalysts", "falsifiers", "risks", "horizon", "effectiveAt", "revisionNote",
  ])) return null;
  if (raw.schema !== THESIS_CONTENT_SCHEMA || typeof raw.horizon !== "string" || !HORIZONS.has(raw.horizon as ThesisHorizon)) return null;
  const title = boundedSingleLineText(raw.title, MAX_THESIS_TITLE, true);
  const statement = boundedText(raw.statement, MAX_THESIS_STATEMENT, true);
  const catalysts = stringList(raw.catalysts);
  const falsifiers = stringList(raw.falsifiers);
  const risks = stringList(raw.risks);
  const effectiveAt = isoTimestamp(raw.effectiveAt);
  const revisionNote = nullableBoundedText(raw.revisionNote, MAX_REVISION_NOTE);
  if (!title || !statement || !catalysts || !falsifiers || !risks || effectiveAt === undefined || !revisionNote.ok) return null;
  return {
    schema: THESIS_CONTENT_SCHEMA,
    title,
    statement,
    catalysts,
    falsifiers,
    risks,
    horizon: raw.horizon as ThesisHorizon,
    effectiveAt,
    revisionNote: revisionNote.value,
  };
}

function subjectToWire(subject: ThesisSubjectRef): Record<string, unknown> {
  return {
    schema: subject.schema,
    kind: subject.kind,
    owner: subject.owner,
    key: subject.key,
    identity_state: subject.identityState,
    ...(subject.listing ? {
      listing: {
        symbol: subject.listing.symbol,
        mic: subject.listing.mic,
        security_id: subject.listing.securityId,
      },
    } : {}),
    company_id: subject.companyId ?? null,
    display: subject.display,
  };
}

function contentToWire(content: ThesisContent): Record<string, unknown> {
  return {
    schema: content.schema,
    title: content.title,
    statement: content.statement,
    catalysts: content.catalysts,
    falsifiers: content.falsifiers,
    risks: content.risks,
    horizon: content.horizon,
    effective_at: content.effectiveAt,
    revision_note: content.revisionNote,
  };
}

function one(result: DbResult): Record<string, unknown> | null {
  const data = result?.data;
  if (Array.isArray(data)) return (data[0] as Record<string, unknown> | undefined) ?? null;
  return data && typeof data === "object" ? data as Record<string, unknown> : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function lifecycle(value: unknown): ThesisLifecycle | null {
  return typeof value === "string" && LIFECYCLES.has(value as ThesisLifecycle) ? value as ThesisLifecycle : null;
}

function wireSubject(value: unknown): ThesisSubjectRef | null {
  const raw = record(value);
  if (!raw || !exactKeys(raw, ["schema", "kind", "owner", "key", "identity_state", "listing", "company_id", "display"])) return null;
  const listingRaw = record(raw.listing);
  if (raw.listing !== undefined && (!listingRaw || !exactKeys(listingRaw, ["symbol", "mic", "security_id"]))) return null;
  return normalizeThesisSubject({
    schema: raw.schema,
    kind: raw.kind,
    owner: raw.owner,
    key: raw.key,
    identityState: raw.identity_state,
    ...(listingRaw ? { listing: {
      symbol: listingRaw.symbol,
      mic: listingRaw.mic,
      securityId: listingRaw.security_id,
    } } : {}),
    companyId: raw.company_id,
    display: raw.display,
  });
}

function wireContent(value: unknown): ThesisContent | null {
  const raw = record(value);
  if (!raw || !exactKeys(raw, [
    "schema", "title", "statement", "catalysts", "falsifiers", "risks", "horizon", "effective_at", "revision_note",
  ])) return null;
  return normalizeThesisContent({
    schema: raw.schema,
    title: raw.title,
    statement: raw.statement,
    catalysts: raw.catalysts,
    falsifiers: raw.falsifiers,
    risks: raw.risks,
    horizon: raw.horizon,
    effectiveAt: raw.effective_at,
    revisionNote: raw.revision_note,
  });
}

function rowToVersion(row: Record<string, unknown>): ThesisVersion | null {
  const id = text(row.id);
  const thesisId = text(row.thesis_id);
  const version = positiveInteger(row.version);
  const transition = typeof row.transition === "string" && ACTIONS.has(row.transition as ThesisAction)
    ? row.transition as ThesisAction : null;
  const lifecycleState = lifecycle(row.lifecycle_state);
  const subject = wireSubject(row.subject_ref);
  const content = wireContent(row.content);
  const clientRequestId = text(row.client_request_id);
  const systemRecordedAt = text(row.system_recorded_at);
  if (!id || !thesisId || !version || !transition || !lifecycleState || !subject || !content || !clientRequestId || !systemRecordedAt) return null;
  const previousVersion = row.previous_version === null ? null : positiveInteger(row.previous_version);
  if ((row.previous_version !== null && previousVersion === null)
    || (version === 1 && (previousVersion !== null || transition !== "create"))
    || (version > 1 && (previousVersion !== version - 1 || transition === "create"))) return null;
  return {
    id,
    thesisId,
    version,
    previousVersion,
    transition,
    lifecycleState,
    subject,
    content,
    clientRequestId,
    systemRecordedAt,
    effectiveAt: text(row.effective_at),
  };
}

export async function applyThesisVersion(
  db: ThesisDb,
  userId: string,
  input: ThesisMutationInput,
): Promise<ThesisMutationResult> {
  if (!ACTIONS.has(input.action) || !isUuid(input.clientRequestId)) {
    return { ok: false, status: "invalid_payload", error: "invalid thesis mutation" };
  }
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) {
    return { ok: false, status: "invalid_payload", error: "invalid expected version" };
  }
  if (input.action === "create") {
    if (input.id !== null || input.expectedVersion !== 0) {
      return { ok: false, status: "invalid_payload", error: "invalid create identity" };
    }
  } else if (!isUuid(input.id) || input.expectedVersion < 1) {
    return { ok: false, status: "invalid_payload", error: "invalid thesis identity" };
  }
  const subject = normalizeThesisSubject(input.subject);
  const content = normalizeThesisContent(input.content);
  if (!subject || !content) return { ok: false, status: "invalid_payload", error: "invalid thesis payload" };
  if (input.action === "invalidate" && !content.revisionNote) {
    return { ok: false, status: "invalid_payload", error: "invalidation reason required" };
  }

  let result: DbResult;
  try {
    result = await db.rpc("apply_thesis_version_v1", {
      p_thesis_id: input.id,
      p_expected_version: input.expectedVersion,
      p_transition: input.action,
      p_subject_ref: subjectToWire(subject),
      p_content: contentToWire(content),
      p_client_request_id: input.clientRequestId,
      p_effective_at: content.effectiveAt,
    });
  } catch (cause) {
    return { ok: false, status: "unavailable", error: cause instanceof Error ? cause.message : "thesis store unavailable" };
  }
  if (result?.error) return { ok: false, status: "unavailable", error: result.error.message || "thesis store unavailable" };
  const row = one(result);
  const status = text(row?.status)?.toLowerCase();
  if (!row || !status) return { ok: false, status: "unavailable", error: "thesis mutation returned no canonical result" };
  if (status === "created" || status === "advanced" || status === "replayed") {
    const thesisId = text(row.thesis_id);
    const version = positiveInteger(row.version);
    const lifecycleState = lifecycle(row.lifecycle_state);
    if (!thesisId || !version || !lifecycleState) {
      return { ok: false, status: "unavailable", error: "thesis mutation returned an invalid result" };
    }
    return { ok: true, status, thesisId, version, lifecycleState, replayed: status === "replayed" || row.replayed === true };
  }
  if (status === "version_conflict") {
    const currentVersion = positiveInteger(row.current_version);
    const lifecycleState = lifecycle(row.lifecycle_state);
    if (!currentVersion || !lifecycleState) return { ok: false, status: "unavailable", error: "invalid conflict result" };
    return { ok: false, status, currentVersion, lifecycleState, error: "version conflict" };
  }
  if (status === "idempotency_conflict" || status === "not_found" || status === "invalid_transition") {
    return { ok: false, status, error: status.replaceAll("_", " ") };
  }
  return { ok: false, status: "unavailable", error: "unknown thesis mutation result" };
}

const HEAD_FIELDS = "id,current_version,lifecycle_state,subject_ref,created_at,updated_at";
const VERSION_FIELDS = "id,thesis_id,version,previous_version,transition,lifecycle_state,subject_ref,content,client_request_id,system_recorded_at,effective_at";

export async function readThesis(db: ThesisDb, userId: string, thesisId: string): Promise<ThesisRead> {
  if (!isUuid(thesisId)) return { ok: false, status: "not_found", error: "thesis not found" };
  try {
    const headResult = await db.from("theses").select(HEAD_FIELDS)
      .eq("user_id", userId).eq("id", thesisId).maybeSingle();
    if (headResult?.error) return { ok: false, status: "unavailable", error: headResult.error.message || "thesis store unavailable" };
    const head = one(headResult);
    if (!head) return { ok: false, status: "not_found", error: "thesis not found" };
    const versionResult = await db.from("thesis_versions").select(VERSION_FIELDS)
      .eq("user_id", userId).eq("thesis_id", thesisId)
      .order("version", { ascending: false }).limit(MAX_THESIS_HISTORY + 1);
    if (versionResult?.error || !Array.isArray(versionResult?.data)) {
      return { ok: false, status: "unavailable", error: versionResult?.error?.message || "thesis history unavailable" };
    }
    const parsedHistory = versionResult.data.map((row) => rowToVersion(row));
    if (parsedHistory.some((row) => !row)) {
      return { ok: false, status: "unavailable", error: "thesis history is malformed" };
    }
    const history = parsedHistory as ThesisVersion[];
    const currentVersion = positiveInteger(head.current_version);
    const lifecycleState = lifecycle(head.lifecycle_state);
    const subject = wireSubject(head.subject_ref);
    const createdAt = text(head.created_at);
    const updatedAt = text(head.updated_at);
    const current = history.find((item) => item.version === currentVersion);
    if (!currentVersion || !lifecycleState || !subject || !createdAt || !updatedAt || !current
      || current.thesisId !== thesisId || current.lifecycleState !== lifecycleState
      || JSON.stringify(current.subject) !== JSON.stringify(subject)) {
      return { ok: false, status: "unavailable", error: "thesis head and lineage disagree" };
    }
    return {
      ok: true,
      thesis: {
        id: thesisId,
        currentVersion,
        lifecycleState,
        subject,
        title: current.content.title,
        createdAt,
        updatedAt,
        current,
        history: history.slice(0, MAX_THESIS_HISTORY),
        historyTruncated: history.length > MAX_THESIS_HISTORY,
      },
    };
  } catch (cause) {
    return { ok: false, status: "unavailable", error: cause instanceof Error ? cause.message : "thesis store unavailable" };
  }
}

export async function listTheses(
  db: ThesisDb,
  userId: string,
  limit = 200,
  filter?: ThesisSubjectFilter,
): Promise<ThesisListRead> {
  const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
  try {
    let query = db.from("theses").select(HEAD_FIELDS).eq("user_id", userId);
    if (filter) {
      query = query.eq("subject_ref->>owner", filter.owner)
        .eq("subject_ref->>kind", filter.kind)
        .eq("subject_ref->>key", filter.key);
    }
    const result = await query.order("updated_at", { ascending: false }).order("id").limit(boundedLimit + 1);
    if (result?.error || !Array.isArray(result?.data)) {
      return { ok: false, status: "unavailable", error: result?.error?.message || "thesis store unavailable" };
    }
    const summaries: ThesisSummary[] = [];
    for (const row of result.data.slice(0, boundedLimit)) {
      const id = text(row.id);
      const currentVersion = positiveInteger(row.current_version);
      const lifecycleState = lifecycle(row.lifecycle_state);
      const subject = wireSubject(row.subject_ref);
      const updatedAt = text(row.updated_at);
      if (!id || !currentVersion || !lifecycleState || !subject || !updatedAt) {
        return { ok: false, status: "unavailable", error: "thesis head and lineage disagree" };
      }
      const version = await db.from("thesis_versions").select(VERSION_FIELDS)
        .eq("user_id", userId).eq("thesis_id", id).eq("version", currentVersion).maybeSingle();
      if (version?.error) return { ok: false, status: "unavailable", error: version.error.message || "thesis store unavailable" };
      const current = one(version);
      const parsed = current ? rowToVersion(current) : null;
      if (!parsed || parsed.thesisId !== id || parsed.version !== currentVersion
        || parsed.lifecycleState !== lifecycleState || JSON.stringify(parsed.subject) !== JSON.stringify(subject)) {
        return { ok: false, status: "unavailable", error: "thesis head and lineage disagree" };
      }
      summaries.push({ id, currentVersion, lifecycleState, subject, title: parsed.content.title, updatedAt });
    }
    return { ok: true, theses: summaries, truncated: result.data.length > boundedLimit };
  } catch (cause) {
    return { ok: false, status: "unavailable", error: cause instanceof Error ? cause.message : "thesis store unavailable" };
  }
}
