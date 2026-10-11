"use client";
// AlertDryRunPanel: "would this suite alert trigger right now?" for the condition the create form
// currently holds, WITHOUT creating it. It POSTs the exact {symbol, condition} snapshot to
// /api/alerts/dry-run (read-only by construction: see app/api/alerts/dry-run/route.ts) and renders
// the canonical evaluator's verdict plus its clocks and a bounded trace.
//
// Truth rules (failure-state-truth law):
//   • a verdict is shown only for the inputs it was computed for; changing any input cancels the
//     in-flight request and the panel returns to idle;
//   • a gateway page, a 5xx, a malformed body or a network error is "unavailable": no verdict, and
//     never "would not trigger";
//   • cannot-evaluate / unsupported carry their reason, never a quiet "not met".
// This component holds no condition logic and imports only the dependency-free wire contract.

import { useEffect, useMemo, useRef, useState } from "react";
import { readDryRunResult } from "@/lib/alertDryRunContract";
import type { DryRunResult, DryRunTraceStep } from "@/lib/alertDryRunContract";
import { SUITE_ALERT_EVENTS } from "@/lib/suiteAlerts";
import type { SuiteAlertCondition, SuiteSequenceCondition } from "@/lib/suiteAlerts";
import { useAlertDryRunT } from "@/lib/alertDryRunLex";
import s from "./AlertDryRunPanel.module.css";

type Phase =
  | { kind: "idle"; key: string; id: number }
  | { kind: "running"; key: string; id: number }
  | { kind: "result"; key: string; id: number; result: DryRunResult }
  | { kind: "unavailable"; key: string; id: number }
  | { kind: "cancelled"; key: string; id: number };

const IDLE: Phase = { kind: "idle", key: "", id: 0 };

const fill = (text: string, slots: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (m, k: string) => (k in slots ? String(slots[k]) : m));

/** ISO instant → "YYYY-MM-DD HH:MM UTC" (stable across locales; the clocks are UTC facts). */
const utcStamp = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
};

export default function AlertDryRunPanel({
  symbol,
  condition,
  signedIn,
  locked,
}: {
  symbol: string;
  condition: SuiteAlertCondition | SuiteSequenceCondition | null;
  signedIn: boolean;
  locked: boolean;
}) {
  const T = useAlertDryRunT();
  const reqKey = useMemo(() => JSON.stringify([symbol, condition]), [symbol, condition]);
  const [phase, setPhase] = useState<Phase>(IDLE);
  const ctrl = useRef<AbortController | null>(null);
  const seq = useRef(0);

  // Any input change (and unmount) cancels the in-flight request. The rendered phase is keyed to
  // the inputs it was computed for, so an old verdict can never sit under new inputs.
  useEffect(() => () => {
    ctrl.current?.abort();
    ctrl.current = null;
  }, [reqKey]);

  const view: Phase = phase.key === reqKey ? phase : IDLE;
  const running = view.kind === "running";
  const canRun = !!condition && signedIn && !locked && !running;

  const run = async () => {
    if (!condition || !signedIn || locked) return;
    ctrl.current?.abort();
    const ac = new AbortController();
    ctrl.current = ac;
    const id = ++seq.current;
    const key = reqKey;
    setPhase({ kind: "running", key, id });
    try {
      const res = await fetch("/api/alerts/dry-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, condition }),
        cache: "no-store",
        signal: ac.signal,
      });
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      if (ac.signal.aborted) throw new DOMException("aborted", "AbortError");
      const result = res.status >= 500 ? null : readDryRunResult(body);
      setPhase((p) => (p.id !== id ? p : result ? { kind: "result", key, id, result } : { kind: "unavailable", key, id }));
    } catch {
      setPhase((p) => (p.id !== id ? p : ac.signal.aborted ? { kind: "cancelled", key, id } : { kind: "unavailable", key, id }));
    } finally {
      if (ctrl.current === ac) ctrl.current = null;
    }
  };

  const cancel = () => {
    ctrl.current?.abort();
    ctrl.current = null;
  };

  if (!condition) return null;

  const eventName = (event: string) => {
    const def = SUITE_ALERT_EVENTS.find((e) => e.event === event);
    return def ? T(def.tkey, def.en) : event;
  };

  const result = view.kind === "result" ? view.result : null;
  const verdictKey = result ? result.verdict : view.kind === "unavailable" || view.kind === "cancelled" ? view.kind : "";

  return (
    <section
      className={s.root}
      aria-label={T("drTitle")}
      data-testid="alert-dry-run"
      data-dry-run-state={view.kind}
      data-dry-run-verdict={result?.verdict ?? ""}
      data-dry-run-reason={result?.reason ?? ""}
    >
      <div className={s.head}>
        <span className={s.title}>{T("drTitle")}</span>
        <span className={s.readOnly}>{T("drReadOnly")}</span>
      </div>
      <p className={s.intro}>{T("drIntro")}</p>
      <div className={s.actions}>
        <button type="button" className="btn btn-ghost" onClick={run} disabled={!canRun} data-testid="alert-dry-run-go">
          {running ? T("drRunning") : view.kind === "idle" ? T("drRun") : T("drRerun")}
        </button>
        {running && (
          <button type="button" className="btn btn-ghost" onClick={cancel} data-testid="alert-dry-run-cancel">
            {T("drCancel")}
          </button>
        )}
        {!signedIn ? (
          <span className={s.hint}>{T("drSignInHint")}</span>
        ) : locked ? (
          <span className={s.hint}>{T("suiteLockedHint")}</span>
        ) : null}
      </div>

      <div className={s.out} role="status" aria-live="polite">
        {verdictKey && (
          <div className={s.verdict} data-verdict={verdictKey}>
            <span className={s.verdictLabel}>
              {result
                ? T(`drVerdict.${result.verdict}`)
                : view.kind === "cancelled"
                  ? T("drCancelled")
                  : T("drUnavailable")}
            </span>
            {result && <span className={s.verdictSub}>{verdictSub(result, T)}</span>}
          </div>
        )}
        {result && <Details result={result} T={T} eventName={eventName} />}
      </div>
    </section>
  );
}

