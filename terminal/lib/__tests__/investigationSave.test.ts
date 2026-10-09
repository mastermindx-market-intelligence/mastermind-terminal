import { describe, expect, it } from "vitest";
import { beginInvestigationSave, settleInvestigationSave, retryInvestigationSave, partitionInvestigationSave, recoverInvestigationSave, investigationCommandToReconcile, resendsRefusedReferences } from "../investigationSave";
const command=()=>({id:"10000000-0000-4000-8000-000000000001",operation_id:"20000000-0000-4000-8000-000000000001",action:"create",expected_revision:0,manifest:{schema:"investigation_manifest.v2",argument_relations:[],intent:{title:"Research",question:"Exact draft",subjects:[]},layout_refs:[],thesis_refs:[],evidence_refs:[],continuation:{}}});
const identity={investigation_id:"10000000-0000-4000-8000-000000000001",revision_id:"30000000-0000-4000-8000-000000000001",sequence:1,parent_revision_id:null,operation_id:"20000000-0000-4000-8000-000000000001",author_ref:"40000000-0000-4000-8000-000000000001",recorded_at:"2026-10-04T00:00:00Z",manifest_digest:"a".repeat(64)};
describe("lost Investigation save response",()=>{
 it("allows a new operation only after an exact owner no-effect fence",()=>{
  const original=command();
  const pending=beginInvestigationSave("alice",original,{phase:"idle"});
  const uncertain=settleInvestigationSave(pending,"alice",null);
  for (const response of [{status:"not_found"},{status:"invalid_payload"},{status:"not_applied",id:original.id,operation_id:original.id}]) {
   const state=settleInvestigationSave(uncertain,"alice",response);
   expect(state.phase).toBe("uncertain");expect(retryInvestigationSave(state,"alice")).toBeNull();
  }
  const fenced=settleInvestigationSave(uncertain,"alice",{status:"not_applied",id:original.id,operation_id:original.operation_id});
  expect(fenced.phase).toBe("rejected");
  const next=retryInvestigationSave(fenced,"alice")!;
  expect(next.operation_id).not.toBe(original.operation_id);
  expect({...next,operation_id:original.operation_id}).toEqual(original);
  expect(retryInvestigationSave(fenced,"bob")).toBeNull();
  // Local storage is a draft buffer; reload must recheck the actual owner fence.
  expect(recoverInvestigationSave("alice",{owner:"alice",command:original,phase:"rejected",reason:"not_applied"})?.phase).toBe("uncertain");
 });
 it("retains the original operation and draft across loss and a temporary receipt miss",()=>{
  const draft=command();const pending=beginInvestigationSave("alice",draft,{phase:"idle"});
  draft.manifest.intent.question="Edited after send";
  let state=settleInvestigationSave(pending,"alice",null);
  state=settleInvestigationSave(state,"alice",{status:"not_found"});
  expect(state.phase).toBe("uncertain");
  expect(retryInvestigationSave(state,"alice")).toBeNull();
  expect(investigationCommandToReconcile(state,"alice")).toEqual(command());
  const retry = investigationCommandToReconcile(state,"alice")!; retry.manifest.intent.question="Bad mutation";
  expect(investigationCommandToReconcile(state,"alice")?.manifest.intent.question).toBe("Exact draft");
  expect(beginInvestigationSave("alice",{...command(),operation_id:"30000000-0000-4000-8000-000000000001"},state)).toBe(state);
 });
 it("accepts the committed original response without consulting the later head",()=>{
  const original=command();const pending=beginInvestigationSave("alice",original,{phase:"idle"});
  const response={...identity,status:"committed",id:original.id,revision:1,lifecycle:"active",manifest:original.manifest,committed_at:"2026-10-04T00:00:00Z"};
  expect(settleInvestigationSave(pending,"alice",response)).toEqual({phase:"committed",principal:"alice",result:response});
 });
 it("partitions and clears pending data on logout or account switch",()=>{
  const pending=beginInvestigationSave("alice",command(),{phase:"idle"});
  expect(retryInvestigationSave(pending,"bob")).toBeNull();
  expect(partitionInvestigationSave(pending,"bob")).toEqual({phase:"idle"});
  expect(partitionInvestigationSave(pending,null)).toEqual({phase:"idle"});
  expect(beginInvestigationSave("bob",command(),pending)).toMatchObject({phase:"pending",principal:"bob"});
 });
 it("refuses a receipt from a different body even when id and revision match",()=>{
  const draft=command();const pending=beginInvestigationSave("alice",draft,{phase:"idle"});
  const result=settleInvestigationSave(pending,"alice",{...identity,status:"committed",id:draft.id,revision:1,lifecycle:"active",manifest:{...draft.manifest,intent:{...draft.manifest.intent,question:"Wrong question"}},committed_at:"2026-10-04T00:00:00Z"});
  expect(result.phase).toBe("uncertain");
 });
 it("keeps conflicting edits visible rather than silently rebasing and writing",()=>{
  const pending=beginInvestigationSave("alice",command(),{phase:"idle"});
  const result=settleInvestigationSave(pending,"alice",{status:"version_conflict",current_revision:8});
  expect(result.phase).toBe("rejected");expect(retryInvestigationSave(result,"alice")).toBeNull();
 });
});


