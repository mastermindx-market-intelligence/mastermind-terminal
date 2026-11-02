import type { BrowserContext } from "@playwright/test";
import { ResearchStore, fixtureRevisionIdentity } from "./optionsR1Research";

// Options R1 W3C — the alerts owner as an in-memory store behind /api/alerts (GET/POST/PATCH)
// and /api/alerts/receipts, so a watch armed in one context fires by fixture and reads back
// fired-and-disarmed in another. Rows carry condition.evidence exactly as the real owner
// stores it: the route passes unknown condition keys through unchanged.
export const INVESTIGATION_ID = "00000000-0000-4000-8000-00000000a11c";
export const FIRE_EVENT_ID = "b".repeat(64);
export const FIRED_AT = "2026-10-21T15:40:03Z";

export type AlertRow = { id: string; symbol: string; active: boolean; created_at: string; condition: Record<string, unknown> };

export class WatchStore {
  alerts: AlertRow[] = [];
  outbox: Array<Record<string, unknown>> = [];
  arm(symbol: string, condition: Record<string, unknown>): AlertRow {
    const row: AlertRow = { id: `alert-${this.alerts.length + 1}`, symbol, active: true, created_at: "2026-10-21T15:30:00Z", condition };
    this.alerts.push(row);
    return row;
  }
  /** The engine's one-shot behaviour: fire once, stamp condition.triggered, disarm, mint one receipt. */
  fireFixture() {
    const row = this.alerts.find(alert => alert.active);
    if (!row) return;
    row.active = false;
    row.condition.triggered = { at: FIRED_AT, value: 230.12, note: "price 230.12 above 230 (hub)" };
    this.outbox.push({
      alert_id: row.id, fire_event_id: FIRE_EVENT_ID, status: "sent", attempts: 1, last_error: null,
      deliver_after: null, delivered_at: "2026-10-21T15:40:04Z", created_at: "2026-10-21T15:40:04Z",
      payload: { fired_at: FIRED_AT, condition_plain: "Last price above 230.00", source_asof: "2026-10-21T16:30:04Z" },
    });
  }
}

export const WATCH_MANIFEST = {
  schema: "investigation_manifest.v2",
  intent: { title: "NVDA · 230 wall", question: "Did NVDA reach the 230 wall before the rotation faded?",
    subjects: [{ kind: "security", owner: "terminal.analysis_symbol", object_id: "NVDA" }] },
  layout_refs: [], thesis_refs: [], evidence_refs: [], continuation: {},
};

/** Seed the research store with the saved question the watch is created from (revision 1). */
export function seedInvestigation(store: ResearchStore) {
  const saved = { id: INVESTIGATION_ID, revision: 1, revision_id:"50000000-0000-4000-8000-000000000001", lifecycle: "active" as const, manifest: WATCH_MANIFEST, committed_at: "2026-10-21T14:02:00Z", layouts: [] as never[] };
  store.records.set(INVESTIGATION_ID, [{ ...saved, ...fixtureRevisionIdentity(saved, "60000000-0000-4000-8000-000000000001", null) }]);
}

export async function routeWatch(context: BrowserContext, store: WatchStore, access: "granted" | "plan" = "granted") {
  await context.route("**/api/alerts**", route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.endsWith("/api/alerts/receipts")) {
      return route.fulfill({ json: { run: null, runs_state: "READ_UNAVAILABLE", last_success_at: null, outbox: store.outbox, outbox_state: "READ_OK" } });
    }
    if (request.method() === "GET") {
      if (access === "plan") return route.fulfill({ json: { alerts: store.alerts } });
      return route.fulfill({ json: { alerts: store.alerts } });
    }
    if (request.method() === "POST") {
      if (access === "plan") return route.fulfill({ status: 403, json: { error: "This price alert is included with a paid plan — upgrade to unlock." } });
      const body = request.postDataJSON() as { symbol?: string; condition?: Record<string, unknown> };
      const row = store.arm(body.symbol ?? "", body.condition ?? {});
      return route.fulfill({ json: { alert: row } });
    }
    if (request.method() === "PATCH") {
      const body = request.postDataJSON() as { id?: string };
      const row = store.alerts.find(alert => alert.id === body.id);
      if (!row) return route.fulfill({ status: 404, json: { error: "not found" } });
      row.active = true;
      delete row.condition.triggered;
      return route.fulfill({ json: { alert: row } });
    }
    return route.fulfill({ status: 400, json: { error: "bad request" } });
  });
}
