"use client";
import { useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import BrainWidget from "@/components/BrainWidget";
import { createAiContextProvider, type AiContextClientV1, type AiContextProvider } from "@/lib/aiContext";
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
 * Alive guard (PR #798 review round 1, finding 1): `window.MM_BRAIN_CFG` is a DOCUMENT
 * singleton that outlives this mount, and in production (no StrictMode) BrainWidget's
 * write-through effect registers no cleanup on its first mount — the install effect's closure
 * over BrainWidget's own ref is never cleared. Without a guard, a cold /analysis load followed
 * by a soft navigation to another (shell) route kept answering every later chat turn with the
 * DEAD analysis tuple (ambient page "analysis", panel "theses"). The getter handed down is
 * therefore identity-stable AND answers `undefined` once this host has unmounted, which is the
 * widget's existing "no owner → legacy mapping" answer. Pinned by
 * lib/__tests__/analysisBrainHost.test.tsx, which renders the REAL BrainWidget without
 * StrictMode so the production effect ordering is what runs.
 *
 * `useSearchParams` lives HERE, not in AppShell, and needs no Suspense boundary: this host only
 * mounts under `path.startsWith("/analysis")`, and the whole (shell) route group is
 * `dynamic = "force-dynamic"` (app/(shell)/layout.tsx), so no route it serves is statically
 * prerendered and the CSR bailout cannot occur. Not wrapping it is deliberate — a dehydrated
 * Suspense boundary hydrates its children in a LATER lane, which would break the mount-order
 * guarantee AppShell relies on (MM_BRAIN_CFG exists before any sibling workspace child's
 * effects run).
 */
type HostProps = Omit<ComponentProps<typeof BrainWidget>, "getAiContext">;

export default function AnalysisBrainHost({ active, onCommand, onAnnotate, onAuthRequired }: HostProps) {
  const path = usePathname();
  const searchParams = useSearchParams();
  const panel = ambientForAnalysisRoute(parseAnalysisSearchParams(searchParams));
  const symbol = active ? active : null;

  // Lazy initializer: runs once per mount, synchronously, from the route the host mounted on.
  const [provider] = useState<AiContextProvider>(() =>
    createAiContextProvider({ symbol, page: "analysis", panel }),
  );

  // Alive guard — see the doc comment. `true` from the first render (first-send law: a read
  // before effects must still answer), re-armed on every mount (StrictMode's simulated
  // unmount→remount included), cleared on unmount. The getter itself is created once so
  // BrainWidget's write-through effect never churns on a changed prop identity.
  const aliveRef = useRef(true);
  const [getAiContext] = useState<() => AiContextClientV1 | undefined>(
    () => () => (aliveRef.current ? provider.getAiContext() : undefined),
  );
  useLayoutEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    provider.noteContextChange({ symbol, page: "analysis", panel });
  }, [provider, path, panel, symbol]);

  return (
    <BrainWidget
      active={active}
      onCommand={onCommand}
      onAnnotate={onAnnotate}
      onAuthRequired={onAuthRequired}
      getAiContext={getAiContext}
    />
  );
}
