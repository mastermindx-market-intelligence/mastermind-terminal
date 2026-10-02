import { describe, it, expect } from "vitest";
import { buildAlertsView, copy, type OutboxRow, type Alert } from "../alertsView";

// RED proof is measured against origin/master's terminal/lib/alertsView.ts bytes
// (see HOW VERIFIED): those bytes do not surface thesis_condition outbox rows and
// do not carry copy("condition.thesis_condition"). This file asserts the DESIRED
// behaviour only. Do not assert the unfixed behaviour here.

const NOW = Date.parse("2026-09-05T12:00:00Z");
const THESIS_ID = "00000000-0000-0000-0000-000000000001";

const baseRun = {
  lane: "alerts_engine", run_id: "r1", started_at: "2026-09-05T11:58:00Z",
  concluded_at: "2026-09-05T11:59:00Z", outcome: "success" as const,
  evaluated_n: 6, fired_n: 0, unevaluable_n: 0, source_asof: null,
  lane_cadence_budget_s: 300, error_class: null,
};

function thesisConditionOutbox(over: Partial<OutboxRow> = {}): OutboxRow {
  return {
    alert_id: "",
    fire_event_id: "fe-thesis-1",
    status: "pending",
    attempts: 0,
    last_error: null,
    deliver_after: null,
    delivered_at: null,
    created_at: "2026-09-05T11:59:30Z",
    payload: {
      thesis_id: THESIS_ID,
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

function viewOf(outbox: OutboxRow[], alerts: Alert[] = []) {
  return buildAlertsView({
    alerts,
    alertsState: alerts.length ? "READ_OK" : "READ_OK_ZERO",
    run: baseRun,
    lastSuccessAt: "2026-09-05T11:59:00Z",
    runsState: "READ_OK",
    outbox,
    outboxState: "READ_OK",
    now: NOW,
  });
}

describe("alert_id null thesis_condition row surfaces as one delivery notice", () => {
  it("exactly one row whose thesisId is the payload thesis_id and whose alertId is thesis:<uuid>", () => {
    const view = viewOf([thesisConditionOutbox({ alert_id: null as unknown as string })]);
    expect(view.rows.length).toBe(1);
    expect(view.rows[0].thesisId).toBe(THESIS_ID);
    expect(view.rows[0].alertId).toBe(`thesis:${THESIS_ID}`);
    expect(view.rows[0].delivery).toBe("pending");
  });
});

describe("thesis_condition row without payload.thesis_id is dropped", () => {
  it("zero rows — never rendered as an ordinary alert", () => {
    const view = viewOf([thesisConditionOutbox({ payload: { kind: "thesis_condition" } })]);
    expect(view.rows.length).toBe(0);
  });
});

describe("one pending row identifiable by thesis id", () => {
  it("empty-string alert_id also surfaces as one pending row keyed by thesis id", () => {
    const view = viewOf([thesisConditionOutbox()]);
    expect(view.rows.length).toBe(1);
    expect(view.rows[0].thesisId).toBe(THESIS_ID);
    expect(view.rows[0].alertId).toBe(`thesis:${THESIS_ID}`);
    expect(view.rows[0].delivery).toBe("pending");
  });
});

describe("copy(condition.thesis_condition) is window-closed wording", () => {
  it("EN and ZH contain the window-closed sentences and not falsifier language", () => {
    const en = copy("condition.thesis_condition", "en");
    const zh = copy("condition.thesis_condition", "zh");
    expect(en).toBe("The window you were watching has closed");
    expect(zh).toBe("你关注的观察窗口已结束");
    expect(en.toLowerCase()).not.toContain("falsifier");
    expect(zh).not.toContain("证伪");
  });
});

describe("ordinary outbox row with no matching alerts row stays invisible", () => {
  it("zero extra rows", () => {
    const view = viewOf([ordinaryOutbox({ alert_id: "" })]);
    expect(view.rows.length).toBe(0);
  });
});

describe("sent thesis_condition with delivered_at maps to delivery sent", () => {
  it("status sent and delivered_at set → delivery === sent", () => {
    const view = viewOf([thesisConditionOutbox({ status: "sent", delivered_at: "2026-09-05T12:00:00Z" })]);
    expect(view.rows.length).toBe(1);
    expect(view.rows[0].delivery).toBe("sent");
  });
});

describe("price alert and thesis_condition outbox row both appear", () => {
  it("mixed → 2 rows", () => {
    const view = viewOf(
      [thesisConditionOutbox(), ordinaryOutbox({ alert_id: "a-price" })],
      [priceAlert()],
    );
    expect(view.rows.length).toBe(2);
    expect(view.rows.map((r) => r.delivery).sort()).toEqual(["pending", "sent"]);
  });
});
