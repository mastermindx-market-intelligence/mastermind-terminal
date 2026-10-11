"use client";

// E05 — keeps a signed-in account's watchlist notes and flags in step across devices.
//
// Mounted by TerminalShell (lazily, signed-in only, keyed by the owner) inside the watchlist bar.
// It does not own the notes or flags: the shell keeps its two maps and their per-owner browser
// envelopes exactly as before, and every existing control (context-menu note editor, flag colours,
// bulk actions, list moves) keeps writing them. This component watches those maps, records edits
// in a per-owner ledger (`lib/watchlistAnnotationSync.ts`), sends them to
// `/api/watchlist/annotations`, and folds other devices' acknowledged edits back in — only ever on
// top of state this device had itself acknowledged.
//
// What the user sees is one status chip whose words are true at every moment: "synced" appears
// only after a successful read this session with nothing pending, in flight, conflicting or
// failed. A conflict opens a side-by-side chooser; guest notes from this browser are offered for an
// explicit, previewed import whose originals stay put until the account acknowledges them.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import styles from "./WatchlistAnnotationSync.module.css";
import { useAnnotationT } from "@/lib/watchlistAnnotationLex";
import { useLang } from "@/lib/i18n";
import { GUEST_OWNER, ownerUserId } from "@/lib/accountIdentity";
import { browserStorage } from "@/lib/ownerStorage";
import { readOwnerStringMap, writeOwnerStringMap, WL_FLAGS_KEY, WL_NOTES_KEY } from "@/lib/watchlistOwner";
import { ANNOTATION_OWNER_HEADER, parseAnnotationReadResponse, parseAnnotationWriteResponse, type AnnotationField } from "@/lib/watchlistAnnotations";
import {
  applyToMap,
  applyWriteResults,
  buildWriteBatches,
  clearImports,
  detectLocalEdits,
  dismissImport,
  emptyLedger,
  fieldKey,
  guestImportOffer,
  keepMine,
  ledgerCounts,
  readLedger,
  reconcileServer,
  recordImport,
  settledImports,
  splitKey,
  syncStatus,
  takeTheirs,
  writeLedger,
  type ImportItem,
  type LocalApply,
  type LocalMaps,
  type SyncLedger,
  type SyncSignals,
  type SyncStatus,
} from "@/lib/watchlistAnnotationSync";

const ENDPOINT = "/api/watchlist/annotations";
const WRITE_DEBOUNCE_MS = 600;
const BACKOFF_MS = [2_000, 5_000, 15_000, 30_000, 60_000];
const REFRESH_MIN_GAP_MS = 15_000;
const POLL_MS = 60_000;

type Props = {
  owner: string;
  /** The shell has restored this owner's maps from storage; before that they are not the user's. */
  ready: boolean;
  flags: Record<string, string>;
  notes: Record<string, string>;
  setFlags: Dispatch<SetStateAction<Record<string, string>>>;
  setNotes: Dispatch<SetStateAction<Record<string, string>>>;
};

const INITIAL_SIGNALS: SyncSignals = { readOk: false, readFailed: false, writeFailed: false, unavailable: false, unauthenticated: false, inFlight: false };

function readGuestMaps(): LocalMaps {
  const storage = browserStorage();
  if (!storage) return { flags: {}, notes: {} };
  return { flags: readOwnerStringMap(storage, WL_FLAGS_KEY, GUEST_OWNER), notes: readOwnerStringMap(storage, WL_NOTES_KEY, GUEST_OWNER) };
}

