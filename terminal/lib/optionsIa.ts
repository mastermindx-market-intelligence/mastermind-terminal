import type { TabKey } from "@/components/OptionsHubView";

export const OPTIONS_CATEGORY_KEYS = [
  "command",
  "flow",
  "exposure",
  "structure",
  "volatility",
  "statistics",
  "prophet",
] as const;

export type OptionsCategoryKey = (typeof OPTIONS_CATEGORY_KEYS)[number];
export type OptionsHubWorkspaceViewKey = Exclude<TabKey, "leaders" | "radar">;
export type OptionsWorkspaceViewKey = OptionsHubWorkspaceViewKey | "statistics";

export interface OptionsIaView {
  key: OptionsHubWorkspaceViewKey;
  /** Stable `?tab=` value. Legacy aliases remain read-compatible in OptionsWorkspace. */
  pageKey: string;
  labelKey: string;
}

export interface OptionsIaCategory {
  key: OptionsCategoryKey;
  labelKey: string;
  defaultView: OptionsWorkspaceViewKey;
  views: readonly OptionsIaView[];
}

export const OPTIONS_JOB_KEYS = [
  "command",
  "flow",
  "positioning",
  "research",
] as const;

export type OptionsJobKey = (typeof OPTIONS_JOB_KEYS)[number];

export interface OptionsIaJob {
  key: OptionsJobKey;
  labelKey: string;
  defaultView: OptionsWorkspaceViewKey;
  views: readonly OptionsWorkspaceViewKey[];
}

/**
 * R5 Stage A is presentation-only: every existing Options pane keeps its component,
 * payload, and authority contract while the flat rail becomes the seven-category IA.
 * Statistics has no child view until its separately-gated R3 publisher exists.
 */
export const OPTIONS_IA_CATEGORIES = [
  {
    key: "command",
    labelKey: "optionsCategoryCommand",
    defaultView: "desk",
    views: [
      { key: "desk", pageKey: "desk", labelKey: "wtFlowDesk" },
    ],
  },
  {
    key: "flow",
    labelKey: "optionsCategoryFlow",
    defaultView: "tape",
    views: [
      { key: "tape", pageKey: "tape", labelKey: "wtOptionsTape" },
      { key: "tide", pageKey: "tide", labelKey: "wtTide" },
      { key: "zero_dte", pageKey: "0dte", labelKey: "wtZeroDte" },
      { key: "largest", pageKey: "largest", labelKey: "wtLargestEvents" },
      { key: "surface", pageKey: "surface", labelKey: "tabSurface" },
      { key: "screener", pageKey: "vol", labelKey: "wtOptionsScreener" },
      { key: "tickers", pageKey: "tickers", labelKey: "wtTickers" },
    ],
  },
  {
    key: "exposure",
    labelKey: "optionsCategoryExposure",
    defaultView: "gex",
    views: [
      { key: "gex", pageKey: "gex", labelKey: "wtGex" },
      { key: "positioning", pageKey: "positioning", labelKey: "wtPositioning" },
      { key: "levels", pageKey: "levels", labelKey: "wtLevels" },
    ],
  },
  {
    key: "structure",
    labelKey: "optionsCategoryStructure",
    defaultView: "structure",
    views: [
      { key: "structure", pageKey: "structure", labelKey: "wtStructure" },
    ],
  },
  {
    key: "volatility",
    labelKey: "optionsCategoryVolatility",
    defaultView: "volatility",
    views: [
      { key: "volatility", pageKey: "volatility", labelKey: "wtVolatility" },
    ],
  },
  {
    key: "statistics",
    labelKey: "optionsCategoryStatistics",
    defaultView: "statistics",
    views: [],
  },
  {
    key: "prophet",
    labelKey: "optionsCategoryProphet",
    defaultView: "prophet",
    views: [
      { key: "prophet", pageKey: "prophet", labelKey: "wtProphet" },
    ],
  },
] as const satisfies readonly OptionsIaCategory[];

/**
 * Trader-job command surface. The seven-category registry above remains the
 * compatibility/architecture taxonomy and continues to own every legacy deep link.
 */
export const OPTIONS_IA_JOBS = [
  { key: "command", labelKey: "optionsJobCommand", defaultView: "desk", views: ["desk"] },
  { key: "flow", labelKey: "optionsJobFlow", defaultView: "tape", views: ["tape", "tide", "zero_dte", "largest", "screener", "tickers"] },
  { key: "positioning", labelKey: "optionsJobPositioning", defaultView: "gex", views: ["gex", "surface", "positioning", "levels"] },
  { key: "research", labelKey: "optionsJobResearch", defaultView: "structure", views: ["structure", "volatility", "prophet", "statistics"] },
] as const satisfies readonly OptionsIaJob[];

export const OPTIONS_IA_BY_JOB: Record<OptionsJobKey, OptionsIaJob> = {
  command: OPTIONS_IA_JOBS[0],
  flow: OPTIONS_IA_JOBS[1],
  positioning: OPTIONS_IA_JOBS[2],
  research: OPTIONS_IA_JOBS[3],
};

export const OPTIONS_JOB_BY_VIEW = Object.fromEntries(
  OPTIONS_IA_JOBS.flatMap((job) => job.views.map((view) => [view, job.key])),
) as Record<OptionsWorkspaceViewKey, OptionsJobKey>;

export function optionsJobForView(view: OptionsWorkspaceViewKey): OptionsJobKey {
  return OPTIONS_JOB_BY_VIEW[view];
}

export const OPTIONS_HUB_WORKSPACE_VIEWS = OPTIONS_IA_CATEGORIES.flatMap(
  (category) => category.views.map((view) => view.key),
) as OptionsHubWorkspaceViewKey[];

export const OPTIONS_CATEGORY_BY_VIEW: Record<OptionsWorkspaceViewKey, OptionsCategoryKey> = {
  desk: "command",
  tape: "flow",
  tide: "flow",
  zero_dte: "flow",
  largest: "flow",
  surface: "flow",
  screener: "flow",
  tickers: "flow",
  gex: "exposure",
  positioning: "exposure",
  levels: "exposure",
  structure: "structure",
  volatility: "volatility",
  statistics: "statistics",
  prophet: "prophet",
};

export const OPTIONS_IA_BY_CATEGORY: Record<OptionsCategoryKey, OptionsIaCategory> = {
  command: OPTIONS_IA_CATEGORIES[0],
  flow: OPTIONS_IA_CATEGORIES[1],
  exposure: OPTIONS_IA_CATEGORIES[2],
  structure: OPTIONS_IA_CATEGORIES[3],
  volatility: OPTIONS_IA_CATEGORIES[4],
  statistics: OPTIONS_IA_CATEGORIES[5],
  prophet: OPTIONS_IA_CATEGORIES[6],
};

export const OPTIONS_IA_VIEW_BY_KEY = Object.fromEntries(
  OPTIONS_IA_CATEGORIES.flatMap((category) => category.views.map((view) => [view.key, view])),
) as Record<OptionsHubWorkspaceViewKey, OptionsIaView>;

export function optionsCategoryForView(view: OptionsWorkspaceViewKey): OptionsCategoryKey {
  return OPTIONS_CATEGORY_BY_VIEW[view];
}
