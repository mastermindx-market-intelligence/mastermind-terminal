// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import SavedScenarioCapture from "@/components/research/SavedScenarioCapture";
import InvestigationWorkspace from "@/components/workspaces/InvestigationWorkspace";
import SavedScenarioRead from "@/components/research/SavedScenarioRead";
import PinnedResearchSharing from "@/components/settings/PinnedResearchSharing";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const user = "10000000-0000-4000-8000-000000000001", recipient = "20000000-0000-4000-8000-000000000002";
const inv = "30000000-0000-4000-8000-000000000003";
const shell = vi.hoisted(() => ({ identity: { kind: "account", userId: "10000000-0000-4000-8000-000000000001", email: "owner@test" } }));
vi.mock("@/components/chrome/AppShell", () => ({ useShellIdentity: () => shell.identity }));
vi.mock("@/lib/i18n",()=>({useLang:()=>({lang:"en"})}));
vi.mock("@/lib/supabase/client",()=>({createClient:()=>({auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}})}));
const handoff = vi.hoisted(() => ({ listHandoffs: vi.fn(), readHandoff: vi.fn(), shareHandoff: vi.fn(), revokeHandoff: vi.fn(), isHandoffOwnerChangeError: () => false }));
vi.mock("@/lib/researchHandoffs", () => handoff);
const capture = {
  schema: "investigation_scenario_reference.v1", model_version: "exposure-scenario/v1",
  inputs: { targetSpot: 600, deltaSigmaPts: 1, days: 1 },
  source: { owner: "options_hub", root: "SPX", session: "2026-10-16", source_as_of: "2026-10-16t15:30:00z", evaluated_at: "2026-10-16T15:45:00Z",
    lens: { kind: "one", exp: "2026-10-30" }, selection_key: "2026-10-30|2026-10-30T09:30:00-04:00,2026-10-30|2026-10-30T16:00:00-04:00",
    basis_sha256: "a".repeat(64), gex: { sha256: "b".repeat(64), byte_length: 2048 }, moves: null },
};
const sourceProps = { inputs: capture.inputs, sourceReference: capture.source, lang: "en" as const };
const key = `mm.investigation.pending.v2:${encodeURIComponent(`account:${user}`)}`;
let el: HTMLDivElement, root: Root;
const fetcher = vi.fn();
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }
async function mount(node: ReactElement) { await act(async () => { root.render(node); }); await flush(); }
function button(text: string) { const b = [...el.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.trim() === text || b.getAttribute("aria-label") === text); if (!b) throw new Error(`Missing button ${text}: ${el.textContent}`); return b; }
function change(input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  act(() => { const proto = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); });
}
async function click(b: HTMLElement) { await act(async () => { b.click(); }); await flush(); }
function response(body: unknown, ok = true) { return { ok, status: ok ? 200 : 503, json: async () => body }; }
async function startSave() {
  await mount(<SavedScenarioCapture {...sourceProps} />);
  const fields = el.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input,textarea");
  change(fields[0], "Pinned A"); change(fields[1], "How does A compare?");
  await click(el.querySelector('[data-testid="scenario-save"]') as HTMLElement);
}
beforeEach(() => {
  sessionStorage.clear(); fetcher.mockReset(); vi.stubGlobal("fetch", fetcher);
  shell.identity = { kind: "account", userId: user, email: "owner@test" };
  Object.values(handoff).forEach(v => { if (vi.isMockFunction(v)) v.mockReset(); });
  el = document.createElement("div"); document.body.append(el); root = createRoot(el);
});
afterEach(async () => { await act(async () => root.unmount()); el.remove(); vi.unstubAllGlobals(); });

