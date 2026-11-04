"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import SymbolPicker from "@/components/SymbolPicker";
import { useActiveSymbol, writeActiveSymbol } from "@/lib/activeSymbol";
import { useSharedShellT } from "@/lib/sharedShellCopy";
import { COMPANY_SEARCH_HISTORY_KEY, companySearchAnalysisHref, readCompanySearchSelection,
  type CompanySearchSelection } from "@/lib/companySearchContext";

export default function ShellSearch({ open, onOpenChange }: {
  open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const symbol = useActiveSymbol();
  const t = useSharedShellT();
  const [resume, setResume] = useState<CompanySearchSelection | null>(null);
  const committing = useRef(false);
  const changeOpen = (next: boolean) => {
    if (next) committing.current = false;
    if (!next && !committing.current) {
      const state = window.history.state;
      if (state?.[COMPANY_SEARCH_HISTORY_KEY]) {
        const nextState = { ...state };
        delete nextState[COMPANY_SEARCH_HISTORY_KEY];
        window.history.replaceState(nextState, "", window.location.href);
      }
    }
    onOpenChange(next);
    if (!next && !committing.current) {
      // Closing a phone search opened from the directory destroys the directory
      // button that originally owned focus. Restore a visible search trigger only
      // if the sheet's teardown left focus on BODY; never steal new task focus.
      window.requestAnimationFrame(() => {
        if (document.activeElement !== document.body) return;
        const mobile = [...document.querySelectorAll<HTMLButtonElement>(".mobilebar button")]
          .find(button => button.getAttribute("aria-label") === t("shellSearchCompanies"));
        const desktop = document.querySelector<HTMLElement>(".sym-pick.shared-shell-company-search");
        for (const target of [mobile, desktop]) {
          if (!target?.isConnected || target.getClientRects().length === 0
            || target.closest('[aria-hidden="true"], [hidden], [inert]')) continue;
          target.focus({ preventScroll: true });
          if (document.activeElement === target) break;
        }
      });
    }
  };
  useEffect(() => {
    const restore = () => {
      const marker = window.history.state?.[COMPANY_SEARCH_HISTORY_KEY];
      const selection = readCompanySearchSelection({ symbol: marker?.symbol, query: marker?.query });
      if (!selection || marker.href !== window.location.href) return;
      committing.current = false;
      setResume(selection);
      onOpenChange(true);
    };
    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [onOpenChange]);
  const pickCompany = (next: string, query: string) => {
    const selection = readCompanySearchSelection({ symbol: next, query });
    if (!selection) return;
    const href = companySearchAnalysisHref(selection);
    if (!href) return;
    // Annotate this existing history entry without changing its exact URL or Next state.
    // Back restores the real query and full listing, with no separate persistence registry.
    committing.current = true;
    window.history.replaceState({ ...window.history.state,
      [COMPANY_SEARCH_HISTORY_KEY]: { ...selection, href: window.location.href },
    }, "", window.location.href);
    setResume(selection);
    writeActiveSymbol(next);
    onOpenChange(false);
    router.push(href);
  };
  return <SymbolPicker scope="companies" portalDialog symbol={symbol ?? ""} open={open} onOpenChange={changeOpen}
    searchSeed={resume?.query} initialSelection={resume?.symbol} onCompanyPick={pickCompany}
    onPick={next => pickCompany(next, "")}
    className="shared-shell-company-search"
    eyebrow={t("shellSearchCompanies")}
    label={t("shellSearchCompanies")}
    displayLabel={t("shellSearchPlaceholder")}
    mark={<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg>}
    trackSource="shared-shell"
  />;
}
