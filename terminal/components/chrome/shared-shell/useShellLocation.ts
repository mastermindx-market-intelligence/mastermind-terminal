"use client";
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
