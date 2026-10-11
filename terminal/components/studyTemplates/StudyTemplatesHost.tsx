"use client";
// E07 — the always-mounted study-template host. Kept lean (no study registry, no suite catalog):
// the dialogs and the apply planner load on demand.
//
// Ownership: the host is keyed on the account owner (`identityOwnerKey`), so a sign-out or a
// different account remounts it with an empty account library — one owner's account templates are
// never shown to, or applied for, another. Account templates are read only for a signed-in uuid
// (the route enforces the same with RLS). Device templates are this browser's own; they are never
// copied into an account except by the explicit per-template "Copy to account" action.
//
// The only chart effect is `onApply(next)` with a planned study triple. Nothing here can reach the
// symbol, drawings, watchlists, alerts, data settings or Day Trade Mode.
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AccountIdentity } from "@/lib/accountIdentity";
import { ACCOUNT_MENU_PREFIX, publishTemplateMenu, readDeviceTemplates } from "@/lib/chartTemplates";
import { studyTemplateBodyOf, type StudyTemplateBody } from "@/lib/studyTemplateSchema";
import { fetchAccountTemplates, type AccountStudyTemplate } from "@/lib/studyTemplatesClient";
import type { StudyState } from "@/lib/studyInstances";
import type { StudyTemplateMode, StudyTripleOut } from "@/lib/studyTemplates";
import { useStudyTemplatesT } from "@/lib/studyTemplatesLex";
import type { SaveOutcome } from "./StudyTemplateSaveDialog";
import type { AccountTemplatesState, TemplatePlanContext, TemplateRef } from "./types";
import styles from "./studyTemplates.module.css";

const SaveDialog = dynamic(() => import("./StudyTemplateSaveDialog"), { ssr: false });
const LibraryDialog = dynamic(() => import("./StudyTemplateLibraryDialog"), { ssr: false });

/** Opens the library (the Indicators dialog's "Study templates" entry dispatches this). */
export const OPEN_STUDY_TEMPLATES_EVENT = "mm:open-study-templates";

const FIRST_READ_DELAY_MS = 800;
const TOAST_MS = 4000;

type Dialog = null | { kind: "save" } | { kind: "library"; selection: TemplateRef | null };