it("recovers a rejected exact draft without inventing a commit or automatic retry",()=>{
 const original=command();
 const rejected=recoverInvestigationSave("alice",{owner:"alice",command:original,phase:"rejected",reason:"version_conflict"});
 expect(rejected).toEqual({phase:"rejected",principal:"alice",command:original,reason:"version_conflict"});
 expect(retryInvestigationSave(rejected!,"alice")).toBeNull();
 expect(recoverInvestigationSave("bob",{owner:"alice",command:original})).toBeNull();
 expect(recoverInvestigationSave("alice",{owner:"alice",command:{...original,manifest:{}}})).toBeNull();
 expect(recoverInvestigationSave("alice",{owner:"alice",command:original,phase:"committed"})?.phase).toBe("uncertain");
 expect(recoverInvestigationSave("alice",{owner:"alice",command:original})?.phase).toBe("uncertain");
});

it("treats the at-cap no-effect answer as final without permitting the original or a replacement",()=>{
 const original=command();
 const uncertain=settleInvestigationSave(beginInvestigationSave("alice",original,{phase:"idle"}),"alice",null);
 const limited=settleInvestigationSave(uncertain,"alice",{status:"not_applied",id:original.id,operation_id:original.operation_id,reason:"limit_reached"});
 expect(limited).toEqual({phase:"rejected",principal:"alice",command:original,reason:"limit_reached"});
 expect(retryInvestigationSave(limited,"alice")).toBeNull();
 expect(investigationCommandToReconcile(limited,"alice")).toBeNull();
 // The cap keeps refusing this operation, so a reload keeps the conclusive answer and the draft.
 expect(recoverInvestigationSave("alice",{owner:"alice",command:original,phase:"rejected",reason:"limit_reached"})).toEqual(limited);
 // A reason this client does not know is not a fence and grants nothing.
 const unknown=settleInvestigationSave(uncertain,"alice",{status:"not_applied",id:original.id,operation_id:original.operation_id,reason:"quota"});
 expect(unknown.phase).toBe("uncertain");expect(retryInvestigationSave(unknown,"alice")).toBeNull();
 expect(settleInvestigationSave(uncertain,"alice",{status:"not_applied",id:original.id,operation_id:original.id,reason:"limit_reached"}).phase).toBe("uncertain");
});


