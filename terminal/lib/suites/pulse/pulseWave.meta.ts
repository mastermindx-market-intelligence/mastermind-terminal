// pulseWave — METADATA ONLY (identity, settings schema, parameter defaults).
//
// Split out of the implementation file so the picker, the legend, the settings dialog and
// TerminalShell's boot path can read a module's identity WITHOUT importing its compute.
// The literal below is the single canonical definition; the implementation spreads it.
// See lib/suites/README-split.md.

import type { SuiteModuleMeta } from "@/lib/indicator-canvas/types";
import type { SuiteField } from "@/lib/indicator-canvas/types";

const FIELDS: SuiteField[] = [
  {
    key: "profile",
    label: "Profile",
    type: "select",
    options: [
      { v: "scalper", label: "Scalper" },
      { v: "day", label: "Day Trader" },
      { v: "swing", label: "Swing Trader" },
    ],
    tip: "Smoothing preset for the WHOLE pane — Signals and Divergences follow it. Scalper reacts fastest, Swing is the calmest.",
  },
  {
    key: "gapped",
    label: "Gapped Line",
    type: "bool",
    tip: "Slower companion line lagging the wave — the spread between them shows thrust.",
  },
  {
    key: "fillGaps",
    label: "Fill Gaps",
    type: "bool",
    showIf: { key: "gapped", eq: true },
    tip: "Shade the spread between the wave and the gapped line, colored by the wave state.",
  },
];

const DEFAULTS: Record<string, any> = {
  profile: "day",
  gapped: true,
  fillGaps: true,
};

export const PULSE_WAVE_META: SuiteModuleMeta = {
  key: "wave",
  label: "Pulse Wave",
  tag: "PW",
  tier: "essential",
  defaultOn: true,
  fields: FIELDS,
  defaults: DEFAULTS,
};
