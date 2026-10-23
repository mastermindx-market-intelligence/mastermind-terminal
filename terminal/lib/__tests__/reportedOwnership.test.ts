import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  contentDigestInput,
  deriveReportedPercent,
  formatReportedPercent,
  formatReportedShares,
  isAcquisitionStale,
  isReportedOwnershipSymbol,
  reportedOwnershipMarket,
  reportedOwnershipSourceUrl,
  sha256Hex,
  validateReportedOwnershipStructure,
  verifyReportedOwnership,
  type ReportedOwnershipBlock,
} from "@/lib/reportedOwnership";
import blockFixture from "./fixtures/reported_ownership/ca_block.json";

// The same golden the Python normalizer asserts (tests/test_reported_ownership.py). It is produced
// by `ingest/reported_ownership.py` from the synthetic raw fixture and re-hashed here through
// JSON.stringify, so agreement is evidence the canonical form is byte-identical across runtimes.
const GOLDEN_CONTENT_SHA256 = "6d895c41f7b2af4d5ab2b0d7aee2ab0611d4e4574eb6ce3939ff69ba03f0777e";
const NOW = Date.parse("2026-10-25T00:00:00Z");

function fixture(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(blockFixture)) as Record<string, unknown>;
}

/** Typed accessors for mutating one field of the draft block without reaching for `any`. */
function rowsOf(draft: Record<string, unknown>): Record<string, unknown>[] {
  return draft.rows as Record<string, unknown>[];
}
function sourceOf(draft: Record<string, unknown>): Record<string, unknown> {
  return draft.source as Record<string, unknown>;
}
function firstRow(draft: Record<string, unknown>): Record<string, unknown> {
  return rowsOf(draft)[0];
}

/** A structurally valid block, so each test can invalidate exactly one thing. */
async function sealed(mutate?: (draft: Record<string, unknown>) => void): Promise<Record<string, unknown>> {
  const draft = fixture();
  mutate?.(draft);
  draft.content_sha256 = await sha256Hex(contentDigestInput(draft));
  return draft;
}

async function rejects(draft: Record<string, unknown>, ticker = "RY.TO"): Promise<string> {
  const result = await verifyReportedOwnership(draft, { ticker, nowMs: NOW });
  expect(result.ok).toBe(false);
  return result.ok ? "" : result.code;
}

// ── the cross-language golden ────────────────────────────────────────────────
describe("cross-language hash golden", () => {
  it("the checked-in Terminal fixture carries the normalizer's content hash", () => {
    expect(fixture().content_sha256).toBe(GOLDEN_CONTENT_SHA256);
  });

  it("recomputing the hash in JS reproduces the Python value byte for byte", async () => {
    expect(await sha256Hex(contentDigestInput(fixture()))).toBe(GOLDEN_CONTENT_SHA256);
  });

  it("accepts the sealed fixture for its own listing", async () => {
    const result = await verifyReportedOwnership(fixture(), { ticker: "RY.TO", nowMs: NOW });
    expect(result.ok).toBe(true);
  });

  it("canonical form sorts keys recursively and adds no whitespace", () => {
    expect(canonicalJson({ b: "1", a: { d: "2", c: "3" } })).toBe('{"a":{"c":"3","d":"2"},"b":"1"}');
  });

  it("leaves non-ASCII holder names unescaped, matching Python ensure_ascii=False", () => {
    expect(canonicalJson({ n: "中國信託金融控股" })).toBe('{"n":"中國信託金融控股"}');
    expect(contentDigestInput(fixture())).toContain("中國信託金融控股");
  });

  it("excludes only content_sha256 itself from the hashed content", async () => {
    const draft = fixture();
    const without = contentDigestInput(draft);
    draft.content_sha256 = "0".repeat(64);
    expect(contentDigestInput(draft)).toBe(without);
  });
});

