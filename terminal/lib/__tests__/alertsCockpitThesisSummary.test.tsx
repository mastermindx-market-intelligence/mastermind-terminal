// @vitest-environment jsdom
//
// RED-first test for META-CEO B seat B-F11-11b-pre-2: the Alerts cockpit shows the
// thesis-condition producer's own summary (EN summary_plain / ZH summary_plain_zh) on
// thesis rows — one language on screen, fixed sentence as fallback. Verifies:
// - producer summary renders on timeline verdict and detail pane Condition fact
// - no cross-language fallback (EN screen never shows ZH text and vice versa)
// - whitespace-only summary falls back to fixed sentence
//
// Mount pattern copied from alertsCockpitZhParity.test.ts (lines 30-36 / 181-220).
// Fixtures carry the producer's real row identity (#759 F11-11b-pre): payload.source
// "macro.thesis_condition_monitor" + payload.category "thesis_window" and a well-formed
// v4 thesis_id — the recognizer in lib/alertsView.ts keys thesis rows on exactly those.
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import AlertsCockpit from "@/components/alerts/AlertsCockpit";
import AlertsView from "@/components/AlertsView";
import { LangProvider } from "@/lib/i18n";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Well-formed v4 UUIDs (version nibble 4, variant 8/9/a/b) — lib/alertsView.ts isWellFormedThesisId.
const THESIS_ID_1 = "a1b2c3d4-e5f6-4890-abcd-ef1234567890";
const THESIS_ID_2 = "b2c3d4e5-f6a7-4901-bcde-f12345678901";
const NOW_ISO = new Date().toISOString();
const FRESH_RUN = {
  lane: "alerts_engine", run_id: "r1", started_at: NOW_ISO, concluded_at: NOW_ISO,
  outcome: "success", lane_cadence_budget_s: 300,
};

// Thesis outbox row with both EN and ZH producer summaries.
const THESIS_OUTBOX_WITH_SUMMARY = [{
  alert_id: "", fire_event_id: "f-thesis-1", status: "sent", attempts: 1, last_error: null,
  deliver_after: null, delivered_at: NOW_ISO, created_at: NOW_ISO,
  payload: {
    category: "thesis_window",
    source: "macro.thesis_condition_monitor",
    thesis_id: THESIS_ID_1,
    ticker: "NVDA",
    summary_plain: "Desk summary EN",
    summary_plain_zh: "窗口摘要",
    fired_at: NOW_ISO,
  },
}];

// Thesis outbox row with NO summary keys at all — must fall back to fixed sentence.
const THESIS_OUTBOX_NO_SUMMARY = [{
  alert_id: "", fire_event_id: "f-thesis-2", status: "sent", attempts: 1, last_error: null,
  deliver_after: null, delivered_at: NOW_ISO, created_at: NOW_ISO,
  payload: {
    category: "thesis_window",
    source: "macro.thesis_condition_monitor",
    thesis_id: THESIS_ID_2,
    ticker: "NVDA",
    fired_at: NOW_ISO,
  },
}];

// Thesis outbox row with whitespace-only summary_plain — must fall back to fixed sentence.
const THESIS_OUTBOX_WHITESPACE_SUMMARY = [{
  alert_id: "", fire_event_id: "f-thesis-3", status: "sent", attempts: 1, last_error: null,
  deliver_after: null, delivered_at: NOW_ISO, created_at: NOW_ISO,
  payload: {
    category: "thesis_window",
    source: "macro.thesis_condition_monitor",
    thesis_id: "c3d4e5f6-a7b8-4012-8def-123456789abc",
    ticker: "NVDA",
    summary_plain: "   ",
    fired_at: NOW_ISO,
  },
}];

// Thesis outbox row with ZH-only summary (no EN) — ZH screen shows it, EN screen falls back.
const THESIS_OUTBOX_ZH_ONLY = [{
  alert_id: "", fire_event_id: "f-thesis-4", status: "sent", attempts: 1, last_error: null,
  deliver_after: null, delivered_at: NOW_ISO, created_at: NOW_ISO,
  payload: {
    category: "thesis_window",
    source: "macro.thesis_condition_monitor",
    thesis_id: "d4e5f6a7-b8c9-4123-9ef0-23456789abcd",
    ticker: "NVDA",
    summary_plain_zh: "仅ZH摘要",
    fired_at: NOW_ISO,
  },
}];

