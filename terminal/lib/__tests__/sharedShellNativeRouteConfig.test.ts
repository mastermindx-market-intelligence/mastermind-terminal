import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import config from "../../next.config";
import { updateSession } from "@/lib/supabase/middleware";
const auth=vi.hoisted(()=>({subject:null as string|null}));
vi.mock("@supabase/ssr",()=>({createServerClient:()=>({auth:{getClaims:async()=>({data:{claims:auth.subject?{sub:auth.subject}:null},error:null})}})}));
afterEach(()=>{auth.subject=null;vi.unstubAllEnvs();});
async function researchRedirect(query:string) {
 const params=new URLSearchParams(query);
 const rules=await config.redirects!();
 return rules.find(rule => {
  if (rule.source !== "/research") return false;
  return !rule.has || rule.has.every(condition => {
   if (condition.type !== "query" || !params.has(condition.key)) return false;
   return !condition.value || new RegExp(`^(?:${condition.value})$`).test(params.get(condition.key)!);
  });
 });
}
describe("native Shared Shell route compatibility",()=>{
 it("uses Today as the beta front door and preserves safe explicit next",async()=>{
  vi.stubEnv("TERMINAL_REQUIRE_AUTH","0");vi.stubEnv("MMX_SHARED_SHELL","1");
  expect(new URL((await updateSession(new NextRequest("https://beta.mastermind-x.com/"))).headers.get("location")!).pathname).toBe("/today");
  const selected="/analysis?symbol=AAPL&ci_event=e1#source",url=new URL("https://beta.mastermind-x.com/");url.searchParams.set("next",selected);
  expect((await updateSession(new NextRequest(url))).headers.get("location")).toBe("https://beta.mastermind-x.com"+selected);
  vi.stubEnv("MMX_SHARED_SHELL","0");
  expect(new URL((await updateSession(new NextRequest("https://app.mastermind-x.com/"))).headers.get("location")!).pathname).toBe("/terminal");
 });
 it("keeps the signed-in lockdown arrival on its safe explicit context or profile default",async()=>{
  vi.stubEnv("TERMINAL_REQUIRE_AUTH","1");vi.stubEnv("MMX_SHARED_SHELL","1");auth.subject="11111111-1111-4111-8111-111111111111";
  expect((await updateSession(new NextRequest("https://beta.mastermind-x.com/login"))).headers.get("location")).toBe("https://beta.mastermind-x.com/today");
  const selected="/research?doc_id=report1&segment_start=4#reader",url=new URL("https://beta.mastermind-x.com/login");url.searchParams.set("next",selected);
  expect((await updateSession(new NextRequest(url))).headers.get("location")).toBe("https://beta.mastermind-x.com"+selected);
  url.searchParams.set("next","//untrusted.example");
  expect((await updateSession(new NextRequest(url))).headers.get("location")).toBe("https://beta.mastermind-x.com/today");
 });
 it("serves the new reader only when Shared Shell is on",async()=>{
  vi.stubEnv("MMX_SHARED_SHELL","1");
  expect(await researchRedirect("")).toBeUndefined();
  expect(await researchRedirect("doc_id=report1&source_pdf_sha256="+"a".repeat(64))).toBeUndefined();
  vi.stubEnv("MMX_SHARED_SHELL","0");expect((await researchRedirect(""))?.destination).toBe("/options");
 });
 it.each(["0","1"])("preserves old Options and Fundamentals tabs in flag %s",async flag=>{
  vi.stubEnv("MMX_SHARED_SHELL",flag);
  expect((await researchRedirect("tab=fundamentals&symbol=AAPL"))?.destination).toBe("/analysis");
  expect((await researchRedirect("tab=gex"))?.destination).toBe("/options");
  expect((await researchRedirect("tab=tape"))?.destination).toBe("/options");
 });
 it("applies the canonical private cache rule to all three native routes",async()=>{
  const rules=await config.headers!();
  for(const path of ["/today","/research","/monitor"]){
   const rule=rules.find(rule=>new RegExp("^"+rule.source+"$").test(path)&&rule.headers.some(header=>header.key==="Cache-Control"&&header.value.includes("private")));
   expect(rule?.headers.find(header=>header.key==="Cache-Control")?.value).toContain("no-store");
   expect(rule?.headers.find(header=>header.key==="Vary")?.value).toBe("Cookie");
  }
 });
 it.each(["/today","/research","/monitor"])("retains ordinary lockdown for %s",async path=>{
  vi.stubEnv("TERMINAL_REQUIRE_AUTH","1");
  const response=await updateSession(new NextRequest("https://beta.mastermind-x.com"+path));
  expect(response.status).toBe(307);expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
  expect(response.headers.get("cache-control")).toContain("private");
 });
});