// ── listing scope ────────────────────────────────────────────────────────────
describe("listing scope", () => {
  it("routes the regional listings and leaves US alone", () => {
    for (const symbol of ["RY.TO", "SHOP.V", "0700.HK", "600519.SS", "000001.SZ", "430047.BJ"]) {
      expect(isReportedOwnershipSymbol(symbol)).toBe(true);
    }
    expect(isReportedOwnershipSymbol("AAPL")).toBe(false);
    expect(isReportedOwnershipSymbol("BRK-B")).toBe(false);
  });

  it("maps only the markets this adapter qualifies", () => {
    expect(reportedOwnershipMarket("RY.TO")).toBe("ca");
    expect(reportedOwnershipMarket("SHOP.V")).toBe("ca");
    expect(reportedOwnershipMarket("0700.HK")).toBe("hk");
    expect(reportedOwnershipMarket("AAPL")).toBeNull();
    // CN is routed to the panel to render an absence, but this adapter does not qualify it.
    expect(reportedOwnershipMarket("600519.SS")).toBeNull();
  });

  it("refuses a block for a different symbol", async () => {
    await expect(rejects(fixture(), "SHOP.TO")).resolves.toBe("listing_ticker_mismatch");
  });

  it("refuses a block whose market disagrees with its ticker", async () => {
    const draft = await sealed((d) => {
      (d.listing as Record<string, unknown>).market = "hk";
    });
    await expect(rejects(draft)).resolves.toBe("listing_market_mismatch");
  });

  it("refuses a US symbol outright rather than reporting it as absent", async () => {
    await expect(rejects(fixture(), "AAPL")).resolves.toBe("market_unsupported");
  });
});

// ── schema and producer identity ─────────────────────────────────────────────
describe("schema and producer identity", () => {
  it("requires the exact schema and normalizer version", async () => {
    await expect(rejects(await sealed((d) => { d.schema = "mastermind.reported-ownership/v2"; }))).resolves.toBe(
      "schema_mismatch",
    );
    await expect(rejects(await sealed((d) => { d.normalizer_version = "2"; }))).resolves.toBe(
      "normalizer_version_mismatch",
    );
  });

  it("requires the vendor_institutional_holders population", async () => {
    await expect(rejects(await sealed((d) => { d.population = "13f_roster"; }))).resolves.toBe(
      "population_mismatch",
    );
  });

  it("requires the unspecified percentage basis", async () => {
    await expect(
      rejects(await sealed((d) => { d.percentage_basis = "shares_outstanding"; })),
    ).resolves.toBe("percentage_basis_mismatch");
  });

  it("requires the fixed source label and adapter, never provider HTML", async () => {
    await expect(rejects(await sealed((d) => { sourceOf(d).name = "Some Aggregator"; }))).resolves.toBe(
      "source_name_mismatch",
    );
    await expect(rejects(await sealed((d) => { sourceOf(d).field = "major_holders"; }))).resolves.toBe(
      "source_field_mismatch",
    );
    await expect(rejects(await sealed((d) => { sourceOf(d).adapter = "yahoo_scrape"; }))).resolves.toBe(
      "source_adapter_mismatch",
    );
  });

  it("requires the exact provider holders URL for this listing", async () => {
    await expect(rejects(await sealed((d) => { sourceOf(d).url = "https://example.com/whatever"; }))).resolves.toBe(
      "source_url_mismatch",
    );
    await expect(
      rejects(await sealed((d) => { sourceOf(d).url = reportedOwnershipSourceUrl("SHOP.TO"); })),
    ).resolves.toBe("source_url_mismatch");
  });

  it("never accepts a publication time: this adapter does not establish one", async () => {
    await expect(rejects(await sealed((d) => { d.publication_time = "2026-06-30T00:00:00Z"; }))).resolves.toBe(
      "publication_time_not_established",
    );
  });
});

