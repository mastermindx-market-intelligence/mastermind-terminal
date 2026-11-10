/**
 * P1 Investigation command boundary. This is NOT a persistence, identity, evidence,
 * or entitlement owner. An accepted shape still needs authenticated owner resolution
 * and a same-owner transaction. It cannot certify that a referenced object exists.
 *
 * Deliberately unconnected until Saved Research #777 owner convergence. Server-owned
 * clocks/authors/qualification and future P4/P5 payloads are rejected, not discarded.
 * No normalization of authored text, canonical digest, I/O, or implicit writes occurs.
 */

// The typed scenario reference (v2 manifests only) is validated through the pure leaf module:
// this boundary imports its parser; it never re-implements, re-derives or coerces it. A
// reference is unresolved input metadata -- never a retention, entitlement or
// source-availability claim.
import { parseScenarioCapture, type ScenarioCapture } from "./investigationScenario";

export const INVESTIGATION_MANIFEST_SCHEMA = "investigation_manifest.v1" as const;
export const INVESTIGATION_MANIFEST_MAX_BYTES = 64 * 1024;
export const INVESTIGATION_MANIFEST_SCHEMA_V2 = "investigation_manifest.v2" as const;
export const INVESTIGATION_MANIFEST_V2_MAX_BYTES = 128 * 1024;
/** Prophet D05 (masterplan §15.2.1): a backward-compatible READ extension of v2 adding the closed
 *  optional `user_decision`. v1/v2 readers and writers are unchanged. New v3 WRITES stay closed:
 *  `parseInvestigationCommand` still accepts schema v2 only and the shared admission registry
 *  does not list `prophet.research` until retention and current-rights are qualified. */
export const INVESTIGATION_MANIFEST_SCHEMA_V3 = "investigation_manifest.v3" as const;
export const INVESTIGATION_USER_DECISION_DISPOSITIONS = ["investigate", "watch", "pass"] as const;
export const INVESTIGATION_MILESTONE_STATES = ["open", "met", "missed", "withdrawn"] as const;
export const INVESTIGATION_MAX_MILESTONES = 20;
export const INVESTIGATION_MAX_MILESTONE_EVIDENCE_INDEXES = 16;
/** Closed Prophet evidence adapter namespace (reference adapters to existing native owners). */
export const PROPHET_RESEARCH_EVIDENCE_TYPES: readonly string[] = ["today_selection", "b03_occurrence", "plan_origin", "evaluation"];
/** One RFC 3339 profile shared byte-for-byte with Python and the SQL validator: calendar date,
 *  `T`, hh:mm:ss, optional 1-9 fractional digits, and `Z` or a numeric offset. */
const RFC3339 = /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,9})?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$/;
/** Persisted advisory resolver hint for a retained Sector capture (lane 1 `page.context_ref`, ≤1024). */
const CONTEXT_REF = /^[A-Za-z0-9_.-]{1,1024}$/;
const MAX_ERRORS = 32;
const MAX_NODES = 4096;
const SUBJECT_KINDS = new Set([
  "security", "issuer", "industry", "subtheme", "theme", "regime", "economy",
  "event", "portfolio", "option_underlying", "option_contract", "policy_question",
]);
/** Sector Intelligence (packet §3.2): sector/basket/company are admitted ONLY by v2
 *  validation. The shared v1 kind set above stays byte-identical. */
const SUBJECT_KINDS_V2 = new Set([...SUBJECT_KINDS, "sector", "basket", "company"]);

/** The exact macro.sector owner-qualified native subject cohort (captured 11-sector wire).
 *  Admission is this explicit list — never ticker/name guessing or region inference. */
