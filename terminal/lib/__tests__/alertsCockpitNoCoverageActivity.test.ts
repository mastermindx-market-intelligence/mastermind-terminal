// @vitest-environment jsdom
//
// Major (round-5 review of PR #517): the dataState ladder in AlertsCockpit.tsx puts
// "no-coverage" ahead of the zero-rows "calm-empty" fallback — deliberately, per the META-CEO
// ruling, which keeps that ladder unchanged — so an account with >=1 active alert, an
// unevaluable symbol (noCoverageCount > 0), and zero fired rows used to render ONLY
// CouldNotWatch's "What we could not watch today" module: an activity question ("did anything
// happen") that went completely unanswered on the page. RED-first: this test fails against the
// pre-fix component (which renders CouldNotWatch alone in this fixture) and passes only once
// AlertsCockpit also renders the compact "recent-activity" module alongside it.
//
// No @testing-library/react in this repo (vitest.config.ts's `include` is
// lib/__tests__/**/*.test.ts only) — react-dom/client's createRoot + react's act, per the
// BrainWidget/AlertTimeline precedent (brainWidgetRebinding.test.ts, alertTimelineEmptyGuard.test.ts).
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import AlertsCockpit from "@/components/alerts/AlertsCockpit";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Fixture: one ACTIVE alert that has never fired (no `condition.triggered`, empty outbox) — so
// `view.rows` (and therefore `timelineRows`) is empty — a fresh run receipt (monitor "watching",
// never "degraded"/"never_ran"/"unknown", and not the zero-alert "calm-empty" case either) whose
// `unevaluable_n` is 1, so `noCoverageCount > 0` and the ladder lands on "no-coverage".
const ACTIVE_ALERT = {
  id: "a0", symbol: "NVDA", active: true, created_at: "2026-08-01T00:00:00Z",
  condition: { type: "price", op: "above", value: 200 },
};
// `buildAlertsView` is passed `Date.now()` internally by AlertsCockpit (never mockable from
// here), so "fresh" must be computed against real wall-clock time, matching the e2e fixtures'
// own FRESH_RUN precedent (e2e/f08-alerts.spec.ts) — a fixed past timestamp would read as
// "degraded", not "watching".
const NOW_ISO = new Date().toISOString();
const FRESH_RUN = {
  lane: "alerts_engine", run_id: "r1", started_at: NOW_ISO,
  concluded_at: NOW_ISO, outcome: "success", lane_cadence_budget_s: 300,
  unevaluable_n: 1,
};

describe("AlertsCockpit — no-coverage + zero rows must still answer the activity question (round-5 major)", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;
  let realFetch: typeof globalThis.fetch;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.startsWith("/api/alerts/receipts")) {
        return {
          ok: true, status: 200,
          json: async () => ({
            run: FRESH_RUN, runs_state: "READ_OK", last_success_at: FRESH_RUN.concluded_at,
            last_success_state: "READ_OK", outbox: [], outbox_state: "READ_OK_ZERO",
          }),
        } as Response;
      }
      if (url.startsWith("/api/alerts")) {
        return { ok: true, status: 200, json: async () => ({ alerts: [ACTIVE_ALERT] }) } as Response;
      }
      // Every other endpoint (NewAlertPanel's own entitlement/manifest reads, /api/me, ...) is
      // honestly "unavailable" — never a fabricated 200 — matching this codebase's own
      // never-a-fabricated-zero discipline (alertsView.ts header comment).
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }) as typeof globalThis.fetch;
  });

  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    root = undefined;
    container.remove();
    globalThis.fetch = realFetch;
  });

  async function mount() {
    await act(async () => {
      root = createRoot(container);
      root!.render(React.createElement(AlertsCockpit, { email: "test@example.com" }));
    });
    // Flush the two sequential awaited fetches inside AlertsCockpit's own `load()`.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  }

  it("renders both the no-coverage module AND a recent-activity module — never one alone", async () => {
    await mount();
    const noCoverage = container.querySelector('[data-alerts-module="no-coverage"]');
    const activity = container.querySelector('[data-alerts-module="recent-activity"]');
    expect(noCoverage).not.toBeNull();
    expect(activity).not.toBeNull();
    expect(activity?.textContent).toContain("Nothing has fired yet.");
  });

  it("the page-level spine still reads no-coverage (the ladder itself is unchanged)", async () => {
    await mount();
    expect(container.querySelector('[data-cockpit-state="no-coverage"]')).not.toBeNull();
  });
});
