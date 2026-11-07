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

// The expiry cell is two elements: the date line and, when the row carries one, its qualifier.
type Expiry = { date: string | null; note: string | null };
type Row = { tenor: string; cells: string[]; html: string; expiry: Expiry };
function termRows(): Row[] {
  const table = el.querySelector('[data-testid="vol-compare"] table');
  expect(table).toBeTruthy();
  return [...table!.querySelectorAll("tbody tr")].map((tr) => {
    const tds = [...tr.querySelectorAll("td")];
    const cells = tds.map((td) => td.textContent ?? "");
    const exp = tds[1];
    const expiry = {
      date: exp?.querySelector('[data-testid="vol-term-exp-date"]')?.textContent ?? null,
      note: exp?.querySelector('[data-testid="vol-term-exp-note"]')?.textContent ?? null,
    };
    return { tenor: cells[0] ?? "", cells, html: tr.outerHTML, expiry };
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
  en: "Expected move to the 2 Nov close no confidence level is attached±2.1 % · price range not shown · no spot supplied to this viewEstimatorIV · √T on published ATM IV 33.0 % · declared approximationHorizon1 trading day · 30 Oct → 2 Nov close weekdays, exchange holidays not subtractedVolatility clock23 Oct nightly EODSpot clockno spot supplied",
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
      // 2026-10-23 + 7 = 2026-10-30, which is the pinned viewer day: on-today is labeled. The
      // date and its qualifier are separate elements, and the cell text keeps them apart.
      expect(row(rows, "7D").expiry).toEqual(lang === "en"
        ? { date: "30 Oct", note: PAST.en("23 Oct") }
        : { date: "10月30日", note: PAST.zh("10月23日") });
      expect(row(rows, "7D").cells[1]).toBe(lang === "en"
        ? `30 Oct ${PAST.en("23 Oct")}`
        : `10月30日 ${PAST.zh("10月23日")}`);
      // A date after today stays unlabeled: 14D = 6 Nov, 21D = 13 Nov, 60D = 22 Dec.
      expect(row(rows, "14D").cells[1]).toBe(lang === "en" ? "6 Nov" : "11月6日");
      expect(row(rows, "21D").cells[1]).toBe(lang === "en" ? "13 Nov" : "11月13日");
      expect(row(rows, "60D").cells[1]).toBe(lang === "en" ? "22 Dec" : "12月22日");
    });

    it(`[${lang}] labels a date strictly before today and names the read`, async () => {
      await render(<VolComparePanel {...OLD} today="2026-11-08" lang={lang} />);
      const rows = termRows();
      // 30 Oct and 6 Nov are both before 8 Nov; 13 Nov is after it.
      expect(row(rows, "7D").expiry).toEqual(lang === "en"
        ? { date: "30 Oct", note: PAST.en("23 Oct") }
        : { date: "10月30日", note: PAST.zh("10月23日") });
      expect(row(rows, "14D").expiry).toEqual(lang === "en"
        ? { date: "6 Nov", note: PAST.en("23 Oct") }
        : { date: "11月6日", note: PAST.zh("10月23日") });
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
          expect(row(rows, tenor).expiry).toEqual({ date: "—", note: UNSTATED[lang] });
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

// R2 (#1200 review): the boundary is "on or before today", so the first future ET day stays
// unlabeled. This kills a `row.exp <= today + 1` mutant that the on-today and before-today
// tests above would both still pass.
describe("VolComparePanel · AC40 the day after today is not labeled", () => {
  for (const lang of LANGS) {
    it(`[${lang}] a 7D date one day after today carries no past-read label`, async () => {
      // 2026-10-23 + 7 = 2026-10-30 = today + 1.
      await render(<VolComparePanel {...OLD} today="2026-10-29" lang={lang} />);
      const rows = termRows();
      expect(row(rows, "7D").cells[1]).toBe(lang === "en" ? "30 Oct" : "10月30日");
      expect(el.textContent).not.toContain(lang === "en" ? "not ahead of today" : "不晚于今日");
    });
  }
});

// R3 (#1200 review): with no `today` prop the panel derives the viewer day in America/New_York
// from the system clock. Each case pins the clock with fake Date timers and restores it after
// the test (the #1199 pattern). 03:30Z is still the previous ET day; the 2026-11-01 cases sit
// on either side of the 06:00Z EDT->EST change, so a UTC day, a fixed EDT (-4) offset and a
// fixed EST (-5) offset each produce a wrong day in at least one case.
describe("VolComparePanel · AC40 the viewer day is the ET calendar day of the system clock", () => {
  afterEach(() => { vi.useRealTimers(); });
  const { today: _pinned, ...LIVE } = OLD;
  void _pinned;
  const CASES = [
    // instant, ET day E, asof = E-7 (7D lands on E: labeled), asof = E-6 (7D lands on E+1: unlabeled)
    { at: "2026-10-28T03:30:00Z", et: "27 Oct, EDT 23:30", onAsof: "2026-10-20", on: { en: "27 Oct", zh: "10月27日" }, read: { en: "20 Oct", zh: "10月20日" }, nextAsof: "2026-10-21", next: { en: "28 Oct", zh: "10月28日" } },
    { at: "2026-11-01T04:30:00Z", et: "1 Nov, EDT 00:30", onAsof: "2026-10-25", on: { en: "1 Nov", zh: "11月1日" }, read: { en: "25 Oct", zh: "10月25日" }, nextAsof: "2026-10-26", next: { en: "2 Nov", zh: "11月2日" } },
    { at: "2026-11-01T05:30:00Z", et: "1 Nov, EDT 01:30", onAsof: "2026-10-25", on: { en: "1 Nov", zh: "11月1日" }, read: { en: "25 Oct", zh: "10月25日" }, nextAsof: "2026-10-26", next: { en: "2 Nov", zh: "11月2日" } },
    { at: "2026-11-02T04:30:00Z", et: "1 Nov, EST 23:30", onAsof: "2026-10-25", on: { en: "1 Nov", zh: "11月1日" }, read: { en: "25 Oct", zh: "10月25日" }, nextAsof: "2026-10-26", next: { en: "2 Nov", zh: "11月2日" } },
    { at: "2026-11-02T05:30:00Z", et: "2 Nov, EST 00:30", onAsof: "2026-10-26", on: { en: "2 Nov", zh: "11月2日" }, read: { en: "26 Oct", zh: "10月26日" }, nextAsof: "2026-10-27", next: { en: "3 Nov", zh: "11月3日" } },
  ] as const;
  for (const c of CASES) {
    for (const lang of LANGS) {
      it(`[${lang}] at ${c.at} (ET ${c.et}) the 7D row is labeled on today and unlabeled the day after`, async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date(c.at));
        await render(<VolComparePanel {...LIVE} asof={c.onAsof} lang={lang} />);
        expect(row(termRows(), "7D").expiry).toEqual({ date: c.on[lang], note: PAST[lang](c.read[lang]) });
        await render(<VolComparePanel {...LIVE} asof={c.nextAsof} lang={lang} />);
        expect(row(termRows(), "7D").cells[1]).toBe(c.next[lang]);
        expect(el.textContent).not.toContain(lang === "en" ? "not ahead of today" : "不晚于今日");
      });
    }
  }
});

// The coverage strip's basis line: a dated asof keeps the dated template byte-for-byte; no asof
// takes its own no-clock copy. "clock not stated by source" is never spliced into the dated
// template, which read "Clock clock not stated by source nightly" / "时钟为 来源未说明时钟 每晚收盘".
describe("VolComparePanel · AC40 the strip basis line states its clock or that none is stated", () => {
  const DATED = {
    en: "Basis published ATM IV · Clock 23 Oct nightly · side not stated by source · variance-linear",
    zh: "基准为已发布平值IV · 时钟为 10月23日 每晚收盘 · 来源未说明报价口径 · 方差线性插值",
  };
  const NO_CLOCK = {
    en: "Basis published ATM IV · clock not stated by source · side not stated by source · variance-linear",
    zh: "基准为已发布平值IV · 来源未说明时钟 · 来源未说明报价口径 · 方差线性插值",
  };
  const stripSpans = () => [...el.querySelectorAll('[data-testid="vol-compare-strip"] span')].map((s) => s.textContent ?? "");
  for (const lang of LANGS) {
    it(`[${lang}] a dated asof renders the dated basis line unchanged`, async () => {
      await render(<VolComparePanel {...OLD} lang={lang} />);
      expect(stripSpans()).toContain(DATED[lang]);
      expect(stripSpans()).not.toContain(NO_CLOCK[lang]);
    });
    it(`[${lang}] a missing asof renders the no-clock basis line, never the dated template`, async () => {
      await render(<VolComparePanel {...OLD} asof={undefined as unknown as string} lang={lang} />);
      expect(stripSpans()).toContain(NO_CLOCK[lang]);
      expect(el.textContent).not.toContain("Clock clock");
      expect(el.textContent).not.toContain("时钟为 来源未说明时钟");
    });
  }

  // A malformed asof is no clock: the strip and the term subtitle take the same validated day
  // (`volIsoDay`) as the rows, so neither claims "Clock — nightly" while the rows say the
  // clock is not stated.
  const termSub = () => {
    const h3 = [...el.querySelectorAll('[data-testid="vol-compare"] h3')]
      .find((h) => /^(Term structure|期限结构)/.test(h.textContent ?? ""));
    expect(h3).toBeTruthy();
    return h3!.querySelector("span")?.textContent ?? "";
  };
  const SUB_DATED = { en: " · nightly EOD 23 Oct", zh: " · 每晚收盘 10月23日" };
  // H2 (#1200 audit r6 MINOR 2): a read with no valid clock takes its own subtitle copy, never
  // the dated template with the unstated-clock reason spliced into its date slot ("nightly EOD
  // clock not stated by source" claimed a nightly clock that is not stated).
  const SUB_NO_CLOCK = {
    en: "4 supplied · 4 interpolated for this read · clock not stated by source",
    zh: "4 个已提供 · 本次读数插值 4 个 · 来源未说明时钟",
  };
  const NIGHTLY = { en: "nightly EOD", zh: "每晚收盘" };
  for (const lang of LANGS) {
    it(`[${lang}] a valid asof keeps the dated term subtitle`, async () => {
      await render(<VolComparePanel {...OLD} lang={lang} />);
      expect(termSub().endsWith(SUB_DATED[lang])).toBe(true);
    });
    it(`[${lang}] a missing asof renders the no-clock term subtitle`, async () => {
      await render(<VolComparePanel {...OLD} asof={undefined as unknown as string} lang={lang} />);
      expect.soft(termSub().trim()).toBe(SUB_NO_CLOCK[lang]);
      expect.soft(termSub()).not.toContain(NIGHTLY[lang]);
    });
    for (const bad of ["2026-13-45", "2026-10-xx", "2026-02-30"]) {
      it(`[${lang}] a malformed asof ${bad} renders the no-clock strip and term subtitle`, async () => {
        await render(<VolComparePanel {...OLD} asof={bad} lang={lang} />);
        expect.soft(stripSpans()).toContain(NO_CLOCK[lang]);
        expect.soft(termSub().trim()).toBe(SUB_NO_CLOCK[lang]);
        expect.soft(termSub()).not.toContain(NIGHTLY[lang]);
        const text = el.textContent ?? "";
        for (const dated of ["Clock —", "Clock 2026", "时钟为", "nightly EOD —", "每晚收盘 —"]) {
          expect.soft(text).not.toContain(dated);
        }
      });
    }
  }
});

// F6 (review of #1200): the expected-move block's volatility clock and the stale note read the
// same validated day (`volIsoDay`) as the rows, strip and subtitle. A malformed asof is no
// clock: the move block says the clock is not stated (never "— nightly EOD", which asserts a
// nightly clock that does not exist), the stale note keeps "—", and neither a raw malformed
// string nor a rolled-over date (2026-02-30 parses to 2 Mar) reaches the DOM.
describe("VolComparePanel · F6 the move clock and stale note take the validated asof day", () => {
  const SEL = { ...OLD, selectedExp: "2026-11-02", sessionsOld: 5 };
  const VOL_CLOCK_LABEL = { en: "Volatility clock", zh: "波动率时钟" };
  const VOL_CLOCK_DATED = { en: "23 Oct nightly EOD", zh: "10月23日 每晚收盘" };
  const STALE_PREFIX = { en: "Vol as of ", zh: "波动率截至 " };
  const STALE = {
    en: (d: string) => `Vol as of ${d} · this read is 5 sessions old · both clocks stay visible`,
    zh: (d: string) => `波动率截至 ${d} · 本次读数已过去 5 个交易日 · 两个时钟均保留显示`,
  };
  const ROLLED = { en: "2 Mar", zh: "3月2日" };
  const volClock = (lang: "en" | "zh") => {
    const move = el.querySelector('[data-testid="vol-compare-move"]');
    expect(move, "the expected-move block").toBeTruthy();
    const dt = [...move!.querySelectorAll("dt")].find((d) => d.textContent === VOL_CLOCK_LABEL[lang]);
    expect(dt, "the volatility clock row").toBeTruthy();
    return dt!.nextElementSibling?.textContent ?? "";
  };
  const staleNote = (lang: "en" | "zh") => {
    const hit = [...el.querySelectorAll("span")].find((s) => (s.textContent ?? "").startsWith(STALE_PREFIX[lang]));
    expect(hit, "the stale note").toBeTruthy();
    return hit!.textContent ?? "";
  };
  for (const lang of LANGS) {
    it(`[${lang}] a valid asof keeps the dated volatility clock and the dated stale note`, async () => {
      await render(<VolComparePanel {...SEL} lang={lang} />);
      expect(volClock(lang)).toBe(VOL_CLOCK_DATED[lang]);
      expect(staleNote(lang)).toBe(STALE[lang](lang === "en" ? "23 Oct" : "10月23日"));
    });
    for (const bad of ["2026-13-45", "2026-10-xx", "2026-02-30"]) {
      it(`[${lang}] a malformed asof ${bad}: the volatility clock is not stated and the stale note keeps —`, async () => {
        await render(<VolComparePanel {...SEL} asof={bad} lang={lang} />);
        expect.soft(volClock(lang)).toBe(UNSTATED[lang]);
        expect.soft(staleNote(lang)).toBe(STALE[lang]("—"));
        const text = el.textContent ?? "";
        expect.soft(text).not.toContain(lang === "en" ? "— nightly EOD" : "— 每晚收盘");
        expect.soft(text).not.toContain(bad);
        expect.soft(text).not.toContain(ROLLED[lang]);
      });
    }
  }
});

// H3 (#1200 audit r6 MINOR 3): the published band's clock takes the same validated day
// (`volIsoDay`) as every other source clock. A malformed band asof is no clock (the
// unstated-clock copy), never "Band clock as of —" and never a rolled-over date (2026-02-30
// parses to 2 Mar). A valid band asof, day or ISO datetime, keeps the dated band clock.
describe("VolComparePanel · H3 the band clock takes the validated band asof day", () => {
  const SEL = { ...OLD, selectedExp: "2026-11-02" };
  const band = (asof: string) => ({ pct: 0.92, bandMult: 1.96, horizonDays: 1, asof });
  const METHOD = { en: "Band method not stated by source", zh: "来源未说明区间的计算方法" };
  const BAND_PREFIX = { en: "Band clock as of", zh: "区间时钟截至" };
  const BAND_DATED = { en: "Band clock as of 25 Sep · moves with the producer", zh: "区间时钟截至 9月25日 · 随来源更新" };
  const ROLLED = { en: "2 Mar", zh: "3月2日" };
  const bandClock = (lang: "en" | "zh") => {
    const dt = [...el.querySelectorAll("dt")].find((d) => d.textContent === METHOD[lang]);
    expect(dt, "the band method row").toBeTruthy();
    return dt!.nextElementSibling?.textContent ?? "";
  };
  for (const lang of LANGS) {
    for (const good of ["2026-09-25", "2026-09-25T21:00:00Z"]) {
      it(`[${lang}] a valid band asof ${good} keeps the dated band clock`, async () => {
        await render(<VolComparePanel {...SEL} publishedBand={band(good)} lang={lang} />);
        expect(bandClock(lang)).toBe(BAND_DATED[lang]);
      });
    }
    for (const bad of ["2026-02-30", "2026-02-30T21:00:00Z", "2026-13-45", "2026-10-xx"]) {
      it(`[${lang}] a malformed band asof ${bad} renders the unstated band clock`, async () => {
        await render(<VolComparePanel {...SEL} publishedBand={band(bad)} lang={lang} />);
        expect.soft(bandClock(lang)).toBe(UNSTATED[lang]);
        const text = el.textContent ?? "";
        expect.soft(text).not.toContain(BAND_PREFIX[lang]);
        expect.soft(text).not.toContain(bad.slice(0, 10));
        expect.soft(text).not.toContain(ROLLED[lang]);
      });
    }
  }
});
