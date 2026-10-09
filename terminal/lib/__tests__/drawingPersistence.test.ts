import { describe, expect, it } from "vitest";
import { parseDrawingSaveReceipt, parseDrawingSnapshot, parsePersistedDrawings, prepareDrawingAttempt, settleDrawingAttempt, type DrawingJournalEntry } from "@/lib/drawingPersistence";
import { readDrawingJournal, writeDrawingJournal, writeDrawingOutbox, refreshDrawingJournalSymbol, reconcileDrawingJournal, selectDrawingRecoveryCopy, DRAWING_JOURNAL_KEY, DRAWING_RECEIPTS_KEY, DRAWING_RECEIPTS_UNREADABLE_KEY, DRAWING_RECEIPT_HISTORY, DRAWING_RECEIPT_OWNERS, type DrawingJournalLocks } from "@/lib/drawingOutbox";
let lockTail=Promise.resolve();
const locks={request:(_name:string, fn:()=>unknown)=>{const task=lockTail.then(fn);lockTail=task.then(()=>{},()=>{});return task;}} as DrawingJournalLocks;
const persist=(storage:MemoryStorage,journal:import("@/lib/drawingPersistence").DrawingJournal,owner="account:a")=>writeDrawingJournal(storage,owner,journal,locks);
const op = "11111111-1111-4111-8111-111111111111";
const revision = "22222222-2222-4222-8222-222222222222";
const line = (id: string) => ({ id, kind: "hline" as const, schemaVersion: 1, source: "user" as const, points: [{t:"2026-01-01",p:100}], meta:{label:"保持"} });
class MemoryStorage {
  values = new Map<string,string>();
  getItem(k:string) { return this.values.get(k) ?? null; }
  setItem(k:string,v:string) { this.values.set(k,v); }
  removeItem(k:string) { this.values.delete(k); }
}
describe("drawing observed-revision persistence", () => {
  it("does not invent IDs or discard a bad anchor before persistence", () => {
    expect(parsePersistedDrawings([{...line("a"),id:""}])).toBeNull();
    expect(parsePersistedDrawings([{...line("a"),points:[{t:"today",p:100},{t:"today",p:null}]}])).toBeNull();
    expect(parsePersistedDrawings([line("a"),line("a")])).toBeNull();
  });
  it("requires an observed revision even for an authoritative empty read", () => {
    expect(parseDrawingSnapshot({drawings:[],schemaVersion:1})).toBeNull();
    expect(parseDrawingSnapshot({drawings:[line("a")],schemaVersion:1,revision:null})).toBeNull();
    expect(parseDrawingSnapshot({drawings:[],schemaVersion:1,revision:null})).not.toBeNull();
    expect(parseDrawingSnapshot({drawings:[line("a")],schemaVersion:1,revision:"legacy:"+"a".repeat(64)})).not.toBeNull();
  });
  it("retries the exact first snapshot across newer edits and a browser reload", async () => {
    const storage=new MemoryStorage();
    const entry:DrawingJournalEntry={drawings:[line("first")],revision};
    const attempt=prepareDrawingAttempt(entry,()=>op)!;
    entry.drawings=[line("newer")];
    expect(await persist(storage,{NVDA:entry})).toBe(true);
    const recovered=readDrawingJournal(storage,"account:a").NVDA;
    const retried=prepareDrawingAttempt(recovered,()=>{throw new Error("must not mint another operation");});
    expect(retried).toEqual(attempt);
    expect(recovered.drawings[0].id).toBe("newer");
    expect(readDrawingJournal(storage,"account:b")).toEqual({});
  });
  it("retains a legacy clear-all tombstone without attaching a freshly loaded revision", () => {
    const storage=new MemoryStorage();
    writeDrawingOutbox(storage,"account:a",{NVDA:[]});
    const entry=readDrawingJournal(storage,"account:a").NVDA;
    expect(entry).toMatchObject({drawings:[],blocked:"legacy"});
    expect(prepareDrawingAttempt(entry,()=>op)).toBeNull();
    expect(Object.hasOwn(entry,"revision")).toBe(false);
  });
  it("a current replay acknowledges only its attempted edit then advances queued work", () => {
    const entry:DrawingJournalEntry={drawings:[line("first")],revision:null};
    prepareDrawingAttempt(entry,()=>op);entry.drawings=[line("newer")];
    expect(settleDrawingAttempt(entry,{ok:true,operationId:op,revision,idempotentReplay:true,superseded:false})).toBe("queued");
    expect(entry.attempt).toBeUndefined();expect(entry.revision).toBe(revision);
    expect(entry.drawings[0].id).toBe("newer");
  });
  it("a superseded replay preserves local work and never authorizes it against a newer external revision", () => {
    const entry:DrawingJournalEntry={drawings:[line("first")],revision:null};
    const attempted=prepareDrawingAttempt(entry,()=>op);entry.drawings=[line("newer")];
    expect(settleDrawingAttempt(entry,{ok:true,operationId:op,revision,idempotentReplay:true,superseded:true})).toBe("blocked");
    expect(entry.revision).toBeNull();expect(entry.attempt).toEqual(attempted);
    expect(prepareDrawingAttempt(entry,()=>"new-id")).toBeNull();
  });
  it("rejects malformed and wrong-operation successful responses", () => {
    const attempt={operationId:op,expectedRevision:null,drawings:[]};
    expect(parseDrawingSaveReceipt({ok:true},attempt)).toBeNull();
    expect(parseDrawingSaveReceipt({ok:true,operationId:revision,revision,idempotentReplay:false,superseded:false},attempt)).toBeNull();
    expect(parseDrawingSaveReceipt({ok:true,operationId:op,revision,idempotentReplay:false,superseded:true},attempt)).toBeNull();
  });
});

