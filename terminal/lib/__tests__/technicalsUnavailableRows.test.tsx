// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Isolate the unrelated chart-engine import. These cases stay on daily bars.
// TechnicalsPage, computeRatings, resampleDaily, formatters, and gauges are real.
vi.mock("@/components/ChartPanel", () => ({
  intradayCapable: () => false,
}));

import TechnicalsPage from "@/components/fin/TechnicalsPage";
import type { Bar } from "@/lib/fund";
import { computeRatings } from "@/lib/techRating";
import { fmtDate } from "@/lib/finFormat";

type Group = "mas" | "oscillators";
const titles: Record<Group, [string, string]> = {
  mas: ["Moving Averages", "移动平均"],
  oscillators: ["Oscillators", "震荡指标"],
};
const missingMas = [
  "EMA (50)", "EMA (100)", "EMA (200)",
  "SMA (50)", "SMA (100)", "SMA (200)",
];

function barsOf(n: number, measuredZero = false): Bar[] {
  const out: Bar[] = [];
  let ms = Date.UTC(2020, 0, 6);
  while (out.length < n) {
    const d = new Date(ms);
    ms += 86_400_000;
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const i = out.length;
    const c = measuredZero ? 128 : 100 + i;
    out.push({
      time: d.toISOString().slice(0, 10),
      o: c,
      h: measuredZero ? (i % 2 === 0 ? 130 : 129) : c + 1,
      l: measuredZero ? (i % 2 === 0 ? 127 : 126) : c - 1,
      c,
      v: 100,
    });
  }
  return out;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
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

async function renderBars(bars: Bar[], zh: boolean) {
  await act(async () => {
    root.render(<TechnicalsPage sym="NVDA" bars={bars} zh={zh} />);
  });
}

function card(group: Group, zh: boolean): HTMLElement {
  const found = [...host.querySelectorAll<HTMLElement>(".fin-card.fin-tech-tbl")]
    .find((el) =>
      el.querySelector(".fin-sec-h")?.textContent === titles[group][zh ? 1 : 0]
    );
  expect(found).toBeDefined();
  return found!;
}

function rowCells(group: Group, name: string, zh: boolean) {
  const row = [...card(group, zh).querySelectorAll<HTMLTableRowElement>("tbody tr")]
    .find((el) => el.querySelector('th[scope="row"]')?.textContent === name);
  expect(row).toBeDefined();
  const cells = row!.querySelectorAll<HTMLTableCellElement>("td");
  expect(cells.length).toBe(2);
  return { value: cells[0], action: cells[1] };
}

function expectRow(
  group: Group,
  name: string,
  zh: boolean,
  value: string,
  action: string,
  tone: "up" | "down" | "mut",
) {
  const cells = rowCells(group, name, zh);
  expect(cells.value.textContent).toBe(value);
  expect(cells.action.textContent).toBe(action);
  expect(cells.action.classList.contains("fin-tech-act")).toBe(true);
  for (const candidate of ["up", "down", "mut"]) {
    expect(cells.action.classList.contains(candidate)).toBe(candidate === tone);
  }
}

function expectUnavailable(group: Group, name: string, zh: boolean) {
  expectRow(group, name, zh, "—", zh ? "不可用" : "Unavailable", "mut");
}

function unavailableNames(group: Group, zh: boolean): string[] {
  return [...card(group, zh).querySelectorAll<HTMLTableRowElement>("tbody tr")]
    .filter((row) =>
      row.querySelector(".fin-tech-act")?.textContent ===
        (zh ? "不可用" : "Unavailable")
    )
    .map((row) => row.querySelector('th[scope="row"]')!.textContent!);
}

describe("Technicals table: unavailable numeric values", () => {
  it("labels exactly seven null rows at 30 bars through EN/ZH/EN rerenders", async () => {
    for (const zh of [false, true, false]) {
      const bars = barsOf(30);
      const ratings = computeRatings(bars, "D");

      // Fixture guards use the existing producer, not a mocked rating payload.
      expect(ratings.mas.filter((r) => r.value === null).map((r) => r.name))
        .toEqual(missingMas);
      expect(ratings.oscillators.filter((r) => r.value === null).map((r) => r.name))
        .toEqual(["Awesome Oscillator"]);

      await renderBars(bars, zh);
      expect(card("mas", zh).querySelectorAll('tbody th[scope="row"]').length)
        .toBe(15);
      expect(card("oscillators", zh).querySelectorAll('tbody th[scope="row"]').length)
        .toBe(11);

      for (const name of missingMas) expectUnavailable("mas", name, zh);
      expectUnavailable("oscillators", "Awesome Oscillator", zh);
      expect(unavailableNames("mas", zh)).toEqual(missingMas);
      expect(unavailableNames("oscillators", zh)).toEqual(["Awesome Oscillator"]);

      for (const name of ["EMA (30)", "SMA (30)"]) {
        expectRow("mas", name, zh, "114.50", zh ? "买入" : "Buy", "up");
      }
    }
  });

  it("keeps measured zero Neutral, then restores unavailable rows on the same root", async () => {
    for (const zh of [false, true, false]) {
      await renderBars(barsOf(30), zh);
      expectUnavailable("oscillators", "Awesome Oscillator", zh);

      const bars = barsOf(220, true);
      const momentum = computeRatings(bars, "D").oscillators
        .find((r) => r.name === "Momentum (10)");
      expect(momentum).toMatchObject({ value: 0, vote: "Neutral" });

      await renderBars(bars, zh);
      expectRow(
        "oscillators", "Momentum (10)", zh,
        "0.00", zh ? "中性" : "Neutral", "mut",
      );
      expectRow(
        "mas", "SMA (200)", zh,
        "128.00", zh ? "中性" : "Neutral", "mut",
      );

      await renderBars(barsOf(30), zh);
      expectUnavailable("oscillators", "Awesome Oscillator", zh);
      expectUnavailable("mas", "SMA (200)", zh);
    }
  });

  it("updates the 50/200-bar boundaries in both directions without stale cells", async () => {
    for (const zh of [false, true, false]) {
      for (const [period, expected] of [[50, "124.50"], [200, "199.50"]] as const) {
        for (const n of [period - 1, period, period - 1]) {
          await renderBars(barsOf(n), zh);
          for (const kind of ["EMA", "SMA"]) {
            const name = `${kind} (${period})`;
            if (n < period) {
              expectUnavailable("mas", name, zh);
            } else {
              expectRow("mas", name, zh, expected, zh ? "买入" : "Buy", "up");
            }
          }
        }
      }
    }
  });

  it("retains the existing empty tables below 30 bars after populated renders", async () => {
    for (const zh of [false, true, false]) {
      for (const n of [0, 29, 30, 29]) {
        await renderBars(barsOf(n), zh);
        if (n === 30) {
          expectUnavailable("mas", "EMA (50)", zh);
          continue;
        }
        for (const group of ["mas", "oscillators"] as const) {
          const table = card(group, zh);
          expect(table.querySelectorAll('tbody th[scope="row"]').length).toBe(0);
          expect(table.querySelector(".fin-empty-inline")?.textContent)
            .toBe(zh ? "暂无数据" : "No data");
          expect(table.querySelector(".fin-tech-act")).toBeNull();
        }
      }
    }
  });
});

type DerivedTf = "W" | "1M";

const timeframeLabels: Record<"D" | DerivedTf, [string, string]> = {
  D: ["1 day", "1天"],
  W: ["1 week", "1周"],
  "1M": ["1 month", "1月"],
};

// Two equal-OHLC observations per source-defined bucket.
// W: Monday/Tuesday, starting 2020-01-06.
// 1M: calendar day 01/02, starting 2020-01-01.
// The real resampler retains the first date and sums v to 200.
function pairedDailyBars(n: number, tf: DerivedTf): Bar[] {
  const out: Bar[] = [];
  for (let i = 0; i < n; i++) {
    const c = 100 + i;
    for (const offset of [0, 1]) {
      const ms = tf === "W"
        ? Date.UTC(2020, 0, 6 + 7 * i + offset)
        : Date.UTC(2000, i, 1 + offset);
      out.push({
        time: new Date(ms).toISOString().slice(0, 10),
        o: c,
        h: c + 1,
        l: c - 1,
        c,
        v: 100,
      });
    }
  }
  return out;
}

async function clickTimeframe(tf: "D" | DerivedTf, zh: boolean) {
  const label = timeframeLabels[tf][zh ? 1 : 0];
  const button = [
    ...host.querySelectorAll<HTMLButtonElement>(
      ".fin-tf-row > .fin-tf-pill",
    ),
  ].find((el) => el.textContent === label);
  expect(button).toBeDefined();
  expect(button!.disabled).toBe(false);

  await act(async () => button!.click());

  expect([
    ...host.querySelectorAll<HTMLButtonElement>(
      ".fin-tf-row > .fin-tf-pill.on",
    ),
  ].map((el) => el.textContent)).toEqual([label]);
}

function expectDerivedProvenance(
  tf: DerivedTf,
  zh: boolean,
  n: number,
  raw: Bar[],
) {
  const label = timeframeLabels[tf][zh ? 1 : 0];
  // The final raw observation is Tuesday/day 02. The bucket's retained
  // date must instead be the preceding Monday/day 01.
  const firstDate = fmtDate(raw[raw.length - 2].time);
  expect(firstDate).not.toBe(fmtDate(raw[raw.length - 1].time));

  const provenance = host.querySelectorAll<HTMLElement>(
    ".fin-tech .fin-asof > .num, " +
    ".fin-tech [data-market-vnext-state] > header > div > p",
  );
  expect(provenance.length).toBe(1);
  expect(zh ? [
    `${label}周期 · 本地计算 · 最新K线 ${firstDate} · N=${n}`,
    `${label} K线 · 截至 ${firstDate} · ${n} 个观测`,
  ] : [
    `${label} timeframe · computed client-side · last bar ${firstDate} · N=${n}`,
    `${label} bars · through ${firstDate} · ${n} observations`,
  ]).toContain(provenance[0].textContent);
}

describe("Technicals unavailable rows on real daily-derived timeframes", () => {
  for (const tf of ["W", "1M"] as const) {
    it(`${tf}: uses active buckets through EN/ZH/EN boundary reversals`, async () => {
      for (const zh of [false, true, false]) {
        await renderBars(pairedDailyBars(29, tf), zh);
        // Force a real transition for each language pass. D is setup only;
        // the existing daily suite owns its assertions.
        await clickTimeframe("D", zh);
        await clickTimeframe(tf, zh);

        for (const n of [29, 30, 29, 49, 50, 49, 199, 200, 199, 29]) {
          const raw = pairedDailyBars(n, tf);
          expect(raw.length).toBe(2 * n);
          await renderBars(raw, zh);
          expectNumericAvailability(n, zh);
          expectDerivedProvenance(tf, zh, n, raw);

          expect([
            ...host.querySelectorAll<HTMLButtonElement>(
              ".fin-tf-row > .fin-tf-pill.on",
            ),
          ].map((el) => el.textContent))
            .toEqual([timeframeLabels[tf][zh ? 1 : 0]]);

          if (n < 30) {
            for (const group of ["mas", "oscillators"] as const) {
              const table = card(group, zh);
              expect(table.querySelectorAll('tbody th[scope="row"]').length)
                .toBe(0);
              expect(table.querySelector(".fin-empty-inline")?.textContent)
                .toBe(zh ? "暂无数据" : "No data");
              expect(table.querySelector(".fin-tech-act")).toBeNull();
            }
            continue;
          }

          expect(card("mas", zh).querySelectorAll('tbody th[scope="row"]').length)
            .toBe(15);
          expect(card("oscillators", zh)
            .querySelectorAll('tbody th[scope="row"]').length).toBe(11);

          for (const period of [30, 50, 100, 200]) {
            for (const kind of ["EMA", "SMA"]) {
              const name = `${kind} (${period})`;
              if (n < period) {
                expectUnavailable("mas", name, zh);
              } else {
                // For c=100+i, both the SMA and SMA-seeded EMA follow
                // this ramp exactly; formatting is checked to 2 decimals.
                const value = (100 + n - 1 - (period - 1) / 2).toFixed(2);
                expectRow(
                  "mas", name, zh, value,
                  zh ? "买入" : "Buy", "up",
                );
              }
            }
          }

          expect(unavailableNames("mas", zh)).toEqual(
            missingMas.filter((name) => Number(name.match(/\d+/)![0]) > n),
          );

          if (n === 30) {
            expectUnavailable("oscillators", "Awesome Oscillator", zh);
            expect(unavailableNames("oscillators", zh))
              .toEqual(["Awesome Oscillator"]);
          }
        }
      }
    });
  }
});

function summaryGroup(group: Group, zh: boolean): HTMLElement {
  const title = titles[group][zh ? 1 : 0];
  const found = [...host.querySelectorAll<HTMLElement>('.fin-tech-gauge[role="group"]')]
    .find((el) => el.getAttribute("aria-label") === title);
  expect(found).toBeDefined();
  return found!;
}

function expectGroupAvailability(group: Group, zh: boolean, total: number, unavailable: number) {
  const summary = summaryGroup(group, zh);
  const disclosure = summary.querySelector(".fin-market-rating-availability");
  if (unavailable > 0) {
    expect(disclosure?.querySelector("strong")?.textContent)
      .toBe(zh ? "暂不显示汇总" : "Summary not shown");
    expect(disclosure?.querySelector("span")?.textContent).toBe(zh
      ? `${total} 项数值读数中 ${total - unavailable} 项可用 · ${unavailable} 项不可用`
      : `${total - unavailable} of ${total} numeric readings available · ${unavailable} unavailable`);
    expect(summary.querySelector(".arcg")).toBeNull();
    expect(summary.querySelector(".fin-gauge-counts")).toBeNull();
  } else {
    expect(disclosure).toBeNull();
    expect(summary.querySelector(".arcg")).not.toBeNull();
    if (total === 0) {
      expect(summary.querySelector(".arcg .num")).toBeNull();
      expect(summary.querySelector(".fin-gauge-counts")).toBeNull();
    } else {
      expect(summary.querySelector(".arcg .num")).not.toBeNull();
      expect(summary.querySelector(".fin-gauge-counts")).not.toBeNull();
    }
  }
}

function expectNumericAvailability(n: number, zh: boolean) {
  if (n < 30) {
    expectGroupAvailability("mas", zh, 0, 0);
    expectGroupAvailability("oscillators", zh, 0, 0);
    return;
  }
  expectGroupAvailability("mas", zh, 15, n < 50 ? 6 : n < 100 ? 4 : n < 200 ? 2 : 0);
  expectGroupAvailability("oscillators", zh, 11, n < 34 ? 1 : 0);
}

describe("Technicals group numeric availability", () => {
  it("withholds only incomplete groups and clears disclosures through same-root reversals", async () => {
    for (const zh of [false, true, false]) {
      for (const n of [0, 29, 30, 33, 49, 50, 49, 199, 200, 199, 29]) {
        await renderBars(barsOf(n), zh);
        expectNumericAvailability(n, zh);
        if (n === 200) {
          const canonical = computeRatings(barsOf(n), "D");
          for (const [group, index] of [["oscillators", 0], ["mas", 1]] as const) {
            const summary = summaryGroup(group, zh);
            const row = canonical.summary[index];
            expect(summary.querySelector(".arcg .num")?.textContent)
              .toBe(String(Math.round((row.score + 1) * 50)));
            expect([...summary.querySelectorAll(".fin-gauge-counts > span")]
              .map((el) => el.textContent)).toEqual(zh
              ? [`卖 ${row.sell}`, `中性 ${row.neutral}`, `买 ${row.buy}`]
              : [`Sell ${row.sell}`, `Neutral ${row.neutral}`, `Buy ${row.buy}`]);
          }
        }
      }
    }
  });

  it("preserves finite warmup Neutral and measured zero without claiming vote readiness", async () => {
    for (const zh of [false, true, false]) {
      for (const n of [30, 33]) {
        const bars = barsOf(n);
        const macd = computeRatings(bars, "D").oscillators.find((row) => row.name === "MACD (12, 26, 9)");
        expect(macd?.value).toBeCloseTo(7, 10);
        expect(macd?.vote).toBe("Neutral");
        await renderBars(bars, zh);
        expectRow("oscillators", "MACD (12, 26, 9)", zh, "7.00", zh ? "中性" : "Neutral", "mut");
        expectGroupAvailability("oscillators", zh, 11, 1);
        expect(host.querySelector("[data-market-vnext-rating] > header")?.textContent)
          .toContain(zh ? "中性也可能表示历史不足。" : "Neutral may reflect limited history.");
      }
      const zeroBars = barsOf(220, true);
      const canonical = computeRatings(zeroBars, "D");
      expect(canonical.summary[1]).toMatchObject({ score: 0, neutral: 15, buy: 0, sell: 0, verdict: "Neutral" });
      await renderBars(zeroBars, zh);
      expectRow("oscillators", "Momentum (10)", zh, "0.00", zh ? "中性" : "Neutral", "mut");
      expectRow("mas", "SMA (200)", zh, "128.00", zh ? "中性" : "Neutral", "mut");
      const summary = summaryGroup("mas", zh);
      expectGroupAvailability("mas", zh, 15, 0);
      expect(summary.querySelector(".arcg .num")?.textContent).toBe("50");
      expect(summary.querySelector(".arcg")?.textContent).toContain(zh ? "中性" : "Neutral");
      expect(summary.querySelector(".fin-gauge-counts")?.textContent).toContain(zh ? "中性 15" : "Neutral 15");
      await renderBars(barsOf(30), zh);
      expectNumericAvailability(30, zh);
    }
  });
});
