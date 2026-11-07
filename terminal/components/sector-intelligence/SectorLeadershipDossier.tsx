"use client";

import { useMemo } from "react";
import { useLang } from "@/lib/i18n";
import { useSectorT } from "@/lib/sectorIntelligenceLex";
import {
  sectorDossiers, sectorWindowMeasurements, EXACT_WINDOW_KEYS,
  type ExactCell, type ExactClockLimitation, type ExactGroup, type ExactMeasurementReason,
  type ExactWindowKey, type SectorDossierGroup, type SectorDossiers,
  type SectorWindowMeasurements, type SectorWindowMeasurementsRead,
} from "@/lib/sectorDossiers";
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

/** The exact-session companion's own machine reasons — the fourteen measurement reasons and the
 * six limitation reasons — each in plain language. The exact raw reason stays reachable in the
 * companion's own source details. */
const EXACT_REASON_KEYS: Record<string, string> = {
  missing_input: "siExactReasonMissingInput",
  non_finite_input: "siExactReasonNonFinite",
  invalid_price: "siExactReasonInvalidPrice",
  benchmark_missing: "siExactReasonBenchmarkMissing",
  benchmark_invalid: "siExactReasonBenchmarkInvalid",
  insufficient_reference_history: "siExactReasonInsufficientHistory",
  empty_panel: "siExactReasonEmptyPanel",
  future_tail: "siExactReasonFutureTail",
  source_session_mismatch: "siExactReasonSourceSessionMismatch",
  ambiguous_duplicate_price_index: "siExactReasonDuplicatePriceIndex",
  ambiguous_duplicate_column: "siExactReasonDuplicateColumn",
  cohort_identity_mismatch: "siExactReasonCohortMismatch",
  benchmark_identity_mismatch: "siExactReasonBenchmarkMismatch",
  return_basis_not_qualified: "siExactReasonBasisNotQualified",
  owner_availability_clock_not_supplied: "siExactLimitAvailability",
  owner_publication_clock_not_supplied: "siExactLimitPublication",
  owner_history_clock_not_supplied: "siExactLimitHistory",
  native_revision_selection_not_supplied: "siExactLimitCorrections",
  owner_freshness_receipt_not_supplied: "siExactLimitFreshness",
  point_in_time_admission_not_supplied: "siExactLimitPointInTime",
};

type WindowKey = "rs_21d" | "rs_63d";

/** The owner's own clock names, used when a supplied clock is named in the limitations summary. */
const EXACT_CLOCK_NAMES = {
  publication: "siExactClockPublication",
  availability: "siExactClockAvailability",
  history: "siExactClockHistory",
} as const;

/** Owner-supplied leadership evidence, rendered from the current sector feed only.
 *
 * This component owns no snapshot, no fetch and no state: it reads the feed it is handed and
 * renders what the owner measured. It never fabricates a number, never ranks sectors and never
 * states a forecast — the owner's forecast is explicitly not qualified. A non-ready feed clears
 * every figure immediately, so an access withdrawal cannot leave a stale number on screen.
 *
 * The legacy closed21/63 dossier and the exact-session companion are two separate documents.
 * The companion is added beside the dossier, never inside it: an absent companion adds nothing
 * to this view, an unreadable companion stays inside its own section, and a readable companion
 * stays visible even when the legacy dossier itself is absent. */
export default function SectorLeadershipDossier({ feed, selectedTicker, onSources }: {
  feed?: FeedPayload; selectedTicker: string; onSources?: () => void;
}) {
  const t = useSectorT(), { lang } = useLang();
  const status = feed?.receipt.status || "loading";
  // The dossier is read only from a ready receipt. A refused, unavailable, invalid or failed feed
  // never reaches the parser, so no figure from a previous owner can survive here.
  const read = useMemo(() => (status === "ready" ? sectorDossiers(feed?.data) : null), [feed, status]);
  // The exact-session companion is read from the same ready receipt and from its own key. It is
  // never derived from the dossier, and the dossier is never derived from it.
  const exact = useMemo(() => (status === "ready" ? sectorWindowMeasurements(feed?.data) : null),
    [feed, status]);

  // The companion is bounded by its own document: nothing is added when the owner published none.
  const companion = exact
    ? <ExactSessionReturns read={exact} selectedTicker={selectedTicker} />
    : null;

  if (status !== "ready" || !read) {
    return <><Notice status={status} onSources={onSources} />{companion}</>;
  }
  if (read.dossier === null) {
    return <><Notice status={read.state} onSources={onSources} />{companion}</>;
  }

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

  return <><section className={styles.section} aria-labelledby="si-dossier-heading" data-testid="sector-leadership-dossier"
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
  </section>{companion}</>;
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

/* -------------------------------------------------------------------------- *
 * The exact-session companion.
 *
 * A separate owner document: the producer's native 5/20/63-session endpoint
 * returns for the eleven sector ETF proxies against one owner-supplied
 * benchmark. Nothing here is computed in the browser — no return, no date, no
 * rank, no coverage, no breadth — and the companion never becomes a ranking,
 * a gate or a substitute for the legacy dossier.
 * -------------------------------------------------------------------------- */

/** A signed zero is a plain zero: the sign of zero carries no direction and no minus sign. */
function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return formatValue(value === 0 ? 0 : value, 2, "%", true);
}

