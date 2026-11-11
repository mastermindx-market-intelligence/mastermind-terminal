import { canonicalJson } from "./investigationEvidenceOptions";
import {
  mintOptionsSelectionEvidence,
  type OptionsSelectionMintInput,
  type OptionsSelectionRefusal,
} from "./investigationEvidenceOptionsSelection";
import type { InvestigationEvidenceRef } from "./investigationContracts";
import type { MastermindBrainHost } from "./mastermindBrain";

/** A request selector, never an authorization or model-ready source attachment.
 * The server must freshly resolve the exact bytes, identity, principal and actual
 * assistant use. Display admission alone does not admit a model-provider use. */
export type OptionsQuestionReference = Readonly<{
  schema: "options.selection_question/v1";
  evidence: Readonly<InvestigationEvidenceRef>;
  selection: string;
}>;

export type OptionsQuestionPreparation =
  | { state: "prepared"; reference: OptionsQuestionReference }
  | { state: "unavailable"; reason: OptionsSelectionRefusal };

/** Reuse the incumbent selection mint; no clock, source read, storage or grant. */
export function prepareOptionsQuestion(input: OptionsSelectionMintInput): OptionsQuestionPreparation {
  const minted = mintOptionsSelectionEvidence(input);
  if (!minted.ok) return { state: "unavailable", reason: minted.reason };
  return {
    state: "prepared",
    reference: Object.freeze({
      schema: "options.selection_question/v1",
      evidence: Object.freeze({ ...minted.ref }),
      selection: minted.selection,
    }),
  };
}

/** Stable exact request identity for withdrawal on root/session/selection changes.
 * This is not a server receipt, cryptographic admission or persistence key. */
export function optionsQuestionIdentity(reference: OptionsQuestionReference): string {
  return canonicalJson(reference);
}

/** No symbol/company-source fallback when the typed consumer is absent.
 * Caller must withdraw this prepared reference when its owning scope changes.
 * The actual singleton consumer must perform fresh server admission; true means
 * local request acceptance only, never source access or successful generation. */
export function submitOptionsQuestion(
  prepared: OptionsQuestionPreparation,
  host: MastermindBrainHost | null | undefined,
): boolean {
  if (prepared.state !== "prepared" || typeof host?.MMBrain?.submitOptionsQuestion !== "function") return false;
  return host.MMBrain.submitOptionsQuestion(prepared.reference) === true;
}
