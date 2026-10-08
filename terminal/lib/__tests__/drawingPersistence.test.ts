import { describe, expect, it } from "vitest";
import { parseDrawingSaveReceipt, parseDrawingSnapshot, parsePersistedDrawings, prepareDrawingAttempt, settleDrawingAttempt, type DrawingJournalEntry } from "@/lib/drawingPersistence";
import { readDrawingJournal, writeDrawingJournal, writeDrawingOutbox } from "@/lib/drawingOutbox";
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
  it("retries the exact first snapshot across newer edits and a browser reload", () => {
    const storage=new MemoryStorage();
    const entry:DrawingJournalEntry={drawings:[line("first")],revision};
    const attempt=prepareDrawingAttempt(entry,()=>op)!;
    entry.drawings=[line("newer")];
    expect(writeDrawingJournal(storage,"account:a",{NVDA:entry})).toBe(true);
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
    expect(entry).toEqual({drawings:[],blocked:"legacy"});
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
