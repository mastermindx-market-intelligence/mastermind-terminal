// AC-E17-01 — the dry run and the canonical firing lane reach the SAME decision on the SAME data
// and state. Not a re-statement of the evaluator: this drives the REAL sidecar
// (ingest/suite_alerts.ts runSuiteAlertsLane: real file loader, real suite runtimes, real
// evaluator; only its HTTP transport is mocked) and the REAL dry-run orchestrator over the same
// bar files, for every catalog event (with and without direction / strength filters) and
// sequences, across a sweep of "today"s. A new alert created at the dry run's instant is exactly
// the state the lane sees on that alert's first evaluation.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSuiteAlertsLane } from "../../../ingest/suite_alerts";
import { runAlertDryRun } from "@/lib/alertDryRun";
import type { DryRunDeps, DryRunResult } from "@/lib/alertDryRun";
import { parseSuiteDailyBars, suiteEventsAtDefaults } from "@/lib/suiteAlertInputs";
import { SUITE_ALERT_EVENTS } from "@/lib/suiteAlerts";

const SYM = "PARITY_FIXTURE";
const T0 = Date.UTC(2025, 0, 1);
const DAY = 86_400_000;
const day = (i: number) => new Date(T0 + i * DAY).toISOString().slice(0, 10);
// Regime-switching walk: trend legs, reversals and noise, so every suite emits real events.
const price = (i: number) =>
  120 + 0.04 * i + 14 * Math.sin(i / 23) + 6 * Math.sin(i / 7.3) + 2.5 * Math.sin(i / 2.1) + (i % 41 < 6 ? -4 : 0);
function writeBars(dir: string, count: number): void {
  const bars = Array.from({ length: count }, (_, i) => {
    const c = price(i);
    const o = i ? price(i - 1) : c;
    return [day(i), +o.toFixed(4), +(Math.max(o, c) + 0.6 + (i % 3) * 0.2).toFixed(4), +(Math.min(o, c) - 0.6 - (i % 4) * 0.15).toFixed(4), +c.toFixed(4), 100_000 + (i % 9) * 7_000];
  });
  writeFileSync(join(dir, `${SYM}.json`), JSON.stringify({ t: "parity", bars }));
}

type Cond = Record<string, unknown>;
function conditions(): Cond[] {
  const out: Cond[] = [];
  for (const e of SUITE_ALERT_EVENTS) {
    const base = { type: "suite_event", suite: e.suite, event: e.event };
    out.push(base);
    if (e.dirs) out.push({ ...base, dir: "bull" }, { ...base, dir: "bear" });
    if (e.strength) out.push({ ...base, minStrength: 60 });
  }
  const bySuite = new Map<string, string[]>();
  for (const e of SUITE_ALERT_EVENTS) bySuite.set(e.suite, [...(bySuite.get(e.suite) ?? []), e.event]);
  for (const [suite, evs] of bySuite) {
    for (const a of evs) for (const b of evs) {
      if (a === b) continue;
      out.push({ type: "suite_sequence", suite, steps: [{ event: a }, { event: b }], maxBarsBetween: 10 });
    }
  }
  return out;
}