describe("multi-tab durable recovery",()=>{
 it("retains another tab's pending symbol when a stale journal writes and then acknowledges",async()=>{
  const storage=new MemoryStorage();const a=readDrawingJournal(storage,"account:a"),b=readDrawingJournal(storage,"account:a");
  a.NVDA={drawings:[line("A")],revision:null};b.AAPL={drawings:[line("B")],revision:null};
  await persist(storage,a);await persist(storage,b);
  expect(readDrawingJournal(storage,"account:a").NVDA.drawings[0].id).toBe("A");
  delete a.NVDA;await persist(storage,a);
  expect(readDrawingJournal(storage,"account:a").AAPL.drawings[0].id).toBe("B");
 });
 it("serializes simultaneous same-symbol writers and parks both copies for explicit choice",async()=>{
  const storage=new MemoryStorage();const a={NVDA:{drawings:[line("A")],revision:null}},b={NVDA:{drawings:[],revision:null}};
  await Promise.all([persist(storage,a),persist(storage,b)]);
  const recovered=readDrawingJournal(storage,"account:a").NVDA;
  expect([recovered,...recovered.alternatives!].map(c=>c.drawings.map(d=>d.id))).toEqual(expect.arrayContaining([["A"],[]]));
  expect(prepareDrawingAttempt(recovered,()=>op)).toBeNull();
 });
 it("forks an edited stale selection instead of replacing a newer version from another tab",async()=>{
  const storage=new MemoryStorage();await persist(storage,{NVDA:{drawings:[line("start")],revision:null}});
  const a=readDrawingJournal(storage,"account:a"),b=readDrawingJournal(storage,"account:a");
  a.NVDA.drawings=[line("new-A")];await persist(storage,a);
  b.NVDA.drawings=[line("new-B")];await persist(storage,b);
  const recovered=readDrawingJournal(storage,"account:a").NVDA;
  expect([recovered,...recovered.alternatives!].map(c=>c.drawings[0].id)).toEqual(expect.arrayContaining(["new-A","new-B"]));
 });
 it("a stale acknowledgement cannot delete another tab's newer edit of the selected copy",async()=>{
  const storage=new MemoryStorage();await persist(storage,{NVDA:{drawings:[line("start")],revision:null}});
  const a=readDrawingJournal(storage,"account:a"),b=readDrawingJournal(storage,"account:a");
  b.NVDA.drawings=[line("new-B")];await persist(storage,b);delete a.NVDA;await persist(storage,a);
  expect(readDrawingJournal(storage,"account:a").NVDA.drawings[0].id).toBe("new-B");
 });
 it("discards only an explicitly selected copy and reveals the remaining copy",async()=>{
  const storage=new MemoryStorage();await persist(storage,{NVDA:{drawings:[line("A")],revision:null}});await persist(storage,{NVDA:{drawings:[line("B")],revision:null}});
  const recovered=readDrawingJournal(storage,"account:a");const other=recovered.NVDA.alternatives![0];
  selectDrawingRecoveryCopy(recovered,"NVDA",other.recoveryId!);
  await persist(storage,recovered);delete recovered.NVDA;await persist(storage,recovered);
  const remaining=refreshDrawingJournalSymbol(storage,"account:a",recovered,"NVDA")!;
  expect(remaining.drawings[0].id).not.toBe(other.drawings[0].id);
 });
 it("keeps account namespaces during simultaneous writes",async()=>{
  const storage=new MemoryStorage();await Promise.all([persist(storage,{NVDA:{drawings:[line("A")],revision:null}},"account:a"),persist(storage,{NVDA:{drawings:[line("B")],revision:null}},"account:b")]);
  expect(readDrawingJournal(storage,"account:a").NVDA.drawings[0].id).toBe("A");expect(readDrawingJournal(storage,"account:b").NVDA.drawings[0].id).toBe("B");
 });
 it("reports absent serialization or full storage without erasing prior recovery",async()=>{
  const storage=new MemoryStorage();writeDrawingOutbox(storage,"account:a",{NVDA:[]});const before=Array.from(storage.values);
  expect(await writeDrawingJournal(storage,"account:a",{NVDA:{drawings:[line("A")],revision:null}},null)).toBe(false);
  const failing={getItem:storage.getItem.bind(storage),removeItem:()=>{throw Error("quota")},setItem:()=>{throw Error("quota")}};
  expect(await writeDrawingJournal(failing,"account:a",{NVDA:{drawings:[line("A")],revision:null}},locks)).toBe(false);
  expect(Array.from(storage.values)).toEqual(before);
 });
});

