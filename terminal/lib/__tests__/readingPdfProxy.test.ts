import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { proxyCurrentResearchPdf } from "@/lib/shared-shell/readingPdfProxy";
const auth=vi.hoisted(()=>({user:"11111111-1111-4111-8111-111111111111",session:"11111111-1111-4111-8111-111111111111",token:"server-token",error:null as null|{name:string;status:number}}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:auth.user?{id:auth.user}:null},error:auth.error}),getSession:async()=>({data:{session:auth.session?{user:{id:auth.session},access_token:auth.token}:null},error:null})}})}));
const request=(query="")=>new Request(`https://beta.example.test/api/shared-shell/research/pdf/report-one${query}`,{headers:{Authorization:"Bearer forged",Cookie:"untrusted-client-cookie"}});
const pdf=()=>new Response("%PDF-1.7\nproof",{headers:{"Content-Type":"application/pdf","Set-Cookie":"upstream-secret=yes","Cache-Control":"public,max-age=1000"}});
beforeEach(()=>{auth.user="11111111-1111-4111-8111-111111111111";auth.session=auth.user;auth.token="server-token";auth.error=null;vi.stubGlobal("fetch",vi.fn(async()=>pdf()));vi.stubEnv("BRAIN_GATEWAY_URL","https://www.mastermind-x.com");});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs();});
it("forwards only verified server bearer to fixed current-original owner, with private headers",async()=>{
 const response=await proxyCurrentResearchPdf(request(),"report-one");expect(response.status).toBe(200);
 const [url,init]=(fetch as ReturnType<typeof vi.fn>).mock.calls[0];expect(String(url)).toBe("https://www.mastermind-x.com/api/research/view/report-one");expect(init.headers).toEqual({Authorization:"Bearer server-token",Accept:"application/pdf"});expect(init).toMatchObject({cache:"no-store",redirect:"error"});
 expect(response.headers.get("cache-control")).toBe("private, no-store");expect(response.headers.get("set-cookie")).toBeNull();expect(response.headers.get("content-type")).toBe("application/pdf");expect(await response.text()).toContain("%PDF-");
});
it("refuses mismatched verified UUID/session without contacting Macro",async()=>{
 auth.session="22222222-2222-4222-8222-222222222222";const response=await proxyCurrentResearchPdf(request(),"report-one");expect(response.status).toBe(401);expect(fetch).not.toHaveBeenCalled();expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it.each(["../escape","report-one\n"])("refuses invalid document id %s",async docId=>{expect((await proxyCurrentResearchPdf(request(),docId)).status).toBe(400);expect(fetch).not.toHaveBeenCalled();});
it("does not accept a target, revision or arbitrary query",async()=>{expect((await proxyCurrentResearchPdf(request("?url=https://elsewhere.test"),"report-one")).status).toBe(400);expect(fetch).not.toHaveBeenCalled();});
it("retains owner denial and numeric Retry-After without returning a body",async()=>{
 vi.stubGlobal("fetch",vi.fn(async()=>new Response('{"error":"rate_limited"}',{status:429,headers:{"Content-Type":"application/json","Retry-After":"3600"}})));
 const response=await proxyCurrentResearchPdf(request(),"report-one");expect(response.status).toBe(429);expect(response.headers.get("retry-after")).toBe("3600");expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it.each([new Response("<html>login</html>",{headers:{"Content-Type":"application/pdf"}}),new Response("<html>login</html>",{headers:{"Content-Type":"text/html"}}),new Response(null,{status:302,headers:{Location:"https://elsewhere.test"}})])("refuses non-PDF and redirect responses",async upstream=>{vi.stubGlobal("fetch",vi.fn(async()=>upstream));expect((await proxyCurrentResearchPdf(request(),"report-one")).status).toBe(502);});
it("bounds a hanging original response",async()=>{
 vi.useFakeTimers();vi.stubGlobal("fetch",vi.fn(()=>new Promise(()=>{})));const pending=proxyCurrentResearchPdf(request(),"report-one");await vi.advanceTimersByTimeAsync(12000);expect((await pending).status).toBe(502);
});
it("refuses a configured URL with credentials or an arbitrary base path",async()=>{vi.stubEnv("BRAIN_GATEWAY_URL","https://user:secret@www.mastermind-x.com/other");expect((await proxyCurrentResearchPdf(request(),"report-one")).status).toBe(503);expect(fetch).not.toHaveBeenCalled();});