export default function WatchlistAnnotationSync({ owner, ready, flags, notes, setFlags, setNotes }: Props) {
  const t = useAnnotationT();
  const accountId = ownerUserId(owner);
  const storage = useMemo(() => browserStorage(), []);
  const [ledger, setLedger] = useState<SyncLedger>(() => (storage ? readLedger(storage, owner) : emptyLedger()));
  const ledgerRef = useRef(ledger);
  const mapsRef = useRef<LocalMaps>({ flags, notes });
  // Layout effects run before every passive effect below, so each of them sees this render's maps.
  useLayoutEffect(() => { mapsRef.current = { flags, notes }; }, [flags, notes]);
  const [signals, setSignals] = useState<SyncSignals>(INITIAL_SIGNALS);
  const signalsRef = useRef(signals);
  const [guest, setGuest] = useState<LocalMaps>(() => readGuestMaps());
  const [dialog, setDialog] = useState<"conflict" | "import" | null>(null);

  const aliveRef = useRef(true);
  const runningRef = useRef(false);
  const wantReadRef = useRef(false);
  const wantWriteRef = useRef(false);
  const attemptRef = useRef(0);
  const lastReadAtRef = useRef(0);
  const flushTimerRef = useRef<number | null>(null);
  const retryTimerRef = useRef<number | null>(null);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current);
      if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
    };
  }, []);

  const patchSignals = useCallback((patch: Partial<SyncSignals>) => {
    if (!aliveRef.current) return;
    const next = { ...signalsRef.current, ...patch };
    signalsRef.current = next;
    setSignals(next);
  }, []);

  const commit = useCallback((next: SyncLedger) => {
    if (!aliveRef.current || next === ledgerRef.current) return;
    ledgerRef.current = next;
    if (storage) writeLedger(storage, owner, next);
    setLedger(next);
    // The chooser closes itself once nothing is left to choose (resolved here or by a later read).
    if (!Object.keys(next.conflicts).length) setDialog((open) => (open === "conflict" ? null : open));
  }, [owner, storage]);

  /** Fold the latest maps into the ledger. Runs before every read/write so no edit is unaccounted for. */
  const syncLocal = useCallback(() => {
    commit(detectLocalEdits(ledgerRef.current, mapsRef.current));
  }, [commit]);

  const applyLocal = useCallback((applies: LocalApply[]) => {
    if (!applies.length || !aliveRef.current) return;
    const maps = mapsRef.current;
    const nextFlags = applyToMap(maps.flags, applies, "flag");
    const nextNotes = applyToMap(maps.notes, applies, "note");
    // Keep the ref ahead of React so a read/write that runs before the re-render does not mistake
    // the not-yet-rendered map for a local edit and send the old value back.
    mapsRef.current = { flags: nextFlags, notes: nextNotes };
    if (nextFlags !== maps.flags) setFlags((current) => applyToMap(current, applies, "flag"));
    if (nextNotes !== maps.notes) setNotes((current) => applyToMap(current, applies, "note"));
  }, [setFlags, setNotes]);

  // ── the single-flight pump ──
  const pumpRef = useRef<() => void>(() => {});

  const scheduleRetry = useCallback((kind: "read" | "write") => {
    if (!aliveRef.current) return;
    if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
    const delay = BACKOFF_MS[Math.min(attemptRef.current, BACKOFF_MS.length - 1)];
    attemptRef.current += 1;
    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null;
      if (kind === "read") wantReadRef.current = true;
      else wantWriteRef.current = true;
      pumpRef.current();
    }, delay);
  }, []);

  const doRead = useCallback(async () => {
    syncLocal();
    lastReadAtRef.current = Date.now();
    let response: Response;
    try {
      response = await fetch(ENDPOINT, { headers: { Accept: "application/json", [ANNOTATION_OWNER_HEADER]: accountId }, cache: "no-store", credentials: "same-origin" });
    } catch {
      patchSignals({ readFailed: true });
      scheduleRetry("read");
      return;
    }
    if (!aliveRef.current) return;
    // 401: no session. 409: the session is a DIFFERENT account than this page's owner. Either way
    // nothing is read into, or later sent from, this owner's ledger until the page is reloaded.
    if (response.status === 401 || response.status === 409) { patchSignals({ unauthenticated: true }); return; }
    if (response.status === 503) { patchSignals({ unavailable: true, readFailed: false }); return; }
    const body = response.ok ? parseAnnotationReadResponse(await response.json().catch(() => null)) : null;
    if (!aliveRef.current) return;
    if (!body) {
      // A failed read is not an empty account: nothing local changes, the chip says so.
      patchSignals({ readFailed: true });
      scheduleRetry("read");
      return;
    }
    syncLocal();
    const { ledger: next, applies } = reconcileServer(ledgerRef.current, body.annotations, body.complete);
    commit(next);
    applyLocal(applies);
    attemptRef.current = 0;
    patchSignals({ readOk: true, readFailed: false, unavailable: false, unauthenticated: false });
    if (buildWriteBatches(ledgerRef.current).length) wantWriteRef.current = true;
  }, [accountId, applyLocal, commit, patchSignals, scheduleRetry, syncLocal]);

  const doWrite = useCallback(async () => {
    syncLocal();
    if (!signalsRef.current.readOk) { wantReadRef.current = true; return; }
    if (signalsRef.current.unavailable || signalsRef.current.unauthenticated) return;
    const batches = buildWriteBatches(ledgerRef.current);
    if (!batches.length) { patchSignals({ writeFailed: false }); return; }
    let failed = false;
    for (const batch of batches) {
      let response: Response;
      try {
        response = await fetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json", [ANNOTATION_OWNER_HEADER]: accountId },
          credentials: "same-origin",
          body: JSON.stringify({ writes: batch }),
        });
      } catch {
        failed = true;
        break;
      }
      if (!aliveRef.current) return;
      if (response.status === 401 || response.status === 409) { patchSignals({ unauthenticated: true }); return; }
      if (response.status === 503) { patchSignals({ unavailable: true }); return; }
      const results = parseAnnotationWriteResponse(await response.json().catch(() => null));
      if (!aliveRef.current) return;
      if (results) {
        syncLocal();
        commit(applyWriteResults(ledgerRef.current, batch, results));
      }
      if (!response.ok || !results || results.some((result) => result.status === "error")) {
        failed = true;
        break;
      }
    }
    if (failed) {
      patchSignals({ writeFailed: true });
      scheduleRetry("write");
      return;
    }
    attemptRef.current = 0;
    patchSignals({ writeFailed: false });
    // Edits made while this POST was on the wire are pending now; send them too.
    if (buildWriteBatches(ledgerRef.current).length) wantWriteRef.current = true;
  }, [accountId, commit, patchSignals, scheduleRetry, syncLocal]);

  const pump = useCallback(async () => {
    if (runningRef.current || !aliveRef.current) return;
    runningRef.current = true;
    patchSignals({ inFlight: true });
    try {
      while (aliveRef.current && (wantReadRef.current || wantWriteRef.current)) {
        if (wantReadRef.current) {
          wantReadRef.current = false;
          await doRead();
        } else {
          wantWriteRef.current = false;
          await doWrite();
        }
      }
    } finally {
      runningRef.current = false;
      patchSignals({ inFlight: false });
    }
  }, [doRead, doWrite, patchSignals]);
  useLayoutEffect(() => { pumpRef.current = () => { void pump(); }; }, [pump]);

  const requestRead = useCallback(() => { wantReadRef.current = true; pumpRef.current(); }, []);
  const requestWrite = useCallback(() => { wantWriteRef.current = true; pumpRef.current(); }, []);

  // First read once the shell has restored this owner's maps.
  useEffect(() => {
    if (ready) requestRead();
  }, [ready, requestRead]);

  // Every change to the shell's maps is folded into the ledger at once (so the chip stops saying
  // "synced" immediately) and sent after a short pause.
  useEffect(() => {
    if (!ready) return;
    syncLocal();
    if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current);
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      if (buildWriteBatches(ledgerRef.current).length) requestWrite();
    }, WRITE_DEBOUNCE_MS);
  }, [flags, notes, ready, requestWrite, syncLocal]);

  // Other devices' edits arrive when this tab comes back, the network returns, or once a minute.
  useEffect(() => {
    if (!ready) return;
    const refresh = (force: boolean) => {
      if (document.visibilityState !== "visible") return;
      if (!force && Date.now() - lastReadAtRef.current < REFRESH_MIN_GAP_MS) return;
      requestRead();
    };
    const onVisible = () => refresh(false);
    const onOnline = () => refresh(true);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    const poll = window.setInterval(() => refresh(false), POLL_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      window.clearInterval(poll);
    };
  }, [ready, requestRead]);

  // Retire acknowledged imports: the guest original goes only once the account holds exactly it.
  useEffect(() => {
    if (!storage || !ready) return;
    // An import just accepted is in the maps but maybe not yet in the ledger: fold it in first, so
    // it reads as pending (kept) rather than as settled on some other value (forgotten).
    syncLocal();
    const live = ledgerRef.current;
    const { retire, forget } = settledImports(live);
    if (!retire.length && !forget.length) return;
    const current = readGuestMaps();
    let changed = false;
    for (const field of ["flag", "note"] as AnnotationField[]) {
      const items = retire.filter((item) => item.field === field);
      if (!items.length) continue;
      const map = { ...(field === "flag" ? current.flags : current.notes) };
      let fieldChanged = false;
      for (const item of items) {
        if (map[item.symbol] === item.value) { delete map[item.symbol]; fieldChanged = true; }
      }
      if (fieldChanged) {
        writeOwnerStringMap(storage, field === "flag" ? WL_FLAGS_KEY : WL_NOTES_KEY, GUEST_OWNER, map);
        changed = true;
      }
    }
    commit(clearImports(live, [...retire.map((item) => fieldKey(item.symbol, item.field)), ...forget]));
    if (changed) setGuest(readGuestMaps());
  }, [commit, ledger, ready, storage, syncLocal]);

  const status: SyncStatus = syncStatus(ledger, signals);
  const offer = useMemo(() => guestImportOffer(guest, { flags, notes }, ledger), [flags, guest, ledger, notes]);
  const importOffered = signals.readOk && offer.items.length > 0 && ledger.importDismissed !== offer.fingerprint;
  const counts = ledgerCounts(ledger);
  const hasAnnotations = Object.keys(flags).length > 0 || Object.keys(notes).length > 0 || counts.pending > 0;

  const conflictKeys = useMemo(() => Object.keys(ledger.conflicts).sort(), [ledger]);

  const resolveMine = useCallback((key: string) => {
    commit(keepMine(ledgerRef.current, key));
    requestWrite();
  }, [commit, requestWrite]);

  const resolveTheirs = useCallback((key: string) => {
    const { ledger: next, apply } = takeTheirs(ledgerRef.current, key);
    commit(next);
    if (apply) applyLocal([apply]);
  }, [applyLocal, commit]);

  const acceptImport = useCallback((items: ImportItem[]) => {
    commit(recordImport(ledgerRef.current, items));
    const addAbsent = (field: AnnotationField) => (current: Record<string, string>) => {
      let next: Record<string, string> | null = null;
      for (const item of items) {
        if (item.field !== field || current[item.symbol]) continue;
        next ??= { ...current };
        next[item.symbol] = item.value;
      }
      return next ?? current;
    };
    setFlags(addAbsent("flag"));
    setNotes(addAbsent("note"));
    setDialog(null);
  }, [commit, setFlags, setNotes]);

  const declineImport = useCallback(() => {
    commit(dismissImport(ledgerRef.current, offer.fingerprint));
    setDialog(null);
  }, [commit, offer.fingerprint]);

  const retryNow = useCallback(() => {
    if (retryTimerRef.current !== null) { window.clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
    attemptRef.current = 0;
    patchSignals({ unauthenticated: false, unavailable: false });
    requestRead();
  }, [patchSignals, requestRead]);

  const quiet = status.kind === "synced" || status.kind === "checking" || status.kind === "saving" || status.kind === "unavailable";
  if (!importOffered && quiet && !hasAnnotations) return null;

  const chip = chipFor(status, t);
  const actionable = status.kind === "conflict" || status.kind === "retrying" || status.kind === "readFailed";

  return (
    <>
      <span className={styles.wrap} role="status" aria-live="polite">
        {actionable ? (
          <button
            type="button"
            className={`${styles.chip} ${styles[chip.tone]}`}
            data-testid="wl-annotation-sync"
            data-sync-state={status.kind}
            title={chip.long}
            aria-label={chip.long}
            onClick={(event) => { event.stopPropagation(); if (status.kind === "conflict") setDialog("conflict"); else retryNow(); }}
          >
            <span className={styles.dot} aria-hidden="true" />
            <span className={styles.label}>{chip.short}</span>
          </button>
        ) : (
          <span
            className={`${styles.chip} ${styles[chip.tone]}${importOffered && status.kind === "synced" ? ` ${styles.compact}` : ""}`}
            data-testid="wl-annotation-sync"
            data-sync-state={status.kind}
            title={chip.long}
            aria-label={chip.long}
          >
            <span className={styles.dot} aria-hidden="true" />
            <span className={styles.label}>{chip.short}</span>
          </span>
        )}
        {importOffered && (
          <button
            type="button"
            className={`${styles.chip} ${styles.info}`}
            data-testid="wl-annotation-import"
            title={t("wasImportOffer", offer.items.length)}
            onClick={(event) => { event.stopPropagation(); setDialog("import"); }}
          >
            <span className={styles.label}>{t("wasImportShort", offer.items.length)}</span>
          </button>
        )}
      </span>
      {dialog === "conflict" && conflictKeys.length > 0 && (
        <ConflictDialog
          ledger={ledger}
          conflictKey={conflictKeys[0]}
          remaining={conflictKeys.length}
          onMine={resolveMine}
          onTheirs={resolveTheirs}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "import" && (
        <ImportDialog items={offer.items} collisions={offer.collisions} onImport={acceptImport} onLater={declineImport} onClose={() => setDialog(null)} />
      )}
    </>
  );
}

type Tone = "ok" | "busy" | "warn" | "bad" | "info";

function chipFor(status: SyncStatus, t: (key: string, n?: number) => string): { short: string; long: string; tone: Tone } {
  switch (status.kind) {
    case "synced": return { short: t("wasSyncedShort"), long: t("wasSynced"), tone: "ok" };
    case "saving": return { short: t("wasSavingShort"), long: t("wasSaving"), tone: "busy" };
    case "checking": return { short: t("wasCheckingShort"), long: t("wasChecking"), tone: "busy" };
    case "retrying": return { short: t("wasRetryingShort", status.count), long: `${t("wasRetrying", status.count)} — ${t("wasRetryNow")}`, tone: "bad" };
    case "conflict": return { short: t("wasConflictShort", status.count), long: t("wasConflict", status.count), tone: "warn" };
    case "unavailable": return { short: t("wasUnavailableShort"), long: t("wasUnavailable"), tone: "warn" };
    case "auth": return { short: t("wasAuthShort"), long: t("wasAuth"), tone: "warn" };
    case "readFailed": return { short: t("wasReadFailedShort"), long: `${t("wasReadFailed")} — ${t("wasRetryNow")}`, tone: "bad" };
    case "rejected": return { short: t("wasRejectedShort", status.count), long: t("wasRejected", status.count), tone: "warn" };
  }
}

function useDialogKeys(onClose: () => void) {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    rootRef.current?.querySelector<HTMLElement>("button[data-autofocus]")?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [onClose]);
  return rootRef;
}

