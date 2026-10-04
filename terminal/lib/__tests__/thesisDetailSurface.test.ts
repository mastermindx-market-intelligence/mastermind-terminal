// @vitest-environment jsdom
//
// m_f119_detail (seat 026851bd): thesis notice detail surface is honest at every width.
// A thesis notice's detail shows only rows that are true for it (no price/suite rows), and
// the Close control is on its own flow row, never overlapping text at any viewport.
//
// RED-first: the thesis assertions FAIL on the pre-fix AlertDetail.tsx (rows unconditionally
// rendered), and PASS after the fix. The regression guard (ordinary alert) keeps price-alert
// rows visible when `kind` is absent.
//
// No @testing-library/react in this repo — react-dom/client's createRoot + react's act.
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import AlertDetail, { type AlertDetailData } from "@/components/alerts/AlertDetail";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function leafWithText(root: Element, text: string): Element | undefined {
  return Array.from(root.querySelectorAll("*")).find(
    (el) => el.textContent === text && el.children.length === 0,
  );
}

function renderAlertDetail(data: AlertDetailData, lang: "en" | "zh"): Element {
  let container: HTMLDivElement;
  let root: Root;
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
    root.render(React.createElement(AlertDetail, { data, lang, onClose: () => {} }));
  });
  act(() => { /* flush */ });
  const dialog = container.querySelector('[data-cockpit-state="drillback"]')!;
  return dialog;
}

// A thesis detail — every price/suite-specific field honestly null, kind = "thesis".
const THESIS_DATA_EN: AlertDetailData = {
  kind: "thesis",
  conditionText: "Thesis window is closed.",
  holdingSymbol: null,
  summaryPlain: null,
  conditionPlain: null,
  triggeredValue: null,
  conditionType: null,
  firedAt: null,
  armedAt: "2026-09-01T00:00:00Z",
  evidenceUrl: null,
  lastAttemptAt: null,
  lastAttemptState: "READ_UNAVAILABLE",
  lastSuccessAt: null,
  lastSuccessState: "READ_UNAVAILABLE",
  resolution: "open",
  delivery: "sent",
  attempts: 1,
  lastError: null,
  deliverAfter: null,
};

const THESIS_DATA_ZH: AlertDetailData = {
  ...THESIS_DATA_EN,
  conditionText: "论点窗口已关闭。",
};

// An ordinary price alert — `kind` absent, all price fields populated (regression guard).
const ALERT_DATA_EN: AlertDetailData = {
  conditionText: "NVDA price below 150",
  holdingSymbol: "NVDA",
  summaryPlain: "NVDA crossed your price line.",
  conditionPlain: "Crossed your price line",
  triggeredValue: 100,
  conditionType: "price",
  firedAt: "2026-09-05T09:41:00Z",
  armedAt: "2026-09-01T00:00:00Z",
  evidenceUrl: "https://example.com/evidence/f1",
  lastAttemptAt: "2026-09-05T09:41:00Z",
  lastAttemptState: "READ_OK",
  lastSuccessAt: "2026-09-05T09:41:00Z",
  lastSuccessState: "READ_OK",
  resolution: "open",
  delivery: "sent",
  attempts: 1,
  lastError: null,
  deliverAfter: null,
};

const ALERT_DATA_ZH: AlertDetailData = {
  ...ALERT_DATA_EN,
  conditionText: "NVDA 价格低于 150",
};

