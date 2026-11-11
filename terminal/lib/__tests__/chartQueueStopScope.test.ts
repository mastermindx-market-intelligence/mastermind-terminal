// Authored for the deferred combined qualification; no execution claimed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandQueue, type QueueStep } from "../chartBus";

const step = (id: string, error?: string): QueueStep => ({
  op: "draw.hline", id, ok: !error, ...(error ? { error } : {}),
});

describe("reply-scoped cancellation on the existing queue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("cancels matching pending batches without running or cancelling other replies", () => {
    const q = new CommandQueue(100), ran: string[] = [], cancelled: string[] = [];
    const rows: QueueStep[] = []; q.on(row => rows.push(row));
    for (const [id, batch] of [["a", "brain_a"], ["b", "brain_b"], ["c", "brain_a"]]) {
      q.enqueue(() => { ran.push(id); return step(id); },
        () => { cancelled.push(id); return step(id, "command_cancelled_by_user"); }, batch);
    }
    expect(q.cancelBatches(["brain_a"])).toBe(2);
    expect(cancelled).toEqual(["a", "c"]);
    expect(ran).toEqual([]);
    expect(q.size).toBe(1);
    vi.advanceTimersByTime(100);
    expect(ran).toEqual(["b"]);
    expect(rows.map(row => row.id)).toEqual(["a", "c", "b"]);
  });

  it("keeps already-applied work and cancels only the remainder", () => {
    const q = new CommandQueue(100), ran: string[] = [], cancelled: string[] = [];
    for (const id of ["first", "second", "third"]) q.enqueue(
      () => { ran.push(id); return step(id); },
      () => { cancelled.push(id); return step(id, "command_cancelled_by_user"); }, "brain_a");
    vi.advanceTimersByTime(100);
    expect(q.cancelBatches(["brain_a"])).toBe(2);
    vi.runAllTimers();
    expect(ran).toEqual(["first"]);
    expect(cancelled).toEqual(["second", "third"]);
    expect(q.cancelBatches(["brain_a"])).toBe(0);
  });

  it("does not postpone another reply's already-scheduled next action", () => {
    const q = new CommandQueue(100), ran: string[] = [];
    q.enqueue(() => { ran.push("other"); return step("other"); }, undefined, "brain_b");
    q.enqueue(() => step("cancel"), () => step("cancel", "command_cancelled_by_user"), "brain_a");
    vi.advanceTimersByTime(90);
    q.cancelBatches(["brain_a"]);
    vi.advanceTimersByTime(10);
    expect(ran).toEqual(["other"]);
  });

  it("leaves untagged legacy/theater work alone during reply-scoped Stop", () => {
    const q = new CommandQueue(100), run = vi.fn(() => step("legacy"));
    q.enqueue(run);
    expect(q.cancelBatches(["brain_a"])).toBe(0);
    vi.advanceTimersByTime(100);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it.each([null, [], [""], ["brain_a", 4], ["x".repeat(41)], Array(65).fill("brain_a")])(
    "invalid/empty scopes never broaden to cancel-all: %j", raw => {
      const q = new CommandQueue(100), run = vi.fn(() => step("a"));
      q.enqueue(run, undefined, "brain_a");
      expect(q.cancelBatches(raw as unknown as string[])).toBe(0);
      vi.advanceTimersByTime(100);
      expect(run).toHaveBeenCalledTimes(1);
    });

  it("counts duplicate batch ids once and emits one cancellation per pending entry", () => {
    const q = new CommandQueue(100), cancel = vi.fn(() => step("a", "command_cancelled_by_user"));
    q.enqueue(() => step("a"), cancel, "brain_a");
    expect(q.cancelBatches(["brain_a", "brain_a"])).toBe(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("retains cancelled-local uncertainty when its receipt callback throws", () => {
    const q = new CommandQueue(100), run = vi.fn(() => step("a")), rows: QueueStep[] = [];
    q.on(row => rows.push(row));
    q.enqueue(run, () => { throw new Error("receipt failure"); }, "brain_a");
    expect(q.cancelBatches(["brain_a"])).toBe(1);
    vi.runAllTimers();
    expect(run).not.toHaveBeenCalled();
    expect(rows[0].error).toBe("command_cancel_receipt_failed");
  });

  it("allows reentrant cancellation from a completed step without running removed work", () => {
    const q = new CommandQueue(100), ran: string[] = [], rows: QueueStep[] = [];
    q.on(row => { rows.push(row); if (row.id === "first" && row.ok) q.cancelBatches(["brain_a"]); });
    for (const id of ["first", "second"]) q.enqueue(
      () => { ran.push(id); return step(id); },
      () => step(id, "command_cancelled_by_user"), "brain_a");
    vi.runAllTimers();
    expect(ran).toEqual(["first"]);
    expect(rows.map(row => row.id)).toEqual(["first", "second"]);
    expect(q.size).toBe(0);
  });

  it("does not consume a later command enqueued by a cancellation listener", () => {
    const q = new CommandQueue(100), ran: string[] = [];
    q.on(row => {
      if (row.error === "command_cancelled_by_user")
        q.enqueue(() => { ran.push("later"); return step("later"); }, undefined, "brain_b");
    });
    q.enqueue(() => step("old"), () => step("old", "command_cancelled_by_user"), "brain_a");
    expect(q.cancelBatches(["brain_a"])).toBe(1);
    vi.runAllTimers();
    expect(ran).toEqual(["later"]);
  });

  it("keeps the existing explicit cancel-all-pending control", () => {
    const q = new CommandQueue(100), run = vi.fn(() => step("a"));
    q.enqueue(run, undefined, "brain_a"); q.enqueue(run, undefined, "brain_b"); q.enqueue(run);
    expect(q.cancelPending()).toBe(3);
    vi.runAllTimers(); expect(run).not.toHaveBeenCalled();
  });
});
