import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TodayPage from "@/app/(shell)/today/page";
import ResearchPage from "@/app/(shell)/research/page";
import MonitorPage from "@/app/(shell)/monitor/page";
import { readShellMember, MEMBER_READ_TIMEOUT_MS } from "@/lib/shared-shell/memberIdentity";
import SignupGate from "@/components/gates/SignupGate";
import MemberVerificationUnavailable from "@/components/gates/MemberVerificationUnavailable";
import TodayMount from "@/components/mounts/TodayWorkspaceMount";
import ResearchMount from "@/components/mounts/ResearchWorkspaceMount";
import MonitorMount from "@/components/mounts/MonitorWorkspaceMount";

const edges = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("server-only",()=>({}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getUser:edges.getUser}})}));
vi.mock("@/components/gates/SignupGate",()=>({default:()=>null}));
vi.mock("@/components/gates/MemberVerificationUnavailable",()=>({default:()=>null}));
vi.mock("@/components/mounts/TodayWorkspaceMount",()=>({default:()=>null}));
vi.mock("@/components/mounts/ResearchWorkspaceMount",()=>({default:()=>null}));
vi.mock("@/components/mounts/MonitorWorkspaceMount",()=>({default:()=>null}));
const subject="11111111-1111-4111-8111-111111111111";
beforeEach(()=>{edges.getUser.mockReset();});
afterEach(()=>vi.useRealTimers());
describe("shared-shell server member boundary",()=>{
 it("uses the verified user subject and never user metadata",async()=>{
  edges.getUser.mockResolvedValue({data:{user:{id:subject,user_metadata:{role:"admin"}}},error:null});
  expect(await readShellMember()).toEqual({state:"ready",subjectId:subject});
 });
 it.each([null,"not-a-uuid"])("rejects absent/malformed subject %s",async id=>{
  edges.getUser.mockResolvedValue({data:{user:id?{id}:null},error:null});
  expect(await readShellMember()).toEqual({state:"guest"});
 });
 it("keeps missing session separate from an account outage",async()=>{
  edges.getUser.mockResolvedValue({data:{user:null},error:{name:"AuthSessionMissingError"}});
  expect(await readShellMember()).toEqual({state:"guest"});
  edges.getUser.mockResolvedValue({data:{user:null},error:{name:"AuthRetryableFetchError",status:503}});
  expect(await readShellMember()).toEqual({state:"unavailable"});
 });
 it("bounds a nonsettling server auth read",async()=>{
  vi.useFakeTimers();edges.getUser.mockImplementation(()=>new Promise(()=>{}));
  const read=readShellMember();await vi.advanceTimersByTimeAsync(MEMBER_READ_TIMEOUT_MS+1);
  expect(await read).toEqual({state:"unavailable"});
 });
 it("treats unexpected auth rejection as unavailable",async()=>{
  edges.getUser.mockRejectedValue(Error("offline"));expect(await readShellMember()).toEqual({state:"unavailable"});
 });
});
describe.each([
 ["today",TodayPage,TodayMount],["research",ResearchPage,ResearchMount],["monitor",MonitorPage,MonitorMount],
] as const)("%s native page",(surface,Page,Mount)=>{
 it("keeps guest outside the workspace mount",async()=>{
  edges.getUser.mockResolvedValue({data:{user:null},error:null});const page=await Page();
  expect(page.type).toBe(SignupGate);expect(page.props).toEqual({surface});
 });
 it("keeps account outage outside the private workspace",async()=>{
  edges.getUser.mockResolvedValue({data:{user:null},error:{name:"AuthRetryableFetchError",status:503}});
  expect((await Page()).type).toBe(MemberVerificationUnavailable);
 });
 it("keys the actual member mount by verified immutable subject",async()=>{
  edges.getUser.mockResolvedValue({data:{user:{id:subject}},error:null});const page=await Page();
  expect(page.type).toBe(Mount);expect(page.key).toBe(subject);
  if(surface!=="monitor")expect(page.props.ownerKey).toBe(subject);
 });
});
