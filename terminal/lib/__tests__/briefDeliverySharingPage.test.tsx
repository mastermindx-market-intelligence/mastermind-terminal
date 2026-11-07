import { describe, expect, it, vi, beforeEach } from "vitest";
const auth = vi.hoisted(() => ({ user: null as { id: string } | null, error: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: auth.user }, error: auth.error }) } }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("NOT_FOUND"); } }));
vi.mock("@/components/gates/SignupGate", () => ({ default: () => null }));
vi.mock("@/components/briefs/BriefSharingReview", () => ({ default: () => null }));
vi.mock("@/components/briefs/BriefSharingRequestReview", () => ({ default: () => null }));
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


it("mounts only exact request/revision with fixed original-attempt address", async () => {
  const request = "60000000-0000-4000-8000-000000000001";
  const page = await render({request,revision:"1"});
  expect(page.props.children.props.children.props).toEqual({selected:{delivery_id:D,request_ref:request,revision:1},principalId:U,originalAction:null,originalEffect:null,originalIssue:null});
  for(const query of [{request,revision:"2"},{request:[request,request],revision:"1"},{request,revision:"1",attempt:"SHARE"},{request,revision:"1",expected_effect_sha256:E},{request,revision:"1",attempt:"KEEP_PRIVATE",expected_effect_sha256:E}]) await expect(render(query)).rejects.toThrow("NOT_FOUND");
});


it("an ambiguous ISSUE address requires its exact intended team and content",async()=>{
 const request="60000000-0000-4000-8000-000000000001",team="20000000-0000-4000-8000-000000000001";
 await expect(render({request,revision:"1",attempt:"ISSUE"})).rejects.toThrow("NOT_FOUND");
 const element=await render({request,revision:"1",attempt:"ISSUE",request_team_id:team,expected_content_sha256:E});
 expect(element.props.children.props.children.props.originalIssue).toEqual({team_id:team,content_sha256:E});
});