function signOf(value: number | null): string | undefined {
  return value === null || value === 0 ? undefined : value > 0 ? "up" : "down";
}

function ExactSessionReturns({ read, selectedTicker }: {
  read: SectorWindowMeasurementsRead; selectedTicker: string;
}) {
  const t = useSectorT(), { lang } = useLang();
  const plainReason = (reason: string) => t(EXACT_REASON_KEYS[reason] || "siExactReasonUnqualified");

  // The owner published no companion. Nothing is added to this view.
  if (read.state === "absent") return null;

  // The owner published something this consumer cannot verify. It stays inside
  // its own section and never touches the dossier beside it.
  if (read.state === "invalid" || read.measurements === null) {
    return <section className={`${styles.section} ${styles.exactSection}`} aria-labelledby="si-exact-heading"
      data-testid="sector-exact-window-returns" data-state="invalid">
      <header className={styles.heading}>
        <div><h2 id="si-exact-heading">{t("siExactTitle")}</h2></div>
      </header>
      <div className={styles.notice} role="status" data-testid="sector-exact-state">
        <strong>{t("siExactInvalid")}</strong>
        <p>{t("siExactInvalidCopy")}</p>
      </div>
    </section>;
  }

  const measurements = read.measurements;
  const wanted = selectedTicker.trim().toUpperCase();
  const selected = wanted
    ? measurements.groups.find(group => group.group_id.toUpperCase() === wanted) || null : null;
  const benchmark = measurements.benchmark;
  const selectedName = selected && (lang === "zh" ? selected.name_zh || selected.name_en
    : selected.name_en || selected.name_zh);
  const subject = selected
    ? selectedName ? `${selectedName} · ${selected.group_id}` : selected.group_id
    : wanted || t("siDossierSelectedSector");

  // A partial packet is not an unavailable one, and an ordinary all-null packet is not a
  // documented refusal. The copy states what is actually true and never infers a cause from
  // the status alone. No new status and no new cause is introduced here.
  const statusNotice = measurements.status === "partial"
    ? { title: t("siExactPartialTitle"), copy: t("siExactPartialCopy") }
    : measurements.reason !== null
      ? { title: t("siExactUnavailable"), copy: t("siExactMeasurementsUnavailable") }
      : { title: t("siExactNoReturnsTitle"), copy: t("siExactNoReturnsCopy") };

  // The owner's clocks are either supplied or not supplied. The summary never denies a clock
  // the owner did supply, and a supplied clock never qualifies freshness, revision selection,
  // original availability or point-in-time admission.
  const suppliedClocks = (["publication", "availability", "history"] as const)
    .filter(name => measurements.clocks[name] !== null);
  const limitsCopy = suppliedClocks.length === 0 ? t("siExactLimits")
    : t("siExactLimitsSupplied").replace("{clocks}",
      suppliedClocks.map(name => t(EXACT_CLOCK_NAMES[name])).join(lang === "zh" ? "、" : ", "));

  return <section className={`${styles.section} ${styles.exactSection}`} aria-labelledby="si-exact-heading"
    data-testid="sector-exact-window-returns" data-state={measurements.status}>
    <header className={styles.heading}>
      <div>
        <h2 id="si-exact-heading">{t("siExactTitle")}</h2>
        <p className={styles.subject}>{subject}</p>
      </div>
      <p className={styles.clock}><span>{t("siExactThroughDate")}: </span>
        <time dateTime={measurements.end_session}>{measurements.end_session}</time></p>
    </header>

    {measurements.status !== "available" && <div className={styles.notice} role="status" data-testid="sector-exact-status">
      <strong>{statusNotice.title}</strong>
      <p>{statusNotice.copy}</p>
    </div>}

    <div className={styles.exactIntro}>
      <p>{t("siExactBasis")}</p>
      <p>{t("siExactRelativeBasis")}</p>
      <p>{t("siExactWindowNote")}</p>
      <p>{t("siExactSharedPanel")}</p>
    </div>

    {selected ? <div className={styles.exactWindows}>
      {EXACT_WINDOW_KEYS.map(key => <ExactWindowBlock key={key} windowKey={key}
        measurements={measurements} cell={selected.windows[key]} benchmark={benchmark}
        plainReason={plainReason} />)}
    </div> : <div className={styles.notice} role="status" data-testid="sector-exact-identity">
      <strong>{t("siExactSelectedMissing")}</strong>
      <p>{t("siExactSelectedMissingCopy")}</p>
    </div>}

    <div className={styles.exactBenchmark} data-testid="sector-exact-benchmark">
      <strong>{t("siExactBenchmarkTitle").replace("{benchmark}", benchmark)}</strong>
      <dl>
        {EXACT_WINDOW_KEYS.map(key => {
          const window = measurements.windows[key];
          return <div key={key}>
            <dt>{t(`siExactWindow${key}`)}</dt>
            <dd data-testid="sector-exact-benchmark-return" data-window={key}
              data-sign={signOf(window.benchmark_return_pct)}>
              {formatPercent(window.benchmark_return_pct)}
              <small>{t("siExactCoverageValue")
                .replace("{observed}", String(window.benchmark_coverage.observed_n))
                .replace("{expected}", String(window.benchmark_coverage.expected_n))}</small>
            </dd>
          </div>;
        })}
      </dl>
    </div>

    <p className={styles.limits}>{limitsCopy}</p>

    <ExactCompare measurements={measurements} selected={selected} benchmark={benchmark}
      plainReason={plainReason} />
    <ExactSourceDetails measurements={measurements} plainReason={plainReason} />
  </section>;
}

