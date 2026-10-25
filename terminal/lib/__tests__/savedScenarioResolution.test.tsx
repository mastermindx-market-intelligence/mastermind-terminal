// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import SavedScenarioRead from "@/components/research/SavedScenarioRead";
import PinnedResearchSharing from "@/components/settings/PinnedResearchSharing";
import AnalysisPage from "@/app/(shell)/analysis/page";
import InvestigationWorkspaceMount from "@/components/mounts/InvestigationWorkspaceMount";
import InvestigationWorkspace from "@/components/workspaces/InvestigationWorkspace";
import { fmtMovePct, fmtScenarioMn, localScenarioValue, type ScenarioBasis, type ScenarioInputs, type ScenarioValue } from "@/lib/exposureScenario";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const user = "10000000-0000-4000-8000-000000000001", recipient = "20000000-0000-4000-8000-000000000002";
const invA = "30000000-0000-4000-8000-000000000003", invB = "30000000-0000-4000-8000-000000000004";
const grantA = "50000000-0000-4000-8000-000000000005", grantB = "60000000-0000-4000-8000-000000000006";

const handoff = vi.hoisted(() => ({ listHandoffs: vi.fn(), readHandoff: vi.fn(), shareHandoff: vi.fn(), revokeHandoff: vi.fn(), isHandoffOwnerChangeError: () => false }));
vi.mock("@/lib/researchHandoffs", () => handoff);
const supabase = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/client", () => supabase);
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getClaims:async()=>({data:{claims:{sub:"10000000-0000-4000-8000-000000000001"}}})}})}));
const i18n = vi.hoisted(() => ({ useLang: vi.fn() }));
vi.mock("@/lib/i18n", () => i18n);

// Known-valid strict reference-only captures (shape proven by the strict parser contract).
const captureA = {
  schema: "investigation_scenario_reference.v1", model_version: "exposure-scenario/v1",
  inputs: { targetSpot: 600, deltaSigmaPts: 1, days: 1 },
  source: { owner: "options_hub", root: "SPX", session: "2026-10-16", source_as_of: "2026-10-16t15:30:00z", evaluated_at: "2026-10-16T15:45:00Z",
    lens: { kind: "one", exp: "2026-10-30" }, selection_key: "2026-10-30|2026-10-30T09:30:00-04:00,2026-10-30|2026-10-30T16:00:00-04:00",
    basis_sha256: "a".repeat(64), gex: { sha256: "b".repeat(64), byte_length: 2048 }, moves: null },
};
const captureB = { ...captureA, inputs: { targetSpot: 601, deltaSigmaPts: -1, days: 0 },
  source: { ...captureA.source, basis_sha256: "c".repeat(64) } };

const basisA: ScenarioBasis = { root: "SPX", session: "2026-10-16", referenceSpot: 600.24, gexMn: -1383, vexMn: 220, cexMn: -80, emPct: null, qualification: "qualified", sourceRef: null };
const basisB: ScenarioBasis = { root: "SPX", session: "2026-10-16", referenceSpot: 602, gexMn: 900, vexMn: -150, cexMn: 40, emPct: 1.2, qualification: "qualified", sourceRef: "opt-hub:spx:2026-10-16" };

function resolved(basis: ScenarioBasis, inputs: ScenarioInputs): ScenarioValue {
  const v = localScenarioValue(basis, inputs);
  if (!v.ok) throw new Error("fixture basis must resolve");
  return v;
}
const valueA = resolved(basisA, captureA.inputs), valueB = resolved(basisB, captureB.inputs);
const totalA = fmtScenarioMn(valueA.totalMn, 3), totalB = fmtScenarioMn(valueB.totalMn, 3);
const moveA = fmtMovePct(valueA.moveFraction);

function bound(o: { inv: string; rev: number; grant: string | null; cap: unknown; basis: ScenarioBasis; value: ScenarioValue }) {
  return { status: "resolved", investigation_id: o.inv, revision: o.rev, grant_id: o.grant, capture: o.cap, basis: o.basis, result: o.value };
}
const okA = { inv: invA, rev: 2, grant: null, cap: captureA, basis: basisA, value: valueA };
const okAg = { inv: invA, rev: 3, grant: grantA, cap: captureA, basis: basisA, value: valueA };
const okB = { inv: invB, rev: 2, grant: null, cap: captureB, basis: basisB, value: valueB };
const okBg = { inv: invB, rev: 3, grant: grantB, cap: captureB, basis: basisB, value: valueB };
const postA = JSON.stringify({ investigation_id: invA, revision: 2, grant_id: null });
const postA3 = JSON.stringify({ investigation_id: invA, revision: 3, grant_id: null });
const postAg = JSON.stringify({ investigation_id: invA, revision: 3, grant_id: grantA });
const postB = JSON.stringify({ investigation_id: invB, revision: 2, grant_id: null });
const postBg = JSON.stringify({ investigation_id: invB, revision: 3, grant_id: grantB });

