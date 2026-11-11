/**
 * Sector investigation reopen (SP14) — original vs current, against a TRANSPORT SEAM.
 *
 * Lane 1's route is the resolver for a retained Sector capture (`/tmp/si_plan/v11/LANE1_WIRE_V11.md`):
 * a `context_ref` opens the retained capture; `404 ORIGINAL_UNAVAILABLE` means the bytes are gone or the
 * signature is not recognised; `409 CURSOR_RESET` is a stale page cursor. This module owns only the
 * decision table, so the same contract holds whatever HTTP client lane 3 mounts:
 *
 *   - ORIGINAL opens the retained capture the record names. It NEVER falls back to the latest: when the
 *     retained capture cannot be proven to be the saved one, the state is `original_unavailable`.
 *   - CURRENT opens separately (`reopenCurrent`) and is labelled `current`, never `original`.
 *   - A saved `context_ref` is a HINT. It is treated as durable only when the capture said
 *     `retained_resolver_ref_durability === "durable"`; today no deployment has the signing secret, so the
 *     lawful state is the hint plus the durable identity (generation_id + content_id + member_sha256).
 *   - Identity is verified on every answer: a response whose capture identity differs from the saved
 *     identity is `original_unavailable`, even on HTTP 200.
 *
 * Pure: no I/O of its own, no storage, no latest-pointer read. An accepted shape here is not retention,
 * rights or entitlement; those stay with the lane-1 owner and the served route.
 */
import type { InvestigationEvidenceRef, InvestigationManifest } from "./investigationContracts";

export type SectorCaptureIdentity = {
  generation_id: string;
  content_id: string;
  member_sha256?: Record<string, string>;
};
/** The slice of lane 1's `capture.owner_ref` this module reads (wire field names). */
export type SectorOwnerRef = {
  generation_id?: unknown;
  content_id?: unknown;
  member_sha256?: unknown;
  retained_resolver_ref?: unknown;
  retained_resolver_ref_durability?: unknown;
};
export type SectorPopulationRead = {
  schema?: unknown;
  page?: { capture?: { owner_ref?: SectorOwnerRef }; context_ref?: unknown } & Record<string, unknown>;
} & Record<string, unknown>;

/** Transport outcomes, already classified by the caller's HTTP client from the lane-1 wire. */
export type TransportAnswer =
  | { kind: "ok"; body: SectorPopulationRead }
  | { kind: "original_unavailable" }          // 404 ORIGINAL_UNAVAILABLE
  | { kind: "cursor_reset"; reason?: string } // 409 CURSOR_RESET
  | { kind: "signed_out" }                    // 401 AUTHENTICATION_REQUIRED
  | { kind: "denied" }                        // 403 / 404 gate classes (not the ORIGINAL_UNAVAILABLE body)
  | { kind: "unsupported" }                   // the owner offers no such path (e.g. open-by-identity today)
  | { kind: "error" };                        // network / 5xx / 503: inconclusive, retryable

export type SectorReopenTransport = {
  /** Lane 1: `GET …?x=<context_ref>` — opens the retained capture the token names. */
  openByContextRef(contextRef: string): Promise<TransportAnswer>;
  /** Not offered by lane 1 today (no route can name a generation); a future owner path may. */
  openByIdentity?(identity: SectorCaptureIdentity): Promise<TransportAnswer>;
  /** The selected-at-read capture. Used ONLY by `reopenCurrent`, never by `reopenOriginal`. */
  openCurrent(): Promise<TransportAnswer>;
};

export type ReopenReason =
  | "no_saved_reference" | "bytes_not_retained" | "identity_mismatch" | "reference_not_recognised"
  | "no_resolver_path" | "denied";
export type SectorReopenState =
  | { state: "original"; body: SectorPopulationRead; identity: SectorCaptureIdentity; via: "context_ref" | "identity"; contextRefDurable: boolean }
  | { state: "original_unavailable"; reason: ReopenReason }
  | { state: "current"; body: SectorPopulationRead; identity: SectorCaptureIdentity }
  | { state: "signed_out" }
  | { state: "retry"; reason: "transport_error" };

