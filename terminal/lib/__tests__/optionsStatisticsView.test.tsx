// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({
  lang: "en" as "en" | "zh",
  flowGet: vi.fn(),
  trackSearch: vi.fn(),
}));
vi.mock("@/lib/flowClientCache", () => ({ flowGet: H.flowGet }));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: H.lang, setLang: () => undefined }) }));
vi.mock("@/lib/searchTrack", () => ({ trackSearch: H.trackSearch }));

import { OptionsStatisticsView } from "@/components/statistics/OptionsStatisticsView";

let host: HTMLDivElement;
let root: Root;

const moves = (root = "SPY") => ({
  schema: "options_hub.moves/v1",
  asof: "2026-10-01",
  root,
  spot_ref: 100,
  atm_iv: 20,
  regime: "slippery",
  expected_move: { band_mult: 1.96, horizon_days: 1, pct: 2, lo: 98, hi: 102 },
  calibration: { contained_rate: 0.96, n_sessions: 100, hits: 96, misses: 4, band_mult: 1.96, since: "2025-01-01", through: "2026-09-30", ci: [0.91, 0.98] },
  convention: "descriptive calibration",
});
const vol = (root = "SPY") => ({
  schema: "options_hub.vol/v1", asof: "2026-10-01", root,
  atm_iv: 20, iv_rank_252: 40, iv_rank_all: 55, coverage_days_all: 900,
  iv_52w_lo: 10, iv_52w_hi: 30, rv20: 18, vrp: 2,
  history: Array.from({ length: 10 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, atm_iv: 15 + i, iv_rank: null, close: null })),
});
const agg = (root = "SPY") => ({
  schema: "options_hub.aggtrend/v1", asof: "2026-09-30", root, n_days: 5,
  series: [
    { d: "2026-09-24", s: 100 }, { d: "2026-09-25", s: 101 },
    { d: "2026-09-28", s: 99 }, { d: "2026-09-29", s: 102 }, { d: "2026-09-30", s: 101 },
  ],
  stats: Object.fromEntries(["gamma", "delta", "vanna", "charm", "vega"].map((key, i) => [key, {
    mean: i, sd: 1, min: -2, p05: -1, p50: 0, p95: 2, max: 3, last: 1, pctile: 70 + i, n: 100,
  }])),
});

function installSources(delays: Record<string, number> = {}) {
  H.flowGet.mockImplementation(async (key: string) => {
    const [, root] = key.split(":");
    const wait = delays[`${key}`] ?? delays[root] ?? 0;
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    if (key.startsWith("moves:")) return moves(root);
    if (key.startsWith("vol:")) return vol(root);
    if (key.startsWith("agg:")) return agg(root);
    return null;
  });
}

beforeEach(() => {
  H.lang = "en";
  H.flowGet.mockReset();
  H.trackSearch.mockReset();
  installSources();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function mount() {
  await act(async () => { root.render(<OptionsStatisticsView />); });
  for (let i = 0; i < 30 && !host.textContent?.includes("96.0%"); i++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
}

function input(): HTMLInputElement {
  const node = host.querySelector<HTMLInputElement>('input[aria-label="Statistics root"]');
  if (!node) throw new Error("statistics root input missing");
  return node;
}

async function setInput(value: string) {
  const node = input();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) throw new Error("input setter unavailable");
  await act(async () => {
    setter.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("Options Statistics existing-source workspace", () => {
  it("reads each canonical owner once and keeps their source clocks visible", async () => {
    await mount();
    expect(H.flowGet.mock.calls.map(([key]) => key)).toEqual(["moves:SPY", "vol:SPY", "agg:SPY"]);
    expect(host.textContent).toContain("±2.00%");
    expect(host.textContent).toContain("96.0%");
    expect(host.textContent).toContain("4");
    expect(host.textContent).toContain("40.0th");
    expect(host.textContent).toContain("70.0th");
    expect(host.textContent).toContain("2026-10-01");
    expect(host.textContent).toContain("2026-09-30");
    expect(host.textContent).toContain("not a win rate");
  });

  it("renders independent source failure honestly instead of hiding the other owners", async () => {
    H.flowGet.mockImplementation(async (key: string) => {
      if (key === "moves:SPY") throw new Error("synthetic source outage");
      if (key === "vol:SPY") return vol();
      if (key === "agg:SPY") return agg();
      return null;
    });
    await mount();
    expect(host.textContent).toContain("MOVES · Unavailable");
    expect(host.textContent).toContain("Headline ATM IV");
    expect(host.textContent).toContain("Gamma");
    expect(host.textContent).not.toContain("±2.00%");
  });

  it("rejects wrong-root source bytes without discarding valid sibling sources", async () => {
    H.flowGet.mockImplementation(async (key: string) => {
      if (key === "moves:SPY") return moves("QQQ");
      if (key === "vol:SPY") return vol("SPY");
      if (key === "agg:SPY") return agg("SPY");
      return null;
    });
    await mount();
    expect(host.textContent).toContain("MOVES · Unavailable");
    expect(host.textContent).toContain("40.0th");
  });

  it("a slower old root cannot overwrite a newer root selection", async () => {
    installSources({ "moves:ARM": 80, "vol:ARM": 80, "agg:ARM": 80, "moves:MU": 1, "vol:MU": 1, "agg:MU": 1 });
    await mount();
    await setInput("ARM");
    await act(async () => { input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    await setInput("MU");
    await act(async () => { input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 120)); });
    expect(input().value).toBe("MU");
    expect(H.trackSearch.mock.calls.at(-1)?.[0]).toBe("MU");
    expect(host.textContent).toContain("MOVES · as of 2026-10-01");
  });

  it("has a local Chinese product surface without mutating global i18n", async () => {
    H.lang = "zh";
    await mount();
    expect(host.textContent).toContain("预期波动与历史区间覆盖");
    expect(host.textContent).toContain("它不是胜率、概率预测、交易信号或目标价");
    expect(host.textContent).toContain("三个既有来源，三个独立日期");
  });
});
