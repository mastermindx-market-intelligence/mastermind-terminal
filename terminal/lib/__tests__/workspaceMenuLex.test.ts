// W2-A key-parity check, same pattern as lib/__tests__/feedFreshness.test.ts's NEW_KEYS block:
// every key this wave adds or revalues must carry a real EN string, a real ZH string, and the two
// must actually differ — a missing/placeholder ZH value is exactly how a feature ships English-only
// under a language switch that silently no-ops.

import { describe, expect, it } from "vitest";
import { LEX } from "@/lib/i18n";

// Existing keys whose VALUE changed for the Layouts → Workspaces rename (spec §2.1). Ids unchanged.
const REVALUED_KEYS = [
  "layouts", "saveCurrentAs", "noSavedLayouts", "layoutsLoading", "layoutsUnavailable",
  "layoutSaveFailed", "layoutDeleteFailed", "layoutSignInToSave", "layoutSaved",
  "gateLayouts",
] as const;

// New keys (spec §2.2): the menu chrome, the frozen §8 failure vocabulary mapped to plain words,
// and the unsupported-widget tile.
const NEW_KEYS = [
  "wsSectionSaved", "wsIncludeBrain", "wsIncludeBrainSub", "wsRowActions", "wsOpen", "wsDuplicate",
  "wsExport", "wsImport", "wsRenameSave", "wsCancel", "wsRenamed", "wsDuplicated", "wsImported",
  "wsNameTaken", "wsUseSuggested", "wsChangedElsewhere", "wsChangedElsewhereSub", "wsReloadLatest",
  "wsSaveAsCopy", "wsBadgeNewer", "wsNeedsNewer", "wsBadgeUnreadable", "wsCantOpen",
  "wsImportBad", "wsImportTooBig", "wsImportTooManyPanels", "wsImportUnknownPanel",
  "wsRenameFailed", "wsDuplicateFailed", "wsExportFailed",
  "wsPanelUnavailable", "wsPanelUnavailableSub", "wsPanelType",
  // Reviewer repair wave (B2/M4): the unreadable-settings disclosure + the capture-refuses-to-save copy.
  "wsUnclaimedNote", "wsSaveUnreadable",
  // Reviewer re-verification wave (M5b): the unsupported-panel disclosure.
  "wsUnclaimedPanels",
] as const;

// Reviewer ruling N15: `wsGone` was dead (minted, never wired to any real 404 surface) and was
// removed rather than kept as an untested, unreachable string. `layoutNameTaken` was ALSO dead but
// is kept, revalued to the "workspace" copy family (matches `wsNameTaken` verbatim) — the legacy
// POST path's own `name_taken` 409 has no dedicated UI branch today, but the string should already
// speak the current vocabulary if a caller ever surfaces it.

describe("W2-A workspace-menu lexicon", () => {
  it.each([...REVALUED_KEYS, ...NEW_KEYS])("%s has a real, distinct EN and ZH value", (key) => {
    expect(LEX[key], `missing lexicon entry: ${key}`).toBeDefined();
    expect(LEX[key][0], `missing EN: ${key}`).toBeTruthy();
    expect(LEX[key][1], `missing ZH: ${key}`).toBeTruthy();
    expect(LEX[key][1], `zh == en for ${key}`).not.toBe(LEX[key][0]);
  });

  it("'rename' is reused, not re-minted (spec §2.1)", () => {
    expect(LEX.rename).toEqual(["Rename", "重命名"]);
  });

  it("the Brain-dock toggle copy never says 'workspace' twice redundantly and states what gets saved", () => {
    expect(LEX.wsIncludeBrainSub[0].toLowerCase()).toContain("workspace");
  });

  it("every failure string ends with an explicit outcome statement (freeze §11 — never a silent drop)", () => {
    const mustStateOutcome = ["wsImportBad", "wsImportTooBig", "wsImportTooManyPanels", "wsImportUnknownPanel"];
    for (const key of mustStateOutcome) {
      expect(LEX[key][0], `${key} EN`).toMatch(/nothing was imported/i);
      expect(LEX[key][1], `${key} ZH`).toContain("未导入任何内容");
    }
  });
});
