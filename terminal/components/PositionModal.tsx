"use client";
// Add / edit one portfolio position (W5).
//
// Shared by `/portfolio` and by the Terminal's "Add to → Portfolio" action, so a position entered
// from the chart and one entered from the book are the same object with the same rules. It is a
// form, not a feature: the interesting surface on this page is the book, so this stays quiet.
//
// Only TICKER is required. Shares, entry price, entry date and notes are all genuinely nullable in
// the schema, and an unsized position — a name you hold but have not filled in yet — is a state the
// product supports on purpose. The form says so instead of demanding numbers the user may not have
// to hand.
//
// Validation is the SERVER's (`lib/portfolio.ts` normalizers): the form refuses only the one thing
// it can know locally — an empty ticker — and renders whatever the route says it refused. Two
// validators drifting apart is how a field starts being rejected for a reason the UI cannot explain.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useT, useLang } from "@/lib/i18n";
import { moneyCopy } from "@/lib/portfolioMoney";
import type { Position } from "@/lib/portfolio";
import { portfolioCopy } from "@/lib/portfolioWorkspace";
import styles from "./PortfolioWorkspace.module.css";

export type PositionDraft = {
  clientPositionId?: string;
  ticker: string;
  shares: string;
  entryPrice: string;
  entryCurrency: string;
  entryDate: string;
  notes: string;
};

const draftFrom = (position: Position | null, initialTicker?: string): PositionDraft => ({
  ticker: position?.ticker ?? (initialTicker ? initialTicker.toUpperCase() : ""),
  shares: position?.shares == null ? "" : String(position.shares),
  entryPrice: position?.entryPrice == null ? "" : String(position.entryPrice),
  entryCurrency: position?.entryCurrency ?? "",
  entryDate: position?.entryDate ?? "",
  notes: position?.notes ?? "",
});

