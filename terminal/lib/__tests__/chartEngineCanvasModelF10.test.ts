// F-10: PriceScaleState is one type (model re-exports scales) and
// PriceScaleMode is EnginePriceScaleMode. tsc --noEmit goes red if they diverge.
import { describe, expect, it } from "vitest";

import type { PriceScaleState as ModelPriceScaleState } from "@/lib/chart-engine/canvas/model";
import type { PriceScaleMode, PriceScaleState as ScalesPriceScaleState } from "@/lib/chart-engine/canvas/scales";
import type { EnginePriceScaleMode } from "@/lib/chart-engine/options";

describe("F-10 unified PriceScaleState / PriceScaleMode", () => {
  it("assigns PriceScaleState both directions and PriceScaleMode = EnginePriceScaleMode", () => {
    const scalesState: ScalesPriceScaleState = {
      mode: "normal",
      inverted: false,
      from: 0,
      to: 1,
      heightPx: 100,
      margins: { top: 0.2, bottom: 0.1 },
    };
    const s: ModelPriceScaleState = scalesState;
    const t: ScalesPriceScaleState = s;
    expect(t).toBe(scalesState);

    const mode: PriceScaleMode = "indexed100";
    const engineMode: EnginePriceScaleMode = mode;
    const back: PriceScaleMode = engineMode;
    expect(back).toBe("indexed100");
  });
});
