import assert from "node:assert/strict";
import { test } from "vitest";
import {
  adoptLegacyWatchlistState,
  readOwnerStringMap,
  readOwnerWatchlists,
  WL_NOTES_KEY,
  WLS_KEY,
  type StoragePort,
} from "../watchlistOwner";

const LEGACY_NOTES_KEY = "mm.symbolNotes";
const RECEIPT_KEY = "mm.wls.legacy.v1";
const legacyNote = JSON.stringify({ NVDA: "keep this note" });
type FailureRule = (key: string, value: string) => boolean;
type FaultStorage = StoragePort & {
  map: Map<string, string>;
  fail: FailureRule;
};

function fakeStorage(
  seed: Record<string, string> = { [LEGACY_NOTES_KEY]: legacyNote },
  fail: FailureRule = () => false,
): FaultStorage {
  const map = new Map(Object.entries(seed));
  return {
    map,
    fail,
    getItem(key) { return map.get(key) ?? null; },
    setItem(key, value) {
      if (this.fail(key, value)) throw new DOMException("quota", "QuotaExceededError");
      map.set(key, value);
    },
    removeItem(key) { map.delete(key); },
  };
}

test("selective notes quota failure retains source and no completion receipt, then recovers", () => {
  const storage = fakeStorage(undefined, (key) => key === WL_NOTES_KEY);
  assert.equal(adoptLegacyWatchlistState(storage), false);
  assert.equal(storage.getItem(LEGACY_NOTES_KEY), legacyNote);
  assert.equal(storage.getItem(RECEIPT_KEY), null);
  assert.equal(storage.getItem(WL_NOTES_KEY), null);

  storage.fail = () => false;
  assert.equal(adoptLegacyWatchlistState(storage), true);
  assert.deepEqual(readOwnerStringMap(storage, WL_NOTES_KEY, "guest"), { NVDA: "keep this note" });
  assert.equal(storage.getItem(LEGACY_NOTES_KEY), null);
  assert.equal(storage.getItem(RECEIPT_KEY), "1");
});

test("total setItem failure retains the only durable notes and allows later retry", () => {
  const storage = fakeStorage(undefined, () => true);
  assert.equal(adoptLegacyWatchlistState(storage), false);
  assert.equal(storage.getItem(LEGACY_NOTES_KEY), legacyNote);
  assert.equal(storage.getItem(RECEIPT_KEY), null);

  storage.fail = () => false;
  assert.equal(adoptLegacyWatchlistState(storage), true);
  assert.equal(readOwnerStringMap(storage, WL_NOTES_KEY, "guest").NVDA, "keep this note");
});

test("successful migration stays guest-only, preserves another owner, and is one-shot", () => {
  const storage = fakeStorage({
    [LEGACY_NOTES_KEY]: legacyNote,
    [WL_NOTES_KEY]: JSON.stringify({ "account:alice": { AAPL: "private" } }),
  });
  assert.equal(adoptLegacyWatchlistState(storage), true);
  assert.equal(storage.getItem(LEGACY_NOTES_KEY), null);
  assert.equal(storage.getItem(RECEIPT_KEY), "1");
  assert.deepEqual(readOwnerStringMap(storage, WL_NOTES_KEY, "guest"), { NVDA: "keep this note" });
  assert.deepEqual(readOwnerStringMap(storage, WL_NOTES_KEY, "account:alice"), { AAPL: "private" });
  assert.deepEqual(readOwnerStringMap(storage, WL_NOTES_KEY, "account:bob"), {});
  assert.equal(adoptLegacyWatchlistState(storage), false);
});

test("existing guest wins without writing notes even if a destination write would fail", () => {
  const storage = fakeStorage({
    [LEGACY_NOTES_KEY]: legacyNote,
    [WL_NOTES_KEY]: JSON.stringify({ guest: { TSLA: "new guest note" } }),
  }, (key) => key === WL_NOTES_KEY);

  assert.equal(adoptLegacyWatchlistState(storage), false);
  assert.deepEqual(readOwnerStringMap(storage, WL_NOTES_KEY, "guest"), { TSLA: "new guest note" });
  assert.equal(storage.getItem(RECEIPT_KEY), "1");
});

test("receipt failure after durable copy is retry-safe and preserves a newer guest edit", () => {
  const storage = fakeStorage(undefined, (key) => key === RECEIPT_KEY);
  assert.equal(adoptLegacyWatchlistState(storage), true);
  assert.equal(storage.getItem(LEGACY_NOTES_KEY), null);
  assert.equal(storage.getItem(RECEIPT_KEY), null);
  assert.equal(readOwnerStringMap(storage, WL_NOTES_KEY, "guest").NVDA, "keep this note");

  storage.map.set(WL_NOTES_KEY, JSON.stringify({ guest: { NVDA: "newer" } }));
  storage.fail = () => false;
  assert.equal(adoptLegacyWatchlistState(storage), false);
  assert.equal(storage.getItem(RECEIPT_KEY), "1");
  assert.equal(readOwnerStringMap(storage, WL_NOTES_KEY, "guest").NVDA, "newer");
});

test("partial migration retains legacy payloads and retry preserves an edited adopted list", () => {
  const lists = JSON.stringify({
    lists: { Default: [{ symbol: "NVDA", section: "" }] },
    active: "Default",
    meta: {},
  });
  const storage = fakeStorage({
    [LEGACY_NOTES_KEY]: legacyNote,
    "mm.wls": lists,
  }, (key) => key === WL_NOTES_KEY);

  // The list was adopted, but notes were not: true is not a completion receipt.
  assert.equal(adoptLegacyWatchlistState(storage), true);
  assert.equal(storage.getItem(LEGACY_NOTES_KEY), legacyNote);
  assert.equal(storage.getItem("mm.wls"), lists);
  assert.equal(storage.getItem(RECEIPT_KEY), null);

  const newer = {
    lists: { Default: [{ symbol: "AAPL", section: "" }] },
    active: "Default",
    meta: {},
  };
  storage.map.set(WLS_KEY, JSON.stringify({ guest: newer }));
  storage.fail = () => false;
  assert.equal(adoptLegacyWatchlistState(storage), true);
  assert.deepEqual(readOwnerWatchlists(storage, "guest"), newer);
  assert.equal(readOwnerStringMap(storage, WL_NOTES_KEY, "guest").NVDA, "keep this note");
  assert.equal(storage.getItem(RECEIPT_KEY), "1");
});
