"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useLang, useT } from "@/lib/i18n";
import { useSettings } from "@/components/settings/SettingsProvider";
import {
  CLAIM_COMPARATOR_WORDS,
  CLAIM_COMPARATORS,
  CLAIM_OWNERS,
  CLAIM_TEXT_MAX,
  THRESHOLD_MAX,
  clientClaimPayload,
  composeClaimText,
  resolvesAtBounds,
  type ClaimComparator,
} from "@/lib/claimAuthoring";
import styles from "./ClaimAuthoringForm.module.css";

type SavedCall = {
  claim_id: string;
  subject: { id?: string };
  condition: { comparator?: string; threshold?: number };
  resolves_at: string;
  stated_probability: number | null;
};

const ERROR_KEY: Record<string, string> = {
  invalid_symbol: "claimErrInvalidSymbol",
  invalid_owner: "claimErrInvalidOwner",
  invalid_comparator: "claimErrInvalidComparator",
  invalid_threshold: "claimErrInvalidThreshold",
  threshold_too_high: "claimErrThresholdTooHigh",
  invalid_resolves_at: "claimErrInvalidResolvesAt",
  invalid_probability: "claimErrInvalidProbability",
  claim_text_too_long: "claimErrTooLong",
  claim_text_empty: "claimErrTextEmpty",
  unauthenticated: "claimErrUnauthenticated",
  claim_not_recorded: "claimErrNotRecorded",
};

function isComparator(value: string): value is ClaimComparator {
  return (CLAIM_COMPARATORS as readonly string[]).includes(value);
}

