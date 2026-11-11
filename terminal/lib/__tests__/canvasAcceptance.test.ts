import { test } from "vitest";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";

const sourceUrl = new URL("../../e2e/tools/canvas-acceptance.mjs", import.meta.url);
const source = readFileSync(sourceUrl, "utf8");
const imports = [
  'import { chromium } from "playwright";',
  'import { createHash } from "node:crypto";',
];
assert.deepEqual(source.match(/^import .*;$/gm), imports);
// Execute the real CLI body, including its sampling, hashing, guards and JSON.
// Only its two imports are supplied by the offline adapter; never load Playwright.
const body = imports.reduce((text, declaration) => text.replace(declaration, ""), source);
const script = new Script(`(async function () {\n"use strict";\n${body}\n})()`, {
  filename: sourceUrl.pathname,
});

type Region = "candleAxis" | "candleBody" | "studyAxis" | "studyBody";
type Rect = { x: number; y: number; width: number; height: number };
type PaneFailure = "price" | "study" | "unknown";
type Scenario = {
  name: string;
  candles: number[];
  studies: number[];
  paired?: number;
  verdict: "COHERENT" | "INCONCLUSIVE" | "SPLIT GENERATION";
  note?: string;
  axes?: number[];
  windowMs?: number;
  local?: boolean;
  noIdentity?: boolean;
  paneFailure?: PaneFailure;
};
type Receipt = {
  verdict: string;
  candleBodyMoves?: number;
  studyBodyMoves?: number;
  pairedMoves?: number;
  pairedRatio?: number;
  candleBodyAt?: number[];
  studyBodyAt?: number[];
  samples?: number;
};
type ResponseDouble = {
  request: () => { resourceType: () => string };
  text: () => Promise<string>;
};

async function observe(scenario: Scenario): Promise<{ receipt: Receipt; start: number }> {
  const regions: Record<Region, Rect> = {
    candleAxis: { x: 700, y: 0, width: 60, height: 400 },
    candleBody: { x: 0, y: 0, width: 700, height: 400 },
    studyAxis: { x: 700, y: 400, width: 60, height: 120 },
    studyBody: { x: 0, y: 400, width: 700, height: 120 },
  };
  const observations: Record<Region, number[]> = {
    candleAxis: scenario.axes ?? scenario.candles,
    candleBody: scenario.candles,
    studyAxis: scenario.axes ?? scenario.studies,
    studyBody: scenario.studies,
  };
  const windowMs = scenario.windowMs ?? Math.max(0, ...Object.values(observations).flat()) + 400;
  assert.ok(windowMs > 0 && windowMs % 400 === 0);
  for (const times of Object.values(observations)) {
    assert.ok(times.every((time) => time > 0 && time % 400 === 0));
  }
  const base = scenario.local ? "http://localhost:3000" : "https://canvas-fixture.example.test";
  const output: Receipt[] = [];
  const exitSignal = new Error("intercepted fixture process.exit(0)");
  let now = 0;
  let start: number | undefined;
  let waitCalls = 0;
  let launchCalls = 0;
  let gotoCalls = 0;
  let closeCalls = 0;
  let exited = false;
  let responseHandler: ((response: ResponseDouble) => Promise<void>) | undefined;

  const page = {
    on(event: string, handler: (response: ResponseDouble) => Promise<void>) {
      assert.equal(event, "response");
      assert.equal(responseHandler, undefined);
      responseHandler = handler;
    },
    async goto(url: string) {
      gotoCalls++;
      assert.equal(url, `${base}/terminal?symbol=FIXTURE-USD&cb=0`);
      assert.ok(responseHandler);
      await responseHandler({
        request: () => ({ resourceType: () => "document" }),
        text: async () => scenario.noIdentity ? "<html></html>" : '<html data-dpl-id="fixture-sha"></html>',
      });
    },
    async waitForSelector(selector: string) {
      assert.equal(selector, ".chart-wrap canvas");
    },
    async waitForTimeout(milliseconds: number) {
      assert.ok(Number.isFinite(milliseconds) && milliseconds > 0);
      assert.ok(++waitCalls < 512, "sampling must terminate within the fixture window");
      now += milliseconds;
    },
    mouse: { async move(x: number, y: number) { assert.deepEqual([x, y], [5, 5]); } },
    async evaluate() {
      // Geometry is declared input, not a claim that real DOM discovery was exercised.
      return {
        tf: "fixture timeframe", panes: 2,
        ...regions,
        candleBody: scenario.paneFailure === "price" ? null : regions.candleBody,
        studyBody: scenario.paneFailure === "study" ? null : regions.studyBody,
        studyName: scenario.paneFailure === "unknown" ? "Unverified widget" : "RSI",
      };
    },
    async screenshot({ clip }: { clip: Rect }) {
      start ??= now;
      const region = (Object.keys(regions) as Region[]).find((key) => regions[key] === clip);
      assert.ok(region, "only declared pane rectangles may be sampled");
      const moves = observations[region].filter((time) => time <= now - start!).length;
      // Real createHash receives changing bytes; do not inject fabricated scores.
      return Buffer.from(`${region}:observed-pixel-state:${moves}`);
    },
  };
  const browser = {
    async newContext(options: { viewport: { width: number; height: number } }) {
      assert.equal(options.viewport.width, 1440);
      assert.equal(options.viewport.height, 900);
      return { async newPage() { return page; } };
    },
    async close() { closeCalls++; },
  };
  try {
    await script.runInNewContext({
      chromium: { async launch(options: { headless: boolean }) {
        launchCalls++;
        assert.equal(options.headless, true);
        return browser;
      } },
      createHash,
      Date: { now: () => now },
      process: {
        argv: ["node", "canvas-acceptance.mjs", "FIXTURE-USD", String(windowMs / 1000), base],
        exit(code: number) {
          assert.equal(code, 0);
          exited = true;
          throw exitSignal;
        },
      },
      console: { log(line: string) { output.push(JSON.parse(line) as Receipt); } },
    }, { timeout: 1_000 });
  } catch (error) {
    if (error !== exitSignal) throw error;
  }
  assert.equal(launchCalls, 1);
  assert.equal(gotoCalls, 1);
  assert.equal(closeCalls, 1);
  assert.equal(exited, scenario.paneFailure !== undefined);
  assert.equal(output.length, 1, "the actual CLI must emit exactly one receipt");
  assert.equal(typeof output[0].verdict, "string");
  return { receipt: output[0], start: start ?? now };
}

