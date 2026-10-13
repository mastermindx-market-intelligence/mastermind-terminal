import { describe, expect, it } from "vitest";
import * as companion from "../optionsCompanion";
import type { CompanionMatrix } from "../optionsCompanion";

/** Contract shape. The production export is absent until the library lands. */
interface MatrixReceipts {
  session: string;
  build: string | null;
  eod: string | null;
  greeks: string | null;
  oiPublication: string | null;
  previousOiPublication: string | null;
  latestOiPublication: string | null;
  spotClock: null;
  mixed: boolean;
}

const ISO = "2026-07-10T21:04:11.412870+00:00";
const SESSION = "2026-07-10";

type ReadMatrixReceipts = (receipt: CompanionMatrix) => MatrixReceipts;
type MatrixSnapshotKey = (raw: unknown, root: string) => string | null;

function readMatrixReceipts(): ReadMatrixReceipts {
  const fn = (companion as { readMatrixReceipts?: ReadMatrixReceipts }).readMatrixReceipts;
  if (typeof fn !== "function") throw new Error("readMatrixReceipts is missing");
  return fn;
}

function matrixSnapshotKey(): MatrixSnapshotKey {
  const fn = (companion as { matrixSnapshotKey?: MatrixSnapshotKey }).matrixSnapshotKey;
  if (typeof fn !== "function") throw new Error("matrixSnapshotKey is missing");
  return fn;
}

function receipt(doc: Record<string, unknown>, session = SESSION): CompanionMatrix {
  return {
    root: "NVDA",
    session,
    missingCells: 0,
    doc: {
      schema: "options_structure.matrix/v1",
      root: "NVDA",
      spot: 751.71,
      cells: [],
      ...doc,
    } as CompanionMatrix["doc"],
  };
}

const fullSource = {
  eod: SESSION,
  greeks: SESSION,
  oi_publication: SESSION,
  previous_oi_publication: "2026-07-09",
  latest_oi_publication: SESSION,
};

describe("readMatrixReceipts", () => {
  it("(a) returns each supplied clock verbatim and mixed false", () => {
    const clocks = readMatrixReceipts()(receipt({
      asof: ISO,
      _build_meta: { asof_date: SESSION, source_dates: fullSource },
    }));
    expect(clocks).toEqual({
      session: SESSION,
      build: ISO,
      eod: SESSION,
      greeks: SESSION,
      oiPublication: SESSION,
      previousOiPublication: "2026-07-09",
      latestOiPublication: SESSION,
      spotClock: null,
      mixed: false,
    });
    expect(Object.keys(clocks).sort()).toEqual([
      "build", "eod", "greeks", "latestOiPublication", "mixed", "oiPublication",
      "previousOiPublication", "session", "spotClock",
    ]);
  });

  it("(b) fixture shape with t2_date and no source_dates leaves all five clocks null", () => {
    const clocks = readMatrixReceipts()(receipt({
      asof: ISO,
      _build_meta: { asof_date: SESSION, t2_date: "2026-07-08", n_cells: 416 },
    }));
    expect(clocks.eod).toBeNull();
    expect(clocks.greeks).toBeNull();
    expect(clocks.oiPublication).toBeNull();
    expect(clocks.previousOiPublication).toBeNull();
    expect(clocks.latestOiPublication).toBeNull();
    expect(clocks.spotClock).toBeNull();
    expect(clocks.mixed).toBe(false);
    expect(clocks.build).toBe(ISO);
  });

  it("(c) null, missing and impossible source dates stay null", () => {
    const clocks = readMatrixReceipts()(receipt({
      asof: ISO,
      _build_meta: {
        asof_date: SESSION,
        source_dates: {
          eod: null,
          oi_publication: "2026-02-30",
          previous_oi_publication: "2026-07-09",
          latest_oi_publication: "2026-07-11",
        },
      },
    }));
    expect(clocks.eod).toBeNull();
    expect(clocks.greeks).toBeNull();
    expect(clocks.oiPublication).toBeNull();
    expect(clocks.previousOiPublication).toBe("2026-07-09");
    expect(clocks.latestOiPublication).toBe("2026-07-11");
    expect(clocks.mixed).toBe(false);
  });

  it("(d) a different oi publication is mixed; a later latest publication is not", () => {
    const mixed = readMatrixReceipts()(receipt({
      asof: ISO,
      _build_meta: {
        asof_date: SESSION,
        source_dates: { ...fullSource, oi_publication: "2026-07-09" },
      },
    }));
    expect(mixed.oiPublication).toBe("2026-07-09");
    expect(mixed.mixed).toBe(true);

    const laterLatest = readMatrixReceipts()(receipt({
      asof: ISO,
      _build_meta: {
        asof_date: SESSION,
        source_dates: { ...fullSource, latest_oi_publication: "2026-07-13" },
      },
    }));
    expect(laterLatest.latestOiPublication).toBe("2026-07-13");
    expect(laterLatest.eod).toBe(SESSION);
    expect(laterLatest.mixed).toBe(false);
  });

  it("(e) build is only a finite timestamp string, returned verbatim", () => {
    const read = readMatrixReceipts();
    expect(read(receipt({ asof: "2026-07-10", _build_meta: { asof_date: SESSION } })).build).toBeNull();
    expect(read(receipt({ asof: 1_751_234_567, _build_meta: { asof_date: SESSION } })).build).toBeNull();
    expect(read(receipt({ _build_meta: { asof_date: SESSION } })).build).toBeNull();
    expect(read(receipt({ asof: "not-a-timeTxx", _build_meta: { asof_date: SESSION } })).build).toBeNull();
    expect(read(receipt({ asof: ISO, _build_meta: { asof_date: SESSION } })).build).toBe(ISO);
  });

  it("(f) spotClock is always null", () => {
    const clocks = readMatrixReceipts()(receipt({
      asof: ISO,
      spot: 751.71,
      _build_meta: { asof_date: SESSION, source_dates: fullSource },
    }));
    expect(clocks.spotClock).toBeNull();
    expect(clocks.build).toBe(ISO);
  });

  it("(g) a non-object source_dates yields five nulls and does not throw", () => {
    const read = readMatrixReceipts();
    for (const source_dates of [[SESSION], "2026-07-10", null]) {
      const made = receipt({ asof: ISO, _build_meta: { asof_date: SESSION, source_dates } });
      expect(() => read(made)).not.toThrow();
      const clocks = read(made);
      expect(clocks.eod).toBeNull();
      expect(clocks.greeks).toBeNull();
      expect(clocks.oiPublication).toBeNull();
      expect(clocks.previousOiPublication).toBeNull();
      expect(clocks.latestOiPublication).toBeNull();
      expect(clocks.spotClock).toBeNull();
    }
  });
});

