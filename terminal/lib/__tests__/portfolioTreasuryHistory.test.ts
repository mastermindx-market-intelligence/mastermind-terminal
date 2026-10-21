// Focused Vitest coverage for the Treasury daily-history consumer: envelope
// validation and the guarded transport. All transports are injected mocks — the
// suite performs no network I/O and carries no real credential (the bearer
// value below is a synthetic test token, and the producer identity fields are
// fixtures shaped after lib/treasury_daily_history.py).
import { describe, expect, it, vi } from "vitest";
import {
  fetchTreasuryHistory,
  parseTreasuryHistoryEnvelope,
  resolveFlowBase,
  validateTreasuryHistoryWindow,
  type TreasuryHistoryWindow,
} from "../portfolioTreasuryHistory.server";

const SHA_HEX = "5f1b3d2a9c4e7b8d6f0a1c2e3d4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f";
const READ_AT = "2026-10-20T12:00:00+00:00";

const READ_WINDOW: TreasuryHistoryWindow = {
  start: "2026-09-01",
  end: "2026-09-30",
  expected_through: "2026-09-30",
};

const STALE_WINDOW: TreasuryHistoryWindow = {
  start: "2026-09-01",
  end: "2026-10-20",
  expected_through: "2026-10-15",
};

const READ_POINTS = [
  { date: "2026-09-01", value: 4.32 },
  { date: "2026-09-02", value: 4.35 },
  { date: "2026-09-03", value: 4.31 },
  { date: "2026-09-04", value: 4.28 },
  { date: "2026-09-30", value: 4.4 },
];

function sourceFixture(lastObservation: string | null, sha256: string | null) {
  return {
    source_id: "DGS3MO",
    native_alias: "us3m",
    origin: "FRED",
    native_path: "data/fred/DGS3MO.parquet",
    last_observation_date: lastObservation,
    sha256: sha256,
    citation: "Board of Governors of the Federal Reserve System (US), H.15, via FRED",
    source_url: "https://fred.stlouisfed.org/series/DGS3MO",
    publication_status: "not_qualified",
  };
}

function clocksFixture(readAt: string) {
  return { read_at: readAt, release_at: null, knowledge_at: null, vintage_at: null };
}

function envelopeFixture(status: string, reason: string | null, window: TreasuryHistoryWindow, points: unknown[], lastObservation: string | null, sha256: string | null) {
  const span = Math.round((Date.UTC(2026, 8, 30) - Date.UTC(2026, 8, 1)) / 86400000) + 1;
  const staleSpan = 50;
  return {
    schema: "treasury.daily_history.v1",
    status: status,
    reason: reason,
    unit: "percent_per_annum",
    basis: "investment",
    points: points,
    requested: { start: window.start, end: window.end, expected_through: window.expected_through },
    coverage: {
      observation_count: points.length,
      requested_calendar_days: window.end === "2026-09-30" ? span : staleSpan,
      first: points.length > 0 ? (points[0] as { date: string }).date : null,
      last: points.length > 0 ? (points[points.length - 1] as { date: string }).date : null,
    },
    clocks: clocksFixture(READ_AT),
    source: sourceFixture(lastObservation, sha256),
  };
}

const readEnvelope = envelopeFixture("read", null, READ_WINDOW, READ_POINTS, "2026-09-30", SHA_HEX);
const staleEnvelope = envelopeFixture(
  "stale",
  "before_expected_through",
  STALE_WINDOW,
  [
    { date: "2026-09-30", value: 4.4 },
    { date: "2026-10-01", value: 4.41 },
    { date: "2026-10-13", value: 4.52 },
  ],
  "2026-10-13",
  SHA_HEX,
);
const missingEnvelope = envelopeFixture("unavailable", "missing", READ_WINDOW, [], null, null);
const emptyEnvelope = envelopeFixture("unavailable", "empty", READ_WINDOW, [], null, null);
const noCoverageEnvelope = envelopeFixture("unavailable", "no_coverage", READ_WINDOW, [], "2026-08-31", SHA_HEX);

function mutateEnvelope(apply: (envelope: Record<string, unknown>) => void): Record<string, unknown> {
  const clone = structuredClone(readEnvelope) as Record<string, unknown>;
  apply(clone);
  return clone;
}

