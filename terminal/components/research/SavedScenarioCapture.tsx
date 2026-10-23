"use client";
// SavedScenarioCapture — the deliberate SAVE of the scenario a reader composed, as a
// REFERENCE-ONLY capture. Repaired against the frozen input/reference-only contract.
//
// Composed adjacent to the live result inside the existing scenario panel (ExposureScenario);
// it owns no math and opens no source read. The LIVE basis, result and source clock stay
// ephemeral in the parent panel and are never passed here, never journaled and never posted.
// What is stored is exactly two things: the user's own scenario inputs, and the platform's
// reference descriptor (`sourceReference`) naming the exact source that read used. This
// component never constructs that descriptor — not from a basis, not from a digest of client
// JSON, not from default data or "latest", not from a clock, not from a receipt. When it is
// absent or malformed the honest state is "the exact source reference is unavailable", Save is
// disabled, and nothing is journaled or sent.
//
// A present descriptor is NOT a client-side authority: the server preflight
// (investigationScenarioServer) validates exact producer/retained identity, native math and
// current action/destination bindings. Absent bindings refuse; uncertain effects stay UNKNOWN.
//
// Save discipline (same canonical carriers as the Saved research workspace):
//   · click-only. No autosave, no timers, nothing written anywhere until the user presses Save.
//   · the exact capture is frozen at that click through the canonical
//     createScenarioCapture -> beginInvestigationSave path, which JSON-clones the command, so a
//     later reference, input or language change can never mutate the original operation.
//   · the pending command is retained in the EXISTING journal
//     `mm.investigation.pending.v2:<owner>` BEFORE anything is sent. A storage failure sends
//     nothing. A buffer that already holds another operation — saved research or an earlier
//     scenario save — is never overwritten, replaced, adopted or replayed: this panel shows the
//     native Saved research entry and stops. A buffer whose scenario_capture is NOT a valid
//     reference-only capture is refused the same way, with copy that says it stores protected
//     values this platform no longer accepts — it is never sent, checked, adopted or
//     downgraded by dropping fields.
//   · the POST carries the deliberate owner binding header `x-mm-scenario-owner:<user id>`
//     derived from the actual shell identity (never a body override). A lost response leaves
//     the outcome UNKNOWN with the exact command retained; recovery is the explicit Check
//     (operation_id GET) or read-only source recovery before CAS (the SAME operation, same ids).
//     The initial capture header is never reused on recovery. No automatic retries, no new
//     UUIDs, no registry.
//   · a CONFIRMED commit is a METADATA commit — the reference and the inputs were recorded —
//     and stays known even when only the readback fails. The copy distinguishes that recorded
//     revision from any claim that the exact source was resolved, and the readback is a
//     verification, never the authority.
//   · an owner change or unmount invalidates every in-flight answer and clears painted private
//     content. The old owner's retained buffer stays partitioned under its own key.
//
// This section gates saving only; source display remains subject to its native access rules.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShellIdentity } from "@/components/chrome/AppShell";
import { identityOwnerKey, identityUserId } from "@/lib/accountIdentity";
import { readInvestigationJournal, retainInvestigationJournal, rejectInvestigationJournal, clearCommittedInvestigationJournal } from "@/lib/investigationJournal";
import { createScenarioCapture } from "@/lib/investigationScenario";
import {
  beginInvestigationSave,
  retryInvestigationSave,
  settleInvestigationSave,
  type InvestigationSaveState,
} from "@/lib/investigationSave";
import type { InvestigationCommand } from "@/lib/investigations";
import type { ScenarioInputs } from "@/lib/exposureScenario";
import styles from "./SavedScenario.module.css";

type Props = {
  /** The user's own scenario inputs — the only scenario content this save ever stores. */
  inputs: ScenarioInputs;
  /** Optional descriptor naming the exact source the platform holds for this read. Absent or
   *  malformed means the source reference is unavailable and nothing can be saved. Never
   *  derived here from a basis, a client JSON hash, default/latest data, a clock or a receipt;
   *  a parent wires an authentic one when one exists. */
  sourceReference?: unknown | null;
  lang: "en" | "zh";
};

