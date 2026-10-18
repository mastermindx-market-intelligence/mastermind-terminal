import { describe, expect, it } from "vitest";
import {
  MODULE_CATALOG,
  MODULE_CATEGORIES,
  enabledModulesForSuite,
  enabledSuiteModules,
  getSuiteModuleCatalogEntry,
  hasEnabledSuiteModules,
  isSuiteModuleEnabled,
  isSuiteModuleId,
  parseSuiteModuleId,
  resolveModuleCatalogEntry,
  setSuiteModuleEnabledParams,
  setSuiteSurfaceEnabledParams,
  suiteModuleCatalogFor,
  suiteModuleId,
  suitePresetParams,
} from "../suites/catalog";
import { SUITE_DEFS, SUITE_ORDER, suiteDefaults } from "../suites/registry";

describe("suite module catalog", () => {
  it("flattens all 32 modules once, in canonical suite/module order", () => {
    expect(MODULE_CATALOG).toHaveLength(32);
    expect(new Set(MODULE_CATALOG.map((entry) => entry.id)).size).toBe(32);
    expect(MODULE_CATEGORIES.map((category) => category.id)).toEqual([...SUITE_ORDER]);
    expect(MODULE_CATEGORIES.map((category) => suiteModuleCatalogFor(category.id).length)).toEqual([9, 6, 6, 5, 6]);

    const expected = SUITE_ORDER.flatMap((suiteKey) =>
      SUITE_DEFS[suiteKey].modules.map((module) => `suite:${suiteKey}/${module.key}`),
    );
    expect(MODULE_CATALOG.map((entry) => entry.id)).toEqual(expected);
  });

  it("ships complete picker metadata and preserves the canonical runtime definition", () => {
    for (const entry of MODULE_CATALOG) {
      expect(entry.category).toBe(entry.suiteKey);
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(10);
      expect(entry.descriptionZh.length).toBeGreaterThan(3);
      expect(entry.aliases.length).toBeGreaterThan(0);
      expect(entry.searchText).toContain(entry.label.toLowerCase());
      expect(entry.module).toBe(
        SUITE_DEFS[entry.suiteKey].modules.find((module) => module.key === entry.moduleKey),
      );
    }
  });

  it("keeps repeated short keys collision-safe", () => {
    expect(getSuiteModuleCatalogEntry("suite:pulse/div")?.label).toBe("Divergences");
    expect(getSuiteModuleCatalogEntry("suite:rsix/div")?.label).toBe("RSI Divergence");
    expect(getSuiteModuleCatalogEntry("suite:macdx/div")?.label).toBe("MACD Divergence");
    expect(getSuiteModuleCatalogEntry("div")).toBeNull();
    expect(getSuiteModuleCatalogEntry("pulse", "div")?.id).toBe("suite:pulse/div");
    expect(resolveModuleCatalogEntry("macdx", "mtf")?.id).toBe("suite:macdx/mtf");
  });

  it("identifies shared calculation sources without making them enablement dependencies", () => {
    expect(getSuiteModuleCatalogEntry("suite:pulse/sig")?.source).toBe("suite:pulse/wave");
    expect(getSuiteModuleCatalogEntry("suite:rsix/chan")?.source).toBe("suite:rsix/eng");
    expect(getSuiteModuleCatalogEntry("suite:macdx/hist")?.source).toBe("suite:macdx/eng");
    expect(getSuiteModuleCatalogEntry("suite:structure/fvg")?.source).toBeUndefined();

    const active = new Set(["pulse"]);
    const params = { pulse: { ...suiteDefaults("pulse"), "wave.on": false, "sig.on": true } };
    expect(isSuiteModuleEnabled("suite:pulse/sig", active, params)).toBe(true);
  });

  it("constructs, parses, and validates qualified ids without accepting lookalikes", () => {
    expect(suiteModuleId("structure", "ms")).toBe("suite:structure/ms");
    expect(parseSuiteModuleId("suite:structure/ms")).toEqual({
      id: "suite:structure/ms",
      suiteKey: "structure",
      moduleKey: "ms",
    });
    expect(isSuiteModuleId("suite:trend/te")).toBe(true);

    for (const invalid of [
      "structure/ms",
      "suite:structure",
      "suite:/ms",
      "suite:structure/",
      "suite:structure/div",
      "suite:nope/ms",
      "suite:RSIX/div",
      "suite:rsix/div/extra",
    ]) {
      expect(parseSuiteModuleId(invalid), invalid).toBeNull();
      expect(isSuiteModuleId(invalid), invalid).toBe(false);
    }
  });
});

