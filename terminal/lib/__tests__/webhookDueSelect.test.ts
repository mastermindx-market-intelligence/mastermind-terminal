import { describe, expect, it } from "vitest";
import { STALE_LEASE_MS } from "@/lib/webhookRetry";
import {
  DUE_PAGE_LIMIT,
  dueDeliveriesPath,
  fetchDueDeliveries,
  type DeliveryRow,
} from "../../../ingest/webhook_delivery";

type Row = DeliveryRow & { created_at: string };

/**
 * The subset of PostgREST the worker's due query actually uses, applied in the
 * server's order: filter, then order, then limit. It refuses any `or=` clause
 * it does not understand rather than quietly ignoring it, so a query that
 * changes shape fails loudly here instead of passing on a stub that filters
 * nothing.
 */
function fakePostgrest(rows: Row[]) {
  return async (path: string): Promise<unknown> => {
    const qs = path.slice(path.indexOf("?") + 1);
    const params = new Map<string, string>();
    for (const part of qs.split("&")) {
      const eq = part.indexOf("=");
      params.set(part.slice(0, eq), part.slice(eq + 1));
    }
    let out = rows.slice();

    const status = params.get("status");
    if (status) {
      const m = /^in\.\(([^)]*)\)$/.exec(status);
      if (!m) throw new Error(`unsupported status filter: ${status}`);
      const allowed = m[1].split(",");
      out = out.filter((r) => allowed.includes(r.status));
    }

    const or = params.get("or");
    if (or) {
      // Nested or: pending/retrying next_retry_at arm AND delivering claimed_at arm.
      if (!or.includes("claimed_at.lte.")) {
        throw new Error(`delivering arm missing claimed_at.lte: ${or}`);
      }
      const retryM = /next_retry_at\.lte\.([^,)]+)/.exec(or);
      const claimedM = /claimed_at\.lte\.([^,)]+)/.exec(or);
      if (!retryM || !claimedM) throw new Error(`unsupported or filter: ${or}`);
      const retryCutoff = Date.parse(decodeURIComponent(retryM[1]));
      const claimedCutoff = Date.parse(decodeURIComponent(claimedM[1]));
      expect(Number.isFinite(retryCutoff)).toBe(true);
      expect(Number.isFinite(claimedCutoff)).toBe(true);
      out = out.filter((r) => {
        if (r.status === "pending" || r.status === "retrying") {
          return r.next_retry_at == null || Date.parse(r.next_retry_at) <= retryCutoff;
        }
        if (r.status === "delivering") {
          return r.claimed_at != null && Date.parse(r.claimed_at) <= claimedCutoff;
        }
        return false;
      });
    }

    if (params.get("order") === "created_at.asc") {
      out = out.slice().sort((a, b) => a.created_at.localeCompare(b.created_at));
    }
    const limit = Number(params.get("limit"));
    return Number.isFinite(limit) ? out.slice(0, limit) : out;
  };
}

const NOW = new Date("2026-09-09T12:00:00.000Z");

function row(over: Partial<Row>): Row {
  return {
    id: "x",
    endpoint_id: "ep-1",
    team_id: "team-1",
    event_id: "e",
    event_type: "webhook.test",
    payload: {},
    attempt: 1,
    status: "retrying",
    claimed_at: null,
    next_retry_at: null,
    created_at: "2026-09-09T00:00:00.000Z",
    ...over,
  };
}

/** 101 rows parked on a 4-hour backoff, all older than the one due row. */
function starvationFixture(): Row[] {
  const notDue: Row[] = [];
  for (let i = 0; i < DUE_PAGE_LIMIT + 1; i++) {
    notDue.push(
      row({
        id: `stale-${i}`,
        status: "retrying",
        // created 101 .. 1 hours before NOW: every one of them is older than
        // the due row, so created_at.asc puts them all ahead of it.
        created_at: new Date(NOW.getTime() - (DUE_PAGE_LIMIT + 1 - i) * 3600_000).toISOString(),
        next_retry_at: new Date(NOW.getTime() + 4 * 3600_000).toISOString(),
      }),
    );
  }
  const due = row({
    id: "due-1",
    status: "pending",
    created_at: new Date(NOW.getTime() - 60_000).toISOString(),
    next_retry_at: null,
  });
  return [...notDue, due];
}

