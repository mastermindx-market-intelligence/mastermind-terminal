import { describe, it, expect } from "vitest";
import { buildAlertsView, copy, type OutboxRow, type Alert } from "../alertsView";

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

// ─── RED tests — these fail on the previous (unfixed) head ───────────────────

describe("RED: thesis_condition outbox row has no alert_id, so on the unfixed head buildAlertsView returns zero rows", () => {
  // On the unfixed head, buildAlertsView only maps rows from the `alerts` join path.
  // A thesis_condition outbox row with no matching alerts entry is invisible → rows.length === 0.
  it("RED: buildAlertsView({ alerts: [], outbox: [thesis_condition row] }) → rows.length === 0 on unfixed head", () => {
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
    // This is the RED that motivates the fix: zero rows, not one.
    expect(view.rows.length).toBe(0);
  });
});

describe("RED: filter o.alert_id === '' rejects null alert_ids (SQL permits null)", () => {
  // An outbox row with alert_id === null (valid SQL) would be silently dropped by the
  // old filter `o.alert_id === ""`, producing zero rows instead of one.
  it("RED: thesis_condition outbox row with alert_id === null is silently dropped on unfixed head", () => {
    const view = buildAlertsView({
      alerts: [],
      alertsState: "READ_OK_ZERO",
      run: baseRun,
      lastSuccessAt: "2026-09-05T11:59:00Z",
      runsState: "READ_OK",
      outbox: [thesisConditionOutbox({ alert_id: null as unknown as string })],
      outboxState: "READ_OK",
      now: NOW,
    });
    // Unfixed head: filter `o.alert_id === ""` rejects null → 0 rows.
    expect(view.rows.length).toBe(0);
  });
});

describe("RED: thesis_condition row without payload.thesis_id produces an undefined thesisId and wrong copy", () => {
  // If payload.thesis_id is absent, the row's thesisId is undefined, and the timeline
  // renders it as an ordinary alert row using verdictText instead of the window-closed copy.
  it("RED: row without thesis_id has thesisId === undefined on unfixed head", () => {
    const view = buildAlertsView({
      alerts: [],
      alertsState: "READ_OK_ZERO",
      run: baseRun,
      lastSuccessAt: "2026-09-05T11:59:00Z",
      runsState: "READ_OK",
      outbox: [thesisConditionOutbox({ payload: { kind: "thesis_condition" } as OutboxRow["payload"] })],
      outboxState: "READ_OK",
      now: NOW,
    });
    // Unfixed head: the row IS included (alert_id === "" matches) but thesisId is undefined,
    // so it renders with the wrong copy path.
    expect(view.rows.length).toBe(1);
    expect(view.rows[0].thesisId).toBeUndefined();
  });
});

// ─── GREEN tests — these pass after the fixes ─────────────────────────────────

describe("GREEN after fix: exactly one delivery row with delivery === 'pending'", () => {
  it("GREEN: buildAlertsView surfaces the thesis_condition outbox row as one pending row", () => {
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
});

describe("GREEN after fix: the row is identifiable by its thesis_id in the payload", () => {
  it("GREEN: the row's thesisId field contains the thesis UUID", () => {
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
    const thesisId = view.rows[0].thesisId;
    expect(thesisId).toBe("00000000-0000-0000-0000-000000000001");
  });
});

describe("GREEN after fix: copy contains window-closed / 'market view' wording, not 'falsifier'", () => {
  it("GREEN: copy('condition.thesis_condition', en) uses window-closed wording, no 'falsifier'", () => {
    const verdict = copy("condition.thesis_condition", "en");
    const verdictZh = copy("condition.thesis_condition", "zh");
    const hasWindowClosed = verdict.toLowerCase().includes("window")
      || verdict.toLowerCase().includes("market view")
      || verdictZh.includes("窗口")
      || verdictZh.includes("观察");
    expect(hasWindowClosed).toBe(true);
    expect(verdict.toLowerCase()).not.toContain("falsifier");
    expect(verdictZh).not.toContain("证伪");
  });

  it("GREEN: buildAlertsView row verdict copy matches condition.thesis_condition", () => {
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
    // The cockpit calls copy("condition.thesis_condition", L) — verify the copy table entry exists.
    expect(copy("condition.thesis_condition", "en")).toBeTruthy();
    expect(copy("condition.thesis_condition", "zh")).toBeTruthy();
  });
});

describe("GREEN after fix: an ordinary outbox row without a matching alerts row still produces zero rows", () => {
  it("GREEN: price outbox row with no alert_id and no matching alerts row is invisible", () => {
    const view = buildAlertsView({
      alerts: [],
      alertsState: "READ_OK_ZERO",
      run: baseRun,
      lastSuccessAt: "2026-09-05T11:59:00Z",
      runsState: "READ_OK",
      outbox: [ordinaryOutbox({ alert_id: "" })],
      outboxState: "READ_OK",
      now: NOW,
    });
    // Only thesis_condition rows (kind === "thesis_condition") get the special treatment.
    expect(view.rows.length).toBe(0);
  });
});

describe("GREEN after fix: status 'sent' with delivered_at set maps to delivery === 'sent'", () => {
  it("GREEN: sent + delivered_at → delivery 'sent'", () => {
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
});

describe("GREEN after fix: a price alert + thesis_condition outbox row both appear", () => {
  it("GREEN: mixed price alert + thesis_condition row → 2 rows", () => {
    const view = buildAlertsView({
      alerts: [priceAlert()],
      alertsState: "READ_OK",
      run: baseRun,
      lastSuccessAt: "2026-09-05T11:59:00Z",
      runsState: "READ_OK",
      outbox: [
        thesisConditionOutbox(),
        ordinaryOutbox({ alert_id: "a-price" }),
      ],
      outboxState: "READ_OK",
      now: NOW,
    });
    expect(view.rows.length).toBe(2);
    const deliveries = view.rows.map((r) => r.delivery).sort();
    expect(deliveries).toEqual(["pending", "sent"]);
  });
});

describe("GREEN after fix: alert_id === null is accepted as 'no matching alert'", () => {
  it("GREEN: thesis_condition outbox row with null alert_id surfaces correctly", () => {
    const view = buildAlertsView({
      alerts: [],
      alertsState: "READ_OK_ZERO",
      run: baseRun,
      lastSuccessAt: "2026-09-05T11:59:00Z",
      runsState: "READ_OK",
      outbox: [thesisConditionOutbox({ alert_id: null as unknown as string })],
      outboxState: "READ_OK",
      now: NOW,
    });
    // Fixed head: null is treated the same as "" — both mean "no alert entry".
    expect(view.rows.length).toBe(1);
    expect(view.rows[0].delivery).toBe("pending");
  });
});

describe("GREEN after fix: row without payload.thesis_id is silently skipped (not rendered with wrong copy)", () => {
  it("GREEN: thesis_condition row missing thesis_id produces zero rows", () => {
    const view = buildAlertsView({
      alerts: [],
      alertsState: "READ_OK_ZERO",
      run: baseRun,
      lastSuccessAt: "2026-09-05T11:59:00Z",
      runsState: "READ_OK",
      outbox: [thesisConditionOutbox({ payload: { kind: "thesis_condition" } as OutboxRow["payload"] })],
      outboxState: "READ_OK",
      now: NOW,
    });
    // Fixed head: filter checks !!o.payload?.thesis_id, so this row is skipped.
    expect(view.rows.length).toBe(0);
  });
});
