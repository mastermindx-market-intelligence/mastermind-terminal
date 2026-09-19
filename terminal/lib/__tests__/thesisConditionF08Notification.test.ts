import { describe, it, expect } from "vitest";
import { buildAlertsView, copy, verdictText, ALERTS_COPY, type OutboxRow, type Alert } from "../alertsView";

const NOW = Date.parse("2026-09-05T12:00:00Z");

const baseRun = {
  lane: "alerts_engine", run_id: "r1", started_at: "2026-09-05T11:58:00Z",
  concluded_at: "2026-09-05T11:59:00Z", outcome: "success" as const,
  evaluated_n: 6, fired_n: 0, unevaluable_n: 0, source_asof: null,
  lane_cadence_budget_s: 300, error_class: null,
};

function thesisConditionOutbox(over: Partial<OutboxRow> = {}): OutboxRow {
  return {
    alert_id: "", // thesis_condition outbox rows have no alert_id
    fire_event_id: "fe-thesis-1",
    status: "pending",
    attempts: 0,
    last_error: null,
    deliver_after: null,
    delivered_at: null,
    created_at: "2026-09-05T11:59:30Z",
    payload: {
      thesis_id: "00000000-0000-0000-0000-000000000001",
      kind: "thesis_condition",
    },
    ...over,
  };
}

function ordinaryOutbox(over: Partial<OutboxRow> = {}): OutboxRow {
  return {
    alert_id: "a-price",
    fire_event_id: "fe-price-1",
    status: "sent",
    attempts: 1,
    last_error: null,
    deliver_after: null,
    delivered_at: "2026-09-05T11:59:30Z",
    created_at: "2026-09-05T11:59:30Z",
    payload: {
      ticker: "NVDA",
      condition_plain: "Crossed your price line",
    },
    ...over,
  };
}

function priceAlert(over: Partial<Alert> = {}): Alert {
  return {
    id: "a-price",
    active: false,
    symbol: "NVDA",
    created_at: "2026-09-01T00:00:00Z",
    condition: {
      type: "price",
      triggered: { at: "2026-09-05T11:58:30Z", value: 42, note: "crossed" },
    },
    ...over,
  };
}

describe("thesis_condition outbox rows surface without a matching alerts row", () => {

  it("GREEN after fix: exactly one delivery row with delivery === 'pending'", () => {
    const view = buildAlertsView({
      alerts: [],
      alertsState: "READ_OK_ZERO",
      run: baseRun,
      lastSuccessAt: "2026-09-05T11:59:00Z",
      runsState: "READ_OK",
      outbox: [thesisConditionOutbox()],
      outboxState: "READ_OK",
      now: NOW,
    });
    expect(view.rows.length).toBe(1);
    expect(view.rows[0].delivery).toBe("pending");
  });

  it("GREEN after fix: the row is identifiable by its thesis_id in the payload", () => {
    const outboxRow = thesisConditionOutbox();
    const view = buildAlertsView({
      alerts: [],
      alertsState: "READ_OK_ZERO",
      run: baseRun,
      lastSuccessAt: "2026-09-05T11:59:00Z",
      runsState: "READ_OK",
      outbox: [outboxRow],
      outboxState: "READ_OK",
      now: NOW,
    });
    expect(view.rows.length).toBe(1);
    const thesisId = view.rows[0].outboxRow?.payload?.thesis_id;
    expect(thesisId).toBe("00000000-0000-0000-0000-000000000001");
  });

  it("GREEN after fix: copy contains window-closed / 'market view' wording, not 'falsifier'", () => {
    const outboxRow = thesisConditionOutbox();
    const view = buildAlertsView({
      alerts: [],
      alertsState: "READ_OK_ZERO",
      run: baseRun,
      lastSuccessAt: "2026-09-05T11:59:00Z",
      runsState: "READ_OK",
      outbox: [outboxRow],
      outboxState: "READ_OK",
      now: NOW,
    });
    expect(view.rows.length).toBe(1);
    // The cockpit calls copy("condition.thesis_condition", L) for thesis rows — check that copy.
    const verdict = copy("condition.thesis_condition", "en");
    const verdictZh = copy("condition.thesis_condition", "zh");
    // Must contain window-closed / market-view wording, must NOT contain "falsifier"
    const hasWindowClosed = verdict.toLowerCase().includes("window")
      || verdict.toLowerCase().includes("market view")
      || verdictZh.includes("窗口")
      || verdictZh.includes("观察");
    expect(hasWindowClosed).toBe(true);
    expect(verdict.toLowerCase()).not.toContain("falsifier");
    expect(verdictZh).not.toContain("证伪");
  });

  it("GREEN after fix: an ordinary outbox row without a matching alerts row still produces zero rows", () => {
    // A price-fire outbox row with no alerts row should NOT appear — only thesis_condition
    // outbox rows (which have no corresponding alerts entry) get this special treatment.
    const view = buildAlertsView({
      alerts: [],
      alertsState: "READ_OK_ZERO",
      run: baseRun,
      lastSuccessAt: "2026-09-05T11:59:00Z",
      runsState: "READ_OK",
      outbox: [ordinaryOutbox()],
      outboxState: "READ_OK",
      now: NOW,
    });
    expect(view.rows.length).toBe(0);
  });

  it("GREEN after fix: status 'sent' with delivered_at set maps to delivery === 'sent'", () => {
    const view = buildAlertsView({
      alerts: [],
      alertsState: "READ_OK_ZERO",
      run: baseRun,
      lastSuccessAt: "2026-09-05T11:59:00Z",
      runsState: "READ_OK",
      outbox: [thesisConditionOutbox({ status: "sent", delivered_at: "2026-09-05T12:00:00Z" })],
      outboxState: "READ_OK",
      now: NOW,
    });
    expect(view.rows.length).toBe(1);
    expect(view.rows[0].delivery).toBe("sent");
  });

  it("GREEN after fix: a price alert + thesis_condition outbox row both appear", () => {
    const thesisOutbox = thesisConditionOutbox();
    const view = buildAlertsView({
      alerts: [priceAlert()],
      alertsState: "READ_OK",
      run: baseRun,
      lastSuccessAt: "2026-09-05T11:59:00Z",
      runsState: "READ_OK",
      outbox: [
        thesisOutbox,
        ordinaryOutbox({ alert_id: "a-price" }),
      ],
      outboxState: "READ_OK",
      now: NOW,
    });
    // One price alert row + one thesis_condition row = 2 rows
    expect(view.rows.length).toBe(2);
    const deliveries = view.rows.map((r) => r.delivery).sort();
    expect(deliveries).toEqual(["pending", "sent"]);
  });
});
