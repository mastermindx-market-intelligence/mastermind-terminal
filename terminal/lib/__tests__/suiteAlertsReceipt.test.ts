import { describe, expect, it } from "vitest";
import { runSuiteAlertsLane } from "../../../ingest/suite_alerts";
import type { SuiteEvent } from "../indicator-canvas/types";

/**
 * REQUIRED 1 (MAJOR): a fire PATCH that returns 500 must not count as fired.
 * RED against the previous head: fired++ ran before the PATCH, so a 500 still
 * concluded outcome=success, fired_n=1, unevaluable_n=0.
 */
const ALERT = {
  id: "a-fire",
  symbol: "NVDA",
  active: true,
  created_at: "2026-01-01T00:00:00Z",
  condition: { type: "suite_event", suite: "structure", event: "bos" },
};

const DAY0 = Date.UTC(2026, 8, 8) / 1000;
function dummyData() {
  const bars = [0, 1, 2, 3, 4].map((i) => ({
    time: `2026-09-${String(8 + i).padStart(2, "0")}`,
    o: 100, h: 101, l: 99, c: 100 + i, v: 1,
  }));
  const barsT = bars.map((_, i) => DAY0 + i * 86400);
  return { bars, barsT };
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as Response;
}

describe("suite_alerts fire PATCH failure is unevaluable, never a clean success", () => {
  it("a 500 fire PATCH: fired_n 0, unevaluable_n 1, outcome not success", async () => {
    const concludeBodies: Array<Record<string, unknown>> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = String(init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.includes("/alerts?")) {
        return jsonResponse(200, [ALERT]);
      }
      if (method === "POST" && url.endsWith("/alert_runs")) {
        return jsonResponse(201, {});
      }
      if (method === "PATCH" && url.includes("/alerts?")) {
        return jsonResponse(500, { message: "write failed" });
      }
      if (method === "PATCH" && url.includes("/alert_runs?")) {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        concludeBodies.push(body);
        return jsonResponse(204, {});
      }
      return jsonResponse(404, {});
    };

    const result = await runSuiteAlertsLane({
      argv: ["--data-dir", "/does-not-matter"],
      envOverride: { url: "https://example.supabase.co", key: "service-role" },
      hooks: {
        fetchImpl,
        loadSymbolData: () => dummyData(),
        suiteEventsFor: (): SuiteEvent[] => [{ type: "bos", dir: "bull", i: 4, p: 110 }],
      },
    });

    expect(result.fired).toBe(0);
    expect(result.unevaluableN).toBe(1);
    expect(result.deferred).toBe(1);
    expect(result.outcome).not.toBe("success");
    expect(result.outcome).toBe("partial");
    expect(concludeBodies.length).toBe(1);
    expect(concludeBodies[0].fired_n).toBe(0);
    expect(concludeBodies[0].unevaluable_n).toBe(1);
    expect(concludeBodies[0].outcome).not.toBe("success");
  });
});
