import type { MastermindBrainHost } from "./mastermindBrain";

/** Read-only readiness over the existing session-authenticated chart-state mirror. */
export type ChartStatePreparationRequest = { origin_id: string; context_revision: number };
export type ChartStatePreparationResult =
  | ({ ok: true } & ChartStatePreparationRequest)
  | { ok: false; reason: "host_unmounted" | "context_changed" | "cancelled" |
      "state_unavailable" | "state_post_failed" | "state_post_timeout" | "sign_in_required" };

/** Chart-mounted extension of the incumbent document-level Brain host. */
export interface ChartStatePreparationHost extends MastermindBrainHost {
  MM_BRAIN_CFG?: NonNullable<MastermindBrainHost["MM_BRAIN_CFG"]> & {
    prepareChartState?: (request: ChartStatePreparationRequest, signal?: AbortSignal) => Promise<ChartStatePreparationResult>;
  };
}
