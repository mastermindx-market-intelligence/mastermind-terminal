"use client";
// E07 — the study-template library: account templates and this device's templates, an exact
// preview of what applying one changes, and explicit Replace / Add-to-chart modes.
//
// Preview == applied: the plan shown is computed once per (template revision, mode) from the chart
// as it was, and Apply hands exactly `plan.next` to the chart owner. If the chart's studies changed
// after the preview was built, Apply refuses, rebuilds the preview and says so — it never applies a
// result the user did not see. A template only carries studies, so everything else on the chart
// (symbol, drawings, compare overlays, scripts, watchlists, alerts, data settings, Day Trade Mode)
// is outside its reach by construction; the notice states that.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  deleteDeviceTemplate,
  readDeviceTemplates,
  renameDeviceTemplate,
  type DeviceStudyTemplate,
  type DeviceTemplatesRead,
} from "@/lib/chartTemplates";
import { STUDY_TEMPLATE_LIMITS, STUDY_TEMPLATE_VERSION, studyTemplateBodyOf } from "@/lib/studyTemplateSchema";
import {
  createAccountTemplate,
  deleteAccountTemplate,
  updateAccountTemplate,
  type AccountStudyTemplate,
} from "@/lib/studyTemplatesClient";
import type { StudyState } from "@/lib/studyInstances";
import {
  planStudyTemplateApply,
  studyFieldLabel,
  studyStateFingerprint,
  studyTemplateSummary,
  type StudyTemplateMode,
  type StudyTemplatePlan,
  type StudyTripleOut,
} from "@/lib/studyTemplates";
import { useStudyTemplatesT } from "@/lib/studyTemplatesLex";
import { useDialogFocus } from "./useDialogFocus";
import { entryLabel, reasonText, writeErrorText } from "./templateText";
import type { AccountTemplatesState, ResolvedTemplate, TemplatePlanContext, TemplateRef } from "./types";
import styles from "./studyTemplates.module.css";

type ActionError = { code: string; op: "save" | "rename" | "delete"; reload?: boolean };

type Props = {
  account: AccountTemplatesState;
  studyState: StudyState;
  planContext: TemplatePlanContext;
  initialSelection: TemplateRef | null;
  onClose: () => void;
  onReloadAccount: () => void;
  onAccountChanged: (update: (list: AccountStudyTemplate[]) => AccountStudyTemplate[]) => void;
  onApply: (next: StudyTripleOut) => void;
  onSaveCurrent: () => void;
  onToast: (key: string) => void;
};

function resolve(ref: TemplateRef | null, account: AccountTemplatesState, device: DeviceTemplatesRead): ResolvedTemplate | null {
  if (!ref) return null;
  if (ref.source === "account") {
    const template = account.status === "ok" ? account.templates.find((entry) => entry.id === ref.id) : undefined;
    return template ? { source: "account", template } : null;
  }
  const template = device.status === "ok" ? device.templates.find((entry) => entry.id === ref.id) : undefined;
  return template ? { source: "device", template } : null;
}

const copyName = (name: string, attempt: number) => {
  if (attempt === 1) return name;
  const suffix = ` (${attempt})`;
  return name.slice(0, STUDY_TEMPLATE_LIMITS.nameMax - suffix.length).trimEnd() + suffix;
};

