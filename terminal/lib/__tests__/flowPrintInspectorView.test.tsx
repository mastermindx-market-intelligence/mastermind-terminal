// @vitest-environment jsdom
/**
 * flowPrintInspectorView.test.tsx — W3A print inspector + coverage line rendering.
 *
 * U05 board honesty contract: the inspector is an estimate view, not a direction
 * fact — every clock/field the flow owner does not carry renders "not supplied by
 * the flow owner", packages state that no package source is admitted, and the
 * coverage line keeps unknown premium in the denominator in EN and ZH.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { FlowCoverageLine, PrintInspector } from "@/components/flowdesk/PrintInspector";
import { flowCoverage, type FlowPrintInput } from "@/lib/flowPrintInspector";

// e1 of the W3A fixture tape — a fully supplied owner row (oi present).
const E1: FlowPrintInput = {
  id: "w3a-e1",
  ts: "2026-10-21T14:40:12.117Z",
  root: "AAPL",
  exp: "2026-10-23",
  strike: 230,
  right: "C",
  group: "Technology",
  group_zh: "科技",
  side: "~buy",
  signing_source: "tape",
  n_prints: 4,
  size: 6000,
  avg_price: 0.84,
  premium: 504000,
  premium_z: null,
  baseline_source: "z252",
  vol_gt_oi: true,
  repeated: false,
  zerodte: false,
  oi: 3680,
};

// e5 — aggregated prints: the owner's premium does not reproduce from size × price × 100.
const E5: FlowPrintInput = { ...E1, id: "w3a-e5", right: "P", strike: 220, side: "mixed", size: 4100, avg_price: 0.95, premium: 395000, oi: undefined };

// The full 9-row fixture tape, for the coverage line's 88 % / 12 % split.
const TAPE: FlowPrintInput[] = [
  E1,
  { ...E1, id: "w3a-e2", ts: "2026-10-21T14:40:12.119Z", strike: 235, size: 6000, avg_price: 0.36, premium: 216000, oi: undefined },
  { ...E1, id: "w3a-e3", ts: "2026-10-21T14:39:58Z", right: "P", strike: 225, side: "unclassified", size: 2500, avg_price: 1.42, premium: 355000 },
  { ...E1, id: "w3a-e4", ts: "2026-10-21T14:38:10Z", side: "~sell", signing_source: "floor", size: 3200, avg_price: 0.81, premium: 259200 },
  E5,
  { ...E1, id: "w3a-e6", ts: "2026-10-21T14:36:05Z", size: 2900, avg_price: 0.92, premium: 266800 },
  { ...E1, id: "w3a-e7", ts: "2026-10-21T14:35:00Z", exp: "2026-11-20", strike: 240, size: 1500, avg_price: 2.1, premium: 315000 },
  { ...E1, id: "w3a-e8", ts: "2026-10-21T14:34:30Z", root: "NVDA", strike: 190, side: "~sell", size: 2000, avg_price: 3.4, premium: 680000 },
  { ...E1, id: "w3a-e9", ts: "2026-10-21T14:36:05Z", size: 1000, avg_price: 0.8, premium: 80000 },
];

describe("PrintInspector (view)", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  afterEach(() => {
    const r = root;
    const c = container;
    if (r && c) {
      act(() => r.unmount());
      c.remove();
    }
    root = null;
    container = null;
  });

  function renderAt(ui: React.ReactElement): string {
    const c = document.createElement("div");
    document.body.appendChild(c);
    const r = createRoot(c);
    root = r;
    container = c;
    act(() => r.render(ui));
    return c.textContent ?? "";
  }

  function renderAgain(ui: React.ReactElement): string {
    const r = root;
    const c = container;
    if (!r || !c) throw new Error("renderAt must run first");
    act(() => r.render(ui));
    return c.textContent ?? "";
  }

  it("renders identity, premium arithmetic, side estimate with method and the not-supplied clocks", () => {
    const text = renderAt(<PrintInspector event={E1} lang="en" oiAsOf="2026-10-20" />);
    expect(container?.querySelector('[data-testid="flow-print-inspector"]')).not.toBeNull();
    // Identity: strike without trailing zeros, expiry as the neighbours format it.
    expect(text).toContain("SELECTED PRINT");
    expect(text).toContain("AAPL 230 C · Oct 23, 2026");
    // Clocks: the owner's event time, and honesty about the clocks it does not carry.
    expect(text).toContain("Event 10:40:12 ET");
    expect(text).toContain("receipt not supplied by the flow owner");
    expect(text).toContain("exchange and conditions not supplied");
    // Premium with the multiplier shown.
    expect(text).toContain("$504,000 = 6,000 × $0.84 × 100");
    // Side is a named-method estimate, never a fact; confidence is never invented.
    expect(text).toContain("SIDE · ESTIMATE");
    expect(text).toContain("Bought · estimate");
    expect(text).toContain("method: tick rule on the tape");
    expect(text).toContain("confidence not supplied by the flow owner");
    // Dated contracts-over-prior-OI ratio.
    expect(text).toContain("1.63× prior open interest");
    expect(text).toContain("OI as of 20 Oct");
  });

  it("states that no package source is admitted instead of grouping related legs", () => {
    // Two same-timestamp prints on the same contract — similar timestamps alone
    // must never render as a grouped package.
    const twin: FlowPrintInput = { ...E1, id: "w3a-e1-twin" };
    const text = renderAt(<PrintInspector event={twin} lang="en" />);
    expect(text).toContain("PACKAGES");
    expect(text).toContain("No package source is admitted. Similar timestamps alone never group prints.");
    // No "confirmed" package language and no leg list exists anywhere.
    expect(text).not.toContain("confirmed");
    expect(container?.querySelectorAll('[data-testid="flow-print-package-leg"]').length).toBe(0);
  });

  it("renders the coverage line with unknown in the denominator in English and Chinese", () => {
    const coverage = flowCoverage(TAPE);
    const en = renderAt(<FlowCoverageLine coverage={coverage} lang="en" />);
    expect(en).toContain("88 % of eligible premium classified · 12 % unknown");
    expect(en).toContain("Calls $2.3M · Puts $750.0K · unsigned premium, not a direction");
    const zh = renderAgain(<FlowCoverageLine coverage={coverage} lang="zh" />);
    expect(zh).toContain("88 % 合格权利金已分类 · 12 % 未知");
    expect(zh).toContain("认购 $2.3M · 认沽 $750.0K · 无符号权利金，非方向指示");
    // Unknown is never dropped from the line, in either language.
    expect(zh).toContain("12 %");
  });

  it("never uses opening, closing, bullish or bearish on the activity ratio", () => {
    const en = renderAt(<PrintInspector event={E1} lang="en" oiAsOf="2026-10-20" />);
    expect(en).toContain("1.63× prior open interest");
    for (const word of ["opening", "closing", "bullish", "bearish"]) {
      expect(en.toLowerCase(), `EN must not contain "${word}"`).not.toContain(word);
    }
    const zh = renderAgain(<PrintInspector event={E1} lang="zh" oiAsOf="2026-10-20" />);
    expect(zh).toContain("前一交易日持仓量");
    for (const word of ["看涨", "看跌", "开仓", "平仓"]) {
      expect(zh, `ZH must not contain "${word}"`).not.toContain(word);
    }
  });

  it("renders nothing for a row the projector rejects", () => {
    const text = renderAt(<PrintInspector event={{ root: "AAPL" }} lang="en" />);
    expect(container?.querySelector('[data-testid="flow-print-inspector"]')).toBeNull();
    expect(text).toBe("");
  });
});
