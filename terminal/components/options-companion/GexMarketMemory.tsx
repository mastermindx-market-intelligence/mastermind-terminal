"use client";
import { useEffect, useMemo, useState } from "react";
import { flowGetResult, type FlowOutcome } from "@/lib/flowClientCache";
import {
  buildCompanionGexMemory,
  bindCompanionGexComparison,
  formatExposureMn,
  previousAvailableGexSession,
  readCompanionGexSnapshot,
  type CompanionGexSnapshot,
} from "@/lib/optionsCompanion";
import type { ExposureLens } from "@/lib/exposureMapProjection";
import type { OptionsT } from "./optionsStrings";
import styles from "./OptionsCompanion.module.css";

type MemoryState =
  | { key: string; status: "ready"; current: CompanionGexSnapshot; previous: CompanionGexSnapshot; originMs: number }
  | { key: string; status: "mismatch"; gexSession: string }
  | { key: string; status: "archive-missing"; previousSession: string }
  | { key: string; status: "scope-unavailable"; previousSession: string }
  | { key: string; status: "absent" }
  | { key: string; status: "no-prior" }
  | { key: string; status: "unavailable" };

/** A failed read must not look like a published gap. Unavailable wins over absent. */
function readClass(outcomes: FlowOutcome[]): "data" | "absent" | "unavailable" {
  if (outcomes.some((o) => o.status === "unavailable")) return "unavailable";
  if (outcomes.some((o) => o.status === "absent")) return "absent";
  return "data";
}

const fmtNetBn = (value: number | null) => value == null ? "—" : formatExposureMn(value * 1_000);
const fmtMn = (value: number | null) => value == null ? "—" : formatExposureMn(value);
const fmtSpot = (value: number | null) =>
  value == null ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: 2 });

const ALL_LENS: ExposureLens = { kind: "all" };

