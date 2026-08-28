// moneyFlowProfile — METADATA ONLY (identity, settings schema, parameter defaults).
//
// Split out of the implementation file so the picker, the legend, the settings dialog and
// TerminalShell's boot path can read a module's identity WITHOUT importing its compute.
// The literal below is the single canonical definition; the implementation spreads it.
// See lib/suites/README-split.md.

import type { SuiteModuleMeta } from "@/lib/indicator-canvas/types";
import type { SuiteField } from "@/lib/indicator-canvas/types";

const FIELDS: SuiteField[] = [
  {
    key: "length",
    label: "Lookback (bars)",
    type: "number",
    min: 100,
    max: 1000,
    step: 10,
    tip: "How many recent bars the profile is built from.",
  },
  {
    key: "levels",
    label: "Levels",
    type: "number",
    min: 10,
    max: 40,
    step: 1,
    tip: "Number of price bins the lookback range is split into.",
  },
  {
    key: "pocMetric",
    label: "POC Metric",
    type: "select",
    options: [
      { v: "moneyFlow", label: "Money flow" },
      { v: "deltaPos", label: "Delta +" },
      { v: "deltaNeg", label: "Delta −" },
      { v: "strength", label: "Level strength" },
    ],
    tip: "Which bin wins the point of control: most money traded, most buy-side delta, most sell-side delta, or most volume.",
  },
  {
    key: "valueArea",
    label: "Value Area",
    type: "bool",
    tip: "Dashed VAH/VAL hairlines around the POC.",
  },
  {
    key: "vaPct",
    label: "Value Area %",
    type: "number",
    min: 50,
    max: 90,
    step: 5,
    tip: "Share of the window's volume the value area must contain.",
    showIf: { key: "valueArea", eq: true },
  },
  {
    key: "labels",
    label: "Labels",
    type: "bool",
    tip: "Level-strength % on the heaviest rows, plus POC / VAH / VAL text.",
  },
];

const DEFAULTS: Record<string, any> = {
  length: 400,
  levels: 24,
  pocMetric: "moneyFlow",
  valueArea: true,
  vaPct: 70,
  labels: true,
};

export const MONEY_FLOW_PROFILE_META: SuiteModuleMeta = {
  key: "mfp",
  label: "Money Flow Profile",
  tag: "MFP",
  tier: "pro",
  defaultOn: false,
  fields: FIELDS,
  defaults: DEFAULTS,
};
