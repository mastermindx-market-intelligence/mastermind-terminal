// volumeMapping — METADATA ONLY (identity, settings schema, parameter defaults).
//
// Split out of the implementation file so the picker, the legend, the settings dialog and
// TerminalShell's boot path can read a module's identity WITHOUT importing its compute.
// The literal below is the single canonical definition; the implementation spreads it.
// See lib/suites/README-split.md.

import type { SuiteModuleMeta } from "@/lib/indicator-canvas/types";
import type { SuiteField } from "@/lib/indicator-canvas/types";

const FIELDS: SuiteField[] = [
  {
    key: "window",
    label: "Volume Window",
    type: "number",
    min: 50,
    max: 400,
    step: 10,
    tip: "Bars in the trailing volume maximum that scales column height. Shorter = more local; longer = the rail keeps its memory of past volume peaks.",
  },
];

const DEFAULTS: Record<string, any> = {
  window: 100,
};

export const VOLUME_MAPPING_META: SuiteModuleMeta = {
  key: "vmap",
  label: "Volume Mapping",
  tag: "VM",
  tier: "pro",
  defaultOn: false,
  fields: FIELDS,
  defaults: DEFAULTS,
};
