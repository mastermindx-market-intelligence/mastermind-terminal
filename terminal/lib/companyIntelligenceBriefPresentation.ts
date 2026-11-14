import type { CompanyIntelligenceSourceRef } from "./companyIntelligence";

interface BriefClaim {
  eventId: string;
  text: string;
  sourceRef: CompanyIntelligenceSourceRef | null;
}

export interface IndexedBriefClaim extends BriefClaim {
  index: number;
}

function sameClaim(left: BriefClaim, right: BriefClaim): boolean {
  const normalize = (text: string) => text.trim().replace(/\s+/g, " ");
  return left.eventId === right.eventId
    && left.sourceRef !== null
    && left.sourceRef === right.sourceRef
    && normalize(left.text) === normalize(right.text);
}

/** Coalesce repeated v1 presentation only when event, resolved source and wording agree. */
export function selectBriefChanges({
  headline,
  takeaways,
  changes,
}: {
  headline: BriefClaim;
  takeaways: readonly BriefClaim[];
  changes: readonly IndexedBriefClaim[];
}): { headlineEvidence: IndexedBriefClaim | null; changes: IndexedBriefClaim[] } {
  // The plain headline has no evidence action. Promote the original positive item
  // before omitting its repeated row, so the original ID and receipt remain reachable.
  const headlineEvidence = changes.find(item => sameClaim(item, headline)) ?? null;
  const displayed: BriefClaim[] = headlineEvidence ? [headlineEvidence, ...takeaways] : [...takeaways];
  const distinctChanges: IndexedBriefClaim[] = [];
  for (const item of changes) {
    if (displayed.some(prior => sameClaim(item, prior))) continue;
    distinctChanges.push(item);
    displayed.push(item);
    if (distinctChanges.length === 3) break;
  }
  return { headlineEvidence, changes: distinctChanges };
}