// Workspace fixtures mirror exactly the manifest shape the workspace itself builds and reopens.
const manifestFor = (cap: unknown, title: string, question: string) => ({
  schema: "investigation_manifest.v2",
  intent: { title, question, subjects: [{ owner: "terminal.analysis_symbol", kind: "security", object_id: "SPX" }] },
  layout_refs: [], thesis_refs: [], evidence_refs: [], continuation: {},
  ...(cap ? { scenario_capture: cap } : {}),
});
const detailFor = (id: string, cap: unknown, title: string, question: string) => ({
  status: "found", id, revision: 2, current_revision: 2, lifecycle: "active", manifest: manifestFor(cap, title, question), committed_at: "2026-10-16T20:00:00Z", layouts: [],
});
const detailA = detailFor(invA, captureA, "Pinned A", "How does A compare?");
const detailB = detailFor(invB, captureB, "Pinned B", "How does B compare?");
const summaryFor = (id: string, title: string, question: string) => ({ id, title, question, revision: 2, updated_at: "2026-10-16T20:00:00Z", lifecycle: "active" });
const summaryA = summaryFor(invA, "Pinned A", "How does A compare?"), summaryB = summaryFor(invB, "Pinned B", "How does B compare?");

const sharingIdentity = { kind: "account" as const, userId: recipient, email: "recipient@test" };
const sharingProps = { t: ((s: string) => s), lang: "en" as const, identity: sharingIdentity };
const rowFor = (grant: string) => ({ grantId: grant, investigationId: grant === grantA ? invA : invB, revision: 3,
  title: grant === grantA ? "Pinned A" : "Pinned B", sharedBy: user, granteeUserId: recipient, createdAt: "2026-10-16T20:00:00Z" });
function handoffPayload(grant: string) {
  const a = grant === grantA;
  return { schema: "mm.research_handoff.v1", grantId: grant, investigationId: a ? invA : invB, revision: 3, sharedBy: user,
    committedAt: "2026-10-16T20:00:00Z", intent: { title: a ? "Pinned A" : "Pinned B", question: a ? "Read only A" : "Read only B" },
    continuation: {}, scenarioCapture: a ? captureA : captureB };
}

let el: HTMLDivElement, root: Root;
const fetcher = vi.fn();
let posts: string[] = [], postQueue: unknown[] = [], details: Map<string, unknown> = new Map();
const jsonOk = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

async function flush() { await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); }); }
async function mount(node: ReactElement) { await act(async () => { root.render(node); }); await flush(); }
function buttons(text: string) { return [...el.querySelectorAll<HTMLButtonElement>("button")].filter(b => b.textContent?.trim() === text || b.getAttribute("aria-label") === text); }
function button(text: string) { const b = buttons(text)[0]; if (!b) throw new Error(`Missing button ${text}: ${el.textContent}`); return b; }
function rowButton(title: string) { const b = [...el.querySelectorAll<HTMLButtonElement>("button")].find(x => x.textContent?.includes(title)); if (!b) throw new Error(`Missing row ${title}: ${el.textContent}`); return b; }
async function click(b: HTMLElement) { await act(async () => { b.click(); }); await flush(); }
const resolveState = () => el.querySelector('[data-testid="scenario-resolution"]')?.getAttribute("data-state") ?? null;

beforeEach(() => {
  posts = []; postQueue = []; details = new Map([[invA, detailA], [invB, detailB]]);
  fetcher.mockReset(); vi.stubGlobal("fetch", fetcher);
  Object.values(handoff).forEach(v => { if (vi.isMockFunction(v)) v.mockReset(); });
  handoff.isHandoffOwnerChangeError = () => false;
  i18n.useLang.mockReset().mockReturnValue({ lang: "en" });
  supabase.createClient.mockReset().mockReturnValue({ auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) } });
  fetcher.mockImplementation(async (url: unknown, init?: { body?: string }) => {
    const u = String(url);
    if (u.startsWith("/api/investigation-scenarios")) {
      posts.push(String(init?.body));
      const next = postQueue.shift();
      if (next instanceof Error) throw next;
      return jsonOk(next ?? {});
    }
    if (u === "/api/investigations") return jsonOk({ status: "listed", items: [summaryA, summaryB] });
    if (u.startsWith("/api/investigations?")) {
      const id = new URLSearchParams(u.split("?")[1]).get("id") ?? "";
      return jsonOk(details.get(id) ?? { status: "not_found" });
    }
    if (u === "/api/layouts") return jsonOk({ layouts: [] });
    if (u === "/api/alerts") return { ok: false, status: 401, json: async () => ({}) };
    throw new Error(`unexpected fetch ${u}`);
  });
  el = document.createElement("div"); document.body.append(el); root = createRoot(el);
});
afterEach(async () => { await act(async () => root.unmount()); el.remove(); vi.unstubAllGlobals(); });

