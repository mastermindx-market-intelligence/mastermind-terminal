// pulse — RUNTIME suite definition: the metadata, plus every module's `compute`.
//
// Loaded ONLY through lib/suites/compute.ts, and only once the suite is active on the chart.
// Importing this file pulls the whole implementation graph, which is exactly what the metadata
// registry exists to avoid — nothing on the boot path may import it.
//
// The module ORDER here is the metadata's order and is asserted against it in
// lib/__tests__/suiteRegistrySplit.test.ts: module order drives sub-pane creation, legend rows
// and z-order, so a reordering would be a visible change, not a cosmetic one.

import type { SuiteDef } from "@/lib/indicator-canvas/types";
import { PULSE_SUITE_META } from "../meta";
import { PULSE_WAVE_MODULE } from "../pulse/pulseWave";
import { PULSE_SIGNALS_MODULE } from "../pulse/pulseSignals";
import { PULSE_DIVERGENCE_MODULE } from "../pulse/divergences";
import { VOLUME_MAPPING_MODULE } from "../pulse/volumeMapping";
import { FLOWS_MODULE } from "../pulse/flows";
import { PULSE_MTF_MODULE } from "../pulse/mtfDash";

export const PULSE_SUITE: SuiteDef = {
  ...PULSE_SUITE_META,
  modules: [
    PULSE_WAVE_MODULE,
    PULSE_SIGNALS_MODULE,
    PULSE_DIVERGENCE_MODULE,
    VOLUME_MAPPING_MODULE,
    FLOWS_MODULE,
    PULSE_MTF_MODULE,
  ],
};

export default PULSE_SUITE;
