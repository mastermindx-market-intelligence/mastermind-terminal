"use client";
import { useEffect, useRef } from "react";
import { handoffMastermindBrainSymbol, type MastermindBrainHost } from "@/lib/mastermindBrain";
import type { AiContextClientV1 } from "@/lib/aiContext";

// Mounts the production Mastermind Brain widget (mm_brain.js) into the Terminal, replacing
// the old CopilotPanel. The widget is a self-contained IIFE that reads window.MM_BRAIN_CFG
// BEFORE it loads, then exposes window.MMBrain = {open, close, toggle, expand, explain, mounted}.
//
// It calls /api/brain/* same-origin with credentials:'include' and NO Authorization header —
// the Terminal has no window.MDXAuth — so the server proxy (app/api/brain/[...path]) injects
// the Bearer from the verified Supabase session.

const SCRIPT_SRC = "https://www.mastermind-x.com/mm_brain.js";

type Props = {
  active: string;
  onCommand: (j: any) => void;
  onAnnotate: (j: any) => void;
  onAuthRequired?: () => void;
  // DeepVue W1-C: reads the Terminal's current ai_context_client.v1 block at send time.
  // Optional — the deployed production mm_brain.js may not read this key yet (Macro's
  // context-compiler PR lands first), so this hook must be safely ignorable both ways.
  getAiContext?: () => AiContextClientV1;
};

