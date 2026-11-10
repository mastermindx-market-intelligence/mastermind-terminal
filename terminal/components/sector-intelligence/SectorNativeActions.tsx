"use client";
/** Lane-6 save/watch/note mount (TERMINAL_SLOTS.md §3, returns/lane6.md):
 * a reading of the selected sector becomes a durable Investigation v2
 * revision through the EXISTING store — no new transport, no new store. This
 * wrapper owns only the admission probe, the command manifest and the copy
 * records; the four action components own their own state machines.
 *
 * Admission is honest: both readback probes must admit (503 stays "not yet"
 * until the operator applies the sector admission migration) — otherwise the
 * controls stay hidden, never fake. The command's evidence is pinned to the
 * admitted generation (generation_id + content_sha256), and the whole surface
 * re-binds when the generation or subject changes. */
import { useEffect, useMemo, useState } from "react";
import { useLang } from "@/lib/i18n";
import { useShellIdentity } from "@/components/chrome/AppShell";
import { SECTOR_INTELLIGENCE_LEX, useSectorT } from "@/lib/sectorIntelligenceLex";
import type { InvestigationCommand } from "@/lib/investigations";
import { partitionInvestigationSave, type InvestigationSaveState } from "@/lib/investigationSave";
import { SaveInvestigationButton, type SaveInvestigationCopy } from "./actions/SaveInvestigationButton";
import { CheckSaveStatusButton, type CheckSaveStatusCopy } from "./actions/CheckSaveStatusButton";
import { ArmWatchControl, type ArmWatchCopy } from "./actions/ArmWatchControl";
import { SymbolNoteField, type SymbolNoteCopy } from "./actions/SymbolNoteField";
import type { SectorNativeContext } from "./sectorNativeSlots";
import styles from "./SectorNative.module.css";

/** The exact command template from docs/sector-intelligence/
 * LANE6_INVESTIGATION_CONTRACT_2026-11-09.md §1, pinned to the admitted
 * generation. A replaced generation mints a new command by construction. */
function sectorReadingCommand(context: SectorNativeContext): InvestigationCommand | null {
  const generation = context.generation, subject = context.subject;
  if (!generation || !subject) return null;
  return {
    id: crypto.randomUUID(),
    operation_id: crypto.randomUUID(),
    expected_revision: 0,
    action: "create",
    manifest: {
      schema: "investigation_manifest.v2",
      intent: {
        title: `${subject.name} · ${subject.ticker}`,
        question: "Is the measured leadership supported by participation?",
        subjects: [{ kind: "sector", owner: "macro.sector", object_id: subject.id }],
      },
      layout_refs: [],
      thesis_refs: [],
      evidence_refs: [{
        owner: "macro.sector", object_type: "sector_observation", object_id: subject.id,
        mode: "pinned", version_ref: generation.receipt.generation_id,
        fingerprint: generation.receipt.content_sha256,
      }],
      continuation: {},
    },
  } as InvestigationCommand;
}