function matrix(over: Record<string, unknown> = {}) {
  return {
    schema: "options_structure.matrix/v1",
    root: "NVDA",
    asof: ISO,
    _build_meta: { asof_date: SESSION },
    cells: [{ strike: 740, expiry: SESSION }],
    ...over,
  };
}

describe("matrixSnapshotKey", () => {
  it("(h) two reads of the same published build are equal", () => {
    const key = matrixSnapshotKey();
    const payload = matrix();
    expect(key(payload, "NVDA")).toBe(key(payload, "NVDA"));
    expect(key(payload, "NVDA")).toBe(key(matrix({ cells: [{ strike: 1, expiry: "2026-08-21" }, { strike: 2, expiry: "2026-08-21" }] }), "NVDA"));
    expect(key(payload, "NVDA")).toBe(`NVDA|${SESSION}|${ISO}`);
  });

  it("(i) a new asof or a new session changes the key", () => {
    const key = matrixSnapshotKey();
    const base = key(matrix(), "NVDA");
    expect(key(matrix({ asof: "2026-07-10T22:00:00+00:00" }), "NVDA")).not.toBe(base);
    expect(key(matrix({ _build_meta: { asof_date: "2026-07-09" } }), "NVDA")).not.toBe(base);
    expect(key(matrix({ _build_meta: { asof_date: "2026-07-09" } }), "NVDA")).toBe(`NVDA|2026-07-09|${ISO}`);
  });

  it("(j) another root or a missing or invalid session is null", () => {
    const key = matrixSnapshotKey();
    expect(key(matrix(), "SPY")).toBeNull();
    expect(key(matrix({ root: "SPY" }), "NVDA")).toBeNull();
    expect(key(matrix({ _build_meta: {} }), "NVDA")).toBeNull();
    expect(key(matrix({ _build_meta: null }), "NVDA")).toBeNull();
    expect(key(matrix({ _build_meta: { asof_date: "2026-02-30" } }), "NVDA")).toBeNull();
    expect(key(matrix({ _build_meta: { asof_date: "2026-07-10T00:00:00Z" } }), "NVDA")).toBeNull();
  });

  it("(k) a payload with 100000 cells is keyed without iterating them", () => {
    const key = matrixSnapshotKey();
    let walked = 0;
    const cells = new Proxy(Array.from({ length: 100_000 }, () => ({ strike: 740, expiry: SESSION })), {
      get(target, prop, receiver) {
        if (
          prop === Symbol.iterator || prop === "forEach" || prop === "map" || prop === "entries"
          || prop === "values" || prop === "keys" || prop === "reduce" || prop === "some"
          || prop === "every" || prop === "filter" || prop === "find"
          || (typeof prop === "string" && /^\d+$/.test(prop))
        ) {
          walked += 1;
          throw new Error("cells walked");
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    expect(key(matrix({ cells }), "NVDA")).toBe(`NVDA|${SESSION}|${ISO}`);
    expect(walked).toBe(0);
  });
});