/** One exact window of the selected sector: the absolute return, the relative wealth against the
 * admitted benchmark, the exact session span and the group's own observed coverage. The start
 * session is the producer's; this view never derives it. */
function ExactWindowBlock({ windowKey, measurements, cell, benchmark, plainReason }: {
  windowKey: ExactWindowKey; measurements: SectorWindowMeasurements; cell: ExactCell;
  benchmark: string; plainReason: (reason: string) => string;
}) {
  const t = useSectorT();
  const window = measurements.windows[windowKey];
  const absolute = cell.absolute_return_pct, relative = cell.relative_wealth_pct;
  return <div className={styles.exactWindow} data-testid="sector-exact-window" data-window={windowKey}>
    <span className={styles.metricLabel}>{t(`siExactWindow${windowKey}`)}</span>
    <dl className={styles.exactValues}>
      <div>
        <dt>{t("siExactAbsoluteReturn")}</dt>
        <dd data-testid="sector-exact-absolute" data-sign={signOf(absolute)}
          data-muted={absolute === null ? "true" : undefined}>
          {formatPercent(absolute)}
        </dd>
        {cell.null_reasons.absolute_return_pct
          && <small>{plainReason(cell.null_reasons.absolute_return_pct)}</small>}
      </div>
      <div>
        <dt>{t("siExactRelativeWealth").replace("{benchmark}", benchmark)}</dt>
        <dd data-testid="sector-exact-relative" data-sign={signOf(relative)}
          data-muted={relative === null ? "true" : undefined}>
          {formatPercent(relative)}
        </dd>
        {cell.null_reasons.relative_wealth_pct
          && <small>{plainReason(cell.null_reasons.relative_wealth_pct)}</small>}
      </div>
      <div>
        <dt>{t("siExactSessionSpan")}</dt>
        <dd data-testid="sector-exact-span">
          {window.start_session
            ? `${window.start_session} → ${window.end_session}`
            : t("siExactNoStart")}
        </dd>
      </div>
      <div>
        <dt>{t("siExactGroupCoverage")}</dt>
        <dd data-testid="sector-exact-coverage">
          {t("siExactCoverageValue")
            .replace("{observed}", String(cell.coverage.observed_n))
            .replace("{expected}", String(cell.coverage.expected_n))}
        </dd>
      </div>
    </dl>
  </div>;
}

/** All eleven cohort sectors in the producer's own order, with their own three exact windows,
 * their own coverage and their own plain cause. The selected identity is marked; no sector is
 * ranked, and no sector stands in for another. */