it("does not invent a source reference or send on render/input changes", async () => {
  await mount(<SavedScenarioCapture {...sourceProps} sourceReference={null} />);
  expect((el.querySelector('[data-testid="scenario-save"]') as HTMLButtonElement).disabled).toBe(true);
  expect(fetcher).not.toHaveBeenCalled();
  await mount(<SavedScenarioCapture {...sourceProps} />);
  expect(fetcher).not.toHaveBeenCalled();
});
it("retains only inputs and exact references before a lost POST response, then checks the same operation without replay", async () => {
  fetcher.mockRejectedValue(new TypeError("response lost after possible commit"));
  await startSave();
  expect(el.textContent).toContain("not confirmed");
  const pending = JSON.parse(sessionStorage.getItem(key)!);
  expect(pending.command.manifest.scenario_capture).toEqual(capture);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][1].headers["x-mm-scenario-capture"]).toBe("initial");
  const raw = JSON.stringify(pending);
  for (const forbidden of ["gexMn", "totalMn", "referenceSpot", "moveFraction", "result", "basis\""]) expect(raw).not.toContain(forbidden);
  fetcher.mockResolvedValue(response({ status: "unavailable" }, false));
  await click(button("Check original outcome"));
  expect(fetcher.mock.calls[1][0]).toContain(`operation_id=${pending.command.operation_id}`);
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  expect(el.textContent).toContain("not confirmed");
  await click(button("Retry original save"));
  const posts=fetcher.mock.calls.filter(([,init])=>init?.method==="POST");
  expect(posts).toHaveLength(2);
  expect(posts[1][1].headers["x-mm-scenario-capture"]).toBe("recover");
  expect(JSON.parse(posts[1][1].body)).toEqual(pending.command);
});
it("keeps confirmed metadata success when its GET fails and never substitutes a changed live scenario", async () => {
  let sent: { id: string; manifest: unknown };
  fetcher.mockImplementation(async (_url, init) => {
    if (init?.method === "POST") { sent = JSON.parse(init.body); return response({ status: "committed", id: sent.id, revision: 1, lifecycle: "active", manifest: sent.manifest, committed_at: "2026-10-16T20:00:00Z" }); }
    throw new TypeError("GET unavailable");
  });
  await startSave();
  expect(el.textContent).toContain("Saved · Revision 1");
  expect(el.textContent).toContain("exact readback is unavailable");
  await mount(<SavedScenarioCapture {...sourceProps} inputs={{ ...capture.inputs, targetSpot: 601 }} sourceReference={null} />);
  expect(el.textContent).toContain("Saved · Revision 1");
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
});
it("clears private legacy content on account change and never sends a legacy full-value journal", async () => {
  sessionStorage.setItem(key, JSON.stringify({ owner: `account:${user}`, command: { manifest: { scenario_capture: { basis: { gexMn: 55 }, result: { totalMn: 4 } } } } }));
  await mount(<SavedScenarioCapture {...sourceProps} />);
  await click(el.querySelector('[data-testid="scenario-save"]') as HTMLElement);
  expect(fetcher).not.toHaveBeenCalled(); expect(el.textContent).toContain("no longer accepts");
  shell.identity = { kind: "account", userId: recipient, email: "recipient@test" };
  await mount(<SavedScenarioCapture {...sourceProps} />);
  expect(el.textContent).not.toContain("gexMn"); expect(el.textContent).not.toContain("totalMn");
});
it("renders only deliberately supplied inputs/reference metadata and clears malformed values on the next render", async () => {
  await mount(<SavedScenarioRead capture={capture} lang="en" revision={{ id: inv, revision: 3 }} />);
  expect(el.textContent).toContain(capture.source.selection_key); expect(el.textContent).toContain("Opening this revision does not resolve");
  expect(el.querySelectorAll("a")).toHaveLength(0); expect(fetcher).not.toHaveBeenCalled();
  await mount(<SavedScenarioRead capture={{ ...capture, result: { totalMn: 184.7 } }} lang="en" />);
  expect(el.querySelector('[data-state="unavailable"]')).toBeTruthy(); expect(el.textContent).not.toContain("184.7"); expect(el.textContent).not.toContain(capture.source.gex.sha256);
});
const sharingProps = { t: ((s: string) => s), lang: "en" as const, identity: { kind: "account" as const, userId: user, email: "owner@test" } };
async function openSharing(read: unknown) {
  handoff.listHandoffs.mockResolvedValue({ result: { status: "listed", own: [{ id: inv, revision: 3, title: "Pinned A" }], sent: [], received: [], sentNextCursor: null, receivedNextCursor: null } });
  fetcher.mockResolvedValue(response(read));
  await mount(<PinnedResearchSharing {...sharingProps} />); await click(button("Open pinned research sharing"));
  const select = el.querySelector('select[aria-label="Choose an investigation"]') as HTMLSelectElement;
  change(select, inv); await flush();
}
it("offers a per-share checkbox only for the exact deliberately selected revision, default false", async () => {
  await openSharing({ status: "found", id: inv, revision: 3, manifest: { scenario_capture: capture } });
  const box = el.querySelector('input[type="checkbox"]') as HTMLInputElement;
  expect(box).toBeTruthy(); expect(box.checked).toBe(false);
  expect(el.textContent).toContain("current source access and availability of the exact retained source and model version");
  expect(el.textContent).toContain("Resolution is not provided here.");
  expect(el.textContent).not.toContain("live values");
  await click(box); expect(box.checked).toBe(true);
});
it("does not enable a scenario opt-in from a different revision returned by the preview", async () => {
  await openSharing({ status: "found", id: inv, revision: 4, manifest: { scenario_capture: capture } });
  expect(el.querySelector('input[type="checkbox"]')).toBeNull();
});
it("renders the recipient's explicitly included reference without source IO; legacy question-only pins stay unchanged", async () => {
  const grant = "50000000-0000-4000-8000-000000000005";
  const row = { grantId: grant, investigationId: inv, revision: 3, title: "Pinned A", sharedBy: user, granteeUserId: recipient, createdAt: "2026-10-16T20:00:00Z" };
  handoff.listHandoffs.mockResolvedValue({ result: { status: "listed", own: [], sent: [], received: [row], sentNextCursor: null, receivedNextCursor: null } });
  const payload = { schema: "mm.research_handoff.v1", grantId: grant, investigationId: inv, revision: 3, sharedBy: user,
    committedAt: "2026-10-16T20:00:00Z", intent: { title: "Pinned A", question: "Read only A" }, continuation: {}, scenarioCapture: capture };
  handoff.readHandoff.mockResolvedValue({ result: { status: "found", handoff: payload } });
  await mount(<PinnedResearchSharing {...sharingProps} />); await click(button("Open pinned research sharing")); await click(button("Read shared content"));
  expect(el.querySelector('[data-testid="saved-scenario-read"]')).toBeTruthy();
  expect(el.textContent).toContain(capture.source.selection_key); expect(fetcher).not.toHaveBeenCalled();
  await click(button("Hide shared content"));
  const { scenarioCapture: _omit, ...legacy } = payload;
  handoff.readHandoff.mockResolvedValue({ result: { status: "found", handoff: legacy } });
  await click(button("Read shared content"));
  expect(el.textContent).toContain("Read only A"); expect(el.querySelector('[data-testid="saved-scenario-read"]')).toBeNull();
});

