// B-F13-7 last-close resolver. Fixtures only — never public/data, never version history, never the network.

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CLAIM_OWNER_LAST_CLOSE,
  resolveLastClose,
  type Bar,
  type ReadDailyBars,
  type ResolverInput,
  type ResolverResult,
} from "@/lib/dailyCloseResolver";
import { RESOLVER_REGISTRY } from "@/lib/personalAccuracyStore";

const FIXTURE_DIR = join(__dirname, "fixtures/dailyClose");
const UNAVAILABLE = "the data this call named was not available";
const TRADING_CLOSE = 227;
const WEEKEND_CLOSE = 50.5;
const HOLIDAY_CLOSE = 52;

function parseFixtureBars(fileName: string): Bar[] {
  const payload = JSON.parse(readFileSync(join(FIXTURE_DIR, fileName), "utf8")) as {
    bars: Array<[string, number, number, number, number, number]>;
  };
  return payload.bars.map(([date, open, high, low, close, vol]) => ({
    date,
    open,
    high,
    low,
    close,
    vol,
  }));
}

const readDailyBars: ReadDailyBars = async (sym) => {
  const file = join(FIXTURE_DIR, `${String(sym).toUpperCase()}.json`);
  if (!existsSync(file)) return null;
  const bars = parseFixtureBars(`${String(sym).toUpperCase()}.json`);
  return bars.length ? bars : null;
};

function input(overrides: {
  subject?: ResolverInput["subject"];
  condition?: Partial<ResolverInput["condition"]>;
  resolves_at?: string;
} = {}): ResolverInput {
  return {
    subject: overrides.subject ?? { kind: "security", id: "AAPL" },
    condition: {
      metric: CLAIM_OWNER_LAST_CLOSE.metric,
      comparator: ">=",
      threshold: 200,
      owner: CLAIM_OWNER_LAST_CLOSE.owner,
      ...overrides.condition,
    },
    resolves_at: overrides.resolves_at ?? "2026-09-04T20:00:00.000Z",
  };
}

function undeterminedShape(result: ResolverResult) {
  expect(result.outcome).toBeNull();
  expect(result.observed).toBeNull();
  expect(result.resolver).toBe(CLAIM_OWNER_LAST_CLOSE.owner);
  expect(result.note).toBe(UNAVAILABLE);
}

