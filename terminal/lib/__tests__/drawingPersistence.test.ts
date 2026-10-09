import { describe, expect, it } from "vitest";
import { parseDrawingSaveReceipt, parseDrawingSnapshot, parsePersistedDrawings, prepareDrawingAttempt, settleDrawingAttempt, type DrawingJournalEntry } from "@/lib/drawingPersistence";
import { readDrawingJournal, writeDrawingJournal, writeDrawingOutbox, refreshDrawingJournalSymbol, selectDrawingRecoveryCopy, type DrawingJournalLocks } from "@/lib/drawingOutbox";
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
