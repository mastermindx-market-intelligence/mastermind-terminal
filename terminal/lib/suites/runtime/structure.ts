// structure — RUNTIME suite definition: the metadata, plus every module's `compute`.
//
// Loaded ONLY through lib/suites/compute.ts, and only once the suite is active on the chart.
// Importing this file pulls the whole implementation graph, which is exactly what the metadata
// registry exists to avoid — nothing on the boot path may import it.
//
// The module ORDER here is the metadata's order and is asserted against it in
// lib/__tests__/suiteRegistrySplit.test.ts: module order drives sub-pane creation, legend rows
// and z-order, so a reordering would be a visible change, not a cosmetic one.

import type { SuiteDef } from "@/lib/indicator-canvas/types";
import { STRUCTURE_SUITE_META } from "../meta";
import { MARKET_STRUCTURE_MODULE } from "../structure/marketStructure";
import { ORDER_BLOCKS_MODULE } from "../structure/orderBlocks";
import { FVG_MODULE } from "../structure/fvg";
import { PREMIUM_DISCOUNT_MODULE } from "../structure/premiumDiscount";
import { LIQUIDITY_MODULE } from "../structure/liquidity";
import { SFP_MODULE } from "../structure/sfp";
import { SMART_SR_MODULE } from "../structure/smartSR";
import { MONEY_FLOW_PROFILE_MODULE } from "../structure/moneyFlowProfile";
import { AUTO_PATTERNS_MODULE } from "../structure/autoPatterns";

export const STRUCTURE_SUITE: SuiteDef = {
  ...STRUCTURE_SUITE_META,
  modules: [
    MARKET_STRUCTURE_MODULE,
    ORDER_BLOCKS_MODULE,
    FVG_MODULE,
    PREMIUM_DISCOUNT_MODULE,
    LIQUIDITY_MODULE,
    SFP_MODULE,
    SMART_SR_MODULE,
    MONEY_FLOW_PROFILE_MODULE,
    AUTO_PATTERNS_MODULE,
  ],
};

export default STRUCTURE_SUITE;
