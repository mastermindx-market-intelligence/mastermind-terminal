// @vitest-environment jsdom
/** Actual SQL-generated record/real decoders; auth readiness and HTTP are inert boundaries. */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import produced from "./fixtures/brief-sharing-request-record.json";
import { decodeSharingRequestRecord } from "../briefSharingRequests";
const state = vi.hoisted(() => ({ id: "10000000-0000-4000-8000-000000000001", ready: true, lang: "en" }));
vi.mock("@/components/chrome/AppShell", () => ({ useShellIdentity: () => ({ kind: "account", userId: state.id }) }));
vi.mock("@/lib/shared-shell/useReadingScope", () => ({ useReadingScope: (id: string) => ({ ready: state.ready && id !== "" }) }));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: state.lang }) }));
import Component from "@/components/briefs/BriefSharingRequestReview";
import Issuer from "@/components/briefs/BriefSharingRequestIssuer";
const selected = { delivery_id: produced.review.delivery.delivery_id, request_ref: produced.request_ref, revision: 1 as const };
const principal = "10000000-0000-4000-8000-000000000001";
const qualifiedReview = decodeSharingRequestRecord(produced, selected)!.review;
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
function shared() {
  const value = structuredClone(produced);
  const grant = { team_id: value.review.audience.team_id, content_sha256: value.review.delivery.content_sha256, effect_sha256: value.review.expected_effect_sha256, shared_by: principal, shared_at: "2026-11-04T13:00:00.000000Z" };
  return { ...value, disposition: "SHARED", resolved_at: grant.shared_at, review: { ...value.review, grant } };
}
const receipt = (access = true) => ({ schema: "mastermind.brief_delivery_sharing_receipt.v1", delivery_id: selected.delivery_id, expected_effect_sha256: produced.review.expected_effect_sha256, observation: "MATCHED", grant: shared().review.grant, current_access: access });
let host: HTMLDivElement, root: Root, fetchMock: ReturnType<typeof vi.fn>;
const tick = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
async function mount(action: "SHARE" | "KEEP_PRIVATE" | "ISSUE" | null = null) { await act(async () => { root.render(<Component selected={selected} principalId={principal} originalAction={action} originalEffect={action === "SHARE" ? produced.review.expected_effect_sha256 : null} originalIssue={action === "ISSUE" ? { team_id: produced.review.audience.team_id, content_sha256: produced.review.delivery.content_sha256 } : null} />); }); await tick(); }
const button = (text: string) => [...host.querySelectorAll("button")].find(b => b.textContent === text)!;
async function click(text: string) { await act(async () => { button(text).click(); }); await tick(); }
const posts = () => fetchMock.mock.calls.filter(([, options]) => options?.method === "POST");
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.id = principal; state.ready = true; state.lang = "en";
  window.history.replaceState(null, "", `/briefs/${selected.delivery_id}/sharing?request=${selected.request_ref}&revision=1`);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  fetchMock = vi.fn(async () => json(produced)); vi.stubGlobal("fetch", fetchMock);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("fixed explicit sharing request", () => {
  it("names actual artifact/intended team without free team selection or imaginary access", async () => {
    await mount(); expect(host.textContent).toContain("Weekly research brief"); expect(host.textContent).toContain("Research");
    expect(host.querySelector("select")).toBeNull(); expect(host.textContent).toContain("If shared");
    expect(posts()).toHaveLength(0); expect(fetchMock.mock.calls[0][0]).toContain(`request_ref=${selected.request_ref}&revision=1`);
  });
  it("binds original URL before one SHARE, then requires exact current-access receipt", async () => {
    let done = false;
    fetchMock.mockImplementation(async (url: string, options: RequestInit = {}) => {
      if (options.method === "POST") {
        expect(new URL(window.location.href).searchParams.get("attempt")).toBe("SHARE");
        expect(new URL(window.location.href).searchParams.get("expected_effect_sha256")).toBe(produced.review.expected_effect_sha256);
        const body = JSON.parse(String(options.body)); expect(body.request_ref).toBe(selected.request_ref); expect(body).not.toHaveProperty("team_id"); done = true; return json(shared());
      }
      return json(url.includes("/sharing?") ? receipt() : done ? shared() : produced);
    });
    await mount(); await click("Share with team");
    expect(posts()).toHaveLength(1); expect(host.querySelector("h1")?.textContent).toBe("Shared with your team.");
    expect(host.querySelector(`a[href='/briefs/shared/${selected.delivery_id}']`)).not.toBeNull();
  });
  it("lost response stays spent; manual same-request read may qualify recorded receipt", async () => {
    let done = false;
    fetchMock.mockImplementation(async (url: string, options: RequestInit = {}) => {
      if (options.method === "POST") { done = true; throw Error("lost response"); }
      return json(url.includes("/sharing?") ? receipt() : done ? shared() : produced);
    });
    await mount(); await click("Share with team");
    expect(host.querySelector("h1")?.textContent).toBe("We couldn't confirm what happened."); expect(posts()).toHaveLength(1);
    expect(button("Share with team")).toBeUndefined(); await click("Check original request");
    expect(host.querySelector("h1")?.textContent).toBe("Shared with your team."); expect(posts()).toHaveLength(1);
  });
  it("a recorded grant without current access never says Shared or links recipient view", async () => {
    fetchMock.mockImplementation(async (url: string) => json(url.includes("/sharing?") ? receipt(false) : shared()));
    await mount(); expect(host.querySelector("h1")?.textContent).toBe("Sharing recorded.");
    expect(host.querySelector(`a[href='/briefs/shared/${selected.delivery_id}']`)).toBeNull(); expect(posts()).toHaveLength(0);
  });
  it("KEEP_PRIVATE records only the request disposition and requires no grant", async () => {
    let done = false; const kept = { ...produced, disposition: "KEPT_PRIVATE", resolved_at: "2026-11-04T13:00:00.000000Z" };
    fetchMock.mockImplementation(async (_url: string, options: RequestInit = {}) => { if (options.method === "POST") { expect(JSON.parse(String(options.body)).action).toBe("KEEP_PRIVATE"); done = true; } return json(done ? kept : produced); });
    await mount(); await click("Keep private"); expect(posts()).toHaveLength(1);
    expect(host.querySelector("h1")?.textContent).toBe("Kept private."); expect(host.textContent).toContain("without granting team access");
  });
  it("same-render principal departure masks private content and stops actions", async () => {
    await mount(); state.id = "10000000-0000-4000-8000-000000000004";
    await mount(); expect(host.textContent).not.toContain("Weekly research brief"); expect(posts()).toHaveLength(0);
  });
  it("a retained attempt is read-only even when the source request is still OPEN", async () => {
    window.history.replaceState(null, "", window.location.pathname + window.location.search + "&attempt=KEEP_PRIVATE");
    await mount("KEEP_PRIVATE"); expect(button("Share with team")).toBeUndefined(); expect(button("Keep private")).toBeUndefined(); expect(posts()).toHaveLength(0);
    expect(host.querySelector("h1")?.textContent).toBe("We couldn't confirm what happened.");
  });
});


