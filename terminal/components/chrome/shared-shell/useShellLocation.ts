"use client";
import { parseProphetState, prophetMountForPathname } from "@/lib/prophetUrlState";
import { normalizeActiveSymbol } from "@/lib/activeSymbol";
import { normalizeAnalysisSymbol } from "@/lib/analysisSymbol";
import { useLayoutEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/** Keep the exact query and hash from the active history entry after hydration. */
export function useShellLocation() {
  const path = usePathname();
  const search = useSearchParams().toString();
  const [returnHref, setReturnHref] = useState("");
  useLayoutEffect(() => {
    const update = () => setReturnHref(window.location.href);
    update();
    window.addEventListener("hashchange", update);
    window.addEventListener("popstate", update);
    window.addEventListener("mmx:shell-location", update);
    return () => {
      window.removeEventListener("hashchange", update);
      window.removeEventListener("popstate", update);
      window.removeEventListener("mmx:shell-location", update);
    };
  }, [path, search]);

  return returnHref;
}

/** The explicit company in a shared route, independent of the last chart cursor. */
export function shellCompanySubject(path: string, symbol: string | null, href: string): string | null {
  if (path === "/analysis") return normalizeAnalysisSymbol(symbol ?? undefined);
  if (!href || !["/stock.html", "/prophet", "/options"].includes(path)) return null;
  try {
    const url = new URL(href);
    if (url.pathname !== path) return null;
    if (path !== "/stock.html") {
      if (path === "/options" && url.searchParams.get("tab") !== "prophet") return null;
      const state = parseProphetState(url.searchParams, prophetMountForPathname(path));
      return (state.lane === "sector" || state.lane === "screener") && state.view === "setup" ? state.symbol : null;
    }
    return normalizeActiveSymbol(url.hash ? decodeURIComponent(url.hash.slice(1)) : url.searchParams.get("ticker"));
  } catch {
    return null;
  }
}
