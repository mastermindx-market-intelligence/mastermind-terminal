import { describe, expect, it } from "vitest";
import {
  OPTIONS_CATEGORY_KEYS,
  OPTIONS_HUB_WORKSPACE_VIEWS,
  OPTIONS_IA_BY_CATEGORY,
  OPTIONS_IA_CATEGORIES,
  OPTIONS_IA_VIEW_BY_KEY,
  optionsCategoryForView,
} from "@/lib/optionsIa";

describe("Options categorized IA", () => {
  it("keeps the declared category order exact", () => {
    expect(OPTIONS_IA_CATEGORIES.map((category) => category.key)).toEqual([
      "command",
      "flow",
      "exposure",
      "structure",
      "volatility",
      "statistics",
      "plan",
      "prophet",
    ]);
    expect(OPTIONS_CATEGORY_KEYS).toHaveLength(8);
  });

  it("places every existing Options workspace pane exactly once", () => {
    expect(OPTIONS_HUB_WORKSPACE_VIEWS).toHaveLength(15);
    expect(new Set(OPTIONS_HUB_WORKSPACE_VIEWS).size).toBe(15);
    expect([...OPTIONS_HUB_WORKSPACE_VIEWS].sort()).toEqual([
      "desk",
      "gex",
      "largest",
      "levels",
      "payoff",
      "positioning",
      "prophet",
      "screener",
      "structure",
      "surface",
      "tape",
      "tickers",
      "tide",
      "volatility",
      "zero_dte",
    ]);
  });

  it("gives each category a deterministic home without inventing Statistics data", () => {
    for (const category of OPTIONS_IA_CATEGORIES) {
      if (category.key === "statistics") {
        expect(category.views).toEqual([]);
        expect(category.defaultView).toBe("statistics");
        continue;
      }
      expect(category.views.some((view) => view.key === category.defaultView)).toBe(true);
    }

    expect(OPTIONS_IA_BY_CATEGORY.flow.defaultView).toBe("tape");
    expect(OPTIONS_IA_BY_CATEGORY.plan.defaultView).toBe("payoff");
    expect(OPTIONS_IA_VIEW_BY_KEY.zero_dte.pageKey).toBe("0dte");
    expect(OPTIONS_IA_VIEW_BY_KEY.largest.pageKey).toBe("largest");
    expect(OPTIONS_IA_VIEW_BY_KEY.screener.pageKey).toBe("vol");
    expect(optionsCategoryForView("zero_dte")).toBe("flow");
    expect(optionsCategoryForView("largest")).toBe("flow");
    expect(optionsCategoryForView("surface")).toBe("flow");
    expect(optionsCategoryForView("positioning")).toBe("exposure");
    expect(optionsCategoryForView("statistics")).toBe("statistics");
    expect(OPTIONS_IA_VIEW_BY_KEY.payoff.pageKey).toBe("payoff");
    expect(optionsCategoryForView("payoff")).toBe("plan");
  });
});
