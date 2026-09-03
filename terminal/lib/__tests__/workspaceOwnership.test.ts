// ── Anti-duplication law (contract §2, carried forward verbatim from `layoutConfig.ts`) ────────
// A workspace never owns timeframe favourites, drawings, drawing prefs, watchlist state, Day Trade
// Mode, alerts, or symbol-owned live data. These proofs feed a HOSTILE capture input that carries
// every one of those keys (simulating a buggy/malicious caller) and assert none of them can reach a
// persisted envelope through either the runtime-capture path or the legacy-migration path.
import { describe, expect, it } from "vitest";
import type { LayoutWorkspace } from "../layoutConfig";
import { captureWorkspace, migrateLegacy } from "../workspaceMigrate";
import { CHART_CONFIG_FIELDS } from "../workspaceLayout";

const FORBIDDEN_KEYS = [
  "drawings", "drawingPrefs", "drawingStyle", "watchlist", "watchlists",
  "favTF", "dtm", "dtmSnapshot", "dayTradeMode", "alerts", "alert",
];

/** A hostile `LayoutWorkspace`: every legitimate field PLUS every forbidden key, so a leak would be
 *  unambiguous (the forbidden values are distinctive strings, not plausible chart data). */
function hostileLayout(): LayoutWorkspace {
  const base: LayoutWorkspace = {
    panes: ["AAPL"], paneTfs: ["1D"], split: 1, activePane: 0, sync: true,
    chartType: "candles", inds: [], indParams: {}, hidden: [], compare: [], compareCfg: {},
    lockedVLine: null,
  };
  const hostile = { ...base } as unknown as Record<string, unknown>;
  for (const key of FORBIDDEN_KEYS) hostile[key] = `LEAKED-${key}`;
  return hostile as unknown as LayoutWorkspace;
}

function assertNoForbiddenLeak(value: unknown): void {
  const json = JSON.stringify(value);
  for (const key of FORBIDDEN_KEYS) {
    expect(json.includes(`LEAKED-${key}`), `forbidden key ${key} leaked into: ${json}`).toBe(false);
  }
}

describe("captureWorkspace — never persists an anti-duplication-forbidden key", () => {
  it("a hostile runtime layout produces a chart config containing ONLY the 12 frozen fields", () => {
    const { envelope } = captureWorkspace({ layout: hostileLayout(), brainIncluded: true });
    const chart = envelope.widgets.find((w) => w.type === "chart") as { config: Record<string, unknown> };
    for (const key of Object.keys(chart.config)) {
      expect((CHART_CONFIG_FIELDS as readonly string[])).toContain(key);
    }
    assertNoForbiddenLeak(envelope);
  });

  it("a hostile layout leaves no forbidden value anywhere in the serialized envelope, brain widget included", () => {
    const { envelope } = captureWorkspace({ layout: hostileLayout(), brainIncluded: true });
    assertNoForbiddenLeak(envelope);
    const brain = envelope.widgets.find((w) => w.type === "brain") as { config: Record<string, unknown> };
    expect(brain.config).toEqual({});
  });
});

describe("migrateLegacy — never claims a forbidden legacy key", () => {
  it("a v2 legacy config carrying every forbidden key migrates without leaking any of them", () => {
    const hostileLegacyConfig: Record<string, unknown> = {
      schemaVersion: 2,
      panes: ["AAPL"], paneTfs: ["1D"], split: 1, activePane: 0, sync: true,
      chartType: "candles", inds: [], indParams: {}, hidden: [], compare: [], compareCfg: {},
      lockedVLine: null,
    };
    for (const key of FORBIDDEN_KEYS) hostileLegacyConfig[key] = `LEAKED-${key}`;

    const result = migrateLegacy(hostileLegacyConfig);
    expect(result.ok).toBe(true);
    assertNoForbiddenLeak(result);
  });

  it("a v0 legacy config carrying every forbidden key migrates without leaking any of them", () => {
    const hostileLegacyConfig: Record<string, unknown> = { active: "MSFT", tf: "1D" };
    for (const key of FORBIDDEN_KEYS) hostileLegacyConfig[key] = `LEAKED-${key}`;

    const result = migrateLegacy(hostileLegacyConfig);
    expect(result.ok).toBe(true);
    assertNoForbiddenLeak(result);
  });
});
