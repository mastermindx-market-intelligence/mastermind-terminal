"use client";
/**
 * Chart command palette (E20) — search the chart screen's existing actions and run one.
 *
 * Presentation only. The action list comes from `buildPaletteActions(context)`, and running an
 * action goes back to TerminalShell through `onRun`, which re-checks it against the LIVE shell
 * state and then calls the same handler the visible control uses. If the chart the palette was
 * showing has changed in the meantime, nothing runs: the palette says what changed and asks for a
 * second, informed confirmation instead of applying the action to a chart the row did not name.
 *
 * Desktop/tablet: a centred dialog with a combobox + listbox. Phone: the same body in the shared
 * MobileSheet (focus trap, Escape, drag-to-dismiss), opened without summoning the keyboard.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import MobileSheet from "@/components/ui/MobileSheet";
import {
  buildPaletteActions,
  describePaletteTarget,
  filterPaletteActions,
  groupPaletteActions,
  paletteContextToken,
  type PaletteContext,
  type PaletteRunDecision,
} from "@/lib/commandPalette/catalog";
import { paletteText, type PaletteLang } from "@/lib/commandPaletteLex";
import styles from "./CommandPalette.module.css";

export interface CommandPaletteProps {
  lang: PaletteLang;
  /** Snapshot of what the chart screen shows right now (rebuilt by the shell every render). */
  context: PaletteContext;
  phone: boolean;
  /** Re-check `actionId` (chosen while `seenToken` was shown) against live state; run it if valid. */
  onRun: (actionId: string, seenToken: string) => PaletteRunDecision;
  onClose: () => void;
}

/** Runs that open their own dialog keep focus there instead of returning it to the opener. */
const KEEPS_FOCUS = new Set(["open-indicators", "save-template", "goto-date"]);

