import type { MastermindBrainHost } from "./mastermindBrain";
import { createClient } from "./supabase/client";

type Session = { user: { id: string } } | null;
type Auth = {
  getSession(): Promise<{ data: { session: Session }; error?: unknown }>;
  onAuthStateChange(callback: (event: string, session: Session) => void): unknown;
};
const bound = new WeakSet<object>();

/** Display/cache partition only. The existing BFF remains the auth authority.
 * The widget survives route unmounts, so its single auth subscription must too.
 * No token, email or session object is copied into the widget config.
 */
export function ensureBrainPrincipalBinding(
  host: MastermindBrainHost & EventTarget,
  authFactory: () => Auth = () => createClient().auth,
): void {
  if (!host.MM_BRAIN_CFG || bound.has(host)) return;
  let principal: string | null = null;
  let generation = 0;
  const project = () => {
    if (host.MM_BRAIN_CFG) host.MM_BRAIN_CFG.principal = principal;
    host.MMBrain?.setPrincipal?.(principal);
  };
  const accept = (session: Session) => {
    principal = typeof session?.user?.id === "string" && session.user.id ? session.user.id : null;
    project();
  };
  project(); // unresolved identity cannot inherit an earlier account's private UI
  let auth: Auth;
  try { auth = authFactory(); } catch { return; }
  // Reserve before subscribing: some auth clients synchronously deliver initial state.
  bound.add(host);
  host.addEventListener("mm-brain-ready", project);
  try {
    auth.onAuthStateChange((_event, session) => { generation++; accept(session); });
    const issued = generation;
    void auth.getSession().then(({ data, error }) => {
      if (generation === issued) accept(error ? null : data.session);
    }).catch(() => { if (generation === issued) accept(null); });
  } catch {
    // A missing auth observer cannot safely leave a private identity displayed.
    accept(null);
  }
}
