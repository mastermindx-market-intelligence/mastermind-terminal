import { describe, expect, it } from "vitest";
import {
  buildFlowProjection, selectFlowProjectionBucket, type FlowProjectionSource,
} from "@/lib/flowProjection";

const event = (over: Record<string, unknown> = {}): FlowProjectionSource => ({
  id: "one", ts: "2026-11-10T15:01:00Z", root: "AAPL", right: "C",
  premium: 100, size: 10, n_prints: 2, side: "~buy", ...over,
} as FlowProjectionSource);

describe("canonical flow projection admission", () => {
  it.each([5, 15, 30, 60] as const)("uses half-open %sm intervals, including sub-ms edges", (minutes) => {
    const start = Date.parse("2026-11-10T15:00:00Z");
    const end = start + minutes * 60_000;
    const rows = [
      event({ id: "right", ts: new Date(end).toISOString() }),
      event({ id: "last", ts: new Date(end - 1000).toISOString().replace(".000Z", ".999999999Z") }),
      event({ id: "left", ts: new Date(start).toISOString() }),
    ];
    const projection = buildFlowProjection(rows, minutes);
    expect(projection.buckets).toHaveLength(2);
    expect(projection.buckets[0]).toMatchObject({
      start: new Date(start).toISOString(), end: new Date(end).toISOString(),
      eventIds: ["left", "last"], eventCount: 2,
    });
    expect(projection.buckets[1].eventIds).toEqual(["right"]);
    expect(selectFlowProjectionBucket(rows, projection.buckets[0])).toEqual([rows[1], rows[2]]);
  });

  it("places equivalent explicit offsets in the same absolute interval", () => {
    const projection = buildFlowProjection([
      event({ id: "west", ts: "2026-11-10T10:01:00-05:00" }),
      event({ id: "east", ts: "2026-11-10T16:01:00+01:00" }),
    ], 15);
    expect(projection.buckets).toHaveLength(1);
    expect(projection.buckets[0]).toMatchObject({
      start: "2026-11-10T15:00:00.000Z", eventIds: ["east", "west"], eventCount: 2,
    });
  });

  it.each([
    "2026-02-30T15:01:00Z", "2026-13-01T15:01:00Z", "2026-11-10",
    "2026-11-10T15:01:00", "2026-11-10T24:00:00Z", "2026-11-10T15:60:00Z",
    "2026-11-10T15:01:60Z", "2026-11-10T15:01:00+25:00", "not-a-clock",
    null, 123, undefined,
  ])("does not project an invalid wire clock %s", (ts) => {
    expect(buildFlowProjection([event({ ts })], 15)).toMatchObject({
      inputEventCount: 1, validEventCount: 0, invalidTimestampCount: 1, buckets: [],
    });
  });

  it.each([
    ["size", 1.5], ["n_prints", 0.25], ["premium", -1],
    ["premium", Number.NaN], ["premium", Number.POSITIVE_INFINITY],
    ["premium", "100"], ["size", -1], ["size", Number.POSITIVE_INFINITY],
    ["size", "10"], ["n_prints", -1], ["n_prints", "2"], ["n_prints", null],
  ] as const)("excludes malformed %s=%s without coercion or rounding", (key, value) => {
    expect(buildFlowProjection([event({ [key]: value })], 15)).toMatchObject({
      inputEventCount: 1, validEventCount: 0, invalidValueCount: 1, buckets: [],
    });
  });

  it("keeps valid zero values instead of treating them as absent", () => {
    const projection = buildFlowProjection([event({ premium: 0, size: 0, n_prints: 0 })], 15);
    expect(projection).toMatchObject({ validEventCount: 1, invalidValueCount: 0 });
    expect(projection.buckets[0]).toMatchObject({
      eventCount: 1, grossPremium: 0, contractCount: 0, printCount: 0,
    });
  });

  it.each(["", " ", " padded", "padded ", null, undefined, 17])(
    "withholds the invalid identity %s without manufacturing an ID", (id) => {
      expect(buildFlowProjection([event({ id })], 15)).toMatchObject({
        inputEventCount: 1, validEventCount: 0, invalidIdentityCount: 1, buckets: [],
      });
    },
  );

  it.each(["identical", "other-bucket", "invalid-clock", "invalid-value"] as const)(
    "withholds every occurrence of a repeated identity (%s)", (kind) => {
      const second = event(kind === "other-bucket" ? { ts: "2026-11-10T15:16:00Z" }
        : kind === "invalid-clock" ? { ts: "invalid" }
          : kind === "invalid-value" ? { premium: -1 } : {});
      expect(buildFlowProjection([event(), second], 15)).toMatchObject({
        inputEventCount: 2, validEventCount: 0, invalidIdentityCount: 2,
        invalidTimestampCount: 0, invalidValueCount: 0, buckets: [],
      });
    },
  );

  it("counts each rejected row once, in identity then clock then value order", () => {
    const projection = buildFlowProjection([
      event({ id: "repeat" }), event({ id: "repeat", ts: "bad", premium: -1 }),
      event({ id: " ", ts: "bad", premium: -1 }),
      event({ id: "clock", ts: "bad", premium: -1 }),
      event({ id: "value", size: 0.5 }), event({ id: "valid" }),
    ], 15);
    expect(projection).toMatchObject({
      inputEventCount: 6, validEventCount: 1, invalidIdentityCount: 3,
      invalidTimestampCount: 1, invalidValueCount: 1,
    });
    expect(projection.buckets[0].eventIds).toEqual(["valid"]);
  });

  it("preserves distinct canonical IDs even when their contract terms agree", () => {
    const projection = buildFlowProjection([event({ id: "a" }), event({ id: "b" })], 15);
    expect(projection).toMatchObject({ validEventCount: 2, invalidIdentityCount: 0 });
    expect(projection.buckets[0]).toMatchObject({
      eventIds: ["a", "b"], eventCount: 2, grossPremium: 200,
    });
  });

  it("keeps unknown right and side premium separate from explicit puts and mixed", () => {
    const projection = buildFlowProjection([
      event({ id: "call-buy", premium: 10 }),
      event({ id: "put-sell", right: "P", side: "~sell", premium: 20 }),
      event({ id: "call-mixed", side: "mixed", premium: 30 }),
      event({ id: "unknown", right: "?", side: "unknown", premium: 40 }),
    ], 15);
    expect(projection.buckets[0]).toMatchObject({
      eventCount: 4, grossPremium: 100, callPremium: 40, putPremium: 20,
      unknownRightPremium: 40, softBuyPremium: 10, softSellPremium: 20,
      mixedPremium: 30, unknownSidePremium: 40,
    });
  });
});