it("acknowledges a blocked exact-attempt copy without treating property insertion order as another edit",async()=>{
 const storage=new MemoryStorage();const journal=readDrawingJournal(storage,"account:a");
 journal.NVDA={drawings:[line("queued")],revision:null,attempt:{operationId:op,expectedRevision:null,drawings:[line("old")]}};
 await persist(storage,journal);journal.NVDA.blocked="superseded";await persist(storage,journal);
 delete journal.NVDA;await persist(storage,journal);
 expect(readDrawingJournal(storage,"account:a")).toEqual({});
});

it("preserves malformed recovery bytes instead of overwriting an unreadable copy",async()=>{
 for(const stored of ["{broken",JSON.stringify({"account:a":{NVDA:{format:2,copies:{[op]:{drawings:[line("A")],revision:null},bad:{secret:"unparseable prior recovery"}}}}})]){
  const storage=new MemoryStorage();storage.setItem("mm.drawing.account-outbox.v1",stored);
  expect(await persist(storage,{NVDA:{drawings:[],revision:null}})).toBe(false);
  expect(storage.getItem("mm.drawing.account-outbox.v1")).toBe(stored);
 }
});

describe("recovery across already-open legacy clients",()=>{
 it("refreshes other-tab copies on account re-entry without losing an in-memory exact retry",async()=>{
  const storage=new MemoryStorage();
  await persist(storage,{NVDA:{drawings:[line("pending-A")],revision:null,attempt:{operationId:op,expectedRevision:null,drawings:[line("sent-A")]}}});
  const memory=readDrawingJournal(storage,"account:a");
  await persist(storage,{NVDA:{drawings:[line("pending-B")],revision:null},AAPL:{drawings:[],revision:null}});
  const reconciled=reconcileDrawingJournal(storage,"account:a",memory);
  expect(reconciled.NVDA.attempt?.operationId).toBe(op);
  expect(reconciled.NVDA.alternatives?.map(entry=>entry.drawings[0].id)).toContain("pending-B");
  expect(reconciled.AAPL.drawings).toEqual([]);expect(prepareDrawingAttempt(reconciled.NVDA,()=>revision)).toBeNull();
 });
 it("forks stale memory when another tab changed the same stored copy ID",async()=>{
  const storage=new MemoryStorage();await persist(storage,{NVDA:{drawings:[line("memory-old")],revision:null}});
  const memory=readDrawingJournal(storage,"account:a"),other=readDrawingJournal(storage,"account:a");
  other.NVDA.drawings=[line("stored-new")];await persist(storage,other);
  const reconciled=reconcileDrawingJournal(storage,"account:a",memory);
  expect(reconciled.NVDA.recoveryId).not.toBe(reconciled.NVDA.alternatives![0].recoveryId);
  expect(await persist(storage,reconciled)).toBe(true);
  const recovered=readDrawingJournal(storage,"account:a").NVDA;
  expect([recovered,...recovered.alternatives!].map(entry=>entry.drawings[0].id)).toEqual(expect.arrayContaining(["memory-old","stored-new"]));
 });
 it("keeps an exact unknown operation when the old writer replaces or deletes its owner",async()=>{
  const storage=new MemoryStorage();
  const entry={drawings:[line("queued")],revision:null,attempt:{operationId:op,expectedRevision:null,drawings:[line("sent")]}};
  expect(await persist(storage,{NVDA:entry})).toBe(true);
  const durable=storage.getItem(DRAWING_JOURNAL_KEY);
  writeDrawingOutbox(storage,"account:a",{AAPL:[]});
  let recovered=readDrawingJournal(storage,"account:a");
  expect(recovered.NVDA.attempt).toEqual(entry.attempt);
  expect(recovered.AAPL).toMatchObject({drawings:[],blocked:"legacy"});
  expect(storage.getItem(DRAWING_JOURNAL_KEY)).toBe(durable);
  writeDrawingOutbox(storage,"account:a",{});
  recovered=readDrawingJournal(storage,"account:a");expect(recovered.NVDA.attempt).toEqual(entry.attempt);
 });
 it("durably imports legacy bytes without rewriting v1 and does not resurrect an acknowledged clear",async()=>{
  const storage=new MemoryStorage();writeDrawingOutbox(storage,"account:a",{NVDA:[]});
  const preimage=storage.getItem("mm.drawing.account-outbox.v1");
  const journal=readDrawingJournal(storage,"account:a");
  expect(await persist(storage,journal)).toBe(true);
  delete journal.NVDA;expect(await persist(storage,journal)).toBe(true);
  expect(storage.getItem("mm.drawing.account-outbox.v1")).toBe(preimage);
  expect(readDrawingJournal(storage,"account:a")).toEqual({});
  writeDrawingOutbox(storage,"account:a",{NVDA:[line("later-old-tab-edit")]});
  expect(readDrawingJournal(storage,"account:a").NVDA).toMatchObject({drawings:[{id:"later-old-tab-edit"}],blocked:"legacy"});
 });
 it("preserves a newly changed legacy copy while acknowledging an older observed import",async()=>{
  const storage=new MemoryStorage();writeDrawingOutbox(storage,"account:a",{NVDA:[line("old")]});
  const journal=readDrawingJournal(storage,"account:a");
  writeDrawingOutbox(storage,"account:a",{NVDA:[line("new-old-tab-edit")]});
  delete journal.NVDA;expect(await persist(storage,journal)).toBe(true);
  const recovered=readDrawingJournal(storage,"account:a").NVDA;
  expect(recovered.drawings[0].id).toBe("new-old-tab-edit");expect(recovered.blocked).toBe("legacy");
 });
 it("retains both old and newly changed legacy copies when saving a stale import",async()=>{
  const storage=new MemoryStorage();writeDrawingOutbox(storage,"account:a",{NVDA:[line("old")]});
  const journal=readDrawingJournal(storage,"account:a");
  writeDrawingOutbox(storage,"account:a",{NVDA:[line("new-old-tab-edit")]});
  expect(await persist(storage,journal)).toBe(true);
  const recovered=readDrawingJournal(storage,"account:a").NVDA;
  expect([recovered,...recovered.alternatives!].map(entry=>entry.drawings[0].id)).toEqual(expect.arrayContaining(["old","new-old-tab-edit"]));
 });
 it("keeps both versioned and legacy bytes on an import storage failure",async()=>{
  const storage=new MemoryStorage();await persist(storage,{NVDA:{drawings:[line("modern")],revision:null}});
  writeDrawingOutbox(storage,"account:a",{AAPL:[]});const before=Array.from(storage.values);
  const failing={getItem:storage.getItem.bind(storage),setItem:()=>{throw Error("quota")},removeItem:()=>{throw Error("quota")}};
  expect(await writeDrawingJournal(failing,"account:a",readDrawingJournal(storage,"account:a"),locks)).toBe(false);
  expect(Array.from(storage.values)).toEqual(before);
 });
 it("preserves a legacy account switch without exposing the other owner's pending copy",async()=>{
  const storage=new MemoryStorage();await persist(storage,{NVDA:{drawings:[line("modern-A")],revision:null}});
  writeDrawingOutbox(storage,"account:b",{NVDA:[]});
  expect(readDrawingJournal(storage,"account:a").NVDA.drawings[0].id).toBe("modern-A");
  expect(readDrawingJournal(storage,"account:b").NVDA).toMatchObject({drawings:[],blocked:"legacy"});
  const journalB=readDrawingJournal(storage,"account:b");await persist(storage,journalB,"account:b");
  expect(readDrawingJournal(storage,"account:a").NVDA.drawings[0].id).toBe("modern-A");
 });
});