/** Mocked PostgREST: hands the lane one fresh (never-evaluated) alert per condition. */
function transport(conds: Cond[], createdAt: string) {
  const alerts = conds.map((condition, i) => ({ id: `a${i}`, symbol: SYM, active: true, created_at: createdAt, condition: structuredClone(condition) }));
  const patches = new Map<string, Record<string, unknown>[]>();
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    if (method === "GET" && url.pathname.endsWith("/alerts")) return Response.json(alerts);
    if (url.pathname.endsWith("/alert_runs")) return method === "POST" ? Response.json({}, { status: 201 }) : new Response(null, { status: 204 });
    if (method === "PATCH" && url.pathname.endsWith("/alerts")) {
      const id = String(url.searchParams.get("id")).replace(/^eq\./, "");
      patches.set(id, [...(patches.get(id) ?? []), JSON.parse(String(init?.body))]);
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected ${method} ${url.pathname}`);
  };
  return { alerts, patches, fetchImpl };
}

function deps(dir: string, nowMs: number): DryRunDeps {
  return {
    async readSymbolDoc(symbol) {
      const file = join(dir, `${symbol}.json`);
      try {
        const [raw, st] = await Promise.all([readFile(file, "utf8"), stat(file)]);
        return { doc: JSON.parse(raw), asOfMs: st.mtimeMs };
      } catch {
        return null;
      }
    },
    parseBars: parseSuiteDailyBars,
    computeEvents: suiteEventsAtDefaults,
    planAdmits: async () => true,
    nowMs: () => nowMs,
  };
}

const dirAt = (i: number) => new Date(T0 + i * DAY).toISOString().slice(0, 10);

describe("dry run ⇔ firing lane parity (AC-E17-01)", () => {
  let dir = "";
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "mmx-e17-parity-"));
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("every condition, every swept day: same fire decision, same simulated sequence state", async () => {
    const conds = conditions();
    expect(conds.length).toBeGreaterThan(100);
    let compared = 0;
    let eventFires = 0;
    let seqFires = 0;
    let seqArms = 0;
    const mismatches: string[] = [];

    // Sweep "today" over the last bars of a growing history, and also a day after the last bar
    // (weekend: the creation floor is past every bar — nothing can fire, on both sides).
    for (const count of [180, 195, 205, 214, 223, 232, 241, 250, 259, 268]) {
      for (const lag of [0, 2]) {
        writeBars(dir, count);
        const lastIdx = count - 1;
        const nowMs = T0 + (lastIdx + lag) * DAY + 18 * 3_600_000;
        const createdAt = new Date(nowMs).toISOString();
        const tx = transport(conds, createdAt);
        const lane = await runSuiteAlertsLane({
          argv: ["--data-dir", dir],
          envOverride: { url: "https://parity-test.invalid", key: "test-only-not-a-credential" },
          hooks: { fetchImpl: tx.fetchImpl },
        });
        expect(lane.unevaluableN).toBe(0);

        for (const a of tx.alerts) {
          const body = { symbol: SYM, condition: structuredClone(a.condition) };
          const r: DryRunResult = await runAlertDryRun(body, deps(dir, nowMs));
          expect(["would_trigger", "not_met"]).toContain(r.verdict);
          const p = tx.patches.get(a.id) ?? [];
          const laneFired = p.some((x) => x.active === false);
          const dryFired = r.verdict === "would_trigger";
          compared++;
          const tag = `${count}+${lag} ${JSON.stringify(a.condition)}`;
          if (laneFired !== dryFired) mismatches.push(`${tag}: lane=${laneFired} dry=${dryFired}`);
          if (a.condition.type === "suite_sequence") {
            if (laneFired) seqFires++;
            // The lane persists an arming as condition._sq; the dry run reports the SAME arming as
            // simulated (never recorded). Same stepIdx, same armed day.
            const sq = p.at(-1)?.condition as { _sq?: { stepIdx?: number; armedT?: number } } | undefined;
            const laneArmed = !laneFired && sq?._sq?.stepIdx === 1 ? dirAt((sq._sq.armedT! * 1000 - T0) / DAY) : null;
            const dryArmed = r.sequenceState?.output === "simulated_armed" ? r.sequenceState.armedDate ?? "?" : null;
            if (laneArmed) seqArms++;
            if (laneArmed !== dryArmed) mismatches.push(`${tag}: lane armed=${laneArmed} dry armed=${dryArmed}`);
          } else if (laneFired) {
            eventFires++;
            // Same canonical note/value as the fire the lane recorded.
            const trig = (p.find((x) => x.active === false)?.condition as { triggered?: { note?: string; value?: number | null } })?.triggered;
            if (trig?.note !== `${SYM} — ${r.decision?.note}`) mismatches.push(`${tag}: note lane=${trig?.note} dry=${r.decision?.note}`);
          }
        }
      }
    }
    if (process.env.E17_PARITY_STATS) process.stdout.write(`parity: compared=${compared} eventFires=${eventFires} seqFires=${seqFires} seqArms=${seqArms}\n`);
    expect(mismatches).toEqual([]);
    expect(compared).toBeGreaterThan(2000);
    // Non-vacuous: the sweep must actually contain fires and armings for parity to mean anything.
    expect(eventFires).toBeGreaterThan(5);
    expect(seqFires + seqArms).toBeGreaterThan(5);
  }, 240_000);

  it("the lane's own bar file is what the dry run reads (no second parser)", () => {
    writeBars(dir, 120);
    const doc = JSON.parse(readFileSync(join(dir, `${SYM}.json`), "utf8"));
    const parsed = parseSuiteDailyBars(doc)!;
    expect(parsed.barsT).toHaveLength(120);
    expect(parsed.barsT[0]).toBe(T0 / 1000);
  });
});
