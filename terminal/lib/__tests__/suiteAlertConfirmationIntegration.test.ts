import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSuiteAlertsLane } from "../../../ingest/suite_alerts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const T0 = Date.UTC(2026, 0, 1);
const day = (i: number) => new Date(T0 + i * 86400_000).toISOString().slice(0, 10);
const price = (i: number) => 100 - .06 * i + 8 * Math.sin(i / 5) + 2 * Math.sin(i / 1.7);
function writeBars(dir: string, count: number): void {
  const bars = Array.from({ length: count }, (_, i) => {
    const c = price(i), o = i ? price(i - 1) : c;
    return [day(i), o, Math.max(o, c) + .3, Math.min(o, c) - .3, c, 1000 + (i % 7) * 80];
  });
  writeFileSync(join(dir, "CLOCK_FIXTURE.json"), JSON.stringify({ bars }));
}

type Condition = Record<string, unknown>;
function transport(condition: Condition, createdAt = `${day(103)}T12:00:00Z`, failFire = false) {
  const alert = { id: "clock-fixture-alert", symbol: "CLOCK_FIXTURE", active: true, created_at: createdAt, condition };
  const patches: Array<Record<string, unknown>> = [];
  const receipts: Array<Record<string, unknown>> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    expect(url.origin).toBe("https://clock-test.invalid");
    const method = init?.method ?? "GET";
    if (method === "GET" && url.pathname.endsWith("/alerts")) return Response.json(alert.active ? [alert] : []);
    if (method === "POST" && url.pathname.endsWith("/alert_runs")) return Response.json({}, { status: 201 });
    if (method === "PATCH" && url.pathname.endsWith("/alert_runs")) {
      receipts.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 204 });
    }
    if (method === "PATCH" && url.pathname.endsWith("/alerts")) {
      expect(url.searchParams.get("active")).toBe("eq.true");
      expect(url.searchParams.get("id")).toBe("eq.clock-fixture-alert");
      const body = JSON.parse(String(init?.body));
      if (failFire && body.active === false) return Response.json({ message: "fixture write failed" }, { status: 500 });
      patches.push(body);
      Object.assign(alert, body);
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected transport operation: ${method} ${url.pathname}`);
  };
  return { alert, patches, receipts, fetchImpl };
}
const COND = { type: "suite_event", suite: "rsix", event: "rsix_div" };
const run = (dir: string, fetchImpl: typeof fetch) => runSuiteAlertsLane({
  argv: ["--data-dir", dir],
  envOverride: { url: "https://clock-test.invalid", key: "test-only-not-a-credential" },
  hooks: { fetchImpl }, // Real file loader, runtime modules, host, evaluator and persistence. HTTP only is mocked.
});

describe("the actual alert sidecar consumes confirmed runtime events", () => {
  it("loads computation, waits for confirmation, persists the clock with its fire, and does not resend on re-arm", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mmx-chart-clock-")); dirs.push(dir);
    const tx = transport({ ...COND });
    writeBars(dir, 105); // pivot 100 has only four right-hand bars: not yet knowable
    expect((await run(dir, tx.fetchImpl)).fired).toBe(0);
    expect(tx.patches).toHaveLength(0);
    writeBars(dir, 106); // fifth right-hand bar: first valid confirmation
    const result = await run(dir, tx.fetchImpl);
    expect(result.fired).toBe(1);
    expect(result.unevaluableN).toBe(0);
    expect(tx.patches).toHaveLength(1);
    expect(tx.alert.active).toBe(false);
    expect(tx.alert.condition._se).toEqual({ lastFiredT: (T0 + 105 * 86400_000) / 1000, clockVersion: 2 });
    expect((tx.alert.condition.triggered as { note: string }).note).toContain(`on ${day(105)} (confirmed; anchor ${day(100)}, 5 bars earlier)`);
    tx.alert.active = true; // User re-arms the existing condition without clearing its fire watermark.
    expect((await run(dir, tx.fetchImpl)).fired).toBe(0);
    expect(tx.patches).toHaveLength(1);
    expect(tx.receipts.at(-1)?.fired_n).toBe(0);
  });

  it("a failed persistence operation does not migrate the watermark or count as delivery", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mmx-chart-clock-")); dirs.push(dir);
    const tx = transport({ ...COND }, `${day(103)}T12:00:00Z`, true);
    writeBars(dir, 106);
    const result = await run(dir, tx.fetchImpl);
    expect(result.fired).toBe(0);
    expect(result.unevaluableN).toBe(1);
    expect(result.outcome).toBe("partial");
    expect(tx.alert.active).toBe(true);
    expect(tx.alert.condition._se).toBeUndefined();
  });
});
