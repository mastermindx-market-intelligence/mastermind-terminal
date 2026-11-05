"use client";
// E07 — plain-language text for the template dialogs: entry names (never a raw study key), skip
// reasons and write errors. Imported only by the dynamically loaded dialogs (the planner is heavy).
import { useCallback } from "react";
import { STUDY_TEMPLATE_LIMITS } from "@/lib/studyTemplateSchema";
import { studyTemplateEntryLabel, type StudyTemplateSkipReason } from "@/lib/studyTemplates";
import { MAX_INSTANCES_PER_TYPE } from "@/lib/studyInstances";
import { useStudyTemplatesT } from "@/lib/studyTemplatesLex";

type T = (key: string, vars?: Record<string, string | number>) => string;

/** A display name for a template or chart entry. Compare overlays and scripts get a generic name. */
export function entryLabel(t: T, key: string, activeIds: Iterable<string> = [], params?: unknown): string {
  if (key.startsWith("cmp:")) {
    const symbol = key.slice(4).trim();
    return symbol ? `${t("stplCompareOverlay")} ${symbol}` : t("stplCompareOverlay");
  }
  if (key.startsWith("pine:")) return t("stplScript");
  return studyTemplateEntryLabel(key, activeIds, params) ?? t("stplUnknownStudy");
}

export function useEntryLabel() {
  const t = useStudyTemplatesT();
  return useCallback((key: string, activeIds?: Iterable<string>, params?: unknown) => entryLabel(t, key, activeIds, params), [t]);
}

export function reasonText(t: T, reason: StudyTemplateSkipReason, guestLimit: number | null): string {
  switch (reason) {
    case "unsupported_multiplicity": return t("stplReasonUnsupportedMultiplicity");
    case "over_cap": return t("stplReasonOverCap", { max: MAX_INSTANCES_PER_TYPE });
    case "collision": return t("stplReasonCollision");
    case "not_portable": return t("stplReasonNotPortable");
    case "guest_limit": return t("stplReasonGuestLimit", { max: guestLimit ?? 0 });
    case "unknown_study":
    default: return t("stplReasonUnknown");
  }
}

/**
 * The message for a refused or failed write. `op` picks the fallback wording so a failed delete
 * says nothing was removed and a failed rename says the old name was kept.
 */
export function writeErrorText(t: T, code: string, op: "save" | "rename" | "delete" = "save"): string {
  switch (code) {
    case "invalid_name": return t("stplErrInvalidName");
    case "name_too_long": return t("stplErrNameTooLong", { max: STUDY_TEMPLATE_LIMITS.nameMax });
    case "empty": return t("stplErrEmpty");
    case "too_many_studies": return t("stplErrTooMany", { max: STUDY_TEMPLATE_LIMITS.studiesMax });
    case "too_large": return t("stplErrTooLarge");
    case "invalid_body":
    case "invalid_id": return t("stplErrInvalidBody");
    case "name_taken": return t("stplErrNameTaken");
    case "limit_reached": return t("stplErrLimit", { max: STUDY_TEMPLATE_LIMITS.templatesMax });
    case "signed_out": return t("stplErrSignedOut");
    case "conflict": return t("stplErrConflict");
    case "newer_version": return t("stplErrNewer");
    case "not_found": return t("stplErrNotFound");
    case "unreadable": return t("stplErrUnreadable");
    case "storage_blocked": return op === "save" ? t("stplErrStorageBlocked") : op === "delete" ? t("stplErrDeleteFailed") : t("stplErrRenameFailed");
    case "unavailable": return op === "save" ? t("stplErrUnavailable") : op === "delete" ? t("stplErrDeleteFailed") : t("stplErrRenameFailed");
    case "write_failed":
    default: return op === "save" ? t("stplErrWriteFailed") : op === "delete" ? t("stplErrDeleteFailed") : t("stplErrRenameFailed");
  }
}
