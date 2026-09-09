/**
 * sectionAccountDeletionStatus.test.ts — the pure gate deciding whether a filed deletion
 * receipt blocks the "Delete my account" form (B-F12-4, review MAJOR round 2).
 *
 * Before this fix, SectionAccount.tsx showed the receipt row (and hid the form) for ANY
 * filed row regardless of status, so a cancelled/failed request permanently removed the
 * owner's ability to file another. `isActiveDeletionStatus` is the exact predicate that
 * decides that gate — exported from the component so this suite can pin it without a DOM.
 */
import { describe, expect, it } from "vitest";
import { isActiveDeletionStatus } from "@/components/settings/SectionAccount";

describe("isActiveDeletionStatus", () => {
  it("is active for an open or completed request", () => {
    expect(isActiveDeletionStatus("received")).toBe(true);
    expect(isActiveDeletionStatus("in_progress")).toBe(true);
    expect(isActiveDeletionStatus("completed")).toBe(true);
  });

  it("is NOT active for a cancelled or failed request — the form must remain available", () => {
    expect(isActiveDeletionStatus("cancelled")).toBe(false);
    expect(isActiveDeletionStatus("failed")).toBe(false);
  });

  it("is NOT active for an unrecognized status (fail closed toward showing the form, never toward a false permanent receipt)", () => {
    expect(isActiveDeletionStatus("")).toBe(false);
    expect(isActiveDeletionStatus("something_new")).toBe(false);
  });
});
