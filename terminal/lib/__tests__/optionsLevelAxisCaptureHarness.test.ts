import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const captureSource = readFileSync(
  join(__dirname, "../../docs/pr-crops/options-level-axis-labels/capture.mjs"),
  "utf8",
);

describe("Options-level browser capture harness", () => {
  it("marks the one-time candle rollout complete before seeding its exact indicator set", () => {
    const marker = 'localStorage.setItem("mm.mastermindCandles.v1", "1")';
    const indicators = 'localStorage.setItem("mm.inds", JSON.stringify(["optlevels"]))';
    const markerAt = captureSource.indexOf(marker);
    const indicatorsAt = captureSource.indexOf(indicators);

    expect(markerAt, "capture must opt out of the product rollout that would replace optlevels").toBeGreaterThanOrEqual(0);
    expect(indicatorsAt, "capture must seed the options-level study").toBeGreaterThanOrEqual(0);
    expect(markerAt, "migration marker must exist before Terminal reads the seeded study set").toBeLessThan(indicatorsAt);
  });
});
