"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { useShellLocation } from "./useShellLocation";
import { usePathname, useSearchParams } from "next/navigation";
import { normalizeAnalysisSymbol } from "@/lib/analysisSymbol";
import { normalizeActiveSymbol, useActiveSymbol } from "@/lib/activeSymbol";
import { useSharedShellT } from "@/lib/sharedShellCopy";
import { inheritWorkspaceMarketHref, workspaceMarket } from "@/lib/sharedShellMarket";
import { sharedShellTerminalHref } from "@/lib/sharedShellNavigation";
import { Tip } from "@/components/ui/Tip";

/** Both rails use the exact same company and return-location handoff. */
export default function SharedShellLaunchLinks({ labelled, drawer = false, onNavigate, glyph }: {
  labelled: boolean;
  drawer?: boolean;
  onNavigate?: () => void;
  glyph: (key: string) => ReactNode;
}) {
  const path = usePathname();
  const params = useSearchParams();
  const symbol = useActiveSymbol();
  const t = useSharedShellT();
  const returnHref = useShellLocation();

  // The explicit URL identity wins over the last chart cursor on company pages.
  let companySymbol: string | null = null;
  if (path === "/analysis") companySymbol = normalizeAnalysisSymbol(params.get("symbol") ?? undefined);
  if (path === "/stock.html" && returnHref) {
    try {
      const url = new URL(returnHref);
      companySymbol = normalizeActiveSymbol(url.hash ? decodeURIComponent(url.hash.slice(1)) : url.searchParams.get("ticker"));
    } catch { /* Malformed symbols must not select an unrelated previous chart. */ }
  }
  const invalidCompany = (path === "/analysis" && params.has("symbol") && !companySymbol)
    || (path === "/stock.html" && !companySymbol);
  const terminalHref = !invalidCompany && returnHref
    ? inheritWorkspaceMarketHref(sharedShellTerminalHref(returnHref, companySymbol ?? symbol), workspaceMarket(path, params.toString())) : "/terminal";
  const brainHref = path === "/stock.html" && companySymbol
    ? "/brain?symbol=" + encodeURIComponent(companySymbol) : "/brain";
  const terminalLabel = t("shellTerminal");
  const brainLabel = t("shellMastermindAI");
  const railClass = drawer ? undefined : "navbtn";
  const labelClass = drawer ? undefined : "investor-nav-label";
  const inTerminal = path === "/terminal" || path === "/analysis" || (path === "/discover" && params.get("tab") !== "sectors")
    || ["/scripts", "/alerts", "/dislocations"].includes(path);
  const terminal = <Link href={terminalHref} prefetch={false} className={drawer ? undefined : `navbtn${inTerminal ? " on" : ""}`}
    aria-current={inTerminal ? "location" : undefined} data-shell-terminal="" aria-label={terminalLabel} onNavigate={onNavigate}>
    {glyph("chart")}{labelled && <span className={labelClass}>{terminalLabel}</span>}
  </Link>;
  const brainContents = <>{glyph("ai")}{labelled && <span className={labelClass}>{brainLabel}</span>}</>;
  // Analysis owns the exact source, active panel, thesis and attachment context.
  // Opening its existing host keeps these scoped to this document and its actor.
  const brain = path === "/analysis" && !invalidCompany
    ? <button type="button" className={railClass} aria-label={brainLabel} onClick={() => {
      onNavigate?.();
      window.dispatchEvent(new CustomEvent("mm:copilot"));
    }}>{brainContents}</button>
    : <Link href={brainHref} prefetch={false} className={drawer ? undefined : `navbtn${path === "/brain" ? " on" : ""}`}
      aria-label={brainLabel} aria-current={path === "/brain" ? "page" : undefined} onNavigate={onNavigate}>{brainContents}</Link>;
  return drawer ? <>{terminal}{brain}</> : <>
    <Tip label={terminalLabel} side="right" size="mini" disabled={labelled}>{terminal}</Tip>
    <Tip label={brainLabel} side="right" size="mini" disabled={labelled}>{brain}</Tip>
  </>;
}
