"use client";
import { useEffect, useState } from "react";
import { useShellIdentity } from "@/components/chrome/AppShell";
import { identityOwnerKey } from "@/lib/accountIdentity";
import { useAccountPrefs } from "@/lib/useMarketPrefs";

type Theme = "dark" | "light";
type Sample = {
  owner: string; revision: number; theme: unknown; auto: unknown; resolved: Theme;
};

/** Presentation only. Auto samples the local clock on entry or an appearance selection,
 * never on unrelated language/sync publications and never through a timer or cache write. */
export function useInvestigationTheme(workspaceOwner: string, authEnded: boolean): Theme {
  const identity = useShellIdentity();
  const prefs = useAccountPrefs(identity);
  const owner = identityOwnerKey(identity);
  const { theme, themeAuto: auto } = prefs.metaPrefs;
  const revision = prefs.appearanceRevision;
  const eligible = !authEnded && identity.kind === "account" && identity.userId === workspaceOwner
    && workspaceOwner !== "local-preview" && prefs.ready && prefs.owner === owner;
  const [sample, setSample] = useState<Sample | null>(null);

  // Synchronize a client-only external clock sample after hydration; render-time Date
  // would break SSR parity. This bounded effect has no feedback dependency or timer.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!eligible) { setSample(null); return; }
    const hour = new Date().getHours();
    const resolved: Theme = auto === "1" ? (hour >= 7 && hour < 19 ? "light" : "dark")
      : (auto === undefined || auto === "0") && theme === "light" ? "light" : "dark";
    setSample({ owner, revision, theme, auto, resolved });
  }, [eligible, owner, revision, theme, auto]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // SSR/first paint and every owner or appearance transition fail dark before effects run.
  // In particular an incoming owner cannot borrow an outgoing owner's sampled light.
  return eligible && sample?.owner === owner && sample.revision === revision
    && sample.theme === theme && sample.auto === auto ? sample.resolved : "dark";
}
