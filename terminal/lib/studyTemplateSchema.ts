// ── Study templates: the portable record (E07) ───────────────────────────────────────────────
//
// A study template is a NAMED SET OF STUDIES and their settings — nothing else. It is the same
// triple the chart already persists (`inds` / `indParams` / `hidden`, see lib/studyInstances.ts),
// restricted to what a template may own:
//
//   * built-in study instances (a primary "rsi" or an additional "rsi__<token>", E06);
//   * native suites ("structure", "trend", …) with their flat module params and module eye ids;
//   * the Golden Oracle Confluence overlay ("_oracle").
//
// It NEVER carries the symbol, interval, drawings, watchlists, alerts, live-data policy, Day Trade
// Mode, compare overlays or Pine script SOURCE (a script stays in the user's library; a template
// does not copy it). The planner (lib/studyTemplates.ts) enforces the same boundary when a template
// is applied, so a hostile or newer record cannot reach excluded state through either door.
//
// This module is PURE and dependency-light on purpose: the server route validates request bodies
// with it, so it must not import the client-only suite catalog or React.
//
// ── Versions ──
//   v1 (missing `v`): the pre-E07 device record `{id,name,indicators,indParams,createdAt}`.
//   v2: adds `v`, `hidden`, `revision` and `updatedAt`. `indicators`/`indParams` keep their v1
//       names so an older build reading the same device key still understands the record.
//   v > 2: written by a newer build. It is still READ (its study triple is v2-compatible by
//       contract) but flagged `newer`, and this build refuses to rewrite it.

export const STUDY_TEMPLATE_VERSION = 2;

export const STUDY_TEMPLATE_LIMITS = Object.freeze({
  /** Visible characters in a name after normalization. Longer names are refused, not cut. */
  nameMax: 60,
  /** Entries in `indicators`. A chart can hold ~37 portable studies today. */
  studiesMax: 48,
  /** Entries in `hidden`. */
  hiddenMax: 128,
  /** UTF-8 bytes of the serialized study triple. Every study at full defaults is ~9.4 KB. */
  bodyBytesMax: 24 * 1024,
  /** Account templates per owner (one `workspace_settings` row each). */
  templatesMax: 50,
  /** Nesting depth inside one study's params (`_vis.days.on` is depth 3). */
  paramDepthMax: 6,
});

/** `workspace_settings.key` prefix of one account template row. */
export const STUDY_TEMPLATE_KEY_PREFIX = "chart_study_template.";
/** The full key grammar: prefix + 32 lowercase hex (a dash-less uuid). Fits the table's key check. */
export const STUDY_TEMPLATE_KEY_RE = /^chart_study_template\.([0-9a-f]{32})$/;
/** An account template id. */
export const STUDY_TEMPLATE_ID_RE = /^[0-9a-f]{32}$/;
/** A device template id: legacy `ct_…` ids and anything else a v1 build minted, bounded. */
const DEVICE_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
/** One `indicators`/`hidden` entry: built-in ids, suite keys, `suite:<k>/<m>`, `_oracle`. */
const STUDY_KEY_RE = /^[A-Za-z0-9_:./-]{1,64}$/;

const DENIED_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g;

export type StudyTemplateBody = {
  indicators: string[];
  indParams: Record<string, Record<string, unknown>>;
  hidden: string[];
};

export type StudyTemplateRecord = StudyTemplateBody & {
  v: number;
  id: string;
  name: string;
  /** Monotonic per record; every accepted write increments it. The conflict token. */
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type StudyTemplateIssue =
  | "not_an_object"
  | "invalid_key"
  | "duplicate_key"
  | "invalid_params"
  | "orphan_params"
  | "orphan_hidden"
  | "too_many_studies"
  | "too_many_hidden"
  | "too_large"
  | "too_deep";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// --- names -------------------------------------------------------------------------------------

/**
 * Normalize a user-typed name: strip control/bidi characters, collapse whitespace, trim. Returns
 * `null` for an empty or over-long result (it is never silently truncated: the user chose it).
 */
export function normalizeTemplateName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.replace(CONTROL_CHARS, "").replace(/\s+/g, " ").trim();
  if (!name || [...name].length > STUDY_TEMPLATE_LIMITS.nameMax) return null;
  return name;
}

/** Why a name was refused, for the dialog's message. */
export function templateNameProblem(raw: unknown): "empty" | "too_long" | null {
  if (typeof raw !== "string") return "empty";
  const name = raw.replace(CONTROL_CHARS, "").replace(/\s+/g, " ").trim();
  if (!name) return "empty";
  return [...name].length > STUDY_TEMPLATE_LIMITS.nameMax ? "too_long" : null;
}

