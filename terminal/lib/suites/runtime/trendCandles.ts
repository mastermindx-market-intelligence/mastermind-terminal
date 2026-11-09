// The default free candle style does not import paid Trend Engine, Flow Band or dashboards.
// Runtime identity and the painter are canonical; activating another module selects the full suite.
import type { SuiteDef } from "@/lib/indicator-canvas/types";
import { TREND_SUITE_META } from "../meta";
import { CANDLE_PAINTER_MODULE } from "../trend/candlePainter";
const TREND_CANDLES: SuiteDef = { ...TREND_SUITE_META, modules: [CANDLE_PAINTER_MODULE] };
export default TREND_CANDLES;