const COPY = {
  en: {
    head: "Save this scenario",
    intro: "Saved research records your inputs and an exact source reference. Protected source capture is checked separately.",
    title: "Title",
    question: "Question",
    save: "Save scenario",
    saving: "Saving…",
    limits: "Add a title (max 160) and a question (max 4000).",
    invalid: "These inputs cannot be captured. Adjust the scenario and try again.",
    sourceUnavailable: "The exact source reference for this read is unavailable, so nothing can be saved. Calculating does not save this scenario.",
    signIn: "Sign in to save this scenario. Calculating does not save this scenario.",
    storage: "This browser cannot safely retain the pending save. Nothing was sent.",
    occupied: "A previous save on this account is still unconfirmed. Resolve it in Saved research first — this scenario was not sent and nothing was overwritten.",
    occupiedAction: "Open Saved research",
    legacy: "A previously retained scenario save stores protected values this platform no longer accepts. It was not sent, checked or changed — resolve it in Saved research.",
    uncertain: "The save outcome is not confirmed. The exact request is retained.",
    check: "Check original outcome",
    retry: "Retry original save",
    conflict: "This revision was not committed. The original request is retained.",
    refusedSource: "This revision was not committed because its exact source is unavailable. The original request is retained.",
    saved: "Saved",
    revision: "Revision",
    savedNote: "Your inputs and the source reference were recorded with this revision. Reopening shows them as saved; the exact source is not re-resolved here.",
    verifying: "Saved. Verifying the exact revision…",
    verifyFailed: "Saved, but the exact readback is unavailable. Reopen this revision to verify it.",
    verifyMismatch: "Saved, but this revision does not read back as the exact reference that was sent.",
    open: "Open saved research",
    sent: "Saved reference",
    frozen: "Frozen at save — the reference names one exact source; no market values are included.",
  },
  zh: {
    head: "保存此方案",
    intro: "已保存研究记录你的输入与确切来源引用。受保护来源的捕获将单独核验。",
    title: "标题",
    question: "提问",
    save: "保存方案",
    saving: "保存中…",
    limits: "请填写标题（最多 160 字）和提问（最多 4000 字）。",
    invalid: "当前输入无法保存。请调整方案后重试。",
    sourceUnavailable: "此读数的确切来源引用暂不可用，因此无法保存。计算功能对所有人开放。",
    signIn: "登录后即可保存此方案。计算功能对所有人开放。",
    storage: "此浏览器无法安全保留待确认的保存请求。未发送任何内容。",
    occupied: "该账户上一次保存尚未确认。请先在“已保存研究”中处理——此方案未发送，且未覆盖任何内容。",
    occupiedAction: "打开已保存研究",
    legacy: "先前保留的方案保存请求含有本平台不再接受的受保护数值。它未被发送、检查或更改——请在“已保存研究”中处理。",
    uncertain: "保存结果尚未确认。原请求已保留。",
    check: "检查原请求结果",
    retry: "重试原保存请求",
    conflict: "本修订未提交，原请求已保留。",
    refusedSource: "平台当前无法获取该确切来源，本修订未提交，原请求已保留。",
    saved: "已保存",
    revision: "修订",
    savedNote: "你的输入与来源引用已随此修订版本记录。重新打开时按保存内容显示；此处不会重新解析该确切来源。",
    verifying: "已保存。正在核验确切修订…",
    verifyFailed: "已保存，但暂时无法回读。请重新打开此修订进行核验。",
    verifyMismatch: "已保存，但此修订回读结果与所发送的确切引用不一致。",
    open: "打开已保存研究",
    sent: "已保存的引用",
    frozen: "保存时冻结——引用只指向一个确切来源；不包含任何市场数值。",
  },
} as const;

const exactJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);


type Phase =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "uncertain" }
  | { kind: "rejected"; reason?: string }
  | { kind: "blocked" }
  | { kind: "occupied" }
  | { kind: "legacy" }
  | { kind: "committed"; verify: "checking" | "ok" | "failed" | "mismatch" };

