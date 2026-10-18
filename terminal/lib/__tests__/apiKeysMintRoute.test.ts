import { expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:"owner"}}})}})}));
vi.mock("@/lib/apiKeys",()=>({mintApiKey:async()=>({ok:true,key:{keyId:"test-key"},secret:"fixture-only-secret"})}));
import { POST } from "@/app/api/account/api-keys/route";

it("prevents storage of the one-time minted credential response",async()=>{
  const response=await POST(new Request("https://app.mastermind-x.com/api/account/api-keys",{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({label:"test"}),
  }));
  expect(response.status).toBe(201);
  expect((await response.json()).secret).toBe("fixture-only-secret");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
});
