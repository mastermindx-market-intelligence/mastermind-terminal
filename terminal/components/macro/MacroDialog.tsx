"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { acquireScrollLock } from "@/lib/scrollLock";
import { createNewerModalFocusGuard, restoreDialogFocus } from "@/lib/dialogFocusReturn";
import s from "./MacroDashboard.module.css";

export default function MacroDialog({ title, subtitle, closeLabel, onClose, children }: {
  title: string; subtitle: string; closeLabel: string; onClose: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null), titleId = useId(), subtitleId = useId(), composing = useRef(false);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const newerOwns = createNewerModalFocusGuard(dialog);
    dialog.showModal();
    const release = acquireScrollLock();
    dialog.querySelector<HTMLButtonElement>("button")?.focus();
    const wrap = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || event.defaultPrevented) return;
      const items = [...dialog.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,[tabindex]')].filter(el => el.tabIndex >= 0 && !el.matches(":disabled") && el.getClientRects().length > 0 && !el.closest("[hidden], [inert]"));
      const first = items[0], last = items.at(-1);
      if (!first) { event.preventDefault(); dialog.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    dialog.addEventListener("keydown", wrap);
    return () => {
      dialog.removeEventListener("keydown", wrap);
      const active = document.activeElement, owned = dialog.contains(active);
      dialog.close(); release();
      if (owned) restoreDialogFocus(opener, undefined, newerOwns);
      else if (active instanceof HTMLElement && active.isConnected && document.activeElement !== active) active.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={ref} className={s.dialog} aria-modal="true" aria-labelledby={titleId} aria-describedby={subtitleId}
    onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
    onCancel={event => { event.preventDefault(); if (!composing.current) close.current(); }}
    onClick={event => { if (event.target !== event.currentTarget) return; const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close.current(); }}>
    <header className={s.dialogHeader}><div><p className={s.eyebrow}>MACRO INTELLIGENCE</p><h2 id={titleId}>{title}</h2><p id={subtitleId}>{subtitle}</p></div><button className={s.iconButton} onClick={() => close.current()} aria-label={closeLabel}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg></button></header>
    <div className={s.dialogBody}>{children}</div>
  </dialog>;
}