function ExactCompare({ measurements, selected, benchmark, plainReason }: {
  measurements: SectorWindowMeasurements; selected: ExactGroup | null; benchmark: string;
  plainReason: (reason: string) => string;
}) {
  const t = useSectorT(), { lang } = useLang();
  const name = (group: ExactGroup) =>
    lang === "zh" ? group.name_zh || group.name_en : group.name_en || group.name_zh;
  const cellReasons = (cell: ExactCell) => [...new Set(
    [cell.null_reasons.absolute_return_pct, cell.null_reasons.relative_wealth_pct]
      .filter((reason): reason is ExactMeasurementReason => typeof reason === "string"),
  )];
  return <details className={styles.disclosure} data-testid="sector-exact-compare">
    <summary>{t("siExactCompareAll")}</summary>
    <table className={styles.table}>
      <thead><tr>
        <th scope="col">{t("siExactSectorColumn")}</th>
        {EXACT_WINDOW_KEYS.map(key => <th scope="col" key={key}>
          {t(`siExactWindow${key}`)}
          <span className={styles.tableHeadNote}>
            {measurements.windows[key].start_session
              ? `${measurements.windows[key].start_session} → ${measurements.windows[key].end_session}`
              : t("siExactNoStart")}
          </span>
        </th>)}
        <th scope="col">{t("siExactCauseColumn")}</th>
      </tr></thead>
      <tbody>{measurements.groups.map(group => {
        const reasons = [...new Set(EXACT_WINDOW_KEYS.flatMap(key => cellReasons(group.windows[key])))];
        return <tr key={group.group_id} data-sector={group.group_id}
          data-selected={selected && selected.group_id === group.group_id ? "true" : undefined}>
          <th scope="row" data-label={t("siExactSectorColumn")}>
            <span className={styles.rowName}>{group.group_id}</span>
            <span className={styles.rowLabel}>{name(group) || ""}</span>
            {selected && selected.group_id === group.group_id
              && <span className={styles.srOnly}>{` — ${t("siExactSelectedRow")}`}</span>}
          </th>
          {EXACT_WINDOW_KEYS.map(key => {
            const cell = group.windows[key];
            return <td key={key} data-label={t(`siExactWindow${key}`)}>
              <span className={styles.cellAbsolute} data-sign={signOf(cell.absolute_return_pct)}>
                <span className={styles.srOnly}>{`${t("siExactAbsoluteReturn")}: `}</span>
                {formatPercent(cell.absolute_return_pct)}
              </span>
              <span className={styles.cellRelative} data-sign={signOf(cell.relative_wealth_pct)}>
                <span className={styles.srOnly}>{`${t("siExactRelativeWealth").replace("{benchmark}", benchmark)}: `}</span>
                {formatPercent(cell.relative_wealth_pct)}
              </span>
              <span className={styles.cellCoverage}>
                <span className={styles.srOnly}>{`${t("siExactGroupCoverage")}: `}</span>
                {t("siExactCoverageCompact")
                  .replace("{observed}", String(cell.coverage.observed_n))
                  .replace("{expected}", String(cell.coverage.expected_n))}
              </span>
            </td>;
          })}
          <td data-label={t("siExactCauseColumn")} className={styles.rowReason}>
            {reasons.length ? reasons.map(plainReason).join(" / ") : "—"}
          </td>
        </tr>;
      })}</tbody>
    </table>
  </details>;
}

/** The companion's own qualifications: the owner's clocks, the six limitations, the disabled
 * authority, the producer's diagnostics and every raw reason in its exact form. The receipt is
 * reported as present or withheld — never expanded, never interpolated, never a proof. */