const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const DIGEST = /^[0-9a-f]{64}$/;
/** Same grammar the saved reference is validated with (investigationContracts MEMBER_PATH). */
const MEMBER_PATH = /^[A-Za-z0-9][A-Za-z0-9_./-]{0,127}$/;

/** `durable` only on the owner's explicit statement; anything else (absent, `process_lifetime_only`) is not. */
export function contextRefIsDurable(ownerRef: SectorOwnerRef | undefined | null): boolean {
  return !!ownerRef && ownerRef.retained_resolver_ref_durability === "durable";
}

/** The capture identity carried by a lane-1 answer, or null when the answer does not carry one. */
export function captureIdentityOf(body: SectorPopulationRead | undefined): SectorCaptureIdentity | null {
  const owner = body?.page?.capture?.owner_ref;
  if (!owner || typeof owner.generation_id !== "string" || typeof owner.content_id !== "string" || !DIGEST.test(owner.content_id)) return null;
  const identity: SectorCaptureIdentity = { generation_id: owner.generation_id, content_id: owner.content_id };
  if (owner.member_sha256 !== undefined) {
    // A member set that is not a plain object, or holds ANY entry that is not (grammar key -> sha256 string),
    // is malformed: the whole answer carries no identity. Nothing is silently dropped, so a capture with a
    // different member set can never compare equal to the saved one.
    if (!record(owner.member_sha256)) return null;
    const members: Record<string, string> = Object.create(null);
    for (const [key, value] of Object.entries(owner.member_sha256)) {
      if (!MEMBER_PATH.test(key) || typeof value !== "string" || !DIGEST.test(value)) return null;
      members[key] = value;
    }
    identity.member_sha256 = members;
  }
  return identity;
}

function sameMembers(saved: Record<string, string> | undefined, answered: Record<string, string> | undefined): boolean {
  if (!saved) return true; // member set is optional on the saved ref; when saved it must match exactly
  if (!answered) return false;
  const a = Object.keys(saved).sort();
  const b = Object.keys(answered).sort();
  return a.length === b.length && a.every((key, i) => key === b[i] && saved[key] === answered[key]);
}
/** Strict identity: generation, content id, and (when saved) the exact member sha256 set. */
export function sameCaptureIdentity(saved: SectorCaptureIdentity, answered: SectorCaptureIdentity | null): boolean {
  return !!answered && saved.generation_id === answered.generation_id && saved.content_id === answered.content_id
    && sameMembers(saved.member_sha256, answered.member_sha256);
}

/** The saved Sector observation reference(s) of a manifest, in evidence order (baseline excluded). */
export function savedSectorCaptures(manifest: Pick<InvestigationManifest, "evidence_refs">): { ref: InvestigationEvidenceRef; identity: SectorCaptureIdentity; contextRef: string | null }[] {
  const out: { ref: InvestigationEvidenceRef; identity: SectorCaptureIdentity; contextRef: string | null }[] = [];
  for (const ref of manifest.evidence_refs) {
    if (ref.owner !== "macro.sector" || (ref.object_type !== "sector_observation" && ref.object_type !== "basket_observation")) continue;
    if (typeof ref.version_ref !== "string" || typeof ref.fingerprint !== "string") continue;
    const identity: SectorCaptureIdentity = { generation_id: ref.version_ref, content_id: ref.fingerprint };
    if (ref.member_sha256) identity.member_sha256 = ref.member_sha256;
    out.push({ ref, identity, contextRef: typeof ref.context_ref === "string" ? ref.context_ref : null });
  }
  return out;
}