describe("the due-row page carries the spec's next_retry_at predicate server-side", () => {
  it("pins the PostgREST query string byte-for-byte", () => {
    const nowIso = encodeURIComponent(NOW.toISOString());
    const staleIso = encodeURIComponent(new Date(NOW.getTime() - STALE_LEASE_MS).toISOString());
    expect(dueDeliveriesPath(NOW)).toBe(
      "webhook_deliveries?" +
        `or=(and(status.in.(pending,retrying),or(next_retry_at.is.null,next_retry_at.lte.${nowIso})),and(status.eq.delivering,claimed_at.lte.${staleIso}))` +
        `&select=id,endpoint_id,team_id,event_id,event_type,payload,attempt,status,claimed_at,next_retry_at` +
        `&order=created_at.asc&limit=${DUE_PAGE_LIMIT}`,
    );
  });

  it("puts the predicate in the query, not in JS after truncation", () => {
    const path = dueDeliveriesPath(NOW);
    expect(path).toContain("next_retry_at.is.null");
    expect(path).toContain("next_retry_at.lte.");
    expect(path).toContain(encodeURIComponent(NOW.toISOString()));
    expect(path).toMatch(/status(?:\.in|=in\.)\.\(pending,retrying/);
    expect(path).toContain(`limit=${DUE_PAGE_LIMIT}`);
  });

  it("the delivering arm carries claimed_at.lte at the stale-lease cutoff", () => {
    const path = dueDeliveriesPath(NOW);
    const stale = new Date(NOW.getTime() - STALE_LEASE_MS).toISOString();
    expect(path).toContain("status.eq.delivering");
    expect(path).toContain("claimed_at.lte.");
    expect(path).toContain(encodeURIComponent(stale));
  });

  it("a freshly claimed delivering row never enters the page", async () => {
    const fresh = row({
      id: "fresh-claim",
      status: "delivering",
      claimed_at: new Date(NOW.getTime() - 30_000).toISOString(),
      next_retry_at: null,
      created_at: new Date(NOW.getTime() - 120_000).toISOString(),
    });
    const stale = row({
      id: "stale-claim",
      status: "delivering",
      claimed_at: new Date(NOW.getTime() - STALE_LEASE_MS - 1_000).toISOString(),
      next_retry_at: null,
      created_at: new Date(NOW.getTime() - 180_000).toISOString(),
    });
    const due = await fetchDueDeliveries({ get: fakePostgrest([fresh, stale]) }, NOW);
    expect(due.map((r) => r.id)).toEqual(["stale-claim"]);
  });

  it("a due row survives 101 not-yet-due rows that are all older", async () => {
    const rows = starvationFixture();
    expect(rows).toHaveLength(DUE_PAGE_LIMIT + 2);
    const due = await fetchDueDeliveries({ get: fakePostgrest(rows) }, NOW);
    expect(due.map((r) => r.id)).toEqual(["due-1"]);
  });

  it("still returns the not-due rows to nobody", async () => {
    const due = await fetchDueDeliveries({ get: fakePostgrest(starvationFixture()) }, NOW);
    expect(due.some((r) => r.id.startsWith("stale-"))).toBe(false);
  });

  it("a retry whose time has passed is returned", async () => {
    const rows = [
      row({ id: "past", status: "retrying", next_retry_at: new Date(NOW.getTime() - 1000).toISOString() }),
      row({ id: "future", status: "retrying", next_retry_at: new Date(NOW.getTime() + 1000).toISOString() }),
    ];
    const due = await fetchDueDeliveries({ get: fakePostgrest(rows) }, NOW);
    expect(due.map((r) => r.id)).toEqual(["past"]);
  });
});
