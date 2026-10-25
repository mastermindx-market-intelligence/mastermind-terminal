import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readingJson } from "@/lib/shared-shell/useReadingScope";
vi.mock("@/lib/supabase/client",()=>({createClient:vi.fn()}));
beforeEach(()=>vi.useFakeTimers());
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it("bounds a hanging fetch and aborts its exact request",async()=>{
 let signal:AbortSignal|undefined;
 vi.stubGlobal("fetch",vi.fn((_url:string,init:RequestInit)=>{signal=init.signal!;return new Promise(()=>{});}));
 const pending=readingJson({current:new AbortController()},"/api/shared-shell/today");
 const failure=expect(pending).rejects.toThrow("read deadline");await vi.advanceTimersByTimeAsync(18000);await failure;expect(signal?.aborted).toBe(true);
});
it("bounds a hanging JSON body after headers arrived",async()=>{
 vi.stubGlobal("fetch",vi.fn(async()=>({json:()=>new Promise(()=>{})})));
 const pending=readingJson({current:new AbortController()},"/api/shared-shell/research/catalog");
 const failure=expect(pending).rejects.toThrow("read deadline");await vi.advanceTimersByTimeAsync(18000);await failure;
});
it("a subject abort ends a hanging JSON body immediately",async()=>{
 vi.stubGlobal("fetch",vi.fn(async()=>({json:()=>new Promise(()=>{})})));
 const controller=new AbortController(),pending=readingJson({current:controller},"/api/shared-shell/today");
 const failure=expect(pending).rejects.toThrow("inactive");controller.abort();await failure;
});