// Thesis outbox row with summary_plain_zh carrying the upstream translation-pending marker
// (macro producer ruling MINOR-2) — renders verbatim on ZH screen, no EN sentence substituted.
const THESIS_OUTBOX_PENDING_MARKER = [{
  alert_id: "", fire_event_id: "f-thesis-5", status: "sent", attempts: 1, last_error: null,
  deliver_after: null, delivered_at: NOW_ISO, created_at: NOW_ISO,
  payload: {
    category: "thesis_window",
    source: "macro.thesis_condition_monitor",
    thesis_id: "e5f6a7b8-c9d0-4234-af01-3456789abcde",
    ticker: "NVDA",
    summary_plain: "A window we watch for NVDA has closed. Your thesis \"AI chip leader\" lists: condition",
    summary_plain_zh: "A window we watch for NVDA has closed. Your thesis \"AI芯片龙头\" lists: condition（翻译待补）",
    fired_at: NOW_ISO,
  },
}];

// Mixed: one with summary, one without.
const THESIS_OUTBOX_MIXED = [THESIS_OUTBOX_WITH_SUMMARY[0], THESIS_OUTBOX_NO_SUMMARY[0]];

describe("AlertsCockpit — thesis row producer summary (B-F11-11b-pre-2)", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;
  let realFetch: typeof globalThis.fetch;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    realFetch = globalThis.fetch;
  });

  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    root = undefined;
    container.remove();
    document.documentElement.removeAttribute("data-lang");
    globalThis.fetch = realFetch;
  });

  function mockFetch(outbox: unknown[]) {
    globalThis.fetch = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.startsWith("/api/alerts/receipts")) {
        return {
          ok: true, status: 200,
          json: async () => ({
            run: FRESH_RUN, runs_state: "READ_OK", last_success_at: FRESH_RUN.concluded_at,
            last_success_state: "READ_OK", outbox, outbox_state: "READ_OK",
          }),
        } as Response;
      }
      if (url.startsWith("/api/alerts")) {
        return { ok: true, status: 200, json: async () => ({ alerts: [] }) } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }) as typeof globalThis.fetch;
  }

  async function mount(lang: "en" | "zh") {
    document.documentElement.setAttribute("data-lang", lang);
    const child = React.createElement(AlertsView, { email: "test@example.com", listOnly: true });
    await act(async () => {
      root = createRoot(container);
      root!.render(React.createElement(
        LangProvider,
        null,
        React.createElement(AlertsCockpit, { email: "test@example.com" }, child),
      ));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  function timelineRows(): Element[] {
    return Array.from(container.querySelectorAll('[data-delivery="sent"]'));
  }

  function openDetail(row: Element) {
    return act(async () => {
      row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  // ── EN screen ─────────────────────────────────────────────────────────────

  it("RED-first EN: first thesis row with summary_plain shows 'Desk summary EN'; second row (no key) falls back to fixed sentence", async () => {
    mockFetch(THESIS_OUTBOX_MIXED);
    await mount("en");

    const rows = timelineRows();
    expect(rows.length, "expected two thesis timeline rows").toBe(2);

    // First row: producer EN summary.
    expect(rows[0].textContent ?? "", "first row verdict should be the EN producer summary").toContain("Desk summary EN");
    expect(rows[0].textContent ?? "", "first row must not contain ZH text").not.toContain("窗口摘要");

    // Second row: fixed sentence fallback.
    expect(rows[1].textContent ?? "", "second row (no summary key) should show fixed sentence").toContain("The window you were watching has closed");
  });

  it("RED-first EN: clicking first thesis row opens detail with Condition fact = 'Desk summary EN'", async () => {
    mockFetch(THESIS_OUTBOX_MIXED);
    await mount("en");

    const rows = timelineRows();
    await openDetail(rows[0]);

    const dialog = container.querySelector('[data-cockpit-state="drillback"]');
    expect(dialog, "expected drillback dialog to open").not.toBeNull();
    const leafWithText = (text: string) =>
      Array.from(dialog!.querySelectorAll("*")).find((el) => el.textContent === text && el.children.length === 0);
    const conditionLabel = leafWithText("Condition");
    expect(conditionLabel, 'expected "Condition" label in EN drillback').not.toBeUndefined();
    const conditionValue = conditionLabel!.nextElementSibling?.textContent ?? "";
    expect(conditionValue, "detail Condition fact should be the producer EN summary").toBe("Desk summary EN");
  });

  it("RED-first EN: whitespace-only summary_plain falls back to fixed sentence", async () => {
    mockFetch(THESIS_OUTBOX_WHITESPACE_SUMMARY);
    await mount("en");

    const rows = timelineRows();
    expect(rows.length).toBe(1);
    expect(rows[0].textContent ?? "").toContain("The window you were watching has closed");
    expect(rows[0].textContent ?? "").not.toContain("Desk summary EN");
  });

  it("RED-first EN: summary_plain_zh is NOT rendered on EN screen (no cross-language fallback)", async () => {
    mockFetch(THESIS_OUTBOX_ZH_ONLY);
    await mount("en");

    const rows = timelineRows();
    expect(rows.length).toBe(1);
    // EN screen must fall back to fixed sentence, never show the ZH-only summary.
    expect(rows[0].textContent ?? "").toContain("The window you were watching has closed");
    expect(rows[0].textContent ?? "").not.toContain("仅ZH摘要");
  });

  // ── ZH screen ─────────────────────────────────────────────────────────────

  it("RED-first ZH: first thesis row with summary_plain_zh shows exactly '窗口摘要'; no EN text leaked", async () => {
    mockFetch(THESIS_OUTBOX_MIXED);
    await mount("zh");

    const rows = timelineRows();
    expect(rows.length, "expected two thesis timeline rows on ZH screen").toBe(2);

    // First row: producer ZH summary.
    expect(rows[0].textContent ?? "", "ZH row should show the producer ZH summary").toContain("窗口摘要");
    expect(rows[0].textContent ?? "", "ZH row must not contain EN text").not.toContain("Desk summary EN");

    // Second row: fixed sentence fallback in ZH.
    expect(rows[1].textContent ?? "", "ZH second row (no key) should show ZH fixed sentence").toContain("你关注的观察窗口已结束");
  });

  it("RED-first ZH: clicking first thesis row opens detail with Condition fact = '窗口摘要'", async () => {
    mockFetch(THESIS_OUTBOX_MIXED);
    await mount("zh");

    const rows = timelineRows();
    await openDetail(rows[0]);

    const dialog = container.querySelector('[data-cockpit-state="drillback"]');
    expect(dialog, "expected drillback dialog to open on ZH screen").not.toBeNull();
    const leafWithText = (text: string) =>
      Array.from(dialog!.querySelectorAll("*")).find((el) => el.textContent === text && el.children.length === 0);
    const conditionLabel = leafWithText("条件");
    expect(conditionLabel, 'expected "条件" label in ZH drillback').not.toBeUndefined();
    const conditionValue = conditionLabel!.nextElementSibling?.textContent ?? "";
    expect(conditionValue, "ZH detail Condition fact should be the producer ZH summary").toBe("窗口摘要");
  });

  it("RED-first ZH: EN-only summary (no ZH key) falls back to ZH fixed sentence", async () => {
    mockFetch([{
      alert_id: "", fire_event_id: "f-thesis-enonly", status: "sent", attempts: 1, last_error: null,
      deliver_after: null, delivered_at: NOW_ISO, created_at: NOW_ISO,
      payload: {
        category: "thesis_window",
        source: "macro.thesis_condition_monitor",
        thesis_id: "f6a7b8c9-d0e1-4345-b012-456789abcdef",
        ticker: "NVDA",
        summary_plain: "EN only summary here",
        fired_at: NOW_ISO,
      },
    }]);
    await mount("zh");

    const rows = timelineRows();
    expect(rows.length).toBe(1);
    expect(rows[0].textContent ?? "", "ZH screen with EN-only summary must fall back to ZH fixed sentence").toContain("你关注的观察窗口已结束");
    expect(rows[0].textContent ?? "", "ZH screen must not show EN-only summary").not.toContain("EN only summary here");
  });

  it("RED-first ZH: translation-pending marker in summary_plain_zh triggers fallback to fixed sentence (macro MINOR-2); ZH users never see internal markers", async () => {
    mockFetch(THESIS_OUTBOX_PENDING_MARKER);
    await mount("zh");

    const rows = timelineRows();
    expect(rows.length).toBe(1);
    // When summary_plain_zh carries the translation-pending marker the ZH screen falls back
    // to the fixed sentence — internal upstream markers must not surface to users.
    expect(rows[0].textContent ?? "", "ZH row with pending marker must fall back to fixed sentence").toContain("你关注的观察窗口已结束");
    expect(rows[0].textContent ?? "", "ZH row must not surface the pending marker to users").not.toContain("（翻译待补）");
  });
});
