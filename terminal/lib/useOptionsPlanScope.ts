"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeAuthLifecycle, type AuthLifecycleSnapshot, type AuthLifecycleSubscription } from "./supabase/authLifecycle";

/** Existing verified lifecycle, one incumbent SDK subscription. No token,
 * storage, clock-derived epoch or second identity authority leaves that owner. */
export function useOptionsPlanBoundary() {
  const [projected, setProjected] = useState<AuthLifecycleSnapshot | null>(null);
  const owner = useRef<AuthLifecycleSubscription | null>(null);
  useEffect(() => {
    let active = true;
    const subscription = subscribeAuthLifecycle(snapshot => { if (active) setProjected(snapshot); });
    owner.current = subscription;
    return () => { active = false; if (owner.current === subscription) owner.current = null; subscription.unsubscribe(); };
  }, []);
  // Same UUID/new auth_epoch (including account A-B-A) replaces the complete
  // editor/controller. Unverified input cannot retain a ready calculation view.
  const key = JSON.stringify([projected?.principal_partition ?? null, projected?.auth_epoch ?? null, projected?.availability ?? "pending"]);
  const isCurrent = useCallback(() => {
    const actual = owner.current?.getSnapshot();
    return !!projected && projected.availability === "ready" && !!actual && actual.availability === "ready"
      && actual.principal_partition === projected.principal_partition && actual.auth_epoch === projected.auth_epoch;
  }, [projected]);
  return { key, ownerKey: projected?.availability === "ready" ? projected.principal_partition ?? "" : "", isCurrent };
}

/** Compatibility for existing read-only scope consumers. */
export function useOptionsPlanScope(): string { return useOptionsPlanBoundary().key; }
