import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const owner = "11111111-1111-4111-8111-111111111111";
const mocks = vi.hoisted(()=>({member:vi.fn(),access:vi.fn(),notFound:vi.fn(()=>{throw Error("not found");})}));
vi.mock("next/navigation",()=>({notFound:mocks.notFound}));
vi.mock("@/lib/shared-shell/memberIdentity",()=>({readShellMember:mocks.member}));
vi.mock("@/lib/entitlement",()=>({getLiveOptionsAccess:mocks.access}));
vi.mock("@/components/mounts/IntelligenceWorkspaceMount",()=>({default:()=>null}));
vi.mock("@/components/mounts/IntelligenceToolMount",()=>({default:()=>null}));
vi.mock("@/components/gates/SignupGate",()=>({default:()=>null}));
vi.mock("@/components/gates/MemberVerificationUnavailable",()=>({default:()=>null}));
vi.mock("@/components/OptionsPaywall",()=>({default:()=>null}));
vi.mock("@/components/OptionsServiceUnavailable",()=>({default:()=>null}));
import Overview from "../../app/(shell)/intelligence/page";
import Prophet from "../../app/(shell)/prophet/page";
import Sectors from "../../app/(shell)/sectors/page";
import OverviewMount from "@/components/mounts/IntelligenceWorkspaceMount";
import ToolMount from "@/components/mounts/IntelligenceToolMount";
import Signup from "@/components/gates/SignupGate";
import Unavailable from "@/components/gates/MemberVerificationUnavailable";
import Paywall from "@/components/OptionsPaywall";
import OptionsUnavailable from "@/components/OptionsServiceUnavailable";
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("MMX_SHARED_SHELL","1");mocks.member.mockResolvedValue({state:"ready",subjectId:owner});mocks.access.mockResolvedValue("allowed");});
afterEach(()=>vi.unstubAllEnvs());
describe("native intelligence route gates",()=>{
 it.each([Overview,Prophet,Sectors])("disabled beta returns a real 404 before reading identity",async page=>{
  vi.stubEnv("MMX_SHARED_SHELL","0");await expect(page()).rejects.toThrow("not found");expect(mocks.member).not.toHaveBeenCalled();expect(mocks.access).not.toHaveBeenCalled();
 });
 it.each([Overview,Sectors])("guest cannot mount a private workspace",async page=>{mocks.member.mockResolvedValue({state:"guest"});expect((await page()).type).toBe(Signup);});
 it.each([Overview,Prophet,Sectors])("identity outage is not a guest or an authorized mount",async page=>{mocks.member.mockResolvedValue({state:"unavailable"});expect((await page()).type).toBe(Unavailable);});
 it("Prophet uses the existing paid feature, not a profile hint or a new entitlement",async()=>{
  mocks.access.mockResolvedValue("denied");expect((await Prophet()).type).toBe(Paywall);
  mocks.access.mockResolvedValue("unavailable");expect((await Prophet()).type).toBe(OptionsUnavailable);
  mocks.access.mockResolvedValue("unexpected");expect((await Prophet()).type).toBe(OptionsUnavailable);
  mocks.access.mockResolvedValue("allowed");const result=await Prophet();expect(result.type).toBe(ToolMount);expect(result.props).toMatchObject({ownerKey:owner,kind:"prophet"});
 });
 it("member identity is bound into each owner-keyed mount",async()=>{
  const overview=await Overview(),sectors=await Sectors();expect(overview.type).toBe(OverviewMount);expect(overview.props.ownerKey).toBe(owner);expect(overview.key).toBe(owner);
  expect(sectors.type).toBe(ToolMount);expect(sectors.props).toMatchObject({ownerKey:owner,kind:"sectors"});
 });
});
