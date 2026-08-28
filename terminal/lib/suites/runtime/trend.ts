// trend — RUNTIME suite definition: the metadata, plus every module's `compute`.
//
// Loaded ONLY through lib/suites/compute.ts, and only once the suite is active on the chart.
// Importing this file pulls the whole implementation graph, which is exactly what the metadata
// registry exists to avoid — nothing on the boot path may import it.
//
// The module ORDER here is the metadata's order and is asserted against it in
// lib/__tests__/suiteRegistrySplit.test.ts: module order drives sub-pane creation, legend rows
// and z-order, so a reordering would be a visible change, not a cosmetic one.

import type { SuiteDef } from "@/lib/indicator-canvas/types";
import { TREND_SUITE_META } from "../meta";
import { TREND_ENGINE_MODULE } from "../trend/trendEngine";
import { FLOW_BAND_MODULE } from "../trend/flowBand";
import { VOLT_BANDS_MODULE } from "../trend/voltixBands";
import { CANDLE_PAINTER_MODULE } from "../trend/candlePainter";
import { MARKET_DASHBOARD_MODULE } from "../trend/marketDashboard";

export const TREND_SUITE: SuiteDef = {
  ...TREND_SUITE_META,
  modules: [
    TREND_ENGINE_MODULE,
    FLOW_BAND_MODULE,
    VOLT_BANDS_MODULE,
    CANDLE_PAINTER_MODULE,
    MARKET_DASHBOARD_MODULE,
  ],
};

export default TREND_SUITE;
