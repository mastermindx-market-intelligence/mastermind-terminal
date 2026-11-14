"use client";
import Link from "next/link";
import { Fragment, useLayoutEffect, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { hasWorkspaceMarketCoverage, marketOverviewHref, switchWorkspaceMarket, workspaceDocumentHref, workspaceMarket } from "@/lib/sharedShellMarket";
import { SHARED_SHELL_MARKETS } from "@/lib/sharedShellNavigation";
import { useSharedShellT } from "@/lib/sharedShellCopy";

/** Never mount a fixed-US consumer beneath another market's selected context.
 * Existing identity owners remain inside; this fence owns no requests or cache. */
export default function SharedShellMarketBoundary({ children, silent = false }: { children: ReactNode; silent?: boolean }) {
  const path = usePathname(), params = useSearchParams(), t = useSharedShellT();
  const search = params.toString(), market = workspaceMarket(path, search);
  const [rawHref, setRawHref] = useState("");
  useLayoutEffect(() => {
    const update = () => setRawHref(window.location.pathname + window.location.search + window.location.hash);
    update();
    window.addEventListener("hashchange", update);
    window.addEventListener("popstate", update);
    return () => { window.removeEventListener("hashchange", update); window.removeEventListener("popstate", update); };
  }, [path, search]);
  if (hasWorkspaceMarketCoverage(path, search)) return <Fragment>{children}</Fragment>;
  if (silent) return null;
  const label = SHARED_SHELL_MARKETS.find(item => item.id === market);
  const currentHref = rawHref || `${path}?${search}`;
  const usHref = switchWorkspaceMarket(currentHref, "us");
  const usUrl = new URL(usHref, "https://shell.invalid");
  const usSupported = hasWorkspaceMarketCoverage(usUrl.pathname, usUrl.search);
  const original = workspaceDocumentHref(currentHref);
  return <main className="main2 shared-shell-market-coverage" id="shared-shell-content" tabIndex={-1}>
    <section aria-labelledby="market-coverage-title">
      <p className="shared-shell-market-eyebrow">{label ? t(label.k, label.label) : t("shellWorkspaceMarket")}</p>
      <h1 id="market-coverage-title">{t(market ? "shellMarketCoverageTitle" : "shellChooseMarket")}</h1>
      <p>{t(market ? "shellMarketCoverageBody" : "shellInvalidMarketBody")}</p>
      <div className="shared-shell-market-actions">
        {market && <Link className="btn" href={marketOverviewHref(market)} prefetch={false}>{t("shellOpenMarketOverview")} →</Link>}
        <Link href={usSupported ? usHref : original} prefetch={false}>
          {t(usSupported ? "shellViewUSWorkspace" : "shellOpenOriginalWorkspace")} →
        </Link>
      </div>
      <p className="shared-shell-market-scope">{t("shellMarketScopeNote")}</p>
    </section>
  </main>;
}
