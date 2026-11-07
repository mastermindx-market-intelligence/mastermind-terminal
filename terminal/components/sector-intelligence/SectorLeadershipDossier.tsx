"use client";

import { useMemo } from "react";
import { useLang } from "@/lib/i18n";
import { useSectorT } from "@/lib/sectorIntelligenceLex";
import { sectorDossiers, type SectorDossierGroup, type SectorDossiers } from "@/lib/sectorDossiers";
import { formatValue, type FeedPayload } from "@/lib/sectorIntelligence";
import styles from "./SectorLeadershipDossier.module.css";

/** Owner machine reasons, rendered in plain language. The exact raw reason stays reachable in the
 * source detail, so a reader can still match it against the owner's own record. */
const REASON_KEYS: Record<string, string> = {
  missing_group: "siDossierReasonMissingGroup",
  thin_history: "siDossierReasonThinHistory",
  missing_input: "siDossierReasonMissingInput",
  invalid_measurement: "siDossierReasonInvalidValue",
  outside_relative_wealth_domain: "siDossierReasonOutsideDomain",
  measurement_projection_mismatch: "siDossierReasonProjectionMismatch",
  duplicate_group_identity: "siDossierReasonDuplicate",
  group_kind_mismatch: "siDossierReasonGroupKind",
  measured_group_kind_mismatch: "siDossierReasonGroupKind",
  cohort_identity_mismatch: "siDossierReasonCohort",
  measurement_definition_mismatch: "siDossierReasonDefinition",
  row_provenance_invalid: "siDossierReasonProvenance",
  row_return_basis_mismatch: "siDossierReasonBasisMismatch",
  row_benchmark_mismatch: "siDossierReasonBenchmarkMismatch",
  source_session_missing_or_invalid: "siDossierReasonSourceDate",
  source_session_mismatch: "siDossierReasonSourceDateMismatch",
  history_session_missing_or_invalid: "siDossierReasonHistoryDate",
  history_session_mismatch: "siDossierReasonHistoryDateMismatch",
  benchmark_missing_or_invalid: "siDossierReasonBenchmark",
  benchmark_identity_mismatch: "siDossierReasonBenchmarkMismatch",
  return_basis_not_qualified: "siDossierReasonBasis",
  return_basis_mismatch: "siDossierReasonBasisMismatch",
  history_schema_not_qualified: "siDossierReasonHistorySchema",
  evidence_mode_not_qualified: "siDossierReasonEvidenceMode",
  missing_or_invalid_rows: "siDossierReasonRows",
  measured_missing_or_invalid_rows: "siDossierReasonRows",
  input_rows_exceed_bound: "siDossierReasonRowBound",
  measured_input_rows_exceed_bound: "siDossierReasonRowBound",
  invalid_measured_read_schema: "siDossierReasonReadSchema",
  measurement_source_root_missing: "siDossierReasonSourceRoot",
  original_availability_not_supplied: "siDossierAvailabilityMissing",
  invalid_decision_cutoff: "siDossierReasonInvalidCut",
  source_session_after_decision_cutoff: "siDossierReasonAfterCut",
  availability_time_missing: "siDossierReasonAvailability",
};

type WindowKey = "rs_21d" | "rs_63d";

/** Owner-supplied leadership evidence, rendered from the current sector feed only.
 *
 * This component owns no snapshot, no fetch and no state: it reads the feed it is handed and
 * renders what the owner measured. It never fabricates a number, never ranks sectors and never
 * states a forecast — the owner's forecast is explicitly not qualified. A non-ready feed clears
 * every figure immediately, so an access withdrawal cannot leave a stale number on screen. */
