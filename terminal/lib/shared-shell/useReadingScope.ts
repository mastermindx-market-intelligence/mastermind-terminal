"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isUuid } from "./readingContracts";

/** Used inside the owner-keyed Research/Today session components: the key destroys
 * the complete scope and state on every subject departure, including A→B→A.
 * A verified server prop is also fenced against browser identity changes. */
export function useReadingScope(ownerKey: string) {
  const scope = useRef<AbortController | null>(null);
  const [identity, setIdentity] = useState<{owner:string;attempt:number;phase:"checking"|"ready"|"ended"|"unavailable"}>({owner:ownerKey,attempt:0,phase:"checking"});
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); scope.current = controller;
    let unsubscribe = () => {};
    const end = () => {
      if (scope.current !== controller || controller.signal.aborted) return;
      controller.abort(); setIdentity({owner:ownerKey,attempt,phase:"ended"});
    };
    const fail = () => {
      if (scope.current !== controller || controller.signal.aborted) return;
      controller.abort(); setIdentity({owner:ownerKey,attempt,phase:"unavailable"});
    };
    const timeout = setTimeout(fail, 12000);
    queueMicrotask(() => {
     if (controller.signal.aborted) return;
     if (!isUuid(ownerKey)) end();
     else try {
      const auth = createClient().auth;
      const { data: { subscription } } = auth.onAuthStateChange((_event, session) => {
        if (session?.user.id !== ownerKey) end();
      });
      unsubscribe = () => subscription.unsubscribe();
      void auth.getUser().then(({ data, error }) => {
        if (controller.signal.aborted) return;
        clearTimeout(timeout);
        if (error) fail(); else if (data.user?.id !== ownerKey) end(); else setIdentity({owner:ownerKey,attempt,phase:"ready"});
      }).catch(fail);
     } catch { fail(); }
    });
    return () => { clearTimeout(timeout); controller.abort(); unsubscribe(); };
  }, [ownerKey, attempt]);
  const current = identity.owner === ownerKey && identity.attempt === attempt;
  const retryIdentity = useCallback(() => setAttempt(value => value + 1), []);
  const invalidateIdentity = useCallback(() => {
    scope.current?.abort();
    setIdentity({owner:ownerKey,attempt,phase:"ended"});
  }, [ownerKey, attempt]);
  return { scope, ready: current && identity.phase === "ready", ended: current && identity.phase === "ended", unavailable: current && identity.phase === "unavailable", retryIdentity, invalidateIdentity };
}
export async function readingJson(scope: { current: AbortController | null }, url: string) {
  const controller = scope.current;
  if (!controller || controller.signal.aborted) throw Error("inactive");
  const request = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort = () => {};
  const boundary = new Promise<never>((_resolve, reject) => {
    onAbort = () => { request.abort(); reject(Error("inactive")); };
    controller.signal.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => { request.abort(); reject(Error("read deadline")); }, 18000);
  });
  try {
    return await Promise.race([boundary, (async () => {
      const response = await fetch(url, { cache: "no-store", signal: request.signal });
      const value: unknown = await response.json();
      if (scope.current !== controller || controller.signal.aborted) throw Error("inactive");
      return { response, value };
    })()]);
  } finally { clearTimeout(timer); controller.signal.removeEventListener("abort", onAbort); }
}