/** Name identity for duplicate detection: width/case-folded so "RSI pair" and "ｒｓｉ PAIR" collide. */
export function templateNameKey(name: string): string {
  return name.normalize("NFKC").toLocaleLowerCase("en-US");
}

export function sameTemplateName(a: string, b: string): boolean {
  return templateNameKey(a) === templateNameKey(b);
}

// --- body --------------------------------------------------------------------------------------

/** JSON-safe deep sanitize of one param value: drops prototype keys, non-finite numbers, functions. */
function sanitizeValue(value: unknown, depth: number, issues: Set<StudyTemplateIssue>): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (depth >= STUDY_TEMPLATE_LIMITS.paramDepthMax) {
    issues.add("too_deep");
    return undefined;
  }
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) {
      const clean = sanitizeValue(item, depth + 1, issues);
      if (clean !== undefined) out.push(clean);
      else issues.add("invalid_params");
    }
    return out;
  }
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (DENIED_KEYS.has(key)) {
        issues.add("invalid_params");
        continue;
      }
      const clean = sanitizeValue(item, depth + 1, issues);
      if (clean !== undefined) out[key] = clean;
      else issues.add("invalid_params");
    }
    return out;
  }
  issues.add("invalid_params");
  return undefined;
}

/** The suite key a `suite:<k>/<m>` module eye id belongs to, by grammar only. */
export function moduleSuiteKey(id: string): string | null {
  const match = /^suite:([a-z0-9_-]+)\/([a-z0-9_-]+)$/.exec(id);
  return match ? match[1] : null;
}

export function studyTemplateBodyBytes(body: StudyTemplateBody): number {
  return new TextEncoder().encode(JSON.stringify(body)).byteLength;
}

/**
 * Validate an untrusted study triple.
 *
 * `strict` (request bodies a client built from its own chart): ANY issue refuses the body, so the
 * server never stores something other than what was sent. Lenient (records read back from storage,
 * including v1 device records that captured every param on the chart): entries are pruned to the
 * template's own studies and only a non-object refuses; the issues are still reported.
 */
export function normalizeStudyTemplateBody(
  raw: unknown,
  options: { strict?: boolean } = {},
): { body: StudyTemplateBody | null; issues: StudyTemplateIssue[] } {
  const issues = new Set<StudyTemplateIssue>();
  if (!isRecord(raw)) return { body: null, issues: ["not_an_object"] };

  const indicators: string[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(raw.indicators) ? raw.indicators : []) {
    if (typeof item !== "string" || !STUDY_KEY_RE.test(item) || DENIED_KEYS.has(item)) {
      issues.add("invalid_key");
      continue;
    }
    if (seen.has(item)) {
      issues.add("duplicate_key");
      continue;
    }
    seen.add(item);
    indicators.push(item);
  }
  if (raw.indicators !== undefined && !Array.isArray(raw.indicators)) issues.add("invalid_key");

  const indParams: Record<string, Record<string, unknown>> = {};
  const rawParams = raw.indParams;
  if (rawParams !== undefined && !isRecord(rawParams)) issues.add("invalid_params");
  if (isRecord(rawParams)) {
    for (const [key, value] of Object.entries(rawParams)) {
      if (!seen.has(key)) {
        issues.add("orphan_params");
        continue;
      }
      if (!isRecord(value)) {
        issues.add("invalid_params");
        continue;
      }
      indParams[key] = sanitizeValue(value, 1, issues) as Record<string, unknown>;
    }
  }

  const hidden: string[] = [];
  const hiddenSeen = new Set<string>();
  if (raw.hidden !== undefined && !Array.isArray(raw.hidden)) issues.add("invalid_key");
  for (const item of Array.isArray(raw.hidden) ? raw.hidden : []) {
    if (typeof item !== "string" || !STUDY_KEY_RE.test(item)) {
      issues.add("invalid_key");
      continue;
    }
    if (hiddenSeen.has(item)) {
      issues.add("duplicate_key");
      continue;
    }
    const suite = moduleSuiteKey(item);
    if (!seen.has(item) && !(suite && seen.has(suite))) {
      issues.add("orphan_hidden");
      continue;
    }
    hiddenSeen.add(item);
    hidden.push(item);
  }

  const body: StudyTemplateBody = { indicators, indParams, hidden };
  if (indicators.length > STUDY_TEMPLATE_LIMITS.studiesMax) issues.add("too_many_studies");
  if (hidden.length > STUDY_TEMPLATE_LIMITS.hiddenMax) issues.add("too_many_hidden");
  if (studyTemplateBodyBytes(body) > STUDY_TEMPLATE_LIMITS.bodyBytesMax) issues.add("too_large");

  const list = [...issues];
  if (options.strict && list.length) return { body: null, issues: list };
  return { body, issues: list };
}

