// rsix — RUNTIME suite definition: the metadata, plus every module's `compute`.
//
// Loaded ONLY through lib/suites/compute.ts, and only once the suite is active on the chart.
// Importing this file pulls the whole implementation graph, which is exactly what the metadata
// registry exists to avoid — nothing on the boot path may import it.
//
// The module ORDER here is the metadata's order and is asserted against it in
// lib/__tests__/suiteRegistrySplit.test.ts: module order drives sub-pane creation, legend rows
// and z-order, so a reordering would be a visible change, not a cosmetic one.

import type { SuiteDef } from "@/lib/indicator-canvas/types";
import { RSIX_SUITE_META } from "../meta";
import { RSI_ENGINE_MODULE } from "../rsix/rsiEngine";
import { RSI_SIGNALS_MODULE } from "../rsix/rsiSignals";
import { RSI_DIVERGENCE_MODULE } from "../rsix/rsiDivergence";
import { RSI_CHANNELS_MODULE } from "../rsix/rsiChannels";
import { RSIX_MTF_MODULE } from "../rsix/mtfDash";

export const RSIX_SUITE: SuiteDef = {
  ...RSIX_SUITE_META,
  modules: [
    RSI_ENGINE_MODULE,
    RSI_SIGNALS_MODULE,
    RSI_DIVERGENCE_MODULE,
    RSI_CHANNELS_MODULE,
    RSIX_MTF_MODULE,
  ],
};

export default RSIX_SUITE;