describe("concurrent legacy import ownership",()=>{
  it("discards the explicitly selected copy without requiring an intervening save", async () => {
    const storage = new MemoryStorage();
    await persist(storage, { NVDA: { drawings: [line("one")], revision: null } });
    await persist(storage, { NVDA: { drawings: [line("two")], revision: null } });
    const journal = readDrawingJournal(storage, "account:a");
    const originalId = journal.NVDA.recoveryId!;
    const selectedId = journal.NVDA.alternatives![0].recoveryId!;
    expect(selectDrawingRecoveryCopy(journal, "NVDA", selectedId)?.recoveryId).toBe(selectedId);
    delete journal.NVDA; expect(await persist(storage, journal)).toBe(true);
    expect(readDrawingJournal(storage, "account:a").NVDA.recoveryId).toBe(originalId);
  });
  for (const legacy of [true, false]) {
  for (const reconcile of [false, true]) {
    for (const edited of [false, true]) {
      it(`retires an observed ${legacy ? "legacy import" : "modern copy"} after another tab acknowledges it (reconcile=${reconcile}, edited=${edited})`, async () => {
        const storage = new MemoryStorage();
        if (legacy) writeDrawingOutbox(storage, "account:a", { NVDA: [line("legacy")] });
        else expect(await persist(storage, { NVDA: { drawings: [line("modern")], revision: null } })).toBe(true);
        const a = readDrawingJournal(storage, "account:a"), b = readDrawingJournal(storage, "account:a");
        expect(await persist(storage, a)).toBe(true); expect(await persist(storage, b)).toBe(true);
        expect(a.NVDA.recoveryId).toBe(b.NVDA.recoveryId);
        delete b.NVDA; expect(await persist(storage, b)).toBe(true);
        if (edited) a.NVDA.drawings = [line("unsaved-edit")];
        if (reconcile) reconcileDrawingJournal(storage, "account:a", a);
        expect(await persist(storage, a)).toBe(true);
        const remaining = readDrawingJournal(storage, "account:a").NVDA;
        if (edited) expect(remaining.drawings[0].id).toBe("unsaved-edit");
        else { expect(remaining).toBeUndefined(); expect(a.NVDA).toBeUndefined(); }
      });
    }
  }
  }
 it("reconciles two importers to the same physical legacy copy",async()=>{
  const storage=new MemoryStorage();writeDrawingOutbox(storage,"account:a",{NVDA:[line("legacy-copy")]});
  const a=readDrawingJournal(storage,"account:a"),b=readDrawingJournal(storage,"account:a");
  await persist(storage,b);const id=b.NVDA.recoveryId;
  reconcileDrawingJournal(storage,"account:a",a);await persist(storage,a);
  expect(a.NVDA.recoveryId).toBe(id);expect(a.NVDA.alternatives).toBeUndefined();
  expect(Object.keys(JSON.parse(storage.getItem(DRAWING_JOURNAL_KEY)!)["account:a"].NVDA.copies)).toHaveLength(1);
 });
 it("reuses an import persisted by another tab without requiring account reentry",async()=>{
  const storage=new MemoryStorage();writeDrawingOutbox(storage,"account:a",{NVDA:[]});
  const a=readDrawingJournal(storage,"account:a"),b=readDrawingJournal(storage,"account:a");
  await persist(storage,b);await persist(storage,a);
  expect(a.NVDA.recoveryId).toBe(b.NVDA.recoveryId);
  expect(readDrawingJournal(storage,"account:a").NVDA.alternatives).toBeUndefined();
 });
 it("acknowledges the unchanged physical import another tab persisted",async()=>{
  const storage=new MemoryStorage();writeDrawingOutbox(storage,"account:a",{NVDA:[line("legacy-copy")]});
  const oldBytes=storage.getItem("mm.drawing.account-outbox.v1");
  const a=readDrawingJournal(storage,"account:a"),b=readDrawingJournal(storage,"account:a");
  await persist(storage,b);delete a.NVDA;await persist(storage,a);
  expect(readDrawingJournal(storage,"account:a")).toEqual({});
  expect(storage.getItem("mm.drawing.account-outbox.v1")).toBe(oldBytes);
 });
 it("does not erase a newer edit while acknowledging a stale import alias",async()=>{
  const storage=new MemoryStorage();writeDrawingOutbox(storage,"account:a",{NVDA:[line("legacy-copy")]});
  const a=readDrawingJournal(storage,"account:a"),b=readDrawingJournal(storage,"account:a");
  await persist(storage,b);b.NVDA.drawings=[line("new-B")];await persist(storage,b);
  delete a.NVDA;await persist(storage,a);
  expect(readDrawingJournal(storage,"account:a").NVDA.drawings[0].id).toBe("new-B");
 });
 it("does not resurrect an unchanged import already acknowledged by another tab",async()=>{
  const storage=new MemoryStorage();writeDrawingOutbox(storage,"account:a",{NVDA:[]});
  const a=readDrawingJournal(storage,"account:a"),b=readDrawingJournal(storage,"account:a");
  await persist(storage,b);delete b.NVDA;await persist(storage,b);
  await persist(storage,a);expect(a.NVDA).toBeUndefined();
  expect(readDrawingJournal(storage,"account:a")).toEqual({});
 });
 it("still exposes valid modern recovery when legacy bytes are corrupt, without permitting a write",async()=>{
  const storage=new MemoryStorage();await persist(storage,{NVDA:{drawings:[line("modern")],revision:null,attempt:{operationId:op,expectedRevision:null,drawings:[line("sent")]}}});
  const modern=storage.getItem(DRAWING_JOURNAL_KEY);storage.setItem("mm.drawing.account-outbox.v1","{broken");
  const journal=readDrawingJournal(storage,"account:a");expect(journal.NVDA.attempt?.operationId).toBe(op);
  expect(await persist(storage,journal)).toBe(false);
  expect(storage.getItem(DRAWING_JOURNAL_KEY)).toBe(modern);expect(storage.getItem("mm.drawing.account-outbox.v1")).toBe("{broken");
 });
});

