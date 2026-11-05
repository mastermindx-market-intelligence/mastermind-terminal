import { beforeEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ user: null as { id: string } | null, error: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: auth.user }, error: auth.error }) } }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("NOT_FOUND"); } }));
vi.mock("@/components/gates/SignupGate", () => ({ default: () => null }));
vi.mock("@/components/briefs/SharedBrief", () => ({ default: () => null }));
import Page from "../../app/(shell)/briefs/shared/[deliveryId]/page";
import { D, U } from "./briefDeliverySharing.fixture";
const render = (query: Record<string,string|string[]|undefined> = {}, deliveryId = D) => Page({ params: Promise.resolve({ deliveryId }), searchParams: Promise.resolve(query) });
beforeEach(() => { auth.user = { id: U }; auth.error = null; });
describe("shared brief page source and principal qualification", () => {
  it("passes only the canonical delivery identity and actual authenticated UUID", async () => {
    const element = await render();
    const consumer = element.props.children.props.children;
    expect(consumer.props).toEqual({ deliveryId: D, principalId: U });
  });
  it.each([{ team_id: U }, { principal_id: U }, { expected_effect_sha256: "a".repeat(64) }])("rejects unsupported query %j", async query => {
    await expect(render(query)).rejects.toThrow("NOT_FOUND");
  });
  it("rejects malformed delivery identity", async () => { await expect(render({}, "not-a-delivery")).rejects.toThrow("NOT_FOUND"); });
  it("withholds the consumer when authoritative auth errors beside stale user data", async () => {
    auth.error = Error("stale"); const element = await render(); expect(element.props.surface).toBe("alerts");
  });
  it("withholds the private consumer for a guest", async () => {
    auth.user = null; const element = await render(); expect(element.props.surface).toBe("alerts");
  });
});
