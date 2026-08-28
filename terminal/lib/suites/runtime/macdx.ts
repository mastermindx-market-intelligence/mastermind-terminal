// macdx — RUNTIME suite definition: the metadata, plus every module's `compute`.
//
// Loaded ONLY through lib/suites/compute.ts, and only once the suite is active on the chart.
// Importing this file pulls the whole implementation graph, which is exactly what the metadata
// registry exists to avoid — nothing on the boot path may import it.
//
// The module ORDER here is the metadata's order and is asserted against it in
// lib/__tests__/suiteRegistrySplit.test.ts: module order drives sub-pane creation, legend rows
// and z-order, so a reordering would be a visible change, not a cosmetic one.

import type { SuiteDef } from "@/lib/indicator-canvas/types";
import { MACDX_SUITE_META } from "../meta";
import { MACD_ENGINE_MODULE } from "../macdx/macdEngine";
import { MACD_SIGNALS_MODULE } from "../macdx/macdSignals";
import { MACD_HISTOGRAM_MODULE } from "../macdx/macdHistogram";
import { MACD_DIVERGENCE_MODULE } from "../macdx/macdDivergence";
import { MACD_TREND_MODULE } from "../macdx/macdTrend";
import { MACDX_MTF_MODULE } from "../macdx/mtfDash";

export const MACDX_SUITE: SuiteDef = {
  ...MACDX_SUITE_META,
  modules: [
    MACD_ENGINE_MODULE,
    MACD_SIGNALS_MODULE,
    MACD_HISTOGRAM_MODULE,
    MACD_DIVERGENCE_MODULE,
    MACD_TREND_MODULE,
    MACDX_MTF_MODULE,
  ],
};

export default MACDX_SUITE;
