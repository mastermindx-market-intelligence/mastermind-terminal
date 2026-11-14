"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLang } from "@/lib/i18n";
import { createAiContextProvider } from "@/lib/aiContext";
import type { MastermindBrainHost } from "@/lib/mastermindBrain";
import BrainWidget, { loadBrainWidget } from "./BrainWidget";
import "./brain-workspace.css";

type Phase = "loading" | "ready" | "unavailable" | "compact";
const signIn = () => window.location.assign("/login");

export default function BrainWorkspace({ symbol }: { symbol: string | null }) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const slot = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [attempt, setAttempt] = useState(0);
  const [context] = useState(() => createAiContextProvider({ page: "brain", symbol }));

  useLayoutEffect(() => {
    context.noteContextChange({ page: "brain", symbol });
  }, [context, symbol]);

  useEffect(() => {
    const host = window as unknown as MastermindBrainHost;
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

  return <main className="main2 brain-workspace" aria-label={zh ? "操盘大脑" : "Mastermind AI"}>
    <BrainWidget active={symbol ?? ""} onAuthRequired={signIn} getAiContext={context.getAiContext} />
    <div className="brain-workspace-slot" ref={slot} />
    {phase !== "ready" && <section className="brain-workspace-state" aria-live="polite">
      <h1>{zh ? "操盘大脑" : "Mastermind AI"}</h1>
      {phase === "loading" && <p>{zh ? "正在打开对话…" : "Opening your workspace…"}</p>}
      {phase === "unavailable" && <>
        <p>{zh ? "暂时无法载入对话。" : "The chat could not be loaded."}</p>
        <button type="button" className="btn" onClick={() => { setPhase("loading"); setAttempt(value => value + 1); }}>
          {zh ? "重试" : "Try again"}
        </button>
      </>}
      {phase === "compact" && <>
        <p>{zh ? "当前可使用紧凑对话视图。" : "Chat is available in compact view."}</p>
        <button type="button" className="btn" onClick={() => (window as unknown as MastermindBrainHost).MMBrain?.open?.()}>
          {zh ? "打开对话" : "Open chat"}
        </button>
      </>}
    </section>}
  </main>;
}
