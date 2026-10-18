import assert from "node:assert/strict";
import { test } from "vitest";
import {
  adoptLegacySlotIntoGuest,
  readOwnerSlot,
  type StoragePort,
} from "../ownerStorage";

const keys = {
  legacyKey: "mm.marketPrefs",
  scopedKey: "mm.marketPrefs.v2",
  receiptKey: "mm.marketPrefs.legacy.v1",
};
const payload = { enabled: ["us"], followed: ["us"], home: "us" };
const legacy = JSON.stringify(payload);
const otherOwner = { enabled: ["cn"], followed: ["cn"], home: "cn" };
type FailureRule = (operation: "set" | "remove", key: string) => boolean;
type FaultStorage = StoragePort & {
  map: Map<string, string>;
  fail: FailureRule;
  calls: Array<["set" | "remove", string]>;
};

function fakeStorage(
  seed: Record<string, string> = { [keys.legacyKey]: legacy },
  fail: FailureRule = () => false,
): FaultStorage {
  const map = new Map(Object.entries(seed));
  return {
    map,
    fail,
    calls: [],
    getItem(key) { return map.get(key) ?? null; },
    setItem(key, value) {
      this.calls.push(["set", key]);
      if (this.fail("set", key)) throw new DOMException("quota", "QuotaExceededError");
      map.set(key, value);
    },
    removeItem(key) {
      this.calls.push(["remove", key]);
      if (this.fail("remove", key)) throw new DOMException("blocked", "SecurityError");
      map.delete(key);
    },
  };
}

function adopt(storage: StoragePort): boolean {
  return adoptLegacySlotIntoGuest(storage, keys);
}

function assertCopied(storage: StoragePort) {
  assert.deepEqual(readOwnerSlot(storage, keys.scopedKey, "guest"), payload);
  assert.equal(storage.getItem(keys.legacyKey), null);
  assert.equal(storage.getItem(keys.receiptKey), "1");
}

test("selective destination quota failure preserves legacy and withholds receipt until recovery", () => {
  const storage = fakeStorage(undefined, (op, key) => op === "set" && key === keys.scopedKey);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    assert.equal(adopt(storage), false);
    assert.equal(storage.getItem(keys.legacyKey), legacy);
    assert.equal(storage.getItem(keys.scopedKey), null);
    assert.equal(storage.getItem(keys.receiptKey), null);
  }
  assert.deepEqual(storage.calls, [["set", keys.scopedKey], ["set", keys.scopedKey]]);
  storage.fail = () => false;
  assert.equal(adopt(storage), true);
  assertCopied(storage);
});

test("all writes failing preserves the only durable copy and permits recovery", () => {
  const storage = fakeStorage(undefined, (op) => op === "set");
  assert.equal(adopt(storage), false);
  assert.equal(storage.getItem(keys.legacyKey), legacy);
  assert.equal(storage.getItem(keys.receiptKey), null);
  assert.deepEqual(storage.calls, [["set", keys.scopedKey]]);
  storage.fail = () => false;
  assert.equal(adopt(storage), true);
  assertCopied(storage);
});

test("destination failure and recovery preserve another owner's slot", () => {
  const envelope = JSON.stringify({ "account:alice": otherOwner });
  const storage = fakeStorage({
    [keys.legacyKey]: legacy,
    [keys.scopedKey]: envelope,
  }, (op, key) => op === "set" && key === keys.scopedKey);
  assert.equal(adopt(storage), false);
  assert.equal(storage.getItem(keys.scopedKey), envelope);
  assert.equal(storage.getItem(keys.legacyKey), legacy);
  assert.equal(storage.getItem(keys.receiptKey), null);
  storage.fail = () => false;
  assert.equal(adopt(storage), true);
  assertCopied(storage);
  assert.deepEqual(readOwnerSlot(storage, keys.scopedKey, "account:alice"), otherOwner);
  assert.equal(readOwnerSlot(storage, keys.scopedKey, "account:bob"), undefined);
});

