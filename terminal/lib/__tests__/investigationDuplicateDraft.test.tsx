// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import type { AuthObserver } from "@/lib/supabase/authLifecycle";
import InvestigationWorkspace from "@/components/workspaces/InvestigationWorkspace";
import { admitDuplicate, duplicateDraftFields } from "@/lib/investigationDuplicate";
import type { InvestigationCommand } from "../investigations";
import type { InvestigationManifest } from "../investigationContracts";
import planFixture from "./fixtures/options_plan_draft_v1.json";

const i18n = vi.hoisted(() => ({ lang: "en" as "en" | "zh" }));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: i18n.lang }) }));
const mocks = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: mocks.client }));
vi.mock("next/link", () => ({ default: ({ children, href }: React.PropsWithChildren<{ href: string }>) => <a href={href}>{children}</a> }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const owner = "local-preview";
const key = `mm.investigation.pending.v2:${owner}`;
const SOURCE_ID = "10000000-0000-4000-8000-000000000001";
const THESIS_ID = "40000000-0000-4000-8000-000000000005";
/** The referenced Thesis version is an older one; a newer version B exists but was never referenced. */
const OLDER_VERSION = "40000000-0000-4000-8000-00000000000a";
const NEWER_VERSION = "40000000-0000-4000-8000-00000000000b";
const EVIDENCE = { owner: "earnings.workspace_generation", object_type: "event_workspace", object_id: "evt-dup-source", mode: "pinned" as const, version_ref: "gen-dup-source", fingerprint: "aa".repeat(32) };
/** An acknowledged historical revision (2 of 3) whose exact set must survive a duplicate unchanged. */
const manifest: InvestigationManifest = {
 schema: "investigation_manifest.v2",
 argument_relations: [{ source: { kind: "thesis", thesis_id: THESIS_ID, version_id: OLDER_VERSION }, target: { kind: "evidence", owner: EVIDENCE.owner, object_type: EVIDENCE.object_type, object_id: EVIDENCE.object_id, mode: EVIDENCE.mode, version_ref: EVIDENCE.version_ref }, relation: "supports", rationale: "Older thesis version A stays the argument basis" }],
 intent: { title: "Duplication source", question: "Copy every exact reference", subjects: [{ kind: "security", owner: "terminal.analysis_symbol", object_id: "AAPL" }, { kind: "issuer", owner: "data_os.security_master", object_id: "US0378331005" }], horizon: "FY2026", research_as_of: "2026-09-30T16:00:00.000Z" },
 layout_refs: [{ layout_id: "30000000-0000-4000-8000-000000000003", layout_revision_id: "30000000-0000-4000-8000-000000000004", digest: "bb".repeat(32), role: "primary" }],
 thesis_refs: [{ thesis_id: THESIS_ID, version_id: OLDER_VERSION, role: "primary" }],
 evidence_refs: [EVIDENCE],
 continuation: { next_question: "Next question preserved", next_observation: "Observation preserved" },
 review_baseline_ref: EVIDENCE,
};
const foundBody = { status: "found", id: SOURCE_ID, revision: 2, current_revision: 3, lifecycle: "active", manifest, committed_at: "2026-09-30T16:00:00.000Z", layouts: [] };
const retainedCreate = {
 id: "10000000-0000-4000-8000-000000000001", operation_id: "20000000-0000-4000-8000-000000000001", action: "create", expected_revision: 0,
 manifest: { schema: "investigation_manifest.v2", intent: { title: "Retained", question: "Prior refusal", subjects: [] }, layout_refs: [], thesis_refs: [], evidence_refs: [], continuation: {} },
};
const LIMIT = "Save not completed: this account has reached its saved-research limit. No records were created. Your draft is retained.";
const UNCERTAIN = "The save outcome is not confirmed.";
const AUTH_ENDED = "Your account changed or your session ended. Sign in again to open saved research.";
type Reply = { status: number; body: unknown };
let host: HTMLDivElement, root: Root;
let posts: InvestigationCommand[], puts: unknown[], receiptReads: string[];
let detailReply: Reply, saveReply: Reply;
const reply = ({ status, body }: Reply) => Promise.resolve({ ok: status < 400, status, json: async () => body } as Response);
const button = (label: string) => [...host.querySelectorAll("button")].find(b => b.textContent === label);
const question = () => host.querySelector<HTMLTextAreaElement>(i18n.lang==="zh"?'textarea[aria-label="研究问题"]':'textarea[aria-label="Research question"]')?.value;
const title = () => host.querySelector<HTMLInputElement>('input[aria-label="Title"]')?.value;
async function click(label: string) {
 expect(button(label), label).toBeDefined();
 await act(async () => { button(label)!.click(); });
}
async function flush() { await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); }); }
async function mount(id?: string) {
 await act(async () => { root.render(id ? <InvestigationWorkspace ownerKey={owner} initialInvestigationId={id}/> : <InvestigationWorkspace ownerKey={owner}/>); });
 await flush();
}
beforeEach(() => {
 i18n.lang = "en"; mocks.client.mockReset();
 mocks.client.mockImplementation(() => { throw new Error("synthetic: no auth client expected"); });
 sessionStorage.clear(); posts = []; puts = []; receiptReads = [];
 detailReply = { status: 200, body: foundBody };
 saveReply = { status: 429, body: { status: "limit_reached" } };
 host = document.createElement("div"); document.body.append(host); root = createRoot(host);
 vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => {
  if (options?.method === "POST") { posts.push(JSON.parse(String(options.body))); return reply(saveReply); }
  if (options?.method === "PUT") { puts.push(JSON.parse(String(options.body))); return reply({ status: 503, body: { status: "unavailable" } }); }
  if (url.startsWith("/api/investigations?operation_id=")) { receiptReads.push(url); return reply({ status: 404, body: { status: "not_found" } }); }
  if (url.startsWith("/api/investigations/baseline")) return reply({ status: 404, body: { ok: false } });
  if (url.startsWith("/api/investigations?")) {
   const query = new URL(url, "https://terminal.test").searchParams;
   if (query.get("id") === SOURCE_ID) return reply(detailReply);
   return reply({ status: 404, body: { status: "not_found" } });
  }
  if (url === "/api/investigations") return reply({ status: 200, body: { status: "listed", items: [] } });
  if (url === "/api/layouts") return reply({ status: 200, body: { layouts: [] } });
  throw Error(`Unexpected request: ${url}`);
 }));
});
afterEach(() => { act(() => root.unmount()); host.remove(); sessionStorage.clear(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("IW2 P4 duplicate of one acknowledged revision (source-only fixture carrier)", () => {
 it("offers the duplicate beside Edit and a deliberate click installs only a local unsaved draft", async () => {
  await mount(SOURCE_ID);
  const allocate=vi.spyOn(crypto,"randomUUID");
  expect(title()).toBeUndefined();
  expect(button("Edit saved question")).toBeDefined();
  const duplicateButton = button("Duplicate as new research");
  expect(duplicateButton).toBeDefined();
  // A historical acknowledged revision (2 of 3) stays a valid source; nothing redirects it to currentR+1.
  expect(duplicateButton!.disabled).toBe(false);
  expect(posts).toHaveLength(0); expect(puts).toHaveLength(0); expect(receiptReads).toHaveLength(0);
  await click("Duplicate as new research");
  expect(question()).toBe("Copy every exact reference");
  expect(title()).toBe("Duplication source");
  expect(host.textContent).toContain("Unsaved copy of revision 2. Choose Save research to save a separate question.");
  // The copied subject stays readonly, the kept-layout option is offered, and no current-evidence
  // capture is offered for the copy.
  expect([...host.querySelectorAll("input")].find(i => i.value === "AAPL")!.disabled).toBe(true);
  expect(host.querySelector("select")!.value).toBe("kept");
  expect(button("Choose current Earnings evidence")).toBeUndefined();
  // Zero writes, zero id or operation allocation, no retained request created or cleared.
  expect(posts).toHaveLength(0); expect(puts).toHaveLength(0); expect(receiptReads).toHaveLength(0);
  expect(sessionStorage.getItem(key)).toBeNull();
  expect(allocate).not.toHaveBeenCalled();
 });

 it("keeps an original pending request and never allocates a duplicate while its response is outstanding",async()=>{
  detailReply={status:200,body:{...foundBody,current_revision:2}};
  await mount(SOURCE_ID);
  const ordinary=globalThis.fetch;
  let finish!: (value:Response)=>void;
  vi.stubGlobal("fetch",vi.fn((url:string,options?:RequestInit)=>{
   if(options?.method==="POST") {posts.push(JSON.parse(String(options.body)));return new Promise<Response>(resolve=>{finish=resolve;});}
   return ordinary(url,options);
  }));
  await click("Remove from saved research");
  expect(posts).toHaveLength(1);
  const pending=sessionStorage.getItem(key);
  const allocate=vi.spyOn(crypto,"randomUUID");
  expect(button("Duplicate as new research")!.disabled).toBe(true);
  await act(async()=>button("Duplicate as new research")!.click());
  expect(sessionStorage.getItem(key)).toBe(pending);expect(posts).toHaveLength(1);expect(allocate).not.toHaveBeenCalled();
  await act(async()=>finish({ok:false,status:503,json:async()=>({status:"unavailable"})} as Response));
  expect(button("Duplicate as new research")!.disabled).toBe(true);
 });

 it("retains inaccessible exact references after one create and blocks unchanged resends without substituting heads",async()=>{
  saveReply={status:422,body:{status:"reference_unavailable"}};
  await mount(SOURCE_ID);await click("Duplicate as new research");await click("Save research");
  expect(posts).toHaveLength(1);expect(posts[0].manifest).toEqual(manifest);
  expect(Object.hasOwn(posts[0],"layout_capture")).toBe(false);
  const retained=sessionStorage.getItem(key);
  expect(host.textContent).toContain("a layout or Thesis version named in this draft is no longer available");
  await click("Save research");
  expect(posts).toHaveLength(1);expect(sessionStorage.getItem(key)).toBe(retained);
  expect(question()).toBe("Copy every exact reference");expect(puts).toHaveLength(0);
 });

 it("existing Save sends one create with expected_revision 0, new identities and the exact historical manifest", async () => {
  await mount(SOURCE_ID);
  await click("Duplicate as new research");
  await click("Save research");
  await flush();
  expect(posts).toHaveLength(1);
  const command = posts[0];
  expect(command.action).toBe("create");
  expect(command.expected_revision).toBe(0);
  expect(command.id).not.toBe(SOURCE_ID);
  expect(command.operation_id).not.toBe("20000000-0000-4000-8000-000000000001");
  expect(Object.hasOwn(command, "layout_capture")).toBe(false);
  expect(command.manifest).toEqual(manifest);
  expect(command.manifest.thesis_refs[0].version_id).toBe(OLDER_VERSION);
  expect(command.manifest.thesis_refs.some(r => r.version_id === NEWER_VERSION)).toBe(false);
  expect(command.manifest.continuation).toEqual({ next_question: "Next question preserved", next_observation: "Observation preserved" });
  expect(command.manifest.intent.subjects).toEqual(manifest.intent.subjects);
  // The limit refusal is definitive for that send: the rejected draft is retained, and nothing retries it.
  expect(host.textContent).toContain(LIMIT);
  expect(question()).toBe("Copy every exact reference");
  await flush();
  expect(posts).toHaveLength(1);
  expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual({ owner, command, phase: "rejected", reason: "limit_reached" });
 });

 it("cancel clears the duplicate without writing and returns the original acknowledged detail without a fetch", async () => {
  await mount(SOURCE_ID);
  await click("Duplicate as new research");
  expect(question()).toBe("Copy every exact reference");
  await click("Cancel editing");
  expect(question()).toBeUndefined();
  expect(host.textContent).toContain("Duplication source");
  expect(host.textContent).not.toContain("Unsaved copy of revision 2.");
  expect(button("Edit saved question")).toBeDefined();
  expect(posts).toHaveLength(0); expect(puts).toHaveLength(0); expect(receiptReads).toHaveLength(0);
  expect(sessionStorage.getItem(key)).toBeNull();
 });

 it("rejects an unsupported newer payload before any duplicate can exist", async () => {
  detailReply = { status: 200, body: { ...foundBody, manifest: { ...manifest, schema: "investigation_manifest.v3", future_field: {} } } };
  await mount(SOURCE_ID);
  expect(host.textContent).toContain("This saved research link is unavailable.");
  expect(button("Duplicate as new research")).toBeUndefined();
  expect(posts).toHaveLength(0); expect(puts).toHaveLength(0);
  expect(sessionStorage.getItem(key)).toBeNull();
 });

 it("an uncertain original save blocks the duplicate while the detail stays visible", async () => {
  detailReply={status:200,body:{...foundBody,current_revision:2}};
  saveReply={status:503,body:{status:"unavailable"}};
  await mount(SOURCE_ID);
  await click("Remove from saved research");
  await flush();
  expect(host.textContent).toContain(UNCERTAIN);
  // The original operation stays locked even though the acknowledged record is on screen again.
  expect(button("Edit saved question")).toBeDefined();
  const duplicateButton = button("Duplicate as new research");
  expect(duplicateButton).toBeDefined();
  expect(duplicateButton!.disabled).toBe(true);
  duplicateButton!.click();
  await flush();
  expect(question()).toBeUndefined();
  expect(posts).toHaveLength(1); expect(puts).toHaveLength(0);
 });

 it("a stored invalid_payload recovery stays an owner recheck and never becomes a fresh duplicate", async () => {
  sessionStorage.setItem(key, JSON.stringify({ owner, command: retainedCreate, phase: "rejected", reason: "invalid_payload" }));
  await mount();
  expect(host.textContent).toContain(UNCERTAIN);
  expect(button("Duplicate as new research")).toBeUndefined();
  expect(receiptReads).toHaveLength(1);
  expect(posts).toHaveLength(0); expect(puts).toHaveLength(0);
 });

 it("carries the duplicate copy in Chinese", async () => {
  i18n.lang = "zh";
  await mount(SOURCE_ID);
  await click("复制为新研究");
  expect(question()).toBe("Copy every exact reference");
  expect(host.textContent).toContain("版本 2 的未保存副本。选择保存研究以保存独立问题。");
  expect(posts).toHaveLength(0); expect(puts).toHaveLength(0);
 });
});

describe("duplicate admission and derivation (pure)", () => {
 const source = { id: SOURCE_ID, revision: 2, lifecycle: "active" as const, manifest };
 const ready = { availability: "ready" as const, principal_partition: "account-A", auth_epoch: "epoch-1" };
 it("captures the guard only for the owner's own ready lifetime with a nonempty epoch", () => {
  expect(admitDuplicate({ ownerKey: "account-A", source, loading: false, locked: false, snapshot: ready })).toEqual({ ok: true, guard: { principal: "account-A", epoch: "epoch-1" } });
  expect(admitDuplicate({ ownerKey: "account-A", source, loading: false, locked: false, snapshot: { ...ready, availability: "unverified" } })).toEqual({ ok: false, reason: "auth" });
  expect(admitDuplicate({ ownerKey: "account-A", source, loading: false, locked: false, snapshot: { ...ready, availability: "pending" } })).toEqual({ ok: false, reason: "auth" });
  expect(admitDuplicate({ ownerKey: "account-A", source, loading: false, locked: false, snapshot: null })).toEqual({ ok: false, reason: "auth" });
  expect(admitDuplicate({ ownerKey: "account-A", source, loading: false, locked: false, snapshot: { ...ready, auth_epoch: "" } })).toEqual({ ok: false, reason: "auth" });
  expect(admitDuplicate({ ownerKey: "account-A", source, loading: false, locked: false, snapshot: { ...ready, principal_partition: "account-B" } })).toEqual({ ok: false, reason: "account" });
 });
 it("refuses absent, loading, locked and removed sources, and admits the fixture carrier", () => {
  expect(admitDuplicate({ ownerKey: "account-A", source: null, loading: false, locked: false, snapshot: ready })).toEqual({ ok: false, reason: "no_source" });
  expect(admitDuplicate({ ownerKey: "account-A", source, loading: true, locked: false, snapshot: ready })).toEqual({ ok: false, reason: "loading" });
  expect(admitDuplicate({ ownerKey: "account-A", source, loading: false, locked: true, snapshot: ready })).toEqual({ ok: false, reason: "locked" });
  expect(admitDuplicate({ ownerKey: "account-A", source: { ...source, lifecycle: "removed" }, loading: false, locked: false, snapshot: ready })).toEqual({ ok: false, reason: "removed" });
  expect(admitDuplicate({ ownerKey: "local-preview", source, loading: false, locked: false, snapshot: null })).toEqual({ ok: true, guard: { principal: "local-preview", epoch: "" } });
 });
 it("derives the historical revision's own fields, keeping the older referenced Thesis version", () => {
  const fields = duplicateDraftFields(manifest);
  expect(fields.title).toBe("Duplication source");
  expect(fields.question).toBe("Copy every exact reference");
  expect(fields.symbol).toBe("AAPL");
  expect(fields.next).toBe("Next question preserved");
  expect(fields.horizon).toBe("FY2026");
  expect(fields.asOf).toBe("2026-09-30T16:00:00.000Z");
  expect(fields.keepLayout).toBe(true);
  expect(fields.theses).toEqual([{ thesis_id: THESIS_ID, version_id: OLDER_VERSION, role: "primary" }]);
  expect(fields.theses.some(t => t.version_id === NEWER_VERSION)).toBe(false);
  expect(duplicateDraftFields({ ...manifest, layout_refs: [] }).keepLayout).toBe(false);
 });
});

/** Synthetic owner harness over the same mock patterns as the existing auth-binding suite. */
function syntheticSession(principal = "account-A", sessionId = "session-A"): Session {
 const payload = btoa(JSON.stringify({ sub: principal, session_id: sessionId, aal: "aal1" })).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
 return { access_token: `synthetic.${payload}.signature`, user: { id: principal } } as Session;
}
function harness() {
 const observers: Array<{ callback: (event: AuthChangeEvent, session: Session | null) => void; active: boolean }> = [];
 const checks: Array<{ resolve: (result: unknown) => void; reject:()=>void }> = [];
 const onAuthStateChange = vi.fn((callback: (event: AuthChangeEvent, session: Session | null) => void) => {
  const entry = { callback, active: true }; observers.push(entry);
  return { data: { subscription: { unsubscribe: vi.fn(() => { entry.active = false; }) } } };
 });
 const getClaims = vi.fn(() => new Promise<unknown>((resolve, reject) => checks.push({ resolve, reject: () => reject(new Error("synthetic verification failure")) })));
 mocks.client.mockImplementation(() => ({ auth: { onAuthStateChange, getClaims } as unknown as AuthObserver }));
 return {
  emit(event: string, session: Session | null) { for (const entry of observers) if (entry.active) entry.callback(event as AuthChangeEvent, session); },
  verify(index = 0, principal = "account-A", sessionId = "session-A") { checks[index].resolve({ data: { claims: { sub: principal, session_id: sessionId, aal: "aal1" } }, error: null }); },
 };
}
async function timers() { await act(async () => { await vi.runAllTimersAsync(); }); }

describe("duplicate and save obey the synchronous auth getter", () => {
 it("a stale enabled handler is refused by the current getter, then admitted once the lifetime is ready again", async () => {
  vi.useFakeTimers();
  const h = harness();
  await act(async () => { root.render(<InvestigationWorkspace ownerKey="account-A" initialInvestigationId={SOURCE_ID}/>); });
  await timers();
  expect(title()).toBeUndefined();
  h.emit("SIGNED_IN", syntheticSession());
  await timers(); h.verify(0); await timers();
  expect(button("Duplicate as new research")!.disabled).toBe(false);
  // A same-user epoch rotation invalidates the click immediately, even though React's projected
  // snapshot has not caught up and the handler is still enabled on screen.
  act(() => { h.emit("USER_UPDATED", syntheticSession("account-A", "session-A2")); });
  await click("Duplicate as new research");
  expect(question()).toBeUndefined();
  expect(button("Edit saved question")).toBeDefined();
  expect(posts).toHaveLength(0); expect(puts).toHaveLength(0);
  await timers(); h.verify(1, "account-A", "session-A2"); await timers();
  await click("Duplicate as new research");
  expect(question()).toBe("Copy every exact reference");
  expect(host.textContent).toContain("Unsaved copy of revision 2.");
  expect(posts).toHaveLength(0);
 });

 it("saves a ready duplicate as one create, and refuses the save after a same-user epoch change", async () => {
  vi.useFakeTimers();
  const h = harness();
  await act(async () => { root.render(<InvestigationWorkspace ownerKey="account-A" initialInvestigationId={SOURCE_ID}/>); });
  await timers();
  h.emit("SIGNED_IN", syntheticSession());
  await timers(); h.verify(0); await timers();
  await click("Duplicate as new research");
  await click("Save research");
  await timers();
  expect(posts).toHaveLength(1);
  expect(posts[0].action).toBe("create");
  expect(posts[0].expected_revision).toBe(0);
  expect(posts[0].id).not.toBe(SOURCE_ID);
  expect(posts[0].manifest).toEqual(manifest);
  // Now the epoch rotates again: the retained duplicate is never adopted on a stale identity.
  await click("Cancel editing");
  await click("Duplicate as new research");
  act(() => { h.emit("USER_UPDATED", syntheticSession("account-A", "session-A3")); });
  await timers(); h.verify(1, "account-A", "session-A3"); await timers();
  await click("Save research");
  await timers();
  expect(posts).toHaveLength(1);
  expect(question()).toBe("Copy every exact reference");
  expect(host.textContent).toContain(AUTH_ENDED);
 });

 it("another account clears the duplicate state instead of adopting it", async () => {
  vi.useFakeTimers();
  const h = harness();
  await act(async () => { root.render(<InvestigationWorkspace ownerKey="account-A" initialInvestigationId={SOURCE_ID}/>); });
  await timers();
  h.emit("SIGNED_IN", syntheticSession());
  await timers(); h.verify(0); await timers();
  await click("Duplicate as new research");
  expect(question()).toBe("Copy every exact reference");
  act(() => { h.emit("SIGNED_IN", syntheticSession("account-B", "session-B")); });
  await timers();
  expect(host.textContent).toContain(AUTH_ENDED);
  expect(button("Save research")).toBeUndefined();
  expect(posts).toHaveLength(0); expect(puts).toHaveLength(0);
 });
});


describe("existing next-observation draft field", () => {
 const observation = () => host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Next observation (optional)"]');
 async function change(value:string) {
  expect(observation()).not.toBeNull();
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(observation(),value);observation()!.dispatchEvent(new Event("input",{bubbles:true}));});
 }
 it("edits a duplicate locally, then cancels without changing the original",async()=>{
  await mount(SOURCE_ID);await click("Duplicate as new research");expect(observation()?.value).toBe("Observation preserved");
  await change("  New observation\nnot saved  ");expect(posts).toHaveLength(0);await click("Cancel editing");expect(posts).toHaveLength(0);expect(manifest.continuation.next_observation).toBe("Observation preserved");expect(observation()).toBeNull();
 });
 it("saves a changed duplicate observation only on explicit Save with every other manifest field exact",async()=>{
  await mount(SOURCE_ID);await click("Duplicate as new research");await change("  Explicit observation\nprecise  ");expect(posts).toHaveLength(0);await click("Save research");
  expect(posts).toHaveLength(1);expect(posts[0].action).toBe("create");expect(posts[0].expected_revision).toBe(0);expect(posts[0].manifest).toEqual({...manifest,continuation:{...manifest.continuation,next_observation:"  Explicit observation\nprecise  "}});expect(manifest.continuation.next_observation).toBe("Observation preserved");
 });
 it("removes only the optional observation when explicitly cleared and saved",async()=>{
  await mount(SOURCE_ID);await click("Duplicate as new research");await change("");await click("Save research");expect(posts).toHaveLength(1);expect(posts[0].manifest).toEqual({...manifest,continuation:{next_question:manifest.continuation.next_question}});
 });
 it("retains the exact observation in the draft after a definitive Save refusal",async()=>{
  await mount(SOURCE_ID);await click("Duplicate as new research");await change("Retained unsaved observation");await click("Save research");expect(posts).toHaveLength(1);expect(host.textContent).toContain(LIMIT);expect(observation()?.value).toBe("Retained unsaved observation");
  await act(async()=>root.unmount());root=createRoot(host);await mount();expect(observation()?.value).toBe("Retained unsaved observation");expect(posts).toHaveLength(1);
 });
 it("blocks an over-limit observation before any owner write",async()=>{
  await mount(SOURCE_ID);await click("Duplicate as new research");await change("x".repeat(4001));await click("Save research");expect(posts).toHaveLength(0);expect(puts).toHaveLength(0);expect(observation()?.value).toHaveLength(4001);expect(host.textContent).toContain("Next observation is too long. Use 4000 characters or fewer. Your draft is unchanged.");
 });
 it("uses the existing revise command and exact expected revision",async()=>{
  detailReply={status:200,body:{...foundBody,current_revision:2}};await mount(SOURCE_ID);await click("Edit saved question");expect(observation()?.value).toBe("Observation preserved");await change("Revised observation");expect(posts).toHaveLength(0);await click("Save research");expect(posts).toHaveLength(1);expect(posts[0]).toMatchObject({action:"revise",id:SOURCE_ID,expected_revision:2});expect(posts[0].manifest).toEqual({...manifest,continuation:{...manifest.continuation,next_observation:"Revised observation"}});
 });
});


describe("retained Plan composition in the actual existing Workspace",()=>{
 it.each(["revise","duplicate","assess"])("keeps the exact whole Plan through an explicit %s without modifying the source revision",async action=>{
  const optionRef={owner:"terminal.options_exposure",object_type:"rotation_measurement",object_id:"exact-options-source-A",mode:"pinned" as const,version_ref:"retained-vintage-A"};
  const original={...manifest,evidence_refs:[...manifest.evidence_refs,optionRef],schema:"investigation_manifest.v3" as const,option_plan:structuredClone(planFixture) as NonNullable<InvestigationManifest["option_plan"]>,review:{assessment:"inconclusive" as const,note:"Original observation"}};
  const before=JSON.stringify(original);detailReply={status:200,body:{...foundBody,current_revision:2,manifest:original}};
  await mount(SOURCE_ID);
  if(action==="assess"){
   await click("Contradicted");await click("Save as revision 3");
  }else{
   await click(action==="duplicate"?"Duplicate as new research":"Edit saved question");expect(host.querySelector('[data-testid="options-evidence"]')?.textContent).toContain(optionRef.object_id);await click("Save research");
  }
  expect(posts).toHaveLength(1);const c=posts[0];expect(c.manifest.schema).toBe("investigation_manifest.v3");expect(c.manifest.option_plan).toEqual(original.option_plan);expect(c.manifest.argument_relations).toEqual(original.argument_relations);expect(c.manifest.evidence_refs).toEqual(original.evidence_refs);expect(c.manifest.thesis_refs).toEqual(original.thesis_refs);
  expect(c.expected_revision).toBe(action==="duplicate"?0:2);expect(c.action).toBe(action==="duplicate"?"create":"revise");expect(c.manifest.review).toEqual(action==="assess"?{assessment:"contradicted"}:original.review);expect(JSON.stringify(original)).toBe(before);
 });
});
