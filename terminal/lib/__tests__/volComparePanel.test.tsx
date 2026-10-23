// @vitest-environment jsdom
// Options R1 W3B — VolComparePanel (constant-tenor comparison) rendered states.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VolComparePanel } from "@/components/vol/VolComparePanel";
import type { VolSmileExp, VolTermRow } from "@/components/vol/volTypes";
import type { CurveEvent } from "@/lib/volTenorComparison";

let el: HTMLDivElement, root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); el = document.createElement("div"); document.body.append(el); root = createRoot(el); });
afterEach(async () => { await act(async () => root.unmount()); el.remove(); vi.restoreAllMocks(); });
async function render(v: React.ReactNode) { await act(async () => root.render(v)); }

// The W3B fixture read: AAPL nightly 2026-10-20, today 2026-10-21, 23 Oct selected.
const term: VolTermRow[] = [
  { dte: 2, exp: "2026-10-23", atm_iv: 36.9 },
  { dte: 7, exp: "2026-10-28", atm_iv: 34.8 },
  { dte: 10, exp: "2026-10-31", atm_iv: 33.5 },
  { dte: 14, exp: "2026-11-04", atm_iv: 32.2 },
  { dte: 30, exp: "2026-11-20", atm_iv: 29.4 },
  { dte: 60, exp: "2026-12-20", atm_iv: 27.8 },
  { dte: 90, exp: "2027-01-19", atm_iv: 27.1 },
];
const smile: VolSmileExp[] = [
  {
    exp: "2026-11-20",
    points: [
      { strike: 212.5, call_iv: 38.4, put_iv: 38.2 },
      { strike: 236, call_iv: 29.5, put_iv: 29.4 },
      { strike: 255, call_iv: 27.2, put_iv: 27.6 },
    ],
  },
];
const earnings: CurveEvent[] = [
  { kind: "earnings", date: "2026-10-30", label: "Earnings", source: "exchange calendar" },
];
const band = { pct: 1.96, bandMult: 1.96, horizonDays: 1, asof: "2026-10-20" };

const base = { term, smile, asof: "2026-10-20", selectedExp: "2026-10-23" as string | null, today: "2026-10-21" };
const text = () => el.textContent ?? "";