export default function SavedScenarioCapture({ inputs, sourceReference = null, lang }: Props) {
  const c = COPY[lang];
  const identity = useShellIdentity();
  const ownerKey = identityOwnerKey(identity);
  const userId = identityUserId(identity);
  const isAccount = identity.kind === "account";

  // The one gate on this panel: the strict native constructor. It validates the descriptor's
  // shape and the user's inputs and detaches them; its result is a candidate, never an
  // authority — the server preflight below stays the save's authority.
  const made = useMemo(() => createScenarioCapture(sourceReference, inputs), [sourceReference, inputs]);

  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [saved, setSaved] = useState<{ id: string; revision: number } | null>(null);
  const [retained, setRetained] = useState<InvestigationCommand | null>(null);
  const [title, setTitle] = useState("");
  const [question, setQuestion] = useState("");
  // Every async completion is stamped with the generation that started it; an owner change or
  // unmount bumps the counter, so a late answer can never paint into the new owner's panel.
  const genRef = useRef(0);
  const stateRef = useRef<InvestigationSaveState>({ phase: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  const alive = (gen: number) => genRef.current === gen;

  const reset = useCallback(() => {
    genRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    stateRef.current = { phase: "idle" };
    setPhase({ kind: "idle" });
    setSaved(null);
    setRetained(null);
    setTitle("");
    setQuestion("");
  }, []);

  // An owner change clears painted private content in the same commit; the previous owner's
  // journal buffer is untouched — it stays partitioned under its own key.
  useEffect(() => {
    reset();
    return () => {
      genRef.current += 1;
      abortRef.current?.abort();
    };
  }, [ownerKey, reset]);

  /** The save click. Everything frozen here stays frozen: the reference, the ids, the typed
   *  words and the journal entry. */
  async function onSave() {
    if (!isAccount || !made.ok) return;
    if (phase.kind === "pending" || phase.kind === "uncertain" || phase.kind === "occupied" || phase.kind === "legacy") return;
    // Any existing buffer for THIS owner is another original operation: never overwritten,
    // never replaced, never adopted. A buffer whose scenario_capture is not a valid
    // reference-only capture is refused outright — no POST, no downgrade, no field dropping.
    try {
      const journal=readInvestigationJournal(sessionStorage,ownerKey);
      if(journal.status!=="empty") {setPhase({kind:journal.status==="legacy"?"legacy":"occupied"});return;}
    } catch {setPhase({kind:"blocked"});return;}
    const command: InvestigationCommand = {
      id: crypto.randomUUID(),
      operation_id: crypto.randomUUID(),
      expected_revision: 0,
      action: "create",
      manifest: {
        schema: "investigation_manifest.v2",
        intent: { title, question, subjects: [{ owner: "terminal.analysis_symbol", kind: "security", object_id: made.capture.source.root }] },
        layout_refs: [],
        thesis_refs: [],
        evidence_refs: [],
        continuation: {},
        scenario_capture: made.capture,
      },
    };
    const next = beginInvestigationSave(ownerKey, command, stateRef.current);
    if (next.phase !== "pending") {
      setPhase({ kind: "rejected" });
      return;
    }
    stateRef.current = next;
    setRetained(next.command);
    setPhase({ kind: "pending" });
    // Retain BEFORE sending: a storage failure means nothing leaves the browser.
    try {
      retainInvestigationJournal(sessionStorage,ownerKey,next.command);
    } catch {
      stateRef.current = { phase: "idle" };
      setPhase({ kind: "blocked" });
      return;
    }
    await send(next.command, true);
  }

  /** One POST with the deliberate owner binding; a lost response settles UNKNOWN — the exact
   *  command stays retained and nothing is replayed automatically. */
  async function send(command: InvestigationCommand, initialCapture = false) {
    const gen = genRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch("/api/investigations", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-mm-scenario-owner": userId, "x-mm-scenario-capture": initialCapture ? "initial" : "recover" },
        body: JSON.stringify(command),
        cache: "no-store",
        signal: controller.signal,
      });
      const body: unknown = await response.json().catch(() => null);
      if (!alive(gen)) return;
      settle(body);
    } catch {
      if (!alive(gen) || controller.signal.aborted) return;
      settle(null);
    } finally {
      if (alive(gen) && abortRef.current === controller) abortRef.current = null;
    }
  }

  /** Canonical settle: only an exact committed receipt is a commit; definitive refusals are
   *  rejected; everything else — timeouts, auth expiry, malformed replies, receipt misses —
   *  stays UNKNOWN with the original command retained. */
  function settle(response: unknown) {
    const owner = ownerKey;
    const previous = stateRef.current;
    if (previous.phase !== "pending" && previous.phase !== "uncertain") return;
    const next = settleInvestigationSave(previous, owner, response);
    stateRef.current = next;
    if (next.phase === "committed") {
      try { clearCommittedInvestigationJournal(sessionStorage,owner,previous.command); } catch { /* the receipt remains authoritative */ }
      setSaved({ id: next.result.id, revision: next.result.revision });
      setPhase({ kind: "committed", verify: "checking" });
      void verify(next.result.id, next.result.revision, previous.command);
      return;
    }
    if (next.phase === "rejected") {
      try {
        rejectInvestigationJournal(sessionStorage,owner,next.command,next.reason);
      } catch { /* nothing was committed either way */ }
      setRetained(next.command);
      setPhase({ kind: "rejected", reason: next.reason });
      return;
    }
    if (next.phase === "uncertain") {
      setRetained(next.command);
      setPhase({ kind: "uncertain" });
    }
  }

  /** Readback is verification only: a confirmed METADATA commit is never downgraded by a
   *  failed or mismatching read — it just says so, and the explicit reopen stays available.
   *  A matching readback verifies the recorded reference, not a source resolution. */
  async function verify(id: string, revision: number, sentCommand: InvestigationCommand) {
    const gen = genRef.current;
    const controller = new AbortController();
    const sent = sentCommand.manifest.scenario_capture;
    try {
      const response = await fetch(`/api/investigations?${new URLSearchParams({ id, revision: String(revision) })}`, { cache: "no-store", signal: controller.signal });
      const body: unknown = await response.json().catch(() => null);
      if (!alive(gen)) return;
      const found =
        body !== null && typeof body === "object" && !Array.isArray(body)
        && (body as { status?: unknown }).status === "found"
        && (body as { manifest?: unknown }).manifest !== null
        && typeof (body as { manifest?: unknown }).manifest === "object"
        ? (body as { manifest: Record<string, unknown>; revision?: unknown }) : null;
      if (!found || found.revision !== revision || sent === undefined
        || found.manifest.scenario_capture === undefined
        || !exactJson(found.manifest.scenario_capture, sent)) {
        setPhase((p) => (p.kind === "committed" ? { ...p, verify: sent === undefined ? "failed" : "mismatch" } : p));
        return;
      }
      setPhase((p) => (p.kind === "committed" ? { ...p, verify: "ok" } : p));
    } catch {
      if (!alive(gen)) return;
      setPhase((p) => (p.kind === "committed" ? { ...p, verify: "failed" } : p));
    }
  }

  /** Explicit outcome check: the existing operation receipt by its ORIGINAL operation_id. */
  async function onCheck() {
    const command = retryInvestigationSave(stateRef.current, ownerKey);
    if (!command) return;
    const gen = genRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch(`/api/investigations?operation_id=${encodeURIComponent(command.operation_id)}`, { cache: "no-store", signal: controller.signal });
      const body: unknown = await response.json().catch(() => null);
      if (!alive(gen)) return;
      settle(body);
    } catch {
      if (!alive(gen) || controller.signal.aborted) return;
      settle(null);
    }
  }

  /** Explicit retry of the SAME original operation — same id, same operation_id, same frozen
   *  reference. Never a rebuilt command, never automatic. */
  function onRetry() {
    const command = retryInvestigationSave(stateRef.current, ownerKey);
    if (!command) return;
    setPhase({ kind: "pending" });
    void send(command);
  }

  // ── Derived, always-truthful refusal copy ────────────────────────────────────────────────
  const refusal = !made.ok ? (made.reason === "invalid_inputs" ? c.invalid : c.sourceUnavailable) : null;
  const canCapture = made.ok;
  const busy = phase.kind === "pending";
  const locked = busy || phase.kind === "uncertain";

  return (
    <div className={styles.root} data-testid="saved-scenario-capture" data-phase={phase.kind}>
      <span className={styles.eyebrow}>{c.head}</span>
      <p className={styles.note}>{c.intro}</p>

      {phase.kind === "committed" ? (
        <>
          <p className={`${styles.status} ${styles.ok}`} role="status" data-testid="scenario-capture-status">
            {`${c.saved} · ${c.revision} ${saved?.revision ?? ""}`}
            {phase.verify === "checking" ? ` · ${c.verifying}` : ""}
          </p>
          <p className={styles.note}>{c.savedNote}</p>
          {phase.verify === "failed" && <p className={styles.status} role="status">{c.verifyFailed}</p>}
          {phase.verify === "mismatch" && <p className={styles.status} role="status">{c.verifyMismatch}</p>}
          {retained && (
            <details className={styles.details}>
              <summary>{c.sent}</summary>
              <pre className={styles.pre}>{JSON.stringify(retained.manifest.scenario_capture, null, 2)}</pre>
              <p className={styles.note}>{c.frozen}</p>
            </details>
          )}
          <div className={styles.actions}>
            <a className={styles.action} href={`/analysis?view=investigations&investigation=${encodeURIComponent(saved?.id ?? "")}&revision=${saved?.revision ?? ""}`}>{c.open}</a>
          </div>
        </>
      ) : phase.kind === "legacy" ? (
        <>
          <p className={styles.status} role="status" data-testid="scenario-capture-refusal">{c.legacy}</p>
          <div className={styles.actions}>
            <a className={styles.action} href="/analysis?view=investigations">{c.occupiedAction}</a>
          </div>
        </>
      ) : phase.kind === "occupied" ? (
        <>
          <p className={styles.status} role="status" data-testid="scenario-capture-status">{c.occupied}</p>
          <div className={styles.actions}>
            <a className={styles.action} href="/analysis?view=investigations">{c.occupiedAction}</a>
          </div>
        </>
      ) : (
        <>
          {!isAccount && <p className={styles.status} role="status">{c.signIn}</p>}
          {refusal && <p className={styles.status} role="status" data-testid="scenario-capture-refusal">{refusal}</p>}
          <div className={styles.fields}>
            <label className={styles.label}>
              {c.title}
              <input
                className={styles.input}
                value={title}
                maxLength={160}
                disabled={!isAccount || !canCapture || locked}
                onChange={(e) => setTitle(e.target.value)}
                aria-label={c.title}
              />
            </label>
            <label className={styles.label}>
              {c.question}
              <textarea
                className={styles.input}
                value={question}
                rows={3}
                maxLength={4000}
                disabled={!isAccount || !canCapture || locked}
                onChange={(e) => setQuestion(e.target.value)}
                aria-label={c.question}
              />
            </label>
            <small className={styles.hint}>{c.limits}</small>
          </div>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primary}
              data-testid="scenario-save"
              disabled={!isAccount || !canCapture || locked || phase.kind === "blocked" || phase.kind === "rejected"}
              onClick={() => void onSave()}
            >
              {busy ? c.saving : c.save}
            </button>
          </div>
          {phase.kind === "blocked" && <p className={styles.status} role="status">{c.storage}</p>}
          {phase.kind === "rejected" && !refusal && (
            <p className={styles.status} role="status" data-testid="scenario-capture-status">
              {phase.reason === "reference_unavailable" ? c.refusedSource : c.conflict}
            </p>
          )}
          {phase.kind === "uncertain" && (
            <>
              <p className={styles.status} role="status">{c.uncertain}</p>
              <div className={styles.actions}>
                <button type="button" onClick={() => void onCheck()}>{c.check}</button>
                <button type="button" disabled={busy} onClick={onRetry}>{c.retry}</button>
              </div>
            </>
          )}
          {retained && phase.kind !== "rejected" && (
            <details className={styles.details}>
              <summary>{c.sent}</summary>
              <pre className={styles.pre}>{JSON.stringify(retained.manifest.scenario_capture, null, 2)}</pre>
              <p className={styles.note}>{c.frozen}</p>
            </details>
          )}
        </>
      )}
    </div>
  );
}
