"use client";
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
  if (path !== "/stock.html" || !href) return null;
  try {
    const url = new URL(href);
    return normalizeActiveSymbol(url.hash ? decodeURIComponent(url.hash.slice(1)) : url.searchParams.get("ticker"));
  } catch {
    return null;
  }
}
