import type { Page } from "@playwright/test";

/** The REAL 2026-11-09 CARR row from the Prophet board capture — committed
 * evidence, extended at the browser seam so the Setup's plan join selects
 * genuine values. Nothing here is invented: id, prices, conviction, thesis
 * and management note are the row's own. */
export const REAL_CARR_BOARD_PLAN = {
  id: "CARR-BULL-20261016",
  asset: "CARR",
  direction: "BULL",
  entry: 56.47,
  invalidation: 52.26,
  targets: [62.785, 69.1],
  trigger: 56.77,
  option_contract: null,
  _r_unit: 4.21,
  _conviction_score: 53,
  _signal_date: "2026-10-20",
  phase: "pre_trigger",
  management_confidence: 32.3,
  recommended_action: "wait",
  last_price: 52.38,
  state: {
    phase: "pre_trigger",
    management_confidence: 32.3,
    recommended_action: "wait",
    components: { validity: 0.1, progress: 0.0, pace: 24.9, retention: 50.0, overlay: 27.0 },
    geometry: {
      dist_to_stop_r: 0.029, dist_to_t1_r: 1.5, dist_to_t2_r: 3.0, horizon_pct_used: 42.2,
      p1: -0.6477, p2: -0.3238, p3: null, move_r: -0.971, mfe_r: 0.002, mae_r: -0.971,
    },
    change_reason: "",
  },
  what_to_do_now: [
    "A PIT price range or closing print touched the $55.72–$56.47 zone. This is not proof of order execution or of the separate closing trigger confirming.",
    "Any position remains conditional on the plan's separate trigger and risk rules, including the $52.26 invalidation boundary.",
  ],
  profit_plan: [
    { level: 62.785, label: "T1", action: "Scale out 40%, trail stop to entry", status: "ACTIVE" },
    { level: 69.1, label: "T2", action: "Close remaining 60%, exit full position", status: "PENDING" },
  ],
  thesis: "CARR — conviction 53/100 (neutral) Entry grade: strong. Drivers: entry. Cautions: Earnings in 5 days. The result can override the setup, so size down.; Its Industrials (Equal-Weight) basket is below its long-term trend. Size down: the tape is rewarding leaders, and this basket is not one.. Trust tier: Event edge: insider buying (lone FDR survivor) + earnings-surprise PEAD context + revisions — a confluence read, not a standalone alpha. Options positioning (as of 2026-10-21): the heaviest call open interest sat at $57.00, about 0.9% above the entry — dealer hedging tends to add friction into that level, which is a place price stalls, not a target. DISPLAY-ONLY: machine-generated from factor scores; no forward return guarantee; display-tier artifact.",
};

/** The board read extended by the REAL CARR plan row (above) at the browser
 * seam, so the Setup's plan join selects genuine 2026-11-09 evidence. */
export async function stubBoardWithCarr(page: Page) {
  await page.route(
    url => url.pathname === "/api/flow" && url.searchParams.get("f") === "prophet_idx",
    async route => {
      const response = await route.fetch();
      const board = await response.json() as { plans: Record<string, unknown>[] };
      if (!board.plans.some(plan => plan.id === "CARR-BULL-20261016")) {
        board.plans.push(REAL_CARR_BOARD_PLAN as unknown as Record<string, unknown>);
      }
      await route.fulfill({ response, json: board });
    },
  );
}

/** Keep observation-source reads hermetic: a deterministic unavailable answer. */
export async function stubObservationsUnavailable(page: Page) {
  await page.route("**/api/prophet/observations*",
    route => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
}
