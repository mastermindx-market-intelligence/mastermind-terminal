/**
 * Follow capability for a saved Sector / Prophet investigation (SI15, SP17).
 *
 * Masterplan §15.5.1: "Ordinary Save does not enroll Follow. Preference commit, exact designated-list
 * membership, admitted producer availability and actual transport status are separate fields. Only show
 * Following when the selected supported channel/category and membership readbacks are confirmed and the
 * producer/delivery path is admitted; otherwise show configured/unavailable or the exact incomplete step.
 * A settings HTTP ok alone is insufficient."
 *
 * This module is the pure decision for that sentence. It performs no I/O, enrolls nothing, and never
 * creates a queue, scheduler or notification service: delivery stays with the existing alert_outbox /
 * drain / mailer owners. WHAT EXISTS TODAY (read-only census 2026-11-10, recorded in the lane-6 return):
 *   - Macro `engine/prophet_journey_notifications.py` (B21) is the only event producer for this family,
 *     and its closed kinds are Prophet episode kinds (episode_terminal, emergence_triggered,
 *     corrected_material, retracted, superseded) - there is NO Sector material-change kind.
 *   - Its category `prophet_research_journey` is absent from Macro `lib/user_prefs.ALERT_CATEGORIES`.
 *   - Terminal has no Follow enrollment/preference write route for it.
 *   - Production `public.alert_outbox` has 12 columns (no `in_app_published_at` / `in_app_seen_at`) and 0 rows.
 * So `FOLLOW_PRODUCER_ADMISSION` is the honest default: nothing is admitted and no notification is claimed.
 */
import { INVESTIGATION_V3_WRITES_OPEN } from "./investigations";

export type FollowReadback = "confirmed" | "unconfirmed" | "unavailable";
export type FollowTransport = "queued" | "sent" | "failed" | "unknown" | "unavailable";
export type FollowInputs = {
  /** Metadata write AND a GET readback of the selected category/channel (an HTTP ok alone is not this). */
  preference: FollowReadback;
  /** Exact membership in the designated list. */
  membership: FollowReadback;
  /** The producer for the selected event family is admitted by its owner (not merely configured). */
  producerAdmitted: boolean;
  /** Actual delivery state from the existing outbox/drain; `queued` is not delivered, `sent` is not read. */
  transport: FollowTransport;
};
export type FollowState =
  | { state: "closed"; reason: "v3_writes_closed"; notificationClaimed: false }
  | { state: "saved_preference_only"; reason: "no_producer" | "preference_unconfirmed" | "membership_unconfirmed"; notificationClaimed: false; missingStep: string }
  | { state: "configured_unavailable"; reason: "transport_unavailable"; notificationClaimed: false; missingStep: string }
  | { state: "delivery_problem"; reason: "transport_failed" | "transport_unknown"; notificationClaimed: false; transport: "failed" | "unknown"; missingStep: string }
  | { state: "following"; notificationClaimed: true; transport: "queued" | "sent" };

/** What exists today, in readback form. Producer admission is the single missing owner. */
export const FOLLOW_PRODUCER_ADMISSION: FollowInputs = {
  preference: "unavailable",
  membership: "unavailable",
  producerAdmitted: false,
  transport: "unavailable",
};

export function followState(inputs: FollowInputs = FOLLOW_PRODUCER_ADMISSION, v3WritesOpen: boolean = INVESTIGATION_V3_WRITES_OPEN): FollowState {
  if (!v3WritesOpen) return { state: "closed", reason: "v3_writes_closed", notificationClaimed: false };
  // The producer is checked first: a saved preference without a producer must claim no notification,
  // whatever else reads back as confirmed.
  if (!inputs.producerAdmitted) {
    return { state: "saved_preference_only", reason: "no_producer", notificationClaimed: false,
      missingStep: "An admitted producer for this event family (none exists for Sector material changes)." };
  }
  if (inputs.preference !== "confirmed") {
    return { state: "saved_preference_only", reason: "preference_unconfirmed", notificationClaimed: false,
      missingStep: "Confirm the category/channel preference by readback." };
  }
  if (inputs.membership !== "confirmed") {
    return { state: "saved_preference_only", reason: "membership_unconfirmed", notificationClaimed: false,
      missingStep: "Confirm membership in the designated list by readback." };
  }
  if (inputs.transport === "unavailable") {
    return { state: "configured_unavailable", reason: "transport_unavailable", notificationClaimed: false,
      missingStep: "The delivery path reports no actual transport status." };
  }
  // A notification is claimed only for an ACTUAL queued or sent transport. failed / unknown names the
  // delivery problem and claims nothing ("queued" is not delivered; "sent" is not read).
  if (inputs.transport === "failed" || inputs.transport === "unknown") {
    return { state: "delivery_problem", reason: inputs.transport === "failed" ? "transport_failed" : "transport_unknown", notificationClaimed: false,
      transport: inputs.transport, missingStep: inputs.transport === "failed" ? "The delivery path reports a failed transport." : "The delivery path reports no usable transport outcome." };
  }
  return { state: "following", notificationClaimed: true, transport: inputs.transport };
}
