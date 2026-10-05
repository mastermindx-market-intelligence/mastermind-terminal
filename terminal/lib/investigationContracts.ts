/**
 * P1 Investigation command boundary. This is NOT a persistence, identity, evidence,
 * or entitlement owner. An accepted shape still needs authenticated owner resolution
 * and a same-owner transaction. It cannot certify that a referenced object exists.
 *
 * Server-owned clocks/authors/qualification are rejected, not discarded. Canonical
 * serialization preserves authored text. No I/O or implicit writes occur.
 */
export const INVESTIGATION_MANIFEST_SCHEMA = "investigation_manifest.v1" as const;
export const INVESTIGATION_MANIFEST_MAX_BYTES = 64 * 1024;
export const INVESTIGATION_MANIFEST_SCHEMA_V2 = "investigation_manifest.v2" as const;
export const INVESTIGATION_MANIFEST_V2_MAX_BYTES = 128 * 1024;
const MAX_ERRORS = 32;
const MAX_NODES = 16384;
const SUBJECT_KINDS = new Set([
  "security", "issuer", "industry", "subtheme", "theme", "regime", "economy",
  "event", "portfolio", "option_underlying", "option_contract", "policy_question",
]);

export type InvestigationSubject = {
  kind: string;
  owner: string;
  object_id: string;
  version_ref?: string;
};
export type InvestigationLayoutRef = {
  layout_id: string;
  layout_revision_id: string;
  digest: string;
  role: "primary" | "supporting";
};
export type InvestigationThesisRef = {
  thesis_id: string;
  version_id: string;
  role: "primary" | "alternative" | "context";
};
export type InvestigationEvidenceRef = {
  owner: string;
  object_type: string;
  object_id: string;
  mode: "pinned" | "follow_head";
  version_ref?: string;
  fingerprint?: string;
  selection?: { field: string };
};
export type InvestigationManifest = {
  schema: typeof INVESTIGATION_MANIFEST_SCHEMA | typeof INVESTIGATION_MANIFEST_SCHEMA_V2;
  intent: {
    title: string;
    question: string;
    subjects: InvestigationSubject[];
    horizon?: string;
    research_as_of?: string;
  };
  layout_refs: InvestigationLayoutRef[];
  thesis_refs: InvestigationThesisRef[];
  evidence_refs: InvestigationEvidenceRef[];
  /** Required for new v2 commands; absent only in v1 or pre-repair stored rows. */
  argument_relations?: InvestigationArgumentRelation[];
  continuation: { next_question?: string; next_observation?: string };
  review_baseline_ref?: InvestigationEvidenceRef;
};
export type InvestigationArgumentEndpoint =
  | { kind: "thesis"; thesis_id: string; version_id: string }
  | ({ kind: "evidence" } & Omit<InvestigationEvidenceRef, "fingerprint">);
export type InvestigationArgumentRelation = {
  source: InvestigationArgumentEndpoint;
  target: InvestigationArgumentEndpoint;
  relation: "supports" | "weakens" | "contradicts" | "unresolved_interpretation" | "discriminates_between";
  rationale: string;
  discrimination_criterion?: string;
};

