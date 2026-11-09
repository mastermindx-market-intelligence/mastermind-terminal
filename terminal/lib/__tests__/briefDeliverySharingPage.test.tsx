import { describe, expect, it, vi, beforeEach } from "vitest";
const auth = vi.hoisted(() => ({ user: null as { id: string } | null, error: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: auth.user }, error: auth.error }) } }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("NOT_FOUND"); } }));
vi.mock("@/components/gates/SignupGate", () => ({ default: () => null }));
vi.mock("@/components/briefs/BriefSharingReview", () => ({ default: () => null }));
import Page from "../../app/(shell)/briefs/[deliveryId]/sharing/page";
import { D, U, E } from "./briefDeliverySharing.fixture";
const render = (query: Record<string,string|string[]|undefined> = {}, deliveryId = D) => Page({ params: Promise.resolve({ deliveryId }), searchParams: Promise.resolve(query) });
beforeEach(() => { auth.user = { id: U }; auth.error = null; });
describe("sharing page address and real account qualification", () => {
  it("mounts the real authenticated UUID and exact original address", async () => {
    const element = await render({ expected_effect_sha256: E });
    const consumer = element.props.children.props.children;
    expect(consumer.props).toEqual({ deliveryId: D, principalId: U, initialExpectedEffect: E });
  });
  it.each([{ expected_effect_sha256: [E, E] }, { expected_effect_sha256: "invalid" }, { other: E }])("rejects ambiguous or unsupported query %j", async query => {
    await expect(render(query)).rejects.toThrow("NOT_FOUND");
  });
  it("rejects a malformed delivery before authentication", async () => { await expect(render({}, "not-a-delivery")).rejects.toThrow("NOT_FOUND"); });
  it("does not mount private consumer when getUser returns an error alongside stale data", async () => {
    auth.error = Error("stale"); const element = await render(); expect(element.props.surface).toBe("alerts");
  });
  it("does not mount private consumer for a guest", async () => {
    auth.user = null; const element = await render(); expect(element.props.surface).toBe("alerts");
  });
});
