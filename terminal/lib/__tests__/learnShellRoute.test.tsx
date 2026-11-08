// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { LevelsLearn } from "@/components/levels/LevelsLearn";
import ShellLayout from "@/app/(shell)/layout";
import AppShell from "@/components/chrome/AppShell";
import MemberVerificationUnavailable from "@/components/gates/MemberVerificationUnavailable";
const state=vi.hoisted(()=>({lang:"en" as "en"|"zh",claims:vi.fn()}));
vi.mock("@/lib/i18n",async()=>{const actual=await vi.importActual<typeof import("@/lib/i18n")>("@/lib/i18n");return {...actual,useT:()=>((key:string)=>actual.LEX[key]?.[state.lang==="zh"?1:0]??key)};});
vi.mock("next/link",()=>({default:({children,...props}:React.ComponentProps<"a">)=><a {...props}>{children}</a>}));
vi.mock("@/components/BrandMark",()=>({BrandLockup:()=> <span data-standalone-brand="">Mastermind</span>}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getClaims:state.claims}})}));
// Keep the real ShellLayout/claims owner; isolate framework chrome rendering only.
vi.mock("@/components/chrome/AppShell",()=>({default:({children}:{children:React.ReactNode})=><><header data-shared-owner="">Shell</header><main>{children}</main></>}));
function html(children:React.ReactNode){const host=document.createElement("div");host.innerHTML=renderToStaticMarkup(children);return host;}
function lessons(host:HTMLElement){expect(host.querySelectorAll("h1")).toHaveLength(1);const rows=host.querySelectorAll("ol > li");expect(rows).toHaveLength(6);expect(host.querySelectorAll("details[open]")).toHaveLength(1);expect(rows[0].querySelector("details")?.open).toBe(true);for(const row of rows)expect(row.querySelector("p")?.textContent?.trim().length).toBeGreaterThan(10);}
beforeEach(()=>{vi.stubEnv("MMX_SHARED_SHELL","1");vi.stubEnv("MMX_INVESTOR_SHELL_PREVIEW","");state.claims.mockReset();state.claims.mockResolvedValue({data:{claims:null},error:{name:"AuthSessionMissingError"}});});
afterEach(()=>vi.unstubAllEnvs());
it("serves the same Learn URL from the sole canonical shell group",()=>{const app=path.resolve(__dirname,"../../app");expect(existsSync(path.join(app,"learn/page.tsx"))).toBe(false);const page=readFileSync(path.join(app,"(shell)/learn/page.tsx"),"utf8");expect(page).toContain("<LevelsLearn withinShell />");expect(page).not.toMatch(/export const (?:dynamic|revalidate)/);const layout=readFileSync(path.join(app,"(shell)/layout.tsx"),"utf8");expect(layout).toContain('dynamic = "force-dynamic"');expect(layout).toContain("revalidate = 0");});
it.each(["en","zh"] as const)("preserves standalone %s lessons and existing Levels links",lang=>{state.lang=lang;const host=html(<LevelsLearn/>);lessons(host);expect(host.querySelectorAll("header")).toHaveLength(1);expect(host.querySelectorAll("main")).toHaveLength(1);expect(host.querySelector("[data-standalone-brand]")).not.toBeNull();for(const link of host.querySelectorAll("a"))expect(link.getAttribute("href")).toBe("/options?tab=levels");});
it.each(["en","zh"] as const)("uses one shared owner while preserving %s lesson depth and explicit Back",lang=>{state.lang=lang;const host=html(<AppShell><LevelsLearn withinShell/></AppShell>);lessons(host);expect(host.querySelectorAll("header")).toHaveLength(1);expect(host.querySelectorAll("main")).toHaveLength(1);expect(host.querySelector("[data-standalone-brand]")).toBeNull();expect(host.querySelectorAll('a[href="/options?tab=levels"]')).toHaveLength(2);});
it("the real non-fixture claims/layout path keeps missing-session Learn public",async()=>{state.lang="en";const element=await ShellLayout({children:<LevelsLearn withinShell/>});expect(element.type).toBe(AppShell);expect(element.props).toMatchObject({email:"",userId:"",sharedShell:true});const host=html(element);lessons(host);expect(host.querySelectorAll("main")).toHaveLength(1);expect(state.claims).toHaveBeenCalledTimes(1);expect(host.textContent).not.toMatch(/sign in|subscribe|upgrade/i);});
it("preserves the common truthful verifier-unavailable state without inventing guest identity",async()=>{state.claims.mockResolvedValue({data:{claims:null},error:{name:"VerificationError"}});const element=await ShellLayout({children:<LevelsLearn withinShell/>});expect(element.type).toBe(MemberVerificationUnavailable);expect(state.claims).toHaveBeenCalledTimes(1);});