type TFn = (key: string, fallback?: string) => string;

function verdictSub(r: DryRunResult, T: TFn): string {
  if (r.verdict === "would_trigger") return T("drWouldSub");
  if (r.verdict === "not_met") return T("drNotMetSub");
  if (!r.reason) return T("drUnavailable");
  return fill(T(`drReason.${r.reason}`), {
    tier: r.requiredTier ? T(`drTier.${r.requiredTier}`) : "",
    date: r.clocks?.lastBarDate ?? T("drUnknown"),
  });
}

function Details({ result: r, T, eventName }: { result: DryRunResult; T: TFn; eventName: (e: string) => string }) {
  const c = r.clocks;
  const cond = r.condition;
  const stepText = (st: { event: string; dir?: "bull" | "bear"; minStrength?: number }) =>
    [
      eventName(st.event),
      st.dir ? T(`drDir.${st.dir}`) : null,
      st.minStrength !== undefined ? `${T("drStrength")} ≥ ${st.minStrength}` : null,
    ].filter(Boolean).join(" · ");
  const condText = cond
    ? cond.steps.map(stepText).join(" → ") + (cond.maxBarsBetween ? ` (${fill(T("drWithin"), { n: cond.maxBarsBetween })})` : "")
    : null;

  return (
    <>
      {(cond || c || r.symbol) && (
        <dl className={s.grid} data-testid="alert-dry-run-clocks">
          {cond && (
            <div className={s.cell}>
              <dt>{T("drCondition")}</dt>
              <dd data-dry-run-key={cond.key}>{condText}</dd>
            </div>
          )}
          {r.symbol && (
            <div className={s.cell}>
              <dt>{T("drInstrument")}</dt>
              <dd>{r.symbol}</dd>
            </div>
          )}
          {r.timeframe && (
            <div className={s.cell}>
              <dt>{T("drTimeframe")}</dt>
              <dd>{T("drTfValue")}</dd>
            </div>
          )}
          {c && (
            <>
              <div className={s.cell}>
                <dt>{T("drDataThrough")}</dt>
                <dd data-dry-run-last-bar={c.lastBarDate}>{c.lastBarDate} · {fill(T("drBarsN"), { n: c.barCount })}</dd>
              </div>
              <div className={s.cell}>
                <dt>{T("drSourceAsOf")}</dt>
                <dd>{utcStamp(c.sourceAsOf) ?? T("drUnknown")}</dd>
              </div>
              <div className={s.cell}>
                <dt>{T("drEvaluatedAt")}</dt>
                <dd>{utcStamp(c.evaluatedAt) ?? T("drUnknown")}</dd>
              </div>
              <div className={s.cell}>
                <dt>{T("drFreshWindow")}</dt>
                <dd>{c.freshFrom} → {c.freshTo}</dd>
              </div>
              <div className={s.cell}>
                <dt>{T("drCreationFloor")}</dt>
                <dd>{c.creationFloorDate}</dd>
              </div>
            </>
          )}
        </dl>
      )}

      {r.sequenceState && (
        <div>
          <p className={s.sectionLbl}>{T("drSeqState")}</p>
          <p className={s.note}>{T("drSeqInput")}</p>
          <p className={s.event} data-dry-run-seq={r.sequenceState.output}>
            {fill(T(`drSeq.${r.sequenceState.output}`), { date: r.sequenceState.armedDate ?? T("drUnknown") })}
          </p>
        </div>
      )}

      {r.trace && r.trace.length > 0 && (
        <div>
          <p className={s.sectionLbl}>{T("drTrace")}</p>
          <ol className={s.list} data-testid="alert-dry-run-trace">
            {r.trace.map((st: DryRunTraceStep) => (
              <li key={st.id} className={s.step} data-step={st.id} data-status={st.status}>
                <span className={s.chip} data-status={st.status}>{T(`drSt.${st.status}`)}</span>
                <span className={s.stepText}>{T(`drStep.${st.id}`)}</span>
                {st.at && <span className={s.date}>{st.at}</span>}
              </li>
            ))}
          </ol>
        </div>
      )}

      {r.recent && (
        <div>
          <p className={s.sectionLbl}>{T("drRecent")}</p>
          {r.recent.length === 0 ? (
            <p className={s.note}>{T("drNoRecent")}</p>
          ) : (
            <ul className={s.list} data-testid="alert-dry-run-recent">
              {r.recent.map((e, i) => (
                <li key={`${e.event}-${e.confirmedDate}-${i}`} className={s.event}>
                  {[
                    eventName(e.event),
                    e.dir ? T(`drDir.${e.dir}`) : null,
                    e.strength !== undefined ? `${T("drStrength")} ${e.strength}` : null,
                  ].filter(Boolean).join(" · ")}
                  {" — "}
                  <span className={s.date}>{T("drDrawn")} {e.anchorDate} · {T("drConfirmedOn")} {e.confirmedDate}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {r.decision?.fired && r.decision.note && (
        <p className={s.note} lang="en">
          {T("drEngineNote")}: {r.decision.note}
        </p>
      )}
    </>
  );
}