export default function CommandPalette({ lang, context, phone, onRun, onClose }: CommandPaletteProps) {
  const t = (key: string, vars?: Record<string, string | number>) => paletteText(lang, key, vars);
  const baseId = useId().replace(/:/g, "");
  const listId = `${baseId}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);

  const token = paletteContextToken(context);
  const [seenToken, setSeenToken] = useState(token);
  const stale = token !== seenToken;
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const actions = useMemo(() => buildPaletteActions(context, lang), [context, lang]);
  const ranked = useMemo(() => filterPaletteActions(actions, query), [actions, query]);
  const groups = useMemo(() => groupPaletteActions(ranked, lang, query.trim().length > 0), [ranked, lang, query]);
  const flat = useMemo(() => groups.flatMap((g) => g.actions), [groups]);
  const firstEnabled = flat.find((a) => !a.unavailable) ?? flat[0] ?? null;
  // Keep the highlight on the same action across rebuilds; fall back to the first runnable row.
  const highlighted = (activeId && flat.find((a) => a.id === activeId)) || firstEnabled;
  const highlightIndex = highlighted ? flat.indexOf(highlighted) : -1;
  const showHighlight = !stale && highlightIndex >= 0;

  useEffect(() => {
    openerRef.current = document.activeElement;
    if (!phone) {
      const frame = window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
      return () => window.cancelAnimationFrame(frame);
    }
    return undefined;
  }, [phone]);

  // A new query starts from its best match.
  useEffect(() => { setActiveId(null); }, [query]);

  useEffect(() => {
    if (!showHighlight || highlightIndex < 0) return;
    const row = listRef.current?.querySelector<HTMLElement>(`#${baseId}-opt-${highlightIndex}`);
    row?.scrollIntoView?.({ block: "nearest" });
  }, [baseId, highlightIndex, showHighlight]);

  const close = (restoreFocus: boolean) => {
    const opener = openerRef.current as HTMLElement | null;
    onClose();
    if (restoreFocus && !phone && opener && typeof opener.focus === "function" && opener.isConnected) {
      opener.focus({ preventScroll: true });
    }
  };

  const attempt = (actionId: string) => {
    const decision = onRun(actionId, seenToken);
    if (decision.ok) {
      close(!KEEPS_FOCUS.has(decision.run.kind));
      return;
    }
    if (decision.reason === "stale") {
      // The person now sees the live target; the NEXT confirmation is an informed one.
      setSeenToken(decision.liveToken);
      setActiveId(actionId);
    }
    setNotice(decision.message);
  };

  const move = (delta: number | "home" | "end") => {
    if (!flat.length) return;
    let next: number;
    if (delta === "home") next = 0;
    else if (delta === "end") next = flat.length - 1;
    else next = ((showHighlight ? highlightIndex : -1) + delta + flat.length) % flat.length;
    if (stale) setSeenToken(token);
    setActiveId(flat[next].id);
    setNotice(null);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // Keys typed in the palette are the palette's: no chart, toolbar or symbol-search hotkey sees them.
    e.stopPropagation();
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); move(1); return;
      case "ArrowUp": e.preventDefault(); move(-1); return;
      case "Home": if (e.target === inputRef.current && query) return; e.preventDefault(); move("home"); return;
      case "End": if (e.target === inputRef.current && query) return; e.preventDefault(); move("end"); return;
      case "Enter": {
        if (e.target === closeRef.current) return;
        e.preventDefault();
        if (stale) {
          // A change landed while the person was choosing: show it, run nothing.
          const id = highlighted?.id;
          if (id) attempt(id);
          else setSeenToken(token);
          return;
        }
        if (highlighted) attempt(highlighted.id);
        return;
      }
      case "Escape":
        if (phone) return; // MobileSheet owns Escape on phone.
        e.preventDefault();
        close(true);
        return;
      case "Tab":
        if (phone) return; // MobileSheet traps Tab on phone.
        e.preventDefault();
        (document.activeElement === inputRef.current ? closeRef.current : inputRef.current)?.focus();
        return;
      default:
    }
  };

  const target = describePaletteTarget(context, lang);
  const staleNotice = stale ? t("cpStaleNoAction", { target }) : null;
  const shownNotice = notice ?? staleNotice;

  const body = (
    <div className={`${styles.body}${phone ? ` ${styles.phone}` : ""}`} onKeyDown={onKeyDown} data-command-palette="1" data-stale={stale ? "1" : undefined}>
      {!phone && (
        <div className={styles.head}>
          <h2 id={`${baseId}-title`} className={styles.title}>{t("cpTitle")}</h2>
          <button ref={closeRef} type="button" className={styles.close} aria-label={t("cpClose")} onClick={() => close(true)}>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" /></svg>
          </button>
        </div>
      )}
      <p className={styles.context} data-palette-target="1">{t("cpActingOn", { target })}</p>
      <div className={styles.searchRow}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" className={styles.searchIcon}><circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.7" fill="none" /><path d="M16 16l4.5 4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
        <input
          ref={inputRef}
          className={styles.input}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={t("cpSearchLabel")}
          aria-activedescendant={showHighlight ? `${baseId}-opt-${highlightIndex}` : undefined}
          placeholder={t("cpSearchPlaceholder")}
          value={query}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="go"
          onChange={(e) => { setQuery(e.target.value); setNotice(null); }}
        />
      </div>
      <div className={styles.notice} role="status" aria-live="polite" data-palette-notice="1">{shownNotice}</div>
      <div ref={listRef} id={listId} role="listbox" aria-label={t("cpActionsList")} className={styles.list}>
        {flat.length === 0 && <p className={styles.empty}>{t("cpNoMatches", { q: query.trim() })}</p>}
        {(() => {
          let index = -1;
          return groups.map((group) => (
            <div key={group.id} role="group" aria-labelledby={`${baseId}-g-${group.id}`} className={styles.group}>
              <div id={`${baseId}-g-${group.id}`} className={styles.groupLabel} role="presentation">{group.label}</div>
              {group.actions.map((action) => {
                index += 1;
                const rowIndex = index;
                const isActive = showHighlight && rowIndex === highlightIndex;
                return (
                  <div
                    key={action.id}
                    id={`${baseId}-opt-${rowIndex}`}
                    role="option"
                    aria-selected={isActive}
                    aria-disabled={action.unavailable ? true : undefined}
                    data-action-id={action.id}
                    className={`${styles.row}${isActive ? ` ${styles.active}` : ""}${action.unavailable ? ` ${styles.disabled}` : ""}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseMove={() => { if (!stale && activeId !== action.id) setActiveId(action.id); }}
                    onClick={() => { setActiveId(action.id); attempt(action.id); }}
                  >
                    <span className={styles.rowLabel}>{action.label}</span>
                    <span className={styles.rowTarget}>{action.target}</span>
                    {action.unavailable && <span className={styles.rowWhy}>{action.unavailable}</span>}
                  </div>
                );
              })}
            </div>
          ));
        })()}
      </div>
      {!phone && <p className={styles.hint} aria-hidden="true">{t("cpKeyHint")}</p>}
    </div>
  );

  if (phone) {
    return (
      <MobileSheet open onClose={() => close(false)} title={t("cpTitle")} initialFocus="sheet" className={styles.sheet} maxHeight="86dvh">
        {body}
      </MobileSheet>
    );
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <>
      <div className={styles.scrim} aria-hidden="true" onMouseDown={() => close(true)} />
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={`${baseId}-title`}>
        {body}
      </div>
    </>,
    document.body,
  );
}
