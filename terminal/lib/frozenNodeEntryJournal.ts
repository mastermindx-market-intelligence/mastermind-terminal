import type { FrozenEntryDescriptor } from './frozenNodeEntryProtocol';
import { snapshotFrozenEntryDescriptor } from './frozenNodeEntryProtocol';
import type { StoragePort } from './ownerStorage';
export type FrozenEntryJournalPorts = { storage: StoragePort; locks: Pick<LockManager, 'request'> };

const SCHEMA = 'options.frozen_reference/v1';
const KEY_PREFIX = 'mm.options.frozen-reference.v1:';
const MAX_RECORD_BYTES = 128 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type FrozenEntrySlotRead =
  | { state: 'empty' }
  | { state: 'blocked' }
  | { state: 'held'; descriptor: FrozenEntryDescriptor; phase: 'retained' | 'dispatched' };

export interface FrozenEntrySlot {
  read(): FrozenEntrySlotRead;
  retain(descriptor: FrozenEntryDescriptor): boolean;
  dispatch(descriptor: FrozenEntryDescriptor): boolean;
  holdMissingReference(): boolean;
}

interface StoredRecord {
  schema: string;
  owner: string;
  descriptor: FrozenEntryDescriptor;
  phase: 'retained' | 'dispatched';
}

type ReadResult = { kind: 'empty' } | { kind: 'blocked' } | { kind: 'held'; record: StoredRecord };

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return `{${Object.keys(source)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(source[key])}`)
      .join(',')}}`;
  }
  throw new Error('non-json');
}

function equalJson(left: unknown, right: unknown): boolean {
  try { return canonicalJson(left) === canonicalJson(right); } catch { return false; }
}

function readRecord(storage: StoragePort, key: string, owner: string): ReadResult {
  let raw: string | null;
  try { raw = storage.getItem(key); } catch { return { kind: 'blocked' }; }
  if (raw === null) return { kind: 'empty' };
  if (raw.length > MAX_RECORD_BYTES || new TextEncoder().encode(raw).length > MAX_RECORD_BYTES) return { kind: 'blocked' };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { kind: 'blocked' }; }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { kind: 'blocked' };
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).length !== 4) return { kind: 'blocked' };
  if (record.schema !== SCHEMA || record.owner !== owner) return { kind: 'blocked' };
  const phase = record.phase === 'retained' ? 'retained' : record.phase === 'dispatched' ? 'dispatched' : null;
  if (phase === null) return { kind: 'blocked' };
  const descriptor = snapshotFrozenEntryDescriptor(record.descriptor);
  if (descriptor === null || descriptor.principal !== owner) return { kind: 'blocked' };
  return { kind: 'held', record: { schema: SCHEMA, owner, descriptor, phase } };
}

function writeRecord(storage: StoragePort, key: string, record: StoredRecord | { schema: string; owner: string; descriptor: null; phase: 'reference_unknown' }): boolean {
  let serialized: string;
  try { serialized = JSON.stringify(record); } catch { return false; }
  const bytes = typeof TextEncoder === 'function' ? new TextEncoder().encode(serialized).length : serialized.length;
  if (bytes > MAX_RECORD_BYTES) return false;
  try { storage.setItem(key, serialized); } catch { return false; }
  try { return storage.getItem(key) === serialized; } catch { return false; }
}

function createSlot(storage: StoragePort, key: string, owner: string, active: () => boolean): FrozenEntrySlot {
  const current = (): ReadResult => readRecord(storage, key, owner);
  return {
    holdMissingReference(): boolean {
      if (!active()) return false;
      const found = current();
      if (found.kind !== 'empty') return false;
      // Same owner slot, no fabricated descriptor/UUID; intentionally blocked
      // to all retain/dispatch operations after a known missing-reference read.
      return writeRecord(storage, key, { schema: SCHEMA, owner, descriptor: null, phase: 'reference_unknown' });
    },
    read(): FrozenEntrySlotRead {
      if (!active()) return { state: 'blocked' };
      let found: ReadResult;
      try { found = current(); } catch { return { state: 'blocked' }; }
      if (found.kind === 'empty') return { state: 'empty' };
      if (found.kind === 'blocked') return { state: 'blocked' };
      return { state: 'held', descriptor: found.record.descriptor, phase: found.record.phase };
    },
    retain(descriptor: FrozenEntryDescriptor): boolean {
      const next = snapshotFrozenEntryDescriptor(descriptor);
      if (!active() || next === null || next.principal !== owner) return false;
      let present: ReadResult;
      try { present = current(); } catch { return false; }
      if (present.kind === 'blocked') return false;
      if (present.kind === 'held') {
        if (present.record.phase !== 'retained') return false;
        if (!equalJson(present.record.descriptor, next)) return false;
      }
      return writeRecord(storage, key, { schema: SCHEMA, owner, descriptor: next, phase: 'retained' });
    },
    dispatch(descriptor: FrozenEntryDescriptor): boolean {
      const claimed = snapshotFrozenEntryDescriptor(descriptor);
      if (!active() || claimed === null || claimed.principal !== owner) return false;
      let present: ReadResult;
      try { present = current(); } catch { return false; }
      if (present.kind !== 'held' || present.record.phase !== 'retained') return false;
      if (!equalJson(present.record.descriptor, claimed)) return false;
      return writeRecord(storage, key, { schema: SCHEMA, owner, descriptor: claimed, phase: 'dispatched' });
    },
  };
}

export async function withFrozenEntryJournal<T>(
  ports: FrozenEntryJournalPorts,
  owner: string,
  work: (slot: FrozenEntrySlot) => Promise<T>
): Promise<T | null> {
  const storage = ports && typeof ports === 'object' ? ports.storage : null;
  const locks = ports && typeof ports === 'object' ? ports.locks : null;
  if (storage == null || typeof storage !== 'object') return null;
  if (typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') return null;
  if (locks == null || typeof locks !== 'object' || typeof locks.request !== 'function') return null;
  if (typeof owner !== 'string' || !UUID_PATTERN.test(owner)) return null;
  const scopedOwner = owner.toLowerCase();
  const key = `${KEY_PREFIX}${scopedOwner}`;
  const outcome: { done: boolean; value: T | null } = { done: false, value: null };
  try {
    await locks.request(
      key,
      { mode: 'exclusive', ifAvailable: true },
      (lock) => {
        if (lock === null) return;
        let active = true;
        const slot = createSlot(storage, key, scopedOwner, () => active);
        return Promise.resolve()
          .then(() => work(slot))
          .then(
            (value: T) => { outcome.done = true; outcome.value = value; },
            () => { outcome.done = false; }
          ).finally(() => { active = false; });
      }
    );
  } catch {
    return null;
  }
  return outcome.done ? outcome.value : null;
}
