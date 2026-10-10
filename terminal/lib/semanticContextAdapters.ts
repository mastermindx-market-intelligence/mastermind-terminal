/**
 * Honest adapters from existing context owners into the P2 semantic-context projection.
 *
 * These functions do no I/O and grant no identity or rights. They either project an
 * already canonical owner value or return a typed refusal.
 */
import type { AiContextClientV1 } from "./aiContext";
import { normalizeAnalysisSymbol } from "./analysisSymbol";
import type { InvestigationSubject } from "./investigationContracts";
import type { MarketOntologyContext } from "./marketOntologyContext";
import type { SemanticContextRef, SemanticContextValue } from "./semanticContext";
import { decodeNativeChartSecurity, validateSemanticContextValue } from "./semanticContext";
import type { ContextSnapshot } from "./workspaceContextSession";
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

/** Typed, read-only projection from the existing #802 mounted Chart Bus owner. */
export function semanticSecurityFromNativeChartSnapshot(snapshot: ContextSnapshot | null): SemanticAdapterResult {
  if (!snapshot || snapshot.group !== "active_security") {
    return { status: "unsupported", reason: "chart_session_unavailable" };
  }
  const decoded = decodeNativeChartSecurity(snapshot.value);
  return decoded.ok
    ? { status: "qualified", value: decoded.value }
    : { status: "unsupported", reason: "chart_context_invalid" };
}

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
  const canonical = normalizeAnalysisSymbol(context.active.id);
  if (!canonical || canonical !== context.active.id) {
    return { status: "unsupported", reason: "security_context_invalid" };
  }
  if (context.ambient.symbol !== canonical) {
    return { status: "incompatible", reason: "active_ambient_mismatch" };
  }
  const result = validateSemanticContextValue({
    kind: "entity_selection",
    ref: {
      owner: "terminal.analysis_symbol",
      kind: "security",
      object_id: canonical,
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


/**
 * Read-only tuple comparison across two EXISTING owners.
 *
 * "compatible" means only that these two observed client snapshots agree on
 * canonical security + timeframe. It is not authentication, a shared revision,
 * a Brain send receipt, data qualification, a rights decision, or a write.
 */
export type SemanticChartBrainComparison =
  | {
      status: "compatible";
      symbol: string;
      timeframe: string;
      chart: { epoch: string; group_revision: number; incarnation: number };
      brain: { origin_id: string; context_revision: number };
    }
  | { status: "unsupported" | "incompatible"; reason: string };

export function compareSemanticChartBrainContexts(
  chart: ContextSnapshot | null,
  brain: AiContextClientV1,
): SemanticChartBrainComparison {
  try {
    if (!chart) {
      return { status: "unsupported", reason: "chart_session_unavailable" };
    }
    const visual = semanticSecurityFromNativeChartSnapshot(chart);
    if (visual.status !== "qualified") {
      return { status: "unsupported", reason: visual.reason };
    }
    if (chart.mode !== "follow") {
      return { status: "unsupported", reason: "chart_not_following" };
    }
    const context = semanticSecurityFromAiContextV1(brain);
    if (context.status !== "qualified") {
      return {
        status: context.status === "incompatible" ? "incompatible" : "unsupported",
        reason: context.status === "incompatible" ? "brain_context_inconsistent" : "brain_context_unavailable",
      };
    }
    if (visual.value.kind !== "entity_selection" || context.value.kind !== "entity_selection") {
      return { status: "unsupported", reason: "security_context_unavailable" };
    }
    const symbol = visual.value.ref.object_id;
    if (symbol !== context.value.ref.object_id) {
      return { status: "incompatible", reason: "symbol_mismatch" };
    }
    const timeframe = chart.value.timeframe;
    if (typeof timeframe !== "string" || !timeframe || timeframe !== brain.ambient.timeframe) {
      return { status: "incompatible", reason: "timeframe_mismatch" };
    }
    if (!brain.origin_id || !Number.isSafeInteger(brain.context_revision) || brain.context_revision < 0) {
      return { status: "unsupported", reason: "brain_context_unavailable" };
    }
    return {
      status: "compatible",
      symbol,
      timeframe,
      chart: {
        epoch: chart.epoch,
        group_revision: chart.group_revision,
        incarnation: chart.incarnation,
      },
      brain: {
        origin_id: brain.origin_id,
        context_revision: brain.context_revision,
      },
    };
  } catch {
    return { status: "unsupported", reason: "context_read_invalid" };
  }
}