// Clearing site data or browser eviction removes the journal without any
// acknowledgement. A missing copy alone must never retire unsaved memory, and
// it cannot prove the copy was not discarded, so it is kept for review.
describe("lost browser storage is not an acknowledgement",()=>{
 const loseSiteData=(storage:MemoryStorage)=>storage.values.clear();
 it("keeps an unchanged pending copy when the next write follows lost site data",async()=>{
  const storage=new MemoryStorage();const journal=readDrawingJournal(storage,"account:a");
  journal.NVDA={drawings:[line("unsaved")],revision:null};
  expect(await persist(storage,journal)).toBe(true);
  loseSiteData(storage);
  journal.AAPL={drawings:[line("other-symbol")],revision:null};
  expect(await persist(storage,journal)).toBe(true);
  expect(journal.NVDA?.drawings[0].id).toBe("unsaved");
  expect(readDrawingJournal(storage,"account:a").NVDA?.drawings[0].id).toBe("unsaved");
  expect(journal.NVDA?.blocked).toBe("conflict");
 });
 it("keeps the exact lost-response operation for review when the retry write follows lost site data",async()=>{
  const storage=new MemoryStorage();const journal=readDrawingJournal(storage,"account:a");
  journal.NVDA={drawings:[line("queued")],revision:null,attempt:{operationId:op,expectedRevision:null,drawings:[line("sent")]}};
  expect(await persist(storage,journal)).toBe(true);
  loseSiteData(storage);
  expect(await persist(storage,journal)).toBe(true);
  expect(journal.NVDA?.attempt?.operationId).toBe(op);
  const recovered=readDrawingJournal(storage,"account:a").NVDA;
  expect(recovered?.attempt).toEqual({operationId:op,expectedRevision:null,drawings:[line("sent")]});
  // Lost storage and a discard whose receipt was cleared look the same, so
  // the exact operation waits for an explicit choice instead of resending.
  expect(journal.NVDA?.blocked).toBe("conflict");
  expect(recovered?.blocked).toBe("conflict");
  expect(prepareDrawingAttempt(recovered!,()=>{throw new Error("must not mint another operation");})).toBeNull();
 });
 it("keeps unsaved memory on account re-entry after site data was lost",async()=>{
  const storage=new MemoryStorage();const journal=readDrawingJournal(storage,"account:a");
  journal.NVDA={drawings:[line("unsaved")],revision:revision};
  expect(await persist(storage,journal)).toBe(true);
  loseSiteData(storage);
  reconcileDrawingJournal(storage,"account:a",journal);
  expect(journal.NVDA?.drawings[0].id).toBe("unsaved");
  expect(await persist(storage,journal)).toBe(true);
  expect(readDrawingJournal(storage,"account:a").NVDA?.drawings[0].id).toBe("unsaved");
 });
 it("keeps a pending empty-collection tombstone and an old tab's legacy write after site data was lost",async()=>{
  const storage=new MemoryStorage();const journal=readDrawingJournal(storage,"account:a");
  journal.NVDA={drawings:[],revision:revision};
  expect(await persist(storage,journal)).toBe(true);
  loseSiteData(storage);
  // The production v1 writer replaces its whole owner namespace without locks.
  writeDrawingOutbox(storage,"account:a",{AAPL:[line("old-tab")]});
  expect(await persist(storage,journal)).toBe(true);
  const recovered=readDrawingJournal(storage,"account:a");
  expect(journal.NVDA).toMatchObject({drawings:[],revision});
  expect(recovered.NVDA).toMatchObject({drawings:[],revision});
  expect(recovered.AAPL).toMatchObject({drawings:[{id:"old-tab"}],blocked:"legacy"});
 });
});