describe("bucket drill-down keeps the current admitted Tape population", () => {
  it("null selection preserves every supplied row, order and object reference", () => {
    const rows = Object.freeze([Object.freeze(event({ id: "", ts: "bad" })), Object.freeze(event())]);
    const selected = selectFlowProjectionBucket(rows, null);
    expect(selected).toEqual(rows);
    expect(selected).not.toBe(rows);
    expect(selected[0]).toBe(rows[0]);
    expect(selected[1]).toBe(rows[1]);
  });

  it.each([
    { ts: "2026-11-10T15:15:00Z" }, { ts: "2026-11-10T14:59:59.999999Z" },
    { ts: "2026-11-10T15:01:00" }, { size: 0.5 }, { premium: Number.NaN },
  ])("does not re-admit an ID whose current row no longer belongs (%s)", (over) => {
    const bucket = buildFlowProjection([event()], 15).buckets[0];
    expect(selectFlowProjectionBucket([event(over)], bucket)).toEqual([]);
  });

  it("does not re-admit a valid member when a malformed duplicate shares its identity", () => {
    const valid = event();
    const bucket = buildFlowProjection([valid], 15).buckets[0];
    expect(selectFlowProjectionBucket([valid, event({ ts: "bad" })], bucket)).toEqual([]);
  });

  it("preserves Tape order and original objects, not chronological membership order", () => {
    const later = Object.freeze(event({ id: "z", ts: "2026-11-10T15:08:00Z" }));
    const earlier = Object.freeze(event({ id: "a", ts: "2026-11-10T15:01:00Z" }));
    const outside = Object.freeze(event({ id: "outside", ts: "2026-11-10T15:17:00Z" }));
    const rows = Object.freeze([outside, later, earlier]);
    const projection = buildFlowProjection(rows, 15);
    expect(projection.buckets[0].eventIds).toEqual(["a", "z"]);
    const selected = selectFlowProjectionBucket(rows, projection.buckets[0]);
    expect(selected).toEqual([later, earlier]);
    expect(selected[0]).toBe(later);
    expect(selected[1]).toBe(earlier);
    expect(rows).toEqual([outside, later, earlier]);
  });
});
