"use client";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import type { SavedLayout } from "@/lib/layouts";
import StateSwitch from "@/components/StateSwitch";

// The Saved-Workspaces popover body (W2A_WORKSPACE_UX_SPEC.md), extracted so the toolbar popover
// and the responsive overflow ("More ▸ Workspaces") menu cannot drift apart. They previously carried
// two hand-copied copies of the same markup, and only one of them was ever updated.
//
// Three zones (spec §1.1): CREATE (name + Save + Brain-dock toggle) → the ONLY scrolling library →
// BRING ONE IN (Import), pinned below it. Every state this renders is a state the workspace store
// can actually be in — loading / auth / unavailable / ready — plus, per row, whether THAT row can
// be opened at all (`RowState`, derived by the reader — TerminalShell — never by this menu).

export type LayoutStatus = "loading" | "auth" | "unavailable" | "ready";

// Every new kind maps a frozen §8 code to plain copy at the render site, never a raw code.
export type LayoutFeedback =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; name: string }
  | { kind: "renamed" }
  | { kind: "duplicated" }
  | { kind: "imported" }
  | { kind: "error"; message: string }
  | { kind: "conflict"; name: string; suggested: string; op: "save" | "rename" | "duplicate" | "import" }
  | { kind: "stale"; name: string; savedAgo: string };

/** Per-row read state derived by the reader, NEVER by the menu. */
export type RowState = "ok" | "unsupported_floor" | "unsupported_schema";
export type SavedWorkspace = SavedLayout & { rowState: RowState };

export type LayoutMenuProps = {
  status: LayoutStatus;
  layouts: SavedWorkspace[];
  name: string;
  onNameChange: (value: string) => void;
  onSave: () => void;
  saving: boolean;
  feedback: LayoutFeedback;
  deleteError: string | null;
  onLoad: (layout: SavedWorkspace) => void;
  onDelete: (id: string) => void;
  onRetry: () => void;
  onSignUp: () => void;
  /** The overflow menu renders rows as real menuitems; the toolbar popover uses plain divs. */
  rowAs?: "div" | "button";
  /** Overflow menu closes itself once a workspace is picked. */
  onPicked?: () => void;
  /** Whether the assistant (Brain) dock is part of the workspace ABOUT to be saved (freeze §7). */
  brainInWorkspace: boolean;
  onToggleBrainDock: () => void;
  onRename: (layout: SavedWorkspace, newName: string) => void;
  onDuplicate: (layout: SavedWorkspace) => void;
  onExport: (layout: SavedWorkspace) => void;
  onImport: () => void;
  /** The row currently shown with the `stale_revision` rail (spec §3.5), if any. */
  staleName: string | null;
  onUseSuggested: (suggested: string) => void;
  onReloadLatest: () => void;
  onSaveAsCopy: () => void;
  /** Whether THIS mount is currently the visible one (spec §4: "menu opens | focus → `.menu-save
   *  input`... Guest → focus the `.layout-gate` row"). Both mount sites (desktop popover + overflow
   *  drill-down) pass their own open/visible condition — the menu itself never guesses. */
  isOpen: boolean;
  /** Field names the tolerant READ migration of the CURRENTLY LOADED workspace could not claim
   *  (spec §3.7, reviewer ruling B2) — empty when the load was clean or nothing is loaded. A
   *  DURABLE disclosure (not a `feedback`-kind transient), so it renders independently of whatever
   *  `feedback` is currently showing. */
  unclaimedFields: string[];
  /** Ids of widgets in the CURRENTLY LOADED workspace whose `type` this build does not recognize
   *  (spec §3.7, reviewer ruling M5b) — empty when nothing was dropped or nothing is loaded. Same
   *  durable-disclosure treatment as `unclaimedFields`: a save re-captures only widgets this build
   *  knows how to render, so this list warns that saving will remove those panels. */
  unsupportedWidgets: string[];
};