// ── rows ─────────────────────────────────────────────────────────────────────
describe("row bounds", () => {
  it("rejects a non-finite numeric observation rather than nulling it", async () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const draft = await sealed((d) => {
        firstRow(d).reported_fraction = bad;
      });
      await expect(rejects(draft)).resolves.toBe("numeric_leaf_in_hashed_block");
    }
  });

  it("rejects any JSON number anywhere in the hashed block", async () => {
    await expect(rejects(await sealed((d) => { (d as { aggregate_count?: unknown }).aggregate_count = 3; }))).resolves.toBe(
      "numeric_leaf_in_hashed_block",
    );
    await expect(rejects(await sealed((d) => { firstRow(d).shares = 70220631; }))).resolves.toBe(
      "numeric_leaf_in_hashed_block",
    );
  });

  it("rejects an out-of-unit-interval fraction", async () => {
    for (const bad of ["1.4", "-0.01", "2", "1.00001"]) {
      const draft = await sealed((d) => {
        firstRow(d).reported_fraction = bad;
      });
      const code = await rejects(draft);
      expect(["row_fraction_out_of_bounds", "numeric_leaf_in_hashed_block"]).toContain(code);
    }
  });

  it("accepts the fraction bounds themselves", async () => {
    const draft = await sealed((d) => {
      firstRow(d).reported_fraction = "1";
    });
    expect((await verifyReportedOwnership(draft, { ticker: "RY.TO", nowMs: NOW })).ok).toBe(true);
  });

  it("rejects a share count that is not a non-negative integer string", async () => {
    for (const bad of ["70220631.5", "-1", "007", "1e3", ""]) {
      const draft = await sealed((d) => {
        firstRow(d).shares = bad;
      });
      await expect(rejects(draft)).resolves.toBe("row_shares_invalid");
    }
  });

  it("accepts a null share count as unknown rather than zero", async () => {
    const draft = await sealed((d) => {
      firstRow(d).shares = null;
      firstRow(d).reported_fraction = null;
    });
    const result = await verifyReportedOwnership(draft, { ticker: "RY.TO", nowMs: NOW });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.block.rows[0].shares).toBeNull();
      expect(formatReportedShares(result.block.rows[0].shares)).toBe("—");
      expect(formatReportedPercent(result.block.rows[0].reported_fraction)).toBe("—");
    }
  });

  it("rejects an undated or impossibly dated row", async () => {
    for (const bad of [null, "", "2026-6-30", "2026-02-30", "30/06/2026"]) {
      const draft = await sealed((d) => {
        firstRow(d).reported_date = bad;
      });
      await expect(rejects(draft)).resolves.toBe("row_date_invalid");
    }
  });

  it("rejects a future-dated report", async () => {
    const draft = await sealed((d) => {
      firstRow(d).reported_date = "2027-06-30";
    });
    await expect(rejects(draft)).resolves.toBe("row_date_after_acquisition");
  });

  it("rejects a blank holder name", async () => {
    const draft = await sealed((d) => {
      firstRow(d).holder_name = "   ";
    });
    await expect(rejects(draft)).resolves.toBe("row_holder_missing");
  });

  it("keeps each holder's own report date rather than collapsing them", async () => {
    const result = await verifyReportedOwnership(fixture(), { ticker: "RY.TO", nowMs: NOW });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.block.rows.map((row) => row.reported_date)).toEqual([
        "2026-06-30",
        "2026-06-30",
        "2026-03-31",
      ]);
    }
  });
});