describe("confirmed-fenced legacy draft transition", () => {
 const legacy = () => {
  const original = command();
  const { argument_relations: _relations, ...manifest } = original.manifest;
  return { ...original, manifest };
 };
 it.each(["create", "revise"])("preserves the legacy %s draft until an owner fence admits its new shape", action => {
  const original = { ...legacy(), action, expected_revision: action === "create" ? 0 : 3,
   layout_capture: { layout_id: "50000000-0000-4000-8000-000000000001", expected_revision: 2 } };
  const before = JSON.stringify(original);
  const recovered = recoverInvestigationSave("alice", { owner: "alice", command: original })!;
  expect(recovered.phase).toBe("uncertain");
  expect(investigationCommandToReconcile(recovered, "alice")).toEqual(original);
  expect(retryInvestigationSave(recovered, "alice")).toBeNull();
  const miss = settleInvestigationSave(recovered, "alice", { status: "not_found" });
  expect(retryInvestigationSave(miss, "alice")).toBeNull();
  const fenced = settleInvestigationSave(miss, "alice", { status: "not_applied", id: original.id, operation_id: original.operation_id });
  expect(retryInvestigationSave(fenced, "bob")).toBeNull();
  const replacement = retryInvestigationSave(fenced, "alice")!;
  expect(replacement).not.toBeNull();
  expect(replacement.operation_id).not.toBe(original.operation_id);
  expect({ ...replacement, operation_id: original.operation_id }).toEqual({
   ...original, manifest: { ...original.manifest, argument_relations: [] },
  });
  expect(JSON.stringify(original)).toBe(before);
  expect(beginInvestigationSave("alice", replacement, { phase: "idle" }).phase).toBe("pending");
 });
 it("does not invent a timestamp or erase an old calendar date to make a retry fit", () => {
  const old = legacy();
  const original = { ...old, manifest: { ...old.manifest, intent: { ...old.manifest.intent, research_as_of: "2026-10-08" } } };
  const before = JSON.stringify(original);
  const recovered = recoverInvestigationSave("alice", { owner: "alice", command: original })!;
  expect(recovered.phase).toBe("uncertain");
  const fenced = settleInvestigationSave(recovered, "alice", { status: "not_applied", id: original.id, operation_id: original.operation_id });
  expect(retryInvestigationSave(fenced, "alice")).toBeNull();
  expect(JSON.stringify(original)).toBe(before);
 });
 it.each(["create", "revise"])("refuses a %s retry whose retained layout capture is in the older revision_id format", action => {
  const capture = { layout_id: "50000000-0000-4000-8000-000000000001", expected_revision: 2, revision_id: "60000000-0000-4000-8000-000000000001" };
  const original = { ...legacy(), action, expected_revision: action === "create" ? 0 : 3, layout_capture: capture };
  const before = JSON.stringify(original);
  const recovered = recoverInvestigationSave("alice", { owner: "alice", command: original })!;
  // Recovery still reads the older capture, so the draft is retained rather than lost.
  expect(recovered).not.toBeNull();
  expect(investigationCommandToReconcile(recovered, "alice")!.layout_capture).toEqual(capture);
  const fenced = settleInvestigationSave(recovered, "alice", { status: "not_applied", id: original.id, operation_id: original.operation_id });
  expect(fenced).toMatchObject({ phase: "rejected", reason: "not_applied" });
  const fencedBefore = JSON.stringify(fenced);
  // The strict shape has no revision_id; the retry must neither resend it nor drop it silently.
  expect(retryInvestigationSave(fenced, "alice")).toBeNull();
  expect(JSON.stringify(fenced)).toBe(fencedBefore);
  expect(JSON.stringify(original)).toBe(before);
 });
 it.each(["remove", "restore"])("keeps the exact retained legacy manifest for %s", action => {
  const original = { ...legacy(), action, expected_revision: 3 };
  const recovered = recoverInvestigationSave("alice", { owner: "alice", command: original })!;
  const fenced = settleInvestigationSave(recovered, "alice", { status: "not_applied", id: original.id, operation_id: original.operation_id });
  const replacement = retryInvestigationSave(fenced, "alice")!;
  expect(replacement).not.toBeNull();
  expect(replacement.manifest).toEqual(original.manifest);
  expect(Object.hasOwn(replacement.manifest, "argument_relations")).toBe(false);
 });
});