export const SECTOR_INVESTIGATION_COHORT: readonly string[] = [
  "xlb", "xlk", "xlc", "xly", "xlf", "xli", "xle", "xlv", "xlp", "xlu", "xlre",
];
/** macro.sector native generation/input token grammar (sector_native_view.receipt.v1). */
const NATIVE_SECTOR_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
/** theme_graph.identity owner-resolved ids (Macro engine/theme_graph/identity.py). */
const THEME_ID = /^theme:[a-z0-9][a-z0-9_]{1,62}$/;
const BASKET_SUITES = ["baskets", "baskets_china", "baskets_china_ths", "baskets_hk", "baskets_canada", "baskets_intl"] as const;
const BASKET_ID = new RegExp(`^basket:(?:${BASKET_SUITES.join("|")}):[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`);
const COMPANY_ID = /^co:(?:us|cn|hk|ca|intl):[A-Za-z0-9.\-]+(?:#[0-9]+)?$/;
/** macro.sector published basket projection row id (wire grammar). */
const WIRE_BASKET_ID = /^b-[a-zA-Z0-9_-]{1,100}$/;
/** theme_graph.curation_assertion native evidence/revision identities. */
const CURATION_EVIDENCE_ID = /^ev:[0-9a-f]{16}$/;
const CURATION_REVISION = /^gmirca_[0-9a-f]{32}$/;

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
  /** v3 only, macro.sector observations only: lane 1's signed `page.context_ref` for the retained
   *  capture. The durable identity stays `version_ref` (= capture generation_id) + `fingerprint`
   *  (= capture content_id); this token is a resolver hint and never a substitute for them. */
  context_ref?: string;
};
export type InvestigationMilestone = {
  id: string;
  criterion: string;
  due_on: string | null;
  state: (typeof INVESTIGATION_MILESTONE_STATES)[number];
  user_observed_at: string | null;
  supporting_evidence_indexes: number[];
};
export type InvestigationUserDecision = {
  disposition: (typeof INVESTIGATION_USER_DECISION_DISPOSITIONS)[number];
  reason: string;
  decided_at: string;
  milestones: InvestigationMilestone[];
};
export type InvestigationManifest = {
  schema: typeof INVESTIGATION_MANIFEST_SCHEMA | typeof INVESTIGATION_MANIFEST_SCHEMA_V2 | typeof INVESTIGATION_MANIFEST_SCHEMA_V3;
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
  continuation: { next_question?: string; next_observation?: string };
  review_baseline_ref?: InvestigationEvidenceRef;
  review?: {
    assessment: "confirmed" | "contradicted" | "inconclusive";
    fire_event_id?: string;
    note?: string;
  };
  /** Frozen typed saved-scenario reference; v2 manifests only, and only a value the pure leaf
   *  parser accepts. A reference carries inputs plus source pointers/digests only -- it stores
   *  no basis or result values and is never a retention, entitlement or source-availability
   *  claim. */
  scenario_capture?: ScenarioCapture;
  /** v3 only: the user's declared research disposition and self-marked milestones. User-declared
   *  clocks are never evidence that source facts were available then. */
  user_decision?: InvestigationUserDecision;
};
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
  private v2 = false;
  private v3 = false;
  private readonly ancestors = new WeakSet<object>();
  constructor(private readonly admission: InvestigationAdmission) {}
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
  /** RFC 3339 profile (see RFC3339) plus real calendar-day validity of the date part. */
  timestamp(value: unknown, path: string): void {
    if (typeof value !== "string" || !RFC3339.test(value)) { this.add(path, "invalid_timestamp"); return; }
    this.date(value.slice(0, 10), path);
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
    if (typeof ref.kind !== "string" || !(this.v2 ? SUBJECT_KINDS_V2 : SUBJECT_KINDS).has(ref.kind) ||
        !(this.admission.subjects ?? []).some(adapter => adapter.owner === ref.owner && adapter.kinds.includes(ref.kind as string))) {
      this.add(path, "unsupported_owner_kind");
    }
    // Exact owner-resolved identity for the Sector Intelligence pairs (packet §3.2): a
    // sector subject is the admitted native cohort id, never a ticker/name guess; a
    // theme_graph.identity subject carries its owner grammar and is never reinterpreted
    // as a security/issuer (sector:financials and native xlf stay distinct owners).
    if (this.v2 && typeof ref.object_id === "string") {
      if (ref.owner === "macro.sector" && ref.kind === "sector" && !SECTOR_INVESTIGATION_COHORT.includes(ref.object_id)) {
        this.add(`${path}.object_id`, "invalid_subject_id");
      }
      if (ref.owner === "theme_graph.identity" && ref.kind === "theme" && !THEME_ID.test(ref.object_id)) {
        this.add(`${path}.object_id`, "invalid_subject_id");
      }
      if (ref.owner === "theme_graph.identity" && ref.kind === "basket" && !BASKET_ID.test(ref.object_id)) {
        this.add(`${path}.object_id`, "invalid_subject_id");
      }
      if (ref.owner === "theme_graph.identity" && ref.kind === "company" && !COMPANY_ID.test(ref.object_id)) {
        this.add(`${path}.object_id`, "invalid_subject_id");
      }
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
    const ref = this.object(value, path, ["owner", "object_type", "object_id", "mode"], this.v3 ? ["version_ref", "fingerprint", "selection", "context_ref"] : ["version_ref", "fingerprint", "selection"]);
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
    // `prophet.research` exists only on v3, whatever an adapter registry lists.
    if (ref.owner === "prophet.research" && !this.v3) this.add(path, "unsupported_owner_kind");
    // New Sector Intelligence evidence is pinned-only (packet §3.2): version_ref AND
    // fingerprint are required, selection stays omitted until a closed per-type selector
    // vocabulary exists, and each type pins its owner-resolved identity grammar. No JSON
    // state is ever hidden in object_id, selection.field, title or horizon.
    if (this.v2) {
      if (ref.owner === "macro.sector" && (ref.object_type === "sector_observation" || ref.object_type === "basket_observation")) {
        if (ref.mode !== "pinned") this.add(`${path}.mode`, "pinned_only");
        if (ref.object_type === "sector_observation" && !(typeof ref.object_id === "string" && SECTOR_INVESTIGATION_COHORT.includes(ref.object_id))) {
          this.add(`${path}.object_id`, "invalid_object_id");
        }
        if (ref.object_type === "basket_observation" && !(typeof ref.object_id === "string" && WIRE_BASKET_ID.test(ref.object_id))) {
          this.add(`${path}.object_id`, "invalid_object_id");
        }
        if (typeof ref.version_ref === "string" && !NATIVE_SECTOR_TOKEN.test(ref.version_ref)) this.add(`${path}.version_ref`, "invalid_version_ref");
        if (!Object.hasOwn(ref, "fingerprint")) this.add(path, "fingerprint_required");
        if (Object.hasOwn(ref, "selection")) this.add(`${path}.selection`, "unsupported_selection");
      }
      if (ref.owner === "macro.sector" && Object.hasOwn(ref, "context_ref")) {
        if (!(ref.object_type === "sector_observation" || ref.object_type === "basket_observation")
            || typeof ref.context_ref !== "string" || !CONTEXT_REF.test(ref.context_ref)) this.add(`${path}.context_ref`, "invalid_context_ref");
      } else if (Object.hasOwn(ref, "context_ref")) {
        this.add(`${path}.context_ref`, "unsupported_context_ref");
      }
      if (ref.owner === "prophet.research" && this.v3) {
        // Closed adapter namespace. Pinned-only: native readers issue object_id/version_ref and the
        // owner binds the complete listing/occurrence/generation/receipt tuple; no ticker-derived id
        // and no session filename stands in for a retained version.
        if (!PROPHET_RESEARCH_EVIDENCE_TYPES.includes(ref.object_type as string)) this.add(`${path}.object_type`, "unsupported_owner_kind");
        if (ref.mode !== "pinned") this.add(`${path}.mode`, "pinned_only");
        if (!Object.hasOwn(ref, "fingerprint")) this.add(path, "fingerprint_required");
        if (Object.hasOwn(ref, "selection")) this.add(`${path}.selection`, "unsupported_selection");
      }
      if (ref.owner === "theme_graph.curation_assertion" && ref.object_type === "curation_assertion") {
        if (ref.mode !== "pinned") this.add(`${path}.mode`, "pinned_only");
        if (!(typeof ref.object_id === "string" && CURATION_EVIDENCE_ID.test(ref.object_id))) this.add(`${path}.object_id`, "invalid_object_id");
        if (!(typeof ref.version_ref === "string" && CURATION_REVISION.test(ref.version_ref))) this.add(`${path}.version_ref`, "invalid_version_ref");
        if (!Object.hasOwn(ref, "fingerprint")) this.add(path, "fingerprint_required");
        if (Object.hasOwn(ref, "selection")) this.add(`${path}.selection`, "unsupported_selection");
      }
    }
    return JSON.stringify([ref.owner, ref.object_type, ref.object_id, ref.mode, ref.version_ref, field]);
  }
  /** Prophet D05 `user_decision` (masterplan §15.2.1). Closed object; no scheduler, monitor or outcome
   *  is implied by a milestone. `reason` is required non-empty for Pass; `decided_at` and
   *  `user_observed_at` are user-declared clocks, never source-availability evidence. */
  userDecision(value: unknown, evidenceRefs: unknown): void {
    const decision = this.object(value, "$.user_decision", ["disposition", "reason", "decided_at", "milestones"]);
    if (!decision) return;
    this.enumeration(decision.disposition, "$.user_decision.disposition", INVESTIGATION_USER_DECISION_DISPOSITIONS);
    if (typeof decision.reason !== "string") this.add("$.user_decision.reason", "invalid_type");
    else if (decision.reason.trim().length === 0) {
      if (decision.disposition === "pass") this.add("$.user_decision.reason", "empty_text");
      else if (decision.reason !== "") this.add("$.user_decision.reason", "empty_text");
    } else this.text(decision.reason, "$.user_decision.reason", 2000);
    this.timestamp(decision.decided_at, "$.user_decision.decided_at");
    const evidenceCount = Array.isArray(evidenceRefs) ? evidenceRefs.length : 0;
    if (!Array.isArray(decision.milestones)) { this.add("$.user_decision.milestones", "invalid_type"); return; }
    if (decision.milestones.length > INVESTIGATION_MAX_MILESTONES) { this.add("$.user_decision.milestones", "too_many_items"); return; }
    const ids = new Set<string>();
    decision.milestones.forEach((entry, index) => {
      const path = `$.user_decision.milestones[${index}]`;
      const m = this.object(entry, path, ["id", "criterion", "due_on", "state", "user_observed_at", "supporting_evidence_indexes"]);
      if (!m) return;
      this.uuid(m.id, `${path}.id`);
      if (typeof m.id === "string") { if (ids.has(m.id)) this.add(`${path}.id`, "duplicate_reference"); ids.add(m.id); }
      this.text(m.criterion, `${path}.criterion`, 500);
      if (m.due_on !== null) this.date(m.due_on, `${path}.due_on`);
      this.enumeration(m.state, `${path}.state`, INVESTIGATION_MILESTONE_STATES);
      if (m.user_observed_at !== null) this.timestamp(m.user_observed_at, `${path}.user_observed_at`);
      if ((m.state === "met" || m.state === "missed") && m.user_observed_at === null) this.add(`${path}.user_observed_at`, "observation_required");
      const idx = m.supporting_evidence_indexes;
      if (!Array.isArray(idx)) { this.add(`${path}.supporting_evidence_indexes`, "invalid_type"); return; }
      if (idx.length > INVESTIGATION_MAX_MILESTONE_EVIDENCE_INDEXES) { this.add(`${path}.supporting_evidence_indexes`, "too_many_items"); return; }
      const seen = new Set<number>();
      idx.forEach((n, k) => {
        const p = `${path}.supporting_evidence_indexes[${k}]`;
        const target = Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) < evidenceCount ? (evidenceRefs as unknown[])[n as number] : undefined;
        if (!target || typeof target !== "object" || (target as Obj).mode !== "pinned") { this.add(p, "invalid_evidence_index"); return; }
        if (seen.has(n as number)) this.add(p, "duplicate_reference");
        seen.add(n as number);
      });
    });
  }
  manifest(raw: unknown): void {
    // `scenario_capture` MUST ride this closed optional-key array: without it every capture
    // bearing manifest is refused as an unknown top-level field before the typed check below.
    const manifest = this.object(raw, "$", ["schema", "intent", "layout_refs", "thesis_refs", "evidence_refs", "continuation"], ["review_baseline_ref", "review", "scenario_capture", "user_decision"]);
    if (!manifest) return;
    // v3 is a strict superset of v2 for every shared field; only `user_decision` and the v3-only
    // evidence keys differ, so every v2 rule below applies unchanged to a v3 manifest.
    const v3 = manifest.schema === INVESTIGATION_MANIFEST_SCHEMA_V3;
    const v2 = manifest.schema === INVESTIGATION_MANIFEST_SCHEMA_V2 || v3;
    this.v2 = v2; this.v3 = v3;
    const questionLimit = v2 ? 4000 : 2000;
    if (!v2 && manifest.schema !== INVESTIGATION_MANIFEST_SCHEMA) this.add("$.schema", "unsupported_schema");
    if (Object.hasOwn(manifest, "user_decision") && !v3) this.add("$.user_decision", "unsupported_schema");
    if (v2 && [manifest.layout_refs, manifest.thesis_refs, manifest.evidence_refs].reduce<number>((n, refs) => n + (Array.isArray(refs) ? refs.length : 0), 0) > 128) {
      this.add("$", "too_many_references");
    }
    const intent = this.object(manifest.intent, "$.intent", ["title", "question", "subjects"], ["horizon", "research_as_of"]);
    if (intent) {
      this.text(intent.title, "$.intent.title", 160, true); this.text(intent.question, "$.intent.question", questionLimit);
      this.list(intent.subjects, "$.intent.subjects", 16, (v, p) => this.subject(v, p));
      if (Object.hasOwn(intent, "horizon")) this.text(intent.horizon, "$.intent.horizon", 64, true);
      if (Object.hasOwn(intent, "research_as_of")) this.date(intent.research_as_of, "$.intent.research_as_of");
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
    if (Object.hasOwn(manifest, "review_baseline_ref")) this.evidence(manifest.review_baseline_ref, "$.review_baseline_ref", true);
    if (Object.hasOwn(manifest, "review")) {
      const review = this.object(manifest.review, "$.review", ["assessment"], ["fire_event_id", "note"]);
      if (review) {
        if (typeof review.assessment !== "string" || !["confirmed", "contradicted", "inconclusive"].includes(review.assessment)) {
          this.add("$.review.assessment", "invalid_assessment");
        }
        if (Object.hasOwn(review, "fire_event_id") && (typeof review.fire_event_id !== "string" || !DIGEST.test(review.fire_event_id))) {
          this.add("$.review.fire_event_id", "invalid_fire_event_id");
        }
        if (Object.hasOwn(review, "note")) this.text(review.note, "$.review.note", 2000);
      }
    }
    if (v3 && Object.hasOwn(manifest, "user_decision")) this.userDecision(manifest.user_decision, manifest.evidence_refs);
    if (Object.hasOwn(manifest, "scenario_capture")) {
      // Only a v2 manifest may carry the typed scenario reference, and only when the pure leaf
      // module accepts it: unknown, malformed, forged and superseded full-value payloads are
      // refused, never coerced. Shape acceptance is not retention, entitlement, source
      // availability or save success; actual source resolution stays with the native owner.
      if (!v2) this.add("$.scenario_capture", "unsupported_schema");
      else if (!parseScenarioCapture(manifest.scenario_capture)) {
        this.add("$.scenario_capture", "invalid_scenario_capture");
      }
    }
  }
}

/** Shape acceptance is never authentication, referent existence, historical availability, or save success. */
export function validateInvestigationManifest(raw: unknown, admission: InvestigationAdmission = {}): InvestigationValidationResult {
  const validator = new Validator(admission);
  try {
    if (!validator.dataOnly(raw)) return { ok: false, errors: validator.errors };
    const serialized = JSON.stringify(raw);
    const maxBytes = raw !== null && typeof raw === "object" && ((raw as Obj).schema === INVESTIGATION_MANIFEST_SCHEMA_V2 || (raw as Obj).schema === INVESTIGATION_MANIFEST_SCHEMA_V3)
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
