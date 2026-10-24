"use client";

import { createContext, useContext } from "react";
import type { AuthLifecycleSnapshot } from "@/lib/supabase/authLifecycle";

/** Read-only transport of InvestigationWorkspace's existing owner projection.
 * snapshot is for rendering; getSnapshot must be read at a reply/preview
 * decision boundary because React notifications may trail the owner callback.
 * Null means no active owner subscription, not an invented auth identity. */
export interface InvestigationAuthProjection {
  readonly snapshot: AuthLifecycleSnapshot;
  readonly getSnapshot: () => AuthLifecycleSnapshot | null;
}

export const InvestigationAuthContext = createContext<InvestigationAuthProjection | null>(null);

/** This hook owns no client, subscription, identity, cache or auth decision. */
export function useInvestigationAuthLifecycle(): InvestigationAuthProjection | null {
  return useContext(InvestigationAuthContext);
}
