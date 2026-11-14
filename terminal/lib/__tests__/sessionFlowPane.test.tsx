// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionFlowPane } from "@/components/surface/SessionFlowPane";
import { publishWorkspaceReplay, releaseWorkspaceReplay } from "@/components/surface/replayBus";

const observed = vi.hoisted(() => ({
  charts: [] as Array<{
    format: (value: number) => string;
    series: Array<{ title: string; values: number[] }>;
    removed: boolean;
  }>,
}));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: "en" }) }));
// Keep the real pane, transforms and workspace replay bus. Capture the actual
// canvas consumer boundary so presentation assertions also protect signed data.
vi.mock("lightweight-charts", async original => {
  const actual = await original<typeof import("lightweight-charts")>();
  return { ...actual, createChart: (_host: HTMLElement, options: {
    localization: { priceFormatter: (value: number) => string };
  }) => {
    const record = { format: options.localization.priceFormatter, series: [] as Array<{ title: string; values: number[] }>, removed: false };
    observed.charts.push(record);
    return {
      addSeries: (_type: unknown, settings: { title: string }) => {
        const series = { title: settings.title, values: [] as number[] };
        record.series.push(series);
        return { setData: (rows: Array<{ value: number }>) => { series.values = rows.map(row => row.value); } };
      },
      timeScale: () => ({ fitContent() {} }),
      applyOptions() {},
      remove() { record.removed = true; },
    };
  } };
});

const MINUTES = [
  { t: "09:30", ncp: 100, npp: -50 },
  { t: "09:31", ncp: 250, npp: -120 },
  { t: "09:32", ncp: 400, npp: -90 },
];
const OWNER = Symbol("session-flow-presentation-test");
const LIVE = { asOfStamp: "0932", atHead: true, live: true, archived: false, sessionDate: "2026-09-17" };
const ARCHIVE = { asOfStamp: "0932", atHead: true, live: false, archived: true, sessionDate: "2026-09-16" };
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  observed.charts.length = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => { root.unmount(); releaseWorkspaceReplay(OWNER); });
  host.remove();
  vi.unstubAllGlobals();
});
const chart = () => observed.charts.at(-1)!;
const values = () => chart().series.map(series => series.values);
const totals = () => [...host.querySelectorAll(".obs-tag b")].map(node => node.textContent);
async function render(minutes = MINUTES) {
  await act(async () => root.render(<SessionFlowPane minutes={minutes} sessionDate="2026-09-17" />));
}
async function click(label: string) {
  const button = [...host.querySelectorAll("button")].find(node => node.textContent === label);
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
async function publish(state: typeof LIVE) {
  await act(async () => publishWorkspaceReplay(OWNER, state));
}

describe("Session Flow signed presentation", () => {
  it("passes signed currency formatting to the chart and preserves signed numbers and raw totals", async () => {
    await render();
    for (const [value, expected] of [
      [-100, "−$100"], [100, "$100"],
      [-120_000, "−$120K"], [120_000, "$120K"],
      [-1_500_000, "−$1.5M"], [1_500_000, "$1.5M"],
      [-2_300_000_000, "−$2.3B"], [2_300_000_000, "$2.3B"],
      [0, "$0"], [-0, "$0"], [-0.1, "$0"], [-0.5, "−$1"],
    ] as const) expect(chart().format(value)).toBe(expected);
    expect(values()).toEqual([[100, 250, 400], [-50, -120, -90]]);
    expect(totals()).toEqual(["$400", "−$90"]);
    // Side names do not determine the sign: a negative call observation stays negative.
    await render(MINUTES.map(point => ({ ...point, ncp: -point.ncp })));
    expect(values()[0]).toEqual([-100, -250, -400]);
    expect(totals()).toEqual(["−$400", "−$90"]);
  });

  it("changes only the plotted transformation when per-minute, off-open or Absolute is selected", async () => {
    await render();
    await click("per-min");
    expect(values()).toEqual([[100, 150, 150], [-50, -70, 30]]);
    expect(totals()).toEqual(["$400", "−$90"]);
    await click("off open");
    expect(values()).toEqual([[0, 50, 50], [0, -20, 80]]);
    await click("absolute");
    expect(values()).toEqual([[0, 50, 50], [0, 20, 80]]);
    expect(totals()).toEqual(["$400", "−$90"]);
    await click("absolute");
    expect(values()).toEqual([[0, 50, 50], [0, -20, 80]]);
    expect(totals()).toEqual(["$400", "−$90"]);
  });

  it("cuts both chart data and signed raw totals before the replayed minute, then restores the live head", async () => {
    await render();
    await publish({ ...LIVE, asOfStamp: "0931", atHead: false, live: false });
    expect(values()).toEqual([[100, 250], [-50, -120]]);
    expect(totals()).toEqual(["$250", "−$120"]);
    expect(host.textContent).toContain("truncated to the replay time 09:31");
    await publish(LIVE);
    expect(values()).toEqual([[100, 250, 400], [-50, -120, -90]]);
    expect(totals()).toEqual(["$400", "−$90"]);
  });

  it("withdraws the live chart on archive and recreates it on return with the same minute array", async () => {
    await render();
    const liveChart = chart();
    await publish(ARCHIVE);
    expect(host.textContent).toContain("Session flow is live-session only");
    expect(totals()).toEqual([]);
    expect.soft(liveChart.removed, "archival withdrawal must clean up the chart attached to the removed wrapper").toBe(true);
    const count = observed.charts.length;
    await publish(LIVE);
    expect(observed.charts).toHaveLength(count + 1);
    expect(chart().removed).toBe(false);
    expect(values()).toEqual([[100, 250, 400], [-50, -120, -90]]);
    expect(totals()).toEqual(["$400", "−$90"]);
  });

  it("creates the chart after an initially archived pane returns to live without a feed refresh", async () => {
    await publish(ARCHIVE);
    await render();
    expect(observed.charts).toHaveLength(0);
    expect(host.textContent).toContain("Session flow is live-session only");
    await publish(LIVE);
    expect(observed.charts).toHaveLength(1);
    expect(values()).toEqual([[100, 250, 400], [-50, -120, -90]]);
  });
});
