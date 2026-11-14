"use client";
import { useEffect } from "react";
import dynamic from "next/dynamic";
import { useShellIdentity } from "@/components/chrome/AppShell";
import { identityOwnerKey } from "@/lib/accountIdentity";
import LegacyPageHost from "./LegacyPageHost";
import { useSharedShellPresentation } from "./SharedShellPresentation";
import SharedShellMarketBoundary from "./SharedShellMarketBoundary";

const ShellMegaMenu = dynamic(() => import("./ShellDirectory"), { ssr: false });

export default function SharedShellRuntime({
  legacyOrigin, directoryMode, onCloseDirectory, onOpenDirectory, onSearchCompanies, onTitle,
}: {
  legacyOrigin: string; directoryMode: "hover" | "browse" | null; onCloseDirectory: () => void;
  onOpenDirectory: () => void; onSearchCompanies: () => void; onTitle: (title: string) => void;
}) {
  const identity = useShellIdentity();
  const identityKey = identityOwnerKey(identity);
  const { context, requestContext } = useSharedShellPresentation();

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.isComposing || event.repeat) return;
      if (document.querySelector("dialog[open]")) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); onOpenDirectory();
      } else if (!event.metaKey && !event.ctrlKey && event.key === "/") {
        event.preventDefault(); onSearchCompanies();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onOpenDirectory, onSearchCompanies]);

  return (
    <>
      <SharedShellMarketBoundary silent>
        <LegacyPageHost legacyOrigin={legacyOrigin} identityKey={identityKey} context={context}
          onContextRequest={requestContext} onTitle={onTitle} />
      </SharedShellMarketBoundary>
      {directoryMode && <ShellMegaMenu mode={directoryMode} onClose={onCloseDirectory} />}
    </>
  );
}
