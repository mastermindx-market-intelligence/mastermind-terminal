/** IM08/09 trusted-caller composition seam (pure, internal).
 *
 * One entry point a trusted caller uses once it already holds either an
 * explicit disposition or a resolved packet. It is NOT authentication,
 * admission or raw-draft validation; inputs arrive already trusted. No I/O,
 * fetch, storage, clock generation or callback invocation.
 *
 * - An explicit caller disposition (unauthenticated / not_found /
 *   not_admitted / denied / unavailable / invalid / scope_changed) is returned
 *   verbatim as a typed outcome. No review, no composition, no manufactured
 *   context, census or panel props, and never translated to a generic
 *   "unavailable".
 * - A resolved packet composes the accepted pieces unchanged:
 *   reviewIntlEvidence(prior, current, exactContext, requirements) then
 *   composeIntlInvestigationPanel({ review, exactContext, requirements, owner }).
 *   Composition refusals pass through untranslated, and the owner input is
 *   handed over as-is: required record clocks stay exact string | null (an
 *   omitted one is refused by the mapper, never defaulted here) and an omitted
 *   observedAtByMeasureId stays absent.
 * - Before that fallback, a well-formed owner result whose own nine-field
 *   context differs from exactContext is preserved as scope_changed. The
 *   frozen adapter would otherwise map such a current to invalid and such a
 *   prior to baseline-unavailable. Only a "context_mismatch" refusal from
 *   toIntlEvidenceCensus qualifies, and well-formedness is that same builder
 *   run against the result's own CONTEXT_FIELDS — no second validator. Only
 *   differing field names are reported, never values.
 * - A malformed current keeps the adapter's fallback (composed invalid) and
 *   takes precedence over every prior check.
 * - With a usable current, a non-null prior the builder refuses under its own
 *   context is a known malformed owner input: an explicit invalid outcome
 *   (side "prior" plus the builder's refusal code, never values), not the
 *   adapter's baseline-unavailable, so it stays distinct from a real
 *   unavailable read.
 * - A null prior stays null and a well-formed prior whose read is
 *   "unavailable" is composed as given: comparison unavailable, current still
 *   useful, current never substituted. A prior with a genuine denied read is
 *   passed through, not nulled. */
import {
  CONTEXT_FIELDS,
  reviewIntlEvidence,
  toIntlEvidenceCensus,
  type IntlExactContext,
  type IntlOwnerResult,
  type IntlRequirements,
  type IntlReviewResult,
} from "./intlInvestigationEvidence";
import {
  composeIntlInvestigationPanel,
  type IntlCompositionOwnerInput,
  type IntlCompositionResult,
} from "./intlInvestigationComposition";

export const INTL_CALLER_DISPOSITIONS = [
  "unauthenticated",
  "not_found",
  "not_admitted",
  "denied",
  "unavailable",
  "invalid",
  "scope_changed",
] as const;

export type IntlCallerDisposition = (typeof INTL_CALLER_DISPOSITIONS)[number];

export interface IntlResolvedPacket {
  exactContext: IntlExactContext;
  /** Historical prior; null only when no prior exists. */
  prior: IntlOwnerResult | null;
  current: IntlOwnerResult;
  requirements: IntlRequirements;
  owner: IntlCompositionOwnerInput;
}

export type IntlCallerInput =
  | ({ disposition: "resolved" } & IntlResolvedPacket)
  | { disposition: IntlCallerDisposition };

export type IntlCallerResult =
  | { kind: "resolved"; review: IntlReviewResult; composition: IntlCompositionResult }
  | { kind: "disposition"; disposition: IntlCallerDisposition; origin: "caller" }
  | {
      kind: "disposition";
      disposition: "scope_changed";
      origin: "scope_check";
      side: "current" | "prior";
      /** Differing CONTEXT_FIELDS names; never values. */
      fields: string[];
    }
  | {
      kind: "disposition";
      disposition: "invalid";
      origin: "owner_check";
      side: "prior";
      /** toIntlEvidenceCensus refusal code under the prior's own context; never values. */
      reason: string;
    };

type CensusBuild = ReturnType<typeof toIntlEvidenceCensus>;

/** The same builder run against the result's own CONTEXT_FIELDS (same
 * selection), for a result already refused for context mismatch. */
function buildUnderOwnContext(result: IntlOwnerResult, exactContext: IntlExactContext): CensusBuild {
  const own = { selectedMeasureIds: exactContext.selectedMeasureIds } as IntlExactContext;
  for (const f of CONTEXT_FIELDS) own[f] = result[f];
  return toIntlEvidenceCensus(result, own);
}

function scopeChanged(side: "current" | "prior", result: IntlOwnerResult, exactContext: IntlExactContext): IntlCallerResult {
  const fields = CONTEXT_FIELDS.filter((f) => result[f] !== exactContext[f]);
  return { kind: "disposition", disposition: "scope_changed", origin: "scope_check", side, fields };
}

export function resolveIntlInvestigation(input: IntlCallerInput): IntlCallerResult {
  if (input.disposition !== "resolved") {
    return { kind: "disposition", disposition: input.disposition, origin: "caller" };
  }
  const { exactContext, prior, current, requirements, owner } = input;

  const currentBuild = toIntlEvidenceCensus(current, exactContext);
  if (!currentBuild.ok) {
    if (currentBuild.reason === "context_mismatch" && buildUnderOwnContext(current, exactContext).ok) {
      return scopeChanged("current", current, exactContext);
    }
  } else if (prior !== null) {
    const priorBuild = toIntlEvidenceCensus(prior, exactContext);
    if (!priorBuild.ok) {
      // exactContext built a usable current, so any other refusal is the
      // prior's own and already under its own context.
      const own = priorBuild.reason === "context_mismatch" ? buildUnderOwnContext(prior, exactContext) : priorBuild;
      if (own.ok) return scopeChanged("prior", prior, exactContext);
      return { kind: "disposition", disposition: "invalid", origin: "owner_check", side: "prior", reason: own.reason };
    }
  }

  const review = reviewIntlEvidence(prior, current, exactContext, requirements);
  const composition = composeIntlInvestigationPanel({ review, exactContext, requirements, owner });
  return { kind: "resolved", review, composition };
}
