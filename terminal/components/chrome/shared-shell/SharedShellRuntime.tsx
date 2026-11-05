"use client";
import { useEffect } from "react";
import { useShellIdentity } from "@/components/chrome/AppShell";
import { identityOwnerKey } from "@/lib/accountIdentity";
import LegacyPageHost from "./LegacyPageHost";
import ShellDirectory from "./ShellDirectory";
import { useSharedShellPresentation } from "./SharedShellPresentation";

export default function SharedShellRuntime({
  legacyOrigin, directoryOpen, onCloseDirectory, onOpenDirectory, onSearchCompanies, onTitle,
}: {
  legacyOrigin: string; directoryOpen: boolean; onCloseDirectory: () => void;
  onOpenDirectory: () => void; onSearchCompanies: () => void; onTitle: (title: string) => void;
}) {
  const identity = useShellIdentity();
  const identityKey = identityOwnerKey(identity);
  const { context, requestContext } = useSharedShellPresentation();

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey) return;
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
      <LegacyPageHost legacyOrigin={legacyOrigin} identityKey={identityKey} context={context}
        onContextRequest={requestContext} onTitle={onTitle} />
      <ShellDirectory open={directoryOpen} onClose={onCloseDirectory} onSearchCompanies={onSearchCompanies} />
    </>
  );
}