export default function StudyTemplateLibraryDialog({
  account,
  studyState,
  planContext,
  initialSelection,
  onClose,
  onReloadAccount,
  onAccountChanged,
  onApply,
  onSaveCurrent,
  onToast,
}: Props) {
  const t = useStudyTemplatesT();
  const dialogRef = useRef<HTMLDivElement>(null);
  const studyRef = useRef(studyState);
  studyRef.current = studyState;
  const [device, setDevice] = useState<DeviceTemplatesRead>(() => readDeviceTemplates());
  const [selection, setSelection] = useState<TemplateRef | null>(initialSelection);
  const [view, setView] = useState<"list" | "preview">(initialSelection ? "preview" : "list");
  const [mode, setMode] = useState<StudyTemplateMode>("replace");
  const [planNonce, setPlanNonce] = useState(0);
  const [chartChanged, setChartChanged] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<ActionError | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  useDialogFocus(dialogRef, onClose);

  const refreshDevice = useCallback(() => setDevice(readDeviceTemplates()), []);
  const selected = resolve(selection, account, device);
  const selectedKey = selected ? `${selected.source}:${selected.template.id}:${selected.template.revision}` : "";

  const plan: StudyTemplatePlan | null = useMemo(() => {
    if (!selected) return null;
    return planStudyTemplateApply(studyRef.current, studyTemplateBodyOf(selected.template), mode, {
      guestLimit: planContext.guestLimit,
      userTier: planContext.userTier,
    });
    // Frozen per template revision + mode (+ an explicit rebuild); never silently re-planned.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, mode, planNonce, planContext.guestLimit, planContext.userTier]);

  const resetRowState = () => {
    setRenaming(null);
    setConfirmDelete(false);
    setActionError(null);
    setChartChanged(false);
  };

  const choose = (ref: TemplateRef) => {
    setSelection(ref);
    setView("preview");
    resetRowState();
    setPlanNonce((n) => n + 1);
  };

  const apply = () => {
    if (!plan || plan.noop || busy) return;
    if (studyStateFingerprint(studyRef.current) !== plan.baseFingerprint) {
      setChartChanged(true);
      setPlanNonce((n) => n + 1);
      return;
    }
    onApply(plan.next);
  };

  // --- row actions ---------------------------------------------------------------------------

  const rename = async (name: string) => {
    if (!selected || busy) return;
    setActionError(null);
    if (selected.source === "device") {
      const result = renameDeviceTemplate(selected.template.id, name);
      refreshDevice();
      if (!result.ok) {
        setActionError({ code: result.error, op: "rename" });
        return;
      }
      setRenaming(null);
      onToast("stplToastRenamed");
      return;
    }
    setBusy(true);
    const result = await updateAccountTemplate(selected.template.id, selected.template.revision, { name });
    if (!mounted.current) return;
    setBusy(false);
    if (!result.ok) {
      if (result.error === "conflict" && result.current) {
        const current = result.current;
        onAccountChanged((list) => list.map((entry) => (entry.id === current.id ? current : entry)));
      }
      setActionError({ code: result.error, op: "rename", reload: result.error === "conflict" || result.error === "not_found" });
      return;
    }
    const saved = result.template;
    onAccountChanged((list) => list.map((entry) => (entry.id === saved.id ? saved : entry)));
    setRenaming(null);
    onToast("stplToastRenamed");
  };

  const remove = async () => {
    if (!selected || busy) return;
    setActionError(null);
    if (selected.source === "device") {
      const result = deleteDeviceTemplate(selected.template.id);
      refreshDevice();
      if (!result.ok) {
        setActionError({ code: result.error, op: "delete" });
        return;
      }
      setSelection(null);
      setView("list");
      resetRowState();
      onToast("stplToastDeleted");
      return;
    }
    setBusy(true);
    const id = selected.template.id;
    const result = await deleteAccountTemplate(id, selected.template.revision);
    if (!mounted.current) return;
    setBusy(false);
    if (!result.ok) {
      if (result.error === "conflict" && result.current) {
        const current = result.current;
        onAccountChanged((list) => list.map((entry) => (entry.id === current.id ? current : entry)));
      }
      setConfirmDelete(false);
      setActionError({ code: result.error, op: "delete", reload: result.error === "conflict" || result.error === "not_found" });
      return;
    }
    onAccountChanged((list) => list.filter((entry) => entry.id !== id));
    setSelection(null);
    setView("list");
    resetRowState();
    onToast("stplToastDeleted");
  };

  /** Explicit, per-template adoption of a device template into the signed-in account. */
  const copyToAccount = async (template: DeviceStudyTemplate) => {
    if (busy) return;
    setActionError(null);
    setBusy(true);
    const body = studyTemplateBodyOf(template);
    let result = await createAccountTemplate(copyName(template.name, 1), body);
    for (let attempt = 2; !result.ok && result.error === "name_taken" && attempt <= 9; attempt++) {
      result = await createAccountTemplate(copyName(template.name, attempt), body);
    }
    if (!mounted.current) return;
    setBusy(false);
    if (!result.ok) {
      setActionError({ code: result.error, op: "save" });
      return;
    }
    const saved = result.template;
    onAccountChanged((list) => [saved, ...list.filter((entry) => entry.id !== saved.id)]);
    onToast("stplToastCopied");
  };

  // --- rendering -----------------------------------------------------------------------------

  const rowStudies = (count: number) => (count === 1 ? t("stplRowStudiesOne") : t("stplRowStudies", { count }));

  const renderRow = (source: "account" | "device", template: AccountStudyTemplate | DeviceStudyTemplate) => {
    const active = selection?.source === source && selection.id === template.id;
    const summary = studyTemplateSummary(template);
    return (
      <li key={`${source}:${template.id}`}>
        <button
          type="button"
          className={styles.row}
          aria-current={active ? "true" : undefined}
          data-template-row={source}
          data-template-id={template.id}
          onClick={() => choose({ source, id: template.id })}
        >
          <span className={styles.rowName}>{template.name}</span>
          <span className={styles.rowMeta}>
            {rowStudies(summary.studies + summary.unknown)}
            {template.newer && <span className={styles.badge}>{t("stplRowNewer")}</span>}
            {!template.newer && template.v < STUDY_TEMPLATE_VERSION && <span className={styles.badge}>{t("stplRowLegacy")}</span>}
          </span>
        </button>
      </li>
    );
  };

  const accountSection = () => {
    let content: ReactNode;
    if (account.status === "guest" || account.status === "signed_out") {
      content = <p className={styles.note}>{t("stplAccountSignedOut")}</p>;
    } else if (account.status === "loading") {
      content = <p className={styles.note} role="status">{t("stplLoading")}</p>;
    } else if (account.status === "unavailable") {
      content = (
        <div className={styles.noteRow} data-account-state="unavailable">
          <p className={styles.note}>{t("stplAccountUnavailable")}</p>
          <button type="button" className="btn btn-ghost" onClick={onReloadAccount}>{t("stplRetry")}</button>
        </div>
      );
    } else {
      content = (
        <>
          {account.templates.length
            ? <ul className={styles.list}>{account.templates.map((template) => renderRow("account", template))}</ul>
            : <p className={styles.note}>{t("stplAccountEmpty")}</p>}
          {account.unreadable > 0 && <p className={styles.note}>{t("stplUnreadableCount", { count: account.unreadable })}</p>}
          {account.truncated && <p className={styles.note}>{t("stplTruncated")}</p>}
        </>
      );
    }
    return (
      <section className={styles.section} aria-labelledby="study-template-account-heading" data-account-state={account.status}>
        <h4 id="study-template-account-heading" className={styles.sectionTitle}>{t("stplSectionAccount")}</h4>
        {content}
      </section>
    );
  };

  const deviceSection = () => {
    let content: ReactNode;
    if (device.status === "unavailable") {
      content = <p className={styles.note}>{device.reason === "storage_blocked" ? t("stplDeviceBlocked") : t("stplDeviceUnreadable")}</p>;
    } else {
      content = (
        <>
          {device.templates.length
            ? <ul className={styles.list}>{device.templates.map((template) => renderRow("device", template))}</ul>
            : <p className={styles.note}>{t("stplDeviceEmpty")}</p>}
          {device.unreadable > 0 && <p className={styles.note}>{t("stplUnreadableCount", { count: device.unreadable })}</p>}
        </>
      );
    }
    return (
      <section
        className={styles.section}
        aria-labelledby="study-template-device-heading"
        data-device-state={device.status === "ok" ? "ok" : device.reason}
      >
        <h4 id="study-template-device-heading" className={styles.sectionTitle}>{t("stplSectionDevice")}</h4>
        {content}
      </section>
    );
  };

  const currentIds = studyRef.current.inds;
  const currentParams = studyRef.current.indParams;

  const previewPane = () => {
    if (!selected || !plan) {
      return <p className={styles.note}>{t("stplPickTemplate")}</p>;
    }
    const template = selected.template;
    const nextIds = plan.next.inds;
    const labelNext = (id: string) => entryLabel(t, id, nextIds, plan.next.indParams[id]);
    const labelCurrent = (id: string) => entryLabel(t, id, currentIds, currentParams[id]);
    const changeText = (change: StudyTemplatePlan["changed"][number]) => {
      const parts = change.fields.map((field) => studyFieldLabel(change.id, field)).filter((part): part is string => !!part);
      const unnamed = change.otherFields + (change.fields.length - parts.length);
      if (unnamed) parts.push(unnamed === 1 ? t("stplChangeOtherOne") : t("stplChangeOther", { count: unnamed }));
      if (change.visibility) parts.push(t("stplChangeVisibility"));
      return parts.join(", ");
    };
    const planAttr = JSON.stringify({
      mode: plan.mode,
      added: plan.added,
      removed: plan.removed,
      changed: plan.changed.map((change) => change.id),
      unchanged: plan.unchanged,
      skipped: plan.skipped,
      next: plan.next,
      noop: plan.noop,
      baseFingerprint: plan.baseFingerprint,
      nextFingerprint: plan.nextFingerprint,
    });
    const canCopy = selected.source === "device" && account.status === "ok";
    const writable = !template.newer;
    return (
      <div className={styles.preview} data-plan={planAttr} data-template-source={selected.source}>
        <div className={styles.previewHead}>
          {renaming !== null ? (
            <form
              className={styles.renameForm}
              onSubmit={(e) => {
                e.preventDefault();
                void rename(renaming);
              }}
            >
              <label className={styles.fieldLabel} htmlFor="study-template-rename">{t("stplNameLabel")}</label>
              <input
                id="study-template-rename"
                type="text"
                autoComplete="off"
                value={renaming}
                disabled={busy}
                autoFocus
                data-escape-local=""
                maxLength={STUDY_TEMPLATE_LIMITS.nameMax * 2}
                onChange={(e) => { setRenaming(e.target.value); setActionError(null); }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setRenaming(null);
                    setActionError(null);
                  }
                }}
              />
              <div className={styles.inlineBtns}>
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => { setRenaming(null); setActionError(null); }}>{t("stplCancel")}</button>
                <button type="submit" className="btn btn-primary" disabled={busy}>{t("stplRenameSave")}</button>
              </div>
            </form>
          ) : (
            <h4 className={styles.previewTitle} id="study-template-preview-title">{template.name}</h4>
          )}
          {renaming === null && !confirmDelete && (
            <div className={styles.inlineBtns}>
              {writable && (
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => { setRenaming(template.name); setActionError(null); }}>
                  {t("stplRename")}
                </button>
              )}
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => { setConfirmDelete(true); setActionError(null); }}>
                {t("stplDelete")}
              </button>
              {canCopy && writable && (
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void copyToAccount(template as DeviceStudyTemplate)}>
                  {t("stplCopyToAccount")}
                </button>
              )}
            </div>
          )}
          {confirmDelete && (
            <div className={styles.confirm} role="group" aria-label={t("stplDelete")}>
              <p>{t("stplDeleteConfirm", { name: template.name })}</p>
              <div className={styles.inlineBtns}>
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setConfirmDelete(false)}>{t("stplCancel")}</button>
                <button type="button" className="btn btn-danger" disabled={busy} data-confirm-delete="" onClick={() => void remove()}>{t("stplDelete")}</button>
              </div>
            </div>
          )}
          {actionError && (
            <div className={styles.error} role="alert" data-error={actionError.code}>
              <span>{writeErrorText(t, actionError.code, actionError.op)}</span>
              {actionError.reload && (
                <button type="button" className="btn btn-ghost" onClick={() => { setActionError(null); onReloadAccount(); }}>{t("stplReload")}</button>
              )}
            </div>
          )}
        </div>

        <fieldset className={styles.modes}>
          <legend className={styles.fieldLabel}>{t("stplModeLabel")}</legend>
          <label className={styles.radioRow}>
            <input type="radio" name="study-template-mode" value="replace" checked={mode === "replace"} onChange={() => { setMode("replace"); setChartChanged(false); }} />
            <span>
              <span className={styles.radioTitle}>{t("stplModeReplace")}</span>
              <span className={styles.hint}>{t("stplModeReplaceHint")}</span>
            </span>
          </label>
          <label className={styles.radioRow}>
            <input type="radio" name="study-template-mode" value="merge" checked={mode === "merge"} onChange={() => { setMode("merge"); setChartChanged(false); }} />
            <span>
              <span className={styles.radioTitle}>{t("stplModeMerge")}</span>
              <span className={styles.hint}>{t("stplModeMergeHint")}</span>
            </span>
          </label>
        </fieldset>

        <div className={styles.changes} aria-live="polite">
          {chartChanged && <p className={styles.warn} role="alert" data-chart-changed="">{t("stplNoticeChartChanged")}</p>}
          {plan.noop ? (
            <p className={styles.note} data-noop="">{t("stplPreviewNoop")}</p>
          ) : (
            <>
              {plan.added.length > 0 && (
                <div className={styles.group} data-group="added">
                  <h5>{t("stplPreviewAdded")}</h5>
                  <ul>{plan.added.map((id) => <li key={id}>{labelNext(id)}</li>)}</ul>
                </div>
              )}
              {plan.removed.length > 0 && (
                <div className={styles.group} data-group="removed">
                  <h5>{t("stplPreviewRemoved")}</h5>
                  <ul>{plan.removed.map((id) => <li key={id}>{labelCurrent(id)}</li>)}</ul>
                </div>
              )}
              {plan.changed.length > 0 && (
                <div className={styles.group} data-group="changed">
                  <h5>{t("stplPreviewChanged")}</h5>
                  <ul>
                    {plan.changed.map((change) => (
                      <li key={change.id}>
                        <span>{labelNext(change.id)}</span>
                        <span className={styles.hint}>{changeText(change)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
          {plan.unchanged.length > 0 && (
            <p className={styles.note} data-group="unchanged">
              {plan.unchanged.length === 1 ? t("stplPreviewUnchangedOne") : t("stplPreviewUnchanged", { count: plan.unchanged.length })}
            </p>
          )}
          {plan.skipped.length > 0 && (
            <div className={styles.group} data-group="skipped">
              <h5>{t("stplPreviewNotApplied")}</h5>
              <ul>
                {plan.skipped.map((entry) => (
                  <li key={`${entry.id}:${entry.reason}`} data-reason={entry.reason}>
                    <span>{entryLabel(t, entry.id, [], template.indParams[entry.id] ?? currentParams[entry.id])}</span>
                    <span className={styles.hint}>{reasonText(t, entry.reason, planContext.guestLimit)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ul className={styles.notices}>
            <li data-notice="untouched">{t("stplNoticeUntouched")}</li>
            {plan.lockedModules.length > 0 && (
              <li data-notice="locked">
                {plan.lockedModules.length === 1 ? t("stplNoticeLockedOne") : t("stplNoticeLocked", { count: plan.lockedModules.length })}
              </li>
            )}
            {template.newer && <li data-notice="newer">{t("stplNoticeNewer")}</li>}
          </ul>
        </div>

        <div className={styles.applyRow}>
          <button
            type="button"
            className="btn btn-primary"
            data-apply-template=""
            data-autofocus={initialSelection ? "" : undefined}
            disabled={plan.noop || busy}
            onClick={apply}
          >
            {t("stplApply")}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="tmpl-modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={dialogRef}
        className={`tmpl-modal ${styles.library}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="study-template-library-title"
        data-study-template-library=""
        data-view={view}
        tabIndex={-1}
      >
        <div className={styles.libraryHead}>
          <h3 id="study-template-library-title">{t("stplLibraryTitle")}</h3>
          {view === "preview" && (
            <button type="button" className={`btn btn-ghost ${styles.back}`} onClick={() => { setView("list"); resetRowState(); }}>
              {t("stplBack")}
            </button>
          )}
        </div>
        <div className={styles.panes}>
          <div className={styles.listPane}>
            {accountSection()}
            {deviceSection()}
          </div>
          <div className={styles.previewPane}>{previewPane()}</div>
        </div>
        <div className="tmpl-btns">
          <button type="button" className="btn btn-ghost" onClick={onSaveCurrent}>{t("stplSaveCurrent")}</button>
          <button type="button" className="btn btn-ghost" data-autofocus={initialSelection ? undefined : ""} onClick={onClose}>{t("stplClose")}</button>
        </div>
      </div>
    </div>
  );
}