export default function SectorLeadershipDossier({ feed, selectedTicker, onSources }: {
  feed?: FeedPayload; selectedTicker: string; onSources?: () => void;
}) {
  const t = useSectorT(), { lang } = useLang();
  const status = feed?.receipt.status || "loading";
  // The dossier is read only from a ready receipt. A refused, unavailable, invalid or failed feed
  // never reaches the parser, so no figure from a previous owner can survive here.
  const read = useMemo(() => (status === "ready" ? sectorDossiers(feed?.data) : null), [feed, status]);

  if (status !== "ready" || !read) return <Notice status={status} onSources={onSources} />;
  if (read.dossier === null) return <Notice status={read.state} onSources={onSources} />;

  const dossier = read.dossier;
  const wanted = selectedTicker.trim().toUpperCase();
  const selected = wanted ? dossier.groups.find(group => group.group_id.toUpperCase() === wanted) || null : null;
  const benchmark = dossier.benchmark || "—";
  const plainReason = (reason: string) => {
    const key = REASON_KEYS[reason];
    return t(key || "siDossierReasonUnqualified");
  };
  const selectedName = selected && (lang === "zh" ? selected.name_zh || selected.name_en : selected.name_en || selected.name_zh);
  const subject = selected
    ? selectedName ? `${selectedName} · ${selected.group_id}` : selected.group_id
    : wanted || t("siDossierSelectedSector");

  const metrics: { window: "21" | "63"; key: WindowKey; label: string }[] = [
    { window: "21", key: "rs_21d", label: t("siDossierWindow21") },
    { window: "63", key: "rs_63d", label: t("siDossierWindow63") },
  ];

  return <section className={styles.section} aria-labelledby="si-dossier-heading" data-testid="sector-leadership-dossier"
    data-state={read.state === "outage" ? "outage" : undefined}>
    <header className={styles.heading}>
      <div>
        <h2 id="si-dossier-heading">{t("siDossierTitle")}</h2>
        <p className={styles.subject}>{subject}</p>
      </div>
      {dossier.as_of && <p className={styles.clock}><span>{t("siDossierThroughDate")}: </span>
        <time dateTime={dossier.as_of}>{dossier.as_of}</time></p>}
    </header>

    {read.state === "outage" && <div className={styles.notice} role="status">
      <strong>{t("siDossierUnavailable")}</strong>
      <p>{t("siDossierMeasurementsUnavailable")}</p>
    </div>}

    {selected ? <>
      <p className={styles.basis}>{t("siDossierRelativeVsBenchmark").replace("{benchmark}", benchmark)}</p>
      <div className={styles.metrics}>
        {metrics.map(metric => {
          const value = selected.relative_wealth_pct[metric.key];
          const reason = selected.null_reasons[metric.key];
          return <Metric key={metric.window} window={metric.window} label={metric.label} value={value}
            foot={value === null ? (reason ? plainReason(reason) : t("siDossierNoMeasurement"))
              : direction(value, benchmark, t)} />;
        })}
      </div>
    </> : <div className={styles.notice} role="status" data-testid="sector-dossier-identity">
      <strong>{t("siDossierSelectedMissing")}</strong>
      <p>{t("siDossierSelectedMissingCopy")}</p>
    </div>}

    <p className={styles.stance}>{t("siDossierStance")}</p>
    <p className={styles.caveat}>{t("siDossierCaveat")}</p>

    <div className={styles.breadth}>
      {metrics.map(metric => {
        const count = dossier.cross_sector_breadth_counts[metric.window];
        const copy = count.positive_n === null ? t("siDossierPositiveUnknown") : t("siDossierPositiveCount");
        return <p key={metric.window} data-testid="sector-dossier-breadth" data-window={metric.window}>
          {copy.replace("{window}", metric.label)
            .replace("{positive}", String(count.positive_n))
            .replace("{measured}", String(count.measured_n))
            .replace("{expected}", String(count.expected_n))}
        </p>;
      })}
      <p className={styles.scope}>{t("siDossierBreadthScope")}</p>
      <p>{t("siDossierMechanismRisk")}</p>
    </div>

    <CompareAllSectors dossier={dossier} selected={selected} plainReason={plainReason} />
    <SourceDetails dossier={dossier} feed={feed} plainReason={plainReason} />
  </section>;
}

/** A bounded, non-numeric state. The cause is stated; the existing source drawer stays reachable. */
function Notice({ status, onSources }: { status: string; onSources?: () => void }) {
  const t = useSectorT();
  const copy: Record<string, [string, string]> = {
    access: ["siDossierAccess", "siDossierAccessCopy"],
    unavailable: ["siDossierUnavailable", "siDossierUnavailableCopy"],
    outage: ["siDossierUnavailable", "siDossierUnavailableCopy"],
    invalid: ["siDossierInvalid", "siDossierInvalidCopy"],
    error: ["siDossierError", "siDossierErrorCopy"],
    absent: ["siDossierAbsent", "siDossierAbsentCopy"],
  };
  const pair = copy[status] || copy.unavailable;
  if (status === "loading") return <section className={styles.section} aria-labelledby="si-dossier-heading"
    data-testid="sector-leadership-dossier" data-state="loading">
    <header className={styles.heading}><div><h2 id="si-dossier-heading">{t("siDossierTitle")}</h2></div></header>
    <div className={styles.skeleton} role="status" aria-busy="true">
      <span className={styles.srOnly}>{t("siDossierLoading")}</span>
      <span className={styles.skeletonBar} aria-hidden="true" />
      <span className={styles.skeletonBar} aria-hidden="true" />
      <span className={styles.skeletonBar} aria-hidden="true" />
    </div>
  </section>;
  return <section className={styles.section} aria-labelledby="si-dossier-heading"
    data-testid="sector-leadership-dossier" data-state={status}>
    <header className={styles.heading}><div><h2 id="si-dossier-heading">{t("siDossierTitle")}</h2></div></header>
    <div className={styles.notice} role="status" data-testid="sector-dossier-state">
      <strong>{t(pair[0])}</strong>
      <p>{t(pair[1])}</p>
      {onSources && <button type="button" className={styles.textButton} onClick={onSources}>{t("siSelectSources")} →</button>}
    </div>
  </section>;
}

