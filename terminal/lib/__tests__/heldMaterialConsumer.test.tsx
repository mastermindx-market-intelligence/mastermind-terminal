// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, it, expect, vi } from "vitest";
import { buildAlertsView, type OutboxRow } from "../alertsView";
import AlertsCockpit from "../../components/alerts/AlertsCockpit";
import { LangProvider } from "../i18n";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const now = new Date().toISOString();
const row: OutboxRow = { alert_id: null, fire_event_id: "held:" + "a".repeat(64), status: "pending", attempts: 0, last_error: null, deliver_after: null, delivered_at: null, created_at: now, payload: { source: "terminal.held_material_event.v1", category: "holdings_material_change", authority: "notification_only", event_id: "evt_cik0000794170_2026q3_results", ticker: "TOL", summary_plain: "New company results are available.", summary_plain_zh: "公司发布了新业绩。", fired_at: now, event_time: now, recorded_at: now, evidence_url: "https://example.invalid/evidence" } };
const base = { alerts: [], alertsState: "READ_OK_ZERO" as const, run: null, runsState: "READ_OK_ZERO" as const, lastSuccessAt: null, outboxState: "READ_OK" as const, now: Date.now() };
it("surfaces nullable implicit receipts, folds replay rows and rejects unknown producers", () => {
  const view = buildAlertsView({ ...base, outbox: [row, row, { ...row, fire_event_id: "unknown", payload: { ...row.payload, source: "unknown" } }] });
  expect(view.rows).toHaveLength(1); expect(view.rows[0].heldEventId).toBe(row.payload.event_id); expect(view.rows[0].foldedRows).toBe(1);
});
describe.each(["en", "zh"] as const)("held result receipt in existing %s timeline/detail", lang => {
  it("opens without an alerts row and shows native source/recorded clocks, no invented price", async () => {
    const container = document.createElement("div"); document.body.appendChild(container);
    document.documentElement.setAttribute("data-lang", lang);
    const run = { lane: "suite_alerts", run_id: "run", started_at: now, concluded_at: now, outcome: "success", source_asof: now, lane_cadence_budget_s: 300, evaluated_n: 1, fired_n: 1, unevaluable_n: 0 };
    vi.stubGlobal("fetch", vi.fn(async input => new Response(JSON.stringify(String(input).includes("receipts") ? { run, runs_state: "READ_OK", suite_run: run, suite_runs_state: "READ_OK", outbox: [row], outbox_state: "READ_OK" } : { alerts: [] }))));
    const root = createRoot(container);
    try {
      await act(async () => { root.render(<LangProvider><AlertsCockpit email="fixture@example.invalid" /></LangProvider>); });
      expect(container.textContent).toContain(lang === "zh" ? "公司发布了新业绩。" : "New company results are available.");
      const trigger = Array.from(container.querySelectorAll<HTMLElement>('[role="button"]')).find(b => b.textContent?.includes("TOL"));
      expect(trigger).toBeTruthy(); await act(async () => trigger!.click());
      const dialog = container.querySelector('[role="dialog"]'); expect(dialog).toBeTruthy();
      expect(dialog!.textContent).toContain(lang === "zh" ? "来源观察于" : "Source observed");
      expect(dialog!.textContent).not.toMatch(/触发时价格|armed /);
      expect(dialog!.querySelector('a[href="https://example.invalid/evidence"]')).toBeTruthy();
    } finally { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); document.documentElement.removeAttribute("data-lang"); }
  });
});
it("first held-source failure is degraded even with zero explicit alerts and no outbox rows", async () => {
  const container = document.createElement("div"); document.body.appendChild(container);
  const run = { lane: "suite_alerts", run_id: "failure", started_at: now, concluded_at: now, outcome: "partial", source_asof: null, lane_cadence_budget_s: 300, evaluated_n: null, fired_n: null, unevaluable_n: null, error_class: "held_read_unavailable" };
  vi.stubGlobal("fetch", vi.fn(async input => new Response(JSON.stringify(String(input).includes("receipts") ? { run: null, runs_state: "READ_OK_ZERO", suite_run: run, suite_runs_state: "READ_OK", outbox: [], outbox_state: "READ_OK_ZERO" } : { alerts: [] }))));
  const root = createRoot(container);
  try {
    await act(async () => { root.render(<LangProvider><AlertsCockpit email="fixture@example.invalid" /></LangProvider>); });
    expect(container.querySelector("[data-cockpit-state]")?.getAttribute("data-cockpit-state")).toBe("degraded");
  } finally { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); }
});