function ExactSourceDetails({ measurements, plainReason }: {
  measurements: SectorWindowMeasurements; plainReason: (reason: string) => string;
}) {
  const t = useSectorT();
  const diagnostics = measurements.diagnostics;
  const ownerReasons = measurements.groups.flatMap(group => {
    const parts = EXACT_WINDOW_KEYS.map(key => {
      const cell = group.windows[key];
      const reasons = [...new Set(
        [cell.null_reasons.absolute_return_pct, cell.null_reasons.relative_wealth_pct]
          .filter((reason): reason is ExactMeasurementReason => typeof reason === "string"),
      )];
      return reasons.length ? `${key}=${reasons.join(",")}` : null;
    }).filter((part): part is string => part !== null);
    return parts.length ? [`${group.group_id}: ${parts.join(" ")}`] : [];
  });
  const limitation = (value: ExactClockLimitation) => value.status === "supplied"
    ? { detail: value.clock, reason: undefined }
    : { detail: plainReason(value.reason), reason: value.reason };
  const availability = limitation(measurements.limitations.availability);
  const publication = limitation(measurements.limitations.publication);
  const history = limitation(measurements.limitations.history);
  const clocks = (["publication", "availability", "correction", "history"] as const)
    .map(name => `${name}=${measurements.clocks[name] ?? t("siExactClockNotSupplied")}`).join(" ");
  // An absent receipt was either not supplied or explicitly withheld, and the two are not the
  // same statement. A supplied receipt is bounded, is never expanded, and is never a proof.
  const receiptCopy = measurements.receipt !== null ? t("siExactReceiptSupplied")
    : diagnostics.receipt_withheld ? t("siExactReceiptWithheld")
      : t("siExactReceiptNotSupplied");
  return <details className={styles.disclosure} data-testid="sector-exact-source">
    <summary>{t("siExactSourceDetails")}</summary>
    <dl className={styles.detail}>
      <Pair term={t("siExactSourceSession")} detail={measurements.source_session} />
      <Pair term={t("siExactEndSession")} detail={measurements.end_session} />
      <Pair term={t("siExactBenchmark")} detail={measurements.benchmark} />
      <Pair term={t("siExactCohort")} detail={measurements.cohort_id} />
      <Pair term={t("siExactPopulation")} detail={measurements.population} />
      <Pair term={t("siExactUnits")} detail={measurements.units} />
      <Pair term={t("siExactPriceBasis")} detail={t("siExactTotalReturn")} />
      <Pair term={t("siExactMeasurementStatus")} detail={measurements.status} />
      <Pair term={t("siExactStatus")} detail={measurements.status} />
      <Pair term={t("siExactReason")} detail={measurements.reason ? plainReason(measurements.reason) : "—"}
        reason={measurements.reason || undefined} />
      <Pair term={t("siExactEndpointDefinition")} detail={measurements.endpoint_definition} />
      <Pair term={t("siExactClocks")} detail={clocks} mono />
      <Pair term={t("siExactLimitAvailabilityName")} detail={availability.detail} reason={availability.reason} />
      <Pair term={t("siExactLimitPublicationName")} detail={publication.detail} reason={publication.reason} />
      <Pair term={t("siExactLimitHistoryName")} detail={history.detail} reason={history.reason} />
      <Pair term={t("siExactLimitCorrectionsName")} detail={t("siExactLimitCorrections")}
        reason={measurements.limitations.corrections.reason} />
      <Pair term={t("siExactLimitFreshnessName")} detail={t("siExactLimitFreshness")}
        reason={measurements.limitations.freshness.reason} />
      <Pair term={t("siExactLimitPointInTimeName")} detail={t("siExactLimitPointInTime")}
        reason={measurements.limitations.point_in_time.reason} />
      <Pair term={t("siExactAuthority")} detail={t("siExactAuthorityDisabled")} />
      <Pair term={t("siExactPanelRows")} detail={String(diagnostics.panel_rows)} />
      <Pair term={t("siExactMalformedRows")} detail={String(diagnostics.malformed_rows)} />
      <Pair term={t("siExactColumns")} detail={diagnostics.columns.join(", ") || "—"} />
      <Pair term={t("siExactExpectedColumns")} detail={String(diagnostics.expected_columns)} />
      <Pair term={t("siExactDuplicateSessions")} detail={diagnostics.duplicate_sessions.join(", ") || "—"} />
      <Pair term={t("siExactAmbiguousColumns")} detail={diagnostics.ambiguous_columns.join(", ") || "—"} />
      <Pair term={t("siExactFutureTailSessions")} detail={diagnostics.future_tail_sessions.join(", ") || "—"} />
      <Pair term={t("siExactBindingKeys")} detail={diagnostics.binding_keys.join(", ") || "—"} />
      <Pair term={t("siExactMeasuredCells")} detail={String(diagnostics.measured_cells)} />
      <Pair term={t("siExactCompleteCells")} detail={String(diagnostics.complete_cells)} />
      <Pair term={t("siExactTotalCells")} detail={String(diagnostics.total_cells)} />
      <Pair term={t("siExactCoverageNote")} detail={diagnostics.coverage_note} />
      <Pair term={t("siExactSourceRoots")} detail={measurements.source_roots.join(", ") || "—"} />
      <Pair term={t("siExactReceipt")} detail={receiptCopy} />
      <Pair term={t("siExactQualificationReasons")} detail={diagnostics.qualification_reasons.join(", ") || "—"} mono />
      {ownerReasons.length > 0 && <Pair term={t("siExactOwnerReasons")} detail={ownerReasons.join("\n")} mono />}
    </dl>
  </details>;
}