export default function LayoutMenu({
  status, layouts, name, onNameChange, onSave, saving, feedback, deleteError,
  onLoad, onDelete, onRetry, onSignUp, rowAs = "div", onPicked,
  brainInWorkspace, onToggleBrainDock, onRename, onDuplicate, onExport, onImport,
  staleName, onUseSuggested, onReloadLatest, onSaveAsCopy, isOpen, unclaimedFields, unsupportedWidgets,
}: LayoutMenuProps) {
  const t = useT();
  const isGuest = status === "auth";
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const gateRowRef = useRef<HTMLButtonElement | null>(null);

  // spec §4: "menu opens | focus → `.menu-save input` (the primary action). Guest → focus the
  // `.layout-gate` row, since the input is disabled." A disabled element can never receive focus,
  // so a guest session unconditionally lands on the sign-up row instead of silently focusing
  // nothing. Re-fires every time `isOpen` flips false->true (a re-open is a fresh "menu opens").
  useEffect(() => {
    if (!isOpen) return;
    if (isGuest) gateRowRef.current?.focus();
    else nameInputRef.current?.focus();
  }, [isOpen, isGuest]);
  // `rowAs` now controls ONLY `role="menuitem"` (the overflow menu's rows are real menuitems inside
  // a `role="menu"` container; the toolbar popover's are not). The element itself is ALWAYS a real
  // `<button>` — deliberately different from the pre-W2-A menu, where `rowAs="div"` rendered a
  // non-focusable `<div onClick>` on desktop, so the toolbar popover's rows were keyboard-dead. That
  // divergence is exactly what this file's own header comment (spec §1.1) exists to prevent.
  const Row = "button" as const;

  // Local UI-only state: which row is unfolded, and which row (if any) is mid-rename. Neither is
  // data the store owns, so neither lives in TerminalShell.
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const moreRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const firstActionRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // spec §4: "unfold | opening focuses the first sub-row (Open)". Accordion: opening one row
  // closes any other — `toggleRow` already only ever holds one id.
  useEffect(() => {
    if (openRow) firstActionRefs.current[openRow]?.focus();
  }, [openRow]);

  function toggleRow(id: string) {
    setOpenRow((cur) => (cur === id ? null : id));
  }
  function closeRow(id: string) {
    setOpenRow(null);
    moreRefs.current[id]?.focus();
  }
  function cancelRename() {
    setRenamingId(null);
    setDraft("");
  }
  // A successful rename is decided asynchronously by TerminalShell (revision CAS round trip), so
  // the local rename-mode UI closes when that success actually lands — never on click, which would
  // close it before a `name_conflict`/`stale_revision` had a chance to keep it open for a retry.
  useEffect(() => {
    if (feedback.kind === "renamed") { setRenamingId(null); setDraft(""); }
  }, [feedback]);
  function commitRename(l: SavedWorkspace) {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === l.name) { cancelRename(); return; }
    onRename(l, trimmed);
  }

  return (
    <>
      {/* ── ZONE 1 · CREATE ─────────────────────────────────────────────── */}
      <div className="menu-save" data-layout-save>
        <input
          ref={nameInputRef}
          placeholder={isGuest ? t("layoutSignInToSave") : t("saveCurrentAs")}
          value={name}
          disabled={isGuest || saving}
          aria-label={t("saveCurrentAs")}
          onChange={(e) => onNameChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !isGuest && !saving) onSave(); }}
        />
        <button
          type="button"
          data-layout-save-btn
          disabled={isGuest || saving}
          title={isGuest ? t("layoutSignInToSave") : undefined}
          onClick={onSave}
        >{saving ? t("layoutSaving") : t("save")}</button>
      </div>

      {/* Membership of the CURRENT (about-to-be-saved) workspace, not a per-row switch. */}
      <button
        type="button" className="ws-dock" role="switch" aria-checked={brainInWorkspace}
        data-ws-dock-toggle disabled={isGuest} onClick={onToggleBrainDock}
      >
        <span className="ws-dock-copy">
          <span>{t("wsIncludeBrain")}</span>
          <small>{t("wsIncludeBrainSub")}</small>
        </span>
        <StateSwitch on={brainInWorkspace} />
      </button>

      {isGuest && (
        <button ref={gateRowRef} type="button" role="menuitem" className="menu-row layout-gate" data-layout-gate onClick={onSignUp}>
          <span>{t("gateLayouts")}</span>
          <span className="layout-gate-cta">{t("gateSignupCta")}</span>
        </button>
      )}

      {/* ── FEEDBACK SLOT ── */}
      {/* Unreadable-settings disclosure (spec §3.7, reviewer ruling B2): a DURABLE note, not a
          transient `feedback` kind — it persists for as long as this workspace stays loaded and is
          independent of whatever `feedback.kind` is currently showing. */}
      {unclaimedFields.length > 0 && (
        <div className="menu-note" role="status" data-ws-unclaimed>{t("wsUnclaimedNote")}</div>
      )}
      {/* Unsupported-panel disclosure (spec §3.7, reviewer ruling M5b): a SECOND durable note,
          independent of the one above — a workspace can have unclaimed FIELDS, unopenable WIDGETS,
          both, or neither, and each needs its own plain-word warning before the user saves over it. */}
      {unsupportedWidgets.length > 0 && (
        <div className="menu-note" role="status" data-ws-unsupported-panels>{t("wsUnclaimedPanels")}</div>
      )}
      {feedback.kind === "saved" && <div className="menu-note ok" role="status" data-layout-feedback="saved">{t("layoutSaved")}</div>}
      {feedback.kind === "renamed" && <div className="menu-note ok" role="status" data-layout-feedback="renamed">{t("wsRenamed")}</div>}
      {feedback.kind === "duplicated" && <div className="menu-note ok" role="status" data-layout-feedback="duplicated">{t("wsDuplicated")}</div>}
      {feedback.kind === "imported" && <div className="menu-note ok" role="status" data-layout-feedback="imported">{t("wsImported")}</div>}
      {feedback.kind === "error" && <div className="menu-note bad" role="alert" data-layout-feedback="error">{feedback.message}</div>}

      {/* name_conflict — inline error + the suggested free name as a one-tap action (freeze §11). */}
      {feedback.kind === "conflict" && (
        <div className="ws-suggest" role="alert" data-ws-conflict={feedback.op}>
          <span>{t("wsNameTaken")}</span>
          <button type="button" data-ws-use-suggested onClick={() => onUseSuggested(feedback.suggested)}>
            {`${t("wsUseSuggested")} “${feedback.suggested}”`}
          </button>
        </div>
      )}

      {/* stale_revision — THE SIGNATURE SURFACE. Two peers, no primary, no modal. */}
      {feedback.kind === "stale" && (
        <div className="ws-conflict" role="group" aria-labelledby="ws-stale-hd" data-ws-stale={feedback.name}>
          <b id="ws-stale-hd" role="alert">{t("wsChangedElsewhere")}</b>
          <p>{`${t("wsChangedElsewhereSub")} ${feedback.savedAgo}`}</p>
          <div className="ws-fork">
            <button type="button" data-ws-fork="reload" onClick={onReloadLatest}>{t("wsReloadLatest")}</button>
            <button type="button" data-ws-fork="copy" onClick={onSaveAsCopy}>{t("wsSaveAsCopy")}</button>
          </div>
        </div>
      )}

      {deleteError && <div className="menu-note bad" role="alert" data-layout-delete-error>{deleteError}</div>}

      {/* ── STATUS ROWS — `unavailable` renders ABOVE the last-good list, never instead of it. ── */}
      {status === "loading" && <div className="menu-row empty" data-layout-status="loading">{t("layoutsLoading")}</div>}
      {status === "unavailable" && (
        <div className="menu-note bad" role="alert" data-layout-status="unavailable">
          <span>{t("layoutsUnavailable")}</span>
          <button type="button" className="menu-note-retry" data-layout-retry onClick={onRetry}>{t("layoutRetry")}</button>
        </div>
      )}
      {status === "ready" && layouts.length === 0 && (
        <div className="menu-row empty" data-layout-status="empty">{t("noSavedLayouts")}</div>
      )}

      {/* ── ZONE 2 · LIBRARY ── */}
      {layouts.length > 0 && <div className="ws-hd">{t("wsSectionSaved")}</div>}
      <div className="ws-list" data-ws-list>
        {layouts.map((l) => {
          const blocked = l.rowState !== "ok";
          const open = openRow === l.id;
          return (
            <div key={l.id}
                 className={`ws-item${open ? " open" : ""}${blocked ? " blocked" : ""}${staleName === l.name ? " stale" : ""}`}
                 data-layout-row={l.name} data-ws-state={l.rowState}>

              {renamingId === l.id ? (
                <div className="ws-rename">
                  <input autoFocus value={draft} aria-label={t("rename")} data-ws-rename-input
                         onFocus={(e) => e.currentTarget.select()}
                         onChange={(e) => setDraft(e.target.value)}
                         onKeyDown={(e) => {
                           if (e.key === "Enter") { e.preventDefault(); commitRename(l); }
                           else if (e.key === "Escape") { e.stopPropagation(); cancelRename(); }
                         }}
                         onBlur={cancelRename} />
                  {/* mousedown-preventDefault is LOAD-BEARING: without it the input blurs (→ cancel)
                      before click fires, and the commit button can never be reached with a mouse. */}
                  <button type="button" aria-label={t("wsRenameSave")} data-ws-rename-commit
                          onMouseDown={(e) => e.preventDefault()} onClick={() => commitRename(l)}>
                    <svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6" /></svg>
                  </button>
                  <button type="button" aria-label={t("wsCancel")} data-ws-rename-cancel
                          onMouseDown={(e) => e.preventDefault()} onClick={cancelRename}>
                    <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
                  </button>
                </div>
              ) : (
                <Row type="button" {...(rowAs === "button" ? { role: "menuitem" } : {})}
                     className="menu-row" disabled={blocked}
                     onClick={blocked ? undefined : () => { onLoad(l); onPicked?.(); }}>
                  <span className="ws-name">{l.name}</span>
                  {l.rowState === "unsupported_floor" && <span className="ws-badge warn">{t("wsBadgeNewer")}</span>}
                  {l.rowState === "unsupported_schema" && <span className="ws-badge">{t("wsBadgeUnreadable")}</span>}
                  <span className="ws-more" role="button" tabIndex={0}
                        ref={(el) => { moreRefs.current[l.id] = el; }}
                        aria-label={`${t("wsRowActions")}: ${l.name}`}
                        aria-expanded={open} aria-controls={`ws-subs-${l.id}`}
                        data-ws-more={l.name}
                        onClick={(e) => { e.stopPropagation(); toggleRow(l.id); }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); toggleRow(l.id); }
                          else if (e.key === "Escape" && open) { e.stopPropagation(); closeRow(l.id); }
                        }}>
                    <svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>
                  </span>
                </Row>
              )}

              {/* Why a row is not openable — plain words, never hidden, never a code. */}
              {blocked && (
                <div className="ws-hint" data-ws-hint>
                  {l.rowState === "unsupported_floor" ? t("wsNeedsNewer") : t("wsCantOpen")}
                </div>
              )}

              {/* ── ACTIONS — an indented stack of ordinary .menu-row children. ── */}
              {open && (
                <div className="ws-subs" id={`ws-subs-${l.id}`} role="group" aria-label={l.name}
                     onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); closeRow(l.id); } }}>
                  {!blocked && <>
                    <button type="button" role="menuitem" className="menu-row" data-ws-act="open"
                            ref={(el) => { firstActionRefs.current[l.id] = el; }}
                            onClick={() => { onLoad(l); onPicked?.(); }}>
                      <svg viewBox="0 0 24 24"><path d="M4 5h16v14H4zM4 9h16M9 9v10" /></svg>{t("wsOpen")}
                    </button>
                    <button type="button" role="menuitem" className="menu-row" data-ws-act="rename"
                            onClick={() => { setDraft(l.name); setRenamingId(l.id); }}>
                      <svg viewBox="0 0 24 24"><path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3M13.5 6.5l3 3" /></svg>{t("rename")}
                    </button>
                    <button type="button" role="menuitem" className="menu-row" data-ws-act="duplicate"
                            onClick={() => onDuplicate(l)}>
                      <svg viewBox="0 0 24 24"><path d="M8 17H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v3M11 21h8a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2z" /></svg>{t("wsDuplicate")}
                    </button>
                  </>}
                  {/* Export survives on a blocked row: it is how the user rescues a payload this
                      build cannot open. The bytes are untouched (freeze §6). */}
                  <button type="button" role="menuitem" className="menu-row" data-ws-act="export"
                          ref={blocked ? (el) => { firstActionRefs.current[l.id] = el; } : undefined}
                          onClick={() => onExport(l)}>
                    <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>{t("wsExport")}
                  </button>
                  <button type="button" role="menuitem" className="menu-row danger" data-ws-act="delete"
                          onClick={() => onDelete(l.id)}>
                    <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>{t("delete")}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── ZONE 3 · BRING ONE IN ── */}
      <div className="ws-sep" />
      <button type="button" role="menuitem" className="menu-row ws-import" data-ws-import
              disabled={isGuest} onClick={onImport}>
        <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 8l5-5 5 5M12 3v12" /></svg>
        {t("wsImport")}
      </button>
    </>
  );
}
