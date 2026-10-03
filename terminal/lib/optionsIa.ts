import type { TabKey } from "@/components/OptionsHubView";

export const OPTIONS_CATEGORY_KEYS = [
  "command",
  "flow",
  "exposure",
  "structure",
  "volatility",
  "statistics",
  "plan",
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
  enLabel?: string;
  zhLabel?: string;
}

export interface OptionsIaCategory {
  key: OptionsCategoryKey;
  labelKey: string;
  enLabel?: string;
  zhLabel?: string;
  defaultView: OptionsWorkspaceViewKey;
  views: readonly OptionsIaView[];
}

/**
 * The categorized IA preserves every existing Options pane and adds one deterministic
 * Plan surface. Statistics still has no child view until its separately-gated publisher
 * exists; Payoff Lab owns no feed, pricing, probability, order, or signal authority.
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
    key: "plan",
    labelKey: "optionsCategoryPlan",
    enLabel: "Plan",
    zhLabel: "计划",
    defaultView: "payoff",
    views: [
      { key: "payoff", pageKey: "payoff", labelKey: "wtPayoff", enLabel: "Payoff Lab", zhLabel: "到期收益" },
    ],
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
  payoff: "plan",
  prophet: "prophet",
};

export const OPTIONS_IA_BY_CATEGORY: Record<OptionsCategoryKey, OptionsIaCategory> = {
  command: OPTIONS_IA_CATEGORIES[0],
  flow: OPTIONS_IA_CATEGORIES[1],
  exposure: OPTIONS_IA_CATEGORIES[2],
  structure: OPTIONS_IA_CATEGORIES[3],
  volatility: OPTIONS_IA_CATEGORIES[4],
  statistics: OPTIONS_IA_CATEGORIES[5],
  plan: OPTIONS_IA_CATEGORIES[6],
  prophet: OPTIONS_IA_CATEGORIES[7],
};

export const OPTIONS_IA_VIEW_BY_KEY = Object.fromEntries(
  OPTIONS_IA_CATEGORIES.flatMap((category) => category.views.map((view) => [view.key, view])),
) as Record<OptionsHubWorkspaceViewKey, OptionsIaView>;

export function optionsCategoryForView(view: OptionsWorkspaceViewKey): OptionsCategoryKey {
  return OPTIONS_CATEGORY_BY_VIEW[view];
}
