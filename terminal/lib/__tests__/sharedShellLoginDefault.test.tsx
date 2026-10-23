import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Login from "@/app/login/page";
import Legacy from "@/app/login/LoginFormLegacy";
const edges=vi.hoisted(()=>({redirect:vi.fn((href:string)=>{throw Error("redirect:"+href);})}));
vi.mock("next/navigation",()=>({redirect:edges.redirect}));
vi.mock("@/app/login/LoginFormLegacy",()=>({default:()=>null}));
beforeEach(()=>{edges.redirect.mockClear();vi.stubEnv("TERMINAL_REQUIRE_AUTH","0");});
afterEach(()=>vi.unstubAllEnvs());
it.each([["1","/today"],["0","/terminal"]])("login uses profile %s default %s",async(flag,destination)=>{
 vi.stubEnv("MMX_SHARED_SHELL",flag);
 await expect(Login()).rejects.toThrow("redirect:"+destination+"?signin=1");
});
it("opens sign-in at the safe explicit selected context",async()=>{
 vi.stubEnv("MMX_SHARED_SHELL","1");
 const next="/research?doc_id=report1&segment_start=2#reader";
 await expect(Login({searchParams:Promise.resolve({next})})).rejects.toThrow("redirect:/research");
 expect(edges.redirect).toHaveBeenLastCalledWith("/research?doc_id=report1&segment_start=2&signin=1#reader");
 await expect(Login({searchParams:Promise.resolve({next:"//untrusted.example"})})).rejects.toThrow("redirect:/today?signin=1");
});
it("retains the full-page lockdown owner with the correct profile fallback",async()=>{
 vi.stubEnv("TERMINAL_REQUIRE_AUTH","1");vi.stubEnv("MMX_SHARED_SHELL","1");
 const beta=await Login();expect(beta?.type).toBe(Legacy);expect(beta?.props.defaultNext).toBe("/today");
 vi.stubEnv("MMX_SHARED_SHELL","0");expect((await Login())?.props.defaultNext).toBe("/terminal");
 expect(edges.redirect).not.toHaveBeenCalled();
});
