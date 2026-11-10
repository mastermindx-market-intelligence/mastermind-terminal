/** Synthetic transport for existing component/browser fixtures only.
 * This is not a publisher or production source. The separate captured preview
 * JSON fixture retains actual Macro capture/publisher/API output for parity proof.
 */
import { createHash } from "node:crypto";

/** An explicitly synthetic, owner-coherent parent for the November 5 exact
 * companion. No legacy 21/63 observation is inferred from those exact windows. */
export function syntheticExactParent(read: unknown) {
  return {
    schema: "leadership_rotation_context.measured_group_read/v1", status: "unavailable",
    generation: { benchmark: "SPY", cohort_id: "us_sectors_11", price_basis: "total_return",
      session_end: "2026-11-05", id: "2026-11-05|SPY|us_sectors_11" },
    cohort: { expected_n: 11, measured_n: 0, horizon: "rs_63d" },
    groups: ["XLB", "XLC", "XLE", "XLF", "XLI", "XLK", "XLP", "XLRE", "XLU", "XLV", "XLY"].map(group_id => ({
      group_id, group_kind: "sector",
      current: { status: "unmeasured", reason: "missing_input", rank: null, rs_21d: null, rs_63d: null },
    })),
    sector_window_measurements: read,
  };
}

export function nativeGenerationFixture(core: Record<string, unknown>, revision = "initial") {
  const session = String(core.as_of);
  const sectors: Record<string, unknown>[] = (core.sectors as Record<string, unknown>[]).map(row => ({ ...row, kind: "sector" }));
  const data = {
    schema: "sector_native_view.v1", audience: "preview",
    core: { ...core, sectors },
    history: {
      meta: { asOf: session, rs_history: { schema: "sector_cycles.rs_history.v1", mode: "reconstructed_price_history",
        naturally_observed: false, basis: "tr", benchmark: "SPY", horizons_sessions: [21, 63], max_points_per_sector: 252 } },
      sectors: sectors.map(row => ({ id: row.id, ticker: row.ticker, kind: "sector", rs_history: [], turns: [] })),
    },
    brief: { as_of: session, status: "available", headline: { en: "Synthetic fixture", zh: "合成测试数据" },
      leadership: null, comparison: null, factor_season: null },
    action_board: { as_of: session },
  };
  const published = session + "T23:00:00Z";
  return { schema: "sector_generation.read/v1", audience: "preview", source_session: session,
    published_at: published, qualification: "accepted", projection: { data, receipt: {
      schema: "sector_native_view.receipt.v1", source: "macro.sector",
      generation_id: `synthetic-sector-${revision.replace(/[^A-Za-z0-9_.-]/g, "-").slice(0,80)}`, source_session: session, published_at: published,
      qualification: "accepted", input_version: "terminal-contract-fixture", baseline_session: null,
      content_sha256: createHash("sha256").update(JSON.stringify(data)).digest("hex"),
    } } };
}