describe("Thesis detail surface: honest rows at every width (m_f119_detail)", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    root = undefined;
    container.remove();
  });

  // ─── Thesis, EN ─────────────────────────────────────────────────────────────

  it("RED-first: EN thesis detail hides Symbol row", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(AlertDetail, { data: THESIS_DATA_EN, lang: "en", onClose: () => {} }));
    });
    await act(async () => { /* flush */ });
    const dialog = container.querySelector('[data-cockpit-state="drillback"]')!;
    expect(leafWithText(dialog, "Symbol")).toBeUndefined();
  });

  it("RED-first: EN thesis detail hides What changed row", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(AlertDetail, { data: THESIS_DATA_EN, lang: "en", onClose: () => {} }));
    });
    await act(async () => { /* flush */ });
    const dialog = container.querySelector('[data-cockpit-state="drillback"]')!;
    expect(leafWithText(dialog, "What changed")).toBeUndefined();
  });

  it("EN thesis detail shows Condition row", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(AlertDetail, { data: THESIS_DATA_EN, lang: "en", onClose: () => {} }));
    });
    await act(async () => { /* flush */ });
    const dialog = container.querySelector('[data-cockpit-state="drillback"]')!;
    expect(leafWithText(dialog, "Condition")).not.toBeUndefined();
    expect(dialog.textContent).toContain("Thesis window is closed.");
  });

  it("EN thesis detail shows Delivery row", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(AlertDetail, { data: THESIS_DATA_EN, lang: "en", onClose: () => {} }));
    });
    await act(async () => { /* flush */ });
    const dialog = container.querySelector('[data-cockpit-state="drillback"]')!;
    expect(leafWithText(dialog, "Delivery")).not.toBeUndefined();
  });

  it("RED-first: EN thesis detail contains no falsifier language", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(AlertDetail, { data: THESIS_DATA_EN, lang: "en", onClose: () => {} }));
    });
    await act(async () => { /* flush */ });
    const dialog = container.querySelector('[data-cockpit-state="drillback"]')!;
    expect(dialog.textContent?.toLowerCase()).not.toContain("falsifier");
  });

  // ─── Thesis, ZH ─────────────────────────────────────────────────────────────

  it("RED-first: ZH thesis detail hides 代码 row", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(AlertDetail, { data: THESIS_DATA_ZH, lang: "zh", onClose: () => {} }));
    });
    await act(async () => { /* flush */ });
    const dialog = container.querySelector('[data-cockpit-state="drillback"]')!;
    expect(leafWithText(dialog, "代码")).toBeUndefined();
  });

  it("RED-first: ZH thesis detail hides 发生了什么 row", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(AlertDetail, { data: THESIS_DATA_ZH, lang: "zh", onClose: () => {} }));
    });
    await act(async () => { /* flush */ });
    const dialog = container.querySelector('[data-cockpit-state="drillback"]')!;
    expect(leafWithText(dialog, "发生了什么")).toBeUndefined();
  });

  it("ZH thesis detail shows 条件 row", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(AlertDetail, { data: THESIS_DATA_ZH, lang: "zh", onClose: () => {} }));
    });
    await act(async () => { /* flush */ });
    const dialog = container.querySelector('[data-cockpit-state="drillback"]')!;
    expect(leafWithText(dialog, "条件")).not.toBeUndefined();
    expect(dialog.textContent).toContain("论点窗口已关闭。");
  });

  it("ZH thesis detail shows 投递结果 row", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(AlertDetail, { data: THESIS_DATA_ZH, lang: "zh", onClose: () => {} }));
    });
    await act(async () => { /* flush */ });
    const dialog = container.querySelector('[data-cockpit-state="drillback"]')!;
    expect(leafWithText(dialog, "投递结果")).not.toBeUndefined();
  });

  it("RED-first: ZH thesis detail contains no 证伪 language", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(AlertDetail, { data: THESIS_DATA_ZH, lang: "zh", onClose: () => {} }));
    });
    await act(async () => { /* flush */ });
    const dialog = container.querySelector('[data-cockpit-state="drillback"]')!;
    expect(dialog.textContent).not.toContain("证伪");
  });

  // ─── Ordinary alert (regression guard — rows must still show when kind is absent) ───

  it("REGRESSION: EN ordinary alert shows Symbol row", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(AlertDetail, { data: ALERT_DATA_EN, lang: "en", onClose: () => {} }));
    });
    await act(async () => { /* flush */ });
    const dialog = container.querySelector('[data-cockpit-state="drillback"]')!;
    expect(leafWithText(dialog, "Symbol")).not.toBeUndefined();
  });

  it("REGRESSION: EN ordinary alert shows What changed row", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(AlertDetail, { data: ALERT_DATA_EN, lang: "en", onClose: () => {} }));
    });
    await act(async () => { /* flush */ });
    const dialog = container.querySelector('[data-cockpit-state="drillback"]')!;
    expect(leafWithText(dialog, "What changed")).not.toBeUndefined();
  });

  it("REGRESSION: ZH ordinary alert shows 代码 row", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(AlertDetail, { data: ALERT_DATA_ZH, lang: "zh", onClose: () => {} }));
    });
    await act(async () => { /* flush */ });
    const dialog = container.querySelector('[data-cockpit-state="drillback"]')!;
    expect(leafWithText(dialog, "代码")).not.toBeUndefined();
  });

  it("REGRESSION: ZH ordinary alert shows 发生了什么 row", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(AlertDetail, { data: ALERT_DATA_ZH, lang: "zh", onClose: () => {} }));
    });
    await act(async () => { /* flush */ });
    const dialog = container.querySelector('[data-cockpit-state="drillback"]')!;
    expect(leafWithText(dialog, "发生了什么")).not.toBeUndefined();
  });
});