// ── timestamps, receipt and failure state ────────────────────────────────────
describe("timestamps, receipt and failure state", () => {
  it("rejects a malformed or future acquisition timestamp", async () => {
    await expect(rejects(await sealed((d) => { d.acquired_at = "2026-10-22 04:52:16"; }))).resolves.toBe(
      "acquired_at_invalid",
    );
    await expect(rejects(await sealed((d) => { d.acquired_at = "2026-13-01T00:00:00Z"; }))).resolves.toBe(
      "acquired_at_invalid",
    );
    await expect(rejects(await sealed((d) => { d.acquired_at = "2027-01-01T00:00:00Z"; d.latest_attempt_at = "2027-01-01T00:00:00Z"; }))).resolves.toBe(
      "timestamp_in_future",
    );
  });

  it("requires a raw receipt whenever there are rows", async () => {
    await expect(rejects(await sealed((d) => { d.raw_input_sha256 = null; }))).resolves.toBe(
      "raw_input_sha256_missing",
    );
    await expect(rejects(await sealed((d) => { d.raw_input_sha256 = "abc"; }))).resolves.toBe(
      "raw_input_sha256_invalid",
    );
  });

  it("fails closed on a corrupted content hash", async () => {
    const draft = fixture();
    draft.content_sha256 = "0".repeat(64);
    await expect(rejects(draft)).resolves.toBe("content_hash_mismatch");
  });

  it("fails closed when a row was edited without resealing", async () => {
    const draft = fixture();
    firstRow(draft).shares = "999999999";
    await expect(rejects(draft)).resolves.toBe("content_hash_mismatch");
  });

  it("requires an explicit reason whenever the block is not available", async () => {
    const draft = await sealed((d) => {
      d.availability = "unavailable";
      d.rows = [];
      d.acquired_at = null;
      d.latest_attempt_at = null;
      d.raw_input_sha256 = null;
      d.unavailable_reason = "no_dated_rows";
    });
    expect((await verifyReportedOwnership(draft, { ticker: "RY.TO", nowMs: NOW })).ok).toBe(true);

    const silent = await sealed((d) => {
      d.availability = "unavailable";
      d.rows = [];
      d.acquired_at = null;
      d.latest_attempt_at = null;
      d.raw_input_sha256 = null;
      d.unavailable_reason = null;
    });
    await expect(rejects(silent)).resolves.toBe("absent_without_reason");

    const degradedButUnstated = await sealed((d) => {
      d.availability = "partial"; // rows survive, but nothing says why
      d.unavailable_reason = null;
    });
    await expect(rejects(degradedButUnstated)).resolves.toBe("degraded_without_reason");
  });

  it("rejects a block that claims availability with no rows", async () => {
    await expect(rejects(await sealed((d) => { d.rows = []; }))).resolves.toBe("available_without_rows");
  });

  it("rejects a malformed reason code", async () => {
    await expect(
      rejects(await sealed((d) => { d.availability = "partial"; d.unavailable_reason = "Because reasons"; })),
    ).resolves.toBe("unavailable_reason_invalid");
  });

  it("accepts retained rows whose acquisition did not advance", async () => {
    const draft = await sealed((d) => {
      d.availability = "partial";
      d.unavailable_reason = "fetch_field_error";
      d.latest_attempt_at = "2026-10-24T09:00:00Z"; // a real later attempt...
      // ...while acquired_at and every reported_date stay exactly where they were.
    });
    const result = await verifyReportedOwnership(draft, { ticker: "RY.TO", nowMs: NOW });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.block.acquired_at).toBe("2026-10-22T04:52:16Z");
      expect(result.block.latest_attempt_at).toBe("2026-10-24T09:00:00Z");
      expect(result.block.rows).toHaveLength(3);
      expect(result.block.availability).toBe("partial");
    }
  });

  it("rejects a retained block whose attempt is stamped in the future", async () => {
    const draft = await sealed((d) => {
      d.availability = "partial";
      d.unavailable_reason = "fetch_field_error";
      d.latest_attempt_at = "2026-11-30T09:00:00Z";
    });
    await expect(rejects(draft)).resolves.toBe("timestamp_in_future");
  });

  it("requires acquisition evidence for rows and leaves absent dates unknown", async () => {
    const undatedRows = await sealed((d) => {
      d.acquired_at = null;
      d.latest_attempt_at = null;
    });
    await expect(rejects(undatedRows)).resolves.toBe("rows_without_acquisition");
    const absence = await sealed((d) => {
      d.acquired_at = null;
      d.latest_attempt_at = null;
      d.raw_input_sha256 = null;
      d.rows = [];
      d.availability = "unavailable";
      d.unavailable_reason = "acquired_at_missing";
    });
    const result = await verifyReportedOwnership(absence, { ticker: "RY.TO", nowMs: NOW });
    expect(result.ok).toBe(true);
    expect(absence.acquired_at).toBeNull();
  });

  it("rejects an attempt clock before its acquired observation", async () => {
    await expect(rejects(await sealed((d) => {
      d.latest_attempt_at = "2026-10-01T00:00:00Z";
    }))).resolves.toBe("attempt_before_acquisition");
  });

  it("carries percent rounding into the whole part", () => {
    expect(formatReportedPercent("0.999999")).toBe("100%");
    expect(formatReportedPercent("0")).toBe("0%");
  });

  it("rejects non-objects and arrays outright", async () => {
    await expect(rejects(null as unknown as Record<string, unknown>)).resolves.toBe("not_an_object");
    await expect(rejects([] as unknown as Record<string, unknown>)).resolves.toBe("not_an_object");
    await expect(rejects("RY.TO" as unknown as Record<string, unknown>)).resolves.toBe("not_an_object");
  });

  it("honours an abort signal instead of returning a stale verdict", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await verifyReportedOwnership(fixture(), {
      ticker: "RY.TO",
      nowMs: NOW,
      signal: controller.signal,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("aborted");
  });
});

