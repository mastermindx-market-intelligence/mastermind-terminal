"use client";
import { useLayoutEffect } from "react";
import { identityOwnerKey, type AccountIdentity } from "@/lib/accountIdentity";
import { useAccountPrefs } from "@/lib/useMarketPrefs";

/** The existing account preference owner remains the only reader/writer of appearance.
 * The Lab temporarily applies that preference to the real root (including WebGL and
 * shared chrome); leaving the Lab restores the host route's original appearance. */
export function useResearchAppearance(identity: AccountIdentity) {
  const { owner, metaPrefs } = useAccountPrefs(identity);
  const current = owner === identityOwnerKey(identity);
  const automatic = current && metaPrefs.themeAuto === "1";
  const explicit = current && metaPrefs.theme === "light" ? "light" : "dark";

  useLayoutEffect(() => {
    const root = document.documentElement;
    const previousTheme = root.getAttribute("data-theme");
    const previousScope = root.getAttribute("data-research-appearance");
    let applied: "light" | "dark";
    const apply = () => {
      // Match the Macro Dashboard's shared Auto preference: 07:00–19:00 local.
      const hour = new Date().getHours();
      applied = automatic ? (hour >= 7 && hour < 19 ? "light" : "dark") : explicit;
      root.setAttribute("data-research-appearance", "lab");
      root.setAttribute("data-theme", applied);
    };
    apply();
    const timer = automatic ? window.setInterval(apply, 60_000) : undefined;
    if (automatic) {
      document.addEventListener("visibilitychange", apply);
      window.addEventListener("focus", apply);
    }
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", apply);
      window.removeEventListener("focus", apply);
      if (root.getAttribute("data-research-appearance") !== "lab") return;
      // Do not overwrite a theme another mounted host has since applied.
      if (root.getAttribute("data-theme") === applied) {
        if (previousTheme === null) root.removeAttribute("data-theme");
        else root.setAttribute("data-theme", previousTheme);
      }
      if (previousScope === null) root.removeAttribute("data-research-appearance");
      else root.setAttribute("data-research-appearance", previousScope);
    };
  }, [automatic, explicit]);
}
