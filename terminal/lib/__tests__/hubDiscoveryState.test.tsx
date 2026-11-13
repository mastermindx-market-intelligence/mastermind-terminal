// @vitest-environment jsdom
/**
 * Tests for the real useHubDiscovery hook, mounted through
 * ReactDOM.createRoot + act in jsdom.
 *
 * Scheduling is controlled, not replaced: vi.mock('react') wraps the real
 * useEffect so the hydration read is retained until the test flushes it, and
 * optionally wraps the real useState setter so a completed read can be held
 * before it commits. Storage is the only other stub. No fake timers, no
 * global events, no browser/Next/network, no mirrored hook implementation.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useHubDiscovery, type HubDiscoveryState } from '../useHubDiscovery';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const scheduling = vi.hoisted(() => ({
  retainedEffects: [] as Array<() => void>,
  heldCommits: false,
  heldUpdates: [] as Array<() => void>,
  reset(): void {
    this.retainedEffects.length = 0;
    this.heldCommits = false;
    this.heldUpdates.length = 0;
  },
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    // Retain each rendered effect body for explicit flushing; React still
    // registers a no-op effect so hook order matches production exactly.
    useEffect: (effect: () => void | (() => void), deps: React.DependencyList) => {
      return actual.useEffect(() => {
        let active = true;
        let cleanup: void | (() => void);
        scheduling.retainedEffects.push(() => { if (active) cleanup = effect(); });
        return () => { active = false; if (typeof cleanup === 'function') cleanup(); };
      }, deps);
    },
    // Optionally defer commits: an applied read stays held until released.
    useState: <S,>(initial: S | (() => S)) => {
      const [value, setValue] = actual.useState<S>(initial);
      const setState = (action: S | ((prev: S) => S)): void => {
        if (!scheduling.heldCommits) {
          setValue(action);
          return;
        }
        scheduling.heldUpdates.push(() => {
          setValue(action);
        });
      };
      return [value, setState] as const;
    },
  };
});

let originalStorage: PropertyDescriptor | undefined;
const mounted: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = [];

function stubLocalStorage(impl: unknown): void {
  originalStorage ??= Object.getOwnPropertyDescriptor(window, 'localStorage');
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    writable: true,
    value: impl,
  });
}

function stubLocalStorageAccess(throwing: () => never): void {
  originalStorage ??= Object.getOwnPropertyDescriptor(window, 'localStorage');
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get: throwing,
  });
}

function mountProbe(): {
  state: () => HubDiscoveryState;
  domState: () => string | null;
  container: HTMLDivElement;
  markSeen: () => void;
} {
  const latest = {
    state: 'hydration-pending' as HubDiscoveryState,
    markSeen: (): void => {},
  };

  function Probe(): React.ReactElement {
    const hub = useHubDiscovery();
    latest.state = hub.state;
    latest.markSeen = hub.markSeen;
    return <div data-testid="hub-state">{hub.state}</div>;
  }

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  act(() => {
    root.render(<Probe />);
  });

  return {
    state: () => latest.state,
    domState: () =>
      container.querySelector('[data-testid="hub-state"]')?.textContent ?? null,
    container,
    markSeen: () => {
      act(() => {
        latest.markSeen();
      });
    },
  };
}

function flushRetainedEffects(): void {
  act(() => {
    for (const run of scheduling.retainedEffects.splice(0)) {
      run();
    }
  });
}

function releaseHeldCommits(): void {
  act(() => {
    for (const apply of scheduling.heldUpdates.splice(0)) {
      apply();
    }
  });
}

describe('useHubDiscovery', () => {
  beforeEach(() => {
    scheduling.reset();
  });

  afterEach(() => {
    for (const { root } of mounted.splice(0)) {
      act(() => {
        root.unmount();
      });
    }
    document.body.textContent = '';
    if (originalStorage) {
      Object.defineProperty(window, 'localStorage', originalStorage);
      originalStorage = undefined;
    }
  });

  it('starts hydration-pending and reads storage only when hydration flushes', () => {
    const getItem = vi.fn(() => null);
    stubLocalStorage({ getItem, setItem: vi.fn() });
    const probe = mountProbe();
    expect(probe.state()).toBe('hydration-pending');
    expect(probe.domState()).toBe('hydration-pending');
    expect(getItem).not.toHaveBeenCalled();
    flushRetainedEffects();
    expect(getItem).toHaveBeenCalledTimes(1);
  });

  it('reports unseen for a missing key and for a value that is not the seen marker', () => {
    stubLocalStorage({ getItem: () => null, setItem: vi.fn() });
    const missing = mountProbe();
    flushRetainedEffects();
    expect(missing.state()).toBe('unseen');

    stubLocalStorage({ getItem: () => '0', setItem: vi.fn() });
    const other = mountProbe();
    flushRetainedEffects();
    expect(other.state()).toBe('unseen');
  });

  it('reports seen when storage holds the exact seen marker', () => {
    stubLocalStorage({ getItem: () => '1', setItem: vi.fn() });
    const probe = mountProbe();
    flushRetainedEffects();
    expect(probe.state()).toBe('seen');
    expect(probe.domState()).toBe('seen');
  });

  it('reports storage-error on a failing read and never leaks the failure text', () => {
    const secret = 'mm:session=classified-value';
    stubLocalStorage({
      getItem: () => {
        throw new Error(`SecurityError reading mm.hubSeen: ${secret}`);
      },
      setItem: vi.fn(),
    });
    const probe = mountProbe();
    flushRetainedEffects();
    expect(probe.state()).toBe('storage-error');
    expect(probe.domState()).toBe('storage-error');
    expect(probe.container.innerHTML).not.toContain(secret);
    expect(probe.container.innerHTML).not.toContain('SecurityError');
  });

  it('treats missing storage and an unreadable storage property as storage-error', () => {
    stubLocalStorage(undefined);
    const missingStorage = mountProbe();
    flushRetainedEffects();
    expect(missingStorage.state()).toBe('storage-error');

    stubLocalStorageAccess(() => {
      throw new Error('access denied');
    });
    const blockedStorage = mountProbe();
    flushRetainedEffects();
    expect(blockedStorage.state()).toBe('storage-error');
    expect(blockedStorage.state()).not.toBe('unseen');
    expect(blockedStorage.state()).not.toBe('seen');
  });

  it('keeps hydration-pending when the read finished but the commit is held', () => {
    stubLocalStorage({ getItem: () => '1', setItem: vi.fn() });
    scheduling.heldCommits = true;
    const probe = mountProbe();
    flushRetainedEffects();
    expect(probe.state()).toBe('hydration-pending');
    expect(probe.domState()).toBe('hydration-pending');
    releaseHeldCommits();
    expect(probe.state()).toBe('seen');
    expect(probe.domState()).toBe('seen');
  });

  it('a real opening while hydration is pending survives the delayed read', () => {
    const setItem = vi.fn();
    stubLocalStorage({ getItem: () => null, setItem });
    const probe = mountProbe();
    expect(probe.state()).toBe('hydration-pending');
    probe.markSeen();
    expect(probe.state()).toBe('seen');
    expect(setItem).toHaveBeenCalledWith('mm.hubSeen', '1');
    flushRetainedEffects();
    expect(probe.state()).toBe('seen');
    expect(probe.domState()).toBe('seen');
  });

  it('a real opening after storage-error survives further failing reads and writes', () => {
    stubLocalStorage({
      getItem: () => {
        throw new Error('storage unavailable');
      },
      setItem: () => {
        throw new Error('quota exceeded');
      },
    });
    const probe = mountProbe();
    flushRetainedEffects();
    expect(probe.state()).toBe('storage-error');
    expect(() => probe.markSeen()).not.toThrow();
    expect(probe.state()).toBe('seen');
    flushRetainedEffects();
    expect(probe.state()).toBe('seen');
    expect(probe.domState()).toBe('seen');
  });
});
