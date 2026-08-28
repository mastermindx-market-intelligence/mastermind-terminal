// mtfDash — METADATA ONLY (identity, settings schema, parameter defaults).
//
// Split out of the implementation file so the picker, the legend, the settings dialog and
// TerminalShell's boot path can read a module's identity WITHOUT importing its compute.
// The literal below is the single canonical definition; the implementation spreads it.
// See lib/suites/README-split.md.

import type { SuiteField, SuiteModuleMeta } from "@/lib/indicator-canvas/types";
import { mtfDefaults, mtfFields } from "@/lib/suites/shared/mtfTable";

const FIELDS: SuiteField[] = mtfFields();
const DEFAULTS: Record<string, any> = mtfDefaults("br", false);


export const MACDX_MTF_META: SuiteModuleMeta = {
  key: "mtf",
  label: "MTF Dashboard",
  tag: "MTF",
  tier: "pro",
  defaultOn: false,
  fields: FIELDS,
  defaults: DEFAULTS,
};
