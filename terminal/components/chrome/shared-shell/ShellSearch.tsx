"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SharedSearchResume } from "@/components/SharedSearchWorkspace";
import SymbolPicker from "@/components/SymbolPicker";
import { useActiveSymbol, writeActiveSymbol } from "@/lib/activeSymbol";
import { useLang } from "@/lib/i18n";
import { pick } from "@/lib/finFormat";
import { useSharedShellT } from "@/lib/sharedShellCopy";
import { COMPANY_SEARCH_HISTORY_KEY, companySearchAnalysisHref, readCompanySearchSelection,
  type CompanySearchSelection } from "@/lib/companySearchContext";

export default function ShellSearch({ open, onOpenChange }: {
  open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const symbol = useActiveSymbol();
  const t = useSharedShellT();
  const { lang } = useLang();
  const searchLabel = pick(lang === "zh", "Search companies and tools", "搜索公司和工具");
  // Preserve #1188's lazy data-owner boundary: an untouched toolbar loads no manifest/catalog.
  const [activated, setActivated] = useState(open);
  const [resume, setResume] = useState<CompanySearchSelection | null>(null);
  const [scopedResume, setScopedResume] = useState<SharedSearchResume | null>(null);
  const draft = useRef<SharedSearchResume | null>(null);
  const closedQuery = useRef<string | null>(null);
  const ownedOpening = useRef(false);
  useEffect(() => {
    if (!open) { ownedOpening.current = false; return; }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- activation follows the existing controlled company command.
    setActivated(true);
    // Toolbar and Back keep their explicit scope; the incumbent external company
    // command (including '/') starts Companies without discarding its query.
    if (!ownedOpening.current) setScopedResume(previous => ({ scope: "companies", query: closedQuery.current ?? previous?.query ?? "" }));
    ownedOpening.current = false;
  }, [open]);
  const rememberDraft = useCallback((next: SharedSearchResume) => { draft.current = next; }, []);
  const committing = useRef(false);
  const changeOpen = (next: boolean) => {
    if (next) { ownedOpening.current = true; committing.current = false; if (draft.current) setScopedResume(draft.current); }
    if (!next && !committing.current) {
      // Save before the next dialog mount reports its initial empty render.
      closedQuery.current = draft.current?.query ?? scopedResume?.query ?? "";
      const state = window.history.state;
      if (state?.[COMPANY_SEARCH_HISTORY_KEY]) {
        const nextState = { ...state };
        delete nextState[COMPANY_SEARCH_HISTORY_KEY];
        window.history.replaceState(nextState, "", window.location.href);
      }
    }
    onOpenChange(next);
  };
  useEffect(() => {
    const restore = () => {
      const marker = window.history.state?.[COMPANY_SEARCH_HISTORY_KEY];
      if (marker?.scope === "tools" && marker.href === window.location.href && typeof marker.query === "string" && marker.query.length <= 160 && typeof marker.selected === "string") {
        ownedOpening.current = true;
        setScopedResume({ scope: "tools", query: marker.query, selected: marker.selected });
        committing.current = false; onOpenChange(true); return;
      }
      const selection = readCompanySearchSelection({ symbol: marker?.symbol, query: marker?.query });
      if (!selection || marker.href !== window.location.href) return;
      ownedOpening.current = true;
      committing.current = false;
      setResume(selection);
      setScopedResume({ scope: "companies", query: selection.query, selected: selection.symbol });
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
    closedQuery.current = selection.query;
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
  const openTool = (href: string, query: string) => {
    // The lazy directory supplies an exact finite member; this host never manufactures a route.
    if (!href.startsWith("/") || href.startsWith("//") || /[\\\x00-\x1f]/.test(href)) return;
    closedQuery.current = query;
    committing.current = true;
    window.history.replaceState({ ...window.history.state,
      [COMPANY_SEARCH_HISTORY_KEY]: { scope: "tools", query, selected: href, href: window.location.href },
    }, "", window.location.href);
    onOpenChange(false); router.push(href);
  };
  if (!activated) return <button type="button" className="sym-pick shared-shell-company-search"
    aria-label={searchLabel} aria-haspopup="dialog" aria-expanded={false} title={searchLabel}
    onPointerEnter={() => setActivated(true)} onClick={() => { setActivated(true); changeOpen(true); }}>
    <span className="sym-pick-mark" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg></span>
    <span className="sym-pick-id"><small>{searchLabel}</small><strong>{searchLabel}</strong></span>
    <svg className="sym-pick-car" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
  </button>;
  return <SymbolPicker scope="companies" portalDialog symbol={symbol ?? ""} open={open} onOpenChange={changeOpen}
    searchSeed={scopedResume?.query ?? resume?.query} initialSelection={scopedResume?.scope === "tools" ? undefined : scopedResume?.selected ?? resume?.symbol}
    sharedSearch={{ scope: scopedResume?.scope, selectedTool: scopedResume?.scope === "tools" ? scopedResume.selected : undefined, onOpenTool: openTool, onDraftChange: rememberDraft }}
    onCompanyPick={pickCompany}
    onPick={next => pickCompany(next, "")}
    className="shared-shell-company-search"
    eyebrow={t("shellSearchCompanies")}
    label={searchLabel}
    displayLabel={searchLabel}
    mark={<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg>}
    trackSource="shared-shell"
  />;
}
