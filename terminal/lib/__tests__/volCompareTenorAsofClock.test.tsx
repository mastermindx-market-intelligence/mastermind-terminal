// @vitest-environment jsdom
//
// AC40 Option B (seat ruling, macro PR #10397 appendix D): interpolated term rows are dated
// on the producer's clock (`asof`), never the viewer's. A date on or before the viewer's ET
// today says so and names its read; no `asof` means no date plus the reason; the skew
// fallback `calDte` runs on the same clock and declares its fallback. Supplied rows,
// unsupported rows, the interpolation math and the expected-move line are unchanged.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VolComparePanel } from "@/components/vol/VolComparePanel";
import type { VolSmileExp, VolTermRow } from "@/components/vol/volTypes";

let el: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
});
afterEach(async () => {
  await act(async () => root.unmount());
  el.remove();
  vi.restoreAllMocks();
});
async function render(v: React.ReactNode) { await act(async () => root.render(v)); }

// A read published 2026-10-23: supplied expiries at 3D/10D/30D/70D, so 7D/14D/21D/60D are
// interpolated and 90D is outside the supplied range (unsupported).
const term: VolTermRow[] = [
  { dte: 3, exp: "2026-10-26", atm_iv: 35.0 },
  { dte: 10, exp: "2026-11-02", atm_iv: 33.0 },
  { dte: 30, exp: "2026-11-22", atm_iv: 30.0 },
  { dte: 70, exp: "2027-01-01", atm_iv: 28.0 },
];
// The only smile is on an expiry the term table does not carry, so its tenor comes from the
// calendar fallback (`calDte`) rather than a producer dte.
const smile: VolSmileExp[] = [
  {
    exp: "2026-11-20",
    points: [
      { strike: 90, call_iv: 34.0, put_iv: 34.4 },
      { strike: 100, call_iv: 30.0, put_iv: 30.2 },
      { strike: 110, call_iv: 28.8, put_iv: 29.0 },
    ],
  },
];
const OLD = { term, smile, asof: "2026-10-23", selectedExp: null as string | null, today: "2026-10-30" };
const LANGS = ["en", "zh"] as const;

type Row = { tenor: string; cells: string[]; html: string };
function termRows(): Row[] {
  const table = el.querySelector('[data-testid="vol-compare"] table');
  expect(table).toBeTruthy();
  return [...table!.querySelectorAll("tbody tr")].map((tr) => {
    const cells = [...tr.querySelectorAll("td")].map((td) => td.textContent ?? "");
    return { tenor: cells[0] ?? "", cells, html: tr.outerHTML };
  });
}
const row = (rows: Row[], tenor: string) => {
  const hit = rows.find((r) => r.tenor === tenor);
  expect(hit, `row ${tenor}`).toBeTruthy();
  return hit!;
};
const PAST = {
  en: (asof: string) => `not ahead of today · from the ${asof} read`,
  zh: (asof: string) => `不晚于今日 · 来自${asof}的读数`,
};
const UNSTATED = { en: "clock not stated by source", zh: "来源未说明时钟" };
const FALLBACK = { en: "days counted from today: clock not stated by source", zh: "天数自今日起算：来源未说明时钟" };

const MOVE_MASTER = {
  en: "Expected move to the 2 Nov close no confidence level is attached±2.1 % · price range not shown · no spot supplied to this viewEstimatorIV · √T on published ATM IV 33.0 % · declared approximationHorizon1 trading days · 30 Oct → 2 Nov close weekdays, exchange holidays not subtractedVolatility clock23 Oct nightly EODSpot clockno spot supplied",
  zh: "到 11月2日 收盘的预期波动区间 不附带任何置信水平±2.1 % · 未显示价格区间 · 该视图未提供现价估计方法IV · √T，基于已发布平值IV 33.0 % · 已声明的近似方法区间长度1 个交易日 · 10月30日 → 11月2日 收盘 按工作日计算，未扣除交易所假期波动率时钟10月23日 每晚收盘现价时钟未提供现价",
};
const FIXED_MASTER = {
  en: {
    "3D": "3D | 26 Oct | 35.0 % | supplied | — | ",
    "10D": "10D | 2 Nov | 33.0 % | supplied | — | ",
    "30D": "30D | 22 Nov | 30.0 % | supplied | — | ",
    "70D": "70D | 1 Jan | 28.0 % | supplied | — | ",
    "90D": "90D | — | — | unsupported · outside the supplied range | — | ",
  },
  zh: {
    "3D": "3D | 10月26日 | 35.0 % | 已提供 | — | ",
    "10D": "10D | 11月2日 | 33.0 % | 已提供 | — | ",
    "30D": "30D | 11月22日 | 30.0 % | 已提供 | — | ",
    "70D": "70D | 1月1日 | 28.0 % | 已提供 | — | ",
    "90D": "90D | — | — | 不支持 · 超出已提供范围 | — | ",
  },
} as const;

