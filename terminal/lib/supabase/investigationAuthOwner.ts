/** Private one-observer bridge for InvestigationWorkspace's existing auth owner.
 * Lifecycle availability fences previews only. The independent observed SDK
 * user id preserves the Workspace's existing account-ended decision; no token,
 * session object or raw auth event is sent to React. No second client/store. */
import { createClient } from "./client";
import {
  subscribeAuthLifecycle,
  type AuthLifecycleSnapshot,
  type AuthLifecycleSubscription,
  type AuthObserver,
} from "./authLifecycle";

export function subscribeInvestigationAuthOwner(
  onLifecycle: (snapshot: AuthLifecycleSnapshot) => void,
  onObservedPrincipal: (principal: string | null) => void,
  authFactory: () => AuthObserver = () => createClient().auth,
): AuthLifecycleSubscription | null {
  let active = true;
  let observed = false;
  const lifecycle = subscribeAuthLifecycle((snapshot) => {
    if (active) onLifecycle(snapshot);
  }, () => {
    const auth = authFactory();
    return {
      onAuthStateChange(callback) {
        const result = auth.onAuthStateChange((event, session) => {
          if (!active) return;
          // The frozen lifecycle commits its current snapshot synchronously.
          // Verification and consumer notification remain deferred by that owner.
          callback(event, session);
          if (!active) return;
          let principal: string | null;
          try {
            principal = session?.user.id ?? null;
          } catch {
            // The original owner could not complete its comparison when the
            // SDK user accessor threw. Do not invent an account-ended decision.
            return;
          }
          if (active) onObservedPrincipal(principal);
        });
        const candidate = result?.data?.subscription;
        if (!candidate || typeof candidate.unsubscribe !== "function") {
          throw new Error("Auth observer unavailable");
        }
        observed = true;
        return result;
      },
      getClaims: (jwt) => auth.getClaims(jwt),
    };
  });
  if (!observed) {
    active = false;
    lifecycle.unsubscribe();
    return null;
  }
  return {
    getSnapshot: () => lifecycle.getSnapshot(),
    unsubscribe() {
      if (!active) return;
      active = false;
      lifecycle.unsubscribe();
    },
  };
}