const readIdentity = { kind: "account" as const, userId: user, email: "owner@test" };
const readProps = { capture: captureA as unknown, lang: "en" as const, revision: { id: invA, revision: 2, grantId: null }, identity: readIdentity };

it("owner resolve is explicit and click-only, POSTs the exact three-key owner binding, and paints the native readout", async () => {
  await mount(<InvestigationWorkspace ownerKey={user} />);
  expect(posts).toHaveLength(0);
  await click(rowButton("Pinned A"));
  expect(el.querySelector('[data-testid="saved-scenario"]')).toBeTruthy();
  expect(buttons("Resolve saved scenario")).toHaveLength(1);
  expect(posts).toHaveLength(0); // opening the research never resolves by itself
  postQueue.push(bound(okA));
  await click(button("Resolve saved scenario"));
  expect(posts).toEqual([postA]);
  expect(el.textContent).toContain(totalA);
  expect(el.textContent).toContain(moveA);
  expect(el.textContent).toContain("Resolved for this exact revision (read-only)");
  expect(el.textContent).toContain("qualified");
  // The readout is read-only: the saved-scenario card gains no editable field to re-enable saving.
  expect(el.querySelector('[data-testid="saved-scenario"] input, [data-testid="saved-scenario"] textarea')).toBeNull();
});

it("owner A→inspect B→reopen A refetches A's exact context and never substitutes or reuses values", async () => {
  await mount(<InvestigationWorkspace ownerKey={user} />);
  await click(rowButton("Pinned A"));
  postQueue.push(bound(okA));
  await click(button("Resolve saved scenario"));
  expect(el.textContent).toContain(totalA);
  await click(rowButton("Pinned B"));
  expect(el.textContent).not.toContain(totalA); // capture change cleared the paid values synchronously
  expect(resolveState()).toBe("unverified");
  postQueue.push(bound(okB));
  await click(button("Resolve saved scenario"));
  expect(el.textContent).toContain(totalB);
  expect(el.textContent).not.toContain(totalA);
  await click(rowButton("Pinned A"));
  expect(el.textContent).not.toContain(totalB);
  expect(resolveState()).toBe("unverified");
  postQueue.push(bound(okA));
  await click(button("Resolve saved scenario"));
  expect(posts).toEqual([postA, postB, postA]); // A was refetched with its own exact body
  expect(el.textContent).toContain(totalA);
  expect(el.textContent).not.toContain(totalB);
});

it("recipient resolve is grant-bound and refuses an answer bound to a different grant", async () => {
  handoff.listHandoffs.mockResolvedValue({ result: { status: "listed", own: [], sent: [], received: [rowFor(grantA)], sentNextCursor: null, receivedNextCursor: null } });
  handoff.readHandoff.mockResolvedValue({ result: { status: "found", handoff: handoffPayload(grantA) } });
  await mount(<PinnedResearchSharing {...sharingProps} />);
  await click(button("Open pinned research sharing"));
  await click(button("Read shared content"));
  expect(el.textContent).toContain("Read only A");
  expect(buttons("Resolve saved scenario")).toHaveLength(1);
  // An answer for the wrong grant is not this share's answer: discarded, nothing painted.
  postQueue.push(bound({ ...okAg, grant: grantB }));
  await click(button("Resolve saved scenario"));
  expect(posts).toEqual([postAg]);
  expect(resolveState()).toBe("mismatch");
  expect(el.textContent).toContain("did not match this exact saved reference");
  expect(el.textContent).not.toContain(totalA);
  // Explicit retry with the correctly bound answer paints.
  postQueue.push(bound(okAg));
  await click(button("Resolve saved scenario"));
  expect(posts).toEqual([postAg, postAg]);
  expect(el.textContent).toContain(totalA);
});