export default function BrainWidget({
  active,
  onCommand,
  onAnnotate,
  onAuthRequired,
  getAiContext,
}: Props) {
  // Keep refs current so the CFG getters/callbacks read live values and never see a stale
  // closure from mount time (the config object is captured by the widget exactly once).
  const symRef = useRef(active);
  const onCommandRef = useRef(onCommand);
  const onAnnotateRef = useRef(onAnnotate);
  const onAuthRequiredRef = useRef(onAuthRequired);
  const getAiContextRef = useRef(getAiContext);

  useEffect(() => {
    symRef.current = active;
    // The script is a document-level singleton and can outlive this component
    // during a client-side /terminal -> /analysis navigation.  Rebind the
    // shared getter on every active-symbol change so a subsequent handoff
    // cannot keep querying an unmounted component's stale ref. This ALREADY
    // reassigns `MM_BRAIN_CFG.symbol` fresh on every mount (not just the first) via
    // `handoffMastermindBrainSymbol`, so — unlike the three callbacks below — `symbol` needed no
    // further change for the mount->unmount->remount bug (reviewer ruling M6).
    handoffMastermindBrainSymbol(active);
  }, [active]);
  // Reviewer ruling M6(a): `onCommand`/`onAnnotate`/`onAuthRequired` used to be bound ONLY inside
  // the mount-once install effect below, closing over THIS instance's refs. On a
  // mount -> unmount -> remount cycle (e.g. toggling the Brain dock off then on — freeze §7's own
  // new capability) the install effect's guard (`w.MMBrain?.mounted` / the existing `<script>` tag)
  // makes it a no-op on the second mount, so the document-level singleton kept calling BACK INTO
  // THE FIRST, NOW-UNMOUNTED INSTANCE's refs forever — a silent W1-C regression once the dock could
  // actually be toggled. Each callback now gets its own write-through effect, shaped exactly like
  // the existing `getAiContext` one below: it re-seeds the singleton's key on EVERY mount/prop
  // change (once `MM_BRAIN_CFG` exists — the install effect seeds the very first value), and
  // relinquishes on cleanup ONLY if the singleton still holds THIS instance's own closure (so an
  // already-superseded cleanup from an earlier remount can never clobber a newer instance's binding).
  useEffect(() => {
    onCommandRef.current = onCommand;
    if (typeof window === "undefined") return;
    const w = window as unknown as MastermindBrainHost;
    if (!w.MM_BRAIN_CFG) return; // first mount: the install effect (below) seeds the key
    const fn = (j: any) => onCommandRef.current?.(j);
    w.MM_BRAIN_CFG.onCommand = fn;
    return () => { if (w.MM_BRAIN_CFG?.onCommand === fn) w.MM_BRAIN_CFG.onCommand = undefined; };
  }, [onCommand]);
  useEffect(() => {
    onAnnotateRef.current = onAnnotate;
    if (typeof window === "undefined") return;
    const w = window as unknown as MastermindBrainHost;
    if (!w.MM_BRAIN_CFG) return;
    const fn = (j: any) => onAnnotateRef.current?.(j);
    w.MM_BRAIN_CFG.onAnnotate = fn;
    return () => { if (w.MM_BRAIN_CFG?.onAnnotate === fn) w.MM_BRAIN_CFG.onAnnotate = undefined; };
  }, [onAnnotate]);
  useEffect(() => {
    onAuthRequiredRef.current = onAuthRequired;
    if (typeof window === "undefined") return;
    const w = window as unknown as MastermindBrainHost;
    if (!w.MM_BRAIN_CFG) return;
    const fn = () => onAuthRequiredRef.current?.();
    w.MM_BRAIN_CFG.onAuthRequired = fn;
    return () => { if (w.MM_BRAIN_CFG?.onAuthRequired === fn) w.MM_BRAIN_CFG.onAuthRequired = undefined; };
  }, [onAuthRequired]);
  // DeepVue W1-C write-through: mm_brain.js is a document-level singleton that intentionally
  // survives a client-side route change (e.g. /terminal -> /analysis), the same way `symbol`
  // is rebound above via handoffMastermindBrainSymbol. Capturing getAiContext once at mount
  // (like the install effect below does for the other CFG keys) would leave the LIVE widget
  // reading a dead TerminalShell's frozen context forever after this component unmounts — a
  // wrong-entity regression the Macro compiler would lawfully prefer over the correct legacy
  // symbol. So this effect writes straight into the live singleton CFG on every getAiContext
  // change, and relinquishes the key on unmount so a widget with no mounted Terminal owner has
  // NO ai-context (the compiler must fall back to the legacy symbol mapping, never a stale one).
  //
  // Ordering dependency: this effect is declared BEFORE the CFG-install effect below, so on
  // first mount `w.MM_BRAIN_CFG` does not exist yet and this effect no-ops; the install effect
  // then seeds `getAiContext` itself. On every later getAiContext change this effect overwrites
  // the live key directly.
  useEffect(() => {
    getAiContextRef.current = getAiContext;
    if (typeof window === "undefined") return;
    const w = window as unknown as MastermindBrainHost;
    if (!w.MM_BRAIN_CFG) return; // first mount: the install effect (below) seeds the key
    const fn = () => getAiContextRef.current?.();
    w.MM_BRAIN_CFG.getAiContext = fn;
    return () => { if (w.MM_BRAIN_CFG?.getAiContext === fn) w.MM_BRAIN_CFG.getAiContext = undefined; };
  }, [getAiContext]);

  // Load the widget exactly once per document. StrictMode double-invokes effects in dev,
  // and the widget itself is a singleton — guard on both the mounted flag and an existing tag.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const w = window as unknown as MastermindBrainHost;
    if (w.MMBrain?.mounted) return;
    if (document.querySelector(`script[src="${SCRIPT_SRC}"]`)) return;

    w.MM_BRAIN_CFG = {
      anchor: "top", // no built-in launcher; host calls window.MMBrain.open()/.toggle()
      api: "", // same-origin — /api/brain/* with credentials:'include'
      symbol: () => w.__MM_BRAIN_ACTIVE_SYMBOL__ || symRef.current,
      onCommand: (j: any) => onCommandRef.current?.(j),
      onAnnotate: (j: any) => onAnnotateRef.current?.(j),
      onAuthRequired: () => onAuthRequiredRef.current?.(),
      // DeepVue W1-C: built fresh on every call — never captured once at mount — so the
      // widget always reads the current context_revision/active/ambient at send time.
      // Safely ignorable: production mm_brain.js that doesn't know this key simply never
      // calls it.
      getAiContext: () => getAiContextRef.current?.(),
    };

    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.defer = true;
    document.body.appendChild(s);
    // Intentionally NOT removed on unmount: the widget is a document-level singleton and
    // TerminalShell is the only mount site; tearing the script down would orphan window.MMBrain.
  }, []);

  return null;
}