function FieldValue({ field, value }: { field: AnnotationField; value: string | null }) {
  const t = useAnnotationT();
  if (value === null) return <span className={styles.empty}>{t("wasCleared")}</span>;
  if (field === "flag") {
    return <span className={styles.flagValue}><span className={styles.swatch} style={{ background: value }} aria-hidden="true" />{value}</span>;
  }
  return <span className={styles.noteValue}>{value}</span>;
}

function ConflictDialog({ ledger, conflictKey, remaining, onMine, onTheirs, onClose }: {
  ledger: SyncLedger;
  conflictKey: string;
  remaining: number;
  onMine: (key: string) => void;
  onTheirs: (key: string) => void;
  onClose: () => void;
}) {
  const t = useAnnotationT();
  const { lang } = useLang();
  const rootRef = useDialogKeys(onClose);
  const conflict = ledger.conflicts[conflictKey];
  const parts = splitKey(conflictKey);
  if (!conflict || !parts) return null;
  const when = conflict.theirsAt ? new Date(conflict.theirsAt) : null;
  return createPortal(
    <div className={styles.scrim} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={rootRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="wl-annotation-conflict-title" data-testid="wl-annotation-conflict">
        <div className={styles.head}>
          <h2 id="wl-annotation-conflict-title">{t("wasConflictTitle")}</h2>
          <span className={styles.count}>{t("wasConflictCount", remaining)}</span>
        </div>
        <p className={styles.intro}>{t("wasConflictIntro")}</p>
        <div className={styles.target}><b>{parts.symbol}</b><span>{t(parts.field === "note" ? "wasNote" : "wasFlag")}</span></div>
        <div className={styles.compare}>
          <section className={styles.side} data-testid="wl-annotation-conflict-mine">
            <h3>{t("wasThisDevice")}</h3>
            <FieldValue field={parts.field} value={conflict.mine} />
          </section>
          <section className={styles.side} data-testid="wl-annotation-conflict-theirs">
            <h3>{t("wasOtherDevice")}{when && !Number.isNaN(when.getTime()) ? <time dateTime={conflict.theirsAt ?? undefined}>{when.toLocaleString(lang === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium", timeStyle: "short" })}</time> : null}</h3>
            <FieldValue field={parts.field} value={conflict.theirs} />
          </section>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={onClose}>{t("wasClose")}</button>
          <button type="button" className={styles.secondary} onClick={() => onTheirs(conflictKey)}>{t("wasUseTheirs")}</button>
          <button type="button" className={styles.primary} data-autofocus onClick={() => onMine(conflictKey)}>{t("wasKeepMine")}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ImportDialog({ items, collisions, onImport, onLater, onClose }: {
  items: ImportItem[];
  collisions: (ImportItem & { accountValue: string })[];
  onImport: (items: ImportItem[]) => void;
  onLater: () => void;
  onClose: () => void;
}) {
  const t = useAnnotationT();
  const rootRef = useDialogKeys(onClose);
  return createPortal(
    <div className={styles.scrim} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={rootRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="wl-annotation-import-title" data-testid="wl-annotation-import-dialog">
        <div className={styles.head}><h2 id="wl-annotation-import-title">{t("wasImportTitle")}</h2></div>
        <p className={styles.intro}>{t("wasImportIntro")}</p>
        <ul className={styles.items} data-testid="wl-annotation-import-items">
          {items.map((item) => (
            <li key={`${item.symbol}|${item.field}`}>
              <b>{item.symbol}</b>
              <span className={styles.kind}>{t(item.field === "note" ? "wasNote" : "wasFlag")}</span>
              <FieldValue field={item.field} value={item.value} />
            </li>
          ))}
        </ul>
        {collisions.length > 0 && <>
          <p className={styles.intro}>{t("wasImportCollisions")}</p>
          <ul className={styles.items} data-testid="wl-annotation-import-collisions">
            {collisions.map((item) => (
              <li key={`${item.symbol}|${item.field}`}>
                <b>{item.symbol}</b>
                <span className={styles.kind}>{t(item.field === "note" ? "wasNote" : "wasFlag")}</span>
                <span className={styles.pair}>
                  <span><i>{t("wasGuestValue")}</i><FieldValue field={item.field} value={item.value} /></span>
                  <span><i>{t("wasAccountValue")}</i><FieldValue field={item.field} value={item.accountValue} /></span>
                </span>
              </li>
            ))}
          </ul>
        </>}
        <p className={styles.note}>{t("wasImportOriginals")}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={onLater}>{t("wasImportLater")}</button>
          <button type="button" className={styles.primary} data-autofocus onClick={() => onImport(items)}>{t("wasImportConfirm", items.length)}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
