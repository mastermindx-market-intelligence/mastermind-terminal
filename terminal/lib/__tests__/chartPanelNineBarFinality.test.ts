import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { suiteFormingBarIndex, suiteSessionIdentity } from "../suiteChartContext";

describe("native-suite chart context", () => {
  it("marks only an accepted live tail as forming", () => {
    expect(suiteFormingBarIndex({ barCount: 13, replayActive: false, acceptedLiveTick: true })).toBe(12);
    expect(suiteFormingBarIndex({ barCount: 13, replayActive: false, acceptedLiveTick: false })).toBeNull();
    expect(suiteFormingBarIndex({ barCount: 13, replayActive: true, acceptedLiveTick: true })).toBeNull();
    expect(suiteFormingBarIndex({ barCount: 0, replayActive: false, acceptedLiveTick: true })).toBeNull();
  });

  it("keeps market/session configuration in event identity", () => {
    expect(suiteSessionIdentity("crypto", false)).toBe("crypto-24h");
    expect(suiteSessionIdentity("us", false)).toBe("us-regular");
    expect(suiteSessionIdentity("us", true)).toBe("us-extended");
    expect(suiteSessionIdentity("hk", true)).toBe("hk-extended");
    expect(suiteSessionIdentity("us", true, false)).toBe("daily");
  });

  it("routes every ChartPanel suite computation through one finality-aware input helper", () => {
    const source = readFileSync(path.resolve(__dirname, "../../components/ChartPanel.tsx"), "utf8");
    const calls = source.match(/computeSuite\(def, suiteRenderParams\(k\), suiteHostInput\(/g) ?? [];
    expect(calls).toHaveLength(4);
    expect(source).toContain("acceptedLiveTick: liveTickRef.current !== null");
    expect(source).toContain("replayActive: replayIdxRef.current !== null");
    expect(source).not.toMatch(/computeSuite\(def, suiteRenderParams\(k\),\s*\{/);
  });
});