describe("suite module enablement helpers", () => {
  it("requires both the parent suite and the effective module toggle", () => {
    const params = { structure: { ...suiteDefaults("structure"), "ms.on": true, "ob.on": false } };
    expect(isSuiteModuleEnabled("suite:structure/ms", [], params)).toBe(false);
    expect(isSuiteModuleEnabled("suite:structure/ms", new Set(["structure"]), params)).toBe(true);
    expect(isSuiteModuleEnabled("suite:structure/ob", new Set(["structure"]), params)).toBe(false);
    expect(isSuiteModuleEnabled("not-a-module", new Set(["structure"]), params)).toBe(false);
  });

  it("falls back to module defaults when a suite has no saved params", () => {
    const active = new Set(["trend"]);
    expect(isSuiteModuleEnabled("suite:trend/te", active, {})).toBe(true);
    expect(isSuiteModuleEnabled("suite:trend/fb", active, {})).toBe(false);
  });

  it("lists and detects enabled modules in canonical order", () => {
    const active = new Set(["structure", "pulse"]);
    const params = {
      structure: { ...suiteDefaults("structure"), "fvg.on": false, "pd.on": true },
      pulse: { ...suiteDefaults("pulse"), "div.on": false, "flow.on": true },
    };
    expect(enabledModulesForSuite("structure", active, params).map((entry) => entry.moduleKey)).toEqual([
      "ms",
      "ob",
      "pd",
    ]);
    expect(enabledSuiteModules(active, params).map((entry) => entry.id)).toEqual([
      "suite:structure/ms",
      "suite:structure/ob",
      "suite:structure/pd",
      "suite:pulse/wave",
      "suite:pulse/sig",
      "suite:pulse/flow",
    ]);
    expect(hasEnabledSuiteModules(active, params, "pulse")).toBe(true);
    expect(hasEnabledSuiteModules(active, params, "rsix")).toBe(false);
    expect(hasEnabledSuiteModules([], params)).toBe(false);
  });

  it("enables only the selected module when activating an inactive parent", () => {
    const before = {
      ...suiteDefaults("structure"),
      "ms.on": true,
      "ob.on": true,
      "ob.showLast": 11,
      "fvg.thresholdATR": 0.72,
      futureField: "preserve-me",
    };
    const snapshot = { ...before };
    const next = setSuiteModuleEnabledParams("suite:structure/fvg", before, true, false);

    expect(before).toEqual(snapshot);
    for (const moduleDef of SUITE_DEFS.structure.modules) {
      expect(next[`${moduleDef.key}.on`], moduleDef.key).toBe(moduleDef.key === "fvg");
    }
    expect(next["ob.showLast"]).toBe(11);
    expect(next["fvg.thresholdATR"]).toBe(0.72);
    expect(next.futureField).toBe("preserve-me");
  });

  it("preserves sibling selection when the parent is already active", () => {
    const before = { ...suiteDefaults("trend"), "te.on": true, "cp.on": true, "fb.on": false };
    const next = setSuiteModuleEnabledParams("suite:trend/fb", before, true, true);
    expect(next["te.on"]).toBe(true);
    expect(next["cp.on"]).toBe(true);
    expect(next["fb.on"]).toBe(true);

    const removed = setSuiteModuleEnabledParams("suite:trend/te", next, false, true);
    expect(removed["te.on"]).toBe(false);
    expect(removed["cp.on"]).toBe(true);
    expect(removed["fb.on"]).toBe(true);
  });

  it("removes a shared oscillator pane without removing its dashboard module", () => {
    const before = { ...suiteDefaults("pulse"), "mtf.on": true };
    const next = setSuiteSurfaceEnabledParams("pulse", "pane", before, false);
    for (const entry of suiteModuleCatalogFor("pulse")) {
      expect(next[`${entry.moduleKey}.on`], entry.moduleKey)
        .toBe(entry.surface === "dashboard");
    }
  });

  it("reapplies suite preset toggles while preserving customized fields", () => {
    const custom = {
      ...suiteDefaults("macdx"),
      "eng.on": false,
      "trend.on": true,
      "eng.fast": 7,
      "trend.showLast": 23,
    };
    const next = suitePresetParams("macdx", custom);
    for (const moduleDef of SUITE_DEFS.macdx.modules) {
      expect(next[`${moduleDef.key}.on`], moduleDef.key).toBe(moduleDef.defaultOn);
    }
    expect(next["eng.fast"]).toBe(7);
    expect(next["trend.showLast"]).toBe(23);
    expect(suitePresetParams("not-a-suite", { keep: 1 })).toEqual({ keep: 1 });
  });
});
