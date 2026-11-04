import { describe, expect, it } from 'vitest';

import { createAnalysisBrainOpener } from '../analysisBrainEntry';

interface FakeTimer {
  id: number;
  ms: number;
  fn: () => void;
  cancelled: boolean;
}

/**
 * Deterministic fake scheduler: nothing runs on its own, each test decides
 * exactly which timer fires. deliverAfterCancel models a callback that was
 * already dequeued when cancel() ran, so the opener cannot stop its delivery.
 */
function createFakeScheduler() {
  const scheduled: FakeTimer[] = [];
  const live = new Set<FakeTimer>();
  let nextId = 1;
  let cancelCount = 0;

  const schedule = (fn: () => void, ms: number): unknown => {
    const timer: FakeTimer = { id: nextId, ms, fn, cancelled: false };
    nextId += 1;
    scheduled.push(timer);
    live.add(timer);
    return timer;
  };

  const cancel = (handle: unknown): void => {
    cancelCount += 1;
    const timer = handle as FakeTimer;
    if (live.delete(timer)) {
      timer.cancelled = true;
    }
  };

  const at = (index: number): FakeTimer => {
    const timer = scheduled[index];
    if (!timer) {
      throw new Error('no timer scheduled at index ' + index);
    }
    return timer;
  };

  const fire = (timer: FakeTimer): void => {
    if (!live.delete(timer)) {
      throw new Error('timer is not live (already fired or cancelled)');
    }
    timer.fn();
  };

  const fireNext = (): FakeTimer => {
    let next: FakeTimer | undefined;
    for (const timer of scheduled) {
      if (live.has(timer)) {
        next = timer;
        break;
      }
    }
    if (!next) {
      throw new Error('no live timer to fire');
    }
    fire(next);
    return next;
  };

  const deliverAfterCancel = (timer: FakeTimer): void => {
    live.delete(timer);
    timer.fn();
  };

  return {
    schedule,
    cancel,
    at,
    fire,
    fireNext,
    deliverAfterCancel,
    scheduled,
    liveCount: () => live.size,
    cancelCount: () => cancelCount,
  };
}

function createOpenSpy() {
  let count = 0;
  return {
    open(): void {
      count += 1;
    },
    count: () => count,
  };
}

describe('createAnalysisBrainOpener', () => {
  it('opens immediately when the singleton is ready and schedules nothing', () => {
    const clock = createFakeScheduler();
    const brain = createOpenSpy();
    const opener = createAnalysisBrainOpener(() => brain.open, clock.schedule, clock.cancel);

    opener.open();
    opener.open();

    expect(brain.count()).toBe(2);
    expect(clock.scheduled).toHaveLength(0);
  });

  it('schedules exactly one 800ms retry and opens when the singleton becomes ready', () => {
    const clock = createFakeScheduler();
    const brain = createOpenSpy();
    let ready = false;
    const opener = createAnalysisBrainOpener(
      () => (ready ? brain.open : undefined),
      clock.schedule,
      clock.cancel,
    );

    opener.open();

    expect(brain.count()).toBe(0);
    expect(clock.scheduled).toHaveLength(1);
    expect(clock.at(0).ms).toBe(800);

    ready = true;
    clock.fireNext();

    expect(brain.count()).toBe(1);
    expect(clock.liveCount()).toBe(0);
    expect(clock.scheduled).toHaveLength(1);
  });

  it('re-reads the accessor at the retry but never schedules another retry', () => {
    const clock = createFakeScheduler();
    const brain = createOpenSpy();
    let reads = 0;
    const opener = createAnalysisBrainOpener(() => {
      reads += 1;
      return undefined;
    }, clock.schedule, clock.cancel);

    opener.open();
    expect(reads).toBe(1);

    clock.fireNext();

    expect(brain.count()).toBe(0);
    expect(reads).toBe(2);
    expect(clock.scheduled).toHaveLength(1);
    expect(clock.liveCount()).toBe(0);
  });

  it('replaces the pending retry when open runs again while still missing', () => {
    const clock = createFakeScheduler();
    const brain = createOpenSpy();
    let ready = false;
    const opener = createAnalysisBrainOpener(
      () => (ready ? brain.open : undefined),
      clock.schedule,
      clock.cancel,
    );

    opener.open();
    const first = clock.at(0);

    opener.open();

    expect(first.cancelled).toBe(true);
    expect(clock.cancelCount()).toBe(1);
    expect(clock.scheduled).toHaveLength(2);
    expect(clock.liveCount()).toBe(1);

    ready = true;
    clock.fireNext();

    expect(brain.count()).toBe(1);
    expect(clock.liveCount()).toBe(0);
  });

  it('cancels the pending retry and opens immediately on a later ready click', () => {
    const clock = createFakeScheduler();
    const brain = createOpenSpy();
    let ready = false;
    const opener = createAnalysisBrainOpener(
      () => (ready ? brain.open : undefined),
      clock.schedule,
      clock.cancel,
    );

    opener.open();
    ready = true;
    opener.open();

    expect(brain.count()).toBe(1);
    expect(clock.at(0).cancelled).toBe(true);
    expect(clock.liveCount()).toBe(0);
  });

  it('ignores a stale already-delivered callback superseded by a newer request', () => {
    const clock = createFakeScheduler();
    const brain = createOpenSpy();
    let ready = false;
    const opener = createAnalysisBrainOpener(
      () => (ready ? brain.open : undefined),
      clock.schedule,
      clock.cancel,
    );

    opener.open();
    const superseded = clock.at(0);
    opener.open();
    const replacement = clock.at(1);

    clock.deliverAfterCancel(superseded);

    expect(brain.count()).toBe(0);

    ready = true;
    clock.fire(replacement);

    expect(brain.count()).toBe(1);
    expect(clock.liveCount()).toBe(0);
  });

  it('dispose cancels the retry, neutralises a late delivery and all future opens', () => {
    const clock = createFakeScheduler();
    const brain = createOpenSpy();
    let ready = false;
    const opener = createAnalysisBrainOpener(
      () => (ready ? brain.open : undefined),
      clock.schedule,
      clock.cancel,
    );

    opener.open();
    const pending = clock.at(0);

    opener.dispose();

    expect(pending.cancelled).toBe(true);
    expect(clock.liveCount()).toBe(0);

    clock.deliverAfterCancel(pending);
    expect(brain.count()).toBe(0);

    ready = true;
    opener.open();

    expect(brain.count()).toBe(0);
    expect(clock.scheduled).toHaveLength(1);
  });

  it('keeps two independent instances isolated', () => {
    const clock = createFakeScheduler();
    const brainA = createOpenSpy();
    const brainB = createOpenSpy();
    let readyA = false;
    let readyB = false;
    const openerA = createAnalysisBrainOpener(
      () => (readyA ? brainA.open : undefined),
      clock.schedule,
      clock.cancel,
    );
    const openerB = createAnalysisBrainOpener(
      () => (readyB ? brainB.open : undefined),
      clock.schedule,
      clock.cancel,
    );

    openerA.open();
    openerB.open();
    expect(clock.scheduled).toHaveLength(2);

    openerB.dispose();
    expect(clock.at(0).cancelled).toBe(false);
    expect(clock.at(1).cancelled).toBe(true);

    readyA = true;
    clock.fireNext();

    expect(brainA.count()).toBe(1);
    expect(brainB.count()).toBe(0);

    readyB = true;
    openerB.open();

    expect(brainB.count()).toBe(0);
    expect(clock.scheduled).toHaveLength(2);
  });
});