describe("last close from the quote owner", () => {
  it("returns the exact bar's close when resolves_at lands on a real trading day in the fixture", async () => {
    const result = await resolveLastClose(input(), { readDailyBars });
    expect(result.observed).toBe(TRADING_CLOSE);
    expect(result.outcome).toBe(1);
    expect(result.resolver).toBe(CLAIM_OWNER_LAST_CLOSE.owner);
    expect(result.note).toBe("close on 2026-09-04");
  });

  it("returns the prior trading day's close when resolves_at falls on a weekend", async () => {
    // GAPSYM: Friday 2024-11-22 close 50.50; Saturday 2024-11-23 and Sunday 2024-11-24 have no bars.
    const result = await resolveLastClose(
      input({
        subject: { kind: "security", id: "GAPSYM" },
        resolves_at: "2024-11-23T17:00:00.000Z",
        condition: { threshold: 50 },
      }),
      { readDailyBars },
    );
    expect(result.observed).toBe(WEEKEND_CLOSE);
    expect(result.outcome).toBe(1);
    expect(result.note).toBe("close on 2024-11-22");
  });

  it("returns the prior trading day's close when resolves_at falls on the fixture's holiday gap", async () => {
    // GAPSYM: Wednesday 2024-11-27 close 52.00; Thanksgiving Thursday 2024-11-28 and Friday
    // 2024-11-29 are absent. A naive "subtract one day" from Friday would look for Thursday
    // and miss; on-or-before selects Wednesday.
    const result = await resolveLastClose(
      input({
        subject: { kind: "security", id: "gapsym" },
        resolves_at: "2024-11-29T21:00:00.000Z",
        condition: { threshold: 52 },
      }),
      { readDailyBars },
    );
    expect(result.observed).toBe(HOLIDAY_CLOSE);
    expect(result.outcome).toBe(1);
    expect(result.note).toBe("close on 2024-11-27");
  });

  it("returns null observed and null outcome with the exact docket note text when the symbol has no fixture file", async () => {
    const result = await resolveLastClose(
      input({ subject: { kind: "security", id: "NOSUCH" } }),
      { readDailyBars },
    );
    undeterminedShape(result);
  });

  it("returns null observed and null outcome when condition.metric is not \"close\"", async () => {
    const result = await resolveLastClose(
      input({ condition: { metric: "last" } }),
      { readDailyBars },
    );
    undeterminedShape(result);
  });

  it("returns null observed and null outcome when subject.kind is not \"security\"", async () => {
    const result = await resolveLastClose(
      input({ subject: { kind: "macro_series", id: "AAPL" } }),
      { readDailyBars },
    );
    undeterminedShape(result);
  });

  it("never returns outcome 1 or 0 when observed is null, across every branch above", async () => {
    const branches = await Promise.all([
      resolveLastClose(input({ subject: { kind: "security", id: "NOSUCH" } }), { readDailyBars }),
      resolveLastClose(input({ condition: { metric: "open" } }), { readDailyBars }),
      resolveLastClose(input({ subject: { kind: "basket", id: "AAPL" } }), { readDailyBars }),
      resolveLastClose(input({ resolves_at: "2020-01-02T20:00:00.000Z" }), { readDailyBars }),
      resolveLastClose(input(), { readDailyBars }),
    ]);
    for (const result of branches) {
      expect(result.outcome === null).toBe(result.observed === null);
      if (result.observed === null) {
        expect(result.outcome).not.toBe(0);
        expect(result.outcome).not.toBe(1);
        expect(result.outcome).toBeNull();
      }
    }
  });

  it("computes outcome 1 and outcome 0 correctly for each of >=, <=, >, < against the same observed close", async () => {
    const cases: Array<{ comparator: ResolverInput["condition"]["comparator"]; threshold: number; outcome: 0 | 1 }> = [
      { comparator: ">=", threshold: TRADING_CLOSE, outcome: 1 },
      { comparator: ">=", threshold: TRADING_CLOSE + 0.01, outcome: 0 },
      { comparator: "<=", threshold: TRADING_CLOSE, outcome: 1 },
      { comparator: "<=", threshold: TRADING_CLOSE - 0.01, outcome: 0 },
      { comparator: ">", threshold: TRADING_CLOSE - 0.01, outcome: 1 },
      { comparator: ">", threshold: TRADING_CLOSE, outcome: 0 },
      { comparator: "<", threshold: TRADING_CLOSE + 0.01, outcome: 1 },
      { comparator: "<", threshold: TRADING_CLOSE, outcome: 0 },
    ];
    for (const row of cases) {
      const result = await resolveLastClose(
        input({ condition: { comparator: row.comparator, threshold: row.threshold } }),
        { readDailyBars },
      );
      expect(result.observed).toBe(TRADING_CLOSE);
      expect(result.outcome).toBe(row.outcome);
    }
  });

  it("resolves_at with no qualifying bar at all (every bar postdates it) returns null, not the earliest bar", async () => {
    const result = await resolveLastClose(
      input({ resolves_at: "2026-09-01T20:00:00.000Z" }),
      { readDailyBars },
    );
    undeterminedShape(result);
  });

  it("resolving the same input against the same fixture twice returns byte-identical resolution objects", async () => {
    const args = input();
    const first = await resolveLastClose(args, { readDailyBars });
    const second = await resolveLastClose(args, { readDailyBars });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first).toEqual(second);
  });

  it("RESOLVER_REGISTRY exports exactly one key, \"hub/lib/anchor.js\", after this packet", () => {
    expect(Object.keys(RESOLVER_REGISTRY)).toEqual([CLAIM_OWNER_LAST_CLOSE.owner]);
    expect(CLAIM_OWNER_LAST_CLOSE.owner).toBe("hub/lib/anchor.js");
    expect(CLAIM_OWNER_LAST_CLOSE.metric).toBe("close");
    expect(RESOLVER_REGISTRY[CLAIM_OWNER_LAST_CLOSE.owner]).toBe(resolveLastClose);
  });

  it("score_personal_accuracy.mjs still selects only status in (open, matured) claims", () => {
    const src = readFileSync(join(__dirname, "../../scripts/score_personal_accuracy.mjs"), "utf8");
    expect(src).toContain('.in("status", ["open", "matured"])');
  });
});