/** Only call on validated semantic JSON. Keys are ASCII in this closed schema. */
export function canonicalInvestigationJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalInvestigationJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map(key =>
    `${JSON.stringify(key)}:${canonicalInvestigationJson((value as Obj)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
/** Supplied by existing admitted adapters. This module owns no adapter registry. */
export type InvestigationAdmission = {
  subjects?: readonly { owner: string; kinds: readonly string[] }[];
  evidence?: readonly { owner: string; object_types: readonly string[] }[];
};
export type InvestigationValidationError = { path: string; code: string };
export type InvestigationValidationResult =
  | { ok: true; value: InvestigationManifest }
  | { ok: false; errors: InvestigationValidationError[] };

type Obj = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const NAMESPACE = /^[a-z][a-z0-9_.-]{0,63}$/;
const FIELD = /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$/;
const CONTROL = /[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

class Validator {
  readonly errors: InvestigationValidationError[] = [];
  private nodes = 0;
  private stringUnits = 0;
  private readonly ancestors = new WeakSet<object>();
  constructor(private readonly admission: InvestigationAdmission, private readonly legacyStored = false) {}
  add(path: string, code: string): void {
    if (this.errors.length < MAX_ERRORS) this.errors.push({ path, code });
  }
  /** Refuse objects whose JSON serialization would execute code or drop information. */
  dataOnly(value: unknown, path = "$", depth = 0): boolean {
    if (++this.nodes > MAX_NODES || depth > 24) {
      this.add(path, "non_json_value"); return false;
    }
    if (value === null || typeof value === "boolean") return true;
    if (typeof value === "string") {
      this.stringUnits += value.length;
      if (this.stringUnits > INVESTIGATION_MANIFEST_V2_MAX_BYTES) {
        this.add("$", "manifest_too_large"); return false;
      }
      return true;
    }
    if (typeof value === "number" && Number.isFinite(value)) return true;
    if (typeof value !== "object" || value === null) {
      this.add(path, "non_json_value"); return false;
    }
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    const plain = array ? prototype === Array.prototype : prototype === Object.prototype || prototype === null;
    if (!plain || this.ancestors.has(value)) {
      this.add(path, "non_json_value"); return false;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (array && keys.length !== value.length + 1) {
      this.add(path, "non_json_value"); return false;
    }
    this.ancestors.add(value);
    let valid = true;
    for (const key of keys) {
      if (array && key === "length") continue;
      if (typeof key !== "string") { this.add(path, "non_json_value"); valid = false; break; }
      const descriptor = descriptors[key];
      if (!Object.hasOwn(descriptor, "value") || !descriptor.enumerable ||
          (array && !/^(0|[1-9][0-9]*)$/.test(key))) {
        this.add(path, "non_json_value"); valid = false; break;
      }
      if (!this.dataOnly(descriptor.value, array ? `${path}[${key}]` : `${path}.${key}`, depth + 1)) {
        valid = false; break;
      }
    }
    this.ancestors.delete(value);
    return valid;
  }
  object(value: unknown, path: string, required: readonly string[], optional: readonly string[] = []): Obj | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      this.add(path, "invalid_type"); return null;
    }
    const result = value as Obj;
    const allowed = new Set([...required, ...optional]);
    for (const key of Object.keys(result)) if (!allowed.has(key)) this.add(`${path}.${key}`, "unknown_field");
    for (const key of required) if (!Object.hasOwn(result, key)) this.add(`${path}.${key}`, "missing_field");
    return result;
  }
  text(value: unknown, path: string, max: number, singleLine = false): value is string {
    if (typeof value !== "string") { this.add(path, "invalid_type"); return false; }
    if (value.trim().length === 0) { this.add(path, "empty_text"); return false; }
    let count = 0;
    for (const character of value) {
      const point = character.codePointAt(0)!;
      if (point >= 0xd800 && point <= 0xdfff) { this.add(path, "invalid_unicode"); return false; }
      if (point === 0) { this.add(path, "unsupported_code_point"); return false; }
      if (++count > max) { this.add(path, "text_too_long"); return false; }
    }
    if (CONTROL.test(value) || (singleLine && /[\r\n\t]/.test(value))) {
      this.add(path, "invalid_control"); return false;
    }
    return true;
  }
  namespace(value: unknown, path: string): value is string {
    if (typeof value !== "string" || !NAMESPACE.test(value)) {
      this.add(path, "invalid_namespace"); return false;
    }
    return true;
  }
  uuid(value: unknown, path: string): void {
    if (typeof value !== "string" || !UUID.test(value)) this.add(path, "invalid_uuid");
  }
  digest(value: unknown, path: string): void {
    if (typeof value !== "string" || !DIGEST.test(value)) this.add(path, "invalid_digest");
  }
  enumeration(value: unknown, path: string, choices: readonly string[]): void {
    if (typeof value !== "string" || !choices.includes(value)) this.add(path, "unsupported_value");
  }
  date(value: unknown, path: string): void {
    if (typeof value !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) {
      this.add(path, "invalid_date"); return;
    }
    const [year, month, day] = value.split("-").map(Number);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) this.add(path, "invalid_date");
  }
  timestamp(value: unknown, path: string): void {
    if (typeof value !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(value)
        || value.startsWith("0000") || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
      this.add(path, "invalid_timestamp");
    }
  }
  list(value: unknown, path: string, max: number, item: (value: unknown, path: string) => string | null): void {
    if (!Array.isArray(value)) { this.add(path, "invalid_type"); return; }
    if (value.length > max) { this.add(path, "too_many_items"); return; }
    const seen = new Set<string>();
    value.forEach((entry, index) => {
      const entryPath = `${path}[${index}]`;
      const key = item(entry, entryPath);
      if (key !== null) {
        if (seen.has(key)) this.add(entryPath, "duplicate_reference");
        seen.add(key);
      }
    });
  }
  subject(value: unknown, path: string): string | null {
    const ref = this.object(value, path, ["kind", "owner", "object_id"], ["version_ref"]);
    if (!ref) return null;
    this.namespace(ref.owner, `${path}.owner`);
    this.text(ref.object_id, `${path}.object_id`, 256, true);
    if (Object.hasOwn(ref, "version_ref")) this.text(ref.version_ref, `${path}.version_ref`, 256, true);
    if (typeof ref.kind !== "string" || !SUBJECT_KINDS.has(ref.kind) ||
        !(this.admission.subjects ?? []).some(adapter => adapter.owner === ref.owner && adapter.kinds.includes(ref.kind as string))) {
      this.add(path, "unsupported_owner_kind");
    }
    return JSON.stringify([ref.owner, ref.kind, ref.object_id, ref.version_ref]);
  }
  layout(value: unknown, path: string): string | null {
    const ref = this.object(value, path, ["layout_id", "layout_revision_id", "digest", "role"]);
    if (!ref) return null;
    this.uuid(ref.layout_id, `${path}.layout_id`); this.uuid(ref.layout_revision_id, `${path}.layout_revision_id`);
    this.digest(ref.digest, `${path}.digest`); this.enumeration(ref.role, `${path}.role`, ["primary", "supporting"]);
    return JSON.stringify([ref.layout_id, ref.layout_revision_id]);
  }
  thesis(value: unknown, path: string): string | null {
    const ref = this.object(value, path, ["thesis_id", "version_id", "role"]);
    if (!ref) return null;
    this.uuid(ref.thesis_id, `${path}.thesis_id`); this.uuid(ref.version_id, `${path}.version_id`);
    this.enumeration(ref.role, `${path}.role`, ["primary", "alternative", "context"]);
    return JSON.stringify([ref.thesis_id, ref.version_id]);
  }
  evidence(value: unknown, path: string, baseline = false): string | null {
    const ref = this.object(value, path, ["owner", "object_type", "object_id", "mode"], ["version_ref", "fingerprint", "selection"]);
    if (!ref) return null;
    this.namespace(ref.owner, `${path}.owner`); this.namespace(ref.object_type, `${path}.object_type`);
    this.text(ref.object_id, `${path}.object_id`, 256, true);
    if (!(this.admission.evidence ?? []).some(adapter => adapter.owner === ref.owner && adapter.object_types.includes(ref.object_type as string))) {
      this.add(path, "unsupported_owner_kind");
    }
    this.enumeration(ref.mode, `${path}.mode`, baseline ? ["pinned"] : ["pinned", "follow_head"]);
    if (ref.mode === "pinned" && !Object.hasOwn(ref, "version_ref")) this.add(path, "pinned_version_required");
    if (Object.hasOwn(ref, "version_ref")) this.text(ref.version_ref, `${path}.version_ref`, 256, true);
    if (Object.hasOwn(ref, "fingerprint")) this.digest(ref.fingerprint, `${path}.fingerprint`);
    if (ref.mode === "follow_head" && (Object.hasOwn(ref, "version_ref") || Object.hasOwn(ref, "fingerprint"))) {
      this.add(path, "incompatible_reference_mode");
    }
    let field: unknown;
    if (Object.hasOwn(ref, "selection")) {
      const selection = this.object(ref.selection, `${path}.selection`, ["field"]);
      field = selection?.field;
      if (selection && (typeof field !== "string" || !FIELD.test(field))) this.add(`${path}.selection.field`, "unsupported_selection");
    }
    return JSON.stringify([ref.owner, ref.object_type, ref.object_id, ref.mode, ref.version_ref, field]);
  }
  endpoint(value: unknown, path: string, manifest: Obj): void {
    if (!value || typeof value !== "object" || Array.isArray(value)) { this.add(path, "invalid_type"); return; }
    const endpoint = value as Obj;
    if (endpoint.kind === "thesis") {
      this.object(endpoint, path, ["kind", "thesis_id", "version_id"]);
      this.uuid(endpoint.thesis_id, `${path}.thesis_id`); this.uuid(endpoint.version_id, `${path}.version_id`);
      if (!Array.isArray(manifest.thesis_refs) || !manifest.thesis_refs.some(r => r?.thesis_id === endpoint.thesis_id && r?.version_id === endpoint.version_id)) this.add(path, "unresolved_endpoint");
    } else if (endpoint.kind === "evidence") {
      this.object(endpoint, path, ["kind", "owner", "object_type", "object_id", "mode"], ["version_ref", "selection"]);
      const { kind: _kind, ...ref } = endpoint;
      const identity = this.evidence(ref, path);
      const key = (r: Obj) => JSON.stringify([r.owner, r.object_type, r.object_id, r.mode, r.version_ref, (r.selection as Obj | undefined)?.field]);
      if (!Array.isArray(manifest.evidence_refs) || !manifest.evidence_refs.some(r => r && key(r) === identity)) this.add(path, "unresolved_endpoint");
    } else this.add(`${path}.kind`, "unsupported_value");
  }
  manifest(raw: unknown): void {
    const v2 = (raw as Obj)?.schema === INVESTIGATION_MANIFEST_SCHEMA_V2;
    const strictV2 = v2 && !this.legacyStored;
    const manifest = this.object(raw, "$", ["schema", "intent", "layout_refs", "thesis_refs", "evidence_refs", "continuation", ...(strictV2 ? ["argument_relations"] : [])], ["review_baseline_ref"]);
    if (!manifest) return;
    const questionLimit = v2 ? 4000 : 2000;
    if (!v2 && manifest.schema !== INVESTIGATION_MANIFEST_SCHEMA) this.add("$.schema", "unsupported_schema");
    if (this.legacyStored && [manifest.layout_refs, manifest.thesis_refs, manifest.evidence_refs].reduce<number>((n, refs) => n + (Array.isArray(refs) ? refs.length : 0), 0) > 128) {
      this.add("$", "too_many_references");
    }
    const intent = this.object(manifest.intent, "$.intent", ["title", "question", "subjects"], ["horizon", "research_as_of"]);
    if (intent) {
      this.text(intent.title, "$.intent.title", 160, true); this.text(intent.question, "$.intent.question", questionLimit);
      this.list(intent.subjects, "$.intent.subjects", 16, (v, p) => this.subject(v, p));
      if (Object.hasOwn(intent, "horizon")) this.text(intent.horizon, "$.intent.horizon", 64, true);
      if (Object.hasOwn(intent, "research_as_of")) {
        if (strictV2) this.timestamp(intent.research_as_of, "$.intent.research_as_of");
        else this.date(intent.research_as_of, "$.intent.research_as_of");
      }
    }
    this.list(manifest.layout_refs, "$.layout_refs", 4, (v, p) => this.layout(v, p));
    this.list(manifest.thesis_refs, "$.thesis_refs", 16, (v, p) => this.thesis(v, p));
    this.list(manifest.evidence_refs, "$.evidence_refs", 128, (v, p) => this.evidence(v, p));
    const continuation = this.object(manifest.continuation, "$.continuation", [], ["next_question", "next_observation"]);
    if (continuation) {
      for (const key of ["next_question", "next_observation"]) {
        if (Object.hasOwn(continuation, key)) this.text(continuation[key], `$.continuation.${key}`, questionLimit);
      }
    }
    if (Object.hasOwn(manifest, "review_baseline_ref")) {
      this.evidence(manifest.review_baseline_ref, "$.review_baseline_ref", true);
      if (strictV2 && (!Array.isArray(manifest.evidence_refs) || !manifest.evidence_refs.some(ref => canonicalInvestigationJson(ref) === canonicalInvestigationJson(manifest.review_baseline_ref)))) this.add("$.review_baseline_ref", "baseline_not_member");
    }
    if (strictV2) this.list(manifest.argument_relations, "$.argument_relations", 256, (value, path) => {
      const edge = this.object(value, path, ["source", "target", "relation", "rationale"], ["discrimination_criterion"]);
      if (!edge) return null;
      this.endpoint(edge.source, `${path}.source`, manifest); this.endpoint(edge.target, `${path}.target`, manifest);
      this.enumeration(edge.relation, `${path}.relation`, ["supports", "weakens", "contradicts", "unresolved_interpretation", "discriminates_between"]);
      this.text(edge.rationale, `${path}.rationale`, 4000);
      if (Object.hasOwn(edge, "discrimination_criterion")) this.text(edge.discrimination_criterion, `${path}.discrimination_criterion`, 4000);
      return null; // Annotations are ordered authored statements, not owner identities.
    });
  }
}

/** Shape acceptance is never authentication, referent existence, historical availability, or save success. */
export function validateInvestigationManifest(raw: unknown, admission: InvestigationAdmission = {}): InvestigationValidationResult {
  return validate(raw, admission, false);
}

/** Read compatibility for immutable pre-repair rows. Never use at a write boundary.
 * Returns their exact original value, without inventing relations or timestamps. */
export function validateStoredInvestigationManifest(raw: unknown, admission: InvestigationAdmission = {}): InvestigationValidationResult {
  const legacy = raw !== null && typeof raw === "object" && !Object.hasOwn(raw, "argument_relations") && (raw as Obj).schema === INVESTIGATION_MANIFEST_SCHEMA_V2;
  return validate(raw, admission, legacy);
}
function validate(raw: unknown, admission: InvestigationAdmission, legacyStored: boolean): InvestigationValidationResult {
  const validator = new Validator(admission, legacyStored);
  try {
    if (!validator.dataOnly(raw)) return { ok: false, errors: validator.errors };
    const serialized = (raw as Obj)?.schema === INVESTIGATION_MANIFEST_SCHEMA_V2 ? canonicalInvestigationJson(raw) : JSON.stringify(raw);
    const maxBytes = raw !== null && typeof raw === "object" && (raw as Obj).schema === INVESTIGATION_MANIFEST_SCHEMA_V2
      ? INVESTIGATION_MANIFEST_V2_MAX_BYTES : INVESTIGATION_MANIFEST_MAX_BYTES;
    if (new TextEncoder().encode(serialized).byteLength > maxBytes) {
      return { ok: false, errors: [{ path: "$", code: "manifest_too_large" }] };
    }
    validator.manifest(raw);
    if (validator.errors.length) return { ok: false, errors: validator.errors };
    return { ok: true, value: JSON.parse(serialized) as InvestigationManifest };
  } catch {
    // Hostile in-process objects or a malformed caller capability descriptor fail closed.
    return { ok: false, errors: [{ path: "$", code: "non_json_value" }] };
  }
}