/** The limit a body breaks, if any — used before a write so the user is told which one. */
export function studyTemplateLimitProblem(body: StudyTemplateBody): "too_many_studies" | "too_many_hidden" | "too_large" | null {
  if (body.indicators.length > STUDY_TEMPLATE_LIMITS.studiesMax) return "too_many_studies";
  if (body.hidden.length > STUDY_TEMPLATE_LIMITS.hiddenMax) return "too_many_hidden";
  if (studyTemplateBodyBytes(body) > STUDY_TEMPLATE_LIMITS.bodyBytesMax) return "too_large";
  return null;
}

// --- records -----------------------------------------------------------------------------------

const isoOrEmpty = (v: unknown): string => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : "");

/**
 * Read one stored record (device array entry or account row value). Lenient by design: a v1 record
 * maps to v2 fields with `revision: 1`; a newer record is read and flagged. `null` = unreadable
 * (kept in storage untouched by every writer, counted for the user).
 */
export function normalizeStudyTemplateRecord(
  raw: unknown,
  options: { expectedId?: string; scope?: "device" | "account" } = {},
): { record: StudyTemplateRecord; newer: boolean } | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === "string" ? raw.id : "";
  const idOk = options.scope === "account" ? STUDY_TEMPLATE_ID_RE.test(id) : DEVICE_ID_RE.test(id);
  if (!idOk) return null;
  if (options.expectedId !== undefined && id !== options.expectedId) return null;
  const name = typeof raw.name === "string" ? raw.name.replace(CONTROL_CHARS, "").replace(/\s+/g, " ").trim() : "";
  if (!name) return null;
  const rawVersion = raw.v === undefined ? 1 : raw.v;
  if (typeof rawVersion !== "number" || !Number.isInteger(rawVersion) || rawVersion < 1) return null;
  const { body } = normalizeStudyTemplateBody(raw);
  if (!body) return null;
  const revision = typeof raw.revision === "number" && Number.isInteger(raw.revision) && raw.revision >= 1 ? raw.revision : 1;
  const createdAt = isoOrEmpty(raw.createdAt);
  const updatedAt = isoOrEmpty(raw.updatedAt) || createdAt;
  return {
    record: { ...body, v: rawVersion, id, name, revision, createdAt, updatedAt },
    newer: rawVersion > STUDY_TEMPLATE_VERSION,
  };
}

export function studyTemplateSettingsKey(id: string): string {
  return `${STUDY_TEMPLATE_KEY_PREFIX}${id}`;
}

// --- writes ------------------------------------------------------------------------------------

/** Why a write was refused before it reached storage. Shared by the device and account stores. */
export type StudyTemplateWriteProblem =
  | "invalid_name"
  | "name_too_long"
  | "empty"
  | "too_many_studies"
  | "too_large"
  | "invalid_body";

/**
 * Validate one user-initiated write. The body is checked STRICTLY: whatever the caller built is
 * stored exactly or not at all, so a "Saved" answer always describes the bytes that were kept.
 */
export function validateStudyTemplateWrite(
  name: unknown,
  body: unknown,
): { ok: true; name: string; body: StudyTemplateBody } | { ok: false; problem: StudyTemplateWriteProblem } {
  const nameProblem = templateNameProblem(name);
  if (nameProblem) return { ok: false, problem: nameProblem === "too_long" ? "name_too_long" : "invalid_name" };
  const parsed = normalizeStudyTemplateBody(body, { strict: true });
  if (!parsed.body) {
    if (parsed.issues.includes("too_many_studies")) return { ok: false, problem: "too_many_studies" };
    if (parsed.issues.includes("too_large") || parsed.issues.includes("too_many_hidden")) return { ok: false, problem: "too_large" };
    return { ok: false, problem: "invalid_body" };
  }
  if (!parsed.body.indicators.length) return { ok: false, problem: "empty" };
  return { ok: true, name: normalizeTemplateName(name)!, body: parsed.body };
}

/** The one v2 record shape both stores write. Old readers keep reading `indicators`/`indParams`. */
export function buildStudyTemplateRecord(input: {
  id: string;
  name: string;
  body: StudyTemplateBody;
  revision: number;
  createdAt: string;
  updatedAt: string;
}): StudyTemplateRecord {
  return {
    v: STUDY_TEMPLATE_VERSION,
    id: input.id,
    name: input.name,
    indicators: [...input.body.indicators],
    indParams: { ...input.body.indParams },
    hidden: [...input.body.hidden],
    revision: input.revision,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

/** A body view of a record (drops identity/version fields). */
export function studyTemplateBodyOf(record: StudyTemplateBody): StudyTemplateBody {
  return { indicators: record.indicators, indParams: record.indParams, hidden: record.hidden };
}