function expectUnreadable(raw: unknown, window: TreasuryHistoryWindow, reason: string) {
  const result = parseTreasuryHistoryEnvelope(raw, window);
  expect(result.status).toBe("unreadable");
  expect(result).toMatchObject({ status: "unreadable", reason: reason, detail: null });
}

function mockFetch(body: string | Uint8Array, init: ResponseInit = {}): ReturnType<typeof vi.fn> {
  return vi.fn(async () => new Response(body as BodyInit, { status: 200, ...init }));
}

describe("treasury history envelope: exact read", () => {
  it("maps a fully valid read envelope to dated points and preserves clocks and source", () => {
    const result = parseTreasuryHistoryEnvelope(readEnvelope, READ_WINDOW);
    expect(result).toMatchObject({
      schema: "treasury.daily_history.v1",
      status: "read",
      reason: null,
      unit: "percent_per_annum",
      basis: "investment",
      requested: { start: "2026-09-01", end: "2026-09-30", expected_through: "2026-09-30" },
    });
    if (result.status !== "read") throw new Error("expected read");
    expect(result.points).toEqual([
      { date: "2026-09-01", close: 4.32 },
      { date: "2026-09-02", close: 4.35 },
      { date: "2026-09-03", close: 4.31 },
      { date: "2026-09-04", close: 4.28 },
      { date: "2026-09-30", close: 4.4 },
    ]);
    expect(result.coverage).toEqual({
      observation_count: 5,
      requested_calendar_days: 30,
      first: "2026-09-01",
      last: "2026-09-30",
    });
    expect(result.clocks).toEqual(clocksFixture(READ_AT));
    expect(result.source.sha256).toBe(SHA_HEX);
    expect(result.source.last_observation_date).toBe("2026-09-30");
    expect(result.source.publication_status).toBe("not_qualified");
  });

  it("maps a stale envelope: dated points retained, status stale, before_expected_through", () => {
    const result = parseTreasuryHistoryEnvelope(staleEnvelope, STALE_WINDOW);
    expect(result).toMatchObject({
      status: "stale",
      reason: null,
      requested: STALE_WINDOW,
    });
    if (result.status !== "stale") throw new Error("expected stale");
    expect(result.points).toEqual([
      { date: "2026-09-30", close: 4.4 },
      { date: "2026-10-01", close: 4.41 },
      { date: "2026-10-13", close: 4.52 },
    ]);
    expect(result.coverage.requested_calendar_days).toBe(50);
    expect(result.coverage.last).toBe("2026-10-13");
  });

  it("accepts negative finite yields unchanged", () => {
    const raw = mutateEnvelope((envelope) => {
      envelope.points = [
        { date: "2026-09-01", value: -0.25 },
        { date: "2026-09-30", value: -0.0 },
      ];
      envelope.coverage = { observation_count: 2, requested_calendar_days: 30, first: "2026-09-01", last: "2026-09-30" };
    });
    const result = parseTreasuryHistoryEnvelope(raw, READ_WINDOW);
    if (result.status !== "read") throw new Error("expected read");
    expect(result.points).toEqual([
      { date: "2026-09-01", close: -0.25 },
      { date: "2026-09-30", close: -0.0 },
    ]);
  });

  it("preserves unknown release/knowledge/vintage clocks as null and valid ones verbatim", () => {
    const unknown = parseTreasuryHistoryEnvelope(readEnvelope, READ_WINDOW);
    if (unknown.status !== "read") throw new Error("expected read");
    expect(unknown.clocks).toEqual({ read_at: READ_AT, release_at: null, knowledge_at: null, vintage_at: null });

    const raw = mutateEnvelope((envelope) => {
      envelope.clocks = {
        read_at: READ_AT,
        release_at: "2026-10-05T16:00:00Z",
        knowledge_at: "2026-10-05T16:00:00.123456+00:00",
        vintage_at: "2026-09-25T00:00:00-04:00",
      };
    });
    const result = parseTreasuryHistoryEnvelope(raw, READ_WINDOW);
    if (result.status !== "read") throw new Error("expected read");
    expect(result.clocks).toEqual({
      read_at: READ_AT,
      release_at: "2026-10-05T16:00:00Z",
      knowledge_at: "2026-10-05T16:00:00.123456+00:00",
      vintage_at: "2026-09-25T00:00:00-04:00",
    });
  });
});