// T03i (IW2 items 1 and 2): after a definitive layout_conflict or reference_unavailable refusal, the
// same lineage must never send the identical refused reference set again. Any deliberate change to that
// set allows one send; another lineage, another account and every other reason are never blocked here.
describe("a refused reference set is not sent again unchanged", () => {
 const L = "50000000-0000-4000-8000-000000000001", M = "50000000-0000-4000-8000-000000000002";
 const T1 = { thesis_id: "70000000-0000-4000-8000-000000000001", version_id: "70000000-0000-4000-8000-000000000002", role: "primary" as const };
 const T2 = { thesis_id: "70000000-0000-4000-8000-000000000003", version_id: "70000000-0000-4000-8000-000000000004", role: "context" as const };
 const REF = { layout_id: "50000000-0000-4000-8000-000000000003", layout_revision_id: "50000000-0000-4000-8000-000000000004", digest: "b".repeat(64), role: "supporting" as const };
 type Cmd = ReturnType<typeof command> & { layout_capture?: { layout_id: string; expected_revision: number }; manifest: ReturnType<typeof command>["manifest"] & { thesis_refs: unknown[]; layout_refs: unknown[] } };
 const create = (patch: Partial<Cmd> = {}): Cmd => ({ ...command(), layout_capture: { layout_id: L, expected_revision: 3 }, ...patch } as Cmd);
 const withRefs = (base: Cmd, thesis_refs: unknown[], layout_refs: unknown[] = []): Cmd => ({ ...base, manifest: { ...base.manifest, thesis_refs, layout_refs } } as Cmd);
 const refused = (cmd: Cmd, reason: string, principal = "alice") => ({ phase: "rejected" as const, principal, command: cmd as never, reason });
 const next = (cmd: Cmd): Cmd => ({ ...cmd, operation_id: "20000000-0000-4000-8000-0000000000ff" });
 /** The same command with No layout selected. */
 const uncaptured = (cmd: Cmd): Cmd => { const copy = { ...cmd }; delete copy.layout_capture; return copy; };
 it("blocks the identical layout capture after layout_conflict, in the same create lineage, under a new id and operation", () => {
  const sent = create();
  expect(resendsRefusedReferences(refused(sent, "layout_conflict"), "alice", next({ ...sent, id: "10000000-0000-4000-8000-0000000000aa" }) as never)).toBe(true);
 });
 it("allows a deliberate layout change after layout_conflict exactly as the server will judge it", () => {
  const state = refused(create(), "layout_conflict");
  expect(resendsRefusedReferences(state, "alice", next(create({ layout_capture: { layout_id: L, expected_revision: 4 } })) as never)).toBe(false);
  expect(resendsRefusedReferences(state, "alice", next(create({ layout_capture: { layout_id: M, expected_revision: 3 } })) as never)).toBe(false);
  expect(resendsRefusedReferences(state, "alice", next(uncaptured(create())) as never)).toBe(false);
 });
 it("blocks the identical capture, layout_refs and Thesis versions after reference_unavailable, regardless of order or role", () => {
  const sent = withRefs(create(), [T1, T2]);
  const state = refused(sent, "reference_unavailable");
  expect(resendsRefusedReferences(state, "alice", next(sent) as never)).toBe(true);
  expect(resendsRefusedReferences(state, "alice", next(withRefs(sent, [T2, { ...T1, role: "alternative" }])) as never)).toBe(true);
  const refsOnly = withRefs(uncaptured(sent), [T1], [REF]);
  expect(resendsRefusedReferences(refused(refsOnly, "reference_unavailable"), "alice", next(withRefs(refsOnly, [T1], [{ ...REF, role: "context" }])) as never)).toBe(true);
 });
 it("allows each deliberate correction after reference_unavailable", () => {
  const sent = withRefs(create(), [T1, T2]);
  const state = refused(sent, "reference_unavailable");
  expect(resendsRefusedReferences(state, "alice", next(withRefs(sent, [T1])) as never), "Thesis removed").toBe(false);
  expect(resendsRefusedReferences(state, "alice", next(withRefs(sent, [T1, { ...T2, version_id: "70000000-0000-4000-8000-000000000005" }])) as never), "another version").toBe(false);
  expect(resendsRefusedReferences(state, "alice", next({ ...sent, layout_capture: { layout_id: M, expected_revision: 1 } }) as never), "another layout").toBe(false);
  expect(resendsRefusedReferences(state, "alice", next(uncaptured(sent)) as never), "No layout selected").toBe(false);
  const refsOnly = withRefs(uncaptured(sent), [T1], [REF]);
  expect(resendsRefusedReferences(refused(refsOnly, "reference_unavailable"), "alice", next(withRefs(refsOnly, [T1], [{ ...REF, digest: "c".repeat(64) }])) as never), "another layout ref").toBe(false);
  expect(resendsRefusedReferences(refused(refsOnly, "reference_unavailable"), "alice", next(withRefs(refsOnly, [T1], [])) as never), "layout ref removed").toBe(false);
 });
 it("never blocks another lineage, another account, or a refusal for any other reason", () => {
  const revise = create({ action: "revise", expected_revision: 3 } as Partial<Cmd>);
  const otherRecord = { ...revise, id: "10000000-0000-4000-8000-0000000000bb" };
  expect(resendsRefusedReferences(refused(revise, "reference_unavailable"), "alice", next(revise) as never), "same record").toBe(true);
  expect(resendsRefusedReferences(refused(revise, "reference_unavailable"), "alice", next(otherRecord) as never), "record B").toBe(false);
  expect(resendsRefusedReferences(refused(revise, "layout_conflict"), "alice", next(otherRecord) as never), "record B").toBe(false);
  expect(resendsRefusedReferences(refused(create(), "layout_conflict"), "alice", next(revise) as never), "create refusal, revise edit").toBe(false);
  expect(resendsRefusedReferences(refused(revise, "layout_conflict"), "alice", next(create()) as never), "revise refusal, create").toBe(false);
  expect(resendsRefusedReferences(refused(create(), "layout_conflict", "bob"), "alice", next(create()) as never), "other account").toBe(false);
  for (const reason of ["not_applied", "limit_reached", "version_conflict", "invalid_payload", "idempotency_conflict", "invalid_transition"])
   expect(resendsRefusedReferences(refused(create(), reason), "alice", next(create()) as never), reason).toBe(false);
  for (const state of [{ phase: "idle" as const }, beginInvestigationSave("alice", create(), { phase: "idle" })])
   expect(resendsRefusedReferences(state, "alice", next(create()) as never)).toBe(false);
  // A layout_conflict needs a captured layout to conflict with; a set without one is not that refusal.
  expect(resendsRefusedReferences(refused(uncaptured(create()), "layout_conflict"), "alice", next(uncaptured(create())) as never)).toBe(false);
  // Remove and restore send the saved record unchanged; they are not a draft's reference set.
  const plainRevise = uncaptured(revise);
  for (const action of ["remove", "restore"]) {
   expect(resendsRefusedReferences(refused(plainRevise, "reference_unavailable"), "alice", next({ ...plainRevise, action }) as never), action).toBe(false);
   expect(resendsRefusedReferences(refused({ ...plainRevise, action }, "reference_unavailable"), "alice", next(plainRevise) as never), `${action} refusal`).toBe(false);
  }
 });
});