export default function PositionModal({
  mode,
  position,
  initialTicker,
  onCancel,
  onSubmit,
}: {
  mode: "add" | "edit";
  position: Position | null;
  initialTicker?: string;
  onCancel: () => void;
  onSubmit: (draft: PositionDraft) => Promise<boolean>;
}) {
  const t = useT();
  const { lang } = useLang();
  const titleId = useId();
  const copy = portfolioCopy(lang);
  const [draft, setDraft] = useState<PositionDraft>(() => draftFrom(position, initialTicker));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [initialDraft] = useState(() => draftFrom(position, initialTicker));
  const submittingRef = useRef(false);
  const createIntentRef = useRef<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const keepEditingRef = useRef<HTMLButtonElement>(null);
  const dirty = (Object.keys(draft) as (keyof PositionDraft)[]).some(key => draft[key] !== initialDraft[key]);

  const requestCancel = useCallback(() => {
    if (submittingRef.current) return;
    if (dirty) {
      setConfirmDiscard(true);
      requestAnimationFrame(() => keepEditingRef.current?.focus());
    } else onCancel();
  }, [dirty, onCancel]);

  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);

  // Focus the field the user is here to fill. When the ticker arrives pre-filled from the chart,
  // that is SHARES — retyping a symbol you just clicked is busywork.
  useEffect(() => {
    const field = initialTicker
      ? cardRef.current?.querySelector<HTMLInputElement>("input[name='shares']")
      : firstFieldRef.current;
    field?.focus();
    field?.select?.();
  }, [initialTicker]);

  const set = useCallback((key: keyof PositionDraft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
  }, []);

  const submit = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    if (submittingRef.current) return;
    const ticker = draft.ticker.trim();
    if (!ticker) { setError(t("tickerRequired")); firstFieldRef.current?.focus(); return; }
    setError(null);
    submittingRef.current = true;
    setSaving(true);
    setConfirmDiscard(false);
    try {
      if (mode === "add" && !createIntentRef.current) createIntentRef.current = crypto.randomUUID();
      const ok = await onSubmit({ ...draft, ticker,
        ...(mode === "add" && createIntentRef.current ? { clientPositionId: createIntentRef.current } : {}),
      });
      if (!ok) setError(portfolioCopy(lang)("saveUnconfirmed"));
    } catch {
      setError(portfolioCopy(lang)("saveUnconfirmed"));
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  }, [draft, mode, onSubmit, t, lang]);

  return (
    <dialog ref={dialogRef} className={styles.editDialog} aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); requestCancel(); }}
      onMouseDown={event => { if (event.target === event.currentTarget) requestCancel(); }}>
      <div className="pf-modal" ref={cardRef}>
        <form onSubmit={submit}>
          <div className="pf-modal-hd">
            <h3 id={titleId}>{mode === "edit" ? t("editPositionTitle") : t("addPositionTitle")}</h3>
            <button type="button" className="pf-modal-x" disabled={saving} onClick={requestCancel} aria-label={t("cancel")}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>

          <fieldset className="pf-modal-body" disabled={saving} style={{ border: 0, minWidth: 0, margin: 0 }}>
            <label className="pf-field">
              <span>{t("ticker")}</span>
              <input
                ref={firstFieldRef}
                name="ticker"
                value={draft.ticker}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => set("ticker", event.target.value.toUpperCase())}
                placeholder="NVDA"
              />
            </label>

            <div className="pf-field-row">
              <label className="pf-field">
                <span>{t("shares")}</span>
                <input
                  name="shares"
                  value={draft.shares}
                  inputMode="decimal"
                  autoComplete="off"
                  onChange={(event) => set("shares", event.target.value)}
                  placeholder={t("optional")}
                />
              </label>
              <label className="pf-field">
                <span>{t("entryPrice")}</span>
                <input
                  name="entryPrice"
                  value={draft.entryPrice}
                  inputMode="decimal"
                  autoComplete="off"
                  onChange={(event) => set("entryPrice", event.target.value)}
                  placeholder={t("optional")}
                />
              </label>
            </div>

            <label className="pf-field">
              <span>{moneyCopy.entryCurrency[lang]}</span>
              <input name="entryCurrency" value={draft.entryCurrency} autoComplete="off"
                spellCheck={false} placeholder={copy("entryCurrencyExample")} maxLength={3}
                onChange={(event) => set("entryCurrency", event.target.value)} />
              <small>{moneyCopy.entryCurrencyHint[lang]}</small>
            </label>

            <label className="pf-field">
              <span>{t("entryDate")}</span>
              <input
                name="entryDate"
                type="date"
                value={draft.entryDate}
                onChange={(event) => set("entryDate", event.target.value)}
              />
            </label>

            <label className="pf-field">
              <span>{t("positionNotes")}</span>
              <textarea
                name="notes"
                value={draft.notes}
                rows={3}
                onChange={(event) => set("notes", event.target.value)}
                placeholder={t("positionNotesPlaceholder")}
              />
            </label>

            <p className="pf-modal-hint">{t("unsizedHint")}</p>
            {error && <p className="pf-modal-err" role="alert">{error}</p>}
          </fieldset>

          <div className="pf-modal-ft">
            <button type="button" className="pf-btn" disabled={saving} onClick={requestCancel}>{t("cancel")}</button>
            <button type="submit" className="pf-btn primary" disabled={saving}>
              {saving ? t("savingPosition") : t("savePosition")}
            </button>
          </div>
        </form>
        {confirmDiscard && <section className={styles.discard} aria-labelledby={titleId + "-discard"} role="alert">
          <h4 id={titleId + "-discard"}>{copy("discardTitle")}</h4><p>{copy("discardHint")}</p>
          <div><button ref={keepEditingRef} type="button" className="pf-btn" onClick={() => { setConfirmDiscard(false); firstFieldRef.current?.focus(); }}>{copy("keepEditing")}</button>
            <button type="button" className={`pf-btn ${styles.danger}`} onClick={onCancel}>{copy("discard")}</button></div>
        </section>}
      </div>
    </dialog>
  );
}