const times = (count: number) => Array.from({ length: count }, (_, i) => (i + 1) * 400);
const six = times(6);
const spaced = [2_400, 8_400, 14_400, 20_400, 26_400, 32_400];
const scenarios: Scenario[] = [
  { name: "one study cannot validate six candle observations", candles: six, studies: [1_600], paired: 1, verdict: "INCONCLUSIVE" },
  { name: "six distinct pairs remain coherent", candles: six, studies: six, paired: 6, verdict: "COHERENT" },
  { name: "earliest feasible matches preserve later opportunities", candles: [1_600, 3_200, 8_000, 12_000, 16_000, 20_000], studies: [400, 1_600, 8_000, 12_000, 16_000, 20_000], paired: 6, verdict: "COHERENT" },
  { name: "the lower timing endpoint is inclusive", candles: spaced, studies: spaced.map((t) => t - 1_600), paired: 6, verdict: "COHERENT" },
  { name: "the upper timing endpoint is inclusive", candles: spaced, studies: spaced.map((t) => t + 1_600), paired: 6, verdict: "COHERENT" },
  { name: "nonzero observations outside the window are inconclusive", candles: spaced, studies: spaced.map((t) => t + 2_000), paired: 0, verdict: "INCONCLUSIVE" },
  { name: "five of six distinct pairs still meet the unchanged threshold", candles: six, studies: times(5), paired: 5, verdict: "COHERENT" },
  { name: "eight of ten pairs meet the exact threshold", candles: times(10), studies: times(8), paired: 8, verdict: "COHERENT" },
  { name: "four of six distinct pairs are insufficient", candles: six, studies: times(4), paired: 4, verdict: "INCONCLUSIVE" },
  { name: "nineteen candles and three studies remain low sensitivity", candles: times(19), studies: [800, 3_600, 6_800], paired: 3, verdict: "INCONCLUSIVE" },
  { name: "zero study movement retains the split signature", candles: six, studies: [], paired: 0, verdict: "SPLIT GENERATION" },
  { name: "axis motion cannot satisfy the candle sensitivity minimum", candles: times(5), studies: times(5), axes: times(30), paired: 5, verdict: "INCONCLUSIVE", note: "only 5 candle-body moves" },
  { name: "a deployed target still requires served identity", candles: six, studies: six, noIdentity: true, paired: 6, verdict: "INCONCLUSIVE", note: "could not identify the served build" },
  { name: "the existing local identity exception remains", candles: six, studies: six, noIdentity: true, local: true, paired: 6, verdict: "COHERENT" },
  { name: "sampling continues beyond twenty-four movements", candles: times(30), studies: times(30), windowMs: 12_000, paired: 30, verdict: "COHERENT" },
  { name: "a missing price pane fails closed", candles: six, studies: six, paneFailure: "price", verdict: "INCONCLUSIVE", note: "could not locate the price pane" },
  { name: "a missing study pane fails closed", candles: six, studies: six, paneFailure: "study", verdict: "INCONCLUSIVE", note: "no study pane" },
  { name: "an unknown study is not an acceptance witness", candles: six, studies: six, paneFailure: "unknown", verdict: "INCONCLUSIVE", note: "not a known bar-derived study" },
];

for (const scenario of scenarios) {
  test(`canvas acceptance: ${scenario.name}`, async () => {
    const { receipt } = await observe(scenario);
    assert.ok(receipt.verdict.startsWith(scenario.verdict), receipt.verdict);
    if (scenario.note) assert.ok(receipt.verdict.includes(scenario.note), receipt.verdict);
    if (scenario.paired !== undefined) {
      assert.equal(receipt.candleBodyMoves, scenario.candles.length);
      assert.equal(receipt.studyBodyMoves, scenario.studies.length);
      assert.equal(receipt.pairedMoves, scenario.paired);
      assert.equal(receipt.pairedRatio, Number((scenario.paired / scenario.candles.length).toFixed(3)));
    }
    if (scenario.windowMs) assert.equal(receipt.samples, scenario.windowMs / 400);
  });
}

test("canvas acceptance: emitted timestamps preserve the sampled observations", async () => {
  const scenario = scenarios[0];
  const { receipt, start } = await observe(scenario);
  assert.deepEqual(receipt.candleBodyAt, scenario.candles.map((time) => start + time));
  assert.deepEqual(receipt.studyBodyAt, scenario.studies.map((time) => start + time));
  assert.equal(receipt.candleBodyAt!.length, receipt.candleBodyMoves);
  assert.equal(receipt.studyBodyAt!.length, receipt.studyBodyMoves);
});
