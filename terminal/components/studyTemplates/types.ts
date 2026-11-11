// E07 — shapes shared by the template host and its two dialogs (types only; no runtime code).
import type { AccountStudyTemplate } from "@/lib/studyTemplatesClient";
import type { DeviceStudyTemplate } from "@/lib/chartTemplates";

/** The signed-in owner's account library as the host last read it. Each state renders differently. */
export type AccountTemplatesState =
  | { status: "guest" }
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "unavailable" }
  | { status: "ok"; templates: AccountStudyTemplate[]; unreadable: number; truncated: boolean };

export type TemplateSource = "account" | "device";

export type TemplateRef = { source: TemplateSource; id: string };

export type ResolvedTemplate =
  | { source: "account"; template: AccountStudyTemplate }
  | { source: "device"; template: DeviceStudyTemplate };

export type TemplatePlanContext = {
  /** Guest charts keep only this many studies; `null` when signed in. */
  guestLimit: number | null;
  userTier: "free" | "essential" | "pro";
};