describe("treasury history envelope: missing producer states", () => {
  it("treats a structurally valid missing envelope as missing", () => {
    const result = parseTreasuryHistoryEnvelope(missingEnvelope, READ_WINDOW);
    expect(result).toMatchObject({
      status: "missing",
      reason: null,
      producer_status: "unavailable",
      producer_reason: "missing",
      unit: "percent_per_annum",
      basis: "investment",
      points: [],
      coverage: { observation_count: 0, requested_calendar_days: 30, first: null, last: null },
      clocks: clocksFixture(READ_AT),
    });
  });

  it("treats empty and no_coverage as missing while preserving their source facts", () => {
    const empty = parseTreasuryHistoryEnvelope(emptyEnvelope, READ_WINDOW);
    expect(empty).toMatchObject({ status: "missing", producer_reason: "empty" });
    const noCoverage = parseTreasuryHistoryEnvelope(noCoverageEnvelope, READ_WINDOW);
    expect(noCoverage).toMatchObject({ status: "missing", producer_reason: "no_coverage" });
    if (noCoverage.status !== "missing") throw new Error("expected missing");
    expect(noCoverage.source.last_observation_date).toBe("2026-08-31");
    expect(noCoverage.source.sha256).toBe(SHA_HEX);
  });

  it("rejects unavailable states outside the missing family", () => {
    expectUnreadable(envelopeFixture("unavailable", "invalid", READ_WINDOW, [], null, null), READ_WINDOW, "malformed_envelope");
    expectUnreadable(envelopeFixture("unavailable", "unreadable", READ_WINDOW, [], null, null), READ_WINDOW, "malformed_envelope");
    expectUnreadable(envelopeFixture("unavailable", "oversized", READ_WINDOW, [], null, null), READ_WINDOW, "malformed_envelope");
    expectUnreadable(envelopeFixture("unavailable", null, READ_WINDOW, [], null, null), READ_WINDOW, "malformed_envelope");
  });
});

describe("treasury history window rules", () => {
  it("accepts exact windows and reports no current-date invention", () => {
    expect(validateTreasuryHistoryWindow(READ_WINDOW)).toEqual({
      start: "2026-09-01",
      end: "2026-09-30",
      expected_through: "2026-09-30",
    });
    // Future-dated end is the producer's clock decision, not the consumer's.
    expect(validateTreasuryHistoryWindow({ start: "2026-09-01", end: "2026-12-31", expected_through: "2026-12-31" })).not.toBeNull();
  });

  it("enforces the 3660-day span boundary", () => {
    const endMs = Date.UTC(2026, 9, 19);
    const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const maxSpan = {
      start: iso(endMs - (3660 - 1) * 86400000),
      end: "2026-10-19",
      expected_through: "2026-10-19",
    };
    expect(validateTreasuryHistoryWindow(maxSpan)).not.toBeNull();
    const overSpan = {
      start: iso(endMs - 3660 * 86400000),
      end: "2026-10-19",
      expected_through: "2026-10-19",
    };
    expect(validateTreasuryHistoryWindow(overSpan)).toBeNull();
  });

  it("rejects impossible dates and ordering violations with zero transport use", () => {
    expect(validateTreasuryHistoryWindow({ start: "2026-02-30", end: "2026-09-30", expected_through: "2026-09-30" })).toBeNull();
    expect(validateTreasuryHistoryWindow({ start: "2026-13-01", end: "2026-09-30", expected_through: "2026-09-30" })).toBeNull();
    expect(validateTreasuryHistoryWindow({ start: "2026-09-30", end: "2026-09-01", expected_through: "2026-09-15" })).toBeNull();
    expect(validateTreasuryHistoryWindow({ start: "2026-09-01", end: "2026-09-30", expected_through: "2026-10-01" })).toBeNull();
    expect(validateTreasuryHistoryWindow({ start: "2026-09-01", end: "2026-09-30", expected_through: "2026-08-31" })).toBeNull();
    expect(validateTreasuryHistoryWindow({ start: "2026-9-1", end: "2026-09-30", expected_through: "2026-09-30" })).toBeNull();
    expect(parseTreasuryHistoryEnvelope(readEnvelope, { start: "2026-02-30", end: "2026-09-30", expected_through: "2026-09-30" })).toMatchObject({
      status: "unreadable",
      reason: "invalid_request",
      requested: null,
    });
  });
});