it("recipient A→inspect B→reopen A refetches each share's exact grant-bound context", async () => {
  handoff.listHandoffs.mockResolvedValue({ result: { status: "listed", own: [], sent: [], received: [rowFor(grantA), rowFor(grantB)], sentNextCursor: null, receivedNextCursor: null } });
  handoff.readHandoff.mockImplementation(async (_u: string, g: string) => ({ result: { status: "found", handoff: handoffPayload(g) } }));
  await mount(<PinnedResearchSharing {...sharingProps} />);
  await click(button("Open pinned research sharing"));
  await click(buttons("Read shared content")[0]);
  postQueue.push(bound(okAg));
  await click(button("Resolve saved scenario"));
  expect(el.textContent).toContain(totalA);
  await click(button("Hide shared content"));
  expect(el.textContent).not.toContain(totalA);
  await click(buttons("Read shared content")[1]);
  postQueue.push(bound(okBg));
  await click(button("Resolve saved scenario"));
  expect(posts).toEqual([postAg, postBg]);
  expect(el.textContent).toContain(totalB);
  expect(el.textContent).not.toContain(totalA);
  await click(button("Hide shared content"));
  await click(buttons("Read shared content")[0]);
  expect(el.textContent).not.toContain(totalB); // reopening A starts unverified again
  expect(resolveState()).toBe("unverified");
  postQueue.push(bound(okAg));
  await click(button("Resolve saved scenario"));
  expect(posts).toEqual([postAg, postBg, postAg]); // A's exact request replayed only by explicit click
  expect(el.textContent).toContain(totalA);
  expect(el.textContent).not.toContain(totalB);
});

it("an in-flight answer that completes after a context change or unmount never paints", async () => {
  await mount(<InvestigationWorkspace ownerKey={user} />);
  await click(rowButton("Pinned A"));
  let releaseA!: (v: unknown) => void;
  postQueue.push(new Promise<unknown>((resolve) => { releaseA = resolve; }).then((body) => jsonOk(body)));
  await click(button("Resolve saved scenario"));
  expect(resolveState()).toBe("resolving");
  await click(rowButton("Pinned B")); // capture change replaces (and aborts) A's resolver
  await act(async () => { releaseA(bound(okA)); for (let i = 0; i < 20; i++) await Promise.resolve(); });
  expect(el.textContent).not.toContain(totalA); // the late A answer never paints into B's view
  expect(resolveState()).toBe("unverified");
  // Unmount while B resolves: the answer resolves into nothing.
  let releaseB!: (v: unknown) => void;
  postQueue.push(new Promise<unknown>((resolve) => { releaseB = resolve; }).then((body) => jsonOk(body)));
  await click(button("Resolve saved scenario"));
  await act(async () => { root.unmount(); });
  await act(async () => { releaseB(bound(okB)); for (let i = 0; i < 20; i++) await Promise.resolve(); });
  expect(document.body.textContent).not.toContain(totalB);
  expect(posts).toEqual([postA, postB]);
});

it("an identity change clears painted values synchronously and a guest is never offered resolve", async () => {
  postQueue.push(bound(okA));
  await mount(<SavedScenarioRead {...readProps} />);
  await click(button("Resolve saved scenario"));
  expect(el.textContent).toContain(totalA);
  await mount(<SavedScenarioRead {...readProps} identity={{ kind: "account", userId: recipient, email: "r@test" }} />);
  expect(el.textContent).not.toContain(totalA); // key change cleared the private values
  expect(button("Resolve saved scenario").disabled).toBe(false);
  expect(posts).toHaveLength(1); // and nothing refetched by itself
  await mount(<SavedScenarioRead {...readProps} identity={{ kind: "guest" }} />);
  expect(buttons("Resolve saved scenario")).toHaveLength(0);
  expect(resolveState()).toBe("unverified");
  expect(posts).toHaveLength(1);
});

it("denied and unavailable answers are truthful failures that clear paid values; an invalid historical capture never resolves", async () => {
  await mount(<SavedScenarioRead {...readProps} />);
  postQueue.push({ status: "denied", reason: "rights_unqualified" });
  await click(button("Resolve saved scenario"));
  expect(resolveState()).toBe("denied");
  expect(el.textContent).toContain("requires current access to the exact referenced source");
  expect(el.textContent).not.toContain(totalA);
  expect(button("Resolve saved scenario").disabled).toBe(false);
  postQueue.push({ status: "unavailable", reason: "source_unavailable" });
  await click(button("Resolve saved scenario"));
  expect(resolveState()).toBe("unavailable");
  expect(el.textContent).toContain("could not be resolved right now");
  expect(posts).toEqual([postA, postA]);
  // A legacy full-value payload is the unavailable card: no resolver, no request, no values.
  await mount(<SavedScenarioRead {...readProps} capture={{ ...captureA, result: { totalMn: 184.7 } }} />);
  expect(el.querySelector('[data-testid="saved-scenario-read"][data-state="unavailable"]')).toBeTruthy();
  expect(buttons("Resolve saved scenario")).toHaveLength(0);
  expect(posts).toHaveLength(2);
  expect(el.textContent).not.toContain("184.7");
});

