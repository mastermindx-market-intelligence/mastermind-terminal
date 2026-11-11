import { describe, expect, it } from "vitest";
import {
  CATALYST_CONTEXT_LABEL,
  catalystLabel,
  catalystPhrase,
} from "@/lib/dislocations/catalystLabels";

describe("catalystLabels", () => {
  it("map has exactly the five producer keys", () => {
    expect(Object.keys(CATALYST_CONTEXT_LABEL).sort()).toEqual(
      [
        "blocking_event_observed",
        "event_aftermath_observed",
        "event_classification_unknown",
        "no_blocking_event_observed",
        "soft_event_observed",
      ].sort(),
    );
  });

  it("every EN and ZH label is non-empty and contains no underscore", () => {
    for (const pair of Object.values(CATALYST_CONTEXT_LABEL)) {
      expect(pair[0].length).toBeGreaterThan(0);
      expect(pair[1].length).toBeGreaterThan(0);
      expect(pair[0]).not.toMatch(/_/);
      expect(pair[1]).not.toMatch(/_/);
    }
  });

  it("catalystLabel returns null when cat or knowableAt missing", () => {
    expect(catalystLabel(undefined, "2026-10-05T14:00:00.000Z", "en")).toBeNull();
    expect(
      catalystLabel({ relevant_until: "2026-10-05T15:00:00.000Z" }, null, "en"),
    ).toBeNull();
  });

  it("catalystPhrase falls back and nulls on empty coverage", () => {
    expect(catalystPhrase({ context_state: "zzz", coverage: "" }, "en")).toBeNull();
    expect(catalystPhrase({ coverage: "earnings aftermath" }, "zh")).toBe("earnings aftermath");
  });
});