/** One window of observed relative wealth. Direction is carried by the sign, by the wording and by
 * the value's own semantics — never by color alone. A signed zero stays a plain zero. */
function Metric({ window, label, value, foot }: {
  window: string; label: string; value: number | null; foot: string;
}) {
  const sign = value === null || value === 0 ? undefined : value > 0 ? "up" : "down";
  return <div className={styles.metric} data-testid="sector-dossier-metric" data-window={window}>
    <span className={styles.metricLabel}>{label}</span>
    <strong className={styles.metricValue} data-sign={sign} data-muted={value === null ? "true" : undefined}>
      {value === null ? "—" : formatValue(value, 2, "%", true)}
    </strong>
    <small className={styles.metricFoot}>{foot}</small>
  </div>;
}

function direction(value: number, benchmark: string, t: (key: string) => string): string {
  if (value > 0) return t("siDossierAheadOf").replace("{benchmark}", benchmark);
  if (value < 0) return t("siDossierBehindOf").replace("{benchmark}", benchmark);
  return t("siDossierLevelWith").replace("{benchmark}", benchmark);
}

/** Every cohort sector in the owner's own order, with its exact windows and its own null reasons. */
function CompareAllSectors({ dossier, selected, plainReason }: {
  dossier: SectorDossiers; selected: SectorDossierGroup | null; plainReason: (reason: string) => string;
}) {
  const t = useSectorT(), { lang } = useLang();
  const name = (group: SectorDossierGroup) =>
    lang === "zh" ? group.name_zh || group.name_en : group.name_en || group.name_zh;
  const reasons = (group: SectorDossierGroup) => {
    const all = [group.null_reasons.rs_21d, group.null_reasons.rs_63d, ...group.qualification_reasons]
      .filter((reason): reason is string => typeof reason === "string" && reason.length > 0);
    return [...new Set(all)];
  };
  return <details className={styles.disclosure} data-testid="sector-dossier-compare">
    <summary>{t("siDossierCompareAll")}</summary>
    <table className={styles.table}>
      <thead><tr>
        <th scope="col">{t("siDossierSectorColumn")}</th>
        <th scope="col">{t("siDossierWindow21")}</th>
        <th scope="col">{t("siDossierWindow63")}</th>
        <th scope="col">{t("siDossierReasonColumn")}</th>
      </tr></thead>
      <tbody>{dossier.groups.map(group => {
        const v21 = group.relative_wealth_pct.rs_21d, v63 = group.relative_wealth_pct.rs_63d;
        const groupReasons = reasons(group);
        return <tr key={group.group_id} data-sector={group.group_id}
          data-selected={selected && selected.group_id === group.group_id ? "true" : undefined}>
          <th scope="row" data-label={t("siDossierSectorColumn")}>
            <span className={styles.rowName}>{group.group_id}</span>
            <span className={styles.rowLabel}>{name(group) || ""}</span>
            {selected && selected.group_id === group.group_id
              && <span className={styles.srOnly}>{` — ${t("siDossierSelectedRow")}`}</span>}
          </th>
          <td data-label={t("siDossierWindow21")} data-sign={v21 === null || v21 === 0 ? undefined : v21 > 0 ? "up" : "down"}>
            {v21 === null ? "—" : formatValue(v21, 2, "%", true)}
          </td>
          <td data-label={t("siDossierWindow63")} data-sign={v63 === null || v63 === 0 ? undefined : v63 > 0 ? "up" : "down"}>
            {v63 === null ? "—" : formatValue(v63, 2, "%", true)}
          </td>
          <td data-label={t("siDossierReasonColumn")} className={styles.rowReason}>
            {groupReasons.length ? groupReasons.map(plainReason).join(" / ") : "—"}
          </td>
        </tr>;
      })}</tbody>
    </table>
  </details>;
}

/** The owner's own qualifications: clocks, basis, freshness, reconstructed prices, the missing
 * original availability, corrections, the absent immutable generation, the not-qualified forecast,
 * the disabled authority and the dependency audit. The transport receipt is labelled as transport
 * evidence only, and every machine reason is repeated here in its exact raw form. */