it("explicit issuance retains its own tuple before one POST; lost response only offers original read",async()=>{
  window.history.replaceState(null,"",`/briefs/${selected.delivery_id}/sharing`);
  fetchMock.mockImplementation(async(_url:string,options:RequestInit={})=>{
    expect(options.method).toBe("POST");const value=JSON.parse(String(options.body));
    expect(value.action).toBe("ISSUE");expect(value.team_id).toBe(produced.review.audience.team_id);
    const url=new URL(window.location.href);expect(url.searchParams.get("attempt")).toBe("ISSUE");
    expect(url.searchParams.get("request")).toBe(value.request_ref);
    expect(url.searchParams.get("request_team_id")).toBe(value.team_id);
    expect(url.searchParams.get("expected_content_sha256")).toBe(value.expected_content_sha256);
    throw Error("original response lost");
  });
  await act(async()=>root.render(<Issuer review={qualifiedReview}/>));await click("Review later in Inbox");
  expect(posts()).toHaveLength(1);expect(host.textContent).toContain("without sending again");
  expect(host.querySelector("a")?.href).toContain("attempt=ISSUE");expect(button("Review later in Inbox")).toBeUndefined();
});

it("confirmed original ISSUE read clears only its issuance marker; later ambiguous SHARE stays spent",async()=>{
  window.history.replaceState(null,"",window.location.pathname+window.location.search+`&attempt=ISSUE&request_team_id=${produced.review.audience.team_id}&expected_content_sha256=${produced.review.delivery.content_sha256}`);
  await mount("ISSUE");expect(new URL(window.location.href).searchParams.has("attempt")).toBe(false);expect(button("Share with team")).toBeDefined();
  fetchMock.mockImplementation(async(_url:string,options:RequestInit={})=>{if(options.method==="POST")throw Error("lost sharing response");return json(produced);});
  await click("Share with team");await click("Check original request");expect(posts()).toHaveLength(1);
  expect(host.querySelector("h1")?.textContent).toBe("We couldn't confirm what happened.");
  expect(button("Share with team")).toBeUndefined();expect(new URL(window.location.href).searchParams.get("attempt")).toBe("SHARE");
});


it("in-progress send is pending, then ambiguous; actual details remain closed by default",async()=>{
 let settle!:(r:Response)=>void;
 fetchMock.mockImplementation(async(_url:string,options:RequestInit={})=>options.method==="POST"?new Promise<Response>(r=>{settle=r;}):json(produced));
 await mount();expect(host.querySelector("details")?.open).toBe(false);expect(host.textContent).toContain("Request revision");
 await click("Share with team");expect(host.querySelector("h1")?.textContent).toBe("Sharing…");
 expect(host.textContent).not.toContain("We couldn't confirm what happened.");
 await act(async()=>settle(json({ok:false},503)));await tick();
 expect(host.querySelector("h1")?.textContent).toBe("We couldn't confirm what happened.");expect(posts()).toHaveLength(1);
});