// Acknowledgement receipts are positive evidence and bounded per owner. When a
// receipt ages out or is lost, a stale copy is kept again (fail-safe), but only
// for review: it is never a silent loss and never a save that runs by itself.
describe("bounded acknowledgement receipts",()=>{
 const receiptsOf=(storage:MemoryStorage,owner="account:a")=>JSON.parse(storage.getItem(DRAWING_RECEIPTS_KEY)??"{}")[owner];
 const acknowledge=async(storage:MemoryStorage,symbol:string,owner="account:a")=>{
  const journal=readDrawingJournal(storage,owner);
  journal[symbol]={drawings:[line(symbol)],revision};
  expect(await persist(storage,journal,owner)).toBe(true);
  const id=journal[symbol].recoveryId!;
  delete journal[symbol];
  expect(await persist(storage,journal,owner)).toBe(true);
  return id;
 };
 it("keeps exactly the newest 32 acknowledgements per owner",async()=>{
  expect(DRAWING_RECEIPT_HISTORY).toBe(32);
  const storage=new MemoryStorage();
  const other=await acknowledge(storage,"OTHER","account:b");
  const ids:string[]=[];
  for(let index=0;index<=DRAWING_RECEIPT_HISTORY;index++) ids.push(await acknowledge(storage,`S${index}`));
  expect(receiptsOf(storage)).toEqual(ids.slice(1));
  expect(receiptsOf(storage,"account:b")).toEqual([other]);
  expect(storage.getItem(DRAWING_JOURNAL_KEY)).toBeNull();
 });
 it("retires a stale tab's receipted copy but keeps one whose receipt aged out for review",async()=>{
  const storage=new MemoryStorage(),owner=readDrawingJournal(storage,"account:a");
  owner.NVDA={drawings:[line("seen")],revision};
  expect(await persist(storage,owner)).toBe(true);
  const id=owner.NVDA.recoveryId;
  const recent=readDrawingJournal(storage,"account:a"),aged=readDrawingJournal(storage,"account:a");
  delete owner.NVDA;
  expect(await persist(storage,owner)).toBe(true);
  expect(receiptsOf(storage)).toEqual([id]);
  expect(await persist(storage,recent)).toBe(true);
  expect(recent.NVDA).toBeUndefined();
  for(let index=0;index<DRAWING_RECEIPT_HISTORY;index++) await acknowledge(storage,`S${index}`);
  expect(receiptsOf(storage)).not.toContain(id);
  expect(await persist(storage,aged)).toBe(true);
  expect(aged.NVDA).toMatchObject({drawings:[{id:"seen"}],revision,recoveryId:id,blocked:"conflict"});
  expect(readDrawingJournal(storage,"account:a").NVDA).toMatchObject({drawings:[{id:"seen"}],revision,recoveryId:id,blocked:"conflict"});
  expect(prepareDrawingAttempt(aged.NVDA,()=>op)).toBeNull();
 });
 it("keeps a stale tab's copy for review when site data was lost after its acknowledgement",async()=>{
  const storage=new MemoryStorage(),owner=readDrawingJournal(storage,"account:a");
  owner.NVDA={drawings:[line("seen")],revision};
  expect(await persist(storage,owner)).toBe(true);
  const stale=readDrawingJournal(storage,"account:a");
  delete owner.NVDA;
  expect(await persist(storage,owner)).toBe(true);
  storage.values.clear();
  expect(await persist(storage,stale)).toBe(true);
  expect(readDrawingJournal(storage,"account:a").NVDA?.drawings[0].id).toBe("seen");
  expect(readDrawingJournal(storage,"account:a").NVDA?.blocked).toBe("conflict");
 });
 it("reads unreadable receipts as none and rebuilds them on the next acknowledgement",async()=>{
  const storage=new MemoryStorage(),owner=readDrawingJournal(storage,"account:a");
  owner.NVDA={drawings:[line("seen")],revision};
  expect(await persist(storage,owner)).toBe(true);
  const stale=readDrawingJournal(storage,"account:a");
  delete owner.NVDA;
  expect(await persist(storage,owner)).toBe(true);
  storage.setItem(DRAWING_RECEIPTS_KEY,"{broken");
  expect(await persist(storage,stale)).toBe(true);
  expect(stale.NVDA?.drawings[0].id).toBe("seen");
  const id=stale.NVDA!.recoveryId;
  delete stale.NVDA;
  expect(await persist(storage,stale)).toBe(true);
  expect(receiptsOf(storage)).toEqual([id]);
  expect(storage.getItem(DRAWING_RECEIPTS_UNREADABLE_KEY)).toBe("{broken");
 });
 it("sets unreadable receipt bytes aside instead of erasing other accounts' receipts",async()=>{
  const storage=new MemoryStorage(),other=`{"account:b":["${op}"]`;
  storage.setItem(DRAWING_RECEIPTS_KEY,other);
  const id=await acknowledge(storage,"NVDA");
  expect(receiptsOf(storage)).toEqual([id]);
  expect(storage.getItem(DRAWING_RECEIPTS_UNREADABLE_KEY)).toBe(other);
  // A later unreadable value never replaces the first one set aside.
  storage.setItem(DRAWING_RECEIPTS_KEY,"[]");
  await acknowledge(storage,"AAPL");
  expect(storage.getItem(DRAWING_RECEIPTS_UNREADABLE_KEY)).toBe(other);
 });
 it("keeps receipts for the most recently used accounts only",async()=>{
  expect(DRAWING_RECEIPT_OWNERS).toBe(8);
  const storage=new MemoryStorage(),owners=Array.from({length:DRAWING_RECEIPT_OWNERS},(_,index)=>`account:o${index}`);
  for(const owner of owners) await acknowledge(storage,"NVDA",owner);
  const kept=await acknowledge(storage,"AAPL","account:o0");
  await acknowledge(storage,"NVDA","account:new");
  const envelope=JSON.parse(storage.getItem(DRAWING_RECEIPTS_KEY)!);
  expect(Object.keys(envelope)).toEqual([...owners.slice(2),"account:o0","account:new"]);
  expect(envelope["account:o0"]).toContain(kept);
 });
});