function SourceDetails({ dossier, feed, plainReason }: {
  dossier: SectorDossiers; feed?: FeedPayload; plainReason: (reason: string) => string;
}) {
  const t = useSectorT();
  const audit = dossier.dependency_audit;
  const ownerReasons = dossier.groups.flatMap(group => {
    const all = [group.null_reasons.rs_21d, group.null_reasons.rs_63d, ...group.qualification_reasons]
      .filter((reason): reason is string => typeof reason === "string" && reason.length > 0);
    return [...new Set(all)].map(reason => `${group.group_id}: ${reason}`);
  });
  return <details className={styles.disclosure} data-testid="sector-dossier-source">
    <summary>{t("siDossierSourceDetails")}</summary>
    <dl className={styles.detail}>
      <Pair term={t("siDossierSourceSession")} detail={dossier.as_of || "—"} />
      <Pair term={t("siDossierPriceBasis")} detail={dossier.price_basis === "total_return" ? t("siDossierTotalReturn") : "—"} />
      <Pair term={t("siDossierUnits")} detail={dossier.units} />
      <Pair term={t("siDossierMeasurementStatus")} detail={dossier.measurement_status} />
      <Pair term={t("siDossierFreshness")} detail={t("siDossierFreshnessUnverified")} reason={dossier.freshness.reason} />
      <Pair term={t("siDossierHistory")} detail={t("siDossierHistoryReconstructed")} reason={dossier.history.mode} />
      <Pair term={t("siDossierAvailabilityMode")} detail={t(dossier.availability.mode === "as_known" ? "siDossierAsKnown" : "siDossierDatedSnapshot")} reason={dossier.availability.mode} />
      {dossier.availability.mode === "as_known" && <Pair term={t("siDossierDecisionCut")} detail={dossier.availability.decision_cutoff || "—"} />}
      <Pair term={t("siDossierAvailability")} detail={plainReason(dossier.availability.reason)} reason={dossier.availability.reason} />
      <Pair term={t("siDossierHistoricallyAdmissible")} detail={t("siNo")} />
      <Pair term={t("siDossierCorrections")} detail={t("siDossierCorrectionsMissing")} reason={dossier.corrections.reason} />
      <Pair term={t("siDossierGeneration")} detail={t("siDossierGenerationMissing")} reason={dossier.source_generation.reason} />
      <Pair term={t("siDossierCompatibilityKey")} detail={dossier.compatibility_key || "—"} note={t("siDossierCompatibilityNote")} />
      <Pair term={t("siDossierForecast")} detail={t("siDossierForecastNotQualified")} reason={dossier.forecasts.status} />
      <Pair term={t("siDossierAuthority")} detail={t("siDossierAuthorityDisabled")} />
      <Pair term={t("siDossierMechanism")} detail={t("siDossierMechanismRisk")} reason={dossier.mechanism.reason} />
      <Pair term={t("siDossierSectorRisk")} detail={t("siDossierMechanismRisk")} reason={dossier.risk.reason} />
      <Pair term={t("siDossierUnavailableWindows")} detail={t("siDossierUnavailableWindowsCopy")} reason={dossier.unavailable_windows.reason} />
      <Pair term={t("siDossierDependencyRoots")} detail={audit.source_roots.join(", ") || "—"} />
      <Pair term={t("siDossierDependencyFamilies")} detail={String(audit.source_family_count)} />
      <Pair term={t("siDossierDependencyIndependence")}
        detail={audit.independence === "not_established" ? t("siDossierDependencyNotEstablished") : audit.independence}
        reason={audit.independence === "not_established" ? audit.independence : undefined} />
      <Pair term={t("siDossierDependencySharedWindows")} detail={audit.shared_rolling_windows ? t("siYes") : t("siNo")} />
      <Pair term={t("siDossierDependencyOverlap")}
        detail={audit.constituent_overlap === "unknown" ? t("siDossierUnknown") : audit.constituent_overlap}
        reason={audit.constituent_overlap === "unknown" ? audit.constituent_overlap : undefined} />
      <Pair term={t("siDossierTransportPath")} detail={feed?.receipt.path || "—"} note={t("siDossierTransportNote")} />
      <Pair term={t("siDossierTransportHash")} detail={feed?.receipt.contentHash || "—"} />
      {ownerReasons.length > 0 && <Pair term={t("siDossierOwnerReasons")} detail={ownerReasons.join("\n")} mono />}
    </dl>
  </details>;
}

function Pair({ term, detail, note, reason, mono }: {
  term: string; detail: string; note?: string; reason?: string; mono?: boolean;
}) {
  const t = useSectorT();
  return <div className={styles.pair}>
    <dt>{term}</dt>
    <dd data-mono={mono || undefined}>{detail}
      {reason && <code className={styles.pairReason}><span className={styles.srOnly}>{`${t("siDossierRawReason")}: `}</span>{reason}</code>}
      {note && <span className={styles.pairNote}>{note}</span>}
    </dd>
  </div>;
}
