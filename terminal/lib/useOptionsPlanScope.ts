"use client";
import { useEffect, useState } from "react";
import { createClient } from "./supabase/client";

/** Display lifetime only. Private API auth/entitlement remains authoritative.
 * A→B→A gets three lifetimes, so an earlier account cannot revive a draft.
 * No token or session object leaves the incumbent Auth client. */
export function useOptionsPlanScope(): string {
  const [scope, setScope] = useState({ subject: null as string | null, generation: 0 });
  useEffect(() => {
    let alive = true, observed = 0;
    let unsubscribe = () => {};
    const accept = (subject: string | null) => {
      if (alive) setScope(value => value.subject === subject ? value : { subject, generation: value.generation + 1 });
    };
    try {
      const auth = createClient().auth;
      const { data: { subscription } } = auth.onAuthStateChange((_event, session) => {
        observed++;
        accept(session?.user.id ?? null);
      });
      unsubscribe = () => subscription.unsubscribe();
      const issued = observed;
      void auth.getUser().then(({ data, error }) => {
        if (observed === issued) accept(error ? null : data.user?.id ?? null);
      }).catch(() => { if (observed === issued) accept(null); });
    } catch { accept(null); }
    return () => { alive = false; unsubscribe(); };
  }, []);
  return JSON.stringify([scope.subject, scope.generation]);
}