export default function ClaimAuthoringForm({
  open,
  symbol,
  onClose,
}: {
  open: boolean;
  symbol: string;
  onClose: () => void;
}) {
  const t = useT();
  const { lang } = useLang();
  const settings = useSettings();
  const backdropRef = useRef<HTMLDivElement>(null);
  const [owner] = useState<string>(CLAIM_OWNERS[0].owner);
  const [comparator, setComparator] = useState("");
  const [threshold, setThreshold] = useState("");
  const [resolvesAt, setResolvesAt] = useState("");
  const [probabilityOptIn, setProbabilityOptIn] = useState(false);
  const [probabilityPercent, setProbabilityPercent] = useState(50);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [calls, setCalls] = useState<SavedCall[]>([]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const bounds = resolvesAtBounds(new Date());
  const ownerRow = CLAIM_OWNERS[0];
  const composed = useMemo(() => {
    if (!symbol || !isComparator(comparator) || !threshold) return "";
    const n = Number(threshold);
    if (!Number.isFinite(n)) return "";
    return composeClaimText({
      symbol,
      comparator,
      threshold: n,
      date: resolvesAt || bounds.min,
      note,
      lang,
    });
  }, [symbol, comparator, threshold, resolvesAt, note, lang, bounds.min]);
  const remaining = CLAIM_TEXT_MAX - (composed ? composed.length : 0);
  const thresholdOverMax = Number(threshold) > THRESHOLD_MAX;
  const budgetCopy = remaining < 0
    ? t("claimCharsOver").replace("{n}", String(-remaining))
    : remaining === 1
      ? t("claimCharsLeft1")
      : t("claimCharsLeft").replace("{n}", String(remaining));

  function resetFilled() {
    setComparator("");
    setThreshold("");
    setResolvesAt("");
    setProbabilityOptIn(false);
    setProbabilityPercent(50);
    setNote("");
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setErrorKey(null);
    setSaved(false);
    if (!symbol) { setErrorKey("claimErrInvalidSymbol"); return; }
    if (!isComparator(comparator)) { setErrorKey("claimErrInvalidComparator"); return; }
    const n = Number(threshold);
    if (!Number.isFinite(n) || n <= 0) { setErrorKey("claimErrInvalidThreshold"); return; }
    if (thresholdOverMax) return;
    if (!resolvesAt) { setErrorKey("claimErrInvalidResolvesAt"); return; }
    if (remaining < 0) { setErrorKey("claimErrTooLong"); return; }
    const payload = clientClaimPayload({
      symbol,
      owner,
      comparator,
      threshold: n,
      resolvesAtDate: resolvesAt,
      probabilityOptIn,
      probabilityPercent,
      note,
      lang,
    });
    setSaving(true);
    try {
      const res = await fetch("/api/accuracy/claims", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({})) as {
        ok?: boolean;
        error?: string;
        claim?: SavedCall;
      };
      if (res.status === 401) { setErrorKey("claimErrUnauthenticated"); return; }
      if (!res.ok || !body.ok || !body.claim) {
        setErrorKey(ERROR_KEY[body.error || ""] || "claimErrNotRecorded");
        return;
      }
      setCalls((prev) => [body.claim as SavedCall, ...prev]);
      setSaved(true);
      resetFilled();
    } catch {
      setErrorKey("claimErrNotRecorded");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className={styles.root}
      ref={backdropRef}
      onMouseDown={(event) => { if (event.target === backdropRef.current) onClose(); }}
    >
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="claim-authoring-title"
        data-testid="claim-authoring-form"
      >
        <header className={styles.header}>
          <div>
            <h2 id="claim-authoring-title">{t("claimModalTitle")}</h2>
            <p className={styles.sub}>{t("claimModalSub")}</p>
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label={t("claimClose")}>×</button>
        </header>
        <form className={styles.body} onSubmit={onSubmit}>
          <div className={styles.fields}>
            <label className={styles.row}>
              <span className={styles.chip}>{symbol || t("claimSymbolUnset")}</span>
            </label>
            <label className={styles.row}>
              {t("claimOwnerLabel")}
              <select value={owner} onChange={() => undefined} aria-label={t("claimOwnerLabel")}>
                <option value={ownerRow.owner}>{lang === "zh" ? ownerRow.labelZh : ownerRow.labelEn}</option>
              </select>
            </label>
            <label className={styles.row}>
              {t("claimComparatorLabel")}
              <select
                value={comparator}
                onChange={(event) => { setComparator(event.target.value); setErrorKey(null); }}
                aria-label={t("claimComparatorLabel")}
              >
                <option value="">{t("claimDirectionUnset")}</option>
                {CLAIM_COMPARATORS.map((value) => (
                  <option key={value} value={value}>{CLAIM_COMPARATOR_WORDS[lang][value]}</option>
                ))}
              </select>
            </label>
            <label className={styles.row}>
              {t("claimThresholdLabel")}
              <input
                type="number"
                step="0.01"
                value={threshold}
                onChange={(event) => { setThreshold(event.target.value); setErrorKey(null); }}
                aria-label={t("claimThresholdLabel")}
              />
              {thresholdOverMax && (
                <p className={styles.error} role="alert">{t("claimErrThresholdTooHigh")}</p>
              )}
            </label>
            <label className={styles.row}>
              {t("claimResolvesAtLabel")}
              <input
                type="date"
                min={bounds.min}
                max={bounds.max}
                value={resolvesAt}
                onChange={(event) => { setResolvesAt(event.target.value); setErrorKey(null); }}
                aria-label={t("claimResolvesAtLabel")}
              />
            </label>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={probabilityOptIn}
                onChange={(event) => setProbabilityOptIn(event.target.checked)}
              />
              {t("claimProbabilityToggle")}
            </label>
            {probabilityOptIn && (
              <label className={styles.row}>
                <span className={styles.rangeRow}>
                  <input
                    className={styles.range}
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={probabilityPercent}
                    onChange={(event) => setProbabilityPercent(Number(event.target.value))}
                  />
                  <span className={styles.rangeVal}>{probabilityPercent}%</span>
                </span>
              </label>
            )}
            <label className={styles.row}>
              {t("claimNoteLabel")}
              <textarea
                maxLength={CLAIM_TEXT_MAX}
                value={note}
                onChange={(event) => { setNote(event.target.value); setErrorKey(null); }}
                aria-label={t("claimNoteLabel")}
              />
              <span className={remaining < 0 ? styles.counterOver : styles.counter}>{budgetCopy}</span>
            </label>
          </div>
          {errorKey && <p className={styles.error} role="alert">{t(errorKey)}</p>}
          {saved && <p className={styles.saved}>{t("claimSaved")}</p>}
          <div className={styles.actions}>
            <button className={styles.submit} type="submit" disabled={saving || remaining < 0 || thresholdOverMax}>
              {saving ? t("claimSaving") : t("claimSubmit")}
            </button>
            <button
              className={styles.link}
              type="button"
              onClick={() => { settings.open("accuracy"); onClose(); }}
            >
              {t("claimGoToLedger")}
            </button>
          </div>
          {calls.length === 0 ? (
            <p className={styles.empty}>{t("claimListEmpty")}</p>
          ) : (
            <ul className={styles.list}>
              {calls.map((call) => {
                const cmp = typeof call.condition?.comparator === "string" && isComparator(call.condition.comparator)
                  ? call.condition.comparator
                  : null;
                const words = cmp ? CLAIM_COMPARATOR_WORDS[lang][cmp] : "";
                const date = String(call.resolves_at || "").slice(0, 10);
                const p = call.stated_probability;
                return (
                  <li key={call.claim_id} className={styles.card}>
                    <strong>{call.subject?.id || symbol}</strong>
                    <span>{words} {call.condition?.threshold}</span>
                    <time dateTime={call.resolves_at}>{date}</time>
                    {typeof p === "number" ? <span>{Math.round(p * 100)}%</span> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </form>
      </div>
    </div>
  );
}
