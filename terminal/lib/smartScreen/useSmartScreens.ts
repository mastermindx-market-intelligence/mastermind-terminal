"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { GUEST_OWNER, identityOwnerKey, type AccountIdentity } from "@/lib/accountIdentity";
import { browserStorage } from "@/lib/ownerStorage";
import { SmartScreenStore, type SmartScreensSnapshot } from "./client";

/**
 * One store per OWNER key for the life of the tab, so a remounted panel shows the same pending
 * work instead of starting from nothing. A different signed-in account is a different key and
 * therefore a different store: nothing one account holds is ever visible under another.
 */
const stores = new Map<string, SmartScreenStore>();
/** A re-mount re-reads the account when the last read is older than this. */
const REREAD_AFTER_MS = 30_000;

export function smartScreenStoreFor(owner: string): SmartScreenStore {
  // Never cache on the server: a module-level map there is shared across requests.
  if (typeof window === "undefined") return new SmartScreenStore(owner, { fetch: (...args) => fetch(...args), storage: null });
  let store = stores.get(owner);
  if (!store) {
    store = new SmartScreenStore(owner, { fetch: (...args) => window.fetch(...args), storage: browserStorage() });
    stores.set(owner, store);
  }
  return store;
}

// The server (and hydration) never knows the device copy or the account list: it renders the
// neutral first state, and the device copy appears right after hydration.
const SERVER_GUEST: SmartScreensSnapshot = Object.freeze({
  owner: GUEST_OWNER, status: "guest", readFailure: null, ack: null, pending: [], busy: false, device: "ok",
}) as SmartScreensSnapshot;
const SERVER_ACCOUNT: SmartScreensSnapshot = Object.freeze({
  owner: "", status: "loading", readFailure: null, ack: null, pending: [], busy: false, device: "ok",
}) as SmartScreensSnapshot;

export function useSmartScreens(identity: AccountIdentity): { snap: SmartScreensSnapshot; store: SmartScreenStore } {
  const owner = identityOwnerKey(identity);
  const store = useMemo(() => smartScreenStoreFor(owner), [owner]);
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot, () => (owner === GUEST_OWNER ? SERVER_GUEST : SERVER_ACCOUNT));
  useEffect(() => { void store.load(REREAD_AFTER_MS); }, [store]);
  return { snap, store };
}
