"use client";
import { Suspense, useLayoutEffect, useState, type ComponentProps } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import BrainWidget from "@/components/BrainWidget";
import { createAiContextProvider, type AiContextProvider } from "@/lib/aiContext";
import { ambientForAnalysisRoute, parseAnalysisSearchParams } from "@/lib/analysisRoute";

/**
 * AnalysisBrainHost — the /analysis Brain mount with its ambient page/panel context
 * (MarketOntology F11-6; Sol's recompose map 5967105152 on macro #7100).
 *
 * AppShell used to mount `<BrainWidget>` bare on /analysis, so every chat turn from the
 * Analysis surface reached the Macro compiler with NO ai-context block and was classified
 * by the legacy symbol mapping — a Thesis/Research turn was indistinguishable from an
 * ordinary Analysis turn. This host owns exactly ONE `createAiContextProvider` per mount
 * (a lazy useState initializer — the lint-clean form of TerminalShell's provider ref; the
 * identity is stable for the life of the mount) seeded from the parsed `?view=` route, so:
 *
 *   /analysis?symbol=NVDA              → ambient { page: "analysis", panel: "company" }
 *   /analysis?view=theses&symbol=NVDA  → ambient { page: "analysis", panel: "theses" }
 *   /analysis?view=nope                → ambient { page: "analysis", panel: null }
 *
 * First-send law: the provider is constructed synchronously on first render from the CURRENT
 * route, so the very first `getAiContext()` read (revision 0) already carries the right panel — no
 * effect-ordering race, no synthetic transition. The one layout effect below re-applies the
 * tuple on every (path, panel, symbol) change; the provider's duplicate suppression keeps the
 * revision at exactly one bump per real transition (StrictMode double-effects included).
 *
 * `useSearchParams` lives HERE, not in AppShell: this component only mounts under
 * `path.startsWith("/analysis")` (a dynamic route — the server page awaits `searchParams`),
 * so the static (shell) routes never hit the CSR bailout. The Suspense boundary is the repo
 * idiom (AppNav, the Options page) and is belt-and-braces: nothing suspends on the client for
 * a dynamic route, so BrainWidget still mounts in the same pass as before and MM_BRAIN_CFG
 * still exists before any sibling workspace child's effects run.
 */
type HostProps = Omit<ComponentProps<typeof BrainWidget>, "getAiContext">;

export default function AnalysisBrainHost(props: HostProps) {
  return (
    <Suspense fallback={null}>
      <AnalysisBrainHostInner {...props} />
    </Suspense>
  );
}

function AnalysisBrainHostInner({ active, onCommand, onAnnotate, onAuthRequired }: HostProps) {
  const path = usePathname();
  const searchParams = useSearchParams();
  const panel = ambientForAnalysisRoute(parseAnalysisSearchParams(searchParams));
  const symbol = active ? active : null;

  // Lazy initializer: runs once per mount, synchronously, from the route the host mounted on.
  const [provider] = useState<AiContextProvider>(() =>
    createAiContextProvider({ symbol, page: "analysis", panel }),
  );
  useLayoutEffect(() => {
    provider.noteContextChange({ symbol, page: "analysis", panel });
  }, [provider, path, panel, symbol]);

  return (
    <BrainWidget
      active={active}
      onCommand={onCommand}
      onAnnotate={onAnnotate}
      onAuthRequired={onAuthRequired}
      getAiContext={provider.getAiContext}
    />
  );
}
