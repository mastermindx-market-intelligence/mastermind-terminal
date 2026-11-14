import type { Page } from "@playwright/test";
import { ROTATION_READ_COPY } from "../lib/prophetRotationRead";

/** Synthetic SI ruling 63 contract data, not published market evidence. */
export function rotationReadFixture() {
  return {
    schema: "si.rotation_read/v1", as_of: "2026-11-06", built_at: "2026-11-07T01:00:00Z",
    status: "ok", basis: "current_roster", copy: ROTATION_READ_COPY,
    groups: [{
      group_id: "industrials", family: "sector", name: "Industrials", parent: null,
      as_of: "2026-11-06", status: "ok", unavailable_reason: null,
      n_members: 50, n_counted: 48, pct_above_200: 70, chg_13w: 12, chg_26w: -4,
      direction: "improving", run_weeks: 3, rank_13w: 2, n_ranked: 11,
    }],
    companies: { CARR: { sector: "industrials", themes: [] as string[] } },
  };
}
export type RotationArrivalStage = "unknown_source" | "missing_file" | "ready" | "stale" | "unavailable" | "signed_out";

/** Intercept only this feed, leaving every other SI read unchanged. */
export async function stubRotationReadArrival(page: Page, stage: RotationArrivalStage) {
  await page.route(url => url.pathname === "/api/sector-intelligence"
    && url.searchParams.get("source") === "rotation_read", route => {
    if (stage === "unknown_source") return route.fulfill({ status: 400, json: { error: "invalid_source" } });
    const receipt = {
      source: "rotation_read", path: "/sectordata/rotation_read.json",
      status: "ready", asOf: "2026-11-06",
    };
    if (stage === "missing_file" || stage === "signed_out") {
      return route.fulfill({ status: stage === "signed_out" ? 401 : 404, json: {
        data: null, receipt: { ...receipt,
          status: stage === "signed_out" ? "access" : "unavailable",
          failure: stage === "signed_out" ? "access_denied" : "upstream_not_found",
        },
      } });
    }
    return route.fulfill({ status: 200, json: {
      data: { ...rotationReadFixture(), status: stage === "ready" ? "ok" : stage }, receipt,
    } });
  });
}
