// B-F13-7 worker: due last-close claims settle through the registered resolver.
// Stubbed client only — never a network, never public/data, never version history.

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CLAIM_OWNER_LAST_CLOSE,
  resolveLastClose,
  type Bar,
  type ReadDailyBars,
} from "@/lib/dailyCloseResolver";
import { scoreDueClaims } from "../../scripts/score_personal_accuracy.mjs";
import { compareObserved, thresholdNumber } from "@/lib/personalAccuracy";
import { UNDETERMINED_NOTE } from "@/lib/personalAccuracyStore";

const FIXTURE_DIR = join(__dirname, "fixtures/dailyClose");

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

type DueRow = {
  claim_id: string;
  status: string;
  condition: Record<string, unknown>;
  resolves_at: string;
  resolution: null;
  subject: { kind: string; id: string };
};

function stubClient(dueRows: DueRow[]) {
  const writes: Array<{ claim_id: unknown; payload: Record<string, unknown> }> = [];
  let selectCols = "";

  function project(row: DueRow): Record<string, unknown> {
    const cols = selectCols.split(",").map((c) => c.trim()).filter(Boolean);
    const out: Record<string, unknown> = {};
    for (const col of cols) {
      if (Object.prototype.hasOwnProperty.call(row, col)) {
        out[col] = (row as Record<string, unknown>)[col];
      }
    }
    return out;
  }

  const readChain: Record<string, unknown> = {
    select(cols: string) {
      selectCols = cols;
      return readChain;
    },
    in() {
      return readChain;
    },
    lte() {
      return Promise.resolve({ data: dueRows.map(project), error: null });
    },
  };

  function updateChain(payload: Record<string, unknown>) {
    let claimId: unknown;
    const chain: Record<string, unknown> = {
      eq(_column: string, value: unknown) {
        claimId = value;
        return chain;
      },
      in() {
        writes.push({ claim_id: claimId, payload });
        return Promise.resolve({ error: null });
      },
    };
    return chain;
  }

  return {
    from() {
      return {
        select: readChain.select,
        in: readChain.in,
        lte: readChain.lte,
        update(payload: Record<string, unknown>) {
          return updateChain(payload);
        },
      };
    },
    writes,
  };
}

const DUE: DueRow = {
  claim_id: "claim-aapl-last-close",
  status: "matured",
  condition: {
    metric: CLAIM_OWNER_LAST_CLOSE.metric,
    comparator: ">=",
    threshold: 200,
    owner: CLAIM_OWNER_LAST_CLOSE.owner,
  },
  resolves_at: "2026-09-04T20:00:00.000Z",
  resolution: null,
  subject: { kind: "security", id: "AAPL" },
};

describe("score_personal_accuracy worker last-close path", () => {
  it("settles a due last-close claim with the quote-owner resolver and the close-on note", async () => {
    const client = stubClient([DUE]);
    const counts = await scoreDueClaims(client, {
      registry: { [CLAIM_OWNER_LAST_CLOSE.owner]: resolveLastClose },
      resolverDeps: { readDailyBars },
      thresholdNumber,
      compareObserved,
      now: "2026-09-05T00:00:00.000Z",
    });
    expect(counts.settled).toBe(1);
    expect(counts.undetermined).toBe(0);
    expect(client.writes).toHaveLength(1);
    const resolution = client.writes[0].payload.resolution as {
      outcome: unknown;
      observed: unknown;
      resolver: unknown;
      note: unknown;
    };
    expect(resolution.outcome).toBe(1);
    expect(resolution.observed).toBe(227);
    expect(resolution.resolver).toBe("hub/lib/anchor.js");
    expect(resolution.note).toBe("close on 2026-09-04");
  });

  it("writes undetermined and logs one line when the resolver and the worker disagree", async () => {
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(String(args[0] ?? ""));
    };
    try {
      const client = stubClient([DUE]);
      const counts = await scoreDueClaims(client, {
        registry: {
          [CLAIM_OWNER_LAST_CLOSE.owner]: async () => ({
            outcome: 0,
            observed: 227,
            resolver: CLAIM_OWNER_LAST_CLOSE.owner,
            note: "close on 2026-09-04",
          }),
        },
        thresholdNumber,
        compareObserved,
        now: "2026-09-05T00:00:00.000Z",
      });
      expect(counts.settled).toBe(1);
      expect(counts.undetermined).toBe(1);
      const resolution = client.writes[0].payload.resolution as {
        outcome: unknown;
        observed: unknown;
        resolver: unknown;
        note: unknown;
      };
      expect(resolution.outcome).toBeNull();
      expect(resolution.observed).toBeNull();
      expect(resolution.resolver).toBe("personalAccuracyStore.RESOLVER_REGISTRY");
      expect(resolution.note).toBe(UNDETERMINED_NOTE);
      expect(errors.some((line) => line.includes("disagreed"))).toBe(true);
    } finally {
      console.error = original;
    }
  });

  it("logs the runtime esbuild requirement on the missing-esbuild exit path", () => {
    const src = readFileSync(join(__dirname, "../../scripts/score_personal_accuracy.mjs"), "utf8");
    expect(src).toContain(
      "the scoring worker now needs esbuild at runtime; it is a devDependency; install with dev deps or promote it in a later packet",
    );
  });
});
