"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useShellIdentity } from "@/components/chrome/AppShell";
import { identityOwnerKey } from "@/lib/accountIdentity";
import { useSharedShellT } from "@/lib/sharedShellCopy";
// The generated 13k-route catalog belongs to these two consumers. Loading them
// during a native workspace's first paint adds a large, unused JS/JSON payload.
function LegacyPageLoading() {
  const t = useSharedShellT();
  return <main className="main2 shared-shell-content" id="shared-shell-content"
    aria-busy="true" role="status">
    <section className="shared-shell-boundary">
      <span className="shared-shell-boundary-mark" aria-hidden="true">M</span>
      <h1>{t("shellOpening")}</h1>
      <span className="shared-shell-progress" aria-hidden="true" />
    </section>
  </main>;
}
const LegacyPageHost = dynamic(() => import("./LegacyPageHost"), { ssr: false, loading: LegacyPageLoading });
const ShellDirectory = dynamic(() => import("./ShellDirectory"), { ssr: false });
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
  const pathname = usePathname();
  // Every current generated legacy route ends in ".html". The source contract
  // test requires that to remain true, so this lightweight hint cannot silently
  // exclude an admitted route in a future registry generation.
  const isLegacyDocument = pathname.endsWith(".html");
  const [legacyVisited, setLegacyVisited] = useState(false);
  const [directoryVisited, setDirectoryVisited] = useState(false);
  useEffect(() => {
    if (isLegacyDocument) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Keep the same frame and view snapshots after switching back to native pages.
      setLegacyVisited(true);
    }
  }, [isLegacyDocument]);
  useEffect(() => {
    if (directoryOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Preserve directory query/filter state after first opening.
      setDirectoryVisited(true);
    }
  }, [directoryOpen]);

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
      {(isLegacyDocument || legacyVisited) && (
        <LegacyPageHost legacyOrigin={legacyOrigin} identityKey={identityKey} context={context}
          onContextRequest={requestContext} onTitle={onTitle} />
      )}
      {(directoryOpen || directoryVisited) && (
        <ShellDirectory open={directoryOpen} onClose={onCloseDirectory} onSearchCompanies={onSearchCompanies} />
      )}
    </>
  );
}
