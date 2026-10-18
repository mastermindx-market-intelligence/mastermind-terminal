"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useActiveSymbol } from "@/lib/activeSymbol";
import { useT } from "@/lib/i18n";
import ShellSearch from "./ShellSearch";

export default function SharedShellToolbar({ symbolOpen, onSymbolOpenChange, onOpenDirectory }: {
  symbolOpen: boolean; onSymbolOpenChange: (open: boolean) => void; onOpenDirectory: () => void;
}) {
  const t = useT();
  const path = usePathname();
  const params = useSearchParams();
  const symbol = useActiveSymbol();
  const [returnHref, setReturnHref] = useState(() => window.location.href);
  useEffect(() => {
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
  }, [path, params]);
  const terminalHref = "/terminal?from=macro&ret=" + encodeURIComponent(returnHref)
    + (symbol ? "&symbol=" + encodeURIComponent(symbol) : "");
  return <div className="shared-shell-toolbar">
    <ShellSearch open={symbolOpen} onOpenChange={onSymbolOpenChange} />
    <button type="button" className="shared-shell-directory-trigger" onClick={onOpenDirectory}
      aria-haspopup="dialog" aria-label={t("shellAllTools")}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
      <span>{t("shellAllTools")}</span><kbd>⌘ K</kbd>
    </button>
    <Link className="shared-shell-terminal-link" href={terminalHref} prefetch={false}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 17 5-6 4 3 6-9M14 5h5v5" /></svg>
      <span>{t("shellOpenTerminal")}</span><span aria-hidden="true">↗</span>
    </Link>
  </div>;
}