describe("VolComparePanel", () => {
  it("renders the term table with supplied and interpolated basis labels and the selected expiry", async () => {
    await render(<VolComparePanel {...base} lang="en" />);
    const table = el.querySelector('[data-testid="vol-compare"] table');
    expect(table).toBeTruthy();
    // The front expiry is the selected row.
    expect(text()).toContain("2D");
    expect(text()).toContain("36.9 %");
    expect(text()).toContain("SELECTED");
    // 21D is interpolated variance-linearly between the 14D and 30D supplied expiries.
    expect(text()).toContain("21D");
    expect(text()).toContain("30.5 %");
    expect(text()).toContain("interpolated · 14D → 30D");
    expect(text()).toContain("supplied");
    // The board's question names the selected expiry; the foot refuses extrapolation.
    expect(text()).toContain("Is the 23 Oct expiry rich against its own curve?");
    expect(text()).toContain("nothing is extrapolated outside them");
    // The level column is a neutral bar scaled over the supplied range, never direction colour.
    expect(el.querySelector('[data-testid="vol-compare"] [aria-hidden="true"]')).toBeTruthy();
  });

  it("renders the expected move in percent only and says why when no spot is supplied", async () => {
    await render(<VolComparePanel {...base} lang="en" />);
    const move = el.querySelector('[data-testid="vol-compare-move"]');
    expect(move).toBeTruthy();
    expect(move!.textContent).toContain("±3.3 %");
    expect(move!.textContent).toContain("price range not shown");
    expect(move!.textContent).toContain("no spot supplied to this view");
    expect(move!.textContent).toContain("no confidence level is attached");
    expect(move!.textContent).toContain("2 trading days");
    expect(move!.textContent).toContain("weekdays, exchange holidays not subtracted");
    expect(move!.textContent).toContain("declared approximation");
    expect(text()).not.toContain("$");
    // The producer's band stays absent until it is actually supplied.
    expect(text()).not.toContain("Published one-day band");
  });

  it("leaves the unsupported wing blank with its reason and states the delta axis is unsupported", async () => {
    await render(<VolComparePanel {...base} lang="en" />);
    const skew = el.querySelector('[data-testid="vol-compare-skew"]');
    expect(skew).toBeTruthy();
    expect(skew!.textContent).toContain("110 %");
    expect(skew!.textContent).toContain("unsupported · no strike supplied");
    expect(skew!.textContent).toContain("95 %");
    expect(skew!.textContent).toContain("33.8 %");
    expect(skew!.textContent).toContain("strike space");
    expect(skew!.textContent).toContain("publishes no spot or delta per strike");
    // The blank wing keeps its row: five skew rows, the last carrying an em dash value.
    const rows = [...skew!.querySelectorAll("tbody tr")];
    expect(rows).toHaveLength(5);
    expect(rows[4]!.textContent).toContain("—");
    expect(text()).toContain("Delta axis unsupported");
    expect(text()).toContain("8.8");
  });

  it("flags expiries inside an event window and estimates no event premium", async () => {
    await render(<VolComparePanel {...base} lang="en" events={earnings} />);
    // The 10D expiry's window contains the event; the selected 2D expiry's does not.
    expect(text()).toContain("Earnings 30 Oct inside");
    expect(text()).toContain("Events inside the curve");
    expect(text()).toContain("Inside every tenor from 10D.");
    expect(text()).toContain("Not inside the selected 2D expiry.");
    // 2026-10-30 is a Friday — the weekday comes from the real calendar, never the board's sample.
    expect(text()).toContain("Fri 30 Oct 2026");
    expect(text()).toContain("No event premium is estimated");
    expect(text()).toContain("dates only · time of day not supplied");
  });

  it("shows the published band separately with method not stated by source", async () => {
    await render(<VolComparePanel {...base} lang="en" publishedBand={band} />);
    expect(text()).toContain("Published one-day band");
    expect(text()).toContain("±1.96 %");
    expect(text()).toContain("Band method not stated by source");
    expect(text()).toContain("Band clock as of 20 Oct");
    expect(text()).toContain("no straddle-derived range");
    // The declared estimator and the unstated producer band stay separate columns.
    expect(text()).toContain("declared approximation");
  });

  it("says that no calendar events are supplied when none are given", async () => {
    await render(<VolComparePanel {...base} lang="en" />);
    expect(el.querySelector('[data-testid="vol-compare-events"]')!.textContent).toContain("No calendar events are supplied to this view.");
    expect(text()).toContain("none is wired into this view");
  });

  it("renders in Chinese without machine text", async () => {
    await render(<VolComparePanel {...base} lang="zh" events={earnings} publishedBand={band} />);
    expect(text()).toContain("已提供");
    expect(text()).toContain("插值");
    expect(text()).toContain("平值IV");
    expect(text()).toContain("不附带任何置信水平");
    expect(text()).toContain("曲线窗口内的事件");
    expect(text()).toContain("从 10D 起的每个期限都在窗口内。");
    expect(text()).toContain("来源未说明区间的计算方法");
    // No English enum/state words and no machine tokens leak into the zh view.
    expect(text()).not.toMatch(/\b(supplied|interpolated|unsupported|nightly)\b/);
    expect(text()).not.toMatch(/cmp[A-Z]/);
  });

  it("says the read is N sessions old when the nightly read is stale, keeping both clocks", async () => {
    await render(<VolComparePanel {...base} lang="en" sessionsOld={5} />);
    expect(text()).toContain("this read is 5 sessions old");
    expect(text()).toContain("Clock 20 Oct nightly");
    expect(text()).toContain("both clocks stay visible");
    // Under the staleness threshold the panel stays quiet.
    await render(<VolComparePanel {...base} lang="en" sessionsOld={1} />);
    expect(text()).not.toContain("sessions old");
  });

  it("renders a loading skeleton first and an honest empty state when nothing is supplied", async () => {
    await render(<VolComparePanel {...base} term={undefined} lang="en" />);
    expect(text()).not.toContain("36.9 %");
    expect(el.querySelector('[data-testid="vol-compare"] thead')).toBeTruthy();
    expect(el.querySelectorAll('[data-testid="vol-compare"] tbody span')).toHaveLength(18);
    await render(<VolComparePanel term={[]} smile={[]} asof="2026-10-20" selectedExp={null} lang="en" today="2026-10-21" />);
    expect(text()).toContain("No supplied expiries for this root on the nightly read.");
  });
});