describe("VolComparePanel · AC40 interpolated rows on the producer clock", () => {
  for (const lang of LANGS) {
    it(`[${lang}] dates the 7D row on the asof clock and labels a date equal to today`, async () => {
      await render(<VolComparePanel {...OLD} lang={lang} />);
      const rows = termRows();
      const seven = row(rows, "7D").cells[1];
      // 2026-10-23 + 7 = 2026-10-30, which is the pinned viewer day: on-today is labeled.
      expect(seven).toBe(lang === "en"
        ? `30 Oct · ${PAST.en("23 Oct")}`
        : `10月30日 · ${PAST.zh("10月23日")}`);
      // A date after today stays unlabeled: 14D = 6 Nov, 21D = 13 Nov, 60D = 22 Dec.
      expect(row(rows, "14D").cells[1]).toBe(lang === "en" ? "6 Nov" : "11月6日");
      expect(row(rows, "21D").cells[1]).toBe(lang === "en" ? "13 Nov" : "11月13日");
      expect(row(rows, "60D").cells[1]).toBe(lang === "en" ? "22 Dec" : "12月22日");
    });

    it(`[${lang}] labels a date strictly before today and names the read`, async () => {
      await render(<VolComparePanel {...OLD} today="2026-11-08" lang={lang} />);
      const rows = termRows();
      // 30 Oct and 6 Nov are both before 8 Nov; 13 Nov is after it.
      expect(row(rows, "7D").cells[1]).toBe(lang === "en"
        ? `30 Oct · ${PAST.en("23 Oct")}`
        : `10月30日 · ${PAST.zh("10月23日")}`);
      expect(row(rows, "14D").cells[1]).toBe(lang === "en"
        ? `6 Nov · ${PAST.en("23 Oct")}`
        : `11月6日 · ${PAST.zh("10月23日")}`);
      expect(row(rows, "21D").cells[1]).toBe(lang === "en" ? "13 Nov" : "11月13日");
    });

    it(`[${lang}] an asof equal to today renders dates identical to the viewer-clock output`, async () => {
      await render(<VolComparePanel {...OLD} asof="2026-10-30" lang={lang} />);
      const rows = termRows();
      // 30 Oct + tenor: nothing is on or before today, so no row carries the label.
      expect(row(rows, "7D").cells[1]).toBe(lang === "en" ? "6 Nov" : "11月6日");
      expect(row(rows, "14D").cells[1]).toBe(lang === "en" ? "13 Nov" : "11月13日");
      expect(row(rows, "21D").cells[1]).toBe(lang === "en" ? "20 Nov" : "11月20日");
      expect(row(rows, "60D").cells[1]).toBe(lang === "en" ? "29 Dec" : "12月29日");
      expect(el.textContent).not.toContain(lang === "en" ? "not ahead of today" : "不晚于今日");
    });

    for (const [label, asof] of [["missing", undefined], ["invalid", "2026-13-45"]] as const) {
      it(`[${lang}] asof ${label}: no interpolated date, and the reason is stated`, async () => {
        await render(<VolComparePanel {...OLD} asof={asof as unknown as string} lang={lang} />);
        const rows = termRows();
        for (const tenor of ["7D", "14D", "21D", "60D"]) {
          expect(row(rows, tenor).cells[1]).toBe(`— · ${UNSTATED[lang]}`);
        }
        // Supplied rows still carry their true exchange expiry.
        expect(row(rows, "30D").cells[1]).toBe(lang === "en" ? "22 Nov" : "11月22日");
      });
    }

    it(`[${lang}] supplied and unsupported rows are unchanged by the asof clock`, async () => {
      await render(<VolComparePanel {...OLD} lang={lang} />);
      const old = termRows();
      await render(<VolComparePanel {...OLD} asof="2026-10-30" lang={lang} />);
      const same = termRows();
      await render(<VolComparePanel {...OLD} asof={undefined as unknown as string} lang={lang} />);
      const none = termRows();
      for (const tenor of ["3D", "10D", "30D", "70D", "90D"]) {
        expect(row(old, tenor).html).toBe(row(same, tenor).html);
        expect(row(old, tenor).html).toBe(row(none, tenor).html);
      }
      // The supplied rows' expiry cells are the exchange expiries; 90D is the unsupported row.
      expect(row(old, "3D").cells[1]).toBe(lang === "en" ? "26 Oct" : "10月26日");
      expect(row(old, "70D").cells[1]).toBe(lang === "en" ? "1 Jan" : "1月1日");
      expect(row(old, "90D").cells.slice(1, 3)).toEqual(["—", "—"]);
      // The interpolation math is untouched: the 7D value is the iv²·dte blend of 3D and 10D.
      expect(row(old, "7D").cells[2]).toBe("33.4 %");
      expect(row(same, "7D").cells[2]).toBe("33.4 %");
      // Supplied and unsupported row text captured from master @db6168c2 for this fixture.
      for (const [tenor, text] of Object.entries(FIXED_MASTER[lang])) {
        expect(row(old, tenor).cells.join(" | ")).toBe(text);
      }
    });

    it(`[${lang}] the expected-move line is unchanged by the asof clock`, async () => {
      const sel = { ...OLD, selectedExp: "2026-11-02" };
      await render(<VolComparePanel {...sel} lang={lang} />);
      const moveOld = el.querySelector('[data-testid="vol-compare-move"]')?.outerHTML ?? null;
      await render(<VolComparePanel {...sel} asof="2026-10-23T20:15:00Z" lang={lang} />);
      const moveStamp = el.querySelector('[data-testid="vol-compare-move"]')?.outerHTML ?? null;
      expect(moveOld).toBeTruthy();
      expect(moveStamp).toBe(moveOld);
      // Literal text captured from master @db6168c2 for this fixture: both clocks still declared.
      expect(el.querySelector('[data-testid="vol-compare-move"]')!.textContent).toBe(MOVE_MASTER[lang]);
    });

    it(`[${lang}] the skew tenor runs on the asof clock`, async () => {
      await render(<VolComparePanel {...OLD} lang={lang} />);
      const skew = el.querySelector('[data-testid="vol-compare-skew"]');
      expect(skew).toBeTruthy();
      // 2026-10-23 → 2026-11-20 is 28 calendar days on the producer clock (21 from the viewer's).
      expect(skew!.querySelector("h3")!.textContent).toContain("28D");
      expect(skew!.textContent).not.toContain(FALLBACK[lang]);
    });

    it(`[${lang}] without an asof the skew tenor falls back to today and says so`, async () => {
      await render(<VolComparePanel {...OLD} asof={undefined as unknown as string} lang={lang} />);
      const skew = el.querySelector('[data-testid="vol-compare-skew"]');
      expect(skew).toBeTruthy();
      expect(skew!.querySelector("h3")!.textContent).toContain("21D");
      expect(skew!.textContent).toContain(FALLBACK[lang]);
    });
  }

  it("a skew on a supplied expiry uses the producer dte and declares no fallback", async () => {
    const onSupplied: VolSmileExp[] = [{ ...smile[0]!, exp: "2026-11-22" }];
    await render(<VolComparePanel {...OLD} smile={onSupplied} asof={undefined as unknown as string} lang="en" />);
    const skew = el.querySelector('[data-testid="vol-compare-skew"]');
    expect(skew!.querySelector("h3")!.textContent).toContain("30D");
    expect(skew!.textContent).not.toContain(FALLBACK.en);
  });
});