export default function StudyTemplatesHost({
  identity,
  studyState,
  userTier,
  guestLimit,
  onApply,
}: {
  identity: AccountIdentity;
  studyState: StudyState;
  userTier: "free" | "essential" | "pro";
  guestLimit: number | null;
  onApply: (next: StudyTripleOut) => void;
}) {
  const t = useStudyTemplatesT();
  const signedIn = identity.kind === "account";
  const [account, setAccount] = useState<AccountTemplatesState>(() => (signedIn ? { status: "loading" } : { status: "guest" }));
  const [dialog, setDialog] = useState<Dialog>(null);
  const [toast, setToast] = useState<{ text: string; n: number } | null>(null);

  const accountRef = useRef(account);
  accountRef.current = account;
  const studyRef = useRef(studyState);
  studyRef.current = studyState;
  const applyRef = useRef(onApply);
  applyRef.current = onApply;
  const contextRef = useRef<TemplatePlanContext>({ guestLimit, userTier });
  contextRef.current = { guestLimit, userTier };
  const generation = useRef(0);
  const started = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current += 1;
    };
  }, []);

  const showToast = useCallback((text: string) => setToast((prev) => ({ text, n: (prev?.n ?? 0) + 1 })), []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  /** Read the owner's account library. `quiet` keeps the current list on screen while it refreshes. */
  const loadAccount = useCallback((quiet: boolean) => {
    if (!signedIn) return;
    started.current = true;
    const gen = ++generation.current;
    if (!quiet || accountRef.current.status !== "ok") setAccount({ status: "loading" });
    void fetchAccountTemplates().then((result) => {
      if (!alive.current || gen !== generation.current) return;
      setAccount(result);
    });
  }, [signedIn]);

  useEffect(() => {
    if (!signedIn) return;
    const timer = window.setTimeout(() => { if (!started.current) loadAccount(false); }, FIRST_READ_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [signedIn, loadAccount]);

  // The chart's synchronous template menu lists account rows only while this owner's list is read.
  useEffect(() => {
    publishTemplateMenu(account.status === "ok"
      ? { account: account.templates.map(({ id, name }) => ({ id, name })), deviceSuffix: t("stplDeviceSuffix") }
      : null);
  }, [account, t]);
  useEffect(() => () => publishTemplateMenu(null), []);

  const openLibrary = useCallback((selection: TemplateRef | null) => {
    setDialog({ kind: "library", selection });
    loadAccount(true);
  }, [loadAccount]);

  /** The template a menu id names, from the list this host holds (account) or storage (device). */
  const resolveBody = (ref: TemplateRef): StudyTemplateBody | null => {
    if (ref.source === "account") {
      const list = accountRef.current;
      const found = list.status === "ok" ? list.templates.find((entry) => entry.id === ref.id) : undefined;
      return found ? studyTemplateBodyOf(found) : null;
    }
    const device = readDeviceTemplates();
    const found = device.status === "ok" ? device.templates.find((entry) => entry.id === ref.id) : undefined;
    return found ? studyTemplateBodyOf(found) : null;
  };
  const resolveRef = useRef(resolveBody);
  resolveRef.current = resolveBody;

  useEffect(() => {
    const onApplyRequest = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: unknown; mode?: unknown }>).detail;
      const raw = typeof detail?.id === "string" ? detail.id : "";
      if (!raw) return;
      const ref: TemplateRef = raw.startsWith(ACCOUNT_MENU_PREFIX)
        ? { source: "account", id: raw.slice(ACCOUNT_MENU_PREFIX.length) }
        : { source: "device", id: raw };
      const body = resolveRef.current(ref);
      if (!body) {
        showToast(t("stplToastNotFound"));
        return;
      }
      const mode: StudyTemplateMode | null = detail?.mode === "replace" || detail?.mode === "merge" ? detail.mode : null;
      if (!mode) {
        // The chart menu never names a mode: the user previews and chooses one in the library.
        openLibrary(ref);
        return;
      }
      // Programmatic apply with an explicit mode (automation and stress tests). Same planner, same
      // single chart effect as the library's Apply.
      void import("@/lib/studyTemplates").then(({ planStudyTemplateApply }) => {
        if (!alive.current) return;
        const plan = planStudyTemplateApply(studyRef.current, body, mode, contextRef.current);
        if (!plan.noop) applyRef.current(plan.next);
        showToast(t("stplToastApplied"));
      });
    };
    const onSaveRequest = () => setDialog({ kind: "save" });
    const onOpenRequest = () => openLibrary(null);
    window.addEventListener("mm:apply-template", onApplyRequest);
    window.addEventListener("mm:save-template", onSaveRequest);
    window.addEventListener(OPEN_STUDY_TEMPLATES_EVENT, onOpenRequest);
    return () => {
      window.removeEventListener("mm:apply-template", onApplyRequest);
      window.removeEventListener("mm:save-template", onSaveRequest);
      window.removeEventListener(OPEN_STUDY_TEMPLATES_EVENT, onOpenRequest);
    };
  }, [openLibrary, showToast, t]);

  const closeDialog = useCallback(() => setDialog(null), []);

  const onSaved = useCallback((outcome: SaveOutcome) => {
    setDialog(null);
    if (outcome.destination === "account") {
      const saved = outcome.template;
      setAccount((prev) => (prev.status === "ok"
        ? { ...prev, templates: [saved, ...prev.templates.filter((entry) => entry.id !== saved.id)] }
        : prev));
      if (accountRef.current.status !== "ok") loadAccount(true);
      showToast(t("stplToastSavedAccount"));
    } else {
      showToast(t("stplToastSavedDevice"));
    }
  }, [loadAccount, showToast, t]);

  const onAccountChanged = useCallback((update: (list: AccountStudyTemplate[]) => AccountStudyTemplate[]) => {
    setAccount((prev) => (prev.status === "ok" ? { ...prev, templates: update(prev.templates) } : prev));
  }, []);

  const applyFromLibrary = useCallback((next: StudyTripleOut) => {
    applyRef.current(next);
    setDialog(null);
    showToast(t("stplToastApplied"));
  }, [showToast, t]);

  return (
    <>
      {dialog?.kind === "save" && (
        <SaveDialog
          signedIn={signedIn}
          studyState={studyState}
          onClose={closeDialog}
          onSaved={onSaved}
          onFailedAfterClose={showToast}
        />
      )}
      {dialog?.kind === "library" && (
        <LibraryDialog
          account={account}
          studyState={studyState}
          planContext={{ guestLimit, userTier }}
          initialSelection={dialog.selection}
          onClose={closeDialog}
          onReloadAccount={() => loadAccount(false)}
          onAccountChanged={onAccountChanged}
          onApply={applyFromLibrary}
          onSaveCurrent={() => setDialog({ kind: "save" })}
          onToast={(key) => showToast(t(key))}
        />
      )}
      {toast && (
        <div key={toast.n} className={styles.toast} role="status" data-study-template-toast="">
          {toast.text}
        </div>
      )}
    </>
  );
}
