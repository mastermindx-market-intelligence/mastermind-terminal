/**
 * SI15 / SP17 — Follow capability decision. FIXTURE results (pure function over stated readbacks); the
 * real-engine facts about what exists (no Sector producer kind, outbox schema, empty outbox) are recorded
 * in the lane-6 return from read-only catalog and source census, not asserted by a unit test.
 */
import { describe, expect, it } from "vitest";
import { followState, FOLLOW_PRODUCER_ADMISSION, type FollowInputs } from "../investigationFollow";
import { INVESTIGATION_V3_WRITES_OPEN, parseInvestigationCommand } from "../investigations";

const all: FollowInputs = { preference: "confirmed", membership: "confirmed", producerAdmitted: true, transport: "queued" };

describe("Follow claims no notification unless every separate readback and an admitted producer exist", () => {
  it("v3 writes are closed today, so Follow is closed whatever else reads back", () => {
    expect(INVESTIGATION_V3_WRITES_OPEN).toBe(false);
    expect(followState(all)).toEqual({ state: "closed", reason: "v3_writes_closed", notificationClaimed: false });
    expect(parseInvestigationCommand({ id: "5b1c0d2e-3f4a-4b6c-8d7e-9f0a1b2c3d4e", operation_id: "6c2d1e3f-4a5b-4c7d-9e8f-0a1b2c3d4e5f", expected_revision: 0, action: "create",
      manifest: { schema: "investigation_manifest.v3", intent: { title: "t", question: "q", subjects: [] }, layout_refs: [], thesis_refs: [], evidence_refs: [], continuation: {} } })).toBeNull();
  });
  it("today's actual facts (no producer, nothing confirmed) claim no notification even with the gate open", () => {
    const state = followState(FOLLOW_PRODUCER_ADMISSION, true);
    expect(state).toMatchObject({ state: "saved_preference_only", reason: "no_producer", notificationClaimed: false });
  });
  it("a saved preference with confirmed readbacks but no producer still claims nothing", () => {
    expect(followState({ ...all, producerAdmitted: false }, true)).toMatchObject({ state: "saved_preference_only", reason: "no_producer", notificationClaimed: false });
  });
  it("each missing readback names the exact incomplete step", () => {
    expect(followState({ ...all, preference: "unconfirmed" }, true)).toMatchObject({ reason: "preference_unconfirmed", notificationClaimed: false });
    expect(followState({ ...all, membership: "unavailable" }, true)).toMatchObject({ reason: "membership_unconfirmed", notificationClaimed: false });
    expect(followState({ ...all, transport: "unavailable" }, true)).toMatchObject({ state: "configured_unavailable", notificationClaimed: false });
  });
  it("only a fully confirmed, admitted path reads as following, and queued stays queued", () => {
    expect(followState(all, true)).toEqual({ state: "following", notificationClaimed: true, transport: "queued" });
    expect(followState({ ...all, transport: "sent" }, true)).toMatchObject({ transport: "sent" });
  });
});