export default function SectorNativeActions({ context }: { context: SectorNativeContext }) {
  const t = useSectorT(), { lang } = useLang();
  const identity = useShellIdentity();
  const principal = identity.kind === "account" && identity.userId ? identity.userId : null;
  const [admission, setAdmission] = useState<{ principal: string; subjectId: string; admitted: boolean } | null>(null);
  const [saveState, setSaveState] = useState<InvestigationSaveState | null>(null);
  // The command is minted for the CURRENT principal (r2 N-D): a switched
  // account gets its own id/operation_id, never a replay of the first
  // account's ids (an idempotency/id collision on the same sector).
  const command = useMemo(() => sectorReadingCommand(context), [context, principal]);
  const subjectId = context.subject?.id ?? null;
  const symbol = context.subject?.ticker ?? "";

  // Honest save-admission gate: render the controls only when BOTH readback
  // probes admit. The answer is stored WITH the identity it was measured for
  // and derived per render — a changed principal or subject reads as
  // unadmitted with no synchronous state reset inside the effect (review N5).
  useEffect(() => {
    if (!principal || !subjectId) return;
    const controller = new AbortController();
    (async () => {
      try {
        const headers = { "x-mm-investigation-owner": principal };
        const [a, b] = await Promise.all([
          fetch("/api/investigations?admission=macro.sector:sector_observation",
            { headers, credentials: "same-origin", cache: "no-store", signal: controller.signal }),
          fetch("/api/investigations?subject_admission=macro.sector:sector",
            { headers, credentials: "same-origin", cache: "no-store", signal: controller.signal }),
        ]);
        const [ab, bb] = await Promise.all([a.json().catch(() => null), b.json().catch(() => null)]);
        setAdmission({ principal, subjectId, admitted: a.ok && b.ok && ab?.admitted === true && bb?.admitted === true });
      } catch { setAdmission(null); }
    })();
    return () => controller.abort();
  }, [principal, subjectId]);
  const saveAdmitted = admission !== null && admission.principal === principal && admission.subjectId === subjectId
    ? admission.admitted : null;

  if (!command || !subjectId || !symbol) return null;
  if (!saveAdmitted || !principal) return null;

  // Both languages derive from the ONE lexicon (house law: no second wording
  // set); {placeholder} values are filled per language from the same tuple.
  const bilingual = (key: string): Record<"en" | "zh", string> => {
    const pair = SECTOR_INTELLIGENCE_LEX[key] || ["", ""];
    return { en: pair[0], zh: pair[1] };
  };
  const biFill = (key: string, values: Record<string, string>): Record<"en" | "zh", string> => {
    const base = bilingual(key);
    const apply = (text: string) => Object.entries(values)
      .reduce((out, [name, value]) => out.replaceAll(`{${name}}`, value), text);
    return { en: apply(base.en), zh: apply(base.zh) };
  };
  const copy = {
    save: {
      en: { save: bilingual("siActionSave").en, saving: bilingual("siActionSaving").en,
        unconfirmed: bilingual("siActionUnconfirmed").en, retry: bilingual("siActionRetry").en,
        saved: (r: number) => biFill("siActionSaved", { r: String(r) }).en,
        rejected: (reason: string) => biFill("siActionRejected", { reason }).en,
        signedOut: bilingual("siActionSignedOut").en },
      zh: { save: bilingual("siActionSave").zh, saving: bilingual("siActionSaving").zh,
        unconfirmed: bilingual("siActionUnconfirmed").zh, retry: bilingual("siActionRetry").zh,
        saved: (r: number) => biFill("siActionSaved", { r: String(r) }).zh,
        rejected: (reason: string) => biFill("siActionRejected", { reason }).zh,
        signedOut: bilingual("siActionSignedOut").zh },
    } as Record<"en" | "zh", SaveInvestigationCopy>,
    check: {
      en: { check: bilingual("siActionCheck").en, checking: bilingual("siActionChecking").en,
        committed: (r: number) => biFill("siActionCommitted", { r: String(r) }).en,
        unconfirmed: bilingual("siActionStillUnconfirmed").en,
        rejected: (reason: string) => biFill("siActionRejected", { reason }).en,
        signedOut: bilingual("siActionSignedOut").en },
      zh: { check: bilingual("siActionCheck").zh, checking: bilingual("siActionChecking").zh,
        committed: (r: number) => biFill("siActionCommitted", { r: String(r) }).zh,
        unconfirmed: bilingual("siActionStillUnconfirmed").zh,
        rejected: (reason: string) => biFill("siActionRejected", { reason }).zh,
        signedOut: bilingual("siActionSignedOut").zh },
    } as Record<"en" | "zh", CheckSaveStatusCopy>,
    watch: {
      en: { title: bilingual("siWatchDirection").en, threshold: bilingual("siWatchThreshold").en,
        arm: bilingual("siWatchArm").en, arming: bilingual("siWatchArming").en,
        armed: (s: string, p: string) => biFill("siWatchArmed", { symbol: s, plain: p }).en,
        refused: (p: string) => p, unavailable: bilingual("siWatchUnavailable").en,
        signedOut: bilingual("siActionSignedOut").en },
      zh: { title: bilingual("siWatchDirection").zh, threshold: bilingual("siWatchThreshold").zh,
        arm: bilingual("siWatchArm").zh, arming: bilingual("siWatchArming").zh,
        armed: (s: string, p: string) => biFill("siWatchArmed", { symbol: s, plain: p }).zh,
        refused: (p: string) => p, unavailable: bilingual("siWatchUnavailable").zh,
        signedOut: bilingual("siActionSignedOut").zh },
    } as Record<"en" | "zh", ArmWatchCopy>,
    note: {
      en: { title: bilingual("siNoteTitle").en, placeholder: bilingual("siNotePlaceholder").en,
        saved: bilingual("siNoteSaved").en, saving: bilingual("siActionSaving").en,
        conflict: (text: string) => biFill("siNoteConflict", { text }).en,
        invalid: bilingual("siNoteInvalid").en, pending: bilingual("siNotePending").en,
        signedOut: bilingual("siActionSignedOut").en },
      zh: { title: bilingual("siNoteTitle").zh, placeholder: bilingual("siNotePlaceholder").zh,
        saved: bilingual("siNoteSaved").zh, saving: bilingual("siActionSaving").zh,
        conflict: (text: string) => biFill("siNoteConflict", { text }).zh,
        invalid: bilingual("siNoteInvalid").zh, pending: bilingual("siNotePending").zh,
        signedOut: bilingual("siActionSignedOut").zh },
    } as Record<"en" | "zh", SymbolNoteCopy>,
  };

  // R4 residue (third review, item 4): the save journal is held here and
  // partitioned per render — a pending/uncertain save owned by a switched-out
  // account reads idle for the next account (no Check, no unconfirmed line
  // under B's command), and the original actor's scope returns with them.
  const visibleSaveState = partitionInvestigationSave(saveState ?? { phase: "idle" }, principal);
  const revision = visibleSaveState.phase === "committed" ? visibleSaveState.result.revision : 1;
  return <section className={`${styles.card} ${styles.stateCard}`} data-testid="sector-native-actions">
    <h2 className={styles.stateTitle}>{t("siActionsCard")}</h2>
    <SaveInvestigationButton principal={principal} command={command} lang={lang}
      copy={copy.save} previous={saveState ?? undefined} onStateChange={setSaveState} />
    {visibleSaveState.phase === "pending" || visibleSaveState.phase === "uncertain"
      ? <CheckSaveStatusButton principal={principal} command={command} state={visibleSaveState}
        lang={lang} copy={copy.check} onStateChange={setSaveState} />
      : null}
    <ArmWatchControl principal={principal} link={{ investigation_id: command.id, revision }}
      symbol={symbol} lang={lang} copy={copy.watch} />
    <SymbolNoteField principal={principal} symbol={symbol} initial={null} lang={lang} copy={copy.note} />
  </section>;
}
