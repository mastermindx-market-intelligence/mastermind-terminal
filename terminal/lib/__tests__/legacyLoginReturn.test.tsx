// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import Legacy from "@/app/login/LoginFormLegacy";
import { LangProvider } from "@/lib/i18n";
const edges=vi.hoisted(()=>({query:new URLSearchParams(),push:vi.fn(),refresh:vi.fn(),signIn:vi.fn(async()=>({error:null}))}));
vi.mock("next/navigation",()=>({useSearchParams:()=>edges.query,useRouter:()=>({push:edges.push,refresh:edges.refresh})}));
vi.mock("@/lib/supabase/client",()=>({createClient:()=>({auth:{signInWithPassword:edges.signIn}})}));
vi.mock("next/link",()=>({default:()=>null}));
vi.mock("@/components/BrandMark",()=>({BrandMark:()=>null}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
afterEach(()=>{edges.push.mockClear();edges.refresh.mockClear();});
it.each([["","/today"],["/analysis?symbol=AAPL&ci_event=e1#source","/analysis?symbol=AAPL&ci_event=e1#source"],["//untrusted.example","/today"]])("legacy sign-in preserves safe next %s",async(next,target)=>{
 edges.query=new URLSearchParams(next?{next}:{});const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
 await act(async()=>root.render(<LangProvider><Legacy defaultNext="/today"/></LangProvider>));
 await act(async()=>host.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
 expect(edges.push).toHaveBeenCalledWith(target);expect(edges.refresh).toHaveBeenCalledOnce();
 await act(async()=>root.unmount());host.remove();
});