const rawKey=`mm.investigation.pending.v2:${encodeURIComponent(user)}`;
const workspaceRead=(url:unknown)=>String(url)==="/api/investigations"?response({status:"listed",items:[]}):String(url)==="/api/layouts"?response({layouts:[]}):response({status:"not_found"});
it("capture UNKNOWN navigates/reloads through actual raw claims.sub Workspace prop and recovers same operation read-only",async()=>{
 fetcher.mockRejectedValue(new Error("possible retention/commit response lost"));await startSave();
 const journal=sessionStorage.getItem(key)!,pending=JSON.parse(journal);fetcher.mockReset().mockImplementation(async(url)=>workspaceRead(url));
 await mount(<InvestigationWorkspace ownerKey={user}/>);
 expect(fetcher.mock.calls.some(([url])=>String(url).includes(`operation_id=${pending.command.operation_id}`))).toBe(true);
 expect(fetcher.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(0);
 expect(sessionStorage.getItem(key)).toBe(journal);expect(button("Start new research").disabled).toBe(true);
 await mount(<span/>);await mount(<InvestigationWorkspace ownerKey={user}/>);
 expect(sessionStorage.getItem(key)).toBe(journal);await click(button("Retry original save"));
 const posts=fetcher.mock.calls.filter(([,init])=>init?.method==="POST");expect(posts).toHaveLength(1);
 expect(JSON.parse(posts[0][1].body)).toEqual(pending.command);expect(posts[0][1].headers["x-mm-scenario-capture"]).toBe("recover");
});
it("capture respects existing raw-UUID UNKNOWN journal instead of admitting a fresh operation",async()=>{
 fetcher.mockRejectedValue(new Error("unknown"));await startSave();const original=JSON.parse(sessionStorage.getItem(key)!);
 sessionStorage.removeItem(key);sessionStorage.setItem(rawKey,JSON.stringify({...original,owner:user}));const retained=sessionStorage.getItem(rawKey);
 await mount(<span/>);fetcher.mockReset();await startSave();expect(fetcher).not.toHaveBeenCalled();
 expect(sessionStorage.getItem(rawKey)).toBe(retained);expect(sessionStorage.getItem(key)).toBeNull();expect(el.textContent).toContain("previous save");
});
it("different UNKNOWN operations in both namespaces block recovery/retry/new drafts and preserve both byte-for-byte",async()=>{
 fetcher.mockRejectedValue(new Error("unknown"));await startSave();const original=sessionStorage.getItem(key)!,parsed=JSON.parse(original);
 const other=JSON.stringify({...parsed,owner:user,command:{...parsed.command,operation_id:inv}});sessionStorage.setItem(rawKey,other);
 fetcher.mockReset().mockImplementation(async(url)=>workspaceRead(url));await mount(<InvestigationWorkspace ownerKey={user}/>);
 expect(button("Start new research").disabled).toBe(true);expect(el.textContent).toContain("retained saves");
 expect(fetcher.mock.calls.some(([url])=>String(url).includes("operation_id="))).toBe(false);
 expect(fetcher.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(0);
 expect(sessionStorage.getItem(key)).toBe(original);expect(sessionStorage.getItem(rawKey)).toBe(other);
});
