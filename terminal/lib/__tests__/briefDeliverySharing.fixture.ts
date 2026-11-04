import type { SharingReview } from "../briefDeliverySharing";
export const D = "40000000-0000-4000-8000-000000000001";
export const T = "20000000-0000-4000-8000-000000000001";
export const U = "10000000-0000-4000-8000-000000000001";
export const H = "a".repeat(64), E = "b".repeat(64);
export function review(): SharingReview {
  return { schema: "mastermind.brief_delivery_sharing.v1", delivery: {
    delivery_id: D, slot_asof: "2026-11-04", artifact_asof: "2026-11-04T00:00:00.000000Z",
    content_sha256: H, body: { target: { kind: "watchlist", id: "private-target",
      name: "Private source", version_or_asof: "2026-11-04" },
      market_read: [{ section: "Market", sentence_en: "An authored sentence.", sentence_zh: "原有句子。", asof: "2026-11-04" }],
      monitors: [], artifact: { name: "Weekly research brief", asof: "2026-11-04" } } },
    audience: { team_id: T, name: "Research", membership_policy: "DYNAMIC_TEAM_MEMBERSHIP" },
    eligibility: { can_share: true }, expected_effect_sha256: E, grant: null };
}
export function committed() {
  const value = review();
  value.grant = { team_id: T, content_sha256: H, effect_sha256: E, shared_by: U, shared_at: "2026-11-04T00:00:01Z" };
  return value;
}