describe("treasury history envelope: malformed rejection", () => {
  it("rejects schema, unit and basis mismatch", () => {
    expectUnreadable(mutateEnvelope((envelope) => { envelope.schema = "treasury.daily_history.v2"; }), READ_WINDOW, "schema_mismatch");
    expectUnreadable(mutateEnvelope((envelope) => { envelope.schema = 42; }), READ_WINDOW, "schema_mismatch");
    expectUnreadable(mutateEnvelope((envelope) => { envelope.unit = "percent"; }), READ_WINDOW, "malformed_envelope");
    expectUnreadable(mutateEnvelope((envelope) => { envelope.basis = "cash"; }), READ_WINDOW, "malformed_envelope");
    expectUnreadable(mutateEnvelope((envelope) => { delete envelope.unit; }), READ_WINDOW, "malformed_envelope");
  });

  it("rejects non-object payloads and unknown extra keys", () => {
    expectUnreadable(null, READ_WINDOW, "malformed_envelope");
    expectUnreadable("read", READ_WINDOW, "malformed_envelope");
    expectUnreadable([], READ_WINDOW, "malformed_envelope");
    expectUnreadable(JSON.parse("1e999"), READ_WINDOW, "malformed_envelope");
    expectUnreadable(mutateEnvelope((envelope) => { envelope.extra = 1; }), READ_WINDOW, "malformed_envelope");
    expectUnreadable(mutateEnvelope((envelope) => { delete envelope.clocks; }), READ_WINDOW, "malformed_envelope");
  });

  it("rejects a requested block that does not match the exact request", () => {
    expectUnreadable(mutateEnvelope((envelope) => {
      envelope.requested = { start: "2026-09-02", end: "2026-09-30", expected_through: "2026-09-30" };
    }), READ_WINDOW, "malformed_envelope");
    expectUnreadable(readEnvelope, STALE_WINDOW, "malformed_envelope");
  });

  it("rejects point-level defects: missing value, duplicates, unsorted, impossible, outside, nonfinite, after read", () => {
    expectUnreadable(mutateEnvelope((envelope) => {
      envelope.points = [{ date: "2026-09-01" }];
    }), READ_WINDOW, "malformed_envelope");
    expectUnreadable(mutateEnvelope((envelope) => {
      envelope.points = [{ value: 4.32 }];
    }), READ_WINDOW, "malformed_envelope");
    expectUnreadable(mutateEnvelope((envelope) => {
      envelope.points = [...READ_POINTS, { date: "2026-09-30", value: 4.41 }];
    }), READ_WINDOW, "malformed_envelope");
    expectUnreadable(mutateEnvelope((envelope) => {
      envelope.points = [{ date: "2026-09-30", value: 4.4 }, { date: "2026-09-01", value: 4.32 }];
      envelope.coverage = { observation_count: 2, requested_calendar_days: 30, first: "2026-09-30", last: "2026-09-01" };
    }), READ_WINDOW, "malformed_envelope");
    expectUnreadable(mutateEnvelope((envelope) => {
      envelope.points = [{ date: "2026-02-30", value: 4.32 }, { date: "2026-09-30", value: 4.4 }];
    }), READ_WINDOW, "malformed_envelope");
    expectUnreadable(mutateEnvelope((envelope) => {
      envelope.points = [{ date: "2026-08-31", value: 4.32 }, { date: "2026-09-30", value: 4.4 }];
    }), READ_WINDOW, "malformed_envelope");
    expectUnreadable(mutateEnvelope((envelope) => {
      envelope.points = [{ date: "2026-09-01", value: 4.32 }, { date: "2026-10-01", value: 4.4 }];
    }), READ_WINDOW, "malformed_envelope");
    expectUnreadable(mutateEnvelope((envelope) => {
      envelope.points = [{ date: "2026-09-01", value: Number.POSITIVE_INFINITY }, { date: "2026-09-30", value: 4.4 }];
    }), READ_WINDOW, "malformed_envelope");
    expectUnreadable(mutateEnvelope((envelope) => {
      envelope.points = [{ date: "2026-09-01", value: "4.32" }, { date: "2026-09-30", value: 4.4 }];
    }), READ_WINDOW, "malformed_envelope");
    expectUnreadable(mutateEnvelope((envelope) => {
      envelope.points = [{ date: "2026-09-01", value: 4.32, close: 4.32 }];
    }), READ_WINDOW, "malformed_envelope");
    expectUnreadable(mutateEnvelope((envelope) => {
      envelope.points = [{ date: "2026-09-30", value: 4.4, read_only: true }];
    }), READ_WINDOW, "malformed_envelope");
  });

  it("rejects points dated after the read_at day", () => {
    const raw = mutateEnvelope((envelope) => {
      envelope.clocks = clocksFixture("2026-09-15T00:00:00+00:00");
      envelope.points = [{ date: "2026-09-30", value: 4.4 }];
      envelope.coverage = { observation_count: 1, requested_calendar_days: 30, first: "2026-09-30", last: "2026-09-30" };
      envelope.source = sourceFixture("2026-09-30", SHA_HEX);
    });
    expectUnreadable(raw, READ_WINDOW, "malformed_envelope");
  });

  it("rejects coverage mismatch: count, first, last, requested_calendar_days", () => {
    expectUnreadable(mutateEnvelope((envelope) => {
      envelope.coverage = { ...envelope.coverage as object, observation_count: 4 };
    }), READ_WINDOW, "malformed_envelope");
    expectUnreadable(mutateEnvelope((envelope) => {
      envelope.coverage = { ...envelope.coverage as object, first: "2026-09-02" };
    }), READ_WINDOW, "malformed_envelope");
    expectUnreadable(mutateEnvelope((envelope) => {
      envelope.coverage = { ...envelope.coverage as object, last: "2026-09-29" };
    }), READ_WINDOW, "malformed_envelope");
    expectUnreadable(mutateEnvelope((envelope) => {
      envelope.coverage = { ...envelope.coverage as object, requested_calendar_days: 31 };
    }), READ_WINDOW, "malformed_envelope");
  });

  it("rejects read/stale status inconsistency with the actual last point", () => {
    expectUnreadable(mutateEnvelope((envelope) => {
      envelope.status = "stale";
      envelope.reason = "before_expected_through";
    }), READ_WINDOW, "malformed_envelope");
    const staleAsRead = structuredClone(staleEnvelope) as Record<string, unknown>;
    (staleAsRead as { status: string }).status = "read";
    (staleAsRead as { reason: unknown }).reason = null;
    expectUnreadable(staleAsRead, STALE_WINDOW, "malformed_envelope");
    expectUnreadable(mutateEnvelope((envelope) => {
      envelope.reason = "some_reason";
    }), READ_WINDOW, "malformed_envelope");
    const staleNoReason = structuredClone(staleEnvelope) as Record<string, unknown>;
    (staleNoReason as { reason: unknown }).reason = null;
    expectUnreadable(staleNoReason, STALE_WINDOW, "malformed_envelope");
  });

  it("rejects inconsistent last_observation_date and sha256 facts", () => {
    expectUnreadable(mutateEnvelope((envelope) => {
      envelope.source = sourceFixture(null, SHA_HEX);
    }), READ_WINDOW, "malformed_envelope");
    expectUnreadable(mutateEnvelope((envelope) => {
      envelope.source = sourceFixture("2026-09-29", SHA_HEX);
    }), READ_WINDOW, "malformed_envelope");
    expectUnreadable(mutateEnvelope((envelope) => {
      envelope.clocks = clocksFixture("2026-10-01T12:00:00+00:00");
      envelope.source = sourceFixture("2026-10-05", SHA_HEX);
    }), READ_WINDOW, "malformed_envelope");
    expectUnreadable(mutateEnvelope((envelope) => {
      envelope.source = sourceFixture("2026-09-30", "deadbeef");
    }), READ_WINDOW, "malformed_envelope");
    expectUnreadable(mutateEnvelope((envelope) => {
      envelope.source = sourceFixture("2026-09-30", SHA_HEX.toUpperCase());
    }), READ_WINDOW, "malformed_envelope");
    expectUnreadable(mutateEnvelope((envelope) => {
      envelope.source = sourceFixture("2026-09-30", null);
    }), READ_WINDOW, "malformed_envelope");
  });

  it("rejects source identity substitution and unknown clocks", () => {
    expectUnreadable(mutateEnvelope((envelope) => {
      envelope.source = sourceFixture("2026-09-30", SHA_HEX);
      (envelope.source as { native_alias: string }).native_alias = "dtb3";
    }), READ_WINDOW, "malformed_envelope");
    expectUnreadable(mutateEnvelope((envelope) => {
      envelope.source = sourceFixture("2026-09-30", SHA_HEX);
      (envelope.source as { source_id: string }).source_id = "DTB3";
    }), READ_WINDOW, "malformed_envelope");
    expectUnreadable(mutateEnvelope((envelope) => {
      envelope.source = sourceFixture("2026-09-30", SHA_HEX);
      (envelope.source as { origin: string }).origin = "Board";
    }), READ_WINDOW, "malformed_envelope");
    expectUnreadable(mutateEnvelope((envelope) => {
      envelope.source = sourceFixture("2026-09-30", SHA_HEX);
      (envelope.source as { native_path: string }).native_path = "data/fred/DTB3.parquet";
    }), READ_WINDOW, "malformed_envelope");
    expectUnreadable(mutateEnvelope((envelope) => {
      envelope.clocks = { read_at: "not-a-time", release_at: null, knowledge_at: null, vintage_at: null };
    }), READ_WINDOW, "malformed_envelope");
    expectUnreadable(mutateEnvelope((envelope) => {
      envelope.clocks = { read_at: READ_AT, release_at: "soon", knowledge_at: null, vintage_at: null };
    }), READ_WINDOW, "malformed_envelope");
  });

  it("rejects empty families that are not structurally valid", () => {
    expectUnreadable(mutateEnvelope((envelope) => {
      envelope.status = "unavailable";
      envelope.reason = "missing";
      envelope.points = [{ date: "2026-09-01", value: 4.32 }];
    }), READ_WINDOW, "malformed_envelope");
    expectUnreadable(envelopeFixture("unavailable", "missing", READ_WINDOW, [], "2026-08-31", SHA_HEX), READ_WINDOW, "malformed_envelope");
    expectUnreadable(envelopeFixture("unavailable", "no_coverage", READ_WINDOW, [], null, null), READ_WINDOW, "malformed_envelope");
    expectUnreadable(envelopeFixture("unavailable", "no_coverage", READ_WINDOW, [], "2026-09-15", SHA_HEX), READ_WINDOW, "malformed_envelope");
  });
});