// "Use cloud" discards a local copy without any cloud write, so the server's
// revision still matches that copy's attempt. A stale tab that later finds the
// copy missing with no receipt (aged out of the bounded history, or site data
// cleared) cannot tell a discard from lost storage. It keeps the copy for an
// explicit choice; it never restores it as an attempt that saves on its own.
describe("an explicit discard is never resurrected as a sendable attempt",()=>{
 const opX="33333333-3333-4333-8333-333333333333",opY="44444444-4444-4444-8444-444444444444";
 const ackOther=async(storage:MemoryStorage,symbol:string)=>{
  const journal=readDrawingJournal(storage,"account:a");
  journal[symbol]={drawings:[line(symbol)],revision};
  expect(await persist(storage,journal)).toBe(true);
  delete journal[symbol];
  expect(await persist(storage,journal)).toBe(true);
 };
 // Two tabs keep exact attempts through a save outage; a new tab offers both
 // copies and the user discards each one with "Use cloud" (no PUT is sent).
 const discardBothCopies=async(storage:MemoryStorage)=>{
  const tabA=readDrawingJournal(storage,"account:a"),tabB=readDrawingJournal(storage,"account:a");
  tabA.NVDA={drawings:[line("X")],revision};prepareDrawingAttempt(tabA.NVDA,()=>opX);
  expect(await persist(storage,tabA)).toBe(true);
  tabB.NVDA={drawings:[line("Y")],revision};prepareDrawingAttempt(tabB.NVDA,()=>opY);
  expect(await persist(storage,tabB)).toBe(true);
  const tabC=readDrawingJournal(storage,"account:a");
  expect(tabC.NVDA.alternatives).toHaveLength(1);
  delete tabC.NVDA;expect(await persist(storage,tabC)).toBe(true);
  const remaining=refreshDrawingJournalSymbol(storage,"account:a",tabC,"NVDA");
  expect(remaining).toBeDefined();remaining!.blocked??="conflict";
  delete tabC.NVDA;expect(await persist(storage,tabC)).toBe(true);
  expect(readDrawingJournal(storage,"account:a").NVDA).toBeUndefined();
  return tabA;
 };
 const expectReviewOnly=(entry:DrawingJournalEntry|undefined)=>{
  // The exact operation stays as evidence; only an explicit choice can send.
  expect(entry).toMatchObject({drawings:[{id:"X"}],blocked:"conflict",attempt:{operationId:opX,expectedRevision:revision}});
  expect(prepareDrawingAttempt(entry!,()=>{throw new Error("must not mint an operation");})).toBeNull();
 };
 it("drops the discarded copy while its receipt is still held",async()=>{
  const storage=new MemoryStorage(),tabA=await discardBothCopies(storage);
  for(let index=0;index<DRAWING_RECEIPT_HISTORY-3;index++) await ackOther(storage,`S${index}`);
  expect(await persist(storage,tabA)).toBe(true);
  expect(tabA.NVDA).toBeUndefined();
  expect(readDrawingJournal(storage,"account:a").NVDA).toBeUndefined();
 });
 it("keeps the copy for review after 32 other acknowledgements age its receipt out",async()=>{
  const storage=new MemoryStorage(),tabA=await discardBothCopies(storage);
  for(let index=0;index<DRAWING_RECEIPT_HISTORY;index++) await ackOther(storage,`S${index}`);
  expect(await persist(storage,tabA)).toBe(true);
  expectReviewOnly(tabA.NVDA);
  expectReviewOnly(readDrawingJournal(storage,"account:a").NVDA);
 });
 it("keeps the copy for review when site data is cleared after the discard",async()=>{
  const storage=new MemoryStorage(),tabA=await discardBothCopies(storage);
  storage.values.clear();
  expect(await persist(storage,tabA)).toBe(true);
  expectReviewOnly(tabA.NVDA);
  expectReviewOnly(readDrawingJournal(storage,"account:a").NVDA);
 });
 it("gives a newly opened tab a review, not an automatic save",async()=>{
  const storage=new MemoryStorage(),tabA=await discardBothCopies(storage);
  for(let index=0;index<DRAWING_RECEIPT_HISTORY;index++) await ackOther(storage,`S${index}`);
  expect(await persist(storage,tabA)).toBe(true);
  // TerminalShell's owner hydration flushes every recovered symbol it reads.
  const tabD=reconcileDrawingJournal(storage,"account:a",undefined);
  expectReviewOnly(tabD.NVDA);
 });
 it("still needs a choice after the stale tab edits the restored copy",async()=>{
  const storage=new MemoryStorage(),tabA=await discardBothCopies(storage);
  storage.values.clear();
  tabA.NVDA.drawings=[line("X"),line("X2")];
  expect(await persist(storage,tabA)).toBe(true);
  expect(tabA.NVDA).toMatchObject({blocked:"conflict",attempt:{operationId:opX}});
  expect(prepareDrawingAttempt(tabA.NVDA,()=>"new")).toBeNull();
 });
});