it("malformed, wrong-version, wrong-capture and lost answers are never success; only the bound answer paints", async () => {
  await mount(<SavedScenarioRead {...readProps} />);
  postQueue.push({ status: "resolved" });
  await click(button("Resolve saved scenario"));
  expect(resolveState()).toBe("mismatch");
  expect(el.textContent).not.toContain(totalA);
  const badVersion = { ...valueA, version: "exposure-scenario/v0" } as unknown as ScenarioValue;
  postQueue.push(bound({ ...okA, value: badVersion }));
  await click(button("Resolve saved scenario"));
  expect(resolveState()).toBe("mismatch");
  postQueue.push(bound({ ...okA, cap: captureB })); // an answer about another reference
  await click(button("Resolve saved scenario"));
  expect(resolveState()).toBe("mismatch");
  postQueue.push(new Error("transport lost"));
  await click(button("Resolve saved scenario"));
  expect(resolveState()).toBe("unavailable");
  expect(el.textContent).toContain("could not be resolved right now");
  expect(el.textContent).not.toContain(totalA);
  expect(posts).toEqual([postA, postA, postA, postA]);
  postQueue.push(bound(okA));
  await click(button("Resolve saved scenario"));
  expect(el.textContent).toContain(totalA);
  expect(resolveState()).toBe("resolved");
});

it("missing or malformed context, and guests, stay metadata-only with the truthful unverified line", async () => {
  await mount(<SavedScenarioRead {...readProps} revision={{ id: invA }} />);
  expect(buttons("Resolve saved scenario")).toHaveLength(0);
  expect(resolveState()).toBe("unverified");
  expect(el.textContent).toContain("Not verified");
  await mount(<SavedScenarioRead {...readProps} revision={{ id: "not-a-uuid", revision: 3 }} />);
  expect(buttons("Resolve saved scenario")).toHaveLength(0);
  await mount(<SavedScenarioRead {...readProps} identity={{ kind: "guest" }} />);
  expect(buttons("Resolve saved scenario")).toHaveLength(0);
  expect(posts).toHaveLength(0);
  expect(el.textContent).toContain(captureA.source.selection_key); // metadata stays
  expect(el.querySelectorAll("a")).toHaveLength(0);
});

// Full-precision native math cannot be replaced by even a slightly rounded answer.
it("rejects a rounded native total instead of presenting it as the exact saved result", async () => {
  await mount(<SavedScenarioRead {...readProps} />);
  postQueue.push(bound({ ...okA, value: { ...valueA, totalMn: valueA.totalMn + 1e-10 } }));
  await click(button("Resolve saved scenario"));
  expect(resolveState()).toBe("mismatch");
  expect(el.querySelector('[data-testid="scenario-resolution"]')?.textContent).not.toContain(totalA);
});

it("uses nondisclosing not-found copy without asserting a terminally ended share", async () => {
  await mount(<SavedScenarioRead {...readProps} />);
  postQueue.push({ status: "not_found" });
  await click(button("Resolve saved scenario"));
  expect(resolveState()).toBe("not_found");
  expect(el.textContent).toContain("unavailable for this revision and your current access");
  expect(el.textContent).not.toContain("share has ended");
});
it("never paints a success body from a failed HTTP response", async () => {
  await mount(<SavedScenarioRead {...readProps} />);
  fetcher.mockResolvedValueOnce({ ok: false, status: 403, json: async () => bound(okA) });
  await click(button("Resolve saved scenario"));
  expect(resolveState()).toBe("unavailable");
  expect(el.querySelector('[data-testid="scenario-resolution"]')?.textContent).not.toContain(totalA);
});

it("actual authenticated analysis page and mount pass raw claims.sub to the real owner-resolve Workspace",async()=>{
 const page=await AnalysisPage({searchParams:Promise.resolve({view:"investigations",investigation:invA,revision:"2"})});
 expect(page.props.ownerKey).toBe(user);
 const mount=InvestigationWorkspaceMount(page.props);expect(mount.props.ownerKey).toBe(user);
 await mountWorkspace(mount.props);
 expect(buttons("Resolve saved scenario")).toHaveLength(1);
 expect(posts).toHaveLength(0);
});
async function mountWorkspace(props:React.ComponentProps<typeof InvestigationWorkspace>){await mount(<InvestigationWorkspace {...props}/>);}
