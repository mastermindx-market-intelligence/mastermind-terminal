/**
 * Honest adapters from existing context owners into the P2 semantic-context projection.
 *
 * These functions do no I/O and grant no identity or rights. They either project an
 * already canonical owner value or return a typed refusal.
 */
import type { AiContextClientV1 } from "./aiContext";
import type { InvestigationSubject } from "./investigationContracts";
import type { MarketOntologyContext } from "./marketOntologyContext";
import type { SemanticContextRef, SemanticContextValue } from "./semanticContext";
import { validateSemanticContextValue } from "./semanticContext";
import type { WorkspaceReplay } from "../components/surface/replayBus";

export type SemanticAdapterResult =
  | { status: "qualified"; value: SemanticContextValue }
  | {
      status: "unsupported" | "missing_adapter" | "incompatible";
      reason: string;
    };

export type SemanticSubjectAdmission = readonly {
  owner: string;
  kinds: readonly string[];
}[];

function asEntityRef(subject: InvestigationSubject): SemanticContextRef | null {
  const candidate = {
    owner: subject.owner,
    kind: subject.kind,
    object_id: subject.object_id,
    ...(subject.version_ref ? { version_ref: subject.version_ref } : {}),
  };
  const result = validateSemanticContextValue({ kind: "entity_selection", ref: candidate });
  return result.ok && result.value.kind === "entity_selection" ? result.value.ref : null;
}

export function semanticSecurityFromAiContextV1(context: AiContextClientV1): SemanticAdapterResult {
  if (context.schema !== "ai_context_client.v1" || context.active?.type !== "security" || !context.active.id) {
    return { status: "unsupported", reason: "security_context_unavailable" };
  }
  if (context.ambient.symbol !== undefined && context.ambient.symbol !== context.active.id) {
    return { status: "incompatible", reason: "active_ambient_mismatch" };
  }
  const result = validateSemanticContextValue({
    kind: "entity_selection",
    ref: {
      owner: "terminal.analysis_symbol",
      kind: "security",
      object_id: context.active.id,
    },
  });
  return result.ok
    ? { status: "qualified", value: result.value }
    : { status: "unsupported", reason: "security_context_invalid" };
}

export function investigationSubjectsToSemanticValue(
  subjects: readonly InvestigationSubject[],
  admission: SemanticSubjectAdmission = [],
): SemanticAdapterResult {
  if (!subjects.length) return { status: "unsupported", reason: "investigation_has_no_subjects" };
  const refs: SemanticContextRef[] = [];
  for (const subject of subjects) {
    if (!admission.some(entry => entry.owner === subject.owner && entry.kinds.includes(subject.kind))) {
      return { status: "missing_adapter", reason: "investigation_subject_owner_not_admitted" };
    }
    const ref = asEntityRef(subject);
    if (!ref) return { status: "unsupported", reason: "investigation_subject_invalid" };
    refs.push(ref);
  }
  const raw: SemanticContextValue = refs.length === 1
    ? { kind: "entity_selection", ref: refs[0] }
    : { kind: "entity_set", refs };
  const result = validateSemanticContextValue(raw);
  return result.ok
    ? { status: "qualified", value: result.value }
    : { status: "unsupported", reason: "investigation_subject_set_invalid" };
}

/**
 * Options replay is a session position, not a source-availability or knowledge cutoff.
 * P5 may later bind a named owner adapter to a historical capability.
 */
export function semanticHistoricalCutoffFromReplay(replay: WorkspaceReplay): SemanticAdapterResult {
  void replay;
  return { status: "unsupported", reason: "session_replay_is_not_knowledge_cutoff" };
}

/**
 * mastermind.market-ontology-context/v1 is transient navigation context. Its labels are
 * explicitly not canonical owner identities; an identity owner must resolve them first.
 */
export function semanticEntityFromMarketOntology(context: MarketOntologyContext): SemanticAdapterResult {
  void context;
  return { status: "missing_adapter", reason: "navigation_context_is_not_canonical_identity" };
}
