import { describe, expect, it, vi } from "vitest";
import { decodeSharedBrief, decodeSharingReceipt, decodeSharingReview, parseSharingCommand,
  readBriefDeliverySharing, readSharedBriefDelivery, reconcileBriefDeliverySharing,
  shareBriefDelivery, type SharingDb } from "../briefDeliverySharing";

import { D, T, U, H, E, review, committed } from "./briefDeliverySharing.fixture";
function db(data: unknown, error: { code?: string } | null = null) {
  return { rpc: vi.fn(async () => ({ data, error })) } satisfies SharingDb;
}

describe("exact delivered-brief sharing owner consumer", () => {
  it("reads and detaches the exact owner review without granting authority", async () => {
    const raw = review(), source = db(raw);
    const value = await readBriefDeliverySharing(source, D, T);
    expect(source.rpc).toHaveBeenCalledWith("read_brief_delivery_sharing", { p_delivery_id: D, p_team_id: T });
    expect(value.ok).toBe(true);
    raw.delivery.body.artifact.name = "mutated after acquisition";
    if (value.ok) expect(value.value.delivery.body.artifact.name).toBe("Weekly research brief");
  });
  it("sends once with the server's exact content and pre-send effect identity", async () => {
    const source = db(committed());
    const result = await shareBriefDelivery(source, D, T, H, E, U);
    expect(result.ok).toBe(true);
    expect(source.rpc).toHaveBeenCalledWith("share_brief_delivery", {
      p_delivery_id: D, p_team_id: T, p_expected_content_sha256: H, p_expected_effect_sha256: E,
    });
  });
  it.each(["team", "content", "effect", "principal", "shape"])("withholds malformed post-send %s and preserves original recovery", async fault => {
    const raw = committed();
    if (fault === "team") raw.grant!.team_id = "20000000-0000-4000-8000-000000000002";
    if (fault === "content") raw.grant!.content_sha256 = "c".repeat(64);
    if (fault === "effect") raw.grant!.effect_sha256 = "c".repeat(64);
    if (fault === "principal") raw.grant!.shared_by = "invalid";
    if (fault === "shape") Object.assign(raw, { private_subscription: "PRIVATE_CANARY" });
    const source = db(raw), result = await shareBriefDelivery(source, D, T, H, E, U);
    expect(result).toEqual({ ok: false, code: "effect_unknown", reference: { delivery_id: D, expected_effect_sha256: E } });
    expect(source.rpc).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_CANARY");
  });
  it("does not retry after response loss", async () => {
    const source = { rpc: vi.fn(async () => { throw new Error("PRIVATE_TRANSPORT_FAILURE"); }) };
    expect(await shareBriefDelivery(source, D, T, H, E, U)).toEqual({ ok: false, code: "effect_unknown",
      reference: { delivery_id: D, expected_effect_sha256: E } });
    expect(source.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([["42501", "denied"], ["40001", "conflict"], ["22023", "invalid_input"],
    ["PGRST202", "unavailable"], ["42883", "unavailable"]])("preserves proven owner refusal %s", async (code, resultCode) => {
    const source = db(null, { code });
    expect(await shareBriefDelivery(source, D, T, H, E, U)).toEqual({ ok: false, code: resultCode });
    expect(source.rpc).toHaveBeenCalledTimes(1);
  });
  it("reads the original exact receipt even when current access has changed", async () => {
    const raw = { schema: "mastermind.brief_delivery_sharing_receipt.v1", delivery_id: D,
      expected_effect_sha256: E, observation: "MATCHED", grant: committed().grant, current_access: false };
    const source = db(raw), result = await reconcileBriefDeliverySharing(source, D, E);
    expect(result).toEqual({ ok: true, value: raw });
    expect(source.rpc).toHaveBeenCalledWith("reconcile_brief_delivery_sharing", { p_delivery_id: D, p_expected_effect_sha256: E });
    expect(decodeSharingReceipt({ ...raw, expected_effect_sha256: H }, D, E)).toBeNull();
    expect(decodeSharingReceipt({ ...raw, observation: "NOT_OBSERVED", grant: null }, D, E)?.observation).toBe("NOT_OBSERVED");
    expect(decodeSharingReceipt({ ...raw, observation: "NOT_OBSERVED", current_access: true }, D, E)).toBeNull();
  });
  it("accepts only the fixed recipient body, never private source-target fields", async () => {
    const raw = review(), body = raw.delivery.body;
    const shared = { schema: "mastermind.shared_brief_delivery.v1", delivery: { ...raw.delivery,
      body: { market_read: body.market_read, monitors: body.monitors, artifact: body.artifact } }, audience: raw.audience };
    expect((await readSharedBriefDelivery(db(shared), D)).ok).toBe(true);
    expect(decodeSharedBrief({ ...shared, delivery: { ...shared.delivery, body } }, D)).toBeNull();
    const privateNested = structuredClone(shared);
    Object.assign(privateNested.delivery.body.market_read[0], { private_target_id: "PRIVATE_CANARY" });
    expect(decodeSharedBrief(privateNested, D)).toBeNull();
    expect(JSON.stringify(decodeSharedBrief(shared, D))).not.toContain("private-target");
  });
  it("does not invoke the owner with malformed or noncanonical identity", async () => {
    const source = db(committed());
    expect((await shareBriefDelivery(source, D, T, "invalid", E, U)).ok).toBe(false);
    expect((await shareBriefDelivery(source, "4000000A-0000-4000-8000-000000000001", T, H, E, U)).ok).toBe(false);
    expect(source.rpc).not.toHaveBeenCalled();
    expect(decodeSharingReview({ ...review(), delivery: { ...review().delivery, slot_asof: "2026-02-30" } }, D, T)).toBeNull();
  });
  it("rejects duplicate, escaped duplicate, extra and oversized command fields", () => {
    const valid = { team_id: T, expected_content_sha256: H, expected_effect_sha256: E };
    expect(parseSharingCommand(JSON.stringify(valid))).toEqual(valid);
    expect(parseSharingCommand(`{"team_id":"${T}","team_id":"${T}","expected_content_sha256":"${H}","expected_effect_sha256":"${E}"}`)).toBeNull();
    expect(parseSharingCommand(`{"team_id":"${T}","\\u0074eam_id":"${T}","expected_content_sha256":"${H}","expected_effect_sha256":"${E}"}`)).toBeNull();
    expect(parseSharingCommand(JSON.stringify({ ...valid, actor: U }))).toBeNull();
    expect(parseSharingCommand(" ".repeat(16384) + JSON.stringify(valid))).toBeNull();
  });
});