export function GexMarketMemory({ root, matrixSession, strike, t, currentSnapshot, lens = ALL_LENS }: {
  root: string; matrixSession: string; strike: number | null; t: OptionsT; currentSnapshot?: unknown; lens?: ExposureLens;
}) {
  const key = `${root}|${matrixSession}|${JSON.stringify(lens)}`;
  const [state, setState] = useState<{ snapshot: unknown; result: MemoryState }>({
    snapshot: undefined, result: { key: "", status: "unavailable" },
  });

  useEffect(() => {
    let active = true;
    const originMs = Date.now();
    const show = (result: MemoryState) => setState({ snapshot: currentSnapshot, result });
    void (async () => {
      const [currentRaw, datesRaw] = await Promise.all([
        // Exposure owns its selected current/archive bytes. Reuse that exact
        // book so inspecting history never silently requests today's book.
        currentSnapshot === undefined ? flowGetResult(`gex:${root}`)
          : Promise.resolve<FlowOutcome>({ status: "data", data: currentSnapshot }),
        flowGetResult(`gex_dates:${root}`),
      ]);
      if (!active) return;
      const liveClass = readClass([currentRaw, datesRaw]);
      if (liveClass === "unavailable") { show({ key, status: "unavailable" }); return; }
      if (liveClass === "absent") { show({ key, status: "absent" }); return; }
      const current = readCompanionGexSnapshot(currentRaw.status === "data" ? currentRaw.data : null, root, originMs, lens);
      if (!current.ok) { show({ key, status: "unavailable" }); return; }
      if (current.value.session !== matrixSession) {
        show({ key, status: "mismatch", gexSession: current.value.session }); return;
      }
      const prior = previousAvailableGexSession(datesRaw.status === "data" ? datesRaw.data : null, root, matrixSession);
      if (!prior.ok) { show({ key, status: "unavailable" }); return; }
      if (!prior.value.session) { show({ key, status: "no-prior" }); return; }
      const previousRaw = await flowGetResult(`gex_at:${root}:${prior.value.session}`);
      if (!active) return;
      if (previousRaw.status === "unavailable") { show({ key, status: "unavailable" }); return; }
      if (previousRaw.status === "absent") {
        show({ key, status: "archive-missing", previousSession: prior.value.session }); return;
      }
      const previous = readCompanionGexSnapshot(previousRaw.status === "data" ? previousRaw.data : null, root, originMs, lens);
      if (!previous.ok && previous.reason === "scope") {
        show({ key, status: "scope-unavailable", previousSession: prior.value.session }); return;
      }
      if (!previous.ok || previous.value.session !== prior.value.session) {
        show({ key, status: "archive-missing", previousSession: prior.value.session }); return;
      }
      const [boundCurrent, boundPrevious] = await Promise.all([
        bindCompanionGexComparison(current.value), bindCompanionGexComparison(previous.value),
      ]);
      if (!active) return;
      show({ key, status: "ready", current: boundCurrent, previous: boundPrevious, originMs });
    })();
    return () => { active = false; };
  }, [key, matrixSession, root, currentSnapshot, lens]);

  const visible = state.result.key === key && state.snapshot === currentSnapshot ? state.result : null;
  const memory = useMemo(() => visible?.status === "ready"
    ? buildCompanionGexMemory(visible.current, visible.previous, strike, visible.originMs) : null,
  [visible, strike]);

  const shell = (body: React.ReactNode, status: string) =>
    <section className={styles.inspector} data-testid="options-market-memory" data-memory-status={status}>
      <div className={styles.inspectorTitle}><strong>{t("marketMemory")}</strong><span>{t("memoryGamma")} · {lens.kind === "all" ? t("memoryAllExpiry") : lens.kind === "one" ? lens.exp : lens.kind === "zero" ? t("memorySessionZero") : t("memorySelectedExpiry")}</span></div>
      {body}
    </section>;

  if (!visible) return shell(<p role="status">{t("memoryLoading")}</p>, "loading");
  if (visible.status === "mismatch") return shell(<>
    <p className={styles.warning} role="status">{t("memoryMismatch")}</p>
    <small>{matrixSession} ≠ {visible.gexSession}</small>
  </>, "mismatch");
  if (visible.status === "archive-missing") return shell(<>
    <p className={styles.warning} role="status">{t("memoryArchiveMissing")}</p>
    <small>{visible.previousSession}</small>
  </>, "archive-missing");
  if (visible.status === "scope-unavailable") return shell(<>
    <p className={styles.scopeHint} role="status">{t("memoryPriorScopeUnavailable")}</p>
    <time dateTime={visible.previousSession}>{visible.previousSession}</time>
  </>, "scope-unavailable");
  if (visible.status === "absent") {
    return shell(<p className={styles.scopeHint} role="status">{t("snapshotAbsent")}</p>, "absent");
  }
  if (visible.status === "no-prior") {
    return shell(<p className={styles.scopeHint} role="status">{t("memoryUnavailable")}</p>, "unavailable");
  }
  if (visible.status !== "ready" || !memory) {
    return shell(<p className={styles.scopeHint} role="status">{t("snapshotUnreadable")}</p>, "unavailable");
  }

  const currentNetMn = memory.current.netGexBn == null ? null : memory.current.netGexBn * 1_000;
  const previousNetMn = memory.previous.netGexBn == null ? null : memory.previous.netGexBn * 1_000;
  const changesAvailable = memory.changeBasis === "aggregate_reference";
  const reported = memory.reportedChange?.state === "data" ? memory.reportedChange : null;
  const atStrike = reported?.byStrike.find(row => row.strike === memory.strike);
  const netDeltaMn = changesAvailable && currentNetMn != null && previousNetMn != null ? currentNetMn - previousNetMn : null;
  const strikeDeltaMn = changesAvailable && memory.currentStrikeMn != null && memory.previousStrikeMn != null
    ? memory.currentStrikeMn - memory.previousStrikeMn : null;
  const basis = (snapshot: CompanionGexSnapshot) => {
    const m = snapshot.measurement, coverage = m?.coverage;
    return `${t(!m ? "memoryAggregateBasis" : m.coveredOnly ? "memoryCoveredBasis" : "memoryObservedBasis")}${coverage ? ` · ${coverage.qualified.toLocaleString()} / ${(coverage.qualified + coverage.missing).toLocaleString()}` : ""}`;
  };

  const interval = <div className={styles.memoryInterval}>
    <time dateTime={memory.previous.session}>{memory.previous.session}</time>
    <span aria-hidden="true">→</span>
    <time dateTime={memory.current.session}>{memory.current.session}</time>
  </div>;
  const originalMeasurements = <>
    <div className={styles.nodeStats}>
      <div>
        <span>{t("memorySnapshotNet")}</span>
        <b>{fmtNetBn(memory.previous.netGexBn)} → {fmtNetBn(memory.current.netGexBn)}</b>
        <small>{t("memoryDelta")} · {fmtMn(netDeltaMn)}</small>
      </div>
      <div>
        <span>{t("memorySnapshotStrike")}{memory.strike == null ? "" : ` · ${memory.strike}`}</span>
        <b>{fmtMn(memory.previousStrikeMn)} → {fmtMn(memory.currentStrikeMn)}</b>
        <small>{t("memoryDelta")} · {fmtMn(strikeDeltaMn)}</small>
      </div>
    </div>
    <div className={styles.inspectorTitle}>
      <span>{t("memorySpot")}</span>
      <b>{fmtSpot(memory.previous.spot)} → {fmtSpot(memory.current.spot)}</b>
    </div>
  </>;
  const unavailable = memory.reportedChange?.state === "unavailable" ? memory.reportedChange.reason : "missing_basis";
  const reason = {
    missing_basis: "memoryMissingComparison", identity: "memoryIdentityMismatch", scope: "memoryScopeMismatch",
    definition: "memoryDefinitionMismatch", time: "memoryTimeMismatch", malformed: "memoryInvalidComparison",
    empty_intersection: lens.kind === "zero" ? "memoryNoZeroMatch" : "memoryNoMatch",
  } as const;

  // Legacy aggregate comparisons retain their original values and behavior.
  if (changesAvailable) return shell(<>
    <div className={styles.legend}><span>{t("previousAvailable")}</span>{interval}</div>
    {originalMeasurements}
    <p className={styles.scopeHint}>{t("memoryCaution")}</p>
  </>, "ready");

  return shell(<>
    {reported ? <div data-testid="options-memory-reported-change" className={styles.matchedChange}>
      <div className={styles.memoryMatchedHeading}>
        <strong>{t("memoryMatchedBasis")}</strong>
        <b>{reported.aggregate.contracts.toLocaleString()} {t("memoryMatchedContracts")}</b>
      </div>
      {interval}
      <p className={styles.memoryUnit}>{t("memoryGammaUnit")}</p>
      <div className={`${styles.nodeStats} ${styles.memoryPrimaryStats}`}>
        <div><span>{t("memorySignedChange")}</span><b>{fmtMn(reported.aggregate.signedChangeUsd / 1e6)}</b></div>
        <div><span>{t("memoryMagnitudeChange")}</span><b>{fmtMn(reported.aggregate.netMagnitudeChangeUsd / 1e6)}</b></div>
        <div><span>{t("memoryGrossChange")}</span><b>{fmtMn(reported.aggregate.grossChangeUsd / 1e6)}</b></div>
      </div>
      <dl className={styles.memoryCoverage} aria-label={t("memorySourceCoverage")}>
        <div><dt>{t("memoryObservedCounts")}</dt><dd>{reported.population.previousObserved.toLocaleString()} → {reported.population.currentObserved.toLocaleString()}</dd></div>
        <div><dt>{t("memoryQualifiedCounts")}</dt><dd>{reported.population.previousQualified.toLocaleString()} → {reported.population.currentQualified.toLocaleString()}</dd></div>
      </dl>
      <p className={styles.memoryPlain}>{t("memoryMatchedPlain")}</p>
      {memory.strike != null && <div className={styles.memoryStrike}>
        <div className={styles.inspectorTitle}><span>{t("memoryMatchedStrike")} · {memory.strike}</span><span>{atStrike?.contracts ?? 0} {t("memoryMatchedContracts")}</span></div>
        <div className={styles.nodeStats}>
          <div><span>{t("memorySignedChange")}</span><b>{fmtMn(atStrike ? atStrike.signedChangeUsd / 1e6 : null)}</b></div>
          <div><span>{t("memoryMagnitudeChange")}</span><b>{fmtMn(atStrike ? atStrike.netMagnitudeChangeUsd / 1e6 : null)}</b></div>
          <div><span>{t("memoryGrossChange")}</span><b>{fmtMn(atStrike ? atStrike.grossChangeUsd / 1e6 : null)}</b></div>
        </div>
      </div>}
    </div> : <div data-testid="options-memory-comparison-withheld" className={styles.memoryWithheld}>
      {interval}
      <p role="status">{t(reason[unavailable])}</p>
      <p className={styles.memoryPlain}>{t("memoryMatchedPlain")}</p>
    </div>}
    <details className={styles.memoryDetails} data-testid="options-memory-details">
      <summary>{t("memorySourceDetails")}</summary>
      <div className={styles.memoryDetailBody}>
        <div data-testid="options-memory-measurement-basis">
          <p className={styles.scopeHint}>{t("memorySeparateTotals")}</p>
          <dl className={styles.memoryCoverage} aria-label={t("memorySourceBasis")}>
            {[memory.previous, memory.current].map(snapshot => <div key={snapshot.session}>
              <dt>{snapshot.session}</dt><dd>{basis(snapshot)}</dd>
            </div>)}
          </dl>
        </div>
        {originalMeasurements}
        {reported && <>
          <p className={styles.scopeHint}>{t("memoryReportedOnly")}: {reported.population.previousOnlyReported.toLocaleString()} / {reported.population.currentOnlyReported.toLocaleString()}</p>
          <p className={styles.scopeHint}>{t("memoryQualificationChanges")}: +{reported.population.qualificationGained.toLocaleString()} / −{reported.population.qualificationLost.toLocaleString()} · {t("memoryUnavailableEither")}: {reported.population.unavailableEither.toLocaleString()}</p>
        </>}
        <p className={styles.scopeHint}>{t("memorySignConvention")}</p>
        {memory.current.measurement?.qualification === "dated" && memory.previous.measurement?.qualification === "dated"
          && <p className={styles.scopeHint}>{t("memoryDatedMethod")}</p>}
        <p className={styles.scopeHint}>{t("memoryReportedLimitsDetail")}</p>
      </div>
    </details>
  </>, "ready");
}