// ── staleness is about acquisition, never about report-date age ──────────────
describe("staleness", () => {
  it("marks a block stale only once its acquisition is old", () => {
    const THIRTY_DAYS = 30;
    expect(isAcquisitionStale("2026-10-22T04:52:16Z", NOW, THIRTY_DAYS)).toBe(false);
    expect(isAcquisitionStale("2026-08-01T00:00:00Z", NOW, THIRTY_DAYS)).toBe(true);
  });

  it("does not treat a fresh acquisition holding an old report date as stale", () => {
    // A provider that has simply not filed this quarter is not a broken feed.
    expect(isAcquisitionStale("2026-10-22T04:52:16Z", NOW, 30)).toBe(false);
  });

  it("never calls an unknown acquisition date stale", () => {
    expect(isAcquisitionStale(null, NOW, 30)).toBe(false);
    expect(isAcquisitionStale("", NOW, 30)).toBe(false);
    expect(isAcquisitionStale("not a date", NOW, 30)).toBe(false);
  });
});

// ── percentage units ─────────────────────────────────────────────────────────
describe("percentage derivation", () => {
  it("scales a fraction to a percent: 0.0507 reads as 5.07%", () => {
    expect(deriveReportedPercent("0.0507")).toBe("5.07");
    expect(formatReportedPercent("0.0507")).toBe("5.07%");
  });

  it("handles the unit-interval ends", () => {
    expect(formatReportedPercent("1")).toBe("100%");
    expect(formatReportedPercent("0")).toBe("0%");
  });

  it("trims trailing zeros without inventing precision", () => {
    expect(formatReportedPercent("0.05")).toBe("5%");
    expect(formatReportedPercent("0.5")).toBe("50%");
    expect(formatReportedPercent("0.123")).toBe("12.3%");
  });

  it("rounds to two decimals, half-up, in exact decimal arithmetic", () => {
    expect(formatReportedPercent("0.123456")).toBe("12.35%");
    expect(formatReportedPercent("0.999995")).toBe("100%");
    expect(formatReportedPercent("0.000001")).toBe("0%");
  });

  it("renders anything outside the bounded fraction as unknown", () => {
    for (const bad of [null, undefined, "", "abc", "-0.01", "1.4", "1e-3", "0x1"]) {
      expect(formatReportedPercent(bad as string | null)).toBe("—");
      expect(deriveReportedPercent(bad as string | null)).toBeNull();
    }
  });

  it("groups share counts for display and dashes an unknown count", () => {
    expect(formatReportedShares("70220631")).toBe("70,220,631");
    expect(formatReportedShares("999")).toBe("999");
    expect(formatReportedShares(null)).toBe("—");
    expect(formatReportedShares("70220631.5")).toBe("—");
  });

  it("never carries Value or pctChange through the reader", () => {
    const canonical = contentDigestInput(fixture());
    expect(canonical).not.toContain("19915975021");
    expect(canonical).not.toContain("pctChange");
    expect(canonical).not.toContain("pctHeld");
  });

  it("does not read the legacy undated top_inst field", async () => {
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await readFile(path.resolve(process.cwd(), "lib/reportedOwnership.ts"), "utf8");
    // Block comments are stripped first: the module's header explains, in prose, that the legacy
    // undated field exists and must not be used. What matters is that no executable code touches it.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toContain("top_inst");
    // It also never imports the fund contract, so it structurally cannot reach the field.
    expect(source).not.toMatch(/from\s+["'][^"']*\/fund["']/);
  });
});

// ── structure validator is usable without the async hash ─────────────────────
describe("synchronous structural validation", () => {
  it("reports the specific failure without needing WebCrypto", () => {
    const result = validateReportedOwnershipStructure(fixture(), { ticker: "RY.TO", nowMs: NOW });
    expect(result.ok).toBe(true);
    const bad = validateReportedOwnershipStructure({ schema: "nope" }, { ticker: "RY.TO", nowMs: NOW });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe("schema_mismatch");
  });

  it("exposes the block type for callers that hold a validated value", () => {
    const result = validateReportedOwnershipStructure(fixture(), { ticker: "RY.TO", nowMs: NOW });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const block: ReportedOwnershipBlock = result.block;
      expect(block.schema).toBe("mastermind.reported-ownership/v1");
      expect(block.rows[0].reported_fraction).toBe("0.0507");
    }
  });
});