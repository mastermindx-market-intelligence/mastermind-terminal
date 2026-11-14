"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSharedShellT } from "@/lib/sharedShellCopy";
import { createAiContextProvider } from "@/lib/aiContext";
import type { MastermindBrainHost } from "@/lib/mastermindBrain";
import BrainWidget, { loadBrainWidget } from "./BrainWidget";
import "./brain-workspace.css";

// Only the full-page host adopts the optional workspace API during the phased
// widget rollout. Chart and Options consumers keep their established contract.
type WorkbenchHost = MastermindBrainHost & {
  MMBrain?: {
    mountWorkspace?: (container: HTMLElement) => (() => void) | undefined;
    close?: () => void;
  };
};

type Phase = "loading" | "ready" | "unavailable" | "compact";
const signIn = () => window.location.assign("/login");

export default function BrainWorkspace({ symbol }: { symbol: string | null }) {
  const t = useSharedShellT();
  const slot = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [attempt, setAttempt] = useState(0);
  const [context] = useState(() => createAiContextProvider({ page: "brain", symbol }));

  useLayoutEffect(() => {
    context.noteContextChange({ page: "brain", symbol });
  }, [context, symbol]);

  useEffect(() => {
    const host = window as unknown as WorkbenchHost;
    let release: (() => void) | undefined;
    const attach = () => {
      if (release || !slot.current || !host.MMBrain?.open) return;
      if (host.MMBrain.mountWorkspace) {
        release = host.MMBrain.mountWorkspace(slot.current);
        setPhase(release ? "ready" : "compact");
      } else {
        // Older published widgets still own working chat while the native
        // presentation rolls out. Opening them is always an explicit action.
        setPhase("compact");
      }
    };
    const unavailable = () => { if (!host.MMBrain?.open) setPhase("unavailable"); };
    window.addEventListener("mm-brain-ready", attach);
    window.addEventListener("mm-brain-load-error", unavailable);
    const timer = window.setTimeout(unavailable, 12000);
    if (host.MMBrain?.open) attach();
    else loadBrainWidget();
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("mm-brain-ready", attach);
      window.removeEventListener("mm-brain-load-error", unavailable);
      if (release) release();
      else host.MMBrain?.close?.();
    };
  }, [attempt]);

  return <main className="main2 brain-workspace" aria-label={t("shellBrainName")}>
    <BrainWidget active={symbol ?? ""} onAuthRequired={signIn} getAiContext={context.getAiContext} />
    <div className="brain-workspace-slot" ref={slot} />
    {phase !== "ready" && <section className="brain-workspace-state" aria-live="polite">
      <h1>{t("shellBrainName")}</h1>
      {phase === "loading" && <p>{t("shellOpening")}</p>}
      {phase === "unavailable" && <>
        <p>{t("shellBrainLoadError")}</p>
        <button type="button" className="btn" onClick={() => { setPhase("loading"); setAttempt(value => value + 1); }}>
          {t("shellRetry")}
        </button>
      </>}
      {phase === "compact" && <>
        <p>{t("shellBrainCompact")}</p>
        <button type="button" className="btn" onClick={() => (window as unknown as WorkbenchHost).MMBrain?.open?.()}>
          {t("shellBrainOpenChat")}
        </button>
      </>}
    </section>}
  </main>;
}
