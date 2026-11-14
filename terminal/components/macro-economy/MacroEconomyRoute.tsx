"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLang } from "@/lib/i18n";
import { marketNavigationHref, workspaceMarket } from "@/lib/sharedShellMarket";
import { ECONOMIC_WORKSPACES, economicSelection, economicSelectionSearch, type EconomicSelection, type EconomicWorkspaceId } from "@/lib/shared-shell/macroEconomyPayload";
import MacroEconomyReader from "./MacroEconomyReader";
import MacroEconomyNavigation from "./MacroEconomyNavigation";
import s from "./MacroEconomy.module.css";

const COPY = {
  en: { invalid: "This view could not be opened.", reset: "Open the default view", economy: "Economy" },
  zh: { invalid: "无法打开此视图。", reset: "打开默认视图", economy: "经济" },
} as const;

/** The shared shell owns market/identity. Next's URL owns view selections. */
export default function MacroEconomyRoute({ ownerKey, workspaceId }: { ownerKey: string; workspaceId: EconomicWorkspaceId | null }) {
  const { lang } = useLang(), c = COPY[lang], router = useRouter();
  const path = usePathname(), params = useSearchParams(), search = params.toString();
  const market = workspaceMarket(path, search), selection = economicSelection(params);
  const [fragment, setFragment] = useState("");
  useEffect(() => {
    const update = () => setFragment(window.location.hash);
    update();
    window.addEventListener("hashchange", update); window.addEventListener("popstate", update);
    return () => { window.removeEventListener("hashchange", update); window.removeEventListener("popstate", update); };
  }, [path, search]);
  const href = useCallback((id: EconomicWorkspaceId) => marketNavigationHref(ECONOMIC_WORKSPACES[id].path, market), [market]);
  const overviewHref = marketNavigationHref("/macro_monetary.html", market), dashboardHref = marketNavigationHref("/macro.html", market);
  const onSelect = useCallback((change: Partial<EconomicSelection>) => {
    const next = economicSelectionSearch(search, change);
    const target = `${path}${next ? `?${next}` : ""}${window.location.hash}`;
    // A scrubbed observation remains shareable without adding a Back step for
    // every slider tick. Deliberate study/measure/view changes retain history.
    const observationOnly = typeof change.observation === "string"
      && Object.keys(change).every(key => key === "observation" || key === "series")
      && (change.series === undefined || change.series === selection?.series || selection?.series === null);
    if (observationOnly) router.replace(target, { scroll: false });
    else router.push(target, { scroll: false });
  }, [router, path, search, selection?.series]);
  const onNavigate = useCallback((target: string) => router.push(target), [router]);
  const currentHref = `${path}${search ? `?${search}` : ""}${fragment}`;
  const valid = selection && (selection.task !== "revisions" || workspaceId === "labor_markets");
  return <main id="shared-shell-content" tabIndex={-1} className="main2" data-native-macro-economy="">
    {valid ? <MacroEconomyReader ownerKey={ownerKey} workspaceId={workspaceId} lang={lang} selection={selection}
      onSelect={onSelect} onNavigate={onNavigate} overviewHref={overviewHref} dashboardHref={dashboardHref}
      workspaceHref={href} signInHref={`/login?next=${encodeURIComponent(currentHref)}`}/>
      : <div className={s.root}><MacroEconomyNavigation active="economy" lang={lang} dashboardHref={dashboardHref} overviewHref={overviewHref}/>
        <h1>{workspaceId ? ECONOMIC_WORKSPACES[workspaceId][lang] : c.economy}</h1>
        <section className={s.limit} role="status"><p>{c.invalid}</p><Link className={s.textButton} href={workspaceId ? href(workspaceId) : overviewHref} prefetch={false}>{c.reset} →</Link></section>
      </div>}
  </main>;
}
