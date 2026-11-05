"use client";
// E07 — "Save study template". The dialog captures the chart's studies ONCE when it opens and saves
// exactly that capture, so the summary it shows is what is stored. It closes only after the store
// confirmed the write (the account route answered with the saved record, or the device store read
// its bytes back). Every failure stays on screen with "nothing was saved" — it never says Saved.
import { useMemo, useRef, useState } from "react";
import { saveDeviceTemplate } from "@/lib/chartTemplates";
import { STUDY_TEMPLATE_LIMITS, validateStudyTemplateWrite } from "@/lib/studyTemplateSchema";
import { createAccountTemplate, updateAccountTemplate, type AccountStudyTemplate } from "@/lib/studyTemplatesClient";
import type { StudyState } from "@/lib/studyInstances";
import { templateFromState } from "@/lib/studyTemplates";
import { useStudyTemplatesT } from "@/lib/studyTemplatesLex";
import { useDialogFocus } from "./useDialogFocus";
import { useEntryLabel, writeErrorText } from "./templateText";
import styles from "./studyTemplates.module.css";

export type SaveOutcome =
  | { destination: "account"; template: AccountStudyTemplate }
  | { destination: "device" };

type Overwrite = { source: "account"; id: string; revision: number } | { source: "device"; id: string };

type SaveError = { code: string; overwrite?: Overwrite };

export default function StudyTemplateSaveDialog({
  signedIn,
  studyState,
  onClose,
  onSaved,
  onFailedAfterClose,
}: {
  signedIn: boolean;
  studyState: StudyState;
  onClose: () => void;
  onSaved: (outcome: SaveOutcome) => void;
  /** A write still running when the dialog was closed failed: the host shows this message. */
  onFailedAfterClose: (message: string) => void;
}) {
  const t = useStudyTemplatesT();
  const label = useEntryLabel();
  const dialogRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(true);
  // Frozen at open: the summary below is exactly what a save stores.
  const [capture] = useState(() => templateFromState(studyState));
  const [name, setName] = useState("");
  const [destination, setDestination] = useState<"account" | "device">(signedIn ? "account" : "device");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SaveError | null>(null);
  const errorCode = error?.code; // the data-error test hook only; the visible text is writeErrorText

  const close = () => {
    openRef.current = false;
    onClose();
  };
  useDialogFocus(dialogRef, close);

  const count = capture.body.indicators.length;
  const excluded = useMemo(
    () => capture.excluded.map((entry) => label(entry.id, studyState.inds, studyState.indParams[entry.id])).join(", "),
    [capture, label, studyState],
  );

  const fail = (code: string, overwrite?: Overwrite) => {
    if (openRef.current) {
      setBusy(false);
      setError({ code, overwrite });
    } else {
      onFailedAfterClose(writeErrorText(t, code));
    }
  };

  const submit = async (overwrite?: Overwrite) => {
    if (busy) return;
    const valid = validateStudyTemplateWrite(name, capture.body);
    if (!valid.ok) {
      setError({ code: valid.problem });
      return;
    }
    setError(null);
    setBusy(true);
    if (destination === "account") {
      const result = overwrite?.source === "account"
        ? await updateAccountTemplate(overwrite.id, overwrite.revision, { name: valid.name, body: valid.body })
        : await createAccountTemplate(valid.name, valid.body);
      if (result.ok) {
        openRef.current = false;
        onSaved({ destination: "account", template: result.template });
        return;
      }
      const other = result.existing ?? result.current;
      const offer = (result.error === "name_taken" || (result.error === "conflict" && overwrite)) && other
        ? { source: "account" as const, id: other.id, revision: other.revision }
        : undefined;
      fail(result.error, offer);
      return;
    }
    const result = saveDeviceTemplate(valid.name, valid.body, overwrite?.source === "device" ? { overwriteId: overwrite.id } : {});
    if (result.ok) {
      openRef.current = false;
      onSaved({ destination: "device" });
      return;
    }
    fail(result.error, result.error === "name_taken" && result.existingId ? { source: "device", id: result.existingId } : undefined);
  };

  return (
    <div className="tmpl-modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div
        ref={dialogRef}
        className={`tmpl-modal ${styles.saveDialog}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="study-template-save-title"
        data-study-template-save=""
        tabIndex={-1}
      >
        <h3 id="study-template-save-title">{t("stplSaveTitle")}</h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className={styles.fieldLabel} htmlFor="study-template-name">{t("stplNameLabel")}</label>
          <input
            id="study-template-name"
            data-autofocus=""
            type="text"
            autoComplete="off"
            maxLength={STUDY_TEMPLATE_LIMITS.nameMax * 2}
            placeholder={t("stplNamePlaceholder")}
            value={name}
            disabled={busy}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "study-template-save-error" : undefined}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
          />
          <fieldset className={styles.destinations} disabled={busy}>
            <legend className={styles.fieldLabel}>{t("stplSaveTo")}</legend>
            {signedIn && (
              <label className={styles.radioRow}>
                <input
                  type="radio"
                  name="study-template-destination"
                  value="account"
                  checked={destination === "account"}
                  onChange={() => { setDestination("account"); setError(null); }}
                />
                <span>
                  <span className={styles.radioTitle}>{t("stplDestAccount")}</span>
                  <span className={styles.hint}>{t("stplDestAccountHint")}</span>
                </span>
              </label>
            )}
            <label className={styles.radioRow}>
              <input
                type="radio"
                name="study-template-destination"
                value="device"
                checked={destination === "device"}
                onChange={() => { setDestination("device"); setError(null); }}
              />
              <span>
                <span className={styles.radioTitle}>{t("stplDestDevice")}</span>
                <span className={styles.hint}>{t("stplDestDeviceHint")}</span>
              </span>
            </label>
            {!signedIn && <p className={styles.hint}>{t("stplGuestDeviceOnly")}</p>}
          </fieldset>
          <div className={styles.summary} data-capture-count={count}>
            <p>{count ? (count === 1 ? t("stplCaptureCountOne") : t("stplCaptureCount", { count })) : t("stplCaptureNothing")}</p>
            {excluded && <p className={styles.hint}>{t("stplCaptureExcluded", { list: excluded })}</p>}
            <p className={styles.hint}>{t("stplCaptureScope")}</p>
          </div>
          {error && (
            <div id="study-template-save-error" className={styles.error} role="alert" data-error={errorCode}>
              <span>{writeErrorText(t, error.code)}</span>
              {error.overwrite && (
                <button type="button" className="btn" disabled={busy} onClick={() => void submit(error.overwrite)}>
                  {t("stplReplaceExisting")}
                </button>
              )}
            </div>
          )}
          <div className="tmpl-btns">
            <button type="button" className="btn" onClick={close}>{t("stplCancel")}</button>
            <button type="submit" className="btn btn-primary" disabled={busy || !count} aria-busy={busy || undefined}>
              {busy ? t("stplSaving") : t("stplSave")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
