import { beforeEach, describe, expect, it, vi } from "vitest";
const { rpc, getUser } = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({createClient: async () => ({rpc,auth:{getUser}})}));
vi.mock("@/lib/rateLimit",()=>({rateLimit:()=>({ok:true})}));
import { GET, POST } from "@/app/api/investigations/route";
const id="10000000-0000-4000-8000-000000000001";
beforeEach(()=>{rpc.mockReset();getUser.mockReset();getUser.mockResolvedValue({data:{user:{id}},error:null});});
describe("authenticated Investigation BFF",()=>{
 it("refuses anonymous reads and writes before touching the database",async()=>{
  getUser.mockResolvedValue({data:{user:null},error:null});
  expect((await GET(new Request(`https://terminal.test/api/investigations?id=${id}`))).status).toBe(401);
  expect((await POST(new Request("https://terminal.test/api/investigations",{method:"POST",body:"{}"}))).status).toBe(401);
  expect(rpc).not.toHaveBeenCalled();
 });
 it("reads an absent operation without creating a replacement",async()=>{
  rpc.mockResolvedValue({data:{status:"not_found"},error:null});
  const response=await GET(new Request(`https://terminal.test/api/investigations?operation_id=${id}`));
  expect(response.status).toBe(404);expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(rpc.mock.calls).toEqual([["read_investigation_operation_v2",{p_operation_id:id}]]);
 });
 it("does not turn outages into empty research",async()=>{
  rpc.mockResolvedValue({data:null,error:{message:"database offline"}});
  expect((await GET(new Request(`https://terminal.test/api/investigations?id=${id}`))).status).toBe(503);
 });
 it("refuses conflicting selectors and malformed JSON",async()=>{
  expect((await GET(new Request(`https://terminal.test/api/investigations?id=${id}&operation_id=${id}`))).status).toBe(400);
  expect((await GET(new Request(`https://terminal.test/api/investigations?id=${id}&revision=0`))).status).toBe(400);
  expect((await POST(new Request("https://terminal.test/api/investigations",{method:"POST",body:"{"}))).status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
 });
});