describe("treasury history transport", () => {
  it("issues exactly one GET with the exact encoded query and guarded init", async () => {
    const fetchImpl = mockFetch(JSON.stringify(readEnvelope));
    const result = await fetchTreasuryHistory(READ_WINDOW, "test-token", { fetchImpl });
    expect(result.status).toBe("read");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8000/api/internal/treasury-history?start=2026-09-01&end=2026-09-30&expected_through=2026-09-30");
    expect(init.method).toBe("GET");
    expect(init.cache).toBe("no-store");
    expect(init.redirect).toBe("manual");
    expect(init.credentials).toBe("omit");
    expect(init.body).toBeUndefined();
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer test-token");
    expect(headers.has("Cookie")).toBe(false);
    const headerKeys = Object.keys(init.headers as Record<string, string>);
    expect(headerKeys).toEqual(["Authorization"]);
  });

  it("reaches the bracketed IPv6 literal and tolerates one trailing slash", async () => {
    const v6 = mockFetch(JSON.stringify(readEnvelope));
    const resultV6 = await fetchTreasuryHistory(READ_WINDOW, "test-token", { fetchImpl: v6, baseUrl: "http://[::1]:8000" });
    expect(resultV6.status).toBe("read");
    expect(v6.mock.calls[0]?.[0]).toBe("http://[::1]:8000/api/internal/treasury-history?start=2026-09-01&end=2026-09-30&expected_through=2026-09-30");
    const slashed = mockFetch(JSON.stringify(readEnvelope));
    await fetchTreasuryHistory(READ_WINDOW, "test-token", { fetchImpl: slashed, baseUrl: "http://127.0.0.1:8000/" });
    expect(slashed.mock.calls[0]?.[0]).toBe("http://127.0.0.1:8000/api/internal/treasury-history?start=2026-09-01&end=2026-09-30&expected_through=2026-09-30");
  });

  it("refuses hostile origins with zero fetch calls", async () => {
    const hostile = [
      "http://localhost:8000",
      "https://127.0.0.1:8000",
      "http://127.0.0.1",
      "http://127.0.0.1:8001",
      "http://127.1:8000",
      "http://127.0.0.1.:8000",
      "http://0x7f.0.0.1:8000",
      "http://0x7f000001:8000",
      "http://0177.0.0.1:8000",
      "http://2130706433:8000",
      "http://user@127.0.0.1:8000",
      "http://user:pass@127.0.0.1:8000",
      "http://127.0.0.1:8000/api",
      "http://127.0.0.1:8000?x=1",
      "http://127.0.0.1:8000#frag",
      "http://127.0.0.1:8000//",
      "http://127.0.0.1:8000%2F",
      "http://127.0.0.1:8000/.",
      " http://127.0.0.1:8000",
      "http://127.0.0.1:8000 ",
      "http://127.0.0.1:8000\\",
      "http://[::1]:8001",
      "http://[::1]",
      "http://[127.0.0.1]:8000",
      "http://127.0.0.1:8000.",
      "ftp://127.0.0.1:8000",
      "",
    ];
    for (const base of hostile) {
      const fetchImpl = mockFetch(JSON.stringify(readEnvelope));
      const result = await fetchTreasuryHistory(READ_WINDOW, "test-token", { fetchImpl, baseUrl: base });
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(result).toMatchObject({ status: "unreadable", reason: "untrusted_origin" });
      expect(resolveFlowBase(base)).toBeNull();
    }
  });

  it("makes zero fetch calls for invalid windows and invalid tokens", async () => {
    const badWindow = mockFetch(JSON.stringify(readEnvelope));
    const badWindowResult = await fetchTreasuryHistory({ start: "2026-09-30", end: "2026-09-01", expected_through: "2026-09-15" }, "test-token", { fetchImpl: badWindow });
    expect(badWindowResult).toMatchObject({ status: "unreadable", reason: "invalid_request" });
    expect(badWindow).not.toHaveBeenCalled();

    const emptyToken = mockFetch(JSON.stringify(readEnvelope));
    const emptyTokenResult = await fetchTreasuryHistory(READ_WINDOW, "", { fetchImpl: emptyToken });
    expect(emptyTokenResult).toMatchObject({ status: "unreadable", reason: "invalid_token" });
    expect(emptyToken).not.toHaveBeenCalled();

    const spacedToken = mockFetch(JSON.stringify(readEnvelope));
    const spacedTokenResult = await fetchTreasuryHistory(READ_WINDOW, "test token", { fetchImpl: spacedToken });
    expect(spacedTokenResult).toMatchObject({ status: "unreadable", reason: "invalid_token" });
    expect(spacedToken).not.toHaveBeenCalled();
  });

  it("never follows redirects and retries nothing", async () => {
    const fetchImpl = mockFetch("", { status: 302, headers: { Location: "http://127.0.0.1:9/elsewhere" } });
    const result = await fetchTreasuryHistory(READ_WINDOW, "test-token", { fetchImpl });
    expect(result).toMatchObject({ status: "unreadable", reason: "redirect_response", http_status: 302 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("surfaces HTTP failures as sanitized unreadable without retry", async () => {
    for (const status of [401, 403, 500]) {
      const fetchImpl = mockFetch(JSON.stringify({ error: "denied" }), { status });
      const result = await fetchTreasuryHistory(READ_WINDOW, "test-token", { fetchImpl });
      expect(result).toMatchObject({ status: "unreadable", reason: "http_error", http_status: status, detail: null });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it("classifies transport throws and aborts without leaking error text", async () => {
    const throwing = vi.fn(async () => {
      throw new Error("boom: secret detail");
    });
    const thrown = await fetchTreasuryHistory(READ_WINDOW, "test-token", { fetchImpl: throwing });
    expect(thrown).toMatchObject({ status: "unreadable", reason: "transport_error", detail: null });
    expect(JSON.stringify(thrown)).not.toContain("boom");

    const aborting = vi.fn(async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    });
    const aborted = await fetchTreasuryHistory(READ_WINDOW, "test-token", { fetchImpl: aborting });
    expect(aborted).toMatchObject({ status: "unreadable", reason: "timeout" });
  });

  it("enforces the 1MiB body bound and strict encoding", async () => {
    const oversized = mockFetch("x".repeat(1024 * 1024 + 16));
    const oversizeResult = await fetchTreasuryHistory(READ_WINDOW, "test-token", { fetchImpl: oversized });
    expect(oversizeResult).toMatchObject({ status: "unreadable", reason: "body_limit_exceeded" });

    const notUtf8 = mockFetch(new Uint8Array([0xff, 0xfe, 0x00]));
    const encodingResult = await fetchTreasuryHistory(READ_WINDOW, "test-token", { fetchImpl: notUtf8 });
    expect(encodingResult).toMatchObject({ status: "unreadable", reason: "encoding_error" });

    const notJson = mockFetch("{definitely not json");
    const jsonResult = await fetchTreasuryHistory(READ_WINDOW, "test-token", { fetchImpl: notJson });
    expect(jsonResult).toMatchObject({ status: "unreadable", reason: "malformed_envelope" });

    const nonFinite = mockFetch(JSON.stringify(readEnvelope).replace('"value":4.4', '"value":1e999'));
    const nonFiniteResult = await fetchTreasuryHistory(READ_WINDOW, "test-token", { fetchImpl: nonFinite });
    expect(nonFiniteResult).toMatchObject({ status: "unreadable", reason: "malformed_envelope" });
  });

  it("returns the typed read result end to end over the mocked transport", async () => {
    const fetchImpl = mockFetch(JSON.stringify(staleEnvelope));
    const result = await fetchTreasuryHistory(STALE_WINDOW, "test-token", { fetchImpl });
    expect(result).toMatchObject({ status: "stale", reason: null, requested: STALE_WINDOW });
    if (result.status !== "stale") throw new Error("expected stale");
    expect(result.points[0]).toEqual({ date: "2026-09-30", close: 4.4 });
  });
});

// Regressions from an independent join against actual Python producer envelopes.
describe("native Python date and read-clock contract", () => {
  it.each([
    ["read", readEnvelope],
    ["stale", staleEnvelope],
    ["missing", missingEnvelope],
    ["no_coverage", noCoverageEnvelope],
  ])("rejects %s when its requested end follows the producer read day", (_name, fixture) => {
    const input = structuredClone(fixture);
    input.requested.end = "2026-10-21";
    input.coverage.requested_calendar_days = 51;
    // All points/source dates remain before read_at; only the window is impossible.
    expectUnreadable(input, input.requested, "malformed_envelope");
  });

  it("rejects year zero, matching Python date.fromisoformat", () => {
    expect(validateTreasuryHistoryWindow({start:"0000-01-01",end:"0000-01-01",expected_through:"0000-01-01"})).toBeNull();
  });

  it("preserves a valid two-day window across ISO years 0099 and 0100", () => {
    const window = {start:"0099-12-31",end:"0100-01-01",expected_through:"0100-01-01"};
    expect(validateTreasuryHistoryWindow(window)).toEqual(window);
  });

  it("rejects the reviewer's 1900-year window rather than remapping it to one day", () => {
    expect(validateTreasuryHistoryWindow({start:"0050-01-01",end:"1950-01-01",expected_through:"0050-01-01"})).toBeNull();
  });
});
