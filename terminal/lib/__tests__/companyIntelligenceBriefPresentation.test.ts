import { describe, expect, it } from "vitest";
import { selectBriefChanges, type IndexedBriefClaim } from "../companyIntelligenceBriefPresentation";

function claim(index: number, text: string, overrides: Partial<IndexedBriefClaim> = {}): IndexedBriefClaim {
  return { eventId: "nvda-q1", index, text, sourceRef: "earnings_history", ...overrides };
}

describe("v1 brief presentation", () => {
  it("promotes the original headline source and omits changes already shown as event facts", () => {
    const headline = claim(0, "Record data center revenue of $75B (+92% YoY)");
    const takeaways = [claim(1, "New Vera CPU"), claim(2, "Q2 guidance of $91B"), claim(3, "China excluded from outlook")];
    const changes = [headline, claim(1, takeaways[0].text), claim(2, takeaways[1].text)];
    const result = selectBriefChanges({ headline, takeaways, changes });
    expect(result.headlineEvidence).toBe(changes[0]);
    expect(result.headlineEvidence?.index).toBe(0);
    expect(result.changes).toEqual([]);
    expect(takeaways.map(item => item.index)).toEqual([1, 2, 3]);
  });

  it("preserves equal wording from different events, different sources and unresolved sources", () => {
    const headline = claim(0, "Revenue increased");
    const changes = [
      claim(0, headline.text, { eventId: "nvda-q2" }),
      claim(1, headline.text, { sourceRef: "score_overlay" }),
      claim(2, headline.text, { sourceRef: null }),
    ];
    const result = selectBriefChanges({ headline, takeaways: [], changes });
    expect(result.headlineEvidence).toBeNull();
    expect(result.changes).toEqual(changes);
    const unresolved = claim(0, headline.text, { sourceRef: null });
    expect(selectBriefChanges({ headline: unresolved, takeaways: [unresolved], changes: [unresolved] }).changes).toEqual([unresolved]);
  });

  it("backfills distinct later changes without renumbering their source indices", () => {
    const headline = claim(0, "Revenue increased");
    const fact = claim(1, "Margins expanded");
    const changes = [headline, fact, claim(2, fact.text), claim(3, "New customer wins"), claim(4, "New customer wins"), claim(5, "Capacity expanded"), claim(6, "Demand sustained"), claim(7, "Another change")];
    const result = selectBriefChanges({ headline, takeaways: [fact], changes });
    expect(result.changes.map(item => item.index)).toEqual([3, 5, 6]);
    expect(result.changes[0]).toBe(changes[3]);
    expect(result.changes[1]).toBe(changes[5]);
  });

  it("coalesces whitespace only, retaining numeric, case, punctuation and negation differences", () => {
    const headline = claim(0, "Revenue increased 10%.");
    const repeated = claim(1, "  Revenue\n increased   10%.  ");
    expect(selectBriefChanges({ headline, takeaways: [], changes: [repeated] }).headlineEvidence).toBe(repeated);
    for (const text of ["Revenue increased 11%.", "revenue increased 10%.", "Revenue increased 10%!", "Revenue did not increase 10%.", "Revenue increased -10%."]) {
      const distinct = claim(2, text);
      const result = selectBriefChanges({ headline, takeaways: [], changes: [distinct] });
      expect(result.headlineEvidence).toBeNull();
      expect(result.changes).toEqual([distinct]);
    }
  });
});