/**
 * Build the v3 evidence reference from a lane-1 read: durable identity in the existing v2 fields
 * (`version_ref` = generation_id, `fingerprint` = content_id) plus `member_sha256`, and the context
 * reference stored as a hint. Returns null when the read carries no capture identity (nothing is invented).
 */
export function sectorEvidenceFromRead(body: SectorPopulationRead, object: { type: "sector_observation" | "basket_observation"; id: string }): InvestigationEvidenceRef | null {
  const identity = captureIdentityOf(body);
  if (!identity) return null;
  const ref: InvestigationEvidenceRef = {
    owner: "macro.sector", object_type: object.type, object_id: object.id, mode: "pinned",
    version_ref: identity.generation_id, fingerprint: identity.content_id,
  };
  if (identity.member_sha256 && Object.keys(identity.member_sha256).length) ref.member_sha256 = identity.member_sha256;
  const hint = body.page?.context_ref;
  if (typeof hint === "string" && /^[A-Za-z0-9_.-]{1,1024}$/.test(hint)) ref.context_ref = hint;
  return ref;
}

function classify(answer: TransportAnswer, saved: SectorCaptureIdentity, via: "context_ref" | "identity"): SectorReopenState | "next" {
  switch (answer.kind) {
    case "ok": {
      const identity = captureIdentityOf(answer.body);
      if (!sameCaptureIdentity(saved, identity)) return { state: "original_unavailable", reason: "identity_mismatch" };
      return { state: "original", body: answer.body, identity: identity!, via, contextRefDurable: contextRefIsDurable(answer.body.page?.capture?.owner_ref) };
    }
    case "original_unavailable": return "next";
    case "cursor_reset": return "next"; // a stale reference is unresolved, not a mixed page and not the latest
    case "signed_out": return { state: "signed_out" };
    case "denied": return { state: "original_unavailable", reason: "denied" };
    case "unsupported": return "next";
    case "error": return { state: "retry", reason: "transport_error" };
  }
}

/**
 * Open the ORIGINAL retained capture a saved record names. Order: the stored hint (if any), then the
 * durable identity through the owner's open-by-identity path (if the transport offers one). If neither
 * proves the saved capture, the answer is `original_unavailable` — `openCurrent` is never called here.
 */
export async function reopenOriginal(saved: SectorCaptureIdentity | null, contextRef: string | null, transport: SectorReopenTransport): Promise<SectorReopenState> {
  if (!saved) return { state: "original_unavailable", reason: "no_saved_reference" };
  try {
    let sawNotRecognised = false;
    if (contextRef) {
      const outcome = classify(await transport.openByContextRef(contextRef), saved, "context_ref");
      if (outcome !== "next") return outcome;
      sawNotRecognised = true;
    }
    if (transport.openByIdentity) {
      const outcome = classify(await transport.openByIdentity(saved), saved, "identity");
      if (outcome !== "next") return outcome;
      return { state: "original_unavailable", reason: "bytes_not_retained" };
    }
    return { state: "original_unavailable", reason: sawNotRecognised ? "reference_not_recognised" : "no_resolver_path" };
  } catch {
    // A rejected transport promise (network failure, a 2xx whose body does not parse) is inconclusive:
    // retryable, never proof the original is gone and never a fallback to the latest.
    return { state: "retry", reason: "transport_error" };
  }
}

/** Open the current capture separately. Always labelled `current`; it never stands in for an original. */
export async function reopenCurrent(transport: SectorReopenTransport): Promise<SectorReopenState> {
  let answer: TransportAnswer;
  try { answer = await transport.openCurrent(); } catch { return { state: "retry", reason: "transport_error" }; }
  switch (answer.kind) {
    case "ok": {
      const identity = captureIdentityOf(answer.body);
      return identity ? { state: "current", body: answer.body, identity } : { state: "retry", reason: "transport_error" };
    }
    case "signed_out": return { state: "signed_out" };
    case "error": return { state: "retry", reason: "transport_error" };
    default: return { state: "retry", reason: "transport_error" };
  }
}