test("successful migration is guest-only and completion receipt makes later calls no-ops", () => {
  const storage = fakeStorage({
    [keys.legacyKey]: legacy,
    [keys.scopedKey]: JSON.stringify({ "account:alice": otherOwner }),
  });
  assert.equal(adopt(storage), true);
  assertCopied(storage);
  assert.deepEqual(readOwnerSlot(storage, keys.scopedKey, "account:alice"), otherOwner);
  assert.equal(readOwnerSlot(storage, keys.scopedKey, "account:bob"), undefined);
  const calls = storage.calls.length;
  storage.map.set(keys.legacyKey, "{\"home\":\"new legacy\"}");
  assert.equal(adopt(storage), false);
  assert.equal(storage.calls.length, calls);
  assert.equal(storage.getItem(keys.legacyKey), "{\"home\":\"new legacy\"}");
});

test("existing guest wins without destination writes and leaves all owner slots unchanged", () => {
  const envelope = JSON.stringify({ guest: { home: "newer" }, "account:alice": otherOwner });
  const storage = fakeStorage({
    [keys.legacyKey]: legacy,
    [keys.scopedKey]: envelope,
  }, (op, key) => op === "set" && key === keys.scopedKey);
  assert.equal(adopt(storage), false);
  assert.equal(storage.getItem(keys.scopedKey), envelope);
  assert.equal(storage.getItem(keys.legacyKey), null);
  assert.equal(storage.getItem(keys.receiptKey), "1");
  assert.deepEqual(storage.calls, [["remove", keys.legacyKey], ["set", keys.receiptKey]]);
});

test("receipt failure after a successful copy remains retry-safe and preserves a newer guest edit", () => {
  const storage = fakeStorage(undefined, (op, key) => op === "set" && key === keys.receiptKey);
  // Existing API returns false on cleanup/receipt exceptions, even after storing the copy.
  assert.equal(adopt(storage), false);
  assert.deepEqual(readOwnerSlot(storage, keys.scopedKey, "guest"), payload);
  assert.equal(storage.getItem(keys.legacyKey), null);
  assert.equal(storage.getItem(keys.receiptKey), null);
  const newer = JSON.stringify({ guest: { home: "newer" }, "account:alice": otherOwner });
  storage.map.set(keys.scopedKey, newer);
  storage.fail = () => false;
  assert.equal(adopt(storage), false);
  assert.equal(storage.getItem(keys.receiptKey), "1");
  assert.equal(storage.getItem(keys.scopedKey), newer);
});

test("legacy removal failure retains both copies and retry preserves newer guest content", () => {
  const storage = fakeStorage(undefined, (op, key) => op === "remove" && key === keys.legacyKey);
  assert.equal(adopt(storage), false);
  assert.deepEqual(readOwnerSlot(storage, keys.scopedKey, "guest"), payload);
  assert.equal(storage.getItem(keys.legacyKey), legacy);
  assert.equal(storage.getItem(keys.receiptKey), null);
  const newer = JSON.stringify({ guest: { home: "newer" } });
  storage.map.set(keys.scopedKey, newer);
  storage.fail = () => false;
  assert.equal(adopt(storage), false);
  assert.equal(storage.getItem(keys.legacyKey), null);
  assert.equal(storage.getItem(keys.receiptKey), "1");
  assert.equal(storage.getItem(keys.scopedKey), newer);
});

test("absent, malformed and null legacy values keep existing cleanup behavior", () => {
  for (const raw of [undefined, "{malformed", "null"]) {
    const storage = fakeStorage(raw === undefined ? {} : { [keys.legacyKey]: raw });
    assert.equal(adopt(storage), false);
    assert.equal(storage.getItem(keys.legacyKey), null);
    assert.equal(storage.getItem(keys.scopedKey), null);
    assert.equal(storage.getItem(keys.receiptKey), "1");
  }
});
